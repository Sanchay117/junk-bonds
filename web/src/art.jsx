// Everything drawn by hand: the eight kinds of junk, the raccoons, the paddle and the
// bond certificate. All SVG, no image files.

export const KINDS = ['Pizza Box', 'Traffic Cone', 'Shopping Cart', 'Lone Sock', 'Dead TV', 'Garden Gnome', 'Bent Umbrella', 'Disco Ball'];

// All of it rates as junk. The heavier the piece, the less bad the rating.
export const RATING = { 6: 'CCC+', 5: 'CCC', 4: 'CC', 3: 'C', 2: 'D' };

const VIGNETTES = [
  // Pizza Box
  <g>
    <path d="M18 64 60 46 102 64 60 84Z" />
    <path d="M18 64V78L60 98 102 78V64M60 84V98" />
    <path d="M18 64 28 32 70 16 60 46" />
    <ellipse cx="60" cy="65" rx="15" ry="7" />
    <path d="M52 64h1M61 67h1M66 62h1" />
  </g>,
  // Traffic Cone
  <g>
    <path d="M53 18H67L88 92H32Z" />
    <path d="M47 42H73M40 66H80" />
    <path d="M18 92H102V104H18Z" />
  </g>,
  // Shopping Cart
  <g>
    <path d="M12 28H27L40 78H92L103 40H31" />
    <path d="M47 40 50 78M63 40V78M79 40 76 78M36 59H98" />
    <circle cx="49" cy="93" r="7" />
    <circle cx="85" cy="93" r="7" />
  </g>,
  // Lone Sock
  <g>
    <path d="M46 14H74V62L96 82Q105 92 95 101 84 108 72 99L46 77Z" />
    <path d="M46 28H74M78 66 63 86M86 96 92 88" />
  </g>,
  // Dead TV
  <g>
    <rect x="16" y="38" width="88" height="62" rx="6" />
    <rect x="26" y="48" width="52" height="42" rx="4" />
    <path d="M60 38 42 14M60 38 80 16" />
    <circle cx="91" cy="58" r="4" />
    <circle cx="91" cy="74" r="4" />
    <path d="M34 82 47 67 43 61 58 53" />
  </g>,
  // Garden Gnome
  <g>
    <path d="M60 8 40 52H80Z" />
    <path d="M48 52Q46 66 60 68 74 66 72 52" />
    <path d="M46 62Q60 108 74 62" />
    <path d="M40 106Q36 78 47 72M80 106Q84 78 73 72M32 106H88" />
    <path d="M55 58h1M65 58h1" />
  </g>,
  // Bent Umbrella
  <g>
    <path d="M14 60Q60 2 106 60 94 49 83 60 71 49 60 60 49 49 37 60 26 49 14 60Z" />
    <path d="M60 60 67 84 54 97Q49 106 59 108" />
    <path d="M60 14V8" />
  </g>,
  // Disco Ball
  <g>
    <path d="M60 6V28" />
    <circle cx="60" cy="62" r="34" />
    <path d="M26 62H94M30 46H90M30 78H90M60 28V96M44 32Q35 62 44 92M76 32Q85 62 76 92" />
    <path d="M100 14 103 22 111 25 103 28 100 36 97 28 89 25 97 22Z" />
  </g>,
];

