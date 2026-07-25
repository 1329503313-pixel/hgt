import assert from "node:assert/strict";
import test from "node:test";
import {
  canViewAllSoupContentRole,
  isBackofficeAdminRole,
  isSuperAdminRole,
  normalizeUserRole
} from "./roles.js";

test("legacy admin role is normalized without losing super-admin access", () => {
  assert.equal(normalizeUserRole("admin"), "super_admin");
  assert.equal(isSuperAdminRole("admin"), true);
  assert.equal(isSuperAdminRole("super_admin"), true);
});

test("only administrator roles can access the management console", () => {
  assert.equal(isBackofficeAdminRole("super_admin"), true);
  assert.equal(isBackofficeAdminRole("backoffice_admin"), true);
  assert.equal(isBackofficeAdminRole("vip"), false);
  assert.equal(isBackofficeAdminRole("user"), false);
});

test("VIP and administrator roles can view restricted soup content", () => {
  assert.equal(canViewAllSoupContentRole("super_admin"), true);
  assert.equal(canViewAllSoupContentRole("backoffice_admin"), true);
  assert.equal(canViewAllSoupContentRole("vip"), true);
  assert.equal(canViewAllSoupContentRole("user"), false);
});
