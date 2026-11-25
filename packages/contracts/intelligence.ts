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
export type IntelligenceScope=Static<typeof intelligenceScopeSchema>;
export type IntelligenceDatasetQuery=Static<typeof intelligenceDatasetSchema>;
export type IntelligencePrediction=Static<typeof intelligencePredictSchema>;
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
export const eulerFeatureNames=['element_id','device','previous_action','recent_clicks','recent_activations','recent_length'] as const;
export type EulerFeatures=Record<typeof eulerFeatureNames[number],string>;
export type EulerDataset={
 schema_version:1;model:'EulerNet';feature_schema_version:1;target:typeof eulerTarget;horizon_ms:30000;
 environment:'synthetic'|'real';
 scope:SequenceScope;exported_at:string;expires_at:string;minimum_views:number;
 views:{started_at:string;ended_at:string;examples:{features:EulerFeatures;label:0|1}[]}[];
 exclusions:{censored_exposures:number;invalid_views:number};
};
export type BinaryMetrics={log_loss:number;brier:number;ece:number;auc:number|null};
export type EulerManifest={
 schema_version:1;model:'EulerNet';model_id:string;scope:SequenceScope;created_at:string;expires_at:string;oldest_started_at:string;
 environment:'synthetic'|'real';
 feature_schema_version:1;target:typeof eulerTarget;horizon_ms:30000;minimum_views:number;
 vocabulary:Record<typeof eulerFeatureNames[number],string[]>;
 evaluation:{test_views:number;test_examples:number;positives:number;negatives:number;eulernet:BinaryMetrics;logistic:BinaryMetrics;constant:BinaryMetrics};
 validation_state:'fixture_only'|'needs_review'|'passes_offline_checks';
};
