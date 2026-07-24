import assert from "node:assert/strict";
import test from "node:test";
import {
  emailCodeDigest,
  maskEmail,
  normalizeEmail,
  resetTokenDigest
} from "./emailAuth.js";
import {
  emailDeliveryConfigurationError,
  passwordResetEmailContent
} from "./mailer.js";

const validSmtpConfiguration = {
  host: "smtp.example.com",
  port: 465,
  secure: true,
  user: "no-reply@example.com",
  password: "authorization-code",
  from: "Example <no-reply@example.com>",
  replyTo: ""
};

test("email delivery configuration requires all authenticated SMTP fields", () => {
  assert.equal(emailDeliveryConfigurationError(validSmtpConfiguration), null);
  assert.match(
    emailDeliveryConfigurationError({ ...validSmtpConfiguration, host: "", password: "" }) ?? "",
    /SMTP_HOST, SMTP_PASSWORD/
  );
});

test("email delivery configuration rejects invalid SMTP ports", () => {
  assert.match(
    emailDeliveryConfigurationError({ ...validSmtpConfiguration, port: Number.NaN }) ?? "",
    /SMTP_PORT/
  );
  assert.match(
    emailDeliveryConfigurationError({ ...validSmtpConfiguration, port: 70_000 }) ?? "",
    /SMTP_PORT/
  );
});

test("normalizeEmail trims and lowercases addresses", () => {
  assert.equal(normalizeEmail("  Example.User@QQ.COM  "), "example.user@qq.com");
});

test("maskEmail preserves only a short local-part prefix", () => {
  assert.equal(maskEmail("example@qq.com"), "exa***@qq.com");
  assert.equal(maskEmail("a@qq.com"), "a***@qq.com");
});

test("email code digests are challenge-bound", () => {
  const first = emailCodeDigest("challenge-a", "123456", "test-secret");
  const second = emailCodeDigest("challenge-b", "123456", "test-secret");
  assert.equal(first.length, 64);
  assert.notEqual(first, second);
});

test("reset token digest is deterministic without storing the raw token", () => {
  const digest = resetTokenDigest("raw-reset-token");
  assert.equal(digest.length, 64);
  assert.equal(digest, resetTokenDigest("raw-reset-token"));
  assert.notEqual(digest, "raw-reset-token");
});

test("password reset email includes the account name and a fragment token link", () => {
  const content = passwordResetEmailContent("alice<script>", "raw-reset-token");
  assert.match(content.text, /账号名称：alice<script>/);
  assert.match(content.text, /#token=raw-reset-token/);
  assert.match(content.html, /账号名称：<strong>alice&lt;script&gt;<\/strong>/);
  assert.doesNotMatch(content.html, /账号名称：<strong>alice<script>/);
});
