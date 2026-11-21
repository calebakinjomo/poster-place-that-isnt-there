// VELDARA — a travel poster for a place that does not exist.
// A desert that only blooms after dark: one colossal luminous
// moonflower rises from gold dunes under a huge low amber moon,
// while a tiny lantern traveller walks the ridge toward it.
// Drawn entirely in code. Writes one 1024x1024 PNG to
// $MAKEFUN_OUTPUT_DIR/entry.png (or /output/entry.png when unset).
// Node 22+ standard library only. No clock, no randomness, no files
// read at run time — two runs produce byte-identical output.

import * as fs from "node:fs";
import * as path from "node:path";
import * as zlib from "node:zlib";

const W = 1024;
const H = 1024;

// ------------------------------------------------------------ palette
// A purposeful, limited palette: deep indigo sky, amber moon,
// magenta-violet bloom, warm gold sand, cream type.
type RGB = [number, number, number];
const IVORY: RGB = [242, 232, 213];
const SKY_TOP: RGB = [18, 14, 46];
const SKY_LOW: RGB = [66, 44, 104];
const STAR: RGB = [238, 232, 255];
const MOON: RGB = [255, 184, 77];
const MOON_CORE: RGB = [255, 205, 110];
const MOON_SPOT: RGB = [232, 150, 44];
const DUNE_BACK: RGB = [201, 155, 74];
const DUNE_MID: RGB = [166, 124, 51];
const DUNE_FRONT: RGB = [94, 63, 28];
const BLOOM_DEEP: RGB = [150, 42, 128];
const BLOOM: RGB = [196, 75, 155];
const BLOOM_LIGHT: RGB = [232, 122, 192];
const BLOOM_CORE: RGB = [255, 233, 168];
const STEM: RGB = [88, 56, 132];
const LEAF: RGB = [96, 44, 110];
const TRAVELLER: RGB = [32, 22, 46];
const LANTERN: RGB = [255, 196, 90];
const TYPE: RGB = [247, 220, 154];
const TYPE_SHADOW: RGB = [52, 32, 12];
const RULE: RGB = [200, 155, 74];

// ------------------------------------------------- deterministic hash
// A small integer hash: the only source of "random-looking" placement.
// Same input, same output, every run.
function hash32(n: number): number {
  let x = (n * 2654435761) >>> 0;
  x ^= x >>> 15;
  x = (x * 2246822519) >>> 0;
  x ^= x >>> 13;
  return x >>> 0;
}
function hash01(n: number): number {
  return hash32(n) / 4294967296;
}
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
function mix(c1: RGB, c2: RGB, t: number): RGB {
  return [
    Math.round(lerp(c1[0], c2[0], t)),
    Math.round(lerp(c1[1], c2[1], t)),
    Math.round(lerp(c1[2], c2[2], t)),
  ];
}

// -------------------------------------------------------------- canvas
class Poster {
  readonly w = W;
  readonly h = H;
  private px = new Uint8Array(W * H * 3);

  put(x: number, y: number, c: RGB): void {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = (y * W + x) * 3;
    this.px[i] = c[0];
    this.px[i + 1] = c[1];
    this.px[i + 2] = c[2];
  }

  // Blend a colour over the pixel with the given opacity (0..1).
  wash(x: number, y: number, c: RGB, alpha: number): void {
    if (x < 0 || y < 0 || x >= W || y >= H || alpha <= 0) return;
    if (alpha >= 1) return this.put(x, y, c);
    const i = (y * W + x) * 3;
    this.px[i] = Math.round(lerp(this.px[i], c[0], alpha));
    this.px[i + 1] = Math.round(lerp(this.px[i + 1], c[1], alpha));
    this.px[i + 2] = Math.round(lerp(this.px[i + 2], c[2], alpha));
  }

  fill(c: RGB): void {
    for (let i = 0; i < W * H; i++) {
      this.px[i * 3] = c[0];
      this.px[i * 3 + 1] = c[1];
      this.px[i * 3 + 2] = c[2];
    }
  }

  rect(x: number, y: number, w: number, h: number, c: RGB): void {
    for (let yy = y; yy < y + h; yy++) {
      for (let xx = x; xx < x + w; xx++) this.put(xx, yy, c);
    }
  }

