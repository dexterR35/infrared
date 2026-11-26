import path from 'node:path';
import {fileURLToPath} from 'node:url';
// Runtime files resolve from the project root, not the shell's working directory,
// so starting Infrared from another folder still finds its build, migrations and data.
export const projectRoot=path.resolve(fileURLToPath(new URL('../..',import.meta.url)));
export const fromRoot=(...parts:string[])=>path.resolve(projectRoot,...parts);
