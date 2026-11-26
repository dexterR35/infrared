"""Aggregate, offline policy evaluation of an already completed randomized experiment."""
import numpy as np
import polars as pl
import math
from scipy.stats import fisher_exact, norm
from sklearn.dummy import DummyClassifier
from sklearn.linear_model import Ridge
from econml.dml import LinearDML


MIN_SEGMENT_UNITS = 30


def wilson(successes, n, z):
    p = successes / n
    centre = (p + z * z / (2 * n)) / (1 + z * z / n)
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / (1 + z * z / n)
    return centre - half, centre + half


def device_effects(frame, arms):
    """Exploratory per-device uplift with Newcombe hybrid-score intervals, Bonferroni-adjusted across devices."""
    totals = frame.group_by(["device", "variant"]).agg(pl.col("mature").sum(), pl.col("successes").sum())
    cells = {(r["device"], r["variant"]): r for r in totals.to_dicts()}
    eligible = [d for d in sorted({r["device"] for r in totals.to_dicts()})
                if all(cells.get((d, a), {}).get("mature", 0) >= MIN_SEGMENT_UNITS for a in arms)]
    if not eligible:
        return []
    z = float(norm.ppf(1 - 0.025 / len(eligible)))
    effects = []
    for device in eligible:
        c, t = cells[(device, arms[0])], cells[(device, arms[1])]
        p0, p1 = c["successes"] / c["mature"], t["successes"] / t["mature"]
        l0, u0 = wilson(c["successes"], c["mature"], z)
        l1, u1 = wilson(t["successes"], t["mature"], z)
        d = p1 - p0
        effects.append(dict(device=device, units=c["mature"] + t["mature"], control_rate=p0, treatment_rate=p1,
                            effect_pp=100 * d, interval_pp=[100 * (d - math.sqrt((p1 - l1) ** 2 + (u0 - p0) ** 2)),
                                                            100 * (d + math.sqrt((u1 - p1) ** 2 + (p0 - l0) ** 2))]))
    return effects


def experiment_analysis(readout):
    if (readout.get("suppressed", True) or readout.get("blockers") or readout.get("pending") != 0 or
            readout.get("experiment", {}).get("status") != "completed" or
            readout["experiment"].get("kind") != "ab"):
        raise ValueError("A complete randomized A/B readout with closed windows and valid allocation is required")
    if readout.get("data_source") not in ("seeded","recorded"):
        raise ValueError("Unclassified experiment source")
    control, treatment = readout["control"], readout["treatment"]
    arms = [control["variant"], treatment["variant"]]
    if len(set(arms)) != 2:
        raise ValueError("Distinct variants required")
    frame = pl.DataFrame(readout["device_slices"]).select("device","variant","mature","successes")
    if frame.height > 32 or frame.is_empty():
        raise ValueError("Invalid device strata")
    if any(type(n) is not int for key in ("mature","successes") for n in frame[key]) or frame.null_count().sum_horizontal()[0]:
        raise ValueError("Invalid outcome counts")
    if any(row["variant"] not in arms or not 0<=row["successes"]<=row["mature"] for row in frame.to_dicts()):
        raise ValueError("Invalid outcome strata")
    if not 10 <= frame["mature"].sum() <= 100000:
        raise ValueError("Offline analysis supports 10 to 100,000 mature units")
    for arm in (control,treatment):
        scoped=frame.filter(pl.col("variant")==arm["variant"])
        if scoped["mature"].sum()!=arm["mature"] or scoped["successes"].sum()!=arm["successes"] or arm["mature"]<3:
            raise ValueError("Arm totals disagree with the randomized readout")
    # For binary outcomes, counts retain the full joint distribution of device, arm and label.
    # Expansion is transient. No person or session identifiers are reconstructed.
    devices = sorted(set(frame["device"]))
    ys,ts,ws=[],[],[]
    for row in frame.to_dicts():
        count,successes=row["mature"],row["successes"]
        ys.extend([1]*successes+[0]*(count-successes))
        ts.extend([int(row["variant"]==arms[1])]*count)
        ws.extend([devices.index(row["device"])]*count)
    rng=np.random.default_rng(2026)
    order=rng.permutation(len(ys))
    y,t=np.asarray(ys)[order],np.asarray(ts)[order]
    w=np.eye(len(devices))[np.asarray(ws)[order]]
    estimator=LinearDML(model_t=DummyClassifier(strategy="uniform"),model_y=Ridge(),discrete_treatment=True,cv=3,random_state=2026)
    estimator.fit(y,t,W=w)
    lo,hi=estimator.ate_interval()
    table=[[arm["successes"],arm["mature"]-arm["successes"]] for arm in (control,treatment)]
    # Train Thompson sampling on one half, estimate its value on the independently held half
    # by inverse propensity weighting using the original 1:1 randomization.
    order=rng.permutation(len(y))
    values=[]
    vw_values=[]
    from vowpalwabbit import Workspace
    for fit,held in ((order[:len(order)//2],order[len(order)//2:]),(order[len(order)//2:],order[:len(order)//2])):
        # Context is the selected website/page/experiment. All units share the same public context.
        weights=[]
        for a in (0,1):
            outcomes=y[fit][t[fit]==a]
            weights.append(rng.beta(outcomes.sum()+1,len(outcomes)-outcomes.sum()+1,4096))
        p=float(np.mean(weights[1]>weights[0]))
        values.extend(2*y[held]*np.where(t[held]==1,p,1-p))
        # One public page context. Process a bounded randomized sample of training units.
        vw=Workspace("--cb_explore 2 --epsilon 0.2 --random_seed 2026 --quiet")
        try:
            for i in fit[:4096]:
                vw.learn(f"{t[i]+1}:{-int(y[i])}:0.5 |page current")
            probabilities=vw.predict("|page current")
            vw_values.extend(2*y[held]*np.asarray(probabilities)[t[held]])
        finally:
            vw.finish()
    return {"source":readout["data_source"],"units":len(y),"adjusted_effect_pp":100*float(estimator.ate()),
            "interval_pp":[100*float(lo),100*float(hi)],"fisher_p":float(fisher_exact(table).pvalue),
            "offline_thompson_policy_value":float(np.mean(values)),"offline_vw_policy_value":float(np.mean(vw_values)),
            "device_effects":device_effects(frame,arms),"device_effect_level":"family-wise 95% (Bonferroni across reported devices)"}
