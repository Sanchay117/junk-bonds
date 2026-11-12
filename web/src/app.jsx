import { useEffect, useRef, useState } from 'preact/hooks';
import { game, C, EXPLORER } from './game.js';
import { Certificate, Junk, KINDS, Paddle, Raccoon, paddleNo } from './art.jsx';

const fmt = (n) => Number(n || 0).toLocaleString('en-US');
const short = (id) => (id || '').split('.')[0];
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const WHY = { 0: 'Fair price.', 1: 'Completes my set.', 2: 'I love these.', 3: 'Feeling lucky.', 4: 'Now.', 5: 'Money to burn.' };

function useGame() {
  const [s, set] = useState(game.state);
  useEffect(() => game.subscribe(set), []);
  return s;
}

/** Re-render on a timer and return chain time. */
function useNow(ms = 200) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), ms);
    return () => clearInterval(t);
  }, [ms]);
  return game.now();
}

/** Flash the amount a number just grew by. */
function useGain(value) {
  const prev = useRef(value);
  const [gain, setGain] = useState(null);
  useEffect(() => {
    const grew = value - prev.current;
    prev.current = value;
    if (grew <= 0) return;
    setGain({ n: grew, id: Date.now() });
    const t = setTimeout(() => setGain(null), 1700);
    return () => clearTimeout(t);
  }, [value]);
  return gain;
}

function who(s, account) {
  const i = s.world.npcs.findIndex((n) => n.account === account);
  if (i >= 0) return { npc: i, name: s.rules?.personas[i]?.name || cap(short(account)), title: s.rules?.personas[i]?.title || 'Resident', you: false };
  const you = account === s.session?.accountId;
  return { npc: -1, name: you ? 'You' : cap(short(account)), title: you ? short(account) : 'Player', you };
}

const Account = ({ id, children }) => (
  <a class="acct" href={EXPLORER + '/address/' + id} target="_blank" rel="noreferrer">
    {children || id}
  </a>
);

// ---------------------------------------------------------------------------

export function App() {
  const s = useGame();
  if (!s.world) {
    return (
      <div class="waking">
        <h1 class="wordmark">Junk Bonds</h1>
        <p>{s.offline ? 'Cannot reach NEAR testnet. Still trying.' : 'Waking the alley.'}</p>
      </div>
    );
  }
  return (
    <div class="page">
      <TopBar s={s} />
      <main class="floor">
        <Stage s={s} />
        <Side s={s} />
        <Bidders s={s} />
      </main>
      <Economy s={s} />
      <About s={s} />
      {s.toast && (
        <div class={'toast ' + s.toast.kind} role="status" key={s.toast.id}>
          {s.toast.text}
        </div>
      )}
    </div>
  );
}

function TopBar({ s }) {
  const w = s.world;
  const me = w.me?.registered ? w.me : null;
  const mine = me ? w.bonds.filter((b) => b.owner === me.account) : [];
  const worth = me ? me.balance + mine.reduce((n, b) => n + b.wallet + b.book, 0) : 0;
  return (
    <header class="top">
      <div class="brand">
        <h1 class="wordmark">Junk Bonds</h1>
        <p>The alley exchange. Raccoons auction junk. The junk pays yield until it rots.</p>
      </div>
      <dl class="tape">
        <div>
          <dt>Round</dt>
          <dd>{fmt(w.round)}</dd>
        </div>
        <div>
          <dt>$TRASH supply</dt>
          <dd>{fmt(w.supply)}</dd>
        </div>
        <div>
          <dt>Burned</dt>
          <dd class="burn">{fmt(w.burned)}</dd>
        </div>
        <div>
          <dt>Minted</dt>
          <dd class="mint">{fmt(w.minted)}</dd>
        </div>
      </dl>
      <div class="me">
        {me ? (
          <>
            <span class="me-name">
              <Account id={me.account}>{short(me.account)}</Account>
            </span>
            <span class="me-cash">
              <b>{fmt(me.balance)}</b> $TRASH
            </span>
            <span class="me-worth">worth {fmt(worth)}</span>
          </>
        ) : (
          <span class="me-name">Spectating</span>
        )}
        <span class="net">NEAR testnet</span>
      </div>
    </header>
  );
}

// ---------------------------------------------------------------------------
// The stage: the lot on the block
// ---------------------------------------------------------------------------

