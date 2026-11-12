// Create a funded NEAR testnet account through the public faucet.
// Usage: node scripts/dev-account.mjs <name>.testnet
import { createFaucetAccount, rpc, fmtNear } from './common.mjs';

const accountId = process.argv[2];
if (!accountId || !accountId.endsWith('.testnet')) {
  console.error('usage: node scripts/dev-account.mjs <name>.testnet');
  process.exit(1);
}

if (await rpc.account(accountId)) {
  console.error(accountId + ' already exists');
  process.exit(1);
}

await createFaucetAccount(accountId);
const acct = await rpc.account(accountId);
console.log('created ' + accountId + ' with ' + fmtNear(acct.amount) + ' NEAR. Key saved in .keys/');
