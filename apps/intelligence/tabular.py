"""Local tabular challengers fitted to the same privacy-filtered chronological partitions."""
from pathlib import Path
from tempfile import TemporaryDirectory

import numpy as np
from catboost import CatBoostClassifier, Pool
from lightgbm import LGBMClassifier
from sklearn.preprocessing import OneHotEncoder
from xgboost import XGBClassifier


CONTEXT_FIELDS = ("channel","reach","load","elapsed","element_type","placement","font","contrast","density","market")


def contextual_rows(tensor, views, allowed):
    extra = [[example.get("context",{}).get(f,"unknown") for f in CONTEXT_FIELDS]
             for view in views for example in view["examples"]]
    extra = [[value if value in allowed[f] else "unknown" for value,f in zip(row,CONTEXT_FIELDS)] for row in extra]
    return np.column_stack((tensor.numpy().astype(str),np.asarray(extra)))


def benchmark(training, test, labels, test_labels, fields, seed, metrics, train_views, test_views, minimum):
    from collections import Counter
    allowed,defaults={},{}
    for f in CONTEXT_FIELDS:
        counts=Counter()
        for view in train_views:
            counts.update({e.get("context",{}).get(f,"unknown") for e in view["examples"]})
        allowed[f]=sorted(k for k,v in counts.items() if v>=minimum)
        defaults[f]=min(allowed[f],key=lambda v:(-counts[v],v)) if allowed[f] else "unknown"
    # Bind screenshot-derived defaults to the candidate when there is distinct-view support.
    element_counts={}
    for view in train_views:
        seen=set()
        for example in view["examples"]:
            element=example["features"]["element_id"]
            if element in seen:
                continue
            seen.add(element)
            counts=element_counts.setdefault(element,{})
            for f in ("element_type","placement","font","contrast","density"):
                value=example.get("context",{}).get(f,"unknown")
                if value in allowed[f]:
                    counts.setdefault(f,Counter())[value]+=1
    element_defaults={}
    for element,counts in element_counts.items():
        supported={}
        for f,values in counts.items():
            value,count=values.most_common(1)[0]
            if count>=minimum:
                supported[f]=value
        if supported:
            element_defaults[element]=supported
    fields=tuple(fields)+CONTEXT_FIELDS
    # IDs are the existing training-only vocabulary indices. Preserve the unknown bucket.
    train = contextual_rows(training,train_views,allowed)
    held = contextual_rows(test,test_views,allowed)
    if all(len(np.unique(train[:, i])) == 1 for i in range(train.shape[1])):
        return {"status": "constant_features"}, None
    y = labels.numpy().astype(int)
    encoder = OneHotEncoder(handle_unknown="ignore", dtype=np.float32)
    sparse_train = encoder.fit_transform(train)
    sparse_test = encoder.transform(held)
    scores = {}
    for name, model in (
        ("LightGBM", LGBMClassifier(n_estimators=80, num_leaves=15, n_jobs=2, random_state=seed, verbosity=-1)),
        ("XGBoost", XGBClassifier(n_estimators=80, max_depth=4, n_jobs=2, random_state=seed)),
    ):
        model.fit(sparse_train, y)
        scores[name] = metrics(test_labels, model.predict_proba(sparse_test)[:, 1])
    cat = CatBoostClassifier(iterations=100, depth=4, thread_count=2, random_seed=seed,
                             verbose=False, allow_writing_files=False)
    categorical = list(range(len(fields)))
    cat.fit(Pool(train, y, cat_features=categorical))
    pool = Pool(held, cat_features=categorical)
    scores["CatBoost"] = metrics(test_labels, cat.predict_proba(pool)[:, 1])
    # Bound SHAP computation on a deterministic sample spread across the test window.
    indices = np.linspace(0, len(held) - 1, min(512, len(held)), dtype=int)
    contributions = cat.get_feature_importance(Pool(held[indices], cat_features=categorical),
                                               type="ShapValues", thread_count=2)
    importance = dict(zip(fields, np.abs(contributions[:, :-1]).mean(axis=0).tolist()))
    with TemporaryDirectory() as tmp:
        path = Path(tmp) / "model.cbm"
        cat.save_model(str(path))
        blob = path.read_bytes()
    return {"status": "evaluated", "metrics": scores, "mean_absolute_shap": importance,"scenario_defaults": defaults,"element_defaults":element_defaults,"context_allowed":allowed}, blob