function Stage({ s }) {
  const w = s.world;
  const lot = w.lot;
  const now = useNow(100);
  const sold = s.sold && Date.now() - s.sold.at < 3800 && now < lot.opens_ms ? s.sold : null;
  const shown = sold ? sold.lot : lot;
  const live = !sold && now >= lot.opens_ms && now < lot.closes_ms;
  const left = lot.closes_ms - now;

  let call = '';
  if (sold) call = sold.who ? 'Sold to ' + who(s, sold.who).name + ' for ' + fmt(sold.price) : 'No takers. Hauled to the dump.';
  else if (now < lot.opens_ms) call = 'Next lot in ' + Math.max(1, Math.ceil((lot.opens_ms - now) / 1000)) + 's';
  else if (left <= 0) call = s.session ? 'The hammer falls.' : 'The alley is asleep. Jump in to wake it.';
  else if (left <= 2500) call = 'Going twice';
  else if (left <= 5000) call = 'Going once';
  else call = Math.ceil(left / 1000) + 's on the clock';

  const stamp = sold ? <span class={'stamp' + (sold.who ? '' : ' dump')}>{sold.who ? 'Sold' : 'Dump'}</span> : null;
  const leader = lot.leader ? who(s, lot.leader) : null;

  return (
    <section class="stage">
      <div class="stage-head">
        <h2 class="label">Lot {fmt(shown.round)} on the block</h2>
        <p class={'call' + (live && left <= 5000 ? ' hot' : '')}>{call}</p>
      </div>
      <Certificate kind={shown.kind} weight={shown.weight} life={shown.life} serial={shown.round} perRound={shown.per_round} book={shown.book} stamp={stamp} />
      <div class="fuse" aria-hidden="true">
        <i style={{ width: live ? Math.max(0, Math.min(100, (left / (s.rules?.lot_ms || 20000)) * 100)) + '%' : '0%' }} />
      </div>
      {!sold && (
        <div class="standing">
          <div>
            <span class="label">{lot.high ? 'Standing bid' : 'Opens at'}</span>
            <b class="price">{fmt(lot.high || lot.reserve)}</b>
          </div>
          {leader && (
            <div class="standing-who">
              <Raccoon npc={leader.npc} you={leader.you} size={38} />
              <span>
                <b>{leader.name}</b> {leader.you ? 'have' : 'has'} dibs
              </span>
            </div>
          )}
        </div>
      )}
      {!sold && <Controls s={s} live={live} />}
      <Ticker s={s} lot={sold ? sold.lot : lot} />
    </section>
  );
}

function Controls({ s, live }) {
  const w = s.world;
  const lot = w.lot;
  const me = w.me?.registered ? w.me : null;
  const [steps, setSteps] = useState(0);
  useEffect(() => setSteps(0), [lot.round, lot.next]);

  if (!s.session || !me) return <Join s={s} />;

  let amount = lot.next;
  for (let i = 0; i < steps; i++) amount = Math.ceil(amount * 1.1);
  const mine = lot.leader === me.account;
  const free = me.balance - me.locked;
  const held = w.bonds.filter((b) => b.owner === me.account && b.kind === lot.kind).length;
  const cant = !live || mine || s.busy.bid || amount > free;

  let hint = 'Worth about ' + fmt(lot.book) + ' over its life at the size of today’s crowd.';
  if (held === 2) hint = 'You hold two of these. A third makes a set, and all three earn 3/2.';
  else if (mine) hint = 'Your ' + fmt(me.locked) + ' $TRASH is held until someone beats you. If nobody does, it burns and the junk is yours.';
  else if (amount > free) hint = 'That is more than the ' + fmt(free) + ' $TRASH you have free.';
  else if (amount > lot.book) hint = 'That is over book value (' + fmt(lot.book) + '). You would pay more than it is set to pay you.';

  return (
    <div class="controls">
      <div class="bidrow">
        <button class="btn step" onClick={() => setSteps(Math.max(0, steps - 1))} disabled={!steps} aria-label="Lower your bid">
          -
        </button>
        <button class="btn primary" disabled={cant} onClick={() => game.bid(amount)}>
          {s.busy.bid ? 'Calling dibs' : mine ? 'You have dibs' : 'Dibs at ' + fmt(amount)}
        </button>
        <button class="btn step" onClick={() => setSteps(steps + 1)} aria-label="Raise your bid">
          +
        </button>
      </div>
      <p class="hint">{hint}</p>
      <div class="ffrow">
        <button class="btn" disabled={!w.quiet || s.busy.ff} onClick={() => game.fastForward()}>
          {s.busy.ff ? 'Raccoons trading' : 'Fast-forward'}
        </button>
        <span class="hint">
          {w.quiet ? 'Sit out and let the raccoons run a batch of auctions among themselves. Your junk keeps paying.' : 'Fast-forward waits until nobody has bid for 20 seconds.'}
        </span>
      </div>
    </div>
  );
}

