import contextlib
from datetime import datetime, timedelta, timezone
import io
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from eulernet import binary_metrics, model_key, monitor, train
import math

import numpy as np

from monitoring import OTHER, auc_standard_error, build_report, calibration_z, cluster_se, drift_report, model_health, psi, recommendation
from test_eulernet import dataset


def fresh_views(count, start, element="hero", device=None, positive_every=2):
    return [dict(started_at=(start + timedelta(minutes=i)).isoformat(),
                 ended_at=(start + timedelta(minutes=i, seconds=35)).isoformat(),
                 examples=[dict(features=dict(element_id=element, device=device or ("tablet" if i % 3 else "desktop"), previous_action="page_view",
                                              recent_clicks="0", recent_activations="0", recent_length="0-4"),
                                label=int(i % positive_every == 0), context=dict(channel="search"))])
            for i in range(count)]


class MonitoringMath(unittest.TestCase):
    def test_psi_is_zero_for_identical_and_large_for_disjoint_distributions(self):
        self.assertAlmostEqual(psi({"a": .5, "b": .5}, {"a": 50, "b": 50}, 100), 0.0)
        self.assertGreater(psi({"a": 1.0}, {"b": 100}, 100), 1.0)

    def test_drift_needs_support_and_a_reference(self):
        self.assertEqual(drift_report(None, [])["status"], "no_reference")
        reference = {"fields": {"device": {"desktop": 1.0}}}
        small = [{"features": {"device": "mobile"}}] * 20
        self.assertEqual(drift_report(reference, small)["status"], "low_support")
        large = drift_report(reference, [{"features": {"device": "mobile"}}] * 250)
        self.assertEqual(large["status"], "evaluated")
        self.assertEqual(large["max_field"], "device")
        # A category unknown to the model is pooled into the shared bucket.
        self.assertGreater(large["fields"]["device"], 0.25)
        self.assertNotIn(OTHER, reference["fields"]["device"])

    def test_recommendation_precedence(self):
        self.assertEqual(recommendation([], "insufficient_data"), "collect_more_data")
        self.assertEqual(recommendation([], "evaluated"), "healthy")
        self.assertEqual(recommendation([{"code": "FEATURE_DRIFT_MODERATE"}], "evaluated"), "watch")
        self.assertEqual(recommendation([{"code": "FEATURE_DRIFT_MODERATE"}, {"code": "MISCALIBRATED"}], "evaluated"), "retrain")

    def test_miscalibration_is_flagged_against_a_constant_baseline(self):
        manifest = {"model_id": "m", "minimum_views": 5, "reference": None,
                    "evaluation": {"positives": 50, "test_examples": 100, "eulernet": {"auc": 0.9}}}
        views = [{"examples": [{"features": {}}]} for _ in range(200)]
        labels = [int(i % 10 == 0) for i in range(200)]
        report = build_report(manifest, views, {"cutoff": "x", "unseen": 0, "labels": labels,
                                                "models": {"eulernet": [0.6] * 200}}, binary_metrics)
        codes = {f["code"] for f in report["findings"]}
        self.assertEqual(report["status"], "evaluated")
        self.assertIn("MISCALIBRATED", codes)
        self.assertEqual(report["recommendation"], "retrain")


