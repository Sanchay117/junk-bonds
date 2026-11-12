// The film's scenes. Two are type and drawing (Hook, Money), two are built from the game's own
// components (Name, Close), and Footage plays the recording of the real game.

import type { CSSProperties, ReactNode } from "react";
import { AbsoluteFill, Easing, interpolate, OffthreadVideo, Sequence, spring, staticFile, useCurrentFrame } from "remotion";
import { Certificate, Raccoon } from "./art.tsx";
import { cue, FPS, type Plan, type Shot } from "./plan.ts";
import { C, F, REPO, SITE } from "./theme.ts";

const W = 1920;
const H = 1080;
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const ease = Easing.bezier(0.2, 0.8, 0.2, 1);

/** 0 to 1 over `d` frames starting at `at`. */
const rise = (f: number, at: number, d = 12) => interpolate(f, [at, at + d], [0, 1], { ...clamp, easing: ease });
const pop = (f: number, at: number) => spring({ frame: f - at, fps: FPS, config: { damping: 13, stiffness: 170, mass: 0.7 } });
/** A stamp landing: big and faint, then small and solid, with a little overshoot. */
const slam = (f: number, at: number) => {
  const t = spring({ frame: f - at, fps: FPS, config: { damping: 11, stiffness: 240, mass: 0.6 } });
  return { opacity: f < at ? 0 : Math.min(1, t * 1.6), scale: interpolate(t, [0, 1], [2.6, 1]) };
};

const Backdrop = () => (
  <AbsoluteFill
    style={{
      background: `radial-gradient(1500px 800px at 50% -220px, rgba(242,179,61,.13), transparent 70%), ${C.alley}`,
    }}
  />
);

const label: CSSProperties = { font: `500 22px/1.2 ${F.data}`, letterSpacing: "0.16em", textTransform: "uppercase", color: C.dim };

// ---------------------------------------------------------------------------
// Captions
// ---------------------------------------------------------------------------

export function Captions({ shot }: { shot: Shot }) {
  const f = useCurrentFrame();
  const words = shot.take.words;
  const chunks: { from: number; to: number }[] = [];
  let start = 0;
  words.forEach((w, i) => {
    const sentenceEnd = /[.?!]$/.test(w.text);
    const softEnd = /,$/.test(w.text) && i - start >= 6;
    if (sentenceEnd || softEnd || i - start >= 11 || i === words.length - 1) {
      chunks.push({ from: start, to: i });
      start = i + 1;
    }
  });
  const frameOf = (i: number) => shot.voiceAt + Math.round(words[i].start * FPS);
  const current = chunks.filter((c) => f >= frameOf(c.from) - 4).at(-1);
  if (!current) return null;
  const last = shot.voiceAt + Math.round(words[current.to].end * FPS);
  const opacity = Math.min(rise(f, frameOf(current.from) - 4, 5), interpolate(f, [last + 14, last + 22], [1, 0], clamp));
  return (
    <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: 58 }}>
      <div style={{ opacity, maxWidth: 1560, padding: "15px 34px 17px", background: "rgba(18,19,21,.86)", borderLeft: `6px solid ${C.sodium}`, font: `500 40px/1.3 ${F.text}`, color: C.paper, textAlign: "center" }}>
        {words.slice(current.from, current.to + 1).map((w, i) => (
          <span key={i} style={{ opacity: f >= frameOf(current.from + i) - 1 ? 1 : 0.38 }}>
            {w.text}{" "}
          </span>
        ))}
      </div>
    </AbsoluteFill>
  );
}

// ---------------------------------------------------------------------------
// 1. The hook: the narration itself, set large
// ---------------------------------------------------------------------------

