import {spawn} from 'node:child_process';
// A single retained process serves the built dashboard, collector and worker.
const build=spawn(process.execPath,['--import','tsx','scripts/build.ts'],{stdio:'inherit'});
build.on('exit',code=>{if(code)process.exit(code);const server=spawn(process.execPath,['--import','tsx','apps/server/main.ts'],{stdio:'inherit'});server.on('exit',c=>process.exit(c||0));process.on('SIGINT',()=>server.kill('SIGINT'));});
