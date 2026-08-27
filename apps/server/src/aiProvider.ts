import { nanoid } from "nanoid";
import type { z } from "zod";
import { config } from "./config.js";
import { parseStrictModelJson } from "./aiHostProtocol.js";

export type AiCallType = "fast_answer" | "adjudication" | "verification" | "fact_compilation" | "hint_compilation" | "regression";
export type AiProviderErrorKind = "configuration" | "circuit_open" | "timeout" | "network" | "http" | "empty" | "json" | "schema";

export class AiProviderError extends Error {
  constructor(
    public readonly kind: AiProviderErrorKind,
    public readonly retryable: boolean,
    message: string,
    public readonly statusCode = 502,
    public readonly upstreamStatus: number | null = null,
  ) {
    super(message);
    this.name = "AiProviderError";
  }
}

export type AiCallAudit = {
  id: string;
  decisionId: string | null;
  callType: AiCallType;
  provider: "deepseek" | "volcengine";
  model: string;
  requestBody: unknown;
  responseBody: unknown;
  startedAt: Date;
  durationMs: number;
  success: boolean;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  errorKind: AiProviderErrorKind | null;
  errorMessage: string | null;
};

type StructuredCall<T> = {
  callType: AiCallType;
  schemaName: string;
  schema: Record<string, unknown>;
  example: Record<string, unknown>;
  validator: z.ZodType<T>;
  instructions: string;
  input: string;
  decisionId?: string | null;
  timeoutMs?: number;
  attempts?: number;
};

type GatewayOptions = {
  apiKey?: string;
  model?: string;
  endpoint?: string;
  provider?: AiCallAudit["provider"];
  protocol?: "chat_completions" | "responses";
  fetchImpl?: typeof fetch;
  auditSink?: (audit: AiCallAudit) => Promise<void> | void;
  now?: () => number;
  maxConcurrency?: number;
  fallback?: Omit<GatewayOptions, "fallback">;
};

const FAILURE_WINDOW_MS = 60_000;
const CIRCUIT_OPEN_MS = 30_000;
const FAILURE_THRESHOLD = 3;

const STRUCTURED_RETRY_INSTRUCTION = `上一次 JSON 输出未通过协议校验。请重新完成原任务。
只输出与示例字段结构一致的最终 JSON 对象；不要复述、解释或输出 JSON Schema 定义，也不要输出 type、properties、required、additionalProperties 等 schema 元数据。`;

function responseText(body: any): string {
  const chatContent = body?.choices?.[0]?.message?.content;
  if (typeof chatContent === "string") return chatContent;
  if (!Array.isArray(body?.output)) return "";
  for (const item of body.output) {
    if (item?.type !== "message" || !Array.isArray(item.content)) continue;
    for (const content of item.content) {
      if (content?.type === "output_text" && typeof content.text === "string") return content.text;
      if (content?.type === "text" && typeof content.text === "string") return content.text;
    }
  }
  return "";
}

function usageNumbers(body: any) {
  const promptTokens = Number(body?.usage?.input_tokens ?? body?.usage?.prompt_tokens);
  const completionTokens = Number(body?.usage?.output_tokens ?? body?.usage?.completion_tokens);
  const totalTokens = Number(body?.usage?.total_tokens);
  return {
    promptTokens: Number.isFinite(promptTokens) ? promptTokens : null,
    completionTokens: Number.isFinite(completionTokens) ? completionTokens : null,
    totalTokens: Number.isFinite(totalTokens) ? totalTokens : null,
  };
}

function providerError(error: unknown): AiProviderError {
  if (error instanceof AiProviderError) return error;
  if (error instanceof DOMException && error.name === "TimeoutError") {
    return new AiProviderError("timeout", true, "AI 服务响应超时，请重试", 503);
  }
  return new AiProviderError("network", true, "AI 服务网络异常，请重试", 503);
}

function protocolKind(error: unknown): AiProviderErrorKind {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("EMPTY_CONTENT")) return "empty";
  if (message.includes("INVALID_JSON")) return "json";
  return "schema";
}

