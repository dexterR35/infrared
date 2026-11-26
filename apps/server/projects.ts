import type {FastifyInstance} from 'fastify';
import {Type as T} from '@sinclair/typebox';
import {randomUUID} from 'node:crypto';
import type {DB} from '../../packages/db/index.js';
import {DEFAULT_RULES,pathKey} from '../../packages/domain/site-paths.js';
import {marketForHost,validTimeZone} from '../../packages/domain/market-defaults.js';
import {Problem,audit} from './security.js';
import {requireEditor,requireSiteAccess,type CurrentUser} from './access.js';

const code=T.String({pattern:'^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,63}$',maxLength:64}),currency=T.String({pattern:'^[A-Z]{3}$'}),zone=T.String({minLength:1,maxLength:64});
type MarketBody={market?:string;currency?:string;report_timezone?:string};

export function registerProjects(app:FastifyInstance,db:DB,owner:CurrentUser) {
 app.post<{Body:{name:string;url:string;brand?:string}&MarketBody}>('/api/projects',{schema:{body:T.Object({name:T.String({minLength:1,maxLength:120}),url:T.String({maxLength:255}),brand:T.Optional(T.String({maxLength:120})),market:T.Optional(code),currency:T.Optional(currency),report_timezone:T.Optional(zone)},{additionalProperties:false})}},async req=>{
  const u=owner(req);if(u.role!=='owner')throw new Problem(403,'OWNER_REQUIRED');
  let url:URL;try{url=new URL(req.body.url);}catch{throw new Problem(422,'WEBSITE_URL_INVALID');}
  if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.pathname!=='/')throw new Problem(422,'HTTPS_WEBSITE_ORIGIN_REQUIRED');
  const name=req.body.name.trim();if(!name||/[\u0000-\u001f\u007f]/.test(name))throw new Problem(422,'NAME_INVALID');
  const brand=req.body.brand?.trim()||url.hostname;if(/[\u0000-\u001f\u007f]/.test(brand))throw new Problem(422,'BRAND_INVALID');
  // Market, currency and time zone come from the form, else from the country domain (.ro → RO · RON · Europe/Bucharest).
  const guess=marketForHost(url.hostname),market=req.body.market??guess?.market??null,money=req.body.currency??guess?.currency??'XXX',timezone=req.body.report_timezone??guess?.report_timezone??'UTC';
  if(!validTimeZone(timezone))throw new Problem(422,'TIMEZONE_INVALID');
  return db.transaction(async tx=>{
   if((await tx.query('SELECT id FROM sites WHERE origin=$1',[url.origin])).length)throw new Problem(409,'WEBSITE_ALREADY_EXISTS');
   const id=randomUUID();
   const inserted=await tx.query("INSERT INTO sites(id,site_key,name,origin,domain_group,family,environment,brand,collection_mode,site_rules,auto_discovery,market,currency,report_timezone) VALUES($1,$2,$3,$4,$5,'website','real',$6,'whole_site',$7,true,$8,$9,$10) ON CONFLICT(origin) DO NOTHING RETURNING id",[id,'site_'+randomUUID().replaceAll('-',''),name,url.origin,url.hostname,brand,JSON.stringify(DEFAULT_RULES),market,money,timezone]);
   if(!inserted.length)throw new Problem(409,'WEBSITE_ALREADY_EXISTS');
   await tx.query('INSERT INTO config_history(site_id,version,sample_rate) SELECT id,config_version,sample_rate FROM sites WHERE id=$1',[id]);
   const pageKey=pathKey('/');
   const selector={origin:url.origin,path:'/',query_equals:{},ignored_query_names:[],other_query_policy:'ignore',duplicate_query_policy:'reject',fragment_policy:'ignore_anchor'};
   await tx.query("INSERT INTO pages(site_id,page_key,name,selector,revision,locale,product,path,auto,market) VALUES($1,$2,'Home',$3,'auto','auto','website','/',true,$4)",[id,pageKey,JSON.stringify(selector),market]);
   await audit(tx,u.id,'project_created',id,{name,origin:url.origin,market,currency:money,report_timezone:timezone});
   return {id,name,origin:url.origin,page_key:pageKey,market,currency:money,report_timezone:timezone};
  });
 });

 // Project-wide market settings: updates the website and every one of its pages in one step.
 app.patch<{Params:{id:string};Body:Required<MarketBody>&{brand?:string}}>('/api/projects/:id/market',{schema:{params:T.Object({id:T.String({minLength:1,maxLength:100})}),body:T.Object({market:code,currency,report_timezone:zone,brand:T.Optional(code)},{additionalProperties:false})}},async req=>{
  const u=owner(req);requireEditor(u);
  const b=req.body;if(!validTimeZone(b.report_timezone))throw new Problem(422,'TIMEZONE_INVALID');
  return db.transaction(async tx=>{
   const site=await requireSiteAccess(tx,u,req.params.id);
   await tx.query('SELECT id FROM sites WHERE id=$1 FOR UPDATE',[site.id]);
   if((await tx.query("SELECT 1 FROM experiments WHERE site_id=$1 AND status IN ('running','paused') LIMIT 1",[site.id])).length)throw new Problem(409,'ACTIVE_EXPERIMENT_METADATA_LOCKED');
   await tx.query('UPDATE sites SET market=$2,currency=$3,report_timezone=$4,brand=COALESCE($5,brand),config_version=config_version+1 WHERE id=$1',[site.id,b.market,b.currency,b.report_timezone,b.brand??null]);
   const pages=await tx.query('UPDATE pages SET market=$2 WHERE site_id=$1 RETURNING page_key',[site.id,b.market]);
   await tx.query('INSERT INTO config_history(site_id,version,sample_rate) SELECT id,config_version,sample_rate FROM sites WHERE id=$1 ON CONFLICT DO NOTHING',[site.id]);
   await audit(tx,u.id,'project_market_updated',site.id,{...b,pages:pages.length});
   return {ok:true,pages_updated:pages.length};
  });
 });
}