function Join({ s }) {
  const [name, setName] = useState('');
  const submit = (e) => {
    e.preventDefault();
    game.join(name);
  };
  return (
    <form class="join" onSubmit={submit}>
      <label class="label" for="name">
        Name your raccoon to bid
      </label>
      <div class="joinrow">
        <input id="name" value={name} onInput={(e) => setName(e.currentTarget.value.toLowerCase())} placeholder="bandit" maxLength={16} autocomplete="off" spellcheck={false} />
        <button class="btn primary" disabled={s.busy.join || name.length < 3}>
          {s.busy.join ? 'Ringing the doorbell' : 'Jump in'}
        </button>
      </div>
      <p class="hint">
        No wallet. The contract makes you a real NEAR account, <b>{name || 'bandit'}.{C}</b>, with {fmt(s.rules?.stipend || 2000)} $TRASH and gas money, in about three seconds.
      </p>
    </form>
  );
}

function Ticker({ s, lot }) {
  const bids = [...lot.bids].reverse().slice(0, 6);
  if (!bids.length) return <p class="ticker-empty">No bids yet. The raccoons move in every 2.5 seconds.</p>;
  return (
    <ol class="ticker">
      {bids.map((b, i) => {
        const p = who(s, b.who);
        return (
          <li key={lot.bids.length - i} class={(i === 0 ? 'top ' : '') + (p.you ? 'you' : '')}>
            <Paddle no={paddleNo(b.who, p.npc)} raised={i === 0} you={p.you} />
            <b>{p.name}</b>
            <span class="say">{b.why === 255 ? 'Dibs.' : WHY[b.why]}</span>
            <span class="amt">{fmt(b.amount)}</span>
          </li>
        );
      })}
    </ol>
  );
}

// ---------------------------------------------------------------------------
// The floor: who is bidding
// ---------------------------------------------------------------------------

