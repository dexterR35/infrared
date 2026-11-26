type Api=<T=any>(url:string,body?:unknown,method?:string)=>Promise<T>;
const projectLists=new Set(['/api/campaigns','/api/acquisition','/api/experiments','/api/installations','/api/registry/export','/api/quality']);
export function createProjectApi(api:Api,siteId?:string):Api{
 return async<T=any>(address:string,input?:unknown,method?:string):Promise<T>=>{
  const url=new URL(address,'http://infrared.local'),verb=method??(input?'POST':'GET');
  if(!siteId){if(projectLists.has(url.pathname)||['/api/landing-pages','/api/registry/import'].includes(url.pathname))throw new Error('SELECT_PROJECT_FIRST');return api<T>(address,input,method);}
  const body=input&&typeof input==='object'&&!Array.isArray(input)?input as Record<string,unknown>:undefined;
  const pathSite=url.pathname.match(/^\/api\/(?:sites|pages)\/([^/]+)/)?.[1];
  if((url.searchParams.has('site_id')&&url.searchParams.get('site_id')!==siteId)||(body?.site_id&&body.site_id!==siteId)||(pathSite&&decodeURIComponent(pathSite)!==siteId))throw new Error('PROJECT_SCOPE_MISMATCH');
  if(verb==='GET'&&projectLists.has(url.pathname))url.searchParams.set('site_id',siteId);
  const scopedBody=['/api/landing-pages','/api/registry/import'].includes(url.pathname)?{...body,site_id:siteId}:input;
  return api<T>(url.pathname+url.search,scopedBody,method);
 };
}
export function projectSelection<T extends {site_id:string;page_key:string}>(pages:T[],siteId:string|undefined,current:string){
 const candidates=pages.filter(p=>p.site_id===siteId);
 return candidates.some(p=>p.site_id+'/'+p.page_key===current)?current:candidates[0]?candidates[0].site_id+'/'+candidates[0].page_key:'';
}
