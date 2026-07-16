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
  cookieSecure: process.env.COOKIE_SECURE == null
    ? (process.env.NODE_ENV ?? "development") === "production"
    : process.env.COOKIE_SECURE === "true" || process.env.COOKIE_SECURE === "1",
  sessionSecret: process.env.SESSION_SECRET ?? "dev-session-secret-change-me",
  adminDefaultPassword: process.env.ADMIN_DEFAULT_PASSWORD ?? "",
  runDatabaseMigrations: process.env.RUN_DB_MIGRATIONS !== "false",
  deepseekApiKey: readSecret("DEEPSEEK_API_KEY", "DEEPSEEK_API_KEY_FILE"),
  db: {
    host: process.env.DB_HOST ?? "127.0.0.1",
    port: Number(process.env.DB_PORT ?? 3306),
    user: process.env.DB_USER ?? "hgt",
    password: process.env.DB_PASSWORD ?? "hgt_password",
    database: process.env.DB_NAME ?? "hgt"
  }
};