type ChatFailoverOptions = {
  primaryApiKey?: string;
  fallbackApiKey?: string;
  primaryEndpoint?: string;
  fallbackEndpoint?: string;
  fallbackModel?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

/** 用于尚未迁入结构化网关的短任务；只在主平台明确返回 429 时切换。 */
export async function fetchAiChatWithRateLimitFallback(
  requestBody: Record<string, unknown>,
  options: ChatFailoverOptions = {},
) {
  const fetchImpl = options.fetchImpl ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  const primaryApiKey = options.primaryApiKey ?? config.deepseekApiKey;
  const fallbackApiKey = options.fallbackApiKey ?? config.ark.apiKey;
  const primaryEndpoint = options.primaryEndpoint ?? "https://api.deepseek.com/v1/chat/completions";
  const fallbackEndpoint = options.fallbackEndpoint ?? `${config.ark.baseUrl}/chat/completions`;
  const fallbackModel = options.fallbackModel ?? config.ark.model;
  const timeoutMs = options.timeoutMs ?? 30_000;
  const invoke = (endpoint: string, apiKey: string, body: Record<string, unknown>) => fetchImpl(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });

  const primaryResponse = await invoke(primaryEndpoint, primaryApiKey, requestBody);
  if (primaryResponse.status !== 429 || !fallbackApiKey) return primaryResponse;

  const fallbackBody: Record<string, unknown> = { ...requestBody, model: fallbackModel };
  // `thinking` 是 DeepSeek 扩展参数，不应透传给 OpenAI 兼容备用平台。
  delete fallbackBody.thinking;
  return invoke(fallbackEndpoint, fallbackApiKey, fallbackBody);
}

export class DeepSeekResponsesGateway {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly endpoint: string;
  private readonly provider: AiCallAudit["provider"];
  private readonly protocol: "chat_completions" | "responses";
  private readonly fetchImpl: typeof fetch;
  private readonly auditSink: (audit: AiCallAudit) => Promise<void> | void;
  private readonly now: () => number;
  private readonly maxConcurrency: number;
  private readonly fallback: DeepSeekResponsesGateway | null;
  private activeCalls = 0;
  private readonly slotWaiters: Array<() => void> = [];
  private protocolFailures: number[] = [];
  private circuitOpenUntil = 0;

  constructor(options: GatewayOptions = {}) {
    this.apiKey = options.apiKey ?? config.deepseekApiKey;
    this.model = options.model ?? "deepseek-v4-flash";
    this.endpoint = options.endpoint ?? "https://api.deepseek.com/v1/chat/completions";
    this.provider = options.provider ?? "deepseek";
    this.protocol = options.protocol ?? "chat_completions";
    // Keep the default lookup dynamic so local observability can wrap global fetch
    // after module initialization without changing production call semantics.
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
    this.auditSink = options.auditSink ?? (() => undefined);
    this.now = options.now ?? Date.now;
    this.maxConcurrency = Math.max(1, Math.floor(options.maxConcurrency ?? 2));
    this.fallback = options.fallback?.apiKey
      ? new DeepSeekResponsesGateway({
          ...options.fallback,
          auditSink: options.fallback.auditSink ?? options.auditSink,
        })
      : null;
  }

  async callStructured<T>(call: StructuredCall<T>): Promise<T> {
    try {
      return await this.callCurrentProvider(call);
    } catch (error) {
      if (error instanceof AiProviderError && error.upstreamStatus === 429 && this.fallback) {
        return this.fallback.callStructured(call);
      }
      throw error;
    }
  }

  private async callCurrentProvider<T>(call: StructuredCall<T>): Promise<T> {
    if (!this.apiKey) {
      const keyName = this.provider === "deepseek" ? "DEEPSEEK_API_KEY" : "ARK_API_KEY";
      throw new AiProviderError("configuration", false, `服务未配置 AI 接口，请联系管理员设置 ${keyName}`, 503);
    }
    const releaseSlot = await this.acquireSlot();
    try {
      return await this.callStructuredWithSlot(call);
    } finally {
      releaseSlot();
    }
  }

