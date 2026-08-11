import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";

const webRoot = resolve(import.meta.dirname, "..");
const publicRoot = resolve(webRoot, "public");
const manifest = JSON.parse(await readFile(resolve(publicRoot, "manifest.webmanifest"), "utf8"));

if (manifest.display !== "standalone" || manifest.start_url !== "/?source=pwa" || manifest.scope !== "/") {
  throw new Error("PWA manifest navigation contract is invalid");
}

const expectedIcons = new Map([
  ["/pwa/apple-touch-icon.png", 180],
  ["/pwa/icon-192.png", 192],
  ["/pwa/icon-512.png", 512],
  ["/pwa/icon-maskable-192.png", 192],
  ["/pwa/icon-maskable-512.png", 512]
]);

for (const [path, size] of expectedIcons) {
  const file = resolve(publicRoot, path.slice(1));
  await access(file);
  const metadata = await sharp(file).metadata();
  if (metadata.width !== size || metadata.height !== size || metadata.format !== "png") {
    throw new Error(`Invalid PWA icon: ${path}`);
  }
}

for (const icon of manifest.icons ?? []) {
  if (!expectedIcons.has(icon.src)) throw new Error(`Unexpected PWA manifest icon: ${icon.src}`);
}

const serviceWorker = await readFile(resolve(publicRoot, "sw.js"), "utf8");
for (const requiredPolicy of ['url.pathname.startsWith("/api/")', 'url.pathname.startsWith("/ws")', 'request.mode === "navigate"']) {
  if (!serviceWorker.includes(requiredPolicy)) throw new Error(`PWA cache safety policy missing: ${requiredPolicy}`);
}

console.log("PWA contract gate passed");
