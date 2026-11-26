import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {config} from '../packages/config/index.js';
import {localClient} from './local-client.js';
// Inspect local application endpoints only; never visit registered customer websites.
for(const value of [config.dashboardOrigin,config.collectorOrigin])if(!['127.0.0.1','localhost','[::1]'].includes(new URL(value).hostname))throw new Error('LINK_CHECK_LOCAL_ONLY');
const checks:{name:string;status:'PASS'|'FAIL'|'SKIPPED'}[]=[];
async function check(name:string,fn:()=>Promise<boolean>){try{checks.push({name,status:await fn()?'PASS':'FAIL'});}catch{checks.push({name,status:'FAIL'});}}
const get=(url:string)=>fetch(url,{redirect:'manual',signal:AbortSignal.timeout(5000)});
await check('Dashboard document',async()=>{const r=await get(config.dashboardOrigin+'/');return r.status===200&&r.headers.get('content-type')?.includes('text/html')===true;});
await check('Collector health',async()=>(await get(config.collectorOrigin+'/healthz')).status===200);
await check('Collector denies management routes',async()=>(await get(config.collectorOrigin+'/api/bootstrap')).status===404);
await check('Private environment file denied',async()=>(await get(config.dashboardOrigin+'/.env')).status===404);
await check('Dashboard requires authentication',async()=>(await get(config.dashboardOrigin+'/api/bootstrap')).status===401);
await check('Immutable SDK integrity',async()=>{const artifact=JSON.parse(await readFile('dist/sdk/artifact.json','utf8'));const r=await get(config.collectorOrigin+'/sdk/v1/'+artifact.file),bytes=Buffer.from(await r.arrayBuffer());return r.status===200&&'sha384-'+createHash('sha384').update(bytes).digest('base64')===artifact.sri;});
let request:Awaited<ReturnType<typeof localClient>>|undefined;
try{request=await localClient();}catch{checks.push({name:'Authenticated project checks (local credentials required)',status:'SKIPPED'});}
if(request){const authenticated=request;await check('Active website projects only',async()=>{const b=await(await authenticated('/api/bootstrap')).json() as any;return b.demo_url===null&&b.sites.every((s:any)=>s.environment==='real'&&!s.archived);});}
const result={checked_at:new Date().toISOString(),scope:'local application routes and immutable tracking artifact',production_dns_tls_and_redirects:'NOT_VERIFIED',checks};
await mkdir('.local/evidence',{recursive:true});await writeFile('.local/evidence/link-check.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));if(checks.some(c=>c.status==='FAIL'))process.exitCode=1;
