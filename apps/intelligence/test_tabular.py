import contextlib
import io
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from test_eulernet import dataset
from eulernet import train, predict, model_key


class LocalBenchmarks(unittest.TestCase):
    def test_explain_new_checkpoint_and_reload_it_for_inference(self):
        data = dataset()
        for i, view in enumerate(data["views"]):
            original = view["examples"][0]
            original["prior_elements"]=["footer"]
            view["examples"].append({"features":dict(original["features"],element_id="footer"), "label":1-original["label"]})
            view["examples"][0]["features"]["device"] = "mobile" if i % 3 else "desktop"
        with TemporaryDirectory() as tmp:
            file = Path(tmp) / "data.json"
            file.write_text(json.dumps(data))
            with contextlib.redirect_stdout(io.StringIO()):
                train(SimpleNamespace(dataset=file, data_dir=tmp, epochs=1, width=4, seed=8, tabular=True, deepfm=True, din=True))
            directory = Path(tmp) / "intelligence" / model_key(data["scope"])
            manifest = json.loads((directory / "manifest.json").read_text())
            self.assertEqual(set(manifest["tabular"]["metrics"]), {"CatBoost", "LightGBM", "XGBoost"})
            self.assertEqual(manifest["tabular"]["ranker"]["test_views"],12)
            self.assertTrue(0 <= manifest["tabular"]["deepfm"]["brier"] <= 1)
            self.assertEqual(manifest["tabular"]["population"]["status"],"evaluated")
            self.assertEqual(manifest["tabular"]["din"]["status"],"evaluated")
            req = {"model_id":manifest["model_id"], "features":data["views"][0]["examples"][0]["features"]}
            output = io.StringIO()
            with patch("sys.stdin", io.StringIO(json.dumps(req))), contextlib.redirect_stdout(output):
                predict(SimpleNamespace(model_dir=directory))
            result = json.loads(output.getvalue())["catboost"]
            batch = {"model_id":manifest["model_id"],"candidates":[req["features"],dict(req["features"],element_id="footer")]}
            output = io.StringIO()
            with patch("sys.stdin",io.StringIO(json.dumps(batch))), contextlib.redirect_stdout(output):
                predict(SimpleNamespace(model_dir=directory))
            compared=json.loads(output.getvalue())["elements"]
            self.assertEqual(len(compared),2)
            self.assertIsInstance(compared[0]["ranking_score"],float)
            self.assertAlmostEqual(compared[0]["probability"],result["probability"])
            import math
            raw = result["base_log_odds"] + sum(result["contributions"].values())
            self.assertAlmostEqual(result["probability"], 1/(1+math.exp(-raw)), places=6)
