// Films the real game with Chrome's screencast, resampled to a constant 30 fps and encoded by
// ffmpeg. Writes public/capture/site.mp4 and public/capture/site.json (the offsets the film cuts
// on, and where things are on screen).
//
// Everything in the footage is real: it serves the built page from ../docs, joins the live
// contract on NEAR testnet as a new guest, bids until it wins a lot, fast-forwards, collects the
// coupons and asks the raccoons for offers. It costs a few thousandths of a testnet NEAR.
//
//   node scripts/capture.ts [--name bandit]

import { spawn } from "node:child_process";
import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Page } from "playwright-core";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const site = join(root, "..", "docs");
const outDir = join(root, "public", "capture");
mkdirSync(outDir, { recursive: true });

const args = process.argv.slice(2);
const flagAt = args.indexOf("--name");
const name = flagAt >= 0 ? args[flagAt + 1] : "bandit" + Math.floor(10 + Math.random() * 89);

const FPS = 30;
const VIEW = { width: 1600, height: 900 };
const SCALE = 1.2; // 1920 x 1080 frames
const PORT = 5197;

// ---- a static server for the built page ----
const TYPES: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml" };
const server = createServer((req, res) => {
  const path = normalize(decodeURIComponent((req.url ?? "/").split("?")[0]));
  let file = join(site, path);
  if (!file.startsWith(site)) return res.writeHead(403).end();
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
  if (!existsSync(file)) return res.writeHead(404).end();
  res.writeHead(200, { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream" });
  createReadStream(file).pipe(res);
}).listen(PORT);

// ---- constant-rate recording ----
const ffmpeg = spawn(
  "ffmpeg",
  ["-y", "-loglevel", "error", "-f", "image2pipe", "-c:v", "mjpeg", "-framerate", String(FPS), "-i", "-",
   "-c:v", "libx264", "-preset", "medium", "-crf", "17", "-pix_fmt", "yuv420p", "-movflags", "+faststart",
   join(outDir, "site.mp4")],
  { stdio: ["pipe", "inherit", "inherit"] },
);

// The screencast only sends a frame when the page changes, so each frame is repeated until
// the next one's timestamp.
let t0 = 0;
let clockOffset = 0;
let written = 0;
let last: Buffer | null = null;
const fill = (until: number) => {
  const target = Math.floor((until - t0) * FPS);
  while (last && written < target) {
    ffmpeg.stdin.write(last);
    written++;
  }
};

const marks: Record<string, number> = {};
const now = () => Math.round((Date.now() / 1000 - clockOffset - t0) * 100) / 100;
const mark = (id: string) => {
  marks[id] = now();
  console.log(`${marks[id].toFixed(2).padStart(7)}s  ${id}`);
};
const hold = (ms: number) => new Promise((r) => setTimeout(r, ms));

// A pointer drawn into the page, because a headless browser has none.
const pointer = `
  window.addEventListener("DOMContentLoaded", () => {
    const dot = document.createElement("div");
    dot.style.cssText = "position:fixed;z-index:99999;left:0;top:0;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;background:rgba(242,179,61,.92);box-shadow:0 0 0 2px #17181a,0 0 0 4px rgba(242,179,61,.35);pointer-events:none;transform:translate(800px,620px);transition:width .1s,height .1s,margin .1s";
    document.body.appendChild(dot);
    addEventListener("mousemove", (e) => { dot.style.transform = "translate(" + e.clientX + "px," + e.clientY + "px)"; }, true);
    addEventListener("mousedown", () => { dot.style.width = dot.style.height = "15px"; dot.style.margin = "-7.5px 0 0 -7.5px"; }, true);
    addEventListener("mouseup", () => { dot.style.width = dot.style.height = "22px"; dot.style.margin = "-11px 0 0 -11px"; }, true);
  });
`;

const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const context = await browser.newContext({ viewport: VIEW, deviceScaleFactor: SCALE });
const page = await context.newPage();
page.on("pageerror", (error) => console.log("pageerror", error.message));
await page.addInitScript(pointer);
const cdp = await context.newCDPSession(page);

cdp.on("Page.screencastFrame", async ({ data, metadata, sessionId }) => {
  const ts = metadata.timestamp ?? Date.now() / 1000;
  if (!t0) {
    t0 = ts;
    clockOffset = Date.now() / 1000 - ts;
  }
  fill(ts);
  last = Buffer.from(data, "base64");
  await cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
});

/** Move the pointer to an element and click it, the way a person would. */
async function tap(p: Page, selector: string) {
  const box = await p.locator(selector).first().boundingBox();
  if (!box) return false;
  await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 16 });
  await hold(140);
  await p.mouse.down();
  await hold(70);
  await p.mouse.up();
  return true;
}

