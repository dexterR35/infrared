import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {parseArgs} from 'node:util';
import {localClient} from './local-client.js';
const {values}=parseArgs({options:{site:{type:'string'},page:{type:'string'},from:{type:'string'},to:{type:'string'},source:{type:'string',default:'recorded'},revision:{type:'string'},variant:{type:'string',default:'control'},output:{type:'string',default:'.local/intelligence-dataset.json'},model:{type:'string',default:'sasrec'}}});
if(!values.site||!values.page||!values.from||!values.to||!values.revision)throw new Error('Required: --site --page --from --to --revision [--source recorded|seeded] [--variant control] [--output path]');
const query=new URLSearchParams({site_id:values.site,page_key:values.page,from:values.from,to:values.to,revision:values.revision,variant:values.variant!,data_source:values.source!});
if(!['sasrec','eulernet','both'].includes(values.model!))throw new Error('Model must be sasrec, eulernet or both');
const request=await localClient();
for(const model of values.model==='both'?['sasrec','eulernet']:[values.model!]){
 const response=await request('/api/intelligence/'+(model==='eulernet'?'euler/':'')+'dataset?'+query);
 const output=values.model==='both'?values.output!.replace(/\.json$/,'')+'-'+model+'.json':values.output!;
 await mkdir(path.dirname(output),{recursive:true});await writeFile(output,await response.text(),{mode:0o600});
 console.log(model+' dataset saved to '+output+'. Delete the export after training.');
}