  private async callStructuredWithSlot<T>(call: StructuredCall<T>): Promise<T> {
    if (this.circuitOpenUntil > this.now()) throw new AiProviderError("circuit_open", true, "AI 服务协议异常，请稍后重试", 503);

    const attempts = Math.max(1, Math.min(3, call.attempts ?? 2));
    let finalError: AiProviderError | null = null;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const id = nanoid();
      const startedAtMs = this.now();
      const systemInstruction = `${attempt === 1
        ? call.instructions
        : `${call.instructions}\n\n${STRUCTURED_RETRY_INSTRUCTION}`}

必须只输出合法 JSON，不要使用 Markdown 代码块或附加说明。
目标 JSON 示例：${JSON.stringify(call.example)}`;
      const requestBody = this.protocol === "responses"
        ? {
            model: this.model,
            instructions: systemInstruction,
            input: call.input,
            max_output_tokens: 2000,
            text: { format: { type: "json_schema", name: call.schemaName, strict: true, schema: call.schema } },
          }
        : {
            model: this.model,
            messages: [
              { role: "system", content: systemInstruction },
              { role: "user", content: call.input },
            ],
            temperature: 0,
            // V4 默认会把输出预算用于 reasoning_content。结构化判定只需要最终 JSON，
            // 禁用思考模式可避免 finish_reason=length 且 content 为空。
            thinking: { type: "disabled" },
            max_tokens: 2000,
            response_format: { type: "json_object" },
          };
      let responseBody: unknown = null;
      let errorKind: AiProviderErrorKind | null = null;
      let errorMessage: string | null = null;
      try {
        const response = await this.fetchImpl(this.endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
          body: JSON.stringify(requestBody),
          signal: AbortSignal.timeout(call.timeoutMs ?? 30_000),
        });
        try {
          responseBody = await response.json();
        } catch {
          throw new AiProviderError("json", true, "AI 服务返回了无效响应，请重试");
        }
        if (!response.ok) {
          const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
          const publicStatus = response.status === 429 || response.status >= 500 ? 503 : 502;
          throw new AiProviderError("http", retryable, "AI 服务请求失败，请重试", publicStatus, response.status);
        }
        const raw = responseText(responseBody);
        let parsed: T;
        try {
          parsed = parseStrictModelJson(raw, call.validator);
        } catch (error) {
          const kind = protocolKind(error);
          throw new AiProviderError(kind, true, kind === "empty" ? "AI 未返回判定内容，请重试" : "AI 返回的判定格式无效，请重试");
        }
        this.clearOldProtocolFailures();
        await this.writeAudit({
          id, decisionId: call.decisionId ?? null, callType: call.callType, provider: this.provider, model: this.model,
          requestBody, responseBody, startedAt: new Date(startedAtMs), durationMs: this.now() - startedAtMs,
          success: true, ...usageNumbers(responseBody), errorKind: null, errorMessage: null,
        });
        return parsed;
      } catch (error) {
        const normalized = providerError(error);
        finalError = normalized;
        errorKind = normalized.kind;
        errorMessage = normalized.message;
        await this.writeAudit({
          id, decisionId: call.decisionId ?? null, callType: call.callType, provider: this.provider, model: this.model,
          requestBody, responseBody, startedAt: new Date(startedAtMs), durationMs: this.now() - startedAtMs,
          success: false, ...usageNumbers(responseBody), errorKind, errorMessage,
        });
        // 主平台限流立即交给备用平台，不在同一限流窗口内重复消耗主平台请求。
        if (normalized.upstreamStatus === 429 || !normalized.retryable || attempt >= attempts || this.circuitOpenUntil > this.now()) break;
        const retryDelayMs = normalized.kind === "empty" ? 500 * attempt : 200 * attempt;
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      }
    }
    // JSON Output 偶尔可能返回空内容。空响应只失败当前调用，
    // 不应打开全局熔断并误伤其他正在排队的房间。
    if (finalError && ["json", "schema"].includes(finalError.kind)) this.recordProtocolFailure();
    throw finalError ?? new AiProviderError("network", true, "AI 服务暂时不可用，请重试", 503);
  }

  private async acquireSlot(): Promise<() => void> {
    if (this.activeCalls >= this.maxConcurrency) {
      await new Promise<void>((resolve) => this.slotWaiters.push(resolve));
    }
    this.activeCalls += 1;
    return () => {
      this.activeCalls = Math.max(0, this.activeCalls - 1);
      this.slotWaiters.shift()?.();
    };
  }

  private clearOldProtocolFailures() {
    const cutoff = this.now() - FAILURE_WINDOW_MS;
    this.protocolFailures = this.protocolFailures.filter((value) => value >= cutoff);
  }

  private recordProtocolFailure() {
    this.clearOldProtocolFailures();
    this.protocolFailures.push(this.now());
    if (this.protocolFailures.length >= FAILURE_THRESHOLD) this.circuitOpenUntil = this.now() + CIRCUIT_OPEN_MS;
  }

  private async writeAudit(audit: AiCallAudit) {
    try {
      await this.auditSink(audit);
    } catch (error) {
      console.error("AI call audit write failed:", error instanceof Error ? error.message : error);
    }
  }
}
