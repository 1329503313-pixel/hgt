export const REGISTRATION_ERRORS = {
  usernameTaken: {
    status: 409,
    code: "REGISTER_USERNAME_TAKEN",
    message: "该账号已被注册，请更换账号"
  },
  nicknameTaken: {
    status: 409,
    code: "REGISTER_NICKNAME_TAKEN",
    message: "该昵称已被使用，请更换昵称"
  },
  invitationCodeInvalid: {
    status: 400,
    code: "REGISTER_INVITATION_CODE_INVALID",
    message: "邀请码不正确，请检查后重试"
  },
  invitationCodeFormatInvalid: {
    status: 400,
    code: "REGISTER_INVITATION_CODE_FORMAT_INVALID",
    message: "邀请码格式不正确，请输入 5 位数字或大写字母"
  }
} as const;

export type RegistrationAvailability = {
  usernameExists: boolean;
  nicknameExists: boolean;
  invitationCodeProvided: boolean;
  invitationCodeExists: boolean;
};

export function registrationAvailabilityError(availability: RegistrationAvailability) {
  if (availability.usernameExists) return REGISTRATION_ERRORS.usernameTaken;
  if (availability.nicknameExists) return REGISTRATION_ERRORS.nicknameTaken;
  if (availability.invitationCodeProvided && !availability.invitationCodeExists) {
    return REGISTRATION_ERRORS.invitationCodeInvalid;
  }
  return null;
}