function Bidders({ s }) {
  const w = s.world;
  const rows = w.npcs.map((n, i) => {
    const junk = w.bonds.filter((b) => b.owner === n.account);
    const comfort = s.rules?.personas[i]?.comfort || 3000;
    let state = 'calm';
    if (n.wallet > comfort * 1.6) state = 'flush';
    else if (n.wallet < comfort * 0.25) state = 'broke';
    else if (n.mood >= 11500) state = 'hungry';
    else if (n.mood <= 8500) state = 'sated';
    return { account: n.account, wallet: n.wallet, junk: junk.length, worth: n.wallet + junk.reduce((t, b) => t + b.wallet + b.book, 0), state, ...who(s, n.account) };
  });
  const players = s.players
    .map((p) => ({ account: p.account, wallet: p.balance, junk: p.junk, worth: p.balance + p.junk_wallets + p.junk_book, state: p.wins + ' won', ...who(s, p.account) }))
    .sort((a, b) => b.worth - a.worth);
  const you = players.find((p) => p.you);
  const others = players.filter((p) => !p.you).slice(0, 5);
  const all = [...rows, ...(you ? [you] : []), ...others];
  return (
    <aside class="bidders">
      <h2 class="label">The floor</h2>
      <ul>
        {all.map((r) => (
          <li key={r.account} class={(w.lot.leader === r.account ? 'lead ' : '') + (r.you ? 'you' : '')}>
            <Raccoon npc={r.npc} you={r.you} size={42} />
            <div class="who">
              <b>
                <Account id={r.account}>{r.name}</Account>
              </b>
              <span>
                {r.title} · {r.state}
              </span>
            </div>
            <div class="purse">
              <b>{fmt(r.wallet)}</b>
              <span>{r.junk} junk</span>
            </div>
          </li>
        ))}
      </ul>
      <p class="hint">
        Each resident is a NEAR account with its own wallet. Their rules run in the contract, so nobody can patch them. A flush raccoon overpays. A broke one cannot follow you.
      </p>
      <p class="hint">{fmt(w.players)} players have joined.</p>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Your junk, the market, the feed
// ---------------------------------------------------------------------------

function Side({ s }) {
  const w = s.world;
  const me = w.me?.registered ? w.me.account : null;
  const mine = me ? w.bonds.filter((b) => b.owner === me) : [];
  const market = w.bonds.filter((b) => b.ask > 0 && b.owner !== me).sort((a, b) => a.ask / (a.book || 1) - b.ask / (b.book || 1));
  const [tab, setTab] = useState('junk');
  const tabs = [
    ['junk', 'Your junk', mine.length],
    ['market', 'Market', market.length],
    ['feed', 'Feed', null],
  ];
  return (
    <aside class="side">
      <nav class="tabs">
        {tabs.map(([id, text, n]) => (
          <button key={id} class={tab === id ? 'on' : ''} onClick={() => setTab(id)}>
            {text}
            {n != null && <i>{n}</i>}
          </button>
        ))}
      </nav>
      {tab === 'junk' && <Stash s={s} mine={mine} />}
      {tab === 'market' && <Market s={s} market={market} />}
      {tab === 'feed' && <Feed s={s} />}
    </aside>
  );
}

function Stash({ s, mine }) {
  const inside = mine.reduce((n, b) => n + b.wallet, 0);
  if (!s.world.me?.registered) return <p class="empty">Jump in and win a lot. What you win shows up here, paying you every round.</p>;
  if (!mine.length) return <p class="empty">You hold no junk yet. Win a lot, or buy one on the market. It starts paying the round you get it.</p>;
  return (
    <div class="stash">
      <div class="collect">
        <span>
          <b>{fmt(inside)}</b> $TRASH sitting in your junk
        </span>
        <button class="btn small" disabled={!inside || s.busy.sweep} onClick={() => game.sweep()}>
          Collect
        </button>
      </div>
      {mine.map((b) => (
        <Holding key={b.id} s={s} b={b} />
      ))}
    </div>
  );
}

function Holding({ s, b }) {
  const gain = useGain(b.earned);
  const [open, setOpen] = useState(false);
  const [ask, setAsk] = useState('');
  const offers = s.offers?.tokenId === b.token_id ? s.offers.rows : null;
  const best = offers ? Math.max(0, ...offers.map((o) => o.would_pay)) : 0;
  const busy = s.busy['list:' + b.token_id];
  const toggle = () => {
    if (!open) {
      game.appraise(b.token_id);
      setAsk(String(b.book));
    }
    setOpen(!open);
  };
  return (
    <article class={'holding' + (b.in_set ? ' set' : '')}>
      <div class="holding-art">
        <Junk kind={b.kind} size={54} />
      </div>
      <div class="holding-main">
        <h3>
          {KINDS[b.kind]} <span>No. {b.id}</span>
        </h3>
        <p>
          pays <b>{b.per_round}</b> a round · rots in <b>{b.life}</b>
          {b.in_set && <em> · set, earning 3/2</em>}
        </p>
        <p class="holds">
          holds <b>{fmt(b.wallet)}</b> $TRASH
          {gain && (
            <i class="gain" key={gain.id}>
              +{gain.n}
            </i>
          )}
          {b.has_account && <Account id={b.token_id}>its account</Account>}
        </p>
      </div>
      <div class="holding-act">
        {b.ask > 0 ? (
          <button class="btn small" disabled={busy} onClick={() => game.unlist(b.token_id)}>
            Listed {fmt(b.ask)} · pull
          </button>
        ) : (
          <button class="btn small" onClick={toggle}>
            {open ? 'Close' : 'Sell'}
          </button>
        )}
      </div>
      {open && !b.ask && (
        <div class="sell">
          <p class="label">What the raccoons would pay right now</p>
          {offers ? (
            <ul class="offers">
              {offers.map((o) => (
                <li key={o.account} class={o.would_pay === best && best > 0 ? 'best' : ''}>
                  <span>{who(s, o.account).name}</span>
                  <b>{fmt(o.would_pay)}</b>
                  <button class="link" onClick={() => setAsk(String(o.would_pay))} disabled={!o.would_pay}>
                    use
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p class="hint">Asking around.</p>
          )}
          <div class="joinrow">
            <input value={ask} inputMode="numeric" onInput={(e) => setAsk(e.currentTarget.value.replace(/\D/g, ''))} aria-label="Asking price" />
            <button class="btn small solid" disabled={busy || !Number(ask)} onClick={() => game.list(b.token_id, Number(ask)).then(() => setOpen(false))}>
              List it
            </button>
          </div>
          <p class="hint">
            Book value is {fmt(b.book)}. A raccoon buys between lots if your ask is at or under what it would pay. The {fmt(b.wallet)} $TRASH inside goes with it, so collect first. 5% of the sale is burned.
          </p>
        </div>
      )}
    </article>
  );
}

function Market({ s, market }) {
  const me = s.world.me?.registered ? s.world.me : null;
  const free = me ? me.balance - me.locked : 0;
  if (!market.length) return <p class="empty">Nothing for sale right now. Flip lists everything it wins, so check back after the next lot.</p>;
  return (
    <div class="market">
      {market.map((b) => (
        <article class="holding" key={b.id}>
          <div class="holding-art">
            <Junk kind={b.kind} size={54} />
          </div>
          <div class="holding-main">
            <h3>
              {KINDS[b.kind]} <span>No. {b.id}</span>
            </h3>
            <p>
              pays <b>{b.per_round}</b> a round · rots in <b>{b.life}</b>
            </p>
            <p class="holds">
              {who(s, b.owner).name} asks <b>{fmt(b.ask)}</b> · book {fmt(b.book)}
              {b.wallet > 0 && <> · holds {fmt(b.wallet)}</>}
            </p>
          </div>
          <div class="holding-act">
            <button class={'btn small' + (b.ask + 0 <= b.book + b.wallet ? ' solid' : '')} disabled={!me || free < b.ask || s.busy['buy:' + b.token_id]} onClick={() => game.buy(b.token_id, b.ask)}>
              Buy {fmt(b.ask)}
            </button>
          </div>
        </article>
      ))}
    </div>
  );
}

function Feed({ s }) {
  const lines = [...s.world.feed].reverse().map((f, i) => {
    const a = f.who ? who(s, f.who).name : '';
    const k = KINDS[f.kind];
    let text;
    if (f.what === 0) text = [<b>{a}</b>, ' won a ' + k + ' for ' + fmt(f.amount) + '. Burned.'];
    else if (f.what === 1) text = ['A ' + k + ' found no takers and went to the dump.'];
    else if (f.what === 2) text = [<b>{a === 'You' ? 'Your' : a + '’s'}</b>, ' ' + k + ' rotted' + (f.amount ? ', paying out the ' + fmt(f.amount) + ' it still held.' : '.')];
    else if (f.what === 3) text = [<b>{a}</b>, ' bought a ' + k + ' from ' + who(s, f.other).name + ' for ' + fmt(f.amount) + '.'];
    else if (f.what === 4) text = [<b>{a}</b>, ' listed a ' + k + ' at ' + fmt(f.amount) + '.'];
    else text = [<b>{a}</b>, ' joined the alley with ' + fmt(f.amount) + ' $TRASH.'];
    return (
      <li key={i}>
        <span class="rd">{f.round}</span>
        <span>{text}</span>
      </li>
    );
  });
  return <ol class="feed">{lines}</ol>;
}

// ---------------------------------------------------------------------------
// The economy
// ---------------------------------------------------------------------------

function Economy({ s }) {
  const h = s.history.slice(-90);
  if (h.length < 3) return null;
  const W = 900;
  const H = 150;
  const step = W / h.length;
  const emission = s.rules?.emission || 1000;
  const top = Math.max(emission * 1.6, ...h.map((r) => r.price));
  const y = (v) => H - (v / top) * H;
  const sMin = Math.min(...h.map((r) => r.supply));
  const sMax = Math.max(...h.map((r) => r.supply));
  const sy = (v) => 60 - ((v - sMin) / Math.max(1, sMax - sMin)) * 52;
  const line = h.map((r, i) => (i ? 'L' : 'M') + (i * step + step / 2).toFixed(1) + ' ' + sy(r.supply).toFixed(1)).join(' ');
  const minted = h.reduce((n, r) => n + r.minted, 0);
  const burned = h.reduce((n, r) => n + r.burned, 0);
  return (
    <section class="economy">
      <div class="economy-head">
        <h2 class="display">The only way to get junk is to burn $TRASH. The only way to get $TRASH is to hold junk.</h2>
        <p>
          Over the last {h.length} rounds the alley minted <b class="mint">{fmt(minted)}</b> and burned <b class="burn">{fmt(burned)}</b>. Flush raccoons overbid, which burns more than a round mints. Broke raccoons underbid, which burns less. Nobody steers it.
        </p>
      </div>
      <figure>
        <figcaption class="label">What each lot sold for, against the 1,000 minted that round</figcaption>
        <svg viewBox={'0 0 ' + W + ' ' + (H + 18)} class="chart" role="img" aria-label="Price of each lot over recent rounds">
          {h.map((r, i) => (
            <rect key={r.round} x={i * step + 1} y={y(r.price)} width={Math.max(1, step - 2)} height={H - y(r.price)} class={r.human ? 'bar human' : 'bar'}>
              <title>
                Lot {r.round}: {r.price ? fmt(r.price) + ' to ' + short(r.winner) : 'no sale'}
              </title>
            </rect>
          ))}
          <line x1="0" x2={W} y1={y(emission)} y2={y(emission)} class="ref" />
          <text x={W - 4} y={y(emission) - 5} text-anchor="end" class="ref-label">
            1,000 minted per round
          </text>
          <text x="0" y={H + 14} class="axis">
            round {h[0].round}
          </text>
          <text x={W} y={H + 14} text-anchor="end" class="axis">
            round {h[h.length - 1].round}
          </text>
        </svg>
        <p class="legend">
          <i class="sw" /> won by a raccoon <i class="sw human" /> won by a player
        </p>
      </figure>
      <figure>
        <figcaption class="label">
          $TRASH supply, {fmt(sMin)} to {fmt(sMax)}
        </figcaption>
        <svg viewBox={'0 0 ' + W + ' 66'} class="chart" role="img" aria-label="Token supply over recent rounds">
          <path d={line} class="supply" />
        </svg>
      </figure>
    </section>
  );
}

// ---------------------------------------------------------------------------
// The story and the proof
// ---------------------------------------------------------------------------

function About({ s }) {
  const view = (m, args) => 'near view ' + C + ' ' + m + " '" + args + "' --networkId testnet";
  return (
    <section class="about">
      <div class="col">
        <h2 class="display">Why a bond</h2>
        <p>
          Bonds used to be paper. The interest was printed along the edge as coupons, and each period you cut one off and handed it in for cash. Nobody kept a register of owners. Whoever held the paper got paid. That is a bearer bond.
        </p>
        <p>
          A junk bond here works the same way. The token is a NEAR account, <b>bond-17.{C}</b>. Its coupons land in that account every round. The account has no keys and no code, so the only way to reach the money is to hold the token. Sell it and the wallet goes with it, in the same transaction.
        </p>
        <p>The joke is the rating. A real junk bond is rated below investment grade. These are rated below that. They are a traffic cone.</p>
      </div>
      <div class="col">
        <h2 class="display">The rules</h2>
        <ol class="rules">
          <li>
            Every round, 1,000 $TRASH is minted and split by weight between all living junk. The five residents scavenge a small share.
          </li>
          <li>Every winning bid is burned. So is 5% of every market sale.</li>
          <li>Junk rots after 14 to 36 rounds. Three of a kind is a set and earns 3/2.</li>
          <li>There is no owner and no setter. Every number is a constant in one file, and get_rules returns all of them.</li>
        </ol>
      </div>
      <div class="col">
        <h2 class="display">Check it yourself</h2>
        <p>
          Everything on this page is read straight from one contract, <Account id={C} />. There is no server and no indexer behind it.
        </p>
        <pre>{view('get_rules', '{}')}</pre>
        <pre>{view('ft_balance_of', '{"account_id":"duchess.' + C + '"}')}</pre>
        <pre>{view('nft_tokens', '{"limit":3}')}</pre>
        {s.txs.length > 0 && (
          <>
            <h3 class="label">Your transactions this session</h3>
            <ol class="txs">
              {s.txs.slice(0, 8).map((t) => (
                <li key={t.hash}>
                  <a href={EXPLORER + '/txns/' + t.hash} target="_blank" rel="noreferrer">
                    {t.label}
                  </a>
                </li>
              ))}
            </ol>
          </>
        )}
        {s.session && (
          <button class="link" onClick={() => confirm('Forget this guest account on this device? You cannot get it back.') && game.leave()}>
            Forget this guest and start over
          </button>
        )}
      </div>
      <footer>
        <p>Built at NEAR HACKATHON, November 2026. Runs on NEAR testnet. $TRASH is worth nothing, as it should be.</p>
      </footer>
    </section>
  );
}
