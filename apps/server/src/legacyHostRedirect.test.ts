import assert from "node:assert/strict";
import test from "node:test";
import { legacyHostRedirectTarget } from "./legacyHostRedirect.js";

test("redirects the legacy public IP to the canonical origin and preserves the request target", () => {
  assert.equal(
    legacyHostRedirectTarget(
      "production",
      "https://hgt.caqis.com/",
      "47.239.5.69:4000",
      "/soup/example?id=1"
    ),
    "https://hgt.caqis.com/soup/example?id=1"
  );
});

test("does not redirect the canonical host or non-production requests", () => {
  assert.equal(
    legacyHostRedirectTarget("production", "https://hgt.caqis.com", "hgt.caqis.com", "/"),
    null
  );
  assert.equal(
    legacyHostRedirectTarget("development", "https://hgt.caqis.com", "47.239.5.69:4000", "/"),
    null
  );
});

test("fails closed when the canonical site URL is invalid", () => {
  assert.equal(
    legacyHostRedirectTarget("production", "not a URL", "47.239.5.69:4000", "/"),
    null
  );
});