export function Junk({ kind, size = 120 }) {
  return (
    <svg class="junk" viewBox="0 0 120 120" width={size} height={size} role="img" aria-label={KINDS[kind]}>
      {VIGNETTES[kind]}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Raccoons
// ---------------------------------------------------------------------------

const PROPS = [
  // Duchess: a small crown
  <path d="M34 22 38 8 46 18 50 6 54 18 62 8 66 22Z" fill="var(--sodium)" stroke="var(--ink)" stroke-width="2" />,
  // Pockets: a beanie
  <g>
    <path d="M26 30Q50 -2 74 30Z" fill="var(--rust)" stroke="var(--ink)" stroke-width="2" />
    <path d="M24 30H76" stroke="var(--ink)" stroke-width="5" stroke-linecap="round" />
  </g>,
  // Flip: a bookkeeper's green eyeshade
  <path d="M22 34Q50 14 78 34L86 40Q50 26 14 40Z" fill="var(--engrave)" stroke="var(--ink)" stroke-width="2" />,
  // Yolo: shades
  <g>
    <path d="M24 44H46V54Q35 60 24 54ZM54 44H76V54Q65 60 54 54Z" fill="var(--sodium)" stroke="var(--ink)" stroke-width="2" />
    <path d="M46 46H54" stroke="var(--ink)" stroke-width="2" />
  </g>,
  // Snatch: an eye patch
  <g>
    <path d="M22 30 78 50" stroke="var(--ink)" stroke-width="2.5" />
    <ellipse cx="64" cy="48" rx="10" ry="8" fill="var(--ink)" />
  </g>,
];

/** A raccoon. `npc` 0 to 4 is a resident with its prop. A player gets a plain face. */
export function Raccoon({ npc = -1, size = 44, you = false }) {
  const shades = npc === 3;
  return (
    <svg class={'raccoon' + (you ? ' you' : '')} viewBox="0 0 100 100" width={size} height={size} aria-hidden="true">
      <path d="M18 34 14 8 38 22ZM82 34 86 8 62 22Z" fill="var(--fur)" stroke="var(--ink)" stroke-width="2.5" stroke-linejoin="round" />
      <path d="M22 26 19 14 30 20ZM78 26 81 14 70 20Z" fill="var(--ink)" />
      <path d="M50 16Q88 16 90 52 86 88 50 92 14 88 10 52 12 16 50 16Z" fill="var(--fur)" stroke="var(--ink)" stroke-width="2.5" />
      <path d="M50 18V34M42 20 44 32M58 20 56 32" stroke="var(--ink)" stroke-width="2" opacity=".45" />
      {!shades && <path d="M12 50Q30 34 48 46 50 48 52 46 70 34 88 50 78 66 60 60 52 56 50 58 48 56 40 60 22 66 12 50Z" fill="var(--ink)" />}
      {!shades && (
        <g>
          <circle cx="34" cy="50" r="6" fill="var(--paper)" />
          <circle cx="66" cy="50" r="6" fill="var(--paper)" />
          <circle cx="35" cy="51" r="2.6" fill="var(--ink)" />
          <circle cx="65" cy="51" r="2.6" fill="var(--ink)" />
        </g>
      )}
      <path d="M50 58Q70 60 66 78 58 90 50 90 42 90 34 78 30 60 50 58Z" fill="var(--paper)" stroke="var(--ink)" stroke-width="2" />
      <path d="M43 68H57L50 76Z" fill="var(--ink)" />
      <path d="M50 76V82M50 82Q45 86 41 82M50 82Q55 86 59 82" fill="none" stroke="var(--ink)" stroke-width="2" stroke-linecap="round" />
      {npc >= 0 && PROPS[npc]}
    </svg>
  );
}

/** A two-digit paddle number for a player, stable for their name. */
export function paddleNo(account, npcIndex) {
  if (npcIndex >= 0) return npcIndex + 1;
  let h = 7;
  for (const ch of account) h = (h * 31 + ch.charCodeAt(0)) % 9973;
  return 10 + (h % 90);
}

export function Paddle({ no, raised = false, you = false }) {
  return (
    <svg class={'paddle' + (raised ? ' raised' : '') + (you ? ' you' : '')} viewBox="0 0 40 56" width="30" height="42" aria-hidden="true">
      <rect x="17" y="30" width="6" height="24" rx="2" />
      <circle cx="20" cy="19" r="17" />
      <text x="20" y="25" text-anchor="middle">
        {no}
      </text>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// The certificate
// ---------------------------------------------------------------------------

function Weight({ weight }) {
  return (
    <span class="pips" aria-label={'weight ' + weight + ' of 6'}>
      {[1, 2, 3, 4, 5, 6].map((i) => (
        <i class={i <= weight ? 'on' : ''} />
      ))}
    </span>
  );
}

/** The coupon strip: one stub for every round the junk has left. */
export function Coupons({ life, max = 36 }) {
  return (
    <div class="coupons" aria-label={life + ' coupons left'}>
      {Array.from({ length: Math.min(life, max) }, (_, i) => (
        <i key={i} />
      ))}
    </div>
  );
}

/**
 * A junk bond as a bearer certificate. Used large for the lot on the block and for the
 * junk you hold.
 */
export function Certificate({ kind, weight, life, serial, perRound, book, stamp, children }) {
  return (
    <article class="cert">
      <div class="cert-in">
        <header>
          <span class="cert-house">The Alley Exchange</span>
          <span class="cert-serial">No. {String(serial).padStart(5, '0')}</span>
        </header>
        <div class="cert-body">
          <div class="cert-vignette">
            <Junk kind={kind} size={148} />
          </div>
          <div class="cert-text">
            <p class="cert-kicker">Bearer junk bond</p>
            <h2>
              One <em>{KINDS[kind]}</em>
            </h2>
            <p class="cert-promise">
              Pays the bearer a share of 1,000 $TRASH every round, by weight, until it rots. Whoever holds this certificate holds its wallet.
            </p>
            <dl class="cert-specs">
              <div>
                <dt>Weight</dt>
                <dd>
                  <Weight weight={weight} />
                </dd>
              </div>
              <div>
                <dt>Rots in</dt>
                <dd>
                  <b>{life}</b> rounds
                </dd>
              </div>
              <div>
                <dt>Pays about</dt>
                <dd>
                  <b>{perRound}</b> a round
                </dd>
              </div>
              <div>
                <dt>Book value</dt>
                <dd>
                  <b>{book.toLocaleString('en-US')}</b>
                </dd>
              </div>
            </dl>
          </div>
        </div>
        <Coupons life={life} />
        <span class="cert-rating">Rated {RATING[weight] || 'D'}</span>
        {stamp}
        {children}
      </div>
    </article>
  );
}
