/** Beta(1,1) priors with independent binomial outcomes in each randomized arm. */
export function posteriorImprovement(control:{successes:number;mature:number}, treatment:{successes:number;mature:number}) {
 if (!control.mature || !treatment.mature) return null;
 // Fixed seed makes repeated reads stable. Marsaglia-Tsang for gamma shapes >= 1.
 let state=19731105;
 const uniform=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return (state+0.5)/4294967296;};
 function gamma(shape:number) {
  const d=shape-1/3,c=1/Math.sqrt(9*d);
  for (;;) {
   const x=Math.sqrt(-2*Math.log(uniform()))*Math.cos(2*Math.PI*uniform()),v=(1+c*x)**3;
   if(v>0 && Math.log(uniform()) < x*x/2+d*(1-v+Math.log(v))) return d*v;
  }
 }
 function draw(arm:typeof control) {
  const wins=gamma(arm.successes+1);
  return wins/(wins+gamma(arm.mature-arm.successes+1));
 }
 const draws=4096,differences=Array.from({length:draws},()=>100*(draw(treatment)-draw(control))).sort((a,b)=>a-b);
 return {draws,probability: differences.filter(d=>d>0).length/draws,
  low_pp:differences[Math.floor(draws*.025)],high_pp:differences[Math.floor(draws*.975)]};
}
