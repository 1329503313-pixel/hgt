import { normalizeServerMediaUrls, resolveServerMediaUrl } from "./shared/mediaUrls";

const trimTrailingSlash = (value: string) => value.replace(/\/+$/, "");

export const APP_TARGET = import.meta.env.VITE_HGT_TARGET === "android" ? "android" : "web";
export const IS_ANDROID_APP = APP_TARGET === "android";

const configuredApiOrigin = trimTrailingSlash(import.meta.env.VITE_HGT_API_ORIGIN?.trim() ?? "");
const configuredSiteOrigin = trimTrailingSlash(import.meta.env.VITE_HGT_PUBLIC_SITE_ORIGIN?.trim() ?? "");

export const API_ORIGIN = configuredApiOrigin;
export const PUBLIC_SITE_ORIGIN = configuredSiteOrigin || configuredApiOrigin;

function absoluteUrl(origin: string, path: string) {
  if (!origin || /^https?:\/\//i.test(path)) return path;
  return `${origin}${path.startsWith("/") ? path : `/${path}`}`;
}

export function apiEndpoint(path: string) {
  return absoluteUrl(API_ORIGIN, path);
}

export function serverMediaEndpoint(path: string) {
  return resolveServerMediaUrl(path, API_ORIGIN);
}

export function normalizeApiMediaUrls<T>(value: T): T {
  return normalizeServerMediaUrls(value, API_ORIGIN);
}

export function websocketEndpoint(path: string) {
  const origin = API_ORIGIN || window.location.origin;
  const url = new URL(path, `${origin}/`);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

export function publicSiteEndpoint(path = "/") {
  return absoluteUrl(PUBLIC_SITE_ORIGIN || window.location.origin, path);
}
