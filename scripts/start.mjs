import {existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
// npm start works even when the hosting platform only installs dependencies.
process.chdir(fileURLToPath(new URL('../',import.meta.url)));
if(!existsSync('dist/index.html')){
  const build=spawnSync(process.execPath,['node_modules/vite/bin/vite.js','build'],{stdio:'inherit'});
  if(build.status!==0)process.exit(build.status||1);
}
await import('../server/index.mjs');
