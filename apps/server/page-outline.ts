// A drawn page outline for heatmaps without an approved reference screenshot.
// Clicks on registered elements carry the element's document box and the click's
// position inside it, so clicks from every width of one device can share one canvas.
type Rect={x:number;y:number;width:number;height:number};
export type OutlineClick={viewport:{width:number;document_height:number;document_width?:number};document_x:number;document_y:number;layer:string;target?:{element_id:string;x_fraction:number;y_fraction:number;rect?:Rect}};
export type PageOutline={width:number;height:number;widths:number[];elements:{id:string;rect:Rect;clicks:number}[];points:{x:number;y:number;weight:number}[];placed:number;approximate:number;total:number};

const median=(values:number[])=>{const s=[...values].sort((a,b)=>a-b);return s.length?s[Math.floor(s.length/2)]:0;};
const BIN=8,MAX_HEIGHT=30000;

export function buildOutline(clicks:OutlineClick[]):PageOutline|null{
 const usable=clicks.filter(c=>c.layer==='document'&&c.viewport?.width>0&&c.viewport.document_height>0);
 if(!usable.length)return null;
 // Canvas width: the most common viewport width in this selection.
 const counts=new Map<number,number>();for(const c of usable)counts.set(c.viewport.width,(counts.get(c.viewport.width)??0)+1);
 const width=[...counts.entries()].sort((a,b)=>b[1]-a[1]||b[0]-a[0])[0][0];
 const scaleOf=(c:OutlineClick)=>width/c.viewport.width;
 // Element boxes: median of every observed box, scaled to the canvas width.
 const boxes=new Map<string,Rect[]>(),hits=new Map<string,number>();
 for(const c of usable){const t=c.target;if(!t?.rect||t.rect.width<=0||t.rect.height<=0)continue;const s=scaleOf(c);
  (boxes.get(t.element_id)??boxes.set(t.element_id,[]).get(t.element_id)!).push({x:t.rect.x*s,y:t.rect.y*s,width:t.rect.width*s,height:t.rect.height*s});hits.set(t.element_id,(hits.get(t.element_id)??0)+1);}
 const elements=[...boxes.entries()].map(([id,list])=>({id,rect:{x:median(list.map(r=>r.x)),y:median(list.map(r=>r.y)),width:median(list.map(r=>r.width)),height:median(list.map(r=>r.height))},clicks:hits.get(id)??0}));
 const byId=new Map(elements.map(e=>[e.id,e.rect]));
 const height=Math.min(MAX_HEIGHT,Math.max(median(usable.map(c=>c.viewport.document_height*scaleOf(c))),...elements.map(e=>e.rect.y+e.rect.height)));
 const points=new Map<string,{x:number;y:number;weight:number}>();let placed=0,approximate=0;
 for(const c of usable){
  const box=c.target?byId.get(c.target.element_id):undefined;let x:number,y:number;
  if(box&&c.target){x=box.x+c.target.x_fraction*box.width;y=box.y+c.target.y_fraction*box.height;placed++;}
  else{const s=scaleOf(c);x=c.document_x*s;y=c.document_y*s;approximate++;}
  x=Math.min(width-1,Math.max(0,Math.round(x/BIN)*BIN));y=Math.min(height-1,Math.max(0,Math.round(y/BIN)*BIN));
  const key=x+':'+y,p=points.get(key);if(p)p.weight++;else points.set(key,{x,y,weight:1});
 }
 return {width,height:Math.round(height),widths:[...counts.keys()].sort((a,b)=>a-b),elements:elements.sort((a,b)=>b.rect.width*b.rect.height-a.rect.width*a.rect.height),points:[...points.values()],placed,approximate,total:usable.length};
}