export function Hook({ shot }: { shot: Shot }) {
  const f = useCurrentFrame();
  const words = shot.take.words;
  const split = words.findIndex((w) => w.text.endsWith(".")) + 1;
  const frameOf = (i: number) => shot.voiceAt + Math.round(words[i].start * FPS);
  const hot = new Set(["wallet", "scripts", "server."]);
  const second = rise(f, frameOf(split) - 6, 10);
  const line = (from: number, to: number) =>
    words.slice(from, to).map((w, i) => {
      const t = rise(f, frameOf(from + i) - 2, 9);
      return (
        <span key={i} style={{ display: "inline-block", marginRight: "0.26em", opacity: t, transform: `translateY(${(1 - t) * 26}px)`, color: hot.has(w.text) ? C.sodium : C.paper, fontStyle: hot.has(w.text) ? "italic" : "normal" }}>
          {w.text}
        </span>
      );
    });
  return (
    <AbsoluteFill>
      <Backdrop />
      <div style={{ position: "absolute", left: 150, top: 150, ...label, opacity: rise(f, 2) }}>The problem</div>
      <div style={{ position: "absolute", left: 150, top: 220, width: 1560, font: `500 112px/1.07 ${F.display}`, letterSpacing: "-0.02em", opacity: 1 - second * 0.68 }}>{line(0, split)}</div>
      <div style={{ position: "absolute", left: 150, top: 640, width: 1560, font: `500 96px/1.07 ${F.display}`, letterSpacing: "-0.02em" }}>{line(split, words.length)}</div>
    </AbsoluteFill>
  );
}

// ---------------------------------------------------------------------------
// 2. The name: the wordmark, the five raccoons, one certificate
// ---------------------------------------------------------------------------

const RESIDENTS = [
  ["Duchess", "Old Money", "4,120"],
  ["Pockets", "The Hoarder", "5,574"],
  ["Flip", "The Flipper", "5,857"],
  ["Yolo", "The Degen", "365"],
  ["Snatch", "The Sniper", "4,938"],
];

