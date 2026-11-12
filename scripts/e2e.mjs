// End-to-end check against the live testnet contract named in web/src/config.json.
// It does what a guest does in the browser: ring the doorbell, bid, settle, fast-forward,
// collect coupons, list junk. Every step prints its transaction hash.
//
//   node scripts/e2e.mjs
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, rpc, sleep, fmtNear } from './common.mjs';
import { Signer, newKeyPair, TGAS } from '../web/src/lib/near.js';

const config = JSON.parse(readFileSync(join(ROOT, 'web/src/config.json'), 'utf8'));
const C = config.contractId;
const tx = (hash) => config.explorer + '/txns/' + hash;
const burnt = (out) => {
  let gas = BigInt(out.outcome.transaction_outcome.outcome.gas_burnt);
  for (const r of out.outcome.receipts_outcome) gas += BigInt(r.outcome.gas_burnt);
  return (Number(gas / 10n ** 10n) / 100).toFixed(2) + ' Tgas';
};
let failures = 0;
function check(label, ok, detail = '') {
  console.log((ok ? '  ok    ' : '  FAIL  ') + label + (detail ? '  ' + detail : ''));
  if (!ok) failures++;
}
async function world(account) {
  return rpc.view(C, 'get_world', { account_id: account });
}
/** Reads can trail a transaction by a block or two. Poll until the view catches up. */
async function until(read, test, what) {
  for (let i = 0; i < 25; i++) {
    const v = await read();
    if (test(v)) return v;
    await sleep(600);
  }
  throw new Error('timed out waiting for ' + what);
}

console.log('contract ' + C);
const rules = await rpc.view(C, 'get_rules', {});
console.log('emission ' + rules.emission + ' per round, stipend ' + rules.stipend + ', residents ' + rules.personas.map((p) => p.name).join(', '));

// 1. Ring the doorbell: a brand-new named NEAR account, no wallet, no faucet, no backend.
const name = 'e2e' + Date.now().toString(36);
const me = name + '.' + C;
const keys = newKeyPair();
const bell = new Signer(rpc, C, config.doorbellKeys[Math.floor(Math.random() * config.doorbellKeys.length)]);
let t = Date.now();
const joined = await bell.call(C, 'join', { name, public_key: keys.publicKey }, { gas: 60n * TGAS });
console.log('\n1. doorbell join -> ' + me + ' in ' + (Date.now() - t) + ' ms, ' + burnt(joined) + '\n   ' + tx(joined.hash));
check('join returned true', joined.value === true, JSON.stringify(joined.value));
const acct = await until(() => rpc.account(me), (a) => a, 'the guest account');
check('guest account exists on chain with gas money', BigInt(acct.amount) > 0n, fmtNear(acct.amount) + ' NEAR');
let w = await until(() => world(me), (v) => v.me.registered, 'enrolment');
check('guest is enrolled with the stipend', w.me.balance === rules.stipend, w.me.balance + ' $TRASH');

// The doorbell key cannot do anything else.
let refused = false;
try {
  await bell.call(C, 'poke', {}, { gas: 30n * TGAS });
} catch (err) {
  refused = /MethodNameMismatch|InvalidAccessKeyError/i.test(err.message);
  if (!refused) console.log('   unexpected error: ' + err.message);
}
check('the doorbell key is refused for any other method', refused);
let cooled = false;
try {
  await bell.call(C, 'refuel', { name }, { gas: 30n * TGAS });
} catch (err) {
  cooled = /refuelled a moment ago/.test(err.message);
  if (!cooled) console.log('   unexpected error: ' + err.message);
}
check('a guest cannot be refuelled straight after joining', cooled);

// 2. Bid on a live lot.
const guest = new Signer(rpc, me, keys.secretKey);
w = await until(() => world(me), (v) => v.lot.phase === 'live' || v.lot.phase === 'done', 'a lot to open');
if (w.lot.phase === 'done') {
  const p = await guest.call(C, 'poke', {}, { gas: 40n * TGAS });
  console.log('\n   settled a stale lot first (' + burnt(p) + ') ' + tx(p.hash));
  w = await until(() => world(me), (v) => v.lot.phase === 'live', 'the next lot to open');
}
console.log('\n2. lot ' + w.lot.round + ': ' + rules.kinds[w.lot.kind] + ', weight ' + w.lot.weight + ', life ' + w.lot.life + ', book ' + w.lot.book + ', next bid ' + w.lot.next);
const lotRound = w.lot.round;
t = Date.now();
const bid = await guest.call(C, 'bid', { amount: String(w.lot.next) }, { gas: 40n * TGAS });
console.log('   bid ' + w.lot.next + ' in ' + (Date.now() - t) + ' ms, ' + burnt(bid) + ' -> ' + JSON.stringify(bid.value) + '\n   ' + tx(bid.hash));
check('bid was answered', bid.value && typeof bid.value.ok === 'boolean');
if (bid.value.ok) {
  w = await until(() => world(me), (v) => v.lot.bids.some((b) => b.who === me), 'the bid to show');
  check('the bid shows in the lot', true, w.lot.bids.length + ' bids so far, locked ' + w.me.locked);
}

