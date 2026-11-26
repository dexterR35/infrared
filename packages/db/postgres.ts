import {readFileSync} from 'node:fs';
import type {PoolConfig} from 'pg';

export interface DatabaseOptions {schema?:string;poolSize?:number;sslCaFile?:string}
export function databaseSchema(value:string){
 if(!/^[a-z][a-z0-9_]{0,62}$/.test(value)||value.startsWith('pg_')||value==='information_schema')throw new Error('DATABASE_SCHEMA_INVALID');
 return value;
}
export function postgresConfig(connectionString:string,settings:DatabaseOptions={}):{schema:string;supabase:boolean;pool:PoolConfig}{
 let url:URL;try{url=new URL(connectionString);}catch{throw new Error('DATABASE_URL_INVALID');}
 if(!['postgres:','postgresql:'].includes(url.protocol)||!url.hostname||url.hash)throw new Error('DATABASE_URL_INVALID');
 const host=url.hostname.toLowerCase(),supabase=host.endsWith('.supabase.co')||host.endsWith('.pooler.supabase.com');
 const schema=databaseSchema(settings.schema??(supabase?'infrared':'public'));
 const max=settings.poolSize??(supabase?4:8);if(!Number.isSafeInteger(max)||max<1||max>50)throw new Error('DATABASE_POOL_SIZE_INVALID');
 const pool:PoolConfig={connectionString:url.toString(),max,statement_timeout:10000,connectionTimeoutMillis:10000,options:'-c timezone=UTC -c search_path='+schema+',pg_catalog'};
 if(supabase){
  if(schema==='public')throw new Error('SUPABASE_REQUIRES_PRIVATE_SCHEMA');
  if(url.port==='6543')throw new Error('SUPABASE_USE_DIRECT_OR_SESSION_CONNECTION');
  if(url.searchParams.get('sslmode')==='disable'||url.searchParams.get('sslmode')==='no-verify'||url.searchParams.get('ssl')==='false'||url.searchParams.get('ssl')==='0')throw new Error('SUPABASE_REQUIRES_VERIFIED_TLS');
  // Connection-string SSL options otherwise override the explicit pg TLS object.
  const cert=settings.sslCaFile??url.searchParams.get('sslrootcert')??undefined;
  for(const key of ['ssl','sslmode','sslrootcert','sslcert','sslkey','uselibpqcompat','options'])url.searchParams.delete(key);
  pool.connectionString=url.toString();pool.ssl={rejectUnauthorized:true,...(cert?{ca:readFileSync(cert,'utf8')}:{})};
 }
 return {schema,supabase,pool};
}
