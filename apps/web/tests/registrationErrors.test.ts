import assert from "node:assert/strict";
import test from "node:test";
import { registrationErrorMessage } from "../src/shared/registrationErrors.js";

function codedError(code: string, message = "请求超时") {
  return Object.assign(new Error(message), { code });
}

test("registration errors use precise messages instead of a generic timeout", () => {
  assert.equal(registrationErrorMessage(codedError("REGISTER_USERNAME_TAKEN")), "该账号已被注册，请更换账号");
  assert.equal(registrationErrorMessage(codedError("REGISTER_NICKNAME_TAKEN")), "该昵称已被使用，请更换昵称");
  assert.equal(registrationErrorMessage(codedError("REGISTER_INVITATION_CODE_INVALID")), "邀请码不正确，请检查后重试");
});

test("registration errors retain an unknown server message", () => {
  assert.equal(registrationErrorMessage(codedError("UNKNOWN", "注册服务异常")), "注册服务异常");
});