function Floor({ f, at, step = 5 }: { f: number; at: number; step?: number }) {
  return (
    <div style={{ position: "absolute", left: 150, top: 330, width: 640 }}>
      {RESIDENTS.map(([name, title, wallet], i) => {
        const t = pop(f, at + i * step);
        return (
          <div key={name} style={{ display: "grid", gridTemplateColumns: "104px 1fr auto", alignItems: "center", gap: 22, padding: "13px 0", borderBottom: `1px solid ${C.kerb}`, opacity: Math.min(1, t * 1.5), transform: `translateX(${(1 - t) * -60}px)` }}>
            <Raccoon npc={i} size={96} />
            <div>
              <div style={{ font: `500 50px/1.05 ${F.display}`, color: C.paper }}>{name}</div>
              <div style={{ font: `400 21px/1.3 ${F.data}`, color: C.dim }}>{title}</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ font: `500 34px/1.1 ${F.data}`, color: C.chalk }}>{wallet}</div>
              <div style={{ font: `400 18px/1.3 ${F.data}`, color: C.dim }}>$TRASH</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** The game's certificate component, scaled up for the film. */
function Bond({ life, stamp, children, style }: { life: number; stamp?: ReactNode; children?: ReactNode; style?: CSSProperties }) {
  return (
    <div style={{ position: "absolute", width: 760, transformOrigin: "0 0", ...style }}>
      <Certificate kind={1} weight={5} life={life} serial={17} perRound={31} book={life * 31} stamp={stamp}>
        {children}
      </Certificate>
    </div>
  );
}

export function Name({ shot }: { shot: Shot }) {
  const f = useCurrentFrame();
  const mark = pop(f, 4);
  const cert = pop(f, cue(shot, "auction"));
  const yieldAt = cue(shot, "yield");
  const rotAt = cue(shot, "rots");
  const life = Math.round(interpolate(f, [yieldAt + 8, rotAt + 4], [30, 0], clamp));
  const rot = slam(f, rotAt + 2);
  return (
    <AbsoluteFill>
      <Backdrop />
      <div style={{ position: "absolute", left: 144, top: 86, font: `700 176px/0.9 ${F.black}`, color: C.paper, opacity: Math.min(1, mark * 1.4), transform: `scale(${interpolate(mark, [0, 1], [1.12, 1])})`, transformOrigin: "0 50%" }}>Junk Bonds</div>
      <Floor f={f} at={cue(shot, "five")} />
      <Bond
        life={life}
        style={{ left: 900, top: 300, opacity: Math.min(1, cert * 1.4), transform: `translateX(${(1 - cert) * 160}px) rotate(${interpolate(cert, [0, 1], [5, -1.2])}deg) scale(1.2)` }}
        stamp={
          <span className="stamp dump" style={{ opacity: rot.opacity, transform: `translate(-50%,-50%) rotate(-13deg) scale(${rot.scale})` }}>
            Rotted
          </span>
        }
      />
      {[0, 1, 2, 3].map((i) => {
        const t = interpolate(f, [yieldAt + i * 9, yieldAt + i * 9 + 26], [0, 1], clamp);
        return (
          <div key={i} style={{ position: "absolute", left: 1320 + i * 92, top: 820 - t * 120, font: `600 54px/1 ${F.data}`, color: C.sodium, opacity: t === 0 ? 0 : interpolate(t, [0, 0.2, 0.8, 1], [0, 1, 1, 0]) }}>
            +31
          </div>
        );
      })}
    </AbsoluteFill>
  );
}

// ---------------------------------------------------------------------------
// 3. Footage of the real game
// ---------------------------------------------------------------------------

export function Footage({ shot, tag }: { shot: Shot; tag: string }) {
  const f = useCurrentFrame();
  const keys = shot.focus;
  const at = keys.map((k) => k.at);
  const track = (pick: (k: (typeof keys)[number]) => number) => (keys.length > 1 ? interpolate(f, at, keys.map(pick), { ...clamp, easing: Easing.inOut(Easing.cubic) }) : pick(keys[0]));
  const z = track((k) => k.z);
  const x = Math.min(0, Math.max(W * (1 - z), W * (0.5 - track((k) => k.cx) * z)));
  const y = Math.min(0, Math.max(H * (1 - z), H * (0.5 - track((k) => k.cy) * z)));
  const flash = shot.cuts.length > 1 ? interpolate(f, [shot.cuts[1].at - 1, shot.cuts[1].at, shot.cuts[1].at + 7], [0, 0.55, 0], clamp) : 0;
  return (
    <AbsoluteFill style={{ background: C.alley }}>
      <div style={{ position: "absolute", width: W, height: H, transformOrigin: "0 0", transform: `translate(${x}px, ${y}px) scale(${z})` }}>
        {shot.cuts.map((cut, i) => (
          <Sequence key={i} from={cut.at} durationInFrames={cut.frames} layout="none">
            <OffthreadVideo src={staticFile("capture/site.mp4")} startFrom={Math.max(0, Math.round(cut.src * FPS))} muted style={{ width: W, height: H }} />
          </Sequence>
        ))}
      </div>
      <AbsoluteFill style={{ background: C.paper, opacity: flash }} />
      <AbsoluteFill style={{ boxShadow: "inset 0 0 220px rgba(0,0,0,.55)" }} />
      <div style={{ position: "absolute", left: 44, top: 38, padding: "11px 18px 10px", background: "rgba(18,19,21,.88)", ...label, fontSize: 19, color: C.chalk, opacity: rise(f, 4) }}>
        <span style={{ color: C.rust }}>&#9679;</span> {tag}
      </div>
    </AbsoluteFill>
  );
}

// ---------------------------------------------------------------------------
// 4. The money: what is minted, what is burned, and what that does to the supply
// ---------------------------------------------------------------------------

// Supply every 60 rounds over the repo's 600-round test of raccoons alone, before and after
// the rule that makes flush raccoons overbid.
const BEFORE = [15000, 34077, 57609, 83427, 112924, 140019, 167864, 193508, 219711, 243777, 270392];
const AFTER = [15000, 28514, 34339, 32887, 35505, 36144, 35622, 35838, 35116, 34772, 36068];

export function Money({ shot }: { shot: Shot }) {
  const f = useCurrentFrame();
  const mint = rise(f, cue(shot, "thousand") - 3, 14);
  const burn = rise(f, cue(shot, "every") - 3, 14);
  const rich = rise(f, cue(shot, "rich") - 3, 14);
  const beforeT = interpolate(f, [cue(shot, "rich"), cue(shot, "rich") + 34], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  const afterT = interpolate(f, [cue(shot, "supply") - 6, cue(shot, "supply") + 40], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  const strike = rise(f, cue(shot, "burned") - 2, 8);

  const cw = 860;
  const ch = 520;
  const px = (i: number) => (i / 10) * cw;
  const py = (v: number) => ch - (v / 290000) * ch;
  const path = (data: number[]) => data.map((v, i) => `${i ? "L" : "M"}${px(i).toFixed(1)} ${py(v).toFixed(1)}`).join(" ");
  const row = (t: number): CSSProperties => ({ opacity: t, transform: `translateY(${(1 - t) * 30}px)`, marginBottom: 44 });
  const big: CSSProperties = { font: `500 104px/1 ${F.display}`, letterSpacing: "-0.02em" };
  const small: CSSProperties = { font: `400 34px/1.3 ${F.text}`, color: C.chalk, marginTop: 10 };

  return (
    <AbsoluteFill>
      <Backdrop />
      <div style={{ position: "absolute", left: 150, top: 120, ...label, opacity: rise(f, 2) }}>The money</div>
      <div style={{ position: "absolute", left: 150, top: 200, width: 760 }}>
        <div style={row(mint)}>
          <div style={{ ...big, color: C.mint }}>+1,000</div>
          <div style={small}>$TRASH minted each round, to whoever holds junk</div>
        </div>
        <div style={row(burn)}>
          <div style={{ ...big, color: C.burn, position: "relative", display: "inline-block" }}>
            Every bid
            <div style={{ position: "absolute", left: -8, top: "54%", height: 8, width: `calc(${strike * 100}% + 16px)`, background: C.rust }} />
          </div>
          <div style={small}>that wins a lot is burned</div>
        </div>
        <div style={row(rich)}>
          <div style={{ font: `500 68px/1.05 ${F.display}`, color: C.paper }}>Rich raccoons overbid.</div>
          <div style={small}>That burns more than a round mints.</div>
        </div>
      </div>

      <div style={{ position: "absolute", left: 990, top: 250, width: cw, opacity: rise(f, cue(shot, "rich") - 12, 12) }}>
        <div style={{ ...label, marginBottom: 26 }}>$TRASH supply over 600 rounds</div>
        <svg width={cw} height={ch + 4} viewBox={`0 -2 ${cw} ${ch + 4}`} style={{ overflow: "visible" }}>
          <line x1={0} x2={cw} y1={ch} y2={ch} stroke={C.kerb} strokeWidth={2} />
          <line x1={0} x2={0} y1={0} y2={ch} stroke={C.kerb} strokeWidth={2} />
          <path d={path(BEFORE)} fill="none" stroke={C.burn} strokeWidth={5} strokeDasharray="14 12" opacity={0.75} clipPath="url(#before)" />
          <path d={path(AFTER)} fill="none" stroke={C.paper} strokeWidth={7} strokeLinejoin="round" clipPath="url(#after)" />
          <defs>
            <clipPath id="before">
              <rect x={-10} y={-20} width={(cw + 20) * beforeT} height={ch + 40} />
            </clipPath>
            <clipPath id="after">
              <rect x={-10} y={-20} width={(cw + 20) * afterT} height={ch + 40} />
            </clipPath>
          </defs>
        </svg>
        <div style={{ position: "absolute", right: 190, top: 40, textAlign: "right", opacity: interpolate(beforeT, [0.7, 1], [0, 1], clamp) }}>
          <div style={{ font: `500 46px/1 ${F.display}`, color: C.burn }}>270,392</div>
          <div style={{ font: `400 21px/1.4 ${F.data}`, color: C.dim }}>before that rule</div>
        </div>
        <div style={{ position: "absolute", right: 0, top: ch - 128, textAlign: "right", opacity: interpolate(afterT, [0.7, 1], [0, 1], clamp) }}>
          <div style={{ font: `500 46px/1 ${F.display}`, color: C.paper }}>about 35,000</div>
          <div style={{ font: `400 21px/1.4 ${F.data}`, color: C.dim }}>with it</div>
        </div>
        <div style={{ marginTop: 18, font: `400 21px/1.4 ${F.data}`, color: C.dim }}>raccoons alone, from the tests in the repo</div>
      </div>
    </AbsoluteFill>
  );
}

// ---------------------------------------------------------------------------
// 5. The close
// ---------------------------------------------------------------------------

function Tag({ f, at, children, tilt }: { f: number; at: number; children: ReactNode; tilt: number }) {
  const s = slam(f, at);
  return (
    <div style={{ display: "inline-block", marginRight: 34, padding: "12px 26px 8px", border: `7px double ${C.rust}`, color: C.rust, font: `700 62px/1 ${F.display}`, letterSpacing: "0.04em", textTransform: "uppercase", opacity: s.opacity, transform: `rotate(${tilt}deg) scale(${s.scale})` }}>
      {children}
    </div>
  );
}

export function Close({ shot }: { shot: Shot }) {
  const f = useCurrentFrame();
  const mark = pop(f, cue(shot, "junk") - 4);
  const lines = rise(f, cue(shot, "built") - 4, 16);
  return (
    <AbsoluteFill>
      <Backdrop />
      <div style={{ position: "absolute", left: 150, top: 130 }}>
        <Tag f={f} at={cue(shot, "contract")} tilt={-3}>
          One contract
        </Tag>
        <Tag f={f} at={cue(shot, "server")} tilt={2}>
          No server
        </Tag>
      </div>
      <div style={{ position: "absolute", left: 144, top: 330, font: `700 260px/0.9 ${F.black}`, color: C.paper, opacity: Math.min(1, mark * 1.4), transform: `scale(${interpolate(mark, [0, 1], [1.08, 1])})`, transformOrigin: "0 50%" }}>Junk Bonds</div>
      <div style={{ position: "absolute", left: 150, top: 640, opacity: lines, transform: `translateY(${(1 - lines) * 24}px)` }}>
        <div style={{ font: `500 58px/1.2 ${F.display}`, color: C.paper }}>Play it with no wallet</div>
        <div style={{ font: `500 46px/1.5 ${F.data}`, color: C.sodium, marginTop: 6 }}>{SITE}</div>
        <div style={{ font: `400 30px/1.6 ${F.data}`, color: C.chalk, marginTop: 22 }}>{REPO}</div>
        <div style={{ font: `400 30px/1.6 ${F.data}`, color: C.chalk }}>junkbonds.testnet on NEAR testnet</div>
        <div style={{ ...label, marginTop: 40 }}>Built at NEAR HACKATHON, November 2026</div>
      </div>
      <div style={{ position: "absolute", right: 150, top: 300, opacity: Math.min(1, mark * 1.4), transform: `scale(${interpolate(mark, [0, 1], [0.7, 1])})` }}>
        <Raccoon npc={3} size={280} />
      </div>
    </AbsoluteFill>
  );
}

// ---------------------------------------------------------------------------
// The cover image
// ---------------------------------------------------------------------------

export function Thumbnail() {
  return (
    <AbsoluteFill>
      <Backdrop />
      <div style={{ position: "absolute", left: 120, top: 90, font: `700 250px/0.9 ${F.black}`, color: C.paper }}>Junk Bonds</div>
      <div style={{ position: "absolute", left: 128, top: 366, width: 900, font: `500 62px/1.12 ${F.display}`, color: C.sodium }}>
        Outbid five raccoons for junk
        <br />
        that pays yield until it rots.
      </div>
      <div style={{ position: "absolute", left: 128, top: 620, display: "flex", gap: 14 }}>
        {[0, 1, 2, 3, 4].map((i) => (
          <Raccoon key={i} npc={i} size={150} />
        ))}
      </div>
      <div style={{ position: "absolute", left: 128, top: 830, ...label, fontSize: 30, color: C.chalk }}>A game on NEAR. No wallet needed.</div>
      <Bond life={30} style={{ left: 1040, top: 390, transform: "rotate(-3deg) scale(1.08)" }} stamp={<span className="stamp" style={{ left: "72%", top: "66%", fontSize: 60, transform: "translate(-50%,-50%) rotate(-13deg)" }}>Sold</span>} />
    </AbsoluteFill>
  );
}

export function Scene({ shot }: { shot: Shot; plan: Plan }) {
  if (shot.id === "hook") return <Hook shot={shot} />;
  if (shot.id === "name") return <Name shot={shot} />;
  if (shot.id === "money") return <Money shot={shot} />;
  if (shot.id === "close") return <Close shot={shot} />;
  return <Footage shot={shot} tag="Real footage, live on NEAR testnet" />;
}
