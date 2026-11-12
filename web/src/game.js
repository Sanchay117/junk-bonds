// The game's only state: what the contract says, who you are, and what you are doing.
// There is no backend. Every read is a view call and every action is a transaction
// signed in this tab with the guest key kept in localStorage.

import config from './config.json';
import { Rpc, Signer, newKeyPair, TGAS } from './lib/near.js';

export const C = config.contractId;
export const EXPLORER = config.explorer;
export const rpc = new Rpc(config.rpcUrls);

const STORE = 'junkbonds:' + C;
const POLL_MS = 1200;

function readSession() {
  try {
    return JSON.parse(localStorage.getItem(STORE));
  } catch {
    return null;
  }
}

function writeSession(session) {
  try {
    if (session) localStorage.setItem(STORE, JSON.stringify(session));
    else localStorage.removeItem(STORE);
  } catch {
    // Private windows can refuse storage. The session then lasts until the tab closes.
  }
}

/** Turn a contract or RPC error into one plain sentence. */
function plain(err) {
  const m = String(err?.message || err);
  if (/NotEnoughBalance|LackBalanceForState/.test(m)) return 'Out of gas money. Give it a minute, the doorbell tops you up.';
  if (/that name is taken|already exists|AccountAlreadyExists/i.test(m)) return 'That name is taken. Try another.';
  if (/alley is full/.test(m)) return 'The alley is full right now. Try again in a few minutes.';
  if (/doorbell is out of NEAR/.test(m)) return 'The doorbell has run out of gas money for new guests. Send testnet NEAR to ' + C + ' to refill it.';
  if (/names are 3 to 16/.test(m)) return 'Names are 3 to 16 characters: a to z and 0 to 9, starting with a letter.';
  if (/not enough \$TRASH/.test(m)) return 'Not enough $TRASH.';
  if (/no such junk/.test(m)) return 'That junk is gone. It may have rotted.';
  if (/the price went up/.test(m)) return 'The price changed. Look again.';
  if (/not for sale/.test(m)) return 'Someone got there first.';
  if (/Failed to fetch|NetworkError|no rpc endpoint|rpc http/i.test(m)) return 'Cannot reach NEAR testnet right now. Retrying.';
  return m.length > 140 ? m.slice(0, 140) + '...' : m;
}

