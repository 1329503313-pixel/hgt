import type { UserRole } from "./roles.js";

export const USER_RANKING_ELIGIBLE_ROLES = ["user", "vip", "backoffice_admin"] as const satisfies readonly UserRole[];
export const HOT_SOUP_RANKING_ELIGIBLE_CREATOR_ROLES = [
  "user",
  "vip",
  "backoffice_admin",
  "super_admin"
] as const satisfies readonly UserRole[];

function rolesSql(roles: readonly UserRole[]) {
  return roles.map((role) => `'${role}'`).join(",");
}

export const USER_RANKING_ELIGIBLE_ROLES_SQL = rolesSql(USER_RANKING_ELIGIBLE_ROLES);
export const HOT_SOUP_RANKING_ELIGIBLE_CREATOR_ROLES_SQL = rolesSql(HOT_SOUP_RANKING_ELIGIBLE_CREATOR_ROLES);
