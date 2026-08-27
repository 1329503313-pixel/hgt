import assert from "node:assert/strict";
import test from "node:test";
import { adminRouteFromPathname, adminRouteManifest, adminRoutePath, defaultAdminTab } from "../src/components/admin/adminRouteManifest.js";
import { parentRoute } from "../src/shared/routeHierarchy.js";

test("管理后台模块统一注册唯一的全局路径", () => {
  assert.equal(new Set(adminRouteManifest.map((route) => route.key)).size, adminRouteManifest.length);
  assert.equal(new Set(adminRouteManifest.map((route) => route.path)).size, adminRouteManifest.length);
  for (const route of adminRouteManifest) {
    assert.match(route.path, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.equal(adminRouteFromPathname(adminRoutePath(route.key))?.key, route.key);
  }
});

test("管理后台根路径具有稳定的默认模块", () => {
  assert.equal(defaultAdminTab, "data");
  assert.equal(adminRoutePath(defaultAdminTab), "/admin/data");
  assert.equal(parentRoute("/admin/users"), "/");
});