class Game {
  constructor() {
    this.listeners = new Set();
    this.state = {
      world: null,
      rules: null,
      history: [],
      players: [],
      session: readSession(),
      busy: {},
      txs: [],
      toast: null,
      offline: false,
      offers: null,
      sold: null,
    };
    this.signer = this.state.session ? new Signer(rpc, this.state.session.accountId, this.state.session.secretKey) : null;
    this.clock = null;
    this.pokedRound = 0;
    this.lastRound = 0;
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  set(patch) {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn(this.state);
  }

  /** Chain time in ms, advanced by the wall clock between polls and never running backwards. */
  now() {
    if (!this.clock) return Date.now();
    return this.clock.chain + (performance.now() - this.clock.wall);
  }

  toast(text, kind = 'note') {
    const toast = { text, kind, id: Date.now() };
    this.set({ toast });
    setTimeout(() => this.state.toast === toast && this.set({ toast: null }), 4200);
  }

  async start() {
    rpc.view(C, 'get_rules', {}).then((rules) => this.set({ rules })).catch(() => {});
    const loop = async () => {
      if (!document.hidden) await this.poll();
      setTimeout(loop, POLL_MS);
    };
    loop();
    setInterval(() => this.checkFuel(), 45_000);
  }

  async poll() {
    try {
      const asked = this.state.session?.accountId ?? null;
      const world = await rpc.view(C, 'get_world', { account_id: asked });
      // Public RPC nodes are not always on the same block. Never step back to an older one,
      // or a lot that just sold would flicker back onto the block.
      const shown = this.state.world;
      if (shown && (world.round < shown.round || world.now_ms < shown.now_ms)) return;
      if (asked !== (this.state.session?.accountId ?? null)) return; // the session changed while this was in flight
      if (!this.clock || world.now_ms > this.now()) this.clock = { chain: world.now_ms, wall: performance.now() };

      // A stored guest that this contract does not know (it was redeployed): start over.
      if (this.state.session && world.me && !world.me.registered && !this.state.busy.join) {
        this.signer = null;
        writeSession(null);
        this.set({ session: null });
      }

      const prev = this.state.world;
      let sold = this.state.sold;
      if (prev && world.round > prev.round) {
        const won = [...world.feed].reverse().find((f) => f.round === prev.lot.round && (f.what === 0 || f.what === 1));
        sold = { round: prev.lot.round, lot: prev.lot, who: won && won.what === 0 ? won.who : null, price: won ? won.amount : 0, at: Date.now() };
      }
      this.set({ world, offline: false, sold });

      if (world.round !== this.lastRound) {
        this.lastRound = world.round;
        this.refreshSlow(world);
      }

      // A closed lot needs one transaction from anyone to settle. Send it, once.
      if (world.lot.phase === 'done' && this.signer && world.me?.registered && this.pokedRound !== world.round) {
        this.pokedRound = world.round;
        setTimeout(() => {
          this.signer
            .call(C, 'poke', {}, { gas: 30n * TGAS })
            .then((out) => this.logTx('Settled lot ' + world.round, out.hash))
            .catch(() => (this.pokedRound = 0));
        }, Math.random() * 600);
      }
    } catch (err) {
      this.set({ offline: true });
    }
  }

  async refreshSlow(world) {
    try {
      const from = Math.max(0, world.players - 100);
      const [history, players] = await Promise.all([rpc.view(C, 'get_history', { limit: 120 }), rpc.view(C, 'get_players', { from_index: from, limit: 100 })]);
      this.set({ history, players });
    } catch {
      // The next round will try again.
    }
  }

  logTx(label, hash) {
    this.set({ txs: [{ label, hash, at: Date.now() }, ...this.state.txs].slice(0, 40) });
  }

  async run(key, label, fn) {
    if (this.state.busy[key]) return null;
    this.set({ busy: { ...this.state.busy, [key]: true } });
    try {
      const out = await fn();
      if (out?.hash) this.logTx(label, out.hash);
      return out;
    } catch (err) {
      this.toast(plain(err), 'bad');
      return null;
    } finally {
      const busy = { ...this.state.busy };
      delete busy[key];
      this.set({ busy });
      this.poll();
    }
  }

  bell() {
    const keys = config.doorbellKeys;
    return new Signer(rpc, C, keys[Math.floor(Math.random() * keys.length)]);
  }

  /** Ring the doorbell: the contract creates <name>.<contract> for a key made in this tab. */
  async join(name) {
    name = name.trim().toLowerCase();
    if (!/^[a-z][a-z0-9]{2,15}$/.test(name)) {
      this.toast('Names are 3 to 16 characters: a to z and 0 to 9, starting with a letter.', 'bad');
      return;
    }
    await this.run('join', 'Joined as ' + name, async () => {
      const keys = newKeyPair();
      const out = await this.bell().call(C, 'join', { name, public_key: keys.publicKey }, { gas: 60n * TGAS });
      if (out.value !== true) throw new Error('that name is taken');
      const session = { name, accountId: name + '.' + C, secretKey: keys.secretKey };
      writeSession(session);
      this.signer = new Signer(rpc, session.accountId, session.secretKey);
      this.set({ session });
      return out;
    });
  }

  leave() {
    writeSession(null);
    this.signer = null;
    this.set({ session: null, txs: [] });
  }

  async bid(amount) {
    const out = await this.run('bid', 'Dibs at ' + amount, () => this.signer.call(C, 'bid', { amount: String(amount) }, { gas: 30n * TGAS }));
    if (!out) return;
    const r = out.value || {};
    if (r.ok) return;
    if (r.reason === 'outbid') this.toast('Someone got in first. Next dibs is ' + r.next + '.', 'bad');
    else if (r.reason === 'sold') this.toast('Too late. That lot is gone.', 'bad');
    else if (r.reason === 'not open yet') this.toast('Not open yet.', 'bad');
    else this.toast(r.reason ? r.reason[0].toUpperCase() + r.reason.slice(1) + '.' : 'That did not land.', 'bad');
  }

  /** Let the raccoons trade among themselves. Each call runs as many rounds as fit in one transaction. */
  async fastForward(calls = 4) {
    await this.run('ff', 'Fast-forward', async () => {
      let last = null;
      let total = 0;
      for (let i = 0; i < calls; i++) {
        last = await this.signer.call(C, 'fast_forward', { rounds: 12 }, { gas: 80n * TGAS });
        this.logTx('Fast-forward ' + last.value + ' rounds', last.hash);
        total += last.value;
        await this.poll();
        if (!last.value) break;
      }
      if (!total) this.toast('The alley is not quiet. Someone bid in the last 20 seconds.', 'bad');
      return null;
    });
  }

  async sweep(tokenId = null) {
    const out = await this.run('sweep', 'Collected coupons', () => this.signer.call(C, 'sweep', { token_id: tokenId }, { gas: 20n * TGAS }));
    if (out && Number(out.value) > 0) this.toast('Collected ' + Number(out.value).toLocaleString('en-US') + ' $TRASH.', 'good');
  }

  list(tokenId, ask) {
    return this.run('list:' + tokenId, 'Listed junk for ' + ask, () => this.signer.call(C, 'list', { token_id: tokenId, ask: String(ask) }, { gas: 20n * TGAS }));
  }

  unlist(tokenId) {
    return this.run('list:' + tokenId, 'Took junk off the market', () => this.signer.call(C, 'unlist', { token_id: tokenId }, { gas: 20n * TGAS }));
  }

  async buy(tokenId, ask) {
    const out = await this.run('buy:' + tokenId, 'Bought junk for ' + ask, () => this.signer.call(C, 'buy', { token_id: tokenId, max_price: String(ask) }, { gas: 40n * TGAS }));
    if (out) this.toast('Yours. Its wallet came with it.', 'good');
  }

  async appraise(tokenId) {
    this.set({ offers: { tokenId, rows: null } });
    try {
      const rows = await rpc.view(C, 'appraise_junk', { token_id: tokenId });
      this.set({ offers: { tokenId, rows } });
    } catch (err) {
      this.set({ offers: null });
      this.toast(plain(err), 'bad');
    }
  }

  /** Guests pay their own gas from the NEAR the doorbell gave them. Top up before it runs dry. */
  async checkFuel() {
    const s = this.state.session;
    if (!s || document.hidden) return;
    try {
      const acct = await rpc.account(s.accountId);
      if (acct && BigInt(acct.amount) < 120n * 10n ** 21n) {
        await this.bell().call(C, 'refuel', { name: s.name }, { gas: 30n * TGAS });
      }
    } catch {
      // Refuels are rate-limited by the contract. Try again on the next check.
    }
  }
}

export const game = new Game();
