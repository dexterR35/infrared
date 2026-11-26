import type {FastifyRequest} from 'fastify';
import type {DB} from '../../packages/db/index.js';
import {Problem} from './security.js';

export interface WorkspaceUser {id:string;email:string;role:string;csrf:string}
export type CurrentUser=(req:FastifyRequest)=>WorkspaceUser;

export function requireEditor(user:WorkspaceUser){
 if(!['owner','administrator'].includes(user.role))throw new Problem(403,'INSUFFICIENT_PERMISSION');
}
export async function accessibleSiteIds(db:DB,user:WorkspaceUser):Promise<string[]>{
 const rows=await db.query(user.role==='owner'
  ?'SELECT id FROM sites WHERE NOT archived'
  :'SELECT s.id FROM sites s JOIN site_memberships m ON m.site_id=s.id WHERE m.user_id=$1 AND NOT s.archived',user.role==='owner'?[]:[user.id]);
 return rows.map(s=>s.id);
}
export async function requireSiteAccess(db:DB,user:WorkspaceUser,id:string){
 const [site]=await db.query('SELECT * FROM sites WHERE id=$1 AND NOT archived',[id]);
 if(!site||user.role!=='owner'&&!(await db.query('SELECT 1 FROM site_memberships WHERE user_id=$1 AND site_id=$2',[user.id,id])).length)throw new Problem(404,'SITE_NOT_FOUND');
 return site;
}
