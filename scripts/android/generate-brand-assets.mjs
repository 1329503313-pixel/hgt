import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";

const repoRoot = resolve(import.meta.dirname, "../..");
const resRoot = resolve(repoRoot, "apps/app-android/android/app/src/main/res");
const iconSource = resolve(repoRoot, "apps/app/static/app/icon-192.png");
const splashSource = resolve(repoRoot, "apps/app/static/app/splash-xhdpi.png");
const splashBackground = "#dcefd8";

const densities = {
  mdpi: { icon: 48, foreground: 108 },
  hdpi: { icon: 72, foreground: 162 },
  xhdpi: { icon: 96, foreground: 216 },
  xxhdpi: { icon: 144, foreground: 324 },
  xxxhdpi: { icon: 192, foreground: 432 }
};

const portraitSplashSizes = {
  mdpi: [320, 480],
  hdpi: [480, 800],
  xhdpi: [720, 1280],
  xxhdpi: [960, 1600],
  xxxhdpi: [1280, 1920]
};

const landscapeSplashSizes = {
  mdpi: [480, 320],
  hdpi: [800, 480],
  xhdpi: [1280, 720],
  xxhdpi: [1600, 960],
  xxxhdpi: [1920, 1280]
};

async function writePng(input, output, width, height, options = {}) {
  await mkdir(resolve(output, ".."), { recursive: true });
  await sharp(input)
    .resize(width, height, options)
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toFile(output);
}

async function sha256(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

for (const [density, sizes] of Object.entries(densities)) {
  const directory = resolve(resRoot, `mipmap-${density}`);
  await writePng(iconSource, resolve(directory, "ic_launcher.png"), sizes.icon, sizes.icon, { fit: "fill" });
  await writePng(iconSource, resolve(directory, "ic_launcher_round.png"), sizes.icon, sizes.icon, { fit: "fill" });
  await writePng(iconSource, resolve(directory, "ic_launcher_foreground.png"), sizes.foreground, sizes.foreground, { fit: "contain", background: splashBackground });
}

for (const [density, [width, height]] of Object.entries(portraitSplashSizes)) {
  await writePng(splashSource, resolve(resRoot, `drawable-port-${density}/splash.png`), width, height, {
    fit: "contain",
    background: splashBackground
  });
}

for (const [density, [width, height]] of Object.entries(landscapeSplashSizes)) {
  await writePng(iconSource, resolve(resRoot, `drawable-land-${density}/splash.png`), width, height, {
    fit: "contain",
    background: splashBackground
  });
}

await writePng(iconSource, resolve(resRoot, "drawable/splash.png"), 480, 320, { fit: "contain", background: splashBackground });
await writePng(iconSource, resolve(resRoot, "drawable/splash_icon.png"), 288, 288, { fit: "contain", background: splashBackground });

const trackedOutputs = [
  ...Object.keys(densities).flatMap((density) => [
    resolve(resRoot, `mipmap-${density}/ic_launcher.png`),
    resolve(resRoot, `mipmap-${density}/ic_launcher_round.png`),
    resolve(resRoot, `mipmap-${density}/ic_launcher_foreground.png`)
  ]),
  ...Object.keys(portraitSplashSizes).map((density) => resolve(resRoot, `drawable-port-${density}/splash.png`)),
  resolve(resRoot, "drawable/splash.png"),
  resolve(resRoot, "drawable/splash_icon.png")
];
const manifest = {
  schemaVersion: 1,
  sources: {
    "apps/app/static/app/icon-192.png": await sha256(iconSource),
    "apps/app/static/app/splash-xhdpi.png": await sha256(splashSource)
  },
  outputs: Object.fromEntries(await Promise.all(trackedOutputs.map(async (path) => [
    path.slice(repoRoot.length + 1).replaceAll("\\", "/"),
    await sha256(path)
  ])))
};
await writeFile(resolve(repoRoot, "apps/app-android/release/brand-assets.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

console.log("Android brand assets regenerated from approved Web/App brand sources.");
