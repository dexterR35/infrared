import contextlib
from datetime import datetime, timedelta, timezone
import io
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import torch

from eulernet import EulerNet, Logistic, optimize, binary_metrics, fit_calibration, train, predict, model_key, validate_dataset, vocabulary_from_views


def dataset():
    now = datetime.now(timezone.utc)
    scope = dict(site_id="fixture", page_key="page", data_source="seeded", revision="v1", variant="control", locale="en", state="public", registry_hash="fixture", data_version="initial")
    features = dict(element_id="hero", device="desktop", previous_action="page_view", recent_clicks="0", recent_activations="0", recent_length="0-4")
    return dict(schema_version=1, model="EulerNet", environment="synthetic", feature_schema_version=1, target="qualified_exposure_click_30s", horizon_ms=30000,
                scope=scope, exported_at=now.isoformat(), expires_at=(now + timedelta(days=2)).isoformat(), minimum_views=1,
                views=[dict(started_at=(now - timedelta(hours=90 - i)).isoformat(), ended_at=(now - timedelta(hours=90 - i) + timedelta(seconds=35)).isoformat(),
                            examples=[dict(features=dict(features), label=i % 2)]) for i in range(80)])


class EulerTests(unittest.TestCase):
    def test_learns_a_feature_interaction_that_additive_logistic_cannot(self):
        # XOR is a controlled capability check, not a real-traffic benchmark.
        torch.manual_seed(11)
        x = torch.tensor([[1, 1, 1, 1, 1, 1], [1, 1, 2, 1, 1, 1],
                          [1, 2, 1, 1, 1, 1], [1, 2, 2, 1, 1, 1]] * 24)
        y = torch.tensor([0., 1., 1., 0.] * 24)
        sizes = [1, 2, 2, 1, 1, 1]
        euler = optimize(EulerNet(sizes, width=4), x, y, x[:4], y[:4], 40)
        logistic = optimize(Logistic(sizes), x, y, x[:4], y[:4], 40)
        with torch.inference_mode():
            euler_loss = torch.nn.functional.binary_cross_entropy_with_logits(euler(x[:4]), y[:4])
            linear_loss = torch.nn.functional.binary_cross_entropy_with_logits(logistic(x[:4]), y[:4])
        self.assertLess(euler_loss, 0.15)
        self.assertGreater(linear_loss, 0.6)

    def test_complex_interaction_has_finite_gradients(self):
        torch.manual_seed(2)
        model = EulerNet([2] * 6, width=4)
        loss = model(torch.tensor([[1] * 6, [2] * 6])).square().mean()
        loss.backward()
        self.assertTrue(torch.isfinite(loss))
        self.assertTrue(all(p.grad is not None and torch.isfinite(p.grad).all() for p in model.parameters()))
        self.assertTrue(model.interactions[0].orders.grad.abs().sum() > 0)

    def test_binary_metrics_ties_and_perfect_order(self):
        tied = binary_metrics([0, 1], [0.5, 0.5])
        self.assertEqual(tied["auc"], 0.5)
        self.assertAlmostEqual(tied["brier"], 0.25)
        self.assertAlmostEqual(tied["log_loss"], 0.69314718)
        self.assertEqual(binary_metrics([0, 1, 0, 1], [0.1, 0.9, 0.2, 0.8])["auc"], 1)

    def test_calibration_improves_overconfident_constant(self):
        logits, labels = torch.ones(20) * 5, torch.tensor([0., 1.] * 10)
        calibration = fit_calibration(logits, labels)
        before = torch.nn.functional.binary_cross_entropy_with_logits(logits, labels)
        after = torch.nn.functional.binary_cross_entropy_with_logits(logits * calibration["scale"] + calibration["bias"], labels)
        self.assertLess(after, before)
        self.assertGreater(calibration["scale"], 0)

    def test_expiry_and_training_only_vocabulary(self):
        data = dataset()
        data["views"][-1]["examples"][0]["features"]["previous_action"] = "test-only"
        self.assertNotIn("test-only", vocabulary_from_views(data["views"][:50], 1)["previous_action"])
        data["expires_at"] = "2000-01-01T00:00:00Z"
        with self.assertRaisesRegex(ValueError, "expired"):
            validate_dataset(data)

    def test_real_train_calibrate_predict_and_class_gate(self):
        with tempfile.TemporaryDirectory() as root:
            data = dataset()
            source = Path(root) / "dataset.json"
            source.write_text(json.dumps(data), encoding="utf-8")
            args = SimpleNamespace(dataset=str(source), data_dir=root, epochs=2, seed=42, width=4)
            with contextlib.redirect_stdout(io.StringIO()):
                train(args)
            directory = Path(root) / "intelligence" / model_key(data["scope"])
            manifest = json.loads((directory / "manifest.json").read_text())
            self.assertEqual(manifest["validation_state"], "fixture_only")
            self.assertEqual(manifest["evaluation"]["test_views"], 12)
            request = dict(features=data["views"][0]["examples"][0]["features"], model_id=manifest["model_id"])
            output = io.StringIO()
            with patch("sys.stdin", io.StringIO(json.dumps(request))), contextlib.redirect_stdout(output):
                predict(SimpleNamespace(model_dir=directory))
            result = json.loads(output.getvalue())
            self.assertTrue(0 < result["probability"] < 1)
            self.assertEqual(result["element_id"], "hero")
            for view in data["views"]:
                view["examples"][0]["label"] = 1
            source.write_text(json.dumps(data), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "negative"):
                train(args)


if __name__ == "__main__":
    unittest.main()
