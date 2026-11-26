import {readFile} from 'node:fs/promises';
const pkg=JSON.parse(await readFile('package.json','utf8'));const artifact=JSON.parse(await readFile('dist/sdk/artifact.json','utf8'));
if(artifact.gzip_bytes>35*1024)throw new Error('SDK_SIZE_BUDGET');for(const[name,version]of Object.entries({...pkg.dependencies,...pkg.devDependencies}))if(/^[~^*]|latest/.test(String(version)))throw new Error('UNPINNED_DEPENDENCY_'+name);
console.log('PASS · direct versions pinned; SDK below 35 KiB gzip.');console.log('Artifact checks only. Production deployment, PostgreSQL concurrency, browser integration, and load capacity require separate validation.');
