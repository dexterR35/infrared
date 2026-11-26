"""Post-publication monitoring for a published click or conversion model.

Only views that began after the newest training view are evaluated, so no monitored
example was available when the model was fitted. The report compares the published
model with a constant predictor at the rate known at publication, tests calibration,
and measures feature distribution shift against the training reference.
"""
from collections import Counter
import math

import numpy as np

OTHER = "__other__"
PSI_MODERATE, PSI_MAJOR = 0.1, 0.25
# Population stability on fewer examples is dominated by sampling noise.
MIN_DRIFT_EXAMPLES = 200
CALIBRATION_Z = 3.0
AUC_TOLERANCE = 0.05
UNSEEN_WATCH, UNSEEN_RETRAIN = 0.05, 0.2


def _shares(counts, total):
    return {key: round(n / total, 6) for key, n in sorted(counts.items())} if total else {}


def _context(example, field):
    return example.get("context", {}).get(field, "unknown")


def reference_profile(views, vocabulary, features, context_allowed=None):
    """Category shares in the training partition. Values outside the model's support share one bucket."""
    examples = [e for view in views for e in view["examples"]]
    profile = {}
    for field in features:
        known = set(vocabulary[field])
        profile[field] = _shares(Counter(e["features"][field] if e["features"][field] in known else OTHER
                                         for e in examples), len(examples))
    for field, allowed in (context_allowed or {}).items():
        known = set(allowed) | {"unknown"}
        profile["context." + field] = _shares(Counter(_context(e, field) if _context(e, field) in known else OTHER
                                                      for e in examples), len(examples))
    return {"examples": len(examples), "fields": profile}


def psi(expected, observed_counts, total, epsilon=1e-4):
    """Population stability index with additive flooring for empty categories."""
    value = 0.0
    for key in set(expected) | set(observed_counts):
        e = max(expected.get(key, 0.0), epsilon)
        a = max(observed_counts.get(key, 0) / total, epsilon)
        value += (a - e) * math.log(a / e)
    return float(value)


def drift_report(reference, examples):
    if not reference or not reference.get("fields"):
        return {"status": "no_reference"}
    if not examples:
        return {"status": "low_support", "examples": 0, "fields": {}}
    fields = {}
    for name, expected in reference["fields"].items():
        known = set(expected) - {OTHER}
        if name.startswith("context."):
            field = name[len("context."):]
            values = (_context(e, field) for e in examples)
        else:
            values = (e["features"][name] for e in examples)
        counts = Counter(v if v in known else OTHER for v in values)
        fields[name] = round(psi(expected, counts, len(examples)), 6)
    worst = max(fields, key=lambda k: (fields[k], k)) if fields else None
    return {"status": "evaluated" if len(examples) >= MIN_DRIFT_EXAMPLES else "low_support",
            "examples": len(examples), "fields": fields, "max_field": worst,
            "max_psi": fields[worst] if worst else 0.0}


def _cluster_sums(values, groups):
    """Per-view sums. Exposures within one view are correlated, so views are the independent units."""
    return np.bincount(np.asarray(groups, dtype=int), weights=np.asarray(values, dtype=float))


def cluster_se(values, groups):
    """Standard error of a mean with view-level (cluster-robust) variance and a small-sample correction."""
    v = np.asarray(values, dtype=float)
    used = np.unique(np.asarray(groups, dtype=int))
    if len(v) < 2 or len(used) < 2:
        return math.inf
    sums = _cluster_sums(v - v.mean(), groups)[used]
    k = len(used)
    return float(math.sqrt((sums ** 2).sum() * k / (k - 1)) / len(v))


def calibration_z(labels, probabilities, groups=None):
    """Observed minus predicted totals. The variance is the larger of the binomial and view-clustered estimates."""
    y, p = np.asarray(labels, dtype=float), np.asarray(probabilities, dtype=float)
    groups = np.arange(len(y)) if groups is None else np.asarray(groups, dtype=int)
    residual = y - p
    binomial = float((p * (1 - p)).sum())
    centred = _cluster_sums(residual - residual.mean(), groups)
    k = len(np.unique(groups))
    clustered = float((centred ** 2).sum() * k / (k - 1)) if k > 1 else 0.0
    variance = max(binomial, clustered)
    return float(residual.sum() / math.sqrt(variance)) if variance > 0 else 0.0


def auc_standard_error(auc, positives, negatives):
    """Hanley-McNeil (1982) approximation."""
    q1, q2 = auc / (2 - auc), 2 * auc * auc / (1 + auc)
    variance = (auc * (1 - auc) + (positives - 1) * (q1 - auc * auc) + (negatives - 1) * (q2 - auc * auc)) / (positives * negatives)
    return math.sqrt(max(variance, 0.0))


def _log_loss(y, p):
    p = np.clip(np.asarray(p, dtype=float), 1e-7, 1 - 1e-7)
    return -(y * np.log(p) + (1 - y) * np.log1p(-p))


