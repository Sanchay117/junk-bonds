// Turns the narration timings and the footage offsets into a shot list: when each scene starts,
// which stretch of footage it shows and where the camera looks.

import { staticFile } from "remotion";
import { SCRIPT } from "./script.ts";

export const FPS = 30;

export interface Word {
  text: string;
  start: number;
  end: number;
}
export interface Take {
  file: string;
  seconds: number;
  words: Word[];
}
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface Capture {
  fps: number;
  width: number;
  height: number;
  seconds: number;
  name: string;
  marks: Record<string, number>;
  rects: Record<string, Rect | null>;
}
/** A stretch of footage: `frames` of it starting `src` seconds in, shown from scene frame `at`. */
export interface Cut {
  at: number;
  frames: number;
  src: number;
}
/** Where the camera is centred (as fractions of the footage) and how far it is zoomed, at a frame. */
export interface Focus {
  at: number;
  cx: number;
  cy: number;
  z: number;
}
export interface Shot {
  id: string;
  from: number;
  frames: number;
  /** Frame, relative to the scene, where the narrator starts. */
  voiceAt: number;
  take: Take;
  text: string;
  cuts: Cut[];
  focus: Focus[];
  /** Scene frame at which the SOLD stamp lands, for the footage that has one. */
  stampAt?: number;
}
export interface Sfx {
  file: string;
  at: number;
  volume: number;
}
export interface Plan {
  shots: Shot[];
  sfx: Sfx[];
  capture: Capture;
  total: number;
}

async function load<T>(path: string): Promise<T> {
  const res = await fetch(staticFile(path));
  if (!res.ok) throw new Error(`${path} is missing. Run npm run voice and npm run capture first.`);
  return (await res.json()) as T;
}

const bare = (text: string) => text.toLowerCase().replace(/[^a-z0-9$]/g, "");

/** Frame, relative to the scene, at which the narrator starts the `nth` word beginning with `word`. */
export function cue(shot: Shot, word: string, nth = 0): number {
  const hits = shot.take.words.filter((w) => bare(w.text).startsWith(word));
  const hit = hits[nth];
  if (!hit) throw new Error(`"${word}" is not in the ${shot.id} narration`);
  return shot.voiceAt + Math.round(hit.start * FPS);
}

const mid = (r: Rect | null | undefined, z: number, fallback: [number, number]) =>
  r ? { cx: r.x + r.w / 2, cy: r.y + r.h / 2, z } : { cx: fallback[0], cy: fallback[1], z };

/** Footage and camera for the three filmed scenes. */
function film(shot: Shot, c: Capture) {
  const m = c.marks;
  const S = shot.frames / FPS;
  const whole = { cx: 0.5, cy: 0.5, z: 1 };

  if (shot.id === "join") {
    const start = Math.max(0, m.joined + 2.4 - S);
    const rel = (t: number) => Math.round((t - start) * FPS);
    const form = mid(c.rects.join, 1.75, [0.47, 0.8]);
    const me = mid(c.rects.me, 2.1, [0.88, 0.08]);
    shot.cuts = [{ at: 0, frames: shot.frames, src: start }];
    shot.focus = [
      { at: 0, ...whole },
      { at: rel(m.typed) - 62, ...whole },
      { at: rel(m.typed) - 30, ...form },
      { at: rel(m.rang) + 16, ...form },
      { at: rel(m.joined) - 12, ...me },
    ];
  }

  if (shot.id === "bid") {
    const n = m.won;
    const stamp = m[`stamp${n}`];
    const dibs = m[`dibs${n}`] ?? stamp - 8;
    const after = 3.3;
    const stage = { cx: 0.47, cy: 0.56, z: 1.3 };
    if (stamp - dibs <= S - after - 2.5) {
      const start = stamp + after - S;
      shot.cuts = [{ at: 0, frames: shot.frames, src: start }];
      shot.stampAt = Math.round((stamp - start) * FPS);
    } else {
      const before = 1.4;
      const a = Math.round((S - before - after) * FPS);
      shot.cuts = [
        { at: 0, frames: a, src: dibs - (a / FPS - 2.3) },
        { at: a, frames: shot.frames - a, src: stamp - before },
      ];
      shot.stampAt = a + Math.round(before * FPS);
    }
    const tape = mid(c.rects.tape, 2.1, [0.5, 0.07]);
    shot.focus = [
      { at: 0, ...stage },
      { at: shot.stampAt - 12, ...stage },
      { at: shot.stampAt + 6, cx: 0.47, cy: 0.42, z: 1.5 },
      { at: shot.stampAt + 44, cx: 0.47, cy: 0.42, z: 1.5 },
      { at: shot.stampAt + 66, ...tape },
    ];
  }

  if (shot.id === "junk") {
    const side = mid(c.rects.side, 1.85, [0.87, 0.3]);
    if (m.offers) {
      const b = Math.round(4.2 * FPS);
      const a = shot.frames - b;
      const sell = mid(c.rects.sell ?? c.rects.side, 1.85, [0.87, 0.36]);
      shot.cuts = [
        { at: 0, frames: a, src: m.ff + 0.2 },
        { at: a, frames: b, src: m.offers - 0.9 },
      ];
      shot.focus = [
        { at: 0, ...side },
        { at: a - 1, ...side },
        { at: a, ...sell },
      ];
    } else {
      shot.cuts = [{ at: 0, frames: shot.frames, src: m.ff + 0.2 }];
      shot.focus = [{ at: 0, ...side }];
    }
  }

  // Keyframes must strictly increase for interpolation.
  shot.focus.forEach((k, i) => {
    k.at = Math.max(k.at, i ? shot.focus[i - 1].at + 1 : 0);
  });
}

export async function makePlan(): Promise<Plan> {
  const manifest = await load<{ lines: Record<string, Take> }>("vo/manifest.json");
  const capture = await load<Capture>("capture/site.json");

  const shots: Shot[] = [];
  let at = 0;
  for (const line of SCRIPT) {
    const take = manifest.lines[line.id];
    const lead = line.lead ?? 0.5;
    const frames = Math.round((lead + take.seconds + (line.tail ?? 0.8)) * FPS);
    const shot: Shot = { id: line.id, from: at, frames, voiceAt: Math.round(lead * FPS), take, text: line.text, cuts: [], focus: [] };
    film(shot, capture);
    shots.push(shot);
    at += frames;
  }

  const by = (id: string) => shots.find((s) => s.id === id)!;
  const sfx: Sfx[] = [];
  const add = (shot: Shot, frame: number, file: string, volume: number) => sfx.push({ file: `audio/${file}.wav`, at: shot.from + frame, volume });
  const name = by("name");
  for (let i = 0; i < 5; i++) add(name, cue(name, "five") + i * 5, "tick", 0.5);
  add(name, cue(name, "yield"), "coin", 0.7);
  add(name, cue(name, "rots"), "stamp", 0.8);
  const bid = by("bid");
  if (bid.stampAt) add(bid, bid.stampAt, "stamp", 0.9);
  const junk = by("junk");
  add(junk, cue(junk, "coupons"), "coin", 0.6);
  const money = by("money");
  add(money, cue(money, "thousand"), "coin", 0.7);
  add(money, cue(money, "burned"), "stamp", 0.7);
  const close = by("close");
  add(close, cue(close, "contract"), "stamp", 0.75);
  add(close, cue(close, "server"), "stamp", 0.75);

  return { shots, sfx, capture, total: at };
}
