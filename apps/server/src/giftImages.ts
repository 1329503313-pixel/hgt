import sharp from "sharp";

export const GIFT_ICON_SIZE = 192;
export const GIFT_ICON_MAX_SOURCE_BYTES = 5 * 1024 * 1024;
export const GIFT_ICON_TARGET_BYTES = 80 * 1024;

function giftIconSource(value: string) {
  const match = /^data:image\/(?:png|jpe?g|webp|gif);base64,([A-Za-z0-9+/=]+)$/i.exec(value.trim());
  if (!match) return null;
  const source = Buffer.from(match[1], "base64");
  if (!source.length || source.length > GIFT_ICON_MAX_SOURCE_BYTES) return null;
  return source;
}

export async function optimizeGiftIconBuffer(value: string | Buffer) {
  const source = Buffer.isBuffer(value) ? value : giftIconSource(value);
  if (!source || !source.length || source.length > GIFT_ICON_MAX_SOURCE_BYTES) return null;
  try {
    for (const quality of [88, 80, 72, 64]) {
      const output = await sharp(source, { animated: false })
        .rotate()
        .resize({
          width: GIFT_ICON_SIZE,
          height: GIFT_ICON_SIZE,
          fit: "contain",
          background: { r: 0, g: 0, b: 0, alpha: 0 }
        })
        .webp({ quality, alphaQuality: 90, effort: 5 })
        .toBuffer();
      if (output.length <= GIFT_ICON_TARGET_BYTES || quality === 64) {
        return output;
      }
    }
  } catch {
    return null;
  }
  return null;
}

export async function optimizeGiftIcon(value: string) {
  const output = await optimizeGiftIconBuffer(value);
  return output ? `data:image/webp;base64,${output.toString("base64")}` : null;
}
