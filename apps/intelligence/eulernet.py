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


def model_key(scope):
    values = ["EulerNet"] + [scope[k] for k in ("site_id", "page_key", "data_source", "revision", "variant")]
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


def optimize(model, train_x, train_y, val_x, val_y, epochs):
    optimizer = torch.optim.AdamW(model.parameters(), lr=0.005, weight_decay=1e-5)
    best, state = float("inf"), None
    for _ in range(epochs):
        model.train()
        order = torch.randperm(len(train_y))
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
        model.eval()
        with torch.inference_mode():
            score = F.binary_cross_entropy_with_logits(model(val_x), val_y).item()
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
    if data.get("schema_version") != 1 or data.get("model") != "EulerNet" or data.get("feature_schema_version") != 1 or data.get("target") != TARGET or data.get("horizon_ms") != 30000:
        raise ValueError("Unsupported EulerNet dataset contract")
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
    vocabulary = vocabulary_from_views(training, minimum)
    if any(not vocabulary[field] for field in FEATURES):
        raise ValueError("Insufficient distinct-view training support for a feature")
    x, y = tensors(training, vocabulary)
    vx, vy = tensors(validation, vocabulary)
    tx, ty = tensors(test, vocabulary)
    for labels, name in ((y, "Training"), (vy, "Validation"), (ty, "Test")):
        check_classes(labels, minimum, name)
    settings = dict(sizes=[len(vocabulary[field]) for field in FEATURES], width=args.width, orders=8)
    model = optimize(EulerNet(**settings), x, y, vx, vy, args.epochs)
    logistic = optimize(Logistic(settings["sizes"]), x, y, vx, vy, args.epochs)
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
    checked = evaluation["eulernet"]["log_loss"] < min(evaluation[k]["log_loss"] for k in ("logistic", "constant")) and evaluation["eulernet"]["ece"] <= 0.1
    state = "fixture_only" if data["scope"]["data_source"] == "seeded" or data["environment"] == "synthetic" else "passes_offline_checks" if checked else "needs_review"
    model_id = str(uuid.uuid4())
    manifest = dict(schema_version=1, model="EulerNet", model_id=model_id, scope=data["scope"], environment=data["environment"],
                    created_at=datetime.now(timezone.utc).isoformat(), expires_at=data["expires_at"],
                    oldest_started_at=min(v["started_at"] for v in data["views"]), minimum_views=minimum,
                    feature_schema_version=1, target=TARGET, horizon_ms=30000, vocabulary=vocabulary,
                    evaluation=evaluation, validation_state=state,
                    training=dict(views=len(training), validation_views=len(validation), seed=args.seed, epochs=args.epochs,
                                  split="chronological whole-view 70/15/15 with overlap purge", calibration="validation-only monotone Platt scaling"))
    directory = Path(args.data_dir) / "intelligence" / model_key(data["scope"])
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    weights_tmp, manifest_tmp = directory / (model_id + ".pt.tmp"), directory / (model_id + ".json.tmp")
    with os.fdopen(os.open(weights_tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "wb") as output:
        torch.save(dict(model_id=model_id, settings=settings, state_dict=model.state_dict(), calibration=calibration), output)
    with os.fdopen(os.open(manifest_tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "w", encoding="utf-8") as output:
        output.write(json.dumps(manifest, allow_nan=False, indent=2))
    os.replace(weights_tmp, directory / "model.pt")
    os.replace(manifest_tmp, directory / "manifest.json")
    print(json.dumps(dict(model_directory=str(directory), model_id=model_id, evaluation=evaluation, validation_state=state)))


@torch.inference_mode()
def predict(args):
    directory = Path(args.model_dir)
    manifest = json.loads((directory / "manifest.json").read_text(encoding="utf-8"))
    request = json.load(sys.stdin)
    if timestamp(manifest["expires_at"]) <= datetime.now(timezone.utc).timestamp() or request["model_id"] != manifest["model_id"]:
        raise ValueError("Expired or changed model")
    features = request["features"]
    if set(features) != set(FEATURES) or features["element_id"] not in manifest["vocabulary"]["element_id"]:
        raise ValueError("Unknown exposure element")
    checkpoint = torch.load(directory / "model.pt", map_location="cpu", weights_only=True)
    if checkpoint["model_id"] != manifest["model_id"]:
        raise ValueError("Model publication in progress")
    model = EulerNet(**checkpoint["settings"])
    model.load_state_dict(checkpoint["state_dict"])
    model.eval()
    scale, bias = checkpoint["calibration"]["scale"], checkpoint["calibration"]["bias"]
    probability = float(torch.sigmoid(model(torch.tensor([encode(features, manifest["vocabulary"])])) * scale + bias)[0])
    unknown = [field for field in FEATURES if features[field] not in manifest["vocabulary"][field]]
    print(json.dumps(dict(model_id=manifest["model_id"], element_id=features["element_id"], probability=probability, unseen_context=unknown), allow_nan=False))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    training = commands.add_parser("train")
    training.add_argument("--dataset", required=True)
    training.add_argument("--data-dir", default=os.environ.get("DATA_DIR", ".local"))
    training.add_argument("--epochs", type=int, default=30)
    training.add_argument("--width", type=int, default=8)
    training.add_argument("--seed", type=int, default=2026)
    prediction = commands.add_parser("predict")
    prediction.add_argument("--model-dir", required=True)
    args = parser.parse_args()
    if args.command == "train":
        if not 1 <= args.epochs <= 1000 or not 2 <= args.width <= 64:
            parser.error("Invalid training hyperparameters")
        train(args)
    else:
        predict(args)


if __name__ == "__main__":
    try:
        main()
    except (ValueError, KeyError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
