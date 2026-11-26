"""Bounded validation-only CatBoost tuning with a local, site-scoped MLflow run history."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import sys

os.environ["MLFLOW_ENABLE_TELEMETRY"]="false"
import mlflow
import optuna
from catboost import CatBoostClassifier, Pool
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from eulernet import FEATURES, validate_dataset, vocabulary_from_views, tensors, check_classes, binary_metrics
from sasrec import split_sequences


def tune(data,root,trials):
    validate_dataset(data)
    if not 1<=trials<=24:
        raise ValueError("Select 1–24 validation trials")
    training,validation,test=split_sequences(data["views"])
    minimum=data["minimum_views"]
    if min(map(len,(training,validation,test)))<minimum:
        raise ValueError("Insufficient views per chronological partition")
    vocab=vocabulary_from_views(training,minimum)
    def pool(views):
        x,y=tensors(views,vocab)
        check_classes(y,minimum,"Partition")
        return Pool(x.numpy().astype(str),label=y.numpy(),cat_features=list(range(len(FEATURES)))),y.tolist()
    train,_=pool(training)
    val,vy=pool(validation)
    def fit(params):
        model=CatBoostClassifier(**params,random_seed=2026,thread_count=2,verbose=False,allow_writing_files=False)
        return model.fit(train)
    def objective(trial):
        model=fit({"depth":trial.suggest_int("depth",2,6),"iterations":trial.suggest_int("iterations",40,160,step=40),
                   "learning_rate":trial.suggest_float("learning_rate",0.02,0.2,log=True)})
        return binary_metrics(vy,model.predict_proba(val)[:,1])["log_loss"]
    scope=hashlib.sha256(json.dumps([data["scope"],data["target"]],sort_keys=True).encode()).hexdigest()
    directory=(Path(root)/scope).resolve()
    directory.mkdir(mode=0o700,parents=True,exist_ok=True)
    mlflow.set_tracking_uri("sqlite:///"+(directory/"runs.sqlite").as_posix())
    experiment=mlflow.get_experiment_by_name("local-validation")
    exp_id=experiment.experiment_id if experiment else mlflow.create_experiment("local-validation",artifact_location=directory.as_uri())
    with mlflow.start_run(experiment_id=exp_id) as run:
        study=optuna.create_study(sampler=optuna.samplers.TPESampler(seed=2026))
        study.optimize(objective,n_trials=trials)
        held,ty=pool(test)
        metrics=binary_metrics(ty,fit(study.best_params).predict_proba(held)[:,1])
        mlflow.log_params(study.best_params)
        mlflow.log_metrics({"validation_log_loss":study.best_value, **{"test_"+k:v for k,v in metrics.items() if v is not None}})
        mlflow.set_tags({"data_source":data["scope"]["data_source"],"evidence_expires_at":data["expires_at"]})
        return {"run_id":run.info.run_id,"target":data["target"],"test":metrics,"params":study.best_params}


if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("dataset",type=Path)
    parser.add_argument("--trials",type=int,default=8)
    parser.add_argument("--output",default=".local/research-history")
    args=parser.parse_args()
    print(json.dumps(tune(json.loads(args.dataset.read_text(encoding="utf-8-sig")),args.output,args.trials),allow_nan=False))
