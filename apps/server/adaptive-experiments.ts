import type {DB} from '../../packages/db/index.js';
import {posteriorImprovement} from '../../packages/domain/bayesian-experiment.js';

/** A public campaign within one experiment supplies the context. No visitor features enter the policy. */
export async function treatmentProbability(tx:DB,experiment:{id:string;primary_metric:string;control_variant:string;treatment_variant:string},source:string,campaign:string,version:string,minimum:number){
 // Assignment holds the experiment lock. Freeze each campaign policy for the UTC day.
 const [current]=await tx.query(`SELECT treatment_probability FROM acquisition_visits
  WHERE experiment_id=$1 AND data_source=$2 AND campaign=$3 AND assignment_evidence_version=$4
  AND created_at>=CURRENT_DATE AND treatment_probability IS NOT NULL ORDER BY created_at DESC LIMIT 1`,[experiment.id,source,campaign,version]);
 if(current)return Number(current.treatment_probability);
 const arms=await tx.query<{variant:string;mature:number;successes:number}>(`SELECT v.variant,count(*)::int AS mature,
  count(*) FILTER(WHERE EXISTS(SELECT 1 FROM acquisition_outcomes o WHERE o.visit_id=v.id AND o.kind=$4))::int AS successes
  FROM acquisition_visits v WHERE v.experiment_id=$1 AND v.data_source=$2 AND v.campaign=$3
  AND v.created_at+v.attribution_hours*interval '1 hour'<=CURRENT_DATE GROUP BY v.variant`,[experiment.id,source,campaign,experiment.primary_metric]);
 const a=arms.find(row=>row.variant===experiment.control_variant),b=arms.find(row=>row.variant===experiment.treatment_variant);
 if(!a||!b||Math.min(a.successes,b.successes,a.mature-a.successes,b.mature-b.successes)<minimum)return .5;
 const posterior=posteriorImprovement(a,b)!;
 return Math.min(.9,Math.max(.1,posterior.probability));
}
