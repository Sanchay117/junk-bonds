// Run the raccoons through some rounds so a new deployment opens with history on its
// charts. It joins as a guest through the doorbell, like the page does, then fast-forwards.
//
//   node scripts/warmup.mjs [rounds]
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, rpc, sleep } from './common.mjs';
import { Signer, newKeyPair, TGAS } from '../web/src/lib/near.js';

const config = JSON.parse(readFileSync(join(ROOT, 'web/src/config.json'), 'utf8'));
const C = config.contractId;
const target = Number(process.argv[2] || 60);

const name = 'opener' + Date.now().toString(36).slice(-5);
const keys = newKeyPair();
const bell = new Signer(rpc, C, config.doorbellKeys[0]);
const joined = await bell.call(C, 'join', { name, public_key: keys.publicKey }, { gas: 60n * TGAS });
if (joined.value !== true) throw new Error('could not join as ' + name);
const me = name + '.' + C;
for (let i = 0; i < 20 && !(await rpc.account(me).catch(() => null)); i++) await sleep(700);
const guest = new Signer(rpc, me, keys.secretKey);

let done = 0;
while (done < target) {
  const out = await guest.call(C, 'fast_forward', { rounds: 12 }, { gas: 80n * TGAS });
  done += out.value;
  process.stdout.write('\r' + done + ' rounds');
  if (!out.value) await sleep(5000);
}
await sleep(2000);
const w = await rpc.view(C, 'get_world', {});
console.log('\nround ' + w.round + ', supply ' + w.supply + ', minted ' + w.minted + ', burned ' + w.burned + ', ' + w.bonds.length + ' pieces of junk alive');
