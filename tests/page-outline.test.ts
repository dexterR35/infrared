import {it,expect} from 'vitest';
import {buildOutline,type OutlineClick} from '../apps/server/page-outline.js';
const click=(width:number,element:string|null,rect:{x:number;y:number;width:number;height:number},fx=0.5,fy=0.5):OutlineClick=>({viewport:{width,document_height:width*2},document_x:rect.x+fx*rect.width,document_y:rect.y+fy*rect.height,layer:'document',...(element?{target:{element_id:element,x_fraction:fx,y_fraction:fy,rect}}:{})});
it('combines widths of one device on the most common width and places clicks inside their element',()=>{
 const o=buildOutline([click(1440,'auto.button.1',{x:100,y:200,width:200,height:40}),click(1440,'auto.button.1',{x:100,y:200,width:200,height:40},0,0),click(1920,'auto.button.1',{x:133,y:267,width:267,height:53})])!;
 expect(o.width).toBe(1440);expect(o.widths).toEqual([1440,1920]);expect(o.placed).toBe(3);expect(o.approximate).toBe(0);
 expect(o.elements).toHaveLength(1);expect(o.elements[0].clicks).toBe(3);expect(Math.round(o.elements[0].rect.width)).toBe(200);
 expect(o.points.reduce((n,p)=>n+p.weight,0)).toBe(3);expect(o.points.some(p=>p.x===200&&p.y===224)).toBe(true);
});
it('keeps clicks without an element at scaled page positions and ignores non-document layers',()=>{
 const o=buildOutline([click(390,null,{x:40,y:400,width:0,height:0}),{...click(390,null,{x:0,y:0,width:0,height:0}),layer:'fixed'}])!;
 expect(o.total).toBe(1);expect(o.approximate).toBe(1);expect(o.elements).toEqual([]);
 expect(buildOutline([])).toBeNull();
});
