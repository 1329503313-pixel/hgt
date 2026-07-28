import { createHash } from "node:crypto";

export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

export function isValidIdempotencyKey(value: string) {
  return IDEMPOTENCY_KEY_PATTERN.test(value);
}

export function idempotentSoupId(userId: string, key: string) {
  const digest = createHash("sha256").update(userId).update("\0").update(key).digest("base64url");
  return `soup_${digest.slice(0, 48)}`;
}
