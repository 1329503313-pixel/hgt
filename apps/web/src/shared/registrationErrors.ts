const REGISTRATION_ERROR_MESSAGES: Record<string, string> = {
  REGISTER_USERNAME_TAKEN: "该账号已被注册，请更换账号",
  REGISTER_NICKNAME_TAKEN: "该昵称已被使用，请更换昵称",
  REGISTER_INVITATION_CODE_INVALID: "邀请码不正确，请检查后重试",
  REGISTER_INVITATION_CODE_FORMAT_INVALID: "邀请码格式不正确，请输入 5 位数字或大写字母"
};

export function registrationErrorMessage(error: unknown) {
  if (error instanceof Error && "code" in error && typeof error.code === "string") {
    const message = REGISTRATION_ERROR_MESSAGES[error.code];
    if (message) return message;
  }
  return error instanceof Error ? error.message : "注册失败，请检查注册信息后重试";
}
