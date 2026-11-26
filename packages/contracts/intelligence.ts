import {Type as T, type Static} from '@sinclair/typebox';

const code=T.String({pattern:'^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,63}$'});
export const intelligenceScopeSchema=T.Object({
 site_id:T.String({minLength:1,maxLength:100}),page_key:code,
 data_source:T.Union([T.Literal('recorded'),T.Literal('seeded')]),revision:code,variant:code,
},{additionalProperties:false});
export const intelligenceDatasetSchema=T.Object({...intelligenceScopeSchema.properties,
 from:T.String({format:'date'}),to:T.String({format:'date'}),
},{additionalProperties:false});
export const intelligencePredictSchema=T.Object({...intelligenceScopeSchema.properties,
 history:T.Array(T.String({minLength:1,maxLength:150}),{minItems:1,maxItems:50}),
 top_k:T.Integer({minimum:1,maximum:10}),
},{additionalProperties:false});
export const monitorQuerySchema=T.Object({...intelligenceScopeSchema.properties,
 objective:T.Union([T.Literal('click'),T.Literal('conversion')]),
},{additionalProperties:false});
export type MonitorQuery=Static<typeof monitorQuerySchema>;
export type IntelligenceScope=Static<typeof intelligenceScopeSchema>;
export type IntelligenceDatasetQuery=Static<typeof intelligenceDatasetSchema>;
export type IntelligencePrediction=Static<typeof intelligencePredictSchema>;
export const trainingSchema=T.Object({...intelligenceDatasetSchema.properties,
 models:T.Array(T.Union([T.Literal('sasrec'),T.Literal('euler'),T.Literal('conversion')]),{minItems:1,maxItems:3,uniqueItems:true}),
},{additionalProperties:false});
export const trainingScheduleSchema=T.Object({...intelligenceScopeSchema.properties,
 interval_hours:T.Union([T.Literal(0),T.Literal(24),T.Literal(168)]),
 lookback_days:T.Integer({minimum:1,maximum:90}),
},{additionalProperties:false});
export const rollbackSchema=T.Object({...intelligenceScopeSchema.properties,
 run_id:T.String({format:'uuid'}),
},{additionalProperties:false});
export type TrainingRequest=Static<typeof trainingSchema>;
export type TrainingSchedule=Static<typeof trainingScheduleSchema>;
export type TrainingPoint={phase:string;epoch:number;epochs:number;loss:number;validation_loss?:number;validation_ndcg?:number};
export type TrainingRun={id:string;model:'sasrec'|'euler'|'conversion';status:'queued'|'running'|'completed'|'failed';progress:TrainingPoint[];manifest:((ModelManifest|EulerManifest)&{publication?:'awaiting_review'|'activated'})|null;error_code:string|null;created_at:string;finished_at:string|null};
export const eulerPredictSchema=T.Object({...intelligenceScopeSchema.properties,
 history:intelligencePredictSchema.properties.history,
 device:T.Union([T.Literal('mobile'),T.Literal('tablet'),T.Literal('desktop')]),
},{additionalProperties:false});
export const jointPredictSchema=T.Object({...eulerPredictSchema.properties,top_k:intelligencePredictSchema.properties.top_k},{additionalProperties:false});
export type EulerPrediction=Static<typeof eulerPredictSchema>;
export type JointPrediction=Static<typeof jointPredictSchema>;
export type SequenceScope=IntelligenceScope&{locale:string;state:string;registry_hash:string;data_version:string};
export type SequenceDataset={
 schema_version:1;scope:SequenceScope;exported_at:string;expires_at:string;minimum_token_views:number;
 sequences:{started_at:string;ended_at:string;tokens:string[]}[];
};
export type ModelManifest={
 schema_version:1;model:'SASRec';model_id:string;scope:SequenceScope;created_at:string;
 expires_at:string;oldest_started_at:string;vocabulary:string[];max_length:number;minimum_token_views:number;
 evaluation:{test_sequences:number;unknown_targets:number;k:number;sasrec:{hit_rate:number;ndcg:number};markov:{hit_rate:number;ndcg:number};popularity:{hit_rate:number;ndcg:number}};
};
export const eulerTarget='qualified_exposure_click_30s' as const;
export const conversionTarget='qualified_exposure_primary_action_30s' as const;
export const eulerFeatureNames=['element_id','device','previous_action','recent_clicks','recent_activations','recent_length'] as const;
export type EulerFeatures=Record<typeof eulerFeatureNames[number],string>;
export type EulerDataset={
 schema_version:1;model:'EulerNet';feature_schema_version:1;target:typeof eulerTarget|typeof conversionTarget;horizon_ms:30000;primary_action_id?:string;
 environment:'synthetic'|'real';
 scope:SequenceScope;exported_at:string;expires_at:string;minimum_views:number;
 views:{started_at:string;ended_at:string;examples:{features:EulerFeatures;label:0|1;prior_elements?:string[];context?:Record<string,string>}[]}[];
 attention?:{element:string;views:number}[];survival?:{seconds:number;probability:number}[];
 exclusions:{censored_exposures:number;invalid_views:number};
};
export type BinaryMetrics={log_loss:number;brier:number;ece:number;auc:number|null};
type PopulationReport = {status:'insufficient_views'}|{status:'evaluated';test_views:number;unusual_views:number|null;cluster_sample:number;cluster_sizes:number[];distribution_distance:Record<string,number>};
export type EulerManifest={
 schema_version:1;model:'EulerNet';model_id:string;scope:SequenceScope;created_at:string;expires_at:string;oldest_started_at:string;
 newest_started_at?:string;reference?:{examples:number;fields:Record<string,Record<string,number>>};
 environment:'synthetic'|'real';
 feature_schema_version:1;target:typeof eulerTarget|typeof conversionTarget;horizon_ms:30000;minimum_views:number;primary_action_id?:string;
 vocabulary:Record<typeof eulerFeatureNames[number],string[]>;
 evaluation:{test_views:number;test_examples:number;positives:number;negatives:number;eulernet:BinaryMetrics;logistic:BinaryMetrics;constant:BinaryMetrics};
 tabular?:({status:'constant_features'}|{status:'evaluated';metrics:Record<string,BinaryMetrics>;mean_absolute_shap:Record<string,number>}) & {population?:PopulationReport;validation_state?:EulerManifest['validation_state']}|null;
 validation_state:'fixture_only'|'needs_review'|'passes_offline_checks';
};

export type MonitorFinding={code:'NO_LIFT_OVER_BASELINE'|'LIFT_UNCERTAIN'|'MISCALIBRATED'|'RANKING_DEGRADED'|'FEATURE_DRIFT_MAJOR'|'FEATURE_DRIFT_MODERATE'|'UNSEEN_ELEMENTS'|'UNSEEN_ELEMENTS_MAJOR';model?:string;field?:string;value:number};
export type ModelMonitor={
 status:'evaluated'|'insufficient_data';model_id:string;objective:'click'|'conversion';cutoff:string;
 fresh_views:number;fresh_examples:number;scored_examples:number;unseen_element_examples:number;positives:number;negatives:number;
 reference_rate:number;observed_rate:number|null;baseline?:BinaryMetrics;
 models:Record<string,{metrics:BinaryMetrics;reference:BinaryMetrics|null;mean_probability:number;calibration_z:number;lift:{mean_difference:number;standard_error:number|null}}>;
 drift:{status:'no_reference'}|{status:'evaluated'|'low_support';examples:number;fields:Record<string,number>;max_field?:string|null;max_psi?:number};
 findings:MonitorFinding[];recommendation:'healthy'|'watch'|'retrain'|'collect_more_data';
};
