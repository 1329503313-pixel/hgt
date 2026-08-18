export const homeCategoryRoutes = {
  recommended: "/",
  latest: "/home/latest",
  following: "/home/following",
  ai: "/home/ai",
  played: "/home/played",
  mystery: "/home/mystery"
} as const;

export type HomeCategory = keyof typeof homeCategoryRoutes;

const homeCategoryRouteSet = new Set<string>([
  ...Object.values(homeCategoryRoutes),
  "/home/recommended"
]);

export function isHomeCategoryRoute(pathname: string) {
  const normalized = pathname.replace(/\/+$/, "") || "/";
  return homeCategoryRouteSet.has(normalized);
}
