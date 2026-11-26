"""Aggregate diagnostics for fully observed exposure windows, using view-level features only."""
from collections import Counter

import numpy as np
from sklearn.cluster import HDBSCAN
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import RobustScaler


def profiles(views):
    from datetime import datetime
    return np.asarray([[len(v["examples"]), (datetime.fromisoformat(v["ended_at"]) -
                        datetime.fromisoformat(v["started_at"])).total_seconds()] for v in views])


def population_report(training, test, minimum, seed):
    baseline, recent = profiles(training), profiles(test)
    if len(baseline) < max(20, minimum) or len(recent) < minimum:
        return {"status": "insufficient_views"}
    scaler = RobustScaler().fit(np.log1p(baseline))
    x = scaler.transform(np.log1p(baseline))
    held = scaler.transform(np.log1p(recent))
    forest = IsolationForest(n_estimators=80, n_jobs=2, random_state=seed).fit(x)
    anomalies = int(np.sum(forest.predict(held) < 0))
    # Cap clustering memory and time. Fit on evenly spaced chronological views.
    sample = x[np.linspace(0, len(x)-1, min(len(x), 4000), dtype=int)]
    clusters = HDBSCAN(min_cluster_size=max(5, minimum), n_jobs=2, copy=True).fit_predict(sample) if len(sample)>=max(5,minimum) else []
    counts = Counter(int(k) for k in clusters if k >= 0)
    drift = {}
    for col, name in enumerate(("exposures_per_view", "observed_seconds")):
        edges = np.unique(np.quantile(baseline[:, col], [0.1,0.25,0.5,0.75,0.9]))
        a = np.bincount(np.searchsorted(edges,baseline[:,col]), minlength=len(edges)+1)/len(baseline)
        b = np.bincount(np.searchsorted(edges,recent[:,col]), minlength=len(edges)+1)/len(recent)
        drift[name] = float(np.abs(a-b).sum()/2)
    return {"status":"evaluated", "test_views":len(held),
            "unusual_views": anomalies if min(anomalies,len(held)-anomalies)>=minimum else None,
            "cluster_sizes":sorted((n for n in counts.values() if n>=minimum),reverse=True),
            "cluster_sample":len(sample), "distribution_distance":drift}
