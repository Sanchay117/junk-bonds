// Deploy Junk Bonds to NEAR testnet and write the web config.
//
//   node scripts/deploy.mjs <name>.testnet            first deploy: create, fund, deploy, init, add doorbell keys
//   node scripts/deploy.mjs <name>.testnet --upgrade  redeploy the code only (state must be compatible)
//
// The account's full-access key is kept in .keys/ (never committed). The doorbell keys are
// written to web/src/config.json and ARE committed: they are public by design (see README).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, WASM, RPC_URLS, rpc, createFaucetAccount, loadSigner, fmtNear, sleep } from './common.mjs';
import { actions, near, newKeyPair, TGAS } from '../web/src/lib/near.js';

const contractId = process.argv[2];
const upgrade = process.argv.includes('--upgrade');
if (!contractId || !contractId.endsWith('.testnet')) {
  console.error('usage: node scripts/deploy.mjs <name>.testnet [--upgrade]');
  process.exit(1);
}
if (!existsSync(WASM)) {
  console.error('build the contract first: (cd contract && cargo build --target wasm32-unknown-unknown --release)');
  process.exit(1);
}
const code = new Uint8Array(readFileSync(WASM));
const DOORBELLS = 3;
const TARGET_NEAR = BigInt(process.env.TARGET_NEAR || 38); // about 6 NEAR is storage for the code; the rest fuels guests

async function waitFor(check, what) {
  for (let i = 0; i < 20; i++) {
    const v = await check().catch(() => null);
    if (v) return v;
    await sleep(700);
  }
  throw new Error('timed out waiting for ' + what);
}

let owner;
if (await rpc.account(contractId)) {
  owner = loadSigner(contractId);
  console.log(contractId + ' exists, using the key in .keys/');
} else {
  owner = await createFaucetAccount(contractId);
  await waitFor(() => rpc.account(contractId), 'the new account');
  console.log('created ' + contractId);
}

if (upgrade) {
  const out = await owner.send(contractId, [actions.deployContract(code)]);
  console.log('upgraded code: ' + out.hash);
  process.exit(0);
}

// Top up from throwaway faucet accounts until there is enough for storage and guest fuel.
for (let i = 1; BigInt((await rpc.account(contractId)).amount) < near(TARGET_NEAR); i++) {
  const donorId = contractId.replace('.testnet', '') + '-fund' + Date.now().toString(36) + i + '.testnet';
  const donor = await createFaucetAccount(donorId);
  const acct = await waitFor(() => rpc.account(donorId), 'the faucet account');
  const give = BigInt(acct.amount) - near('0.05');
  await donor.send(contractId, [actions.transfer(give)]);
  await sleep(1500);
  console.log('topped up ' + fmtNear(give) + ' NEAR from ' + donorId);
}

const doorbells = Array.from({ length: DOORBELLS }, () => newKeyPair());
const deployed = await owner.send(contractId, [
  actions.deployContract(code),
  actions.functionCall('new', {}, 250n * TGAS),
  // The doorbell: keys that can call join and refuel on this contract and nothing else,
  // each with a gas allowance so that even a flood of junk calls cannot spend more than this.
  ...doorbells.map((k) => actions.addFunctionCallKey(k.publicKey, contractId, ['join', 'refuel'], near('3'))),
]);
console.log('deployed, initialised and hung the doorbells: ' + deployed.hash);

const config = {
  network: 'testnet',
  contractId,
  rpcUrls: RPC_URLS,
  explorer: 'https://testnet.nearblocks.io',
  // PUBLIC BY DESIGN. These are function-call access keys limited to the methods `join`
  // and `refuel` on the game contract. They cannot move funds, deploy code or call
  // anything else, and the contract rate-limits both methods.
  doorbellKeys: doorbells.map((k) => k.secretKey),
};
writeFileSync(join(ROOT, 'web/src/config.json'), JSON.stringify(config, null, 2) + '\n');
console.log('wrote web/src/config.json');

const world = await waitFor(() => rpc.view(contractId, 'get_world', {}), 'the contract to answer');
const acct = await rpc.account(contractId);
console.log('round ' + world.round + ', supply ' + world.supply + ' $TRASH, ' + world.bonds.length + ' pieces of junk');
console.log('contract balance ' + fmtNear(acct.amount) + ' NEAR, storage ' + acct.storage_usage + ' bytes');
console.log(config.explorer + '/address/' + contractId);
