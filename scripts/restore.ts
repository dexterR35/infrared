import path from 'node:path';
import {openDB} from '../packages/db/index.js';
import {config} from '../apps/server/config.js';
import {requireOffline} from './local-client.js';
import {restoreBackup} from '../apps/server/backup-service.js';
await requireOffline();const source=process.argv[2];
if(!source||!path.isAbsolute(source))throw new Error('Usage: pnpm restore <absolute-backup-directory>');
const db=await openDB(config.databaseUrl,config.dataDir+'/database');
try{await restoreBackup(db,config.dataDir,source);console.log('Backup verified and restored into an empty database. Sessions excluded.');}
finally{await db.close();}
