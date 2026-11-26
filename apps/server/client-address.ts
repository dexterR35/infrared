import {BlockList,isIP} from 'node:net';
import type {FastifyRequest} from 'fastify';
import {config} from '../../packages/config/index.js';

// Addresses allowed to speak for the visitor: a configured edge proxy and loopback.
// TRUSTED_PROXIES takes a comma-separated list of IPs or CIDR ranges, such as 172.16.0.0/12.
export function trustedProxies(value=process.env.TRUSTED_PROXIES||''){
 const list=new BlockList();list.addAddress('127.0.0.1','ipv4');list.addAddress('::1','ipv6');list.addAddress('::ffff:127.0.0.1','ipv6');
 for(const entry of value.split(',').map(v=>v.trim()).filter(Boolean)){
  const parts=entry.split('/'),[address,bits]=parts,family=isIP(address);
  if(!family||parts.length>2||(bits!==undefined&&!/^(0|[1-9][0-9]*)$/.test(bits)))throw new Error('TRUSTED_PROXIES_INVALID');
  const type=family===4?'ipv4':'ipv6';
  if(bits===undefined)list.addAddress(address,type);
  else{const prefix=Number(bits);if(!Number.isInteger(prefix)||prefix<0||prefix>(family===4?32:128))throw new Error('TRUSTED_PROXIES_INVALID');list.addSubnet(address,prefix,type);}
 }
 return list;
}
let proxies=trustedProxies();
export const setTrustedProxies=(value:string)=>{proxies=trustedProxies(value);};

const trusted=(address:string)=>{const family=isIP(address);return family>0&&proxies.check(address,family===4?'ipv4':'ipv6');};
const fromTrustedEdge=(req:FastifyRequest)=>config.trustedEdge==='cloudflare'&&trusted(req.socket.remoteAddress??'');
// A reverse proxy (nginx, Caddy, a load balancer) appends the address it received the request from.
// Walk X-Forwarded-For from the right and stop at the first hop that is not a trusted proxy:
// entries further left were written by the caller and cannot be trusted.
function forwardedClient(req:FastifyRequest){
 const header=req.headers['x-forwarded-for'];
 if(config.trustedEdge!=='proxy'||!trusted(req.socket.remoteAddress??'')||typeof header!=='string'||header.length>2048)return null;
 const hops=header.split(',').map(v=>v.trim());
 for(let i=hops.length-1;i>=0;i--){const hop=hops[i];if(!isIP(hop))return null;if(!trusted(hop))return hop;}
 return null;
}

// The visitor's address for rate limits only. It is never stored.
export function clientAddress(req:FastifyRequest){
 const header=req.headers['cf-connecting-ip'];
 if(fromTrustedEdge(req)&&typeof header==='string'&&isIP(header))return header;
 return forwardedClient(req)??req.socket.remoteAddress??req.ip;
}
// Cloudflare's country code, only from the trusted edge. XX and T1 mean unknown and Tor.
export function edgeCountry(req:FastifyRequest){
 const header=req.headers['cf-ipcountry'];
 return fromTrustedEdge(req)&&typeof header==='string'&&/^[A-Z]{2}$/.test(header)&&header!=='XX'&&header!=='T1'?header:null;
}
