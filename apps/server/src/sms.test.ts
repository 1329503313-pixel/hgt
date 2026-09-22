import assert from "node:assert/strict";
import test from "node:test";
import type { SendSmsRequest, SendSmsResponse } from "@alicloud/dysmsapi20170525";
import type { RuntimeOptions } from "@alicloud/tea-util";
import {
  createVerificationSmsSender,
  isSmsDeliveryConfigured,
  maskPhoneNumber,
  normalizeMainlandPhoneNumber,
  SmsDeliveryError,
  smsDeliveryConfigurationError,
  type SmsConfiguration
} from "./sms.js";

const validConfiguration: SmsConfiguration = {
  endpoint: "dysmsapi.aliyuncs.com",
  accessKeyId: "test-access-key-id",
  accessKeySecret: "test-access-key-secret",
  signName: "汤物语",
  verificationTemplateCode: "SMS_123456789"
};

function response(body: Partial<NonNullable<SendSmsResponse["body"]>>): SendSmsResponse {
  return { body } as unknown as SendSmsResponse;
}

test("SMS configuration reports missing values and invalid provider parameters", () => {
  assert.equal(smsDeliveryConfigurationError(validConfiguration), null);
  assert.equal(isSmsDeliveryConfigured(validConfiguration), true);
  assert.match(
    smsDeliveryConfigurationError({ ...validConfiguration, accessKeyId: "", signName: "" }) ?? "",
    /ALIYUN_SMS_ACCESS_KEY_ID, ALIYUN_SMS_SIGN_NAME/
  );
  assert.match(
    smsDeliveryConfigurationError({ ...validConfiguration, endpoint: "https://dysmsapi.aliyuncs.com" }) ?? "",
    /hostname/
  );
  assert.match(
    smsDeliveryConfigurationError({ ...validConfiguration, verificationTemplateCode: "template-1" }) ?? "",
    /SMS_<digits>/
  );
});

test("mainland phone numbers are normalized and invalid or batch numbers are rejected", () => {
  assert.equal(normalizeMainlandPhoneNumber("13800138000"), "13800138000");
  assert.equal(normalizeMainlandPhoneNumber("8613800138000"), "13800138000");
  assert.equal(normalizeMainlandPhoneNumber("+8613800138000"), "13800138000");
  assert.equal(normalizeMainlandPhoneNumber("008613800138000"), "13800138000");
  assert.equal(maskPhoneNumber("13800138000"), "138****8000");
  for (const value of ["12800138000", "+85290000000", "13800138000,13900139000", "138 0013 8000"]) {
    assert.throws(
      () => normalizeMainlandPhoneNumber(value),
      (error: unknown) => error instanceof SmsDeliveryError && error.reason === "invalid_phone"
    );
  }
});

test("verification sender maps a normalized phone and fixed template to the SDK without retries", async () => {
  let capturedRequest: SendSmsRequest | undefined;
  let capturedRuntime: RuntimeOptions | undefined;
  const sender = createVerificationSmsSender({
    sms: validConfiguration,
    client: {
      async sendSmsWithOptions(request, runtime) {
        capturedRequest = request;
        capturedRuntime = runtime;
        return response({ code: "OK", message: "OK", requestId: "request-1", bizId: "biz-1" });
      }
    },
    logger: { info() {}, error() {} }
  });

  assert.deepEqual(
    await sender({ phoneNumber: "+8613800138000", code: "012345", outId: "bind-user-1" }),
    { provider: "aliyun", requestId: "request-1", bizId: "biz-1" }
  );
  assert.equal(capturedRequest?.phoneNumbers, "13800138000");
  assert.equal(capturedRequest?.signName, "汤物语");
  assert.equal(capturedRequest?.templateCode, "SMS_123456789");
  assert.equal(capturedRequest?.templateParam, JSON.stringify({ code: "012345" }));
  assert.equal(capturedRequest?.outId, "bind-user-1");
  assert.equal(capturedRuntime?.autoretry, false);
  assert.equal(capturedRuntime?.maxAttempts, 1);
  assert.equal(capturedRuntime?.connectTimeout, 3_000);
  assert.equal(capturedRuntime?.readTimeout, 5_000);
});

test("default sender can create the Alibaba Cloud client in the tsx runtime", async () => {
  const sender = createVerificationSmsSender({
    sms: { ...validConfiguration, endpoint: "127.0.0.1" },
    logger: { info() {}, error() {} }
  });
  await assert.rejects(
    sender({ phoneNumber: "13800138000", code: "123456" }),
    (error: unknown) => error instanceof SmsDeliveryError && error.reason === "transport_error"
  );
});

test("verification sender validates configuration and codes before invoking the SDK", async () => {
  let calls = 0;
  const client = {
    async sendSmsWithOptions() {
      calls += 1;
      return response({ code: "OK", requestId: "unused" });
    }
  };
  const unconfigured = createVerificationSmsSender({
    sms: { ...validConfiguration, accessKeySecret: "" },
    client,
    logger: { info() {}, error() {} }
  });
  await assert.rejects(
    unconfigured({ phoneNumber: "13800138000", code: "123456" }),
    (error: unknown) => error instanceof SmsDeliveryError && error.reason === "not_configured"
  );

  const configured = createVerificationSmsSender({
    sms: validConfiguration,
    client,
    logger: { info() {}, error() {} }
  });
  await assert.rejects(
    configured({ phoneNumber: "13800138000", code: "12345a" }),
    (error: unknown) => error instanceof SmsDeliveryError && error.reason === "invalid_code"
  );
  assert.equal(calls, 0);
});

test("provider rejection is mapped without leaking sensitive values to logs", async () => {
  const logs: unknown[][] = [];
  const sender = createVerificationSmsSender({
    sms: validConfiguration,
    client: {
      async sendSmsWithOptions() {
        return response({ code: "isv.BUSINESS_LIMIT_CONTROL", message: "rejected", requestId: "request-2" });
      }
    },
    logger: { info(...args) { logs.push(args); }, error(...args) { logs.push(args); } }
  });

  await assert.rejects(
    sender({ phoneNumber: "13800138000", code: "654321" }),
    (error: unknown) => error instanceof SmsDeliveryError
      && error.reason === "provider_rejected"
      && error.providerCode === "isv.BUSINESS_LIMIT_CONTROL"
      && error.retryable === false
  );
  const serializedLogs = JSON.stringify(logs);
  assert.match(serializedLogs, /138\*\*\*\*8000/);
  assert.doesNotMatch(serializedLogs, /13800138000|654321|test-access-key-secret/);
});

test("transport errors are mapped once and sanitized", async () => {
  let calls = 0;
  const logs: unknown[][] = [];
  const sender = createVerificationSmsSender({
    sms: validConfiguration,
    client: {
      async sendSmsWithOptions() {
        calls += 1;
        throw { code: "ETIMEDOUT", requestId: "request-3", message: "secret provider detail" };
      }
    },
    logger: { info(...args) { logs.push(args); }, error(...args) { logs.push(args); } }
  });

  await assert.rejects(
    sender({ phoneNumber: "13800138000", code: "123456" }),
    (error: unknown) => error instanceof SmsDeliveryError
      && error.reason === "transport_error"
      && error.providerCode === "ETIMEDOUT"
      && error.requestId === "request-3"
      && error.retryable === true
  );
  assert.equal(calls, 1);
  const serializedLogs = JSON.stringify(logs);
  assert.doesNotMatch(serializedLogs, /123456|secret provider detail|test-access-key-secret/);
});
