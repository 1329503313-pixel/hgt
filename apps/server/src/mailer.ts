import nodemailer from "nodemailer";
import { config } from "./config.js";

let transporter: ReturnType<typeof nodemailer.createTransport> | null = null;

type SmtpConfiguration = typeof config.smtp;

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[character]!);
}

export function emailDeliveryConfigurationError(smtp: SmtpConfiguration = config.smtp) {
  const missing = [
    ["SMTP_HOST", smtp.host],
    ["SMTP_FROM", smtp.from],
    ["SMTP_USER", smtp.user],
    ["SMTP_PASSWORD", smtp.password]
  ].filter(([, value]) => !value?.trim()).map(([name]) => name);
  if (missing.length > 0) return `missing required variables: ${missing.join(", ")}`;
  if (!Number.isInteger(smtp.port) || smtp.port < 1 || smtp.port > 65_535) {
    return "SMTP_PORT must be an integer between 1 and 65535";
  }
  return null;
}

export function isEmailDeliveryConfigured() {
  return emailDeliveryConfigurationError() === null;
}

export function assertEmailDeliveryConfigured() {
  const error = emailDeliveryConfigurationError();
  if (error) throw new Error(`EMAIL_DELIVERY_NOT_CONFIGURED: ${error}`);
}

function mailTransport() {
  assertEmailDeliveryConfigured();
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      auth: config.smtp.user
        ? { user: config.smtp.user, pass: config.smtp.password }
        : undefined
    });
  }
  return transporter;
}

// 生产环境不允许在邮件配置缺失时静默启动。否则容器看似健康，
// 直到用户绑定邮箱时才返回 503，并会在每次漏传环境变量的部署后复发。
if (config.nodeEnv === "production") assertEmailDeliveryConfigured();

async function sendMail(options: { to: string; subject: string; text: string; html: string }) {
  await mailTransport().sendMail({
    from: config.smtp.from,
    replyTo: config.smtp.replyTo || undefined,
    ...options
  });
}

export async function sendEmailVerificationCode(
  email: string,
  code: string,
  purpose: "bind" | "change"
) {
  const action = purpose === "change" ? "更换绑定邮箱" : "绑定邮箱";
  await sendMail({
    to: email,
    subject: `【汤汤解谜乐园】${action}验证码`,
    text: `您正在${action}。验证码：${code}。验证码 10 分钟内有效，请勿转发给他人。如非本人操作，请忽略本邮件。`,
    html: `
      <div style="font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#0f172a;line-height:1.7">
        <h2 style="margin:0 0 16px">汤汤解谜乐园</h2>
        <p>您正在${escapeHtml(action)}，验证码为：</p>
        <p style="margin:20px 0;font-size:30px;font-weight:800;letter-spacing:8px;color:#2563eb">${escapeHtml(code)}</p>
        <p>验证码 10 分钟内有效，请勿转发给他人。</p>
        <p style="color:#64748b">如非本人操作，请忽略本邮件。</p>
      </div>
    `
  });
}

export function passwordResetEmailContent(username: string, token: string) {
  const resetUrl = new URL("/reset-password", config.publicSiteUrl);
  // 放入 URL fragment，避免令牌进入 Nginx/应用访问日志或同源 Referer。
  resetUrl.hash = `token=${encodeURIComponent(token)}`;
  const escapedUrl = escapeHtml(resetUrl.toString());
  const escapedUsername = escapeHtml(username);
  return {
    subject: "【汤汤解谜乐园】重置登录密码",
    text: `账号名称：${username}\n请在 20 分钟内打开以下链接重置密码：${resetUrl.toString()}。如非本人操作，请忽略本邮件。`,
    html: `
      <div style="font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#0f172a;line-height:1.7">
        <h2 style="margin:0 0 16px">汤汤解谜乐园</h2>
        <p>我们收到了重置您登录密码的请求。</p>
        <p>账号名称：<strong>${escapedUsername}</strong></p>
        <p style="margin:24px 0">
          <a href="${escapedUrl}" style="display:inline-block;padding:12px 20px;border-radius:10px;background:#2563eb;color:#fff;text-decoration:none;font-weight:700">重置密码</a>
        </p>
        <p>链接 20 分钟内有效，并且只能使用一次。</p>
        <p style="color:#64748b">如非本人操作，请忽略本邮件，您的密码不会改变。</p>
      </div>
    `
  };
}

export async function sendPasswordResetEmail(email: string, username: string, token: string) {
  const content = passwordResetEmailContent(username, token);
  await sendMail({
    to: email,
    ...content
  });
}

export async function sendEmailSecurityNotice(
  email: string,
  event: "changed" | "unbound" | "password_reset"
) {
  const content = {
    changed: {
      subject: "【汤汤解谜乐园】绑定邮箱已更换",
      body: "您的账号绑定邮箱已成功更换。"
    },
    unbound: {
      subject: "【汤汤解谜乐园】绑定邮箱已解绑",
      body: "您的账号绑定邮箱已成功解绑。"
    },
    password_reset: {
      subject: "【汤汤解谜乐园】登录密码已重置",
      body: "您的账号登录密码已成功重置，其他设备上的旧登录状态已经失效。"
    }
  }[event];
  await sendMail({
    to: email,
    subject: content.subject,
    text: `${content.body}如非本人操作，请立即联系网站管理员。`,
    html: `
      <div style="font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#0f172a;line-height:1.7">
        <h2 style="margin:0 0 16px">汤汤解谜乐园</h2>
        <p>${escapeHtml(content.body)}</p>
        <p style="color:#dc2626">如非本人操作，请立即联系网站管理员。</p>
      </div>
    `
  });
}
