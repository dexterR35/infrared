"""Infrared's independent PyTorch adaptation of EulerNet (Tian et al., SIGIR 2023).

Implements complex polar feature interactions plus implicit real/imaginary paths.
Reference: https://arxiv.org/abs/2304.10711 . No upstream source is vendored.
"""
import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
import math
import os
from pathlib import Path
import random
import sys
import uuid

import numpy as np
import torch
from torch import nn
from torch.nn import functional as F

from sasrec import split_sequences, timestamp

FEATURES = ("element_id", "device", "previous_action", "recent_clicks", "recent_activations", "recent_length")
TARGET = "qualified_exposure_click_30s"
CONVERSION_TARGET = "qualified_exposure_primary_action_30s"


class ComplexInteraction(nn.Module):
    def __init__(self, fields, outputs, width):
        super().__init__()
        self.width, self.outputs = width, outputs
        self.orders = nn.Parameter(torch.softmax(torch.randn(fields, outputs) * 10, dim=0))
        self.radius_bias = nn.Parameter(torch.zeros(outputs, width))
        self.phase_bias = nn.Parameter(torch.zeros(outputs, width))
        self.implicit = nn.Linear(fields * width, outputs * width)
        self.real_norm, self.imag_norm = nn.LayerNorm(width), nn.LayerNorm(width)
        self.dropout = nn.Dropout(0.1)

    def forward(self, real, imag):
        # Polar multiplication: log magnitudes and angles mix linearly with
        # learned real-valued orders; the Cartesian path captures implicit terms.
        log_radius = 0.5 * torch.log(real.square() + imag.square() + 1e-8)
        phase = torch.atan2(imag, real)
        radius = torch.exp((torch.einsum("bfw,fo->bow", self.dropout(log_radius), self.orders) + self.radius_bias).clamp(-10, 10))
        angle = torch.einsum("bfw,fo->bow", self.dropout(phase), self.orders) + self.phase_bias
        implicit_real = F.relu(self.implicit(self.dropout(real).flatten(1))).reshape(-1, self.outputs, self.width)
        implicit_imag = F.relu(self.implicit(self.dropout(imag).flatten(1))).reshape(-1, self.outputs, self.width)
        return self.real_norm(radius * torch.cos(angle) + implicit_real), self.imag_norm(radius * torch.sin(angle) + implicit_imag)


class EulerNet(nn.Module):
    def __init__(self, sizes, width=8, orders=8):
        super().__init__()
        self.embeddings = nn.ModuleList([nn.Embedding(n + 1, width) for n in sizes])
        for embedding in self.embeddings:
            nn.init.normal_(embedding.weight, std=0.05)
        self.log_amplitude = nn.Parameter(torch.zeros(len(sizes), 1))
        self.interactions = nn.ModuleList([ComplexInteraction(len(sizes), orders, width), ComplexInteraction(orders, orders, width)])
        self.readout = nn.Linear(orders * width, 1)

    def forward(self, ids):
        angle = torch.stack([embedding(ids[:, i]) for i, embedding in enumerate(self.embeddings)], dim=1)
        amplitude = self.log_amplitude.clamp(-10, 10).exp()
        real, imag = amplitude * angle.cos(), amplitude * angle.sin()
        for layer in self.interactions:
            real, imag = layer(real, imag)
        return self.readout((real + imag).flatten(1)).squeeze(-1)


class Logistic(nn.Module):
    def __init__(self, sizes):
        super().__init__()
        self.weights = nn.ModuleList([nn.Embedding(n + 1, 1) for n in sizes])
        self.bias = nn.Parameter(torch.zeros(()))
        for weight in self.weights:
            nn.init.zeros_(weight.weight)

    def forward(self, ids):
        return sum(weight(ids[:, i]).squeeze(-1) for i, weight in enumerate(self.weights)) + self.bias


