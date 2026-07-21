import fs from "node:fs/promises";
import path from "node:path";
import QRCode from "qrcode";
import sharp from "sharp";

const sourcePath =
  "C:/Users/13295/.codex/generated_images/019f7d56-00c2-7471-a494-83d5a585f63e/call_cz4yQqVlEKZVxxYLXeRZUfUx.png";
const outputPath = path.resolve("apps/web/public/share/homepage-qr-poster.png");
const homepageUrl = "http://47.239.5.69:4000";

await fs.mkdir(path.dirname(outputPath), { recursive: true });

const qrCode = await QRCode.toBuffer(homepageUrl, {
  type: "png",
  errorCorrectionLevel: "H",
  width: 260,
  margin: 3,
  color: {
    dark: "#0b1724",
    light: "#fffdf8"
  }
});

const textLayer = Buffer.from(`
  <svg width="1024" height="1536" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur in="SourceAlpha" stdDeviation="5"/>
        <feOffset dy="4"/>
        <feComponentTransfer>
          <feFuncA type="linear" slope="0.7"/>
        </feComponentTransfer>
        <feMerge>
          <feMergeNode/>
          <feMergeNode in="SourceGraphic"/>
        </feMerge>
      </filter>
    </defs>
    <g font-family="Microsoft YaHei, Noto Sans CJK SC, sans-serif">
      <g filter="url(#shadow)">
        <rect x="80" y="76" width="220" height="52" rx="26" fill="#2563eb" fill-opacity="0.92"/>
        <text x="190" y="111" fill="#ffffff" font-size="25" font-weight="700" text-anchor="middle">海龟汤 HGT</text>
        <text x="78" y="214" fill="#f8fafc" font-size="72" font-weight="800" letter-spacing="3">每个故事</text>
        <text x="78" y="308" fill="#f8fafc" font-size="72" font-weight="800" letter-spacing="3">都藏着一个<tspan fill="#f59e0b">真相</tspan></text>
        <text x="82" y="372" fill="#cbd5e1" font-size="29" font-weight="500" letter-spacing="5">烧脑推理 · 好汤分享 · 在线玩汤</text>
      </g>
      <text x="512" y="1378" fill="#172033" font-size="29" font-weight="800" text-anchor="middle">扫码进入海龟汤</text>
      <text x="512" y="1416" fill="#64748b" font-size="21" font-weight="500" text-anchor="middle">和大家一起寻找故事背后的真相</text>
    </g>
  </svg>
`);

await sharp(sourcePath)
  .resize(1024, 1536, { fit: "cover" })
  .composite([
    { input: textLayer, left: 0, top: 0 },
    { input: qrCode, left: 382, top: 1080 }
  ])
  .png({ compressionLevel: 9 })
  .toFile(outputPath);

console.log(outputPath);
