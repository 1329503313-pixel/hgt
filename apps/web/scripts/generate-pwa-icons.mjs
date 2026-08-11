import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";

const webRoot = resolve(import.meta.dirname, "..");
const source = resolve(webRoot, "public", "logo.png");
const outputDirectory = resolve(webRoot, "public", "pwa");

await mkdir(outputDirectory, { recursive: true });

async function writeIcon(fileName, size, inset = 0) {
  const contentSize = size - inset * 2;
  const image = inset > 0
    ? sharp({ create: { width: size, height: size, channels: 4, background: "#dcefd8" } })
        .composite([{ input: await sharp(source).resize(contentSize, contentSize).png().toBuffer(), left: inset, top: inset }])
    : sharp(source).resize(size, size);
  await image.png({ compressionLevel: 9 }).toFile(resolve(outputDirectory, fileName));
}

await Promise.all([
  writeIcon("apple-touch-icon.png", 180),
  writeIcon("icon-192.png", 192),
  writeIcon("icon-512.png", 512),
  writeIcon("icon-maskable-192.png", 192, 19),
  writeIcon("icon-maskable-512.png", 512, 51)
]);

console.log(`PWA icons generated in ${outputDirectory}`);
