import type { UserRole } from "./types";

export const USER_ROLE_LABELS: Record<UserRole, string> = {
  super_admin: "超级管理员",
  backoffice_admin: "后台管理员",
  vip: "VIP",
  user: "普通用户"
};

export function isSuperAdminRole(role: UserRole | undefined) {
  return role === "super_admin";
}

export function canAccessAdmin(role: UserRole | undefined) {
  return isSuperAdminRole(role) || role === "backoffice_admin";
}