def model_health(name, labels, probabilities, reference, baseline_rate, metrics, minimum, groups=None):
    current = metrics(labels, probabilities)
    y = np.asarray(labels, dtype=float)
    groups = np.arange(len(y)) if groups is None else np.asarray(groups, dtype=int)
    z = calibration_z(y, probabilities, groups)
    # Paired per-exposure loss difference against the publication-rate predictor.
    difference = _log_loss(y, probabilities) - _log_loss(y, np.full(len(y), baseline_rate))
    se = cluster_se(difference, groups)
    # JSON output forbids infinity; an unestimable error is reported as null.
    lift = {"mean_difference": float(difference.mean()), "standard_error": se if math.isfinite(se) else None}
    findings = []
    if math.isfinite(se) and lift["mean_difference"] - 2 * se > 0:
        findings.append({"code": "NO_LIFT_OVER_BASELINE", "model": name, "value": lift["mean_difference"]})
    elif lift["mean_difference"] >= 0:
        findings.append({"code": "LIFT_UNCERTAIN", "model": name, "value": lift["mean_difference"]})
    if abs(z) > CALIBRATION_Z:
        findings.append({"code": "MISCALIBRATED", "model": name, "value": z})
    positives = int(y.sum())
    negatives = len(y) - positives
    if (reference and reference.get("auc") is not None and current["auc"] is not None
            and min(positives, negatives) >= minimum):
        margin = max(AUC_TOLERANCE, 2 * auc_standard_error(current["auc"], positives, negatives))
        if current["auc"] < reference["auc"] - margin:
            findings.append({"code": "RANKING_DEGRADED", "model": name, "value": current["auc"]})
    return {"metrics": current, "reference": reference, "mean_probability": float(np.mean(probabilities)),
            "calibration_z": z, "lift": lift}, findings


def recommendation(findings, status):
    codes = {f["code"] for f in findings}
    if codes & {"NO_LIFT_OVER_BASELINE", "MISCALIBRATED", "FEATURE_DRIFT_MAJOR", "UNSEEN_ELEMENTS_MAJOR"}:
        return "retrain"
    if codes & {"RANKING_DEGRADED", "LIFT_UNCERTAIN", "FEATURE_DRIFT_MODERATE", "UNSEEN_ELEMENTS"}:
        return "watch"
    return "collect_more_data" if status != "evaluated" else "healthy"


def build_report(manifest, fresh_views, scored, metrics):
    """scored: dict(labels, unseen, models={name: probabilities}, groups=[view index]) for supported examples."""
    examples = [e for view in fresh_views for e in view["examples"]]
    minimum = manifest["minimum_views"]
    evaluation = manifest["evaluation"]
    labels = scored["labels"]
    positives = int(np.sum(labels)) if len(labels) else 0
    negatives = len(labels) - positives
    reference_rate = evaluation["positives"] / evaluation["test_examples"]
    report = {"model_id": manifest["model_id"], "cutoff": scored["cutoff"], "fresh_views": len(fresh_views),
              "fresh_examples": len(examples), "scored_examples": len(labels), "unseen_element_examples": scored["unseen"],
              "positives": positives, "negatives": negatives, "reference_rate": reference_rate,
              "observed_rate": positives / len(labels) if len(labels) else None, "models": {}}
    findings = []
    drift = drift_report(manifest.get("reference"), examples)
    report["drift"] = drift
    if drift["status"] == "evaluated":
        for field, value in sorted(drift["fields"].items()):
            if value >= PSI_MAJOR:
                findings.append({"code": "FEATURE_DRIFT_MAJOR", "field": field, "value": value})
            elif value >= PSI_MODERATE:
                findings.append({"code": "FEATURE_DRIFT_MODERATE", "field": field, "value": value})
    share = scored["unseen"] / len(examples) if examples else 0.0
    if len(examples) >= minimum and share > UNSEEN_RETRAIN:
        findings.append({"code": "UNSEEN_ELEMENTS_MAJOR", "value": share})
    elif len(examples) >= minimum and share > UNSEEN_WATCH:
        findings.append({"code": "UNSEEN_ELEMENTS", "value": share})
    enough = len(fresh_views) >= minimum and positives >= minimum and negatives >= minimum
    report["status"] = "evaluated" if enough else "insufficient_data"
    if enough:
        baseline = metrics(labels, [reference_rate] * len(labels))
        report["baseline"] = baseline
        references = {"eulernet": evaluation["eulernet"],
                      "catboost": ((manifest.get("tabular") or {}).get("metrics") or {}).get("CatBoost")}
        for name, probabilities in scored["models"].items():
            report["models"][name], found = model_health(name, labels, probabilities, references.get(name),
                                                         reference_rate, metrics, minimum, scored.get("groups"))
            findings.extend(found)
    report["findings"] = findings
    report["recommendation"] = recommendation(findings, report["status"])
    return report
