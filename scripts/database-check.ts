import {openDB} from '../packages/db/index.js';
import {config} from '../packages/config/index.js';
if(!config.databaseUrl){
 console.log(JSON.stringify({mode:'local-pglite',hosted_database_configured:false,detail:'DATABASE_URL is unset. Local data remains in DATA_DIR/database. SQLite is not required.'}));
}else{
 let db:Awaited<ReturnType<typeof openDB>>|undefined;
 try{
  db=await openDB(config.databaseUrl);await db.query('SELECT 1 AS connected');
  const [namespace]=await db.query('SELECT to_regnamespace($1) IS NOT NULL AS ready',[db.schema??'public']);
  const [schema]=await db.query('SELECT to_regclass($1) IS NOT NULL AS ready',[(db.schema??'public')+'.schema_migrations']);
  console.log(JSON.stringify({mode:'postgresql',connected:true,schema:db.schema,schema_exists:namespace.ready,migrations_present:schema.ready,read_only_check:true}));
 }catch{
  console.error('DATABASE_CONNECTION_CHECK_FAILED: verify the server-side URL, password, network access and CA certificate. Credentials were not logged.');process.exitCode=1;
 }finally{await db?.close();}
}
