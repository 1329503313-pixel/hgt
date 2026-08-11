import { mkdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const ROOT = process.cwd();
const FRAME_SIZE = 320;
const ART_SIZE = 304;
const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };

const stickers = [
  { slug: "unbelievable", code: "TTZT_11_真的假的_V1", motion: "sway" },
  { slug: "awesome", code: "TTZT_12_你太棒了_V1", motion: "bounce" },
  { slug: "exhausted", code: "TTZT_13_我不行了_V1", motion: "breathe" },
  { slug: "why-like-this", code: "TTZT_14_怎么这样_V1", motion: "sway" },
  { slug: "happy", code: "TTZT_15_开心_V1", motion: "dance" },
  { slug: "whats-wrong", code: "TTZT_16_怎么啦_V1", motion: "tilt" },
  { slug: "thank-you", code: "TTZT_17_谢谢你_V1", motion: "bow" },
  { slug: "another-bowl", code: "TTZT_18_再来一碗_V1", motion: "offer" },
  { slug: "give-up", code: "TTZT_19_我放弃了_V1", motion: "sigh" }
];

const motions = {
  sway: [
    [1, 0, 0, -1.6], [1, -1, 0, -0.8], [1.01, 0, -1, 0], [1, 1, 0, 0.8],
    [1, 0, 0, 1.6], [1, 1, 0, 0.8], [1.01, 0, -1, 0], [1, -1, 0, -0.8]
  ],
  bounce: [
    [1, 0, 1, 0], [1.01, 0, -2, -0.8], [1.02, 0, -5, 0], [1.01, 0, -2, 0.8],
    [1, 0, 1, 0], [0.99, 0, 2, 0], [1, 0, 1, 0], [1, 0, 0, 0]
  ],
  breathe: [
    [1, 0, 0, 0], [1.003, 0, 1, 0], [1.006, 0, 2, 0], [1.003, 0, 1, 0],
    [1, 0, 0, 0], [0.997, 0, -1, 0], [1, 0, 0, 0], [1, 0, 0, 0]
  ],
  dance: [
    [1, 0, 1, -1.4], [1.015, -1, -3, -0.7], [1.025, 0, -6, 0], [1.015, 1, -3, 0.7],
    [1, 0, 1, 1.4], [1.015, 1, -3, 0.7], [1.025, 0, -6, 0], [1.015, -1, -3, -0.7]
  ],
  tilt: [
    [1, 0, 0, -1], [1, -1, 0, -0.5], [1.01, 0, -1, 0], [1, 1, 0, 0.5],
    [1, 0, 0, 1], [1, 1, 0, 0.5], [1.01, 0, -1, 0], [1, -1, 0, -0.5]
  ],
  bow: [
    [1, 0, -1, 0], [1.005, 0, 0, 0], [1.01, 0, 2, 0], [1.005, 0, 1, 0],
    [1, 0, -1, 0], [1, 0, -1, 0], [1.005, 0, 0, 0], [1, 0, -1, 0]
  ],
  offer: [
    [1, 0, 0, 0], [1.01, 0, -1, 0], [1.02, 0, -3, 0], [1.01, 0, -1, 0],
    [1, 0, 0, 0], [0.995, 0, 1, 0], [1, 0, 0, 0], [1, 0, 0, 0]
  ],
  sigh: [
    [1, 0, 0, 0], [1, 0, 1, -0.5], [0.997, 0, 2, -1], [1, 0, 1, -0.5],
    [1, 0, 0, 0], [1, 0, 0, 0.5], [1, 0, 0, 0], [1, 0, 0, 0]
  ]
};

async function renderFrame(base, [scale, x, y, angle]) {
  const size = Math.round(ART_SIZE * scale);
  const art = await sharp(base)
    .resize({ width: size, height: size, fit: "contain", background: TRANSPARENT })
    .rotate(angle, { background: TRANSPARENT })
    .png()
    .toBuffer();
  const metadata = await sharp(art).metadata();
  return sharp({ create: { width: FRAME_SIZE, height: FRAME_SIZE, channels: 4, background: TRANSPARENT } })
    .composite([{ input: art, left: Math.round((FRAME_SIZE - metadata.width) / 2 + x), top: Math.round((FRAME_SIZE - metadata.height) / 2 + y) }])
    .png()
    .toBuffer();
}

for (const sticker of stickers) {
  const designDir = path.join(ROOT, "design", "stickers", "tangtang-detective", sticker.slug);
  const publicDir = path.join(ROOT, "apps", "web", "public", "stickers", "tangtang-detective", sticker.slug);
  await mkdir(publicDir, { recursive: true });
  const staticOutput = path.join(publicDir, `${sticker.code}_static.webp`);
  const animatedOutput = path.join(publicDir, `${sticker.code}_320.webp`);
  const keyframesOutput = path.join(designDir, `${sticker.code}_keyframes.png`);
  const preview = path.join(designDir, `${sticker.code}_preview.png`);
  const base = await sharp(preview)
    .resize({ width: ART_SIZE, height: ART_SIZE, fit: "contain", background: TRANSPARENT })
    .png()
    .toBuffer();
  const frames = [];
  for (const pose of motions[sticker.motion]) frames.push(await renderFrame(base, pose));

  await sharp(frames[0])
    .webp({ quality: 84, alphaQuality: 100, effort: 4 })
    .toFile(staticOutput);

  const rawFrames = [];
  for (const frame of frames) rawFrames.push((await sharp(frame).ensureAlpha().raw().toBuffer()));
  await sharp(Buffer.concat(rawFrames), {
    raw: { width: FRAME_SIZE, height: FRAME_SIZE * frames.length, channels: 4, pageHeight: FRAME_SIZE }
  })
    .webp({ quality: 76, alphaQuality: 100, effort: 4, loop: 0, delay: Array(frames.length).fill(110) })
    .toFile(animatedOutput);

  const sheetFrames = [frames[0], frames[2], frames[4], frames[6]];
  await sharp({ create: { width: FRAME_SIZE * 2, height: FRAME_SIZE * 2, channels: 4, background: TRANSPARENT } })
    .composite(sheetFrames.map((input, index) => ({
      input,
      left: (index % 2) * FRAME_SIZE,
      top: Math.floor(index / 2) * FRAME_SIZE
    })))
    .png()
    .toFile(keyframesOutput);
}

await sharp({ create: { width: FRAME_SIZE * 3, height: FRAME_SIZE * 3, channels: 4, background: { r: 246, g: 248, b: 252, alpha: 1 } } })
  .composite(stickers.map((sticker, index) => ({
    input: path.join(ROOT, "apps", "web", "public", "stickers", "tangtang-detective", sticker.slug, `${sticker.code}_static.webp`),
    left: (index % 3) * FRAME_SIZE,
    top: Math.floor(index / 3) * FRAME_SIZE
  })))
  .png()
  .toFile(path.join(ROOT, "design", "stickers", "tangtang-detective", "TTZT_11-19_静态总览.png"));

console.log(`Built ${stickers.length} Tangtang stickers.`);
