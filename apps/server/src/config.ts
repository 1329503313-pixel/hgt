import "dotenv/config";

export const config = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT ?? 4000),
  webOrigin: process.env.WEB_ORIGIN ?? "http://localhost:5173",
  cookieSecure: process.env.COOKIE_SECURE === "true" || process.env.COOKIE_SECURE === "1",
  sessionSecret: process.env.SESSION_SECRET ?? "dev-session-secret-change-me",
  adminDefaultPassword: process.env.ADMIN_DEFAULT_PASSWORD ?? "",
  db: {
    host: process.env.DB_HOST ?? "127.0.0.1",
    port: Number(process.env.DB_PORT ?? 3306),
    user: process.env.DB_USER ?? "hgt",
    password: process.env.DB_PASSWORD ?? "hgt_password",
    database: process.env.DB_NAME ?? "hgt"
  }
};
