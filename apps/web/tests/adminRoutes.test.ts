import assert from "node:assert/strict";
import test from "node:test";
import { cardBattleAdminRoutes, adminRouteFromPathname, adminRouteManifest, adminRoutePath, canAccessAdminRoute, defaultAdminTab } from "../src/components/admin/adminRouteManifest.js";
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

test("谜局管理仅向超级管理员显示并允许直达", () => {
  const mysteries = adminRouteManifest.find((route) => route.key === "mysteries");
  assert.ok(mysteries);
  assert.equal(canAccessAdminRoute(mysteries, "super_admin"), true);
  assert.equal(canAccessAdminRoute(mysteries, "backoffice_admin"), false);
});

test("BOSS 后台直达、刷新路由只向超级管理员开放", () => {
  const route = adminRouteFromPathname("/admin/card-battle-boss");
  assert.ok(route);
  assert.equal(route.key, "card-battle-boss");
  assert.equal(canAccessAdminRoute(route, "super_admin"), true);
  for (const role of ["backoffice_admin", "user", "vip"] as const) assert.equal(canAccessAdminRoute(route, role), false);
});


test("卡牌对战子模块使用已注册路径并继承权限", () => {
  assert.deepEqual(cardBattleAdminRoutes.map((route) => route.path), ["/admin/card-battle/boss", "/admin/card-battle/tower", "/admin/card-battle/traits"]);
  for (const child of cardBattleAdminRoutes) {
    const parent = adminRouteFromPathname(child.path)!;
    assert.equal(parent.label, "卡牌对战");
    assert.equal(canAccessAdminRoute(parent, "user"), false);
    assert.equal(canAccessAdminRoute(parent, "super_admin"), true);
  }
  assert.equal(parentRoute("/online-soup/tower/room"), "/online-soup");
});
