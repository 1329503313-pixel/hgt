export function parentRoute(pathname: string) {
  const path = pathname.replace(/\/+$/, "") || "/";

  if (/^\/messages\/notices\/[^/]+$/.test(path)) return "/messages/notices";
  if (/^\/messages\/chat\/[^/]+$/.test(path)) return "/messages";
  if (/^\/messages\/(system|interactions|notifications|requests|notices)$/.test(path)) return "/messages";
  if (path === "/messages") return "/";

  if (path === "/mine/settings/password") return "/mine/settings";
  if (path === "/mine/shells/transactions") return "/mine";
  if (/^\/mine\/[^/]+$/.test(path)) return "/mine";
  if (path === "/mine") return "/";

  const userSubRoute = path.match(/^\/users\/([^/]+)\/(following|followers)$/);
  if (userSubRoute) return `/users/${userSubRoute[1]}`;
  if (/^\/users\/[^/]+$/.test(path)) return "/";

  if (/^\/soup\/[^/]+$/.test(path)) return "/";
  if (path === "/admin") return "/";
  return "/";
}
