import {marketCodePattern,validTimeZone} from '../../../packages/domain/market-defaults.js';

export type ProjectFormValues={name:string;url:string;brand:string;market:string;currency:string;timezone:string};
export type ProjectFormErrors=Partial<Record<keyof ProjectFormValues,string>>;
export const emptyProjectForm:ProjectFormValues={name:'',url:'',brand:'',market:'',currency:'',timezone:''};
const controls=/[\u0000-\u001f\u007f]/;

// Normalize at submission, keeping plain text intact. React escapes text on output;
// stripping HTML here would corrupt names and is not an XSS defense.
export function prepareProject(values:ProjectFormValues){
 const errors:ProjectFormErrors={};
 const name=values.name.trim(),brand=values.brand.trim(),url=values.url.trim(),market=values.market.trim(),currency=values.currency.trim().toUpperCase(),timezone=values.timezone.trim();
 if(!name||name.length>120||controls.test(values.name))errors.name='Enter a project name of 1–120 characters without control characters.';
 if(brand.length>120||controls.test(values.brand))errors.brand='Use up to 120 characters without control characters.';
 let origin=url;
 try{
  const parsed=new URL(url);
  if(url.length>255||controls.test(values.url)||parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.pathname!=='/'||parsed.search||parsed.hash)throw new Error();
  origin=parsed.origin;
 }catch{errors.url='Use an HTTPS website address without a path, query, or credentials.';}
 if(market&&!marketCodePattern.test(market))errors.market='Use up to 64 letters, numbers, dots, colons, hyphens, or underscores.';
 if(currency&&!/^[A-Z]{3}$/.test(currency))errors.currency='Enter a three-letter currency code, such as RON.';
 if(timezone&&(timezone.length>64||!validTimeZone(timezone)))errors.timezone='Enter a valid time zone, such as Europe/Bucharest.';
 return {errors,body:{name,url:origin,brand,...(market?{market}:{}),...(currency?{currency}:{}),...(timezone?{report_timezone:timezone}:{})}};
}
