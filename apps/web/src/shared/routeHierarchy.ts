export function parentRoute(pathname: string) {
  const path = pathname.replace(/\/+$/, "") || "/";

  if (/^\/messages\/notices\/[^/]+$/.test(path)) return "/messages/notices";
  if (/^\/messages\/chat\/[^/]+$/.test(path)) return "/messages";
  if (/^\/messages\/(system|interactions|notifications|requests|notices)$/.test(path)) return "/messages";
  if (path === "/messages") return "/";

  const onlineSoupSelectRoute = path.match(/^\/online-soup\/rooms\/([^/]+)\/select-soup$/);
  if (onlineSoupSelectRoute) return `/online-soup/rooms/${onlineSoupSelectRoute[1]}`;
  if (/^\/online-soup\/rooms\/[^/]+$/.test(path)) return "/online-soup";
  if (/^\/circles\/[^/]+$/.test(path)) return "/circles";

  if (path === "/mine/settings/password") return "/mine/settings";
  if (path === "/mine/settings/backgrounds") return "/mine/settings";
  if (/^\/mine\/store\/[^/]+$/.test(path)) return "/mine/store";
  if (path === "/mine/shells/transactions") return "/mine";
  if (path === "/mine/store" || path === "/mine/cards") return "/mine";
  if (path === "/mine/asset-draw-history") return "/mine/store";
  if (/^\/mine\/[^/]+$/.test(path)) return "/mine";
  if (path === "/mine") return "/";

  const userSubRoute = path.match(/^\/users\/([^/]+)\/(following|followers)$/);
  if (userSubRoute) return `/users/${userSubRoute[1]}`;
  if (/^\/users\/[^/]+$/.test(path)) return "/";

  if (/^\/soup\/[^/]+$/.test(path)) return "/";
  if (path === "/admin") return "/";
  return "/";
}