// 3. Watch the raccoons answer, then settle the lot when it closes.
let seen = 0;
while (true) {
  w = await world(me);
  if (w.lot.round !== lotRound) break;
  for (const b of w.lot.bids.slice(seen)) console.log('   ' + b.who.split('.')[0].padEnd(10) + String(b.amount).padStart(6) + (b.why === 255 ? '' : '  why=' + b.why));
  seen = w.lot.bids.length;
  if (w.lot.phase === 'done') {
    const p = await guest.call(C, 'poke', {}, { gas: 40n * TGAS });
    console.log('3. poke settled the lot, ' + burnt(p) + '\n   ' + tx(p.hash));
    await until(() => world(me), (v) => v.round > lotRound, 'the next round');
    break;
  }
  await sleep(1200);
}
const hist = await rpc.view(C, 'get_history', { limit: 1 });
const last = hist[hist.length - 1];
console.log('   lot ' + last.round + ' went to ' + (last.winner || 'nobody') + ' for ' + last.price + ', ' + last.bids + ' bids, supply now ' + last.supply);
check('the history has the settled lot', last.round === lotRound);

// 4. Fast-forward: the raccoons trade among themselves.
w = await world(me);
let ran = 0;
for (let i = 0; i < 3; i++) {
  const ff = await guest.call(C, 'fast_forward', { rounds: 12 }, { gas: 120n * TGAS });
  ran += ff.value;
  console.log('4. fast_forward ran ' + ff.value + ' rounds, ' + burnt(ff) + '  ' + tx(ff.hash));
  if (!ff.value) break;
}
const after = await until(() => world(me), (v) => v.round >= w.round + ran, 'fast-forward to show');
check('fast-forward advanced the world', ran > 0 && after.round >= w.round + ran, 'round ' + w.round + ' -> ' + after.round);

// 5. Junk as accounts: coupons sit in the junk's own NEAR account until swept.
const mine = after.bonds.filter((b) => b.owner === me);
if (mine.length) {
  const b = mine[0];
  const onChain = await rpc.view(C, 'ft_balance_of', { account_id: b.token_id });
  const bondAcct = await rpc.account(b.token_id);
  check('the junk is a real NEAR account', !!bondAcct, b.token_id);
  check('its $TRASH balance is its wallet', Number(onChain) === b.wallet, onChain + ' $TRASH');
  const keysOnBond = bondAcct ? await rpc.accessKeys(b.token_id) : [];
  check('the junk account has no access keys', keysOnBond.length === 0);
  const offers = await rpc.view(C, 'appraise_junk', { token_id: b.token_id });
  console.log('   raccoon offers: ' + offers.map((o) => o.account.split('.')[0] + ' ' + o.would_pay).join(', '));
  const sw = await guest.call(C, 'sweep', { token_id: null }, { gas: 30n * TGAS });
  console.log('5. sweep -> ' + sw.value + ' $TRASH, ' + burnt(sw) + '  ' + tx(sw.hash));
  check('sweep paid out the wallet', Number(sw.value) === mine.reduce((n, x) => n + x.wallet, 0));
  const ls = await guest.call(C, 'list', { token_id: b.token_id, ask: String(b.book + 1) }, { gas: 30n * TGAS });
  console.log('   listed for ' + (b.book + 1) + ', ' + burnt(ls) + '  ' + tx(ls.hash));
  const tok = await until(() => rpc.view(C, 'nft_token', { token_id: b.token_id }), (v) => v && JSON.parse(v.metadata.extra).ask !== '0', 'the listing');
  check('nft_token shows the live listing', JSON.parse(tok.metadata.extra).ask === String(b.book + 1), tok.metadata.title);
} else {
  console.log('5. the guest did not win a lot this run, so the junk checks are skipped');
}

// 6. The books.
const end = await world(me);
const holders = end.npcs.reduce((n, x) => n + x.wallet, 0) + end.bonds.reduce((n, x) => n + x.wallet, 0);
const players = await rpc.view(C, 'get_players', { limit: 100 });
const held = holders + players.reduce((n, p) => n + p.balance, 0);
check('every $TRASH is accounted for (raccoons + junk + players = supply)', held === end.supply, held + ' = ' + end.supply);
check('supply = minted - burned', end.minted - end.burned === end.supply, end.minted + ' - ' + end.burned);
await sleep(2500); // let the last gas refunds land
const fuel = await rpc.account(me);
console.log('\nguest gas money left: ' + fmtNear(fuel.amount) + ' NEAR of ' + (rules.guest_fuel_millinear / 1000).toFixed(3) + ' after ' + guest.sent + ' transactions');
console.log(failures ? '\n' + failures + ' CHECK(S) FAILED' : '\nall checks passed');
process.exit(failures ? 1 : 0);
