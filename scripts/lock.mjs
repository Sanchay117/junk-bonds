// Throw away the key. Deletes the contract account's full-access key, after which nobody
// can redeploy the code or move the account's NEAR, ever. The doorbell keys stay, and they
// can only call join and refuel.
//
// This cannot be undone. It asks you to type the account name to confirm.
//
//   node scripts/lock.mjs <name>.testnet
import { createInterface } from 'node:readline/promises';
import { rpc, loadSigner } from './common.mjs';
import { actions } from '../web/src/lib/near.js';

const contractId = process.argv[2];
if (!contractId) {
  console.error('usage: node scripts/lock.mjs <name>.testnet');
  process.exit(1);
}
const owner = loadSigner(contractId);
const rl = createInterface({ input: process.stdin, output: process.stdout });
const typed = await rl.question('This permanently removes the only full-access key of ' + contractId + '.\nType the account name to go ahead: ');
rl.close();
if (typed.trim() !== contractId) {
  console.log('Not locked.');
  process.exit(0);
}
const out = await owner.send(contractId, [actions.deleteKey(owner.publicKey)]);
console.log('locked: ' + out.hash);
const keys = await rpc.accessKeys(contractId);
console.log('keys left: ' + keys.map((k) => (k.access_key.permission === 'FullAccess' ? 'FULL ACCESS' : 'function call ' + k.access_key.permission.FunctionCall.method_names.join('+'))).join(', '));