def model_key(scope, target=TARGET):
    values = ["EulerNetConversion" if target == CONVERSION_TARGET else "EulerNet"] + [scope[k] for k in ("site_id", "page_key", "data_source", "revision", "variant")]
    return hashlib.sha256(json.dumps(values, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()


def vocabulary_from_views(views, minimum):
    support = {field: Counter() for field in FEATURES}
    for view in views:
        for field in FEATURES:
            support[field].update({e["features"][field] for e in view["examples"]})
    return {field: sorted(value for value, count in support[field].items() if count >= minimum) for field in FEATURES}


def encode(features, vocabulary):
    return [vocabulary[field].index(features[field]) + 1 if features[field] in vocabulary[field] else 0 for field in FEATURES]


def tensors(views, vocabulary):
    examples = [e for view in views for e in view["examples"]]
    if any(e["features"]["element_id"] not in vocabulary["element_id"] for e in examples):
        raise ValueError("An evaluation element lacks training support; collect more examples for the same registry")
    return torch.tensor([encode(e["features"], vocabulary) for e in examples], dtype=torch.long), torch.tensor([e["label"] for e in examples], dtype=torch.float32)


def binary_metrics(labels, probabilities):
    y = np.asarray(labels, dtype=float)
    p = np.clip(np.asarray(probabilities, dtype=float), 1e-7, 1 - 1e-7)
    ece = 0.0
    for bucket in range(10):
        chosen = (p >= bucket / 10) & (p < (bucket + 1) / 10)
        if chosen.any():
            ece += chosen.mean() * abs(y[chosen].mean() - p[chosen].mean())
    positives, negatives = int(y.sum()), int(len(y) - y.sum())
    auc = None
    if positives and negatives:
        order = np.argsort(p, kind="stable")
        positive_rank_sum, start = 0.0, 0
        while start < len(order):
            end = start + 1
            while end < len(order) and p[order[end]] == p[order[start]]:
                end += 1
            positive_rank_sum += y[order[start:end]].sum() * ((start + 1 + end) / 2)
            start = end
        auc = float((positive_rank_sum - positives * (positives + 1) / 2) / (positives * negatives))
    return dict(log_loss=float(-(y * np.log(p) + (1 - y) * np.log1p(-p)).mean()),
                brier=float(np.square(p - y).mean()), ece=float(ece), auc=auc)


def check_classes(labels, minimum, partition):
    positive = int(labels.sum().item())
    if positive < minimum or len(labels) - positive < minimum:
        raise ValueError(f"{partition} requires at least {minimum} positive and {minimum} negative fully observed examples")


def optimize(model, train_x, train_y, val_x, val_y, epochs, progress=None, phase="eulernet"):
    optimizer = torch.optim.AdamW(model.parameters(), lr=0.005, weight_decay=1e-5)
    best, state = float("inf"), None
    for epoch in range(epochs):
        model.train()
        order = torch.randperm(len(train_y))
        total_loss = 0.0
        for chunk in order.split(64):
            x = train_x[chunk].clone()
            # Reserve index zero for sparse/unseen context, never for an element.
            x[:, 1:] = x[:, 1:].masked_fill(torch.rand(x[:, 1:].shape) < 0.1, 0)
            optimizer.zero_grad()
            loss = F.binary_cross_entropy_with_logits(model(x), train_y[chunk])
            if not torch.isfinite(loss):
                raise ValueError("Nonfinite training loss; no checkpoint was published")
            loss.backward()
            nn.utils.clip_grad_norm_(model.parameters(), 5)
            optimizer.step()
            total_loss += float(loss.detach()) * len(chunk)
        model.eval()
        with torch.inference_mode():
            score = F.binary_cross_entropy_with_logits(model(val_x), val_y).item()
        if progress:
            progress(dict(phase=phase, epoch=epoch + 1, epochs=epochs,
                          loss=total_loss / len(train_y), validation_loss=score))
        if score < best:
            best, state = score, {k: v.detach().clone() for k, v in model.state_dict().items()}
    model.load_state_dict(state)
    model.eval()
    return model


def fit_calibration(logits, labels):
    """Monotone Platt scaling, fit only on validation observations."""
    log_scale, bias = torch.zeros((), requires_grad=True), torch.zeros((), requires_grad=True)
    optimizer = torch.optim.Adam([log_scale, bias], lr=0.03)
    logits = logits.detach().clone()
    for _ in range(150):
        optimizer.zero_grad()
        loss = F.binary_cross_entropy_with_logits(logits * log_scale.clamp(-4, 4).exp() + bias, labels)
        loss.backward()
        optimizer.step()
    return dict(scale=float(log_scale.detach().clamp(-4, 4).exp()), bias=float(bias.detach()))


def validate_dataset(data):
    if data.get("schema_version") != 1 or data.get("model") != "EulerNet" or data.get("feature_schema_version") != 1 or data.get("target") not in (TARGET, CONVERSION_TARGET) or data.get("horizon_ms") != 30000:
        raise ValueError("Unsupported EulerNet dataset contract")
    if data["target"] == CONVERSION_TARGET and not data.get("primary_action_id"):
        raise ValueError("A registered primary conversion action is required")
    if data.get("environment") not in ("synthetic", "real") or data["scope"]["data_source"] not in ("recorded", "seeded") or timestamp(data["expires_at"]) <= datetime.now(timezone.utc).timestamp():
        raise ValueError("Dataset is expired or has an unclassified source")
    if not isinstance(data["minimum_views"], int) or data["minimum_views"] < 1:
        raise ValueError("Invalid minimum cohort")
    for view in data["views"]:
        if not view["examples"] or timestamp(view["started_at"]) > timestamp(view["ended_at"]) or timestamp(view["ended_at"]) > timestamp(data["exported_at"]):
            raise ValueError("Invalid observation window")
        for example in view["examples"]:
            if example["label"] not in (0, 1) or set(example["features"]) != set(FEATURES) or any(not isinstance(v, str) or len(v) > 150 for v in example["features"].values()):
                raise ValueError("Invalid training example")


def train(args):
    random.seed(args.seed)
    torch.manual_seed(args.seed)
    torch.use_deterministic_algorithms(True)
    data = json.loads(Path(args.dataset).read_text(encoding="utf-8-sig"))
    validate_dataset(data)
    training, validation, test = split_sequences(data["views"])
    minimum = data["minimum_views"]
    if min(len(training), len(validation), len(test)) < minimum:
        raise ValueError("Each chronological partition must meet the minimum view cohort")
    for partition in (training,validation,test):
        if min(sum(any(e["label"]==label for e in view["examples"]) for view in partition) for label in (0,1))<minimum:
            raise ValueError("Each partition requires positive and negative support across distinct views")
    vocabulary = vocabulary_from_views(training, minimum)
    if any(not vocabulary[field] for field in FEATURES):
        raise ValueError("Insufficient distinct-view training support for a feature")
    x, y = tensors(training, vocabulary)
    vx, vy = tensors(validation, vocabulary)
    tx, ty = tensors(test, vocabulary)
    for labels, name in ((y, "Training"), (vy, "Validation"), (ty, "Test")):
        check_classes(labels, minimum, name)
    settings = dict(sizes=[len(vocabulary[field]) for field in FEATURES], width=args.width, orders=8)
    history = []
    def progress(point):
        history.append(point)
        if getattr(args, "progress", False):
            print(json.dumps(dict(event="progress", **point), allow_nan=False), flush=True)
    model = optimize(EulerNet(**settings), x, y, vx, vy, args.epochs, progress)
    logistic = optimize(Logistic(settings["sizes"]), x, y, vx, vy, args.epochs, progress, "logistic")
    with torch.inference_mode():
        validation_logits, logistic_validation = model(vx), logistic(vx)
    calibration = fit_calibration(validation_logits, vy)
    logistic_calibration = fit_calibration(logistic_validation, vy)
    with torch.inference_mode():
        p = torch.sigmoid(model(tx) * calibration["scale"] + calibration["bias"]).tolist()
        lp = torch.sigmoid(logistic(tx) * logistic_calibration["scale"] + logistic_calibration["bias"]).tolist()
    labels = ty.tolist()
    evaluation = dict(test_views=len(test), test_examples=len(labels), positives=int(ty.sum()), negatives=int(len(ty) - ty.sum()),
                      eulernet=binary_metrics(labels, p), logistic=binary_metrics(labels, lp),
                      constant=binary_metrics(labels, [float(y.mean())] * len(labels)))
    tabular, blob, ranker_blob = None, None, None
    if getattr(args, "tabular", False):
        from population import population_report
        from tabular import benchmark, ranking_benchmark
        tabular, blob = benchmark(x, tx, y, labels, FEATURES, args.seed, binary_metrics, training, test, minimum)
        tabular["ranker"], ranker_blob = ranking_benchmark(x, y, tx, ty, training, test, minimum, args.seed)
        if getattr(args, "deepfm", False):
            from deepfm import DeepFM
            deep = optimize(DeepFM(settings["sizes"]), x, y, vx, vy, args.epochs)
            with torch.inference_mode():
                tabular["deepfm"] = binary_metrics(labels, torch.sigmoid(deep(tx)).tolist())
        if getattr(args, "din", False):
            from din import evaluate
            tabular["din"] = evaluate(x,y,vx,vy,tx,ty,training,validation,test,vocabulary,FEATURES,args.epochs,binary_metrics,minimum)
        tabular["population"] = population_report(training, test, minimum, args.seed)
    checked = evaluation["eulernet"]["log_loss"] < min(evaluation[k]["log_loss"] for k in ("logistic", "constant")) and evaluation["eulernet"]["ece"] <= 0.1
    state = "fixture_only" if data["scope"]["data_source"] == "seeded" or data["environment"] == "synthetic" else "passes_offline_checks" if checked else "needs_review"
    if tabular and tabular.get("status") == "evaluated":
        metrics = tabular["metrics"]["CatBoost"]
        passes = metrics["log_loss"] < min(evaluation[k]["log_loss"] for k in ("logistic","constant")) and metrics["ece"] <= 0.1
        tabular["validation_state"] = "fixture_only" if state == "fixture_only" else "passes_offline_checks" if passes else "needs_review"
    from monitoring import reference_profile
    allowed = tabular.get("context_allowed") if tabular and tabular.get("status") == "evaluated" else None
    reference = reference_profile(training, vocabulary, FEATURES, allowed)
    model_id = str(uuid.uuid4())
    manifest = dict(schema_version=1, model="EulerNet", model_id=model_id, scope=data["scope"], environment=data["environment"],
                    created_at=datetime.now(timezone.utc).isoformat(), expires_at=data["expires_at"],
                    oldest_started_at=min(v["started_at"] for v in data["views"]),
                    newest_started_at=max((v["started_at"] for v in data["views"]), key=timestamp), minimum_views=minimum, reference=reference,
                    feature_schema_version=1, target=data["target"], primary_action_id=data.get("primary_action_id"), horizon_ms=30000, vocabulary=vocabulary,
                    evaluation=evaluation, validation_state=state, tabular=tabular,
                    training=dict(views=len(training), validation_views=len(validation), seed=args.seed, epochs=args.epochs,
                                  split="chronological whole-view 70/15/15 with overlap purge", calibration="validation-only monotone Platt scaling", history=history))
    directory = Path(args.output_dir) if getattr(args, "output_dir", None) else Path(args.data_dir) / "intelligence" / model_key(data["scope"], data["target"])
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    weights_tmp, manifest_tmp = directory / (model_id + ".pt.tmp"), directory / (model_id + ".json.tmp")
    with os.fdopen(os.open(weights_tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "wb") as output:
        torch.save(dict(model_id=model_id, settings=settings, state_dict=model.state_dict(), calibration=calibration, catboost=blob, ranker=ranker_blob), output)
    with os.fdopen(os.open(manifest_tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "w", encoding="utf-8") as output:
        output.write(json.dumps(manifest, allow_nan=False, indent=2))
    os.replace(weights_tmp, directory / "model.pt")
    os.replace(manifest_tmp, directory / "manifest.json")
    if not getattr(args, "output_dir", None):
        (directory / "active.json").unlink(missing_ok=True)
    print(json.dumps(dict(model_directory=str(directory), model_id=model_id, evaluation=evaluation, validation_state=state)))


@torch.inference_mode()
def predict(args):
    directory = Path(args.model_dir)
    manifest = json.loads((directory / "manifest.json").read_text(encoding="utf-8"))
    request = json.load(sys.stdin)
    if timestamp(manifest["expires_at"]) <= datetime.now(timezone.utc).timestamp() or request["model_id"] != manifest["model_id"]:
        raise ValueError("Expired or changed model")
    checkpoint = torch.load(directory / "model.pt", map_location="cpu", weights_only=True)
    if checkpoint["model_id"] != manifest["model_id"]:
        raise ValueError("Model publication in progress")
    report=manifest.get("tabular") or {}
    def scenario(row):
        return {**report.get("scenario_defaults",{}),**report.get("element_defaults",{}).get(row["element_id"],{})}
    if "candidates" in request:
        candidates=request["candidates"]
        if not checkpoint.get("catboost") or not 1<=len(candidates)<=200:
            raise ValueError("No compatible element model or candidates")
        if any(set(row)!=set(FEATURES) or row["element_id"] not in manifest["vocabulary"]["element_id"] for row in candidates):
            raise ValueError("Unknown exposure element")
        from tabular import candidate_scores
        scores=candidate_scores(checkpoint["catboost"],checkpoint.get("ranker"),
                                [encode(row,manifest["vocabulary"]) for row in candidates],[scenario(row).values() for row in candidates])
        print(json.dumps(dict(model_id=manifest["model_id"],elements=[
            dict(element_id=row["element_id"],probability=p,ranking_score=score)
            for row,(p,score) in zip(candidates,scores)]),allow_nan=False))
        return
    features = request["features"]
    if set(features) != set(FEATURES) or features["element_id"] not in manifest["vocabulary"]["element_id"]:
        raise ValueError("Unknown exposure element")
    model = EulerNet(**checkpoint["settings"])
    model.load_state_dict(checkpoint["state_dict"])
    model.eval()
    scale, bias = checkpoint["calibration"]["scale"], checkpoint["calibration"]["bias"]
    probability = float(torch.sigmoid(model(torch.tensor([encode(features, manifest["vocabulary"])])) * scale + bias)[0])
    unknown = [field for field in FEATURES if features[field] not in manifest["vocabulary"][field]]
    tabular = None
    if checkpoint.get("catboost"):
        from tabular import estimate
        defaults=scenario(features)
        tabular = estimate(checkpoint["catboost"], encode(features, manifest["vocabulary"])+list(defaults.values()), FEATURES+tuple(defaults))
        tabular["scenario_defaults"]=defaults
        tabular["validation_state"]=manifest["tabular"].get("validation_state","needs_review")
    print(json.dumps(dict(model_id=manifest["model_id"], catboost=tabular, element_id=features["element_id"], probability=probability, unseen_context=unknown), allow_nan=False))


@torch.inference_mode()
def monitor(args):
    """Evaluate the published model on views that began after its newest training view."""
    from monitoring import build_report
    directory = Path(args.model_dir)
    manifest = json.loads((directory / "manifest.json").read_text(encoding="utf-8"))
    request = json.load(sys.stdin)
    data = request["dataset"]
    if request["model_id"] != manifest["model_id"] or data["target"] != manifest["target"]:
        raise ValueError("Changed model or target")
    if any(data["scope"].get(k) != manifest["scope"].get(k) for k in ("site_id", "page_key", "data_source", "revision", "variant", "registry_hash")):
        raise ValueError("Monitoring data belongs to a different scope")
    checkpoint = torch.load(directory / "model.pt", map_location="cpu", weights_only=True)
    if checkpoint["model_id"] != manifest["model_id"]:
        raise ValueError("Model publication in progress")
    cutoff = manifest.get("newest_started_at") or manifest["created_at"]
    fresh = [v for v in data["views"] if timestamp(v["started_at"]) > timestamp(cutoff)]
    vocabulary = manifest["vocabulary"]
    pairs = [(index, e) for index, v in enumerate(fresh) for e in v["examples"] if e["features"]["element_id"] in vocabulary["element_id"]]
    supported = [e for _, e in pairs]
    unseen = sum(len(v["examples"]) for v in fresh) - len(supported)
    scored = dict(cutoff=cutoff, unseen=unseen, labels=[e["label"] for e in supported], groups=[i for i, _ in pairs], models={})
    if supported:
        ids = [encode(e["features"], vocabulary) for e in supported]
        model = EulerNet(**checkpoint["settings"])
        model.load_state_dict(checkpoint["state_dict"])
        model.eval()
        scale, bias = checkpoint["calibration"]["scale"], checkpoint["calibration"]["bias"]
        scored["models"]["eulernet"] = torch.sigmoid(model(torch.tensor(ids)) * scale + bias).tolist()
        tabular = manifest.get("tabular") or {}
        if checkpoint.get("catboost") and tabular.get("status") == "evaluated":
            from tabular import CONTEXT_FIELDS, score_rows
            allowed = tabular.get("context_allowed")
            contexts = [[e.get("context", {}).get(f, "unknown") for f in CONTEXT_FIELDS] for e in supported]
            if allowed is None:
                # Older checkpoints did not record context support. Fall back to CatBoost's own unseen-category handling.
                allowed = {f: {row[i] for row in contexts} for i, f in enumerate(CONTEXT_FIELDS)}
            scored["models"]["catboost"] = score_rows(checkpoint["catboost"], ids, contexts, allowed)
    print(json.dumps(build_report(manifest, fresh, scored, binary_metrics), allow_nan=False))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    training = commands.add_parser("train")
    training.add_argument("--dataset", required=True)
    training.add_argument("--data-dir", default=os.environ.get("DATA_DIR", ".local"))
    training.add_argument("--epochs", type=int, default=30)
    training.add_argument("--width", type=int, default=8)
    training.add_argument("--seed", type=int, default=2026)
    training.add_argument("--output-dir")
    training.add_argument("--din", action="store_true", help="Benchmark within-view DIN on retained prior elements")
    training.add_argument("--deepfm", action="store_true", help="Benchmark DeepFM alongside tabular models")
    training.add_argument("--tabular", action="store_true")
    training.add_argument("--progress", action="store_true")
    prediction = commands.add_parser("predict")
    prediction.add_argument("--model-dir", required=True)
    monitoring = commands.add_parser("monitor")
    monitoring.add_argument("--model-dir", required=True)
    args = parser.parse_args()
    if args.command == "train":
        if not 1 <= args.epochs <= 1000 or not 2 <= args.width <= 64:
            parser.error("Invalid training hyperparameters")
        if args.deepfm or args.din:
            args.tabular = True
        train(args)
    elif args.command == "monitor":
        monitor(args)
    else:
        predict(args)


if __name__ == "__main__":
    try:
        main()
    except (ValueError, KeyError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
