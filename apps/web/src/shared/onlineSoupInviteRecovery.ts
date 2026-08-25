type OnlineSoupInviteErrorLike = {
  code?: unknown;
};

function errorCode(error: unknown) {
  if (!error || typeof error !== "object") return "";
  const code = (error as OnlineSoupInviteErrorLike).code;
  return typeof code === "string" ? code : "";
}

export function isClosedOnlineSoupInvite(error: unknown) {
  return errorCode(error) === "ROOM_CLOSED";
}

export function isTerminalOnlineSoupJoinError(error: unknown) {
  const code = errorCode(error);
  return code === "ROOM_CLOSED" || code === "ROOM_FULL";
}
