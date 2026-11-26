import sharp from 'sharp';
import type {Manifest} from './references.js';

export async function designAnalysis(bytes:Buffer, manifest:Manifest) {
 const {data,info}=await sharp(bytes,{limitInputPixels:40000000}).flatten({background:'#fff'})
  .resize({width:256,height:768,fit:'inside',withoutEnlargement:true}).greyscale().raw().toBuffer({resolveWithObject:true});
 // Local luminance changes characterize visual density. Masked pixels have no evidence.
 const valid=new Uint8Array(info.width*info.height).fill(1);
 for(const rect of manifest.masks){
  const left=Math.max(0,Math.floor(rect.x*info.width/manifest.document.width)),right=Math.min(info.width,Math.ceil((rect.x+rect.width)*info.width/manifest.document.width));
  const top=Math.max(0,Math.floor(rect.y*info.height/manifest.document.height)),bottom=Math.min(info.height,Math.ceil((rect.y+rect.height)*info.height/manifest.document.height));
  for(let y=top;y<bottom;y++)valid.fill(0,y*info.width+left,y*info.width+right);
 }
 let edges=0,measured=0;
 for(let y=1;y<info.height;y++)for(let x=1;x<info.width;x++){
  const i=y*info.width+x;
  if(!valid[i]||!valid[i-1]||!valid[i-info.width])continue;
  measured++;
  if(Math.max(Math.abs(data[i]-data[i-1]),Math.abs(data[i]-data[i-info.width]))>=32)edges++;
 }
 return {width:manifest.viewport.width,captured_at:manifest.captured_at,edge_fraction:measured?edges/measured:null,
  elements:manifest.elements.map(({id,rect,font_px,solid_color_contrast})=>({id,font_px,solid_color_contrast,top:rect.y,height:rect.height,width:rect.width,
    first_screen_fraction:rect.height?Math.max(0,Math.min(rect.height,manifest.viewport.height-rect.y))/rect.height:0}))};
}
