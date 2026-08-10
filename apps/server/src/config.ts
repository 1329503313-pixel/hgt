import dotenv from "dotenv";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// 确保从项目根目录加载 .env（无论 cwd 在哪个子目录）
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// apps/server/src/config.ts → 上三层到项目根
dotenv.config({ path: resolve(__dirname, "..", "..", "..", ".env") });
// 如果根目录 .env 不存在，尝试从 cwd 加载（兼容 Docker 等场景）
dotenv.config();

function readSecret(envKey: string, fileEnvKey: string): string {
  const filePath = process.env[fileEnvKey];
  if (filePath) {
    try {
      return readFileSync(filePath, "utf-8").trim();
    } catch {
      // 文件不存在或无法读取，回退到环境变量
    }
  }
  return process.env[envKey] ?? "";
}

export const config = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT ?? 4000),
  webOrigin: process.env.WEB_ORIGIN ?? "http://localhost:5173",
  appOrigin: process.env.APP_ORIGIN ?? "https://app.caqis.com",
  publicSiteUrl: process.env.PUBLIC_SITE_URL ?? process.env.WEB_ORIGIN ?? "http://localhost:5173",
  cookieDomain: process.env.COOKIE_DOMAIN || undefined,
  cookieSecure: process.env.COOKIE_SECURE == null
    ? false
    : process.env.COOKIE_SECURE === "true" || process.env.COOKIE_SECURE === "1",
  sessionSecret: process.env.SESSION_SECRET ?? "dev-session-secret-change-me",
  adminDefaultPassword: process.env.ADMIN_DEFAULT_PASSWORD ?? "",
  runDatabaseMigrations: process.env.RUN_DB_MIGRATIONS !== "false",
  assetMediaDir: resolve(process.env.ASSET_MEDIA_DIR || "data/asset-media"),
  aliyunOssPublicEndpoint:
    process.env.ALIYUN_OSS_PUBLIC_ENDPOINT ?? "https://oss-cn-beijing.aliyuncs.com",
  ffmpegPath: process.env.FFMPEG_PATH || "ffmpeg",
  aliyunOss: {
    endpoint: process.env.ALIYUN_OSS_ENDPOINT ?? "",
    region: process.env.ALIYUN_OSS_REGION ?? "",
    bucket: process.env.ALIYUN_OSS_BUCKET ?? "",
    keyPrefix: process.env.ALIYUN_OSS_KEY_PREFIX ?? "",
    accessKeyId: readSecret("ALIYUN_OSS_ACCESS_KEY_ID", "ALIYUN_OSS_ACCESS_KEY_ID_FILE"),
    accessKeySecret: readSecret("ALIYUN_OSS_ACCESS_KEY_SECRET", "ALIYUN_OSS_ACCESS_KEY_SECRET_FILE")
  },
  deepseekApiKey: readSecret("DEEPSEEK_API_KEY", "DEEPSEEK_API_KEY_FILE"),
  emailVerificationSecret:
    readSecret("EMAIL_VERIFICATION_SECRET", "EMAIL_VERIFICATION_SECRET_FILE")
    || process.env.JWT_SECRET
    || process.env.SESSION_SECRET
    || "dev-email-verification-secret-change-me",
  smtp: {
    host: process.env.SMTP_HOST ?? "",
    port: Number(process.env.SMTP_PORT ?? 465),
    secure: process.env.SMTP_SECURE == null
      ? Number(process.env.SMTP_PORT ?? 465) === 465
      : process.env.SMTP_SECURE === "true" || process.env.SMTP_SECURE === "1",
    user: process.env.SMTP_USER ?? "",
    password: readSecret("SMTP_PASSWORD", "SMTP_PASSWORD_FILE"),
    from: process.env.SMTP_FROM ?? "",
    replyTo: process.env.SMTP_REPLY_TO ?? ""
  },
  db: {
    host: process.env.DB_HOST ?? "127.0.0.1",
    port: Number(process.env.DB_PORT ?? 3306),
    user: process.env.DB_USER ?? "hgt",
    password: process.env.DB_PASSWORD ?? "hgt_password",
    database: process.env.DB_NAME ?? "hgt"
  }
};
