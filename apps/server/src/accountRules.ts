import { z } from "zod";

export const ACCOUNT_USERNAME_MIN_LENGTH = 6;
export const ACCOUNT_USERNAME_MAX_LENGTH = 50;
export const ACCOUNT_PASSWORD_MIN_LENGTH = 6;
export const ACCOUNT_PASSWORD_MAX_LENGTH = 72;
export const ACCOUNT_NICKNAME_MAX_LENGTH = 8;

export const ACCOUNT_USERNAME_PATTERN = /^[\x21-\x7e]+$/;

export const accountUsernameSchema = z
  .string()
  .min(ACCOUNT_USERNAME_MIN_LENGTH, "账号至少 6 位")
  .max(ACCOUNT_USERNAME_MAX_LENGTH, "账号不能超过 50 位")
  .regex(ACCOUNT_USERNAME_PATTERN, "账号仅支持大小写英文字母、数字和符号，不能包含中文或空格");

export const accountPasswordSchema = z
  .string()
  .min(ACCOUNT_PASSWORD_MIN_LENGTH, "密码至少 6 位")
  .max(ACCOUNT_PASSWORD_MAX_LENGTH, "密码不能超过 72 位");

export const accountNicknameSchema = z
  .string()
  .trim()
  .min(1, "请输入昵称")
  .max(ACCOUNT_NICKNAME_MAX_LENGTH, "昵称不超过 8 个字符");
