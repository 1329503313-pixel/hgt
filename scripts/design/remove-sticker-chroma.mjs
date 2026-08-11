import path from "node:path";
import sharp from "sharp";

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  throw new Error("Usage: node scripts/design/remove-sticker-chroma.mjs <input> <output>");
}

const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
let transparent = 0;
let partial = 0;

for (let offset = 0; offset < data.length; offset += 4) {
  const red = data[offset];
  const green = data[offset + 1];
  const blue = data[offset + 2];
  const originalAlpha = data[offset + 3];
  const greenDominance = green - Math.max(red, blue);

  // ImageGen's chroma background is strongly green-dominant. Tangtang's mint
  // skin is blue-green and stays below this range, so its RGB values remain
  // byte-for-byte untouched. Only alpha is derived from the background score.
  const backgroundStrength = green < 120
    ? 0
    : Math.max(0, Math.min(1, (greenDominance - 38) / 72));
  const alpha = Math.round(originalAlpha * (1 - backgroundStrength));
  data[offset + 3] = alpha;
  if (alpha === 0) {
    // Hidden chroma RGB must not survive resizing or WebP interpolation.
    data[offset] = 0;
    data[offset + 1] = 0;
    data[offset + 2] = 0;
    transparent += 1;
  }
  else if (alpha < 255) partial += 1;
}

await sharp(data, { raw: info }).png().toFile(output);
console.log(JSON.stringify({
  input: path.basename(input),
  output,
  transparent,
  partial,
  pixels: info.width * info.height
}));
