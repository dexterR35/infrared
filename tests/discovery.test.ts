import {it,expect} from 'vitest';
import {discoverElements} from '../apps/tracker/discovery.js';
class Node {
 private attributes=new Map<string,string>();
 constructor(readonly tagName:string,readonly privateRegion=false,attributes:Record<string,string>={}){for(const [k,v] of Object.entries(attributes))this.attributes.set(k,v);}
 getAttribute(k:string){return this.attributes.get(k)??null;}
 hasAttribute(k:string){return this.attributes.has(k);}
 setAttribute(k:string,v:string){this.attributes.set(k,v);}
 removeAttribute(k:string){this.attributes.delete(k);}
 closest(){return this.privateRegion?this:null;}
 get textContent():never{throw new Error('Page text must not be read');}
}
const root=(nodes:Node[])=>({querySelectorAll:(selector:string)=>selector==='[data-hm-id]'?nodes.filter(n=>n.hasAttribute('data-hm-id')):nodes}) as unknown as Document;
it('avoids private regions and collisions with website-owned identifiers',()=>{
 const existing=new Node('BUTTON',false,{'data-hm-id':'auto.button.1'}),button=new Node('BUTTON'),secret=new Node('BUTTON',true);
 const scan=discoverElements(root([existing,button,secret]));expect(scan.elements).toEqual(['auto.button.2']);expect(secret.getAttribute('data-hm-id')).toBeNull();
 scan.destroy();expect(existing.getAttribute('data-hm-id')).toBe('auto.button.1');expect(button.getAttribute('data-hm-id')).toBeNull();
});
it('restores website attributes on consent withdrawal without undoing host edits',()=>{
 const section=new Node('SECTION',false,{'data-hm-exposure':'website-value'}),button=new Node('BUTTON');
 const scan=discoverElements(root([section,button]));button.setAttribute('data-hm-id','host-replaced');button.setAttribute('data-hm-action','host-action');
 scan.destroy();expect(section.getAttribute('data-hm-exposure')).toBe('website-value');expect(button.getAttribute('data-hm-id')).toBe('host-replaced');expect(button.getAttribute('data-hm-action')).toBe('host-action');
});
it('caps discovery and cleans up all attributes it owns',()=>{
 const nodes=Array.from({length:200},()=>new Node('A'));const scan=discoverElements(root(nodes));expect(scan.elements).toHaveLength(100);
 scan.destroy();expect(nodes.every(n=>n.getAttribute('data-hm-id')===null&&n.getAttribute('data-hm-action')===null)).toBe(true);
});