  hline(x: number, y: number, w: number, c: RGB, thick = 1): void {
    this.rect(x, y, w, thick, c);
  }

  // Bresenham line.
  line(x0: number, y0: number, x1: number, y1: number, c: RGB): void {
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    let x = x0;
    let y = y0;
    for (;;) {
      this.put(x, y, c);
      if (x === x1 && y === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y += sy;
      }
    }
  }

  disc(cx: number, cy: number, r: number, c: RGB): void {
    for (let y = -r; y <= r; y++) {
      for (let x = -r; x <= r; x++) {
        if (x * x + y * y <= r * r) this.put(cx + x, cy + y, c);
      }
    }
  }

  // A soft disc: solid centre fading to transparent at the edge.
  glow(cx: number, cy: number, r: number, c: RGB, peak: number): void {
    for (let y = -r; y <= r; y++) {
      for (let x = -r; x <= r; x++) {
        const d = Math.sqrt(x * x + y * y);
        if (d > r) continue;
        const a = peak * (1 - d / r);
        this.wash(cx + x, cy + y, c, a);
      }
    }
  }

  ring(cx: number, cy: number, r: number, c: RGB, thick = 2): void {
    for (let a = 0; a < 360; a++) {
      const rad = (a * Math.PI) / 180;
      for (let t = 0; t < thick; t++) {
        this.put(
          Math.round(cx + (r - t) * Math.cos(rad)),
          Math.round(cy + (r - t) * Math.sin(rad)),
          c,
        );
      }
    }
  }

  // A filled ellipse rotated by `angle` degrees, centred at (cx, cy),
  // with semi-axes a (along the angle) and b (across it).
  petal(cx: number, cy: number, angleDeg: number, a: number, b: number, c: RGB): void {
    const th = (angleDeg * Math.PI) / 180;
    const cos = Math.cos(th);
    const sin = Math.sin(th);
    const reach = Math.ceil(Math.max(a, b));
    for (let y = -reach; y <= reach; y++) {
      for (let x = -reach; x <= reach; x++) {
        const u = (x * cos + y * sin) / a;
        const v = (-x * sin + y * cos) / b;
        if (u * u + v * v <= 1) this.put(cx + x, cy + y, c);
      }
    }
  }

  triangle(
    x0: number, y0: number,
    x1: number, y1: number,
    x2: number, y2: number,
    c: RGB,
  ): void {
    const minY = Math.min(y0, y1, y2);
    const maxY = Math.max(y0, y1, y2);
    const edge = (ax: number, ay: number, bx: number, by: number, y: number): number => {
      if (ay === by) return ax;
      return ax + ((bx - ax) * (y - ay)) / (by - ay);
    };
    for (let y = minY; y <= maxY; y++) {
      const xs = [
        edge(x0, y0, x1, y1, y),
        edge(x1, y1, x2, y2, y),
        edge(x2, y2, x0, y0, y),
      ].sort((a, b) => a - b);
      for (let x = Math.round(xs[0]); x <= Math.round(xs[2]); x++) {
        this.put(x, y, c);
      }
    }
  }
}

// ------------------------------------------------------- display type
// A bold wood-type display face, drawn on an 8-wide by 10-tall grid.
// Only the letters VELDARA needs are defined, each designed by hand.
const LETTERS: Record<string, string[]> = {
  V: [
    "##....##",
    "##....##",
    "##....##",
    "##....##",
    "##....##",
    "##....##",
    "##....##",
    ".##..##.",
    ".##..##.",
    "..####..",
  ],
  E: [
    "########",
    "##......",
    "##......",
    "##......",
    "#####...",
    "##......",
    "##......",
    "##......",
    "##......",
    "########",
  ],
  L: [
    "##......",
    "##......",
    "##......",
    "##......",
    "##......",
    "##......",
    "##......",
    "##......",
    "##......",
    "########",
  ],
  D: [
    "#####...",
    "##...##.",
    "##....##",
    "##....##",
    "##....##",
    "##....##",
    "##....##",
    "##....##",
    "##...##.",
    "#####...",
  ],
  A: [
    "...##...",
    "..####..",
    ".##..##.",
    ".##..##.",
    "##....##",
    "##....##",
    "########",
    "##....##",
    "##....##",
    "##....##",
  ],
  R: [
    "#####...",
    "##...##.",
    "##...##.",
    "##...##.",
    "#####...",
    "##.##...",
    "##..##..",
    "##...##.",
    "##...##.",
    "##....##",
  ],
};

