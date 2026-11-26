import {it,expect} from 'vitest';
import {postgresConfig} from '../packages/db/postgres.js';
import {openDB,migrate} from '../packages/db/index.js';

it('uses the existing public schema for ordinary local PostgreSQL',()=>{
 const c=postgresConfig('postgresql://app:secret@db:5432/app');expect(c.schema).toBe('public');expect(c.supabase).toBe(false);expect(c.pool.max).toBe(8);
});
it('uses a private schema and verified TLS for direct and session-pooled Supabase',()=>{
 for(const url of ['postgresql://postgres:secret@db.project.supabase.co:5432/postgres?sslmode=require','postgresql://postgres.project:secret@aws-0-eu.pooler.supabase.com:5432/postgres']){
  const c=postgresConfig(url);expect(c.schema).toBe('infrared');expect(c.pool.ssl).toEqual({rejectUnauthorized:true});expect(c.pool.max).toBe(4);expect(c.pool.options).toContain('search_path=infrared,pg_catalog');
 }
});
it('rejects unsafe or unsupported Supabase settings without exposing the URL',()=>{
 const base='postgresql://postgres:secret@db.project.supabase.co:5432/postgres';
 expect(()=>postgresConfig(base,{schema:'public'})).toThrow('SUPABASE_REQUIRES_PRIVATE_SCHEMA');
 expect(()=>postgresConfig(base+'?sslmode=disable')).toThrow('SUPABASE_REQUIRES_VERIFIED_TLS');
 expect(()=>postgresConfig(base.replace(':5432',':6543'))).toThrow('SUPABASE_USE_DIRECT_OR_SESSION_CONNECTION');
 expect(()=>postgresConfig(base,{schema:'infrared; DROP SCHEMA public'})).toThrow('DATABASE_SCHEMA_INVALID');
 expect(()=>postgresConfig(base,{poolSize:1000})).toThrow('DATABASE_POOL_SIZE_INVALID');
 expect(()=>postgresConfig('invalid-secret-value')).toThrow('DATABASE_URL_INVALID');
});
it('keeps application migrations isolated from existing public tables',async()=>{
 const db=await openDB(undefined,'memory://',{schema:'infrared'});
 try{
  await db.exec('CREATE TABLE public.users (legacy text); INSERT INTO public.users VALUES (\'preserved\')');
  await migrate(db);
  expect((await db.query('SELECT * FROM public.users'))[0].legacy).toBe('preserved');
  expect((await db.query('SELECT count(*)::int AS n FROM infrared.users'))[0].n).toBe(0);
  expect((await db.query('SELECT max(version) AS version FROM schema_migrations'))[0].version).toBe(15);
 }finally{await db.close();}
});
