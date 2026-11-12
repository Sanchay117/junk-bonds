// Print the current gas price and what a given transaction actually burned.
//   node scripts/gas.mjs [tx hash] [signer account]
import { rpc, fmtNear } from './common.mjs';

const price = await rpc.call('gas_price', [null]);
console.log('gas price: ' + price.gas_price + ' yocto per gas = ' + (Number(price.gas_price) / 1e12).toFixed(6) + ' NEAR per Tgas');

const [hash, signer] = process.argv.slice(2);
if (hash) {
  const out = await rpc.call('tx', { tx_hash: hash, sender_account_id: signer, wait_until: 'FINAL' });
  let gas = BigInt(out.transaction_outcome.outcome.gas_burnt);
  let tokens = BigInt(out.transaction_outcome.outcome.tokens_burnt);
  for (const r of out.receipts_outcome) {
    gas += BigInt(r.outcome.gas_burnt);
    tokens += BigInt(r.outcome.tokens_burnt);
  }
  console.log('gas burnt: ' + (Number(gas / 10n ** 9n) / 1000).toFixed(3) + ' Tgas, tokens burnt: ' + fmtNear(tokens) + ' NEAR (' + tokens + ' yocto)');
}