class StatisticalSafeguards(unittest.TestCase):
    def test_correlated_exposures_widen_calibration_variance(self):
        # Ten views, each with 20 identical exposures: effectively ten observations, not 200.
        labels = [1] * 60 + [0] * 140
        groups = [i // 20 for i in range(200)]
        p = [0.2] * 200
        independent = calibration_z(labels, p)
        clustered = calibration_z(labels, p, groups)
        self.assertGreater(abs(independent), 3)
        self.assertLess(abs(clustered), abs(independent))

    def test_cluster_se_matches_the_ordinary_standard_error_for_singletons(self):
        values = np.arange(10, dtype=float)
        expected = values.std(ddof=1) / math.sqrt(10)
        self.assertAlmostEqual(cluster_se(values, range(10)), expected)
        self.assertEqual(cluster_se([1.0], [0]), math.inf)

    def test_small_noisy_samples_do_not_trigger_retraining(self):
        rng = np.random.default_rng(3)
        p = rng.uniform(0.3, 0.7, 40)
        labels = (rng.uniform(size=40) < p).astype(int).tolist()
        # Drawn from the model itself, so only noise separates it from the baseline.
        health, findings = model_health("m", labels, p.tolist(), {"auc": 0.95}, 0.5, binary_metrics, 5)
        codes = {f["code"] for f in findings}
        self.assertNotIn("NO_LIFT_OVER_BASELINE", codes)
        self.assertNotIn("MISCALIBRATED", codes)
        self.assertGreater(auc_standard_error(0.8, 20, 20), 0.05)
        json_safe = health["lift"]["standard_error"]
        self.assertTrue(json_safe is None or math.isfinite(json_safe))

    def test_reliably_worse_model_is_flagged(self):
        labels = [i % 2 for i in range(400)]
        # Confidently wrong predictions.
        p = [0.9 if y == 0 else 0.1 for y in labels]
        _, findings = model_health("m", labels, p, None, 0.5, binary_metrics, 5)
        self.assertIn("NO_LIFT_OVER_BASELINE", {f["code"] for f in findings})


class MonitorCommand(unittest.TestCase):
    def train_fixture(self, tmp):
        data = dataset()
        for i, view in enumerate(data["views"]):
            view["examples"][0]["features"]["device"] = "tablet" if i % 3 else "desktop"
        file = Path(tmp) / "data.json"
        file.write_text(json.dumps(data))
        with contextlib.redirect_stdout(io.StringIO()):
            train(SimpleNamespace(dataset=file, data_dir=tmp, epochs=1, width=4, seed=8, tabular=True))
        directory = Path(tmp) / "intelligence" / model_key(data["scope"])
        return data, directory, json.loads((directory / "manifest.json").read_text())

    def run_monitor(self, directory, manifest, data):
        output = io.StringIO()
        request = {"model_id": manifest["model_id"], "dataset": data}
        with patch("sys.stdin", io.StringIO(json.dumps(request))), contextlib.redirect_stdout(output):
            monitor(SimpleNamespace(model_dir=directory))
        return json.loads(output.getvalue())

    def test_only_post_training_views_are_scored_and_shift_is_reported(self):
        with TemporaryDirectory() as tmp:
            data, directory, manifest = self.train_fixture(tmp)
            self.assertIn("newest_started_at", manifest)
            self.assertEqual(set(manifest["reference"]["fields"]["device"]), {"desktop", "tablet"})
            self.assertIn("context_allowed", manifest["tabular"])
            start = datetime.fromisoformat(manifest["newest_started_at"]) + timedelta(minutes=1)
            stable = dict(data, views=data["views"] + fresh_views(240, start))
            report = self.run_monitor(directory, manifest, stable)
            self.assertEqual(report["fresh_views"], 240)
            self.assertEqual(report["status"], "evaluated")
            self.assertEqual(report["drift"]["status"], "evaluated")
            self.assertLess(report["drift"]["fields"]["device"], 0.1)
            self.assertEqual(set(report["models"]), {"eulernet", "catboost"})
            shifted = dict(data, views=fresh_views(150, start, device="mobile") + fresh_views(90, start, element="unseen"))
            report = self.run_monitor(directory, manifest, shifted)
            codes = {f["code"] for f in report["findings"]}
            self.assertEqual(report["unseen_element_examples"], 90)
            self.assertIn("FEATURE_DRIFT_MAJOR", codes)
            self.assertIn("UNSEEN_ELEMENTS_MAJOR", codes)
            self.assertEqual(report["recommendation"], "retrain")

    def test_rejects_data_from_another_scope(self):
        with TemporaryDirectory() as tmp:
            data, directory, manifest = self.train_fixture(tmp)
            other = dict(data, scope=dict(data["scope"], page_key="other"))
            with self.assertRaises(ValueError):
                self.run_monitor(directory, manifest, other)


if __name__ == "__main__":
    unittest.main()