const GLYPH_W = 8;
const GLYPH_H = 10;

function nameWidth(scale: number, gap: number): number {
  return "VELDARA".length * (GLYPH_W * scale + gap) - gap;
}

function drawName(p: Poster, cx: number, y: number, scale: number, c: RGB): void {
  const gap = Math.round(scale * 1.2);
  const total = nameWidth(scale, gap);
  let x = cx - Math.floor(total / 2);
  for (const ch of "VELDARA") {
    const g = LETTERS[ch];
    for (let r = 0; r < GLYPH_H; r++) {
      for (let col = 0; col < GLYPH_W; col++) {
        if (g[r][col] === "#") {
          p.rect(x + col * scale, y + r * scale, scale, scale, c);
        }
      }
    }
    x += GLYPH_W * scale + gap;
  }
}

// ----------------------------------------------------------------- png
const CRC: number[] = (() => {
  const t: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t.push(c >>> 0);
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(
    crc32(Buffer.concat([Buffer.from(type, "ascii"), data])),
    8 + data.length,
  );
  return out;
}

function encodePng(p: Poster): Buffer {
  const px = (p as unknown as { px: Uint8Array }).px;
  const raw = Buffer.alloc(H * (1 + W * 3));
  for (let y = 0; y < H; y++) {
    raw[y * (1 + W * 3)] = 0; // filter: none
    Buffer.from(px.buffer, y * W * 3, W * 3).copy(raw, y * (1 + W * 3) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

// ------------------------------------------------------------ the scene
const MOON_X = 730;
const MOON_Y = 285;
const MOON_R = 140;
const BLOOM_X = 385;
const BLOOM_Y = 330;

// Dune ridge heights: three layered sweeps of gold sand.
function backTop(x: number): number {
  return 585 + 26 * Math.sin(x / 210 + 0.9) + 12 * Math.sin(x / 97 + 2.0);
}
function midTop(x: number): number {
  return 690 + 30 * Math.sin(x / 240 + 2.2) + 10 * Math.sin(x / 113 + 0.4);
}
function frontTop(x: number): number {
  return 815 + 28 * Math.sin(x / 260 + 0.5) + 8 * Math.sin(x / 89 + 1.1);
}

function drawSky(p: Poster): void {
  // Vertical gradient: deep indigo at the top, violet-indigo at the horizon.
  for (let y = 0; y < 700; y++) {
    const t = Math.min(1, y / 640);
    const c = mix(SKY_TOP, SKY_LOW, t);
    p.hline(0, y, W, c);
  }
  // Stars: deterministic placement, denser and brighter up high.
  for (let i = 0; i < 220; i++) {
    const x = Math.floor(hash01(i * 3 + 1) * W);
    const y = Math.floor(hash01(i * 3 + 2) * 560);
    const b = hash01(i * 3 + 3);
    if (b < 0.55) continue; // keep the sky from crowding
    const bright: RGB = b > 0.9 ? [255, 250, 230] : STAR;
    p.put(x, y, bright);
    if (b > 0.93) {
      // A few bright stars get a cross sparkle.
      p.put(x - 1, y, bright);
      p.put(x + 1, y, bright);
      p.put(x, y - 1, bright);
      p.put(x, y + 1, bright);
    }
  }
}

function drawMoon(p: Poster): void {
  // Wide amber halo, then the disc, then a brighter core and soft spots.
  p.glow(MOON_X, MOON_Y, 260, MOON, 0.16);
  p.glow(MOON_X, MOON_Y, 200, MOON, 0.22);
  p.disc(MOON_X, MOON_Y, MOON_R, MOON);
  p.disc(MOON_X - 18, MOON_Y - 22, 108, MOON_CORE);
  // Quiet crater shading, low contrast so the moon stays a clean disc.
  p.glow(700, 250, 34, MOON_SPOT, 0.5);
  p.glow(770, 320, 26, MOON_SPOT, 0.45);
  p.glow(720, 350, 18, MOON_SPOT, 0.4);
  p.ring(MOON_X, MOON_Y, MOON_R + 4, MOON_CORE, 2);
}

function drawDunes(p: Poster): void {
  for (let x = 0; x < W; x++) {
    const b = Math.round(backTop(x));
    const m = Math.round(midTop(x));
    const f = Math.round(frontTop(x));
    for (let y = b; y < m; y++) p.put(x, y, DUNE_BACK);
    for (let y = m; y < f; y++) p.put(x, y, DUNE_MID);
    for (let y = f; y < H; y++) p.put(x, y, DUNE_FRONT);
  }
  // Warm light pooling where the moonlight catches each ridge.
  for (let x = 0; x < W; x++) {
    const m = Math.round(midTop(x));
    p.wash(x, m, MOON_CORE, 0.18);
    p.wash(x, m + 1, MOON_CORE, 0.1);
    const f = Math.round(frontTop(x));
    p.wash(x, f, MOON_CORE, 0.14);
  }
}

function drawBloom(p: Poster, cx: number, cy: number, size: number): void {
  // size 1 = the colossal landmark bloom; smaller for the dune flowers.
  const s = size;
  // The stem: a gentle quadratic curve down to the dune, drawn thick
  // enough to read as a stalk against the night sky.
  const baseX = cx + Math.round(18 * s);
  const baseY = cy + Math.round(330 * s);
  const ctrlX = cx + Math.round(52 * s);
  const ctrlY = cy + Math.round(170 * s);
  let px = cx;
  let py = cy;
  for (let t = 0.02; t <= 1.001; t += 0.02) {
    const mt = 1 - t;
    const x = Math.round(mt * mt * cx + 2 * mt * t * ctrlX + t * t * baseX);
    const y = Math.round(mt * mt * cy + 2 * mt * t * ctrlY + t * t * baseY);
    p.line(px, py, x, y, STEM);
    p.line(px - 1, py, x - 1, y, STEM);
    p.line(px + 1, py, x + 1, y, STEM);
    p.line(px - 2, py, x - 2, y, STEM);
    p.line(px + 2, py, x + 2, y, STEM);
    px = x;
    py = y;
  }
  // Two pointed leaves low on the stem, angled up and out.
  p.petal(baseX - Math.round(44 * s), baseY - Math.round(118 * s), -38, Math.round(56 * s), Math.round(16 * s), LEAF);
  p.petal(baseX + Math.round(42 * s), baseY - Math.round(92 * s), 38, Math.round(50 * s), Math.round(15 * s), LEAF);
  // The bloom's own halo.
  p.glow(cx, cy, Math.round(215 * s), BLOOM, 0.16);
  p.glow(cx, cy, Math.round(165 * s), BLOOM_LIGHT, 0.14);
  // Outer ring of eight long, narrow petals, set wide apart so each
  // petal reads on its own instead of merging into a disc.
  for (let k = 0; k < 8; k++) {
    const ang = (k * 45 - 90) * (Math.PI / 180);
    const pcx = cx + Math.round(Math.cos(ang) * 112 * s);
    const pcy = cy + Math.round(Math.sin(ang) * 112 * s);
    p.petal(pcx, pcy, k * 45, Math.round(148 * s), Math.round(44 * s), BLOOM_DEEP);
    p.petal(pcx, pcy, k * 45, Math.round(138 * s), Math.round(36 * s), BLOOM);
  }
  // Inner ring of eight smaller petals, offset half a step.
  for (let k = 0; k < 8; k++) {
    const ang = (k * 45 - 67.5) * (Math.PI / 180);
    const pcx = cx + Math.round(Math.cos(ang) * 72 * s);
    const pcy = cy + Math.round(Math.sin(ang) * 72 * s);
    p.petal(pcx, pcy, k * 45 + 22.5, Math.round(100 * s), Math.round(30 * s), BLOOM);
    p.petal(pcx, pcy, k * 45 + 22.5, Math.round(88 * s), Math.round(22 * s), BLOOM_LIGHT);
  }
  // The glowing heart of the flower.
  p.glow(cx, cy, Math.round(58 * s), BLOOM_CORE, 0.5);
  p.disc(cx, cy, Math.round(34 * s), BLOOM_CORE);
  p.disc(cx, cy, Math.round(20 * s), [255, 246, 205]);
  // Stamens: small magenta dots ringing the core.
  for (let k = 0; k < 10; k++) {
    const ang = (k * 36) * (Math.PI / 180);
    p.disc(
      cx + Math.round(Math.cos(ang) * 46 * s),
      cy + Math.round(Math.sin(ang) * 46 * s),
      Math.max(2, Math.round(4 * s)),
      BLOOM_DEEP,
    );
  }
}

function drawPollen(p: Poster): void {
  // Drifting luminous pollen and fireflies, thickest around the bloom.
  for (let i = 0; i < 46; i++) {
    const ang = hash01(i * 5 + 11) * Math.PI * 2;
    const dist = 150 + hash01(i * 5 + 12) * 260;
    const x = Math.round(BLOOM_X + Math.cos(ang) * dist);
    const y = Math.round(BLOOM_Y + 40 + Math.sin(ang) * dist * 0.75);
    if (y < 30 || y > 960) continue;
    const gold = hash01(i * 5 + 13) > 0.5;
    const c: RGB = gold ? LANTERN : BLOOM_LIGHT;
    p.glow(x, y, 7, c, 0.5);
    p.disc(x, y, 2, c);
  }
  // A few faint motes out over the dunes.
  for (let i = 0; i < 18; i++) {
    const x = Math.round(60 + hash01(i * 7 + 21) * 900);
    const y = Math.round(640 + hash01(i * 7 + 22) * 260);
    p.glow(x, y, 5, LANTERN, 0.35);
    p.disc(x, y, 1, LANTERN);
  }
}

function drawTraveller(p: Poster, x: number, groundY: number): void {
  // A tiny silhouette with a lantern, walking the ridge toward the bloom.
  const c = TRAVELLER;
  // Head.
  p.disc(x, groundY - 26, 4, c);
  // Body: a short cloak, wider at the hem.
  p.triangle(x - 3, groundY - 22, x + 3, groundY - 22, x + 6, groundY - 2, c);
  p.triangle(x - 3, groundY - 22, x - 6, groundY - 2, x + 6, groundY - 2, c);
  // Legs, mid-stride.
  p.line(x - 2, groundY - 4, x - 6, groundY, c);
  p.line(x + 2, groundY - 4, x + 6, groundY - 1, c);
  // Arm reaching forward, lantern in hand.
  p.line(x + 2, groundY - 20, x + 11, groundY - 16, c);
  p.glow(x + 14, groundY - 14, 12, LANTERN, 0.55);
  p.disc(x + 14, groundY - 14, 3, LANTERN);
  p.disc(x + 14, groundY - 14, 1, [255, 244, 200]);
}

function drawNameBlock(p: Poster): void {
  const scale = 13;
  const y = 838;
  // A thin gold rule above and below the name, framing it on the dune.
  p.hline(100, 818, 824, RULE, 3);
  p.hline(100, 985, 824, RULE, 3);
  // A soft shadow first, then the cream-gold letters on top.
  drawName(p, 512 + 4, y + 5, scale, TYPE_SHADOW);
  drawName(p, 512, y, scale, TYPE);
}

// ------------------------------------------------------------ assemble
function main(): void {
  const p = new Poster();
  p.fill(IVORY);

  // The poster field, inside its ivory mount.
  const M = 24;
  p.rect(M, M, W - 2 * M, H - 2 * M, SKY_TOP);

  drawSky(p);
  drawMoon(p);
  drawDunes(p);

  // The landmark: one colossal night-bloom.
  drawBloom(p, BLOOM_X, BLOOM_Y, 1);
  // Three small blooms waking on the dunes, so the night-bloom is a
  // place-wide event and not a single flower.
  drawBloom(p, 185, 668, 0.26);
  drawBloom(p, 560, 655, 0.22);
  drawBloom(p, 838, 742, 0.3);

  drawPollen(p);
  drawTraveller(p, 655, 748);
  drawNameBlock(p);

  // The mount: ivory border with a thin gold inner frame.
  p.rect(0, 0, W, M, IVORY);
  p.rect(0, H - M, W, M, IVORY);
  p.rect(0, 0, M, H, IVORY);
  p.rect(W - M, 0, M, H, IVORY);
  p.hline(M - 4, M - 4, W - 2 * (M - 4), 2, RULE);
  p.hline(M - 4, H - M + 2, W - 2 * (M - 4), 2, RULE);

  const png = encodePng(p);
  const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? "/output";
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "entry.png"), png);
}

main();