def score_rows(blob, ids, contexts, allowed):
    """Batch CatBoost probabilities for encoded features plus context, mapped exactly as in training."""
    model = CatBoostClassifier(thread_count=2)
    model.load_model(blob=blob)
    rows = [[str(i) for i in row] + [value if value in allowed.get(f, ()) else "unknown" for value, f in zip(context, CONTEXT_FIELDS)]
            for row, context in zip(ids, contexts)]
    pool = Pool(rows, cat_features=list(range(len(rows[0]))))
    return model.predict_proba(pool)[:, 1].tolist()


def estimate(blob, ids, fields):
    model = CatBoostClassifier(thread_count=2)
    model.load_model(blob=blob)
    pool = Pool([[str(i) for i in ids]], cat_features=list(range(len(fields))))
    shap = model.get_feature_importance(pool, type="ShapValues", thread_count=2)[0]
    return {"probability": float(model.predict_proba(pool)[0, 1]),
            "base_log_odds": float(shap[-1]), "contributions": dict(zip(fields, shap[:-1].tolist()))}

def ranking_benchmark(x, y, tx, ty, training, test, minimum, seed):
    from catboost import CatBoostRanker
    from sklearn.metrics import ndcg_score

    def grouped(tensor, outcomes, views):
        offset, rows, labels, groups = 0, [], [], []
        for view in views:
            size = len(view["examples"])
            group = outcomes[offset:offset+size].tolist()
            # Relative ordering is measurable only within views containing both outcomes.
            if len(set(group)) > 1:
                rows.extend(tensor[offset:offset+size].tolist())
                labels.extend(group)
                groups.append(size)
            offset += size
        return np.asarray(rows).astype(str), labels, groups

    train_x, train_y, sizes = grouped(x, y, training)
    held_x, held_y, held_sizes = grouped(tx, ty, test)
    if min(len(sizes),len(held_sizes)) < minimum or len(set(map(tuple,train_x))) < 2:
        return {"status":"insufficient_informative_views"}, None
    def pool(rows, labels, sizes):
        return Pool(rows, label=labels, group_id=np.repeat(np.arange(len(sizes)),sizes),
                    cat_features=list(range(rows.shape[1])))
    ranker = CatBoostRanker(iterations=80, depth=4, loss_function="YetiRank", thread_count=2,
                            random_seed=seed, verbose=False, allow_writing_files=False)
    ranker.fit(pool(train_x,train_y,sizes))
    predictions = ranker.predict(pool(held_x,held_y,held_sizes))
    offset, scores, baseline = 0, [], []
    for size in held_sizes:
        observed = [held_y[offset:offset+size]]
        scores.append(ndcg_score(observed,[predictions[offset:offset+size]],k=5))
        baseline.append(ndcg_score(observed,[np.ones(size)],k=5))
        offset += size
    with TemporaryDirectory() as tmp:
        file = Path(tmp)/"ranker.cbm"
        ranker.save_model(str(file))
        blob = file.read_bytes()
    return {"status":"evaluated","test_views":len(scores),"ndcg_at_5":float(np.mean(scores)),
            "tied_baseline":float(np.mean(baseline))}, blob

def candidate_scores(blob, ranker_blob, rows, defaults):
    from catboost import CatBoostRanker
    model=CatBoostClassifier(thread_count=2)
    model.load_model(blob=blob)
    extended=[list(map(str,row))+list(context) for row,context in zip(rows,defaults)]
    pool=Pool(extended,cat_features=list(range(len(extended[0]))))
    probs=model.predict_proba(pool)[:,1]
    scores=[None]*len(rows)
    if ranker_blob:
        ranker=CatBoostRanker(thread_count=2)
        ranker.load_model(blob=ranker_blob)
        scores=ranker.predict(Pool(np.asarray(rows).astype(str),cat_features=list(range(len(rows[0]))))).tolist()
    return list(zip(probs.tolist(),scores))
