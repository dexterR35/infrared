import {execFile} from 'node:child_process';
import {fromRoot} from '../../packages/config/paths.js';
import {Problem} from './security.js';

let running=false;
export async function localResearch(kind:'experiment'|'reference',payload:Buffer){
 if(running)throw new Problem(429,'INTELLIGENCE_RESEARCH_BUSY');
 if(payload.length>16_000_000)throw new Problem(413,'INTELLIGENCE_RESEARCH_INPUT_TOO_LARGE');
 running=true;
 try{
  const token=process.env.INFRARED_RESEARCH_TOKEN;
  if(token){
   const response=await fetch('http://127.0.0.1:8765/'+kind,{method:'POST',redirect:'error',
    headers:{Authorization:'Bearer '+token,'Content-Type':'application/octet-stream'},body:new Uint8Array(payload),signal:AbortSignal.timeout(90000)});
   // A busy warm process is a retryable capacity limit, not an outage.
   if(response.status===429)throw new Problem(429,'INTELLIGENCE_RESEARCH_BUSY');
   if(!response.ok)throw new Problem(response.status===422?422:503,'INTELLIGENCE_RESEARCH_UNAVAILABLE');
   return await response.json();
  }
  const python=process.env.INFRARED_RESEARCH_PYTHON||fromRoot('.local/predictive-research',process.platform==='win32'?'Scripts/python.exe':'bin/python');
  const output=await new Promise<string>((resolve,reject)=>{
   const child=execFile(python,[fromRoot('apps/intelligence/research/analyze.py'),kind],{windowsHide:true,timeout:90000,maxBuffer:128*1024},(error,stdout)=>error?reject(error):resolve(stdout));
   child.stdin?.on('error',()=>{});child.stdin?.end(payload);
  });
  return JSON.parse(output);
 }catch(e){if(e instanceof Problem)throw e;throw new Problem(503,'INTELLIGENCE_RESEARCH_UNAVAILABLE');}finally{running=false;}
}
