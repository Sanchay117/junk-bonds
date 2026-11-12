// Synthesises the film's sound with ffmpeg: a low alley drone to sit under the voice, a stamp
// thud, a paddle tick and a coin. Writes public/audio/*.wav. No samples, nothing licensed.
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'audio');
mkdirSync(out, { recursive: true });

function ffmpeg(name, inputs, filter) {
  const args = ['-y', '-loglevel', 'error'];
  for (const i of inputs) args.push('-f', 'lavfi', '-i', i);
  args.push('-filter_complex', filter, '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s16le', join(out, name));
  const run = spawnSync('ffmpeg', args, { encoding: 'utf8' });
  if (run.status !== 0) throw new Error(name + ': ' + run.stderr);
  console.log('wrote audio/' + name);
}

// The bed: an open fifth on E with a slow swell, a higher voice that drifts in and out, and
// brown noise for air. 100 seconds, so any cut of the film fits under it.
const D = 100;
ffmpeg(
  'bed.wav',
  [`sine=f=41.2:d=${D}`, `sine=f=82.41:d=${D}`, `sine=f=123.47:d=${D}`, `sine=f=164.81:d=${D}`, `sine=f=246.94:d=${D}`, `anoisesrc=d=${D}:c=brown:a=0.5`],
  '[0]volume=0.5[a];[1]volume=0.34,tremolo=f=0.11:d=0.5[b];[2]volume=0.2,tremolo=f=0.13:d=0.7[c];[3]volume=0.13,tremolo=f=0.17:d=0.8[d];[4]volume=0.07,tremolo=f=0.1:d=0.9[e];' +
    '[5]lowpass=f=300,volume=0.1[n];[a][b][c][d][e][n]amix=inputs=6:normalize=0,lowpass=f=1400,afade=t=in:d=3,volume=0.8',
);

// The stamp: a low body that drops in pitch, and the slap of the pad.
ffmpeg(
  'stamp.wav',
  ['sine=f=58:d=0.5', 'anoisesrc=d=0.5:c=white:a=0.9'],
  '[0]afade=t=out:st=0.02:d=0.42:curve=exp,volume=1.6[body];[1]highpass=f=900,lowpass=f=5200,afade=t=out:st=0:d=0.07:curve=exp,volume=0.5[slap];[body][slap]amix=inputs=2:normalize=0',
);

// A paddle going up.
ffmpeg('tick.wav', ['sine=f=1180:d=0.09'], '[0]afade=t=out:st=0:d=0.09:curve=exp,volume=0.35');

// A coupon landing: two quick notes.
ffmpeg(
  'coin.wav',
  ['sine=f=1318.5:d=0.3', 'sine=f=1975.5:d=0.3'],
  '[0]afade=t=out:st=0:d=0.14:curve=exp,volume=0.3[a];[1]adelay=70|70,afade=t=out:st=0.07:d=0.22:curve=exp,volume=0.26[b];[a][b]amix=inputs=2:normalize=0',
);
