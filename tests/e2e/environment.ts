import path from 'node:path';
export const demoOrigin=process.env.DEMO_ORIGIN||'http://127.0.0.1:4173';
export const collectorOrigin=process.env.COLLECTOR_ORIGIN||'http://127.0.0.1:8080';
export const credentialsFile=path.join(process.env.E2E_DATA_DIR||'.local','admin-credentials.json');

export async function demoProject(page:import('@playwright/test').Page){
 const {readFile}=await import('node:fs/promises');
 const fixture=JSON.parse(await readFile(path.join(path.dirname(credentialsFile),'intelligence-scope.json'),'utf8'));
 fixture.pages.sort((a:{page_key:string},b:{page_key:string})=>Number(b.page_key==='casino-halloween')-Number(a.page_key==='casino-halloween'));
 // Pin the demo project on every load unless a test explicitly opted out with the marker.
 await page.addInitScript(()=>{if(!localStorage.getItem('infrared.e2e.keep-project'))localStorage.setItem('infrared.project','local-demo');});
 await page.route('**/api/bootstrap',async route=>{
  const response=await route.fetch();
  if(!response.ok())return route.fulfill({response});
  const real=await response.json();
  // Add the synthetic demo scope without hiding real projects the test created.
  const known=new Set(fixture.pages.map((p:{site_id:string;page_key:string})=>p.site_id+'/'+p.page_key));
  await route.fulfill({json:{...real,sites:[...fixture.sites,...real.sites.filter((s:{id:string})=>!fixture.sites.some((f:{id:string})=>f.id===s.id))],
   pages:[...fixture.pages,...real.pages.filter((p:{site_id:string;page_key:string})=>!known.has(p.site_id+'/'+p.page_key))]}});
 });
}
export async function useSamples(page:import('@playwright/test').Page){
 const select=page.getByLabel('Data source',{exact:true});
 await select.evaluate((el:HTMLSelectElement)=>{if(!el.querySelector('[value="seeded"]'))el.add(new Option('Generated samples','seeded'));});
 await select.selectOption('seeded');
}
