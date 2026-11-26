from io import BytesIO
from PIL import Image
from experiment import experiment_analysis
from visual import visual_analysis
from unittest.mock import patch
import unittest
import json
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory


class ResearchTests(unittest.TestCase):
    def test_closed_randomized_experiment(self):
        a=dict(mature=100,successes=25,variant="a")
        b=dict(mature=100,successes=50,variant="b")
        data=dict(suppressed=False,pending=0,blockers=[],data_source="seeded",control=a,treatment=b,
                  experiment=dict(status="completed",kind="ab"),device_slices=[dict(**a,device="desktop"),dict(**b,device="desktop")])
        result=experiment_analysis(data)
        self.assertAlmostEqual(result["adjusted_effect_pp"],25,delta=1)
        self.assertEqual([e["device"] for e in result["device_effects"]],["desktop"])
        effect=result["device_effects"][0]
        self.assertAlmostEqual(effect["effect_pp"],25)
        self.assertLess(effect["interval_pp"][0],25)
        self.assertGreater(effect["interval_pp"][1],25)
        self.assertGreater(effect["interval_pp"][0],0)
        data["blockers"]=["ALLOCATION_MISMATCH"]
        with self.assertRaises(ValueError):
            experiment_analysis(data)

    def test_device_effects_skip_thin_segments_and_widen_for_multiplicity(self):
        a=dict(mature=100,successes=20,variant="a")
        b=dict(mature=100,successes=30,variant="b")
        slices=[dict(device="desktop",variant="a",mature=80,successes=16),dict(device="desktop",variant="b",mature=80,successes=24),
                dict(device="mobile",variant="a",mature=20,successes=4),dict(device="mobile",variant="b",mature=20,successes=6)]
        data=dict(suppressed=False,pending=0,blockers=[],data_source="seeded",control=a,treatment=b,
                  experiment=dict(status="completed",kind="ab"),device_slices=slices)
        result=experiment_analysis(data)
        # Mobile has fewer than 30 units per arm and is not reported.
        self.assertEqual([e["device"] for e in result["device_effects"]],["desktop"])
        from experiment import wilson
        self.assertLess(wilson(5,10,2.24)[0],wilson(5,10,1.96)[0])

    @patch("visual.model_path",return_value=None)
    @patch.dict("os.environ",INFRARED_OCR="off")
    def test_flat_reference_has_no_saliency(self,_):
        buffer=BytesIO()
        Image.new("RGB",(64,64),"black").save(buffer,"PNG")
        self.assertIsNone(visual_analysis(buffer.getvalue())["predicted_saliency_quarters"])

    def test_optuna_and_local_mlflow_roundtrip(self):
        sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
        from test_eulernet import dataset
        data=dataset()
        for i,view in enumerate(data["views"]):
            view["examples"][0]["features"]["device"]="desktop" if i%3 else "mobile"
        with TemporaryDirectory() as tmp:
            source=Path(tmp)/"examples.json"
            source.write_text(json.dumps(data))
            result=subprocess.run([sys.executable,str(Path(__file__).with_name("tune.py")),str(source),
                                   "--trials","1","--output",tmp],check=True,capture_output=True,text=True,timeout=90)
            self.assertEqual(len(json.loads(result.stdout)["run_id"]),32)
            self.assertEqual(len(list(Path(tmp).rglob("runs.sqlite"))),1)

    @patch("visual.model_path",return_value=None)
    @patch.dict("os.environ",INFRARED_OCR="off",INFRARED_RESEARCH_TOKEN="test-token-for-isolated-research-process")
    def test_authenticated_fastapi_reference(self,_):
        from fastapi.testclient import TestClient
        from service import app
        buf=BytesIO()
        Image.new("RGB",(20,20),"white").save(buf,"PNG")
        with TestClient(app) as client:
            self.assertEqual(client.post("/reference",content=buf.getvalue()).status_code,403)
            reply=client.post("/reference",content=buf.getvalue(),headers={"Authorization":"Bearer test-token-for-isolated-research-process"})
            self.assertEqual(reply.status_code,200)
            self.assertIsNone(reply.json()["predicted_saliency_quarters"])
