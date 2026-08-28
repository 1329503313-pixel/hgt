import assert from "node:assert/strict";
import test from "node:test";
import { REGISTRATION_ERRORS, registrationAvailabilityError } from "./registrationErrors.js";

test("registration availability returns a precise username conflict", () => {
  assert.deepEqual(registrationAvailabilityError({
    usernameExists: true,
    nicknameExists: false,
    invitationCodeProvided: false,
    invitationCodeExists: true
  }), REGISTRATION_ERRORS.usernameTaken);
});

test("registration availability returns a precise nickname conflict", () => {
  assert.deepEqual(registrationAvailabilityError({
    usernameExists: false,
    nicknameExists: true,
    invitationCodeProvided: false,
    invitationCodeExists: true
  }), REGISTRATION_ERRORS.nicknameTaken);
});

test("registration availability returns a precise invitation-code error", () => {
  assert.deepEqual(registrationAvailabilityError({
    usernameExists: false,
    nicknameExists: false,
    invitationCodeProvided: true,
    invitationCodeExists: false
  }), REGISTRATION_ERRORS.invitationCodeInvalid);
});

test("registration availability accepts an unused account with no invitation code", () => {
  assert.equal(registrationAvailabilityError({
    usernameExists: false,
    nicknameExists: false,
    invitationCodeProvided: false,
    invitationCodeExists: false
  }), null);
});
