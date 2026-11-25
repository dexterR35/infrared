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

from sasrec import SASRec, encode, make_vocabulary, supported_training, split_sequences, train, predict, scope_key, validate_dataset


def dataset():
    now = datetime.now(timezone.utc)
    scope = dict(site_id="fixture", page_key="page", data_source="seeded", revision="v1",
                 variant="control", locale="en-GB", state="public", registry_hash="fixture", data_version="initial")
    return dict(schema_version=1, scope=scope, exported_at=now.isoformat(),
                expires_at=(now + timedelta(days=5)).isoformat(), minimum_token_views=1,
                sequences=[dict(started_at=(now - timedelta(hours=50 - i)).isoformat(),
                                ended_at=(now - timedelta(hours=50 - i) + timedelta(seconds=10)).isoformat(),
                                tokens=["page_view", "exposure:hero", "click:hero", "activation:start"])
                           for i in range(40)])


class SequenceTests(unittest.TestCase):
    def test_causal_attention_and_right_padding(self):
        torch.manual_seed(42)
        model = SASRec(5, hidden=8, dropout=0).eval()
        with torch.inference_mode():
            a, b = model(torch.tensor([[1, 2, 3]])), model(torch.tensor([[1, 2, 4]]))
            self.assertTrue(torch.allclose(a[:, :2], b[:, :2], atol=1e-6))
            padded = model(torch.tensor([[1, 2, 0, 0]]))
            self.assertTrue(torch.allclose(a[:, :2], padded[:, :2], atol=1e-6))

    def test_split_purges_overlapping_views(self):
        data = dataset()
        data["sequences"][0]["ended_at"] = data["sequences"][30]["ended_at"]
        training, validation, test = split_sequences(data["sequences"])
        self.assertNotIn(data["sequences"][0], training)
        self.assertLess(max(s["ended_at"] for s in training), min(s["started_at"] for s in validation))
        self.assertLess(max(s["ended_at"] for s in validation), min(s["started_at"] for s in test))
        test[0]["tokens"].append("unseen")
        self.assertNotIn("unseen", make_vocabulary(training, 1))

    def test_unknown_actions_do_not_invent_transitions(self):
        self.assertIsNone(encode(["a", "unknown", "b"], {"a": 1, "b": 2}))
        self.assertEqual(make_vocabulary([{"tokens": ["rare", "rare", "common"]}, {"tokens": ["common"]}], 2), ["common"])
        retained, vocabulary = supported_training([{"tokens": ["common", "rare"]}, {"tokens": ["common"]}], 2)
        self.assertEqual(retained, [])
        self.assertEqual(vocabulary, [])

    def test_expired_dataset_is_rejected(self):
        data = dataset()
        data["expires_at"] = "2000-01-01T00:00:00Z"
        with self.assertRaisesRegex(ValueError, "expired"):
            validate_dataset(data)

    def test_train_publish_and_predict_with_repeats(self):
        with tempfile.TemporaryDirectory() as root:
            data = dataset()
            data["sequences"][-1]["tokens"].append("unseen")
            source = Path(root) / "dataset.json"
            source.write_text(json.dumps(data), encoding="utf-8")
            args = SimpleNamespace(dataset=str(source), data_dir=root, epochs=2, seed=42, hidden=8, max_length=10)
            with contextlib.redirect_stdout(io.StringIO()):
                train(args)
            directory = Path(root) / "intelligence" / scope_key(data["scope"])
            manifest = json.loads((directory / "manifest.json").read_text())
            self.assertEqual(manifest["evaluation"]["unknown_targets"], 1)
            self.assertNotIn("unseen", manifest["vocabulary"])
            request = dict(history=["page_view", "click:hero", "click:hero"], top_k=5, model_id=manifest["model_id"])
            output = io.StringIO()
            with patch("sys.stdin", io.StringIO(json.dumps(request))), contextlib.redirect_stdout(output):
                predict(SimpleNamespace(model_dir=directory))
            result = json.loads(output.getvalue())
            self.assertEqual(result["model_id"], manifest["model_id"])
            self.assertIn("click:hero", [r["action"] for r in result["rankings"]])
            self.assertNotIn("[PAD]", [r["action"] for r in result["rankings"]])
            self.assertTrue(all(torch.isfinite(torch.tensor(r["score"])) for r in result["rankings"]))


if __name__ == "__main__":
    unittest.main()
