import {describe,it,expect} from 'vitest';
import {emptyProjectForm,prepareProject} from '../apps/dashboard/src/project-form.js';

const values={...emptyProjectForm,name:' My store ',url:' https://clothing.ro/ '};
describe('project form submission',()=>{
 it('normalizes the origin and optional settings without changing plain text',()=>{
  const result=prepareProject({...values,brand:' <Store & Co> ',currency:'ron',market:' RO ',timezone:' Europe/Bucharest '});
  expect(result.errors).toEqual({});
  expect(result.body).toEqual({name:'My store',url:'https://clothing.ro',brand:'<Store & Co>',currency:'RON',market:'RO',report_timezone:'Europe/Bucharest'});
 });
 it.each(['javascript:alert(1)','http://store.test','https://user:pass@store.test','https://store.test/path','https://store.test/?token=secret','https://store.test/#section','https://sto\nre.test'])('rejects unsafe or non-origin addresses: %s',url=>{
  expect(prepareProject({...values,url}).errors.url).toBeTruthy();
 });
 it('omits empty regional overrides so server defaults apply',()=>{
  expect(prepareProject(values).body).toEqual({name:'My store',url:'https://clothing.ro',brand:''});
 });
 it('rejects invalid metadata and invisible control characters',()=>{
  const result=prepareProject({...values,name:'  ',brand:'Store\u0000',market:'<script>',currency:'EU',timezone:'invalid/zone'});
  expect(Object.keys(result.errors).sort()).toEqual(['brand','currency','market','name','timezone']);
 });
});
