// Refill the doorbell: send testnet NEAR from a fresh faucet account to the contract.
// Anyone can run this. The contract only needs a balance, it does not care who sent it.
//
//   node scripts/topup.mjs [times]
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, rpc, createFaucetAccount, fmtNear, sleep } from './common.mjs';
import { actions, near } from '../web/src/lib/near.js';

const config = JSON.parse(readFileSync(join(ROOT, 'web/src/config.json'), 'utf8'));
const C = config.contractId;
const times = Number(process.argv[2] || 1);

for (let i = 0; i < times; i++) {
  const donorId = 'jb-fuel-' + Date.now().toString(36) + i + '.testnet';
  const donor = await createFaucetAccount(donorId);
  let acct = null;
  for (let t = 0; t < 20 && !acct; t++) {
    acct = await rpc.account(donorId).catch(() => null);
    if (!acct) await sleep(700);
  }
  const give = BigInt(acct.amount) - near('0.05');
  await donor.send(C, [actions.transfer(give)]);
  console.log('sent ' + fmtNear(give) + ' NEAR to ' + C + ' from ' + donorId);
  await sleep(1500);
}
console.log(C + ' now holds ' + fmtNear((await rpc.account(C)).amount) + ' NEAR');
