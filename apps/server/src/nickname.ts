const ADMIN_NICKNAME_MARKERS = ["admin", "管理员", "管理員", "管理猿"] as const;

function normalizeNicknameForReservationCheck(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[\s._\-·•—–]+/gu, "");
}

export function isAdminRelatedNickname(value: string) {
  const normalized = normalizeNicknameForReservationCheck(value);
  return ADMIN_NICKNAME_MARKERS.some((marker) => normalized.includes(marker));
}
