import Dysmsapi20170525, {
  SendSmsRequest,
  type SendSmsResponse
} from "@alicloud/dysmsapi20170525";
import * as OpenApi from "@alicloud/openapi-client";
import { RuntimeOptions } from "@alicloud/tea-util";
import { config } from "./config.js";

const CONNECT_TIMEOUT_MS = 3_000;
const READ_TIMEOUT_MS = 5_000;

export type SmsConfiguration = typeof config.aliyunSms;

export type SendVerificationSmsInput = {
  phoneNumber: string;
  code: string;
  outId?: string;
};

export type SmsDeliveryReceipt = {
  provider: "aliyun";
  requestId: string;
  bizId?: string;
};

export type SmsDeliveryErrorReason =
  | "not_configured"
  | "invalid_phone"
  | "invalid_code"
  | "provider_rejected"
  | "transport_error";

export class SmsDeliveryError extends Error {
  constructor(
    public readonly reason: SmsDeliveryErrorReason,
    message: string,
    public readonly retryable: boolean,
    public readonly providerCode?: string,
    public readonly requestId?: string
  ) {
    super(message);
    this.name = "SmsDeliveryError";
  }
}

type SmsClient = {
  sendSmsWithOptions(
    request: SendSmsRequest,
    runtime: RuntimeOptions
  ): Promise<SendSmsResponse>;
};

type SmsLogger = Pick<Console, "info" | "error">;

export function smsDeliveryConfigurationError(sms: SmsConfiguration = config.aliyunSms) {
  const missing = [
    ["ALIYUN_SMS_ACCESS_KEY_ID", sms.accessKeyId],
    ["ALIYUN_SMS_ACCESS_KEY_SECRET", sms.accessKeySecret],
    ["ALIYUN_SMS_SIGN_NAME", sms.signName],
    ["ALIYUN_SMS_VERIFICATION_TEMPLATE_CODE", sms.verificationTemplateCode]
  ].filter(([, value]) => !value?.trim()).map(([name]) => name);
  if (missing.length > 0) return `missing required variables: ${missing.join(", ")}`;
  if (!/^[a-z0-9.-]+$/i.test(sms.endpoint.trim())) {
    return "ALIYUN_SMS_ENDPOINT must be a hostname without a URL scheme or path";
  }
  if (!/^SMS_\d+$/.test(sms.verificationTemplateCode.trim())) {
    return "ALIYUN_SMS_VERIFICATION_TEMPLATE_CODE must match SMS_<digits>";
  }
  return null;
}

export function isSmsDeliveryConfigured(sms: SmsConfiguration = config.aliyunSms) {
  return smsDeliveryConfigurationError(sms) === null;
}

export function normalizeMainlandPhoneNumber(value: string) {
  let phoneNumber = value.trim();
  if (phoneNumber.startsWith("+86")) phoneNumber = phoneNumber.slice(3);
  else if (phoneNumber.startsWith("0086")) phoneNumber = phoneNumber.slice(4);
  else if (phoneNumber.startsWith("86") && phoneNumber.length === 13) phoneNumber = phoneNumber.slice(2);
  if (!/^1[3-9]\d{9}$/.test(phoneNumber)) {
    throw new SmsDeliveryError("invalid_phone", "手机号码格式不正确", false);
  }
  return phoneNumber;
}

export function maskPhoneNumber(phoneNumber: string) {
  return `${phoneNumber.slice(0, 3)}****${phoneNumber.slice(-4)}`;
}

function aliyunSmsClient(sms: SmsConfiguration): SmsClient {
  type SmsClientConstructor = new (configuration: OpenApi.Config) => SmsClient;
  const importedClient = Dysmsapi20170525 as unknown as
    | SmsClientConstructor
    | { default: SmsClientConstructor };
  const Client = typeof importedClient === "function" ? importedClient : importedClient.default;
  return new Client(new OpenApi.Config({
    accessKeyId: sms.accessKeyId,
    accessKeySecret: sms.accessKeySecret,
    endpoint: sms.endpoint
  }));
}

function transportMetadata(error: unknown) {
  if (!error || typeof error !== "object") return {};
  const candidate = error as {
    code?: unknown;
    requestId?: unknown;
    data?: { RequestId?: unknown; requestId?: unknown };
  };
  const requestId = candidate.requestId ?? candidate.data?.RequestId ?? candidate.data?.requestId;
  return {
    providerCode: typeof candidate.code === "string" ? candidate.code : undefined,
    requestId: typeof requestId === "string" ? requestId : undefined
  };
}

export function createVerificationSmsSender(options: {
  sms?: SmsConfiguration;
  client?: SmsClient;
  logger?: SmsLogger;
} = {}) {
  const sms = options.sms ?? config.aliyunSms;
  const logger = options.logger ?? console;
  let client = options.client;

  return async (input: SendVerificationSmsInput): Promise<SmsDeliveryReceipt> => {
    const configurationError = smsDeliveryConfigurationError(sms);
    if (configurationError) {
      throw new SmsDeliveryError("not_configured", `短信服务未配置：${configurationError}`, false);
    }
    const phoneNumber = normalizeMainlandPhoneNumber(input.phoneNumber);
    if (!/^\d{6}$/.test(input.code)) {
      throw new SmsDeliveryError("invalid_code", "验证码必须是 6 位数字", false);
    }

    const request = new SendSmsRequest({
      phoneNumbers: phoneNumber,
      signName: sms.signName.trim(),
      templateCode: sms.verificationTemplateCode.trim(),
      templateParam: JSON.stringify({ code: input.code }),
      outId: input.outId
    });
    const runtime = new RuntimeOptions({
      autoretry: false,
      maxAttempts: 1,
      connectTimeout: CONNECT_TIMEOUT_MS,
      readTimeout: READ_TIMEOUT_MS
    });

    let response: SendSmsResponse;
    try {
      client ??= aliyunSmsClient(sms);
      response = await client.sendSmsWithOptions(request, runtime);
    } catch (error) {
      const metadata = transportMetadata(error);
      logger.error("SMS verification transport failed", {
        phoneNumber: maskPhoneNumber(phoneNumber),
        providerCode: metadata.providerCode,
        requestId: metadata.requestId
      });
      throw new SmsDeliveryError(
        "transport_error",
        "短信发送请求失败",
        true,
        metadata.providerCode,
        metadata.requestId
      );
    }

    const body = response.body;
    const requestId = body?.requestId ?? "";
    if (body?.code !== "OK") {
      logger.error("SMS verification rejected", {
        phoneNumber: maskPhoneNumber(phoneNumber),
        providerCode: body?.code,
        requestId
      });
      throw new SmsDeliveryError(
        "provider_rejected",
        "短信服务拒绝了发送请求",
        false,
        body?.code,
        requestId || undefined
      );
    }

    logger.info("SMS verification accepted", {
      phoneNumber: maskPhoneNumber(phoneNumber),
      requestId,
      bizId: body.bizId
    });
    return {
      provider: "aliyun",
      requestId,
      ...(body.bizId ? { bizId: body.bizId } : {})
    };
  };
}

export const sendVerificationSms = createVerificationSmsSender();
