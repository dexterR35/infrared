import {semanticElementTypes} from '../../packages/domain/element-types.js';
const semanticKinds = new Set<string>(semanticElementTypes);
// Discover structure only: never read page text, form values, DOM IDs or link URLs.
export function discoverElements(root:Document=document) {
 const counters=new Map<string,number>(),elements:string[]=[],assigned:{node:Element;id:string;exposure:string|null;actionAdded:boolean}[]=[];
 const reserved=new Set(Array.from(root.querySelectorAll('[data-hm-id]')).map(el=>el.getAttribute('data-hm-id')));
 const tags='header,nav,main,section,article,aside,footer,button,a,img,video,[data-hm-type]';
 for(const el of Array.from(root.querySelectorAll(tags)).slice(0,2000)){
  if(elements.length>=100)break;
  if(el.closest('form,input,textarea,select,[contenteditable],[data-hm-private],[data-hm-ignore],iframe,canvas')||el.hasAttribute('data-hm-id'))continue;
  const tag=el.tagName.toLowerCase(),semantic=el.getAttribute('data-hm-type');
  const kind=semantic&&semanticKinds.has(semantic)?semantic:tag==='img'?'image':tag;
  if(!semanticKinds.has(kind)&&!['header','nav','main','section','article','aside','footer','a'].includes(kind))continue;
  let n=(counters.get(kind)??0)+1;
  while(reserved.has(`auto.${kind}.${n}`))n++;counters.set(kind,n);
  if(n>999)continue;
  const id=`auto.${kind}.${n}`,exposure=el.getAttribute('data-hm-exposure'),actionAdded=(kind==='button'||kind==='a'||kind==='link')&&!el.hasAttribute('data-hm-action');
  el.setAttribute('data-hm-id',id);el.setAttribute('data-hm-exposure','auto');
  if(actionAdded)el.setAttribute('data-hm-action',id);
  assigned.push({node:el,id,exposure,actionAdded});elements.push(id);
 }
 return {elements,destroy(){for(const {node,id,exposure,actionAdded} of assigned){
  if(actionAdded&&node.getAttribute('data-hm-action')===id)node.removeAttribute('data-hm-action');
  if(node.getAttribute('data-hm-id')===id)node.removeAttribute('data-hm-id');
  if(node.getAttribute('data-hm-exposure')==='auto'){if(exposure===null)node.removeAttribute('data-hm-exposure');else node.setAttribute('data-hm-exposure',exposure);}
 }}};
}
