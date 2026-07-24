import nodemailer from "nodemailer";

const required = ["SMTP_HOST", "SMTP_USER", "SMTP_PASSWORD", "SMTP_FROM"];
const missing = required.filter((key) => !process.env[key]?.trim());
if (missing.length > 0) {
  throw new Error(`Missing SMTP configuration: ${missing.join(", ")}`);
}

const port = Number(process.env.SMTP_PORT ?? 465);
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error("SMTP_PORT must be an integer between 1 and 65535");
}

const secure = process.env.SMTP_SECURE == null
  ? port === 465
  : process.env.SMTP_SECURE === "true" || process.env.SMTP_SECURE === "1";

const transport = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port,
  secure,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASSWORD
  }
});

await transport.verify();
transport.close();
console.log("smtp=verified");
