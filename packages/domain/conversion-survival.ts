/** Kaplan–Meier at fixed landmarks. A last observed event right-censors the view.
 * Suppress each landmark unless both outcome groups and remaining risk set meet policy. */
export function conversionSurvival(observations:{ms:number;converted:boolean}[], minimum:number) {
 const ordered=observations.slice().sort((a,b)=>a.ms-b.ms);
 let atRisk=ordered.length,remaining=1,index=0,events=0;
 const landmarks:{seconds:number;probability:number}[]=[];
 for(const seconds of [5,15,30,60,120,300]){
  while(index<ordered.length && ordered[index].ms<=seconds*1000){
   const time=ordered[index].ms;let count=0,conversions=0;
   while(index<ordered.length&&ordered[index].ms===time){
    conversions+=Number(ordered[index++].converted);count++;
   }
   remaining*=1-conversions/atRisk;events+=conversions;atRisk-=count;
  }
  if(atRisk>=minimum&&events>=minimum&&ordered.length-events>=minimum)landmarks.push({seconds,probability:1-remaining});
 }
 return landmarks;
}
