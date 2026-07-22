import sharp from "sharp";

export const BANNER_MAX_BYTES = 300 * 1024;
export type BannerImageVariant = "desktop" | "mobile";

const BANNER_TARGETS: Record<BannerImageVariant, { width: number; height: number }> = {
  desktop: { width: 1600, height: 800 },
  mobile: { width: 960, height: 540 }
};

export function decodeBannerImage(value: string) {
  const match = /^data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+/=]+)$/i.exec(value);
  if (!match) return null;
  return Buffer.from(match[2], "base64");
}

export function storedBannerImageBytes(value: string) {
  return decodeBannerImage(value)?.byteLength ?? 0;
}

export async function optimizeBannerImage(value: string, variant: BannerImageVariant = "mobile") {
  const source = decodeBannerImage(value);
  if (!source) return null;
  const target = BANNER_TARGETS[variant];
  try {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const width = Math.max(480, Math.round(target.width * Math.pow(0.86, attempt)));
      const height = Math.round(width * target.height / target.width);
      const quality = Math.max(36, 84 - attempt * 5);
      const output = await sharp(source)
        .rotate()
        .resize(width, height, { fit: "cover", position: "centre" })
        .webp({ quality, effort: 6, smartSubsample: true })
        .toBuffer();
      if (output.byteLength <= BANNER_MAX_BYTES) {
        return `data:image/webp;base64,${output.toString("base64")}`;
      }
    }
    return null;
  } catch {
    return null;
  }
}
