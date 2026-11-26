// Suggested project market settings from a website's country-code domain.
// Generic domains (.com, .net, .io …) return null: the owner picks the market.
export type MarketDefaults={market:string;currency:string;report_timezone:string;locale:string};
const byTld:Record<string,MarketDefaults>={
 ro:{market:'RO',currency:'RON',report_timezone:'Europe/Bucharest',locale:'ro-RO'},
 md:{market:'MD',currency:'MDL',report_timezone:'Europe/Chisinau',locale:'ro-MD'},
 uk:{market:'UK',currency:'GBP',report_timezone:'Europe/London',locale:'en-GB'},
 ie:{market:'IE',currency:'EUR',report_timezone:'Europe/Dublin',locale:'en-IE'},
 de:{market:'DE',currency:'EUR',report_timezone:'Europe/Berlin',locale:'de-DE'},
 at:{market:'AT',currency:'EUR',report_timezone:'Europe/Vienna',locale:'de-AT'},
 ch:{market:'CH',currency:'CHF',report_timezone:'Europe/Zurich',locale:'de-CH'},
 fr:{market:'FR',currency:'EUR',report_timezone:'Europe/Paris',locale:'fr-FR'},
 be:{market:'BE',currency:'EUR',report_timezone:'Europe/Brussels',locale:'nl-BE'},
 nl:{market:'NL',currency:'EUR',report_timezone:'Europe/Amsterdam',locale:'nl-NL'},
 es:{market:'ES',currency:'EUR',report_timezone:'Europe/Madrid',locale:'es-ES'},
 pt:{market:'PT',currency:'EUR',report_timezone:'Europe/Lisbon',locale:'pt-PT'},
 it:{market:'IT',currency:'EUR',report_timezone:'Europe/Rome',locale:'it-IT'},
 gr:{market:'GR',currency:'EUR',report_timezone:'Europe/Athens',locale:'el-GR'},
 pl:{market:'PL',currency:'PLN',report_timezone:'Europe/Warsaw',locale:'pl-PL'},
 cz:{market:'CZ',currency:'CZK',report_timezone:'Europe/Prague',locale:'cs-CZ'},
 sk:{market:'SK',currency:'EUR',report_timezone:'Europe/Bratislava',locale:'sk-SK'},
 hu:{market:'HU',currency:'HUF',report_timezone:'Europe/Budapest',locale:'hu-HU'},
 bg:{market:'BG',currency:'BGN',report_timezone:'Europe/Sofia',locale:'bg-BG'},
 hr:{market:'HR',currency:'EUR',report_timezone:'Europe/Zagreb',locale:'hr-HR'},
 rs:{market:'RS',currency:'RSD',report_timezone:'Europe/Belgrade',locale:'sr-RS'},
 se:{market:'SE',currency:'SEK',report_timezone:'Europe/Stockholm',locale:'sv-SE'},
 no:{market:'NO',currency:'NOK',report_timezone:'Europe/Oslo',locale:'nb-NO'},
 dk:{market:'DK',currency:'DKK',report_timezone:'Europe/Copenhagen',locale:'da-DK'},
 fi:{market:'FI',currency:'EUR',report_timezone:'Europe/Helsinki',locale:'fi-FI'},
 us:{market:'US',currency:'USD',report_timezone:'America/New_York',locale:'en-US'},
 ca:{market:'CA',currency:'CAD',report_timezone:'America/Toronto',locale:'en-CA'},
 au:{market:'AU',currency:'AUD',report_timezone:'Australia/Sydney',locale:'en-AU'},
};
export function marketForHost(hostname:string):MarketDefaults|null{
 const tld=hostname.toLowerCase().replace(/\.$/,'').split('.').pop()??'';
 return byTld[tld==='gb'?'uk':tld]??null;
}
export const marketCodePattern=/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,63}$/;
export function validTimeZone(zone:string){try{new Intl.DateTimeFormat('en',{timeZone:zone});return true;}catch{return false;}}
