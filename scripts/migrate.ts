import {openDB,migrate} from '../packages/db/index.js';

import {config} from '../apps/server/config.js';
import {requireOffline} from './local-client.js';
if(!config.databaseUrl)await requireOffline();
const db=await openDB(config.databaseUrl,config.dataDir+'/database');
try{await migrate(db);console.log('Schema v13 applied. Existing data, site keys, approvals and memberships preserved.');}finally{await db.close();}
