import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';
import { readFile, mkdir } from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {postgresConfig,databaseSchema,type DatabaseOptions} from './postgres.js';
export interface DB {
  schema?:string;
  query<T = Record<string, any>>(sql:string, params?:any[]):Promise<T[]>;
  exec(sql:string):Promise<void>;
  transaction<T>(fn:(tx:DB)=>Promise<T>):Promise<T>;
  close():Promise<void>;
}
export async function openDB(url?:string, dataDir='.local/database',settings:DatabaseOptions={}):Promise<DB> {
  const options={schema:settings.schema??(process.env.DATABASE_SCHEMA||undefined),sslCaFile:settings.sslCaFile??(process.env.DATABASE_SSL_CA_FILE||undefined),poolSize:settings.poolSize??(process.env.DATABASE_POOL_SIZE?Number(process.env.DATABASE_POOL_SIZE):undefined)};
  if(url) {
    const configured=postgresConfig(url,options),pool=new pg.Pool(configured.pool);
    // An idle client can fail (server restart, network drop). Without a listener node-postgres
    // emits an unhandled 'error' and the whole process exits; the pool replaces the client instead.
    pool.on('error',()=>{console.error('DATABASE_IDLE_CONNECTION_LOST');});
    const wrap=(q:pg.Pool|pg.PoolClient):DB=>({
      schema:configured.schema,
      query:async<T>(s:string,p:any[]=[]) => (await q.query(s,p)).rows as T[],
      exec:async s=>{await q.query(s);},
      // A failed ROLLBACK must not hide the original error or return a broken client to the pool.
      transaction:async fn=>{const c=await pool.connect();let broken=false;try{await c.query('BEGIN');const r=await fn(wrap(c));await c.query('COMMIT');return r;}catch(e){await c.query('ROLLBACK').catch(()=>{broken=true;});throw e;}finally{c.release(broken);}},
      close:()=>pool.end(),
    });
    return wrap(pool);
  }
  if(dataDir!=='memory://')await mkdir(dataDir,{recursive:true});
  const database=new PGlite(dataDir);
  await database.waitReady;
  const schema=databaseSchema(options.schema??'public');
  await database.exec("SET TIME ZONE 'UTC'");
  if(schema!=='public')await database.exec('CREATE SCHEMA IF NOT EXISTS "'+schema+'"; SET search_path TO "'+schema+'",pg_catalog');
  const wrap=(q:any):DB=>({schema,query:async<T>(s:string,p:any[]=[]) => (await q.query(s,p)).rows as T[],exec:async s=>{await q.exec(s);},transaction:fn=>q.transaction((tx:any)=>fn(wrap(tx))),close:()=>database.close()});
  return wrap(database);
}
export async function migrate(db:DB) {
  if(db.schema&&db.schema!=='public'){
    const schema=databaseSchema(db.schema);
    await db.exec('CREATE SCHEMA IF NOT EXISTS "'+schema+'"; REVOKE ALL ON SCHEMA "'+schema+'" FROM PUBLIC');
  }
  for (const file of ['001_initial.sql','002_capture_and_facts.sql','003_data_sources.sql','004_analytics_operations.sql','005_acquisition_experiments.sql','006_installation_checks.sql','007_neutral_brand.sql','008_audience.sql','009_site_approval.sql','010_whole_site.sql','011_journeys.sql','012_intelligence.sql','013_website_projects.sql','014_project_markets.sql','015_intelligence_training.sql','016_business_goals.sql','017_adaptive_experiments.sql']) {
    await db.exec(await readFile(fileURLToPath(new URL(file,import.meta.url)),'utf8'));
  }
}
