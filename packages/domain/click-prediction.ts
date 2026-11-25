import type {EulerFeatures} from '../contracts/intelligence.js';

export function exposureElement(history:string[]) {
 const last=history.at(-1);
 if(!last?.startsWith('exposure:'))return undefined;
 const element=last.slice(9);
 if(history.slice(0,-1).includes(last))return undefined;
 return element;
}
export function eulerFeatures(history:string[],device:'mobile'|'tablet'|'desktop'):EulerFeatures {
 const element=exposureElement(history);
 if(!element)throw new Error('INTELLIGENCE_FIRST_EXPOSURE_REQUIRED');
 const past=history.slice(0,-1).slice(-49);
 const clicks=past.filter(t=>t.startsWith('click:')).length,activations=past.filter(t=>t.startsWith('activation:')).length;
 const bucket=(n:number)=>n===0?'0':n===1?'1':n<5?'2-4':'5+';
 return {element_id:element,device,previous_action:past.at(-1)??'page_view',recent_clicks:bucket(clicks),recent_activations:bucket(activations),recent_length:past.length<5?'0-4':past.length<20?'5-19':'20-49'};
}
