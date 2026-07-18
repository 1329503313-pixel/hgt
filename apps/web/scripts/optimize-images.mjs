import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicRoot = path.join(webRoot, "public");
const badgeRoot = path.join(publicRoot, "badges");
const circleAvatarRoot = path.join(publicRoot, "circle-avatars");
const sourceAssetRoot = path.join(webRoot, "src", "assets");
const checkOnly = process.argv.includes("--check");
const rasterPattern = /\.(?:png|jpe?g|webp|gif)$/i;

async function filesBelow(root) {
  const entries = await fs.readdir(root, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const target = path.join(root, entry.name);
    return entry.isDirectory() ? filesBelow(target) : [target];
  }));
  return nested.flat();
}

async function writeIfChanged(target, output) {
  const current = await fs.readFile(target).catch(() => null);
  if (current?.equals(output)) return false;
  await fs.writeFile(target, output);
  return true;
}

async function optimizeBadges() {
  const badgePngs = (await filesBelow(badgeRoot)).filter((file) => file.toLowerCase().endsWith(".png"));
  let changed = 0;
  for (const pngPath of badgePngs) {
    const webpPath = pngPath.replace(/\.png$/i, ".webp");
    if (checkOnly) continue;

    const metadata = await sharp(pngPath).metadata();
    const stat = await fs.stat(pngPath);
    if ((metadata.width ?? 0) > 512 || (metadata.height ?? 0) > 512 || stat.size > 350_000) {
      const fallback = await sharp(pngPath)
        .rotate()
        .resize({ width: 512, height: 512, fit: "cover", withoutEnlargement: true })
        .png({ palette: true, quality: 88, compressionLevel: 9, effort: 10, colours: 256, dither: 0.8 })
        .toBuffer();
      if (await writeIfChanged(pngPath, fallback)) changed += 1;
    }

    // The deterministic sibling is what current clients download. PNG stays as a compact fallback for old clients.
    const webp = await sharp(pngPath)
      .rotate()
      .resize({ width: 256, height: 256, fit: "cover", withoutEnlargement: true })
      .webp({ quality: 82, alphaQuality: 90, effort: 5, smartSubsample: true })
      .toBuffer();
    if (await writeIfChanged(webpPath, webp)) changed += 1;
  }
  return { badgeCount: badgePngs.length, changed };
}

async function validateImages() {
  const errors = [];
  const badgeFiles = await filesBelow(badgeRoot);
  const badgePngs = badgeFiles.filter((file) => file.toLowerCase().endsWith(".png"));
  for (const pngPath of badgePngs) {
    const webpPath = pngPath.replace(/\.png$/i, ".webp");
    const webpStat = await fs.stat(webpPath).catch(() => null);
    if (!webpStat) {
      errors.push(`${path.relative(webRoot, pngPath)} 缺少同名 WebP`);
      continue;
    }
    const webpMetadata = await sharp(webpPath).metadata();
    if ((webpMetadata.width ?? 0) > 256 || (webpMetadata.height ?? 0) > 256 || webpStat.size > 100_000) {
      errors.push(`${path.relative(webRoot, webpPath)} 超过徽章限制（256px / 100KB）`);
    }
    const pngStat = await fs.stat(pngPath);
    const pngMetadata = await sharp(pngPath).metadata();
    if ((pngMetadata.width ?? 0) > 512 || (pngMetadata.height ?? 0) > 512 || pngStat.size > 350_000) {
      errors.push(`${path.relative(webRoot, pngPath)} 超过兼容回退限制（512px / 350KB）`);
    }
  }

  for (const avatarPath of (await filesBelow(circleAvatarRoot)).filter((file) => file.toLowerCase().endsWith(".png"))) {
    const relative = path.relative(webRoot, avatarPath).replaceAll("\\", "/");
    const stat = await fs.stat(avatarPath);
    const metadata = await sharp(avatarPath).metadata();
    if (metadata.width !== 320 || metadata.height !== 320) {
      errors.push(`${relative} 必须为 320x320 PNG`);
    }
    if (stat.size > 80_000) {
      errors.push(`${relative} 体积 ${(stat.size / 1024).toFixed(1)}KB，超过圈子头像限制 80KB`);
    }
  }

  for (const root of [publicRoot, sourceAssetRoot]) {
    for (const file of (await filesBelow(root)).filter((item) => rasterPattern.test(item))) {
      const relative = path.relative(webRoot, file).replaceAll("\\", "/");
      const stat = await fs.stat(file);
      const metadata = await sharp(file, { animated: true }).metadata();
      const isAnimatedSticker = relative.includes("/stickers/") && (metadata.pages ?? 1) > 1;
      const limit = isAnimatedSticker ? 300_000 : relative.startsWith("public/badges/") ? 350_000 : 500_000;
      if (stat.size > limit) errors.push(`${relative} 体积 ${(stat.size / 1024).toFixed(1)}KB，超过 ${(limit / 1024).toFixed(0)}KB`);
    }
  }

  if (errors.length) {
    console.error("Image asset validation failed:\n- " + errors.join("\n- "));
    process.exitCode = 1;
  }
  return errors.length;
}

const result = await optimizeBadges();
const errors = await validateImages();
if (!errors) console.log(`Image assets valid: ${result.badgeCount} badges checked, ${result.changed} files optimized.`);
