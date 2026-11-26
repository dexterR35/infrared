import {expect,it,vi} from 'vitest';
import {createProjectApi,projectSelection} from '../apps/dashboard/src/project-scope.js';

it('uses the active project for lists and page creation while preserving filters',async()=>{
 const api=vi.fn(async()=>({ok:true})) as any,scoped=createProjectApi(api,'clothing');
 await scoped('/api/campaigns?from=2026-11-01');expect(api).toHaveBeenLastCalledWith('/api/campaigns?from=2026-11-01&site_id=clothing',undefined,undefined);
 await scoped('/api/landing-pages',{name:'Summer'});expect(api).toHaveBeenLastCalledWith('/api/landing-pages',{name:'Summer',site_id:'clothing'},undefined);
 await scoped('/api/registry/import',{dry_run:true,rows:[]});expect(api).toHaveBeenLastCalledWith('/api/registry/import',{dry_run:true,rows:[],site_id:'clothing'},undefined);
 await scoped('/api/sites/clothing/collection',{elements:[]},'PATCH');expect(api).toHaveBeenLastCalledWith('/api/sites/clothing/collection',{elements:[]},'PATCH');
});
it('rejects conflicting project requests and requires a selected project',async()=>{
 const api=vi.fn(async()=>({})) as any,scoped=createProjectApi(api,'clothing');
 for(const url of ['/api/campaigns?site_id=services','/api/sites/services/approve','/api/pages/services/home/toggle'])await expect(scoped(url)).rejects.toThrow('PROJECT_SCOPE_MISMATCH');
 await expect(scoped('/api/acquisition/spend',{site_id:'services'})).rejects.toThrow('PROJECT_SCOPE_MISMATCH');
 await expect(createProjectApi(api)('/api/installations')).rejects.toThrow('SELECT_PROJECT_FIRST');expect(api).not.toHaveBeenCalled();
});
it('resolves a page within the selected website when projects are switched or reloaded',()=>{
 const pages=[{site_id:'a',page_key:'home'},{site_id:'b',page_key:'home'},{site_id:'b',page_key:'collection'}];
 expect(projectSelection(pages,'b','a/home')).toBe('b/home');expect(projectSelection(pages,'b','b/collection')).toBe('b/collection');expect(projectSelection(pages,'c','a/home')).toBe('');
});