/** Where an element is, as fractions of the viewport. */
async function rect(p: Page, selector: string) {
  const box = await p.locator(selector).first().boundingBox();
  if (!box) return null;
  const r = (n: number) => Math.round(n * 1000) / 1000;
  return { x: r(box.x / VIEW.width), y: r(box.y / VIEW.height), w: r(box.width / VIEW.width), h: r(box.height / VIEW.height) };
}

const state = (p: Page) =>
  p.evaluate(() => {
    const text = (s: string) => document.querySelector(s)?.textContent ?? "";
    const btn = document.querySelector<HTMLButtonElement>(".controls .btn.primary");
    return {
      lot: text(".stage-head .label"),
      call: text(".call"),
      btn: btn?.textContent ?? "",
      enabled: !!btn && !btn.disabled,
      stamp: !!document.querySelector(".stamp"),
      life: Number(document.querySelectorAll(".cert-specs dd b")[0]?.textContent ?? 0),
      junk: document.querySelectorAll(".stash .holding").length,
    };
  });

const rects: Record<string, unknown> = {};
let won = false;

try {
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: "load" });
  await page.waitForSelector(".cert", { timeout: 60_000 });
  await page.evaluate(() => document.fonts.ready);
  await hold(1500);

  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: VIEW.width * SCALE, maxHeight: VIEW.height * SCALE, everyNthFrame: 1 });
  await hold(600);
  mark("start");
  rects.join = await rect(page, ".join");
  rects.stage = await rect(page, ".stage");
  await hold(4200);

  // Join: type a name, ring the doorbell.
  await tap(page, "#name");
  await page.keyboard.type(name, { delay: 95 });
  mark("typed");
  await hold(500);
  await tap(page, ".join .btn.primary");
  mark("rang");
  await page.waitForSelector(".me-cash", { timeout: 40_000 });
  mark("joined");
  rects.me = await rect(page, ".me");
  await hold(2600);

  // Bid until a lot with enough life left is won.
  let lot = "";
  let n = 0;
  let stamped = false;
  const deadline = Date.now() + 7 * 60_000;
  while (Date.now() < deadline) {
    const s = await state(page);
    if (s.lot !== lot && !s.stamp) {
      lot = s.lot;
      n++;
      stamped = false;
      mark(`lot${n}`);
      marks[`life${n}`] = s.life;
    }
    if (s.stamp && !stamped) {
      stamped = true;
      mark(`stamp${n}`);
      await hold(3300);
      const after = await state(page);
      if (after.junk > 0) {
        won = true;
        marks.won = n;
        break;
      }
      continue;
    }
    if (s.enabled && s.btn.startsWith("Dibs at") && s.life >= 24 && !s.stamp) {
      await tap(page, ".controls .btn.primary");
      mark(`dibs${n}`);
      await hold(1900);
      continue;
    }
    await hold(250);
  }
  if (!won) throw new Error("did not win a lot in time");

  await hold(1200);
  mark("stash");
  rects.side = await rect(page, ".side");
  rects.tape = await rect(page, ".tape");

  // Sit out and let the raccoons trade: the coupons land.
  await tap(page, ".ffrow .btn");
  mark("ff");
  await hold(1500);
  await page.waitForFunction(() => document.querySelector(".ffrow .btn")?.textContent === "Fast-forward", null, { timeout: 60_000 });
  mark("ffEnd");
  await hold(1500);

  if ((await state(page)).junk > 0) {
    await tap(page, ".collect .btn");
    mark("collect");
    await hold(3200);
    await tap(page, ".holding-act .btn");
    mark("sell");
    await page.waitForSelector(".offers li", { timeout: 15_000 });
    mark("offers");
    rects.sell = await rect(page, ".sell");
    await hold(3800);
  }

  await page.evaluate(() => document.querySelector(".economy")?.scrollIntoView({ behavior: "smooth", block: "center" }));
  await hold(1400);
  mark("chart");
  rects.economy = await rect(page, ".economy");
  await hold(4200);
  mark("end");
} finally {
  await cdp.send("Page.stopScreencast").catch(() => {});
  fill(Date.now() / 1000 - clockOffset);
  ffmpeg.stdin.end();
  await new Promise((r) => ffmpeg.on("close", r));
  await browser.close();
  server.close();
}

writeFileSync(
  join(outDir, "site.json"),
  JSON.stringify({ fps: FPS, width: VIEW.width * SCALE, height: VIEW.height * SCALE, seconds: Math.round((written / FPS) * 100) / 100, name, marks, rects }, null, 2) + "\n",
);
console.log(`\n${(written / FPS).toFixed(1)}s of footage as ${name}`);
