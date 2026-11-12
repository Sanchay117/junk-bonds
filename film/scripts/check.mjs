// Renders a few half-size frames of the film to out/check for a quick look.
//   node scripts/check.mjs 500 600 800
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';

mkdirSync('out/check', { recursive: true });
for (const frame of process.argv.slice(2)) {
  const id = frame === 'thumb' ? 'Thumbnail' : 'JunkBonds';
  const args = ['remotion', 'still', id, `out/check/${frame}.png`, '--scale=0.5', '--log=error'];
  if (frame !== 'thumb') args.push(`--frame=${frame}`);
  const run = spawnSync('npx', args, { encoding: 'utf8' });
  console.log(frame, run.status === 0 ? 'ok' : run.stderr.slice(-400));
}
