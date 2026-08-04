import { spawn, spawnSync } from "node:child_process";
import { resolve } from "node:path";
import process from "node:process";
import dotenv from "dotenv";
import mysql from "mysql2/promise";

dotenv.config({ path: resolve(".env") });

const externalDatabase = process.env.E2E_EXTERNAL_DB === "1";
const database = process.env.E2E_DB_NAME || "hgt_e2e";
if (!/^[A-Za-z0-9_]+_e2e$/.test(database)) {
  throw new Error("E2E_DB_NAME 必须只包含字母、数字、下划线，并以 _e2e 结尾");
}

const databaseOptions = {
  host: externalDatabase ? process.env.E2E_DB_HOST || process.env.DB_HOST || "127.0.0.1" : "127.0.0.1",
  port: Number(externalDatabase ? process.env.E2E_DB_PORT || process.env.DB_PORT || 3306 : 3307),
  user: externalDatabase ? process.env.E2E_DB_USER || process.env.DB_USER || "hgt" : "hgt_e2e",
  password: externalDatabase ? process.env.E2E_DB_PASSWORD || process.env.DB_PASSWORD || "hgt_password" : "hgt_e2e_password",
  multipleStatements: false
};

function compose(...args) {
  const result = spawnSync("docker", ["compose", "-p", "hgt-e2e", "-f", "docker-compose.e2e.yml", ...args], {
    cwd: process.cwd(),
    stdio: "inherit"
  });
  if (result.status !== 0) throw new Error(`E2E MySQL 容器操作失败: docker compose -p hgt-e2e ${args.join(" ")}`);
}

async function recreateDatabase() {
  const connection = await mysql.createConnection(databaseOptions);
  try {
    await connection.query(`DROP DATABASE IF EXISTS \`${database}\``);
    await connection.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  } finally {
    await connection.end();
  }
}

async function removeDatabase() {
  if (process.env.E2E_KEEP_DATABASE === "1") return;
  const connection = await mysql.createConnection(databaseOptions);
  try {
    await connection.query(`DROP DATABASE IF EXISTS \`${database}\``);
  } finally {
    await connection.end();
  }
}

if (externalDatabase) await recreateDatabase();
else {
  compose("down", "--volumes");
  compose("up", "-d", "--wait");
}

const e2eEnvironment = {
  ...process.env,
  NODE_ENV: "production",
  PORT: "4100",
  WEB_ORIGIN: "http://127.0.0.1:5174",
  PUBLIC_SITE_URL: "http://127.0.0.1:5174",
  DB_HOST: databaseOptions.host,
  DB_PORT: String(databaseOptions.port),
  DB_USER: databaseOptions.user,
  DB_PASSWORD: databaseOptions.password,
  DB_NAME: database,
  COOKIE_DOMAIN: "",
  COOKIE_SECURE: "false",
  JWT_SECRET: "hgt-e2e-jwt-secret-never-use-in-production",
  SESSION_SECRET: "hgt-e2e-session-secret-never-use-in-production",
  ADMIN_DEFAULT_PASSWORD: "Hgt-E2E-Admin-2026!",
  RUN_DB_MIGRATIONS: "true",
  DEEPSEEK_API_KEY: "",
  // Satisfy production-mode startup validation without contacting SMTP; the
  // regression accounts do not exercise email delivery.
  SMTP_HOST: "127.0.0.1",
  SMTP_PORT: "2525",
  SMTP_SECURE: "false",
  SMTP_USER: "hgt-e2e",
  SMTP_PASSWORD: "hgt-e2e-not-a-real-password",
  SMTP_FROM: "hgt-e2e@example.invalid",
  ALIYUN_OSS_BUCKET: "",
  ALIYUN_OSS_ACCESS_KEY_ID: "",
  ALIYUN_OSS_ACCESS_KEY_SECRET: ""
};

let exitCode = 1;
try {
  const playwrightCli = resolve("node_modules", "@playwright", "test", "cli.js");
  const child = spawn(process.execPath, [playwrightCli, "test", ...process.argv.slice(2)], {
    cwd: process.cwd(),
    env: e2eEnvironment,
    stdio: "inherit"
  });
  exitCode = await new Promise((resolveExit, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolveExit(code ?? 1));
  });
} finally {
  if (externalDatabase) await removeDatabase();
  else if (process.env.E2E_KEEP_DATABASE !== "1") compose("down", "--volumes");
}
process.exitCode = exitCode;
