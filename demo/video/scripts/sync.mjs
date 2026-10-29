// Copies the latest capture (manifest + screenshots) and the desk fonts into public/.
// Run before preview/render so the video always reflects demo/shots as it is now.
import {cpSync, rmSync, mkdirSync, existsSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const video = join(here, '..');
const repo = join(video, '..', '..');
const shots = join(repo, 'demo', 'shots');
const pub = join(video, 'public');

cpSync(join(repo, 'azalea-ehelpdesk', 'assets', 'fonts'), join(pub, 'fonts'), {recursive: true});
if (!existsSync(join(shots, 'manifest.json'))) {
  // A capture run may be rewriting demo/shots right now; fall back to the last copy if we have one.
  if (existsSync(join(pub, 'shots', 'manifest.json'))) {
    console.warn('demo/shots/manifest.json is missing (capture running?). Using the last synced copy.');
    process.exit(0);
  }
  console.error('No demo/shots/manifest.json yet. Run the capture first.');
  process.exit(1);
}
rmSync(join(pub, 'shots'), {recursive: true, force: true});
mkdirSync(join(pub, 'shots'), {recursive: true});
for (const part of ['manifest.json', 'desktop', 'phone']) {
  if (existsSync(join(shots, part))) cpSync(join(shots, part), join(pub, 'shots', part), {recursive: true});
}
console.log('Synced demo/shots and fonts into', pub);
