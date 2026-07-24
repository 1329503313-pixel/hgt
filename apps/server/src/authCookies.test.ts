import assert from "node:assert/strict";
import test from "node:test";
import {
  AUTH_COOKIE_NAME,
  LEGACY_AUTH_COOKIE_NAME,
  authTokenFromCookieHeader,
  authTokenFromCookies
} from "./authCookies.js";

test("new authentication cookie takes priority over the legacy cookie", () => {
  assert.equal(authTokenFromCookies({
    [LEGACY_AUTH_COOKIE_NAME]: "old-user-token",
    [AUTH_COOKIE_NAME]: "new-user-token"
  }), "new-user-token");
  assert.equal(
    authTokenFromCookieHeader(`${LEGACY_AUTH_COOKIE_NAME}=old-user-token; ${AUTH_COOKIE_NAME}=new-user-token`),
    "new-user-token"
  );
});

test("legacy authentication cookie remains valid during migration", () => {
  assert.equal(authTokenFromCookies({ [LEGACY_AUTH_COOKIE_NAME]: "legacy-token" }), "legacy-token");
  assert.equal(authTokenFromCookieHeader(`${LEGACY_AUTH_COOKIE_NAME}=legacy-token`), "legacy-token");
});
