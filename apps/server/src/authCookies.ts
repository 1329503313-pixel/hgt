export const AUTH_COOKIE_NAME = "hgt_session";
export const LEGACY_AUTH_COOKIE_NAME = "hgt_token";

export function authTokenFromCookies(cookies: Record<string, unknown> | undefined) {
  const current = cookies?.[AUTH_COOKIE_NAME];
  if (typeof current === "string" && current) return current;
  const legacy = cookies?.[LEGACY_AUTH_COOKIE_NAME];
  return typeof legacy === "string" && legacy ? legacy : null;
}

export function cookieValue(header: string | undefined, name: string) {
  if (!header) return null;
  for (const item of header.split(";")) {
    const [key, ...parts] = item.trim().split("=");
    if (key === name) return decodeURIComponent(parts.join("="));
  }
  return null;
}

export function authTokenFromCookieHeader(header: string | undefined) {
  return cookieValue(header, AUTH_COOKIE_NAME) ?? cookieValue(header, LEGACY_AUTH_COOKIE_NAME);
}
