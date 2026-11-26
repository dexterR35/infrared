export function visibleFraction(rect:{left:number;right:number;top:number;bottom:number;width:number;height:number},width:number,height:number){
 if(rect.width<=0||rect.height<=0)return 0;
 const visibleWidth=Math.max(0,Math.min(rect.right,width)-Math.max(rect.left,0));
 const visibleHeight=Math.max(0,Math.min(rect.bottom,height)-Math.max(rect.top,0));
 return Math.min(1,visibleWidth*visibleHeight/(rect.width*rect.height));
}
