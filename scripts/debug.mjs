// Scratch checks against the live contract. Not part of the documented flow.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, rpc } from './common.mjs';
import { Signer, newKeyPair, TGAS } from '../web/src/lib/near.js';

const config = JSON.parse(readFileSync(join(ROOT, 'web/src/config.json'), 'utf8'));
const C = config.contractId;
const bell = new Signer(rpc, C, config.doorbellKeys[0]);

async function attempt(label, fn) {
  try {
    const out = await fn();
    console.log(label + ' -> ok ' + JSON.stringify(out.value));
  } catch (err) {
    console.log(label + ' -> ' + err.message.slice(0, 400));
  }
}

await attempt('refuel unknown guest', () => bell.call(C, 'refuel', { name: 'nobodyhere' }, { gas: 30n * TGAS }));
await attempt('join with a bad name', () => bell.call(C, 'join', { name: 'Bad-Name', public_key: newKeyPair().publicKey }, { gas: 60n * TGAS }));
const players = await rpc.view(C, 'get_players', { limit: 5 });
console.log('players', players.map((p) => p.account));
if (players.length) {
  const name = players[0].account.split('.')[0];
  await attempt('refuel ' + name, () => bell.call(C, 'refuel', { name }, { gas: 30n * TGAS }));
}
try {
  console.log(await rpc.view(C, 'appraise_junk', { token_id: 'bond-99999.' + C }));
} catch (err) {
  console.log('view panic -> ' + err.message.slice(0, 300));
}
