import { ApiError } from "../api";

export function isOnlineSoupAlreadyExited(error: unknown) {
  return error instanceof ApiError
    && (error.status === 404 || error.code === "ROOM_CLOSED" || error.code === "NOT_MEMBER");
}
