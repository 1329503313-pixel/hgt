export type UserRole = "super_admin" | "backoffice_admin" | "vip" | "user";

const USER_ROLES = new Set<UserRole>(["super_admin", "backoffice_admin", "vip", "user"]);

export function normalizeUserRole(value: unknown): UserRole {
  if (value === "admin") return "super_admin";
  return USER_ROLES.has(value as UserRole) ? value as UserRole : "user";
}

export function isSuperAdminRole(role: unknown) {
  return role === "super_admin" || role === "admin";
}

export function isBackofficeAdminRole(role: unknown) {
  return isSuperAdminRole(role) || role === "backoffice_admin";
}

export function canViewAllSoupContentRole(role: unknown) {
  return isBackofficeAdminRole(role) || role === "vip";
}

export function hasUnlimitedSoupPublishingRole(role: unknown) {
  return isBackofficeAdminRole(role) || role === "vip";
}
