import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import { DeepSeekResponsesGateway, AiProviderError, fetchAiChatWithRateLimitFallback, type AiCallAudit } from "./aiProvider.js";

const validator = z.object({ answer: z.literal("YES") }).strict();
const schema = { type: "object", required: ["answer"], additionalProperties: false, properties: { answer: { const: "YES" } } };

function modelResponse(text: string, status = 200) {
  return new Response(JSON.stringify({
    output: [{ type: "message", content: [{ type: "output_text", text }] }],
    usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 },
  }), { status, headers: { "Content-Type": "application/json" } });
}

function chatModelResponse(text: string, status = 200) {
  return new Response(JSON.stringify({
    choices: [{ message: { role: "assistant", content: text } }],
    usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
  }), { status, headers: { "Content-Type": "application/json" } });
}

test("Responses 网关只接受严格结构化输出并写入审计", async () => {
  const audits: AiCallAudit[] = [];
  let sentBody: any;
  const gateway = new DeepSeekResponsesGateway({
    apiKey: "test-key",
    fetchImpl: async (_input, init) => {
      sentBody = JSON.parse(String(init?.body));
      return chatModelResponse('{"answer":"YES"}');
    },
    auditSink: (audit) => { audits.push(audit); },
  });
  const value = await gateway.callStructured({ callType: "fast_answer", schemaName: "test", schema, example: { answer: "YES" }, validator, instructions: "rules", input: "data" });
  assert.deepEqual(value, { answer: "YES" });
  assert.equal(audits[0].success, true);
  assert.equal(audits[0].totalTokens, 12);
  assert.equal(JSON.stringify(audits[0].requestBody).includes("test-key"), false);
  assert.deepEqual(sentBody.response_format, { type: "json_object" });
  assert.deepEqual(sentBody.thinking, { type: "disabled" });
  assert.equal(sentBody.max_tokens, 2000);
  assert.equal(JSON.stringify(sentBody).includes('"json_schema"'), false);
  assert.match(sentBody.messages[0].content, /目标 JSON 示例/);
});

test("空响应重试后必须失败，不能生成降级答案", async () => {
  let calls = 0;
  const gateway = new DeepSeekResponsesGateway({ apiKey: "test-key", fetchImpl: async () => { calls += 1; return modelResponse(" "); } });
  await assert.rejects(
    gateway.callStructured({ callType: "adjudication", schemaName: "test", schema, example: { answer: "YES" }, validator, instructions: "rules", input: "data" }),
    (error: unknown) => error instanceof AiProviderError && error.kind === "empty",
  );
  assert.equal(calls, 2);
});

test("模型误把 JSON Schema 当答案时使用纠错指令重试", async () => {
  const audits: AiCallAudit[] = [];
  const instructions: string[] = [];
  let calls = 0;
  const gateway = new DeepSeekResponsesGateway({
    apiKey: "test-key",
    fetchImpl: async (_input, init) => {
      calls += 1;
      const body = JSON.parse(String(init?.body)) as { messages: Array<{ role: string; content: string }> };
      instructions.push(body.messages[0].content);
      return calls === 1
        ? modelResponse(JSON.stringify(schema))
        : modelResponse('{"answer":"YES"}');
    },
    auditSink: (audit) => { audits.push(audit); },
  });

  const value = await gateway.callStructured({
    callType: "adjudication",
    schemaName: "test",
    schema,
    example: { answer: "YES" },
    validator,
    instructions: "rules",
    input: "data",
  });

  assert.deepEqual(value, { answer: "YES" });
  assert.equal(calls, 2);
  assert.match(instructions[0], /^rules/);
  assert.match(instructions[1], /JSON Schema 定义/);
  assert.deepEqual(audits.map((audit) => audit.success), [false, true]);
});

test("连续三次协议故障打开熔断且不再请求模型", async () => {
  let calls = 0;
  let now = 10_000;
  const gateway = new DeepSeekResponsesGateway({
    apiKey: "test-key",
    now: () => now,
    fetchImpl: async () => { calls += 1; return modelResponse('{"answer":"NO"}'); },
  });
  const request = { callType: "adjudication" as const, schemaName: "test", schema, example: { answer: "YES" }, validator, instructions: "rules", input: "data", attempts: 1 };
  await assert.rejects(gateway.callStructured(request));
  now += 1;
  await assert.rejects(gateway.callStructured(request));
  now += 1;
  await assert.rejects(gateway.callStructured(request));
  const before = calls;
  await assert.rejects(gateway.callStructured(request), (error: unknown) => error instanceof AiProviderError && error.kind === "circuit_open");
  assert.equal(calls, before);
});

test("并发模型请求受统一上限约束", async () => {
  let active = 0;
  let peak = 0;
  const gateway = new DeepSeekResponsesGateway({
    apiKey: "test-key",
    maxConcurrency: 2,
    fetchImpl: async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 20));
      active -= 1;
      return chatModelResponse('{"answer":"YES"}');
    },
  });
  const request = { callType: "adjudication" as const, schemaName: "test", schema, example: { answer: "YES" }, validator, instructions: "rules", input: "data" };
  await Promise.all(Array.from({ length: 5 }, () => gateway.callStructured(request)));
  assert.equal(peak, 2);
});

test("空响应不会打开全局协议熔断", async () => {
  let calls = 0;
  const gateway = new DeepSeekResponsesGateway({
    apiKey: "test-key",
    fetchImpl: async () => { calls += 1; return modelResponse(" "); },
  });
  const request = { callType: "adjudication" as const, schemaName: "test", schema, example: { answer: "YES" }, validator, instructions: "rules", input: "data", attempts: 1 };
  for (let index = 0; index < 4; index += 1) {
    await assert.rejects(gateway.callStructured(request), (error: unknown) => error instanceof AiProviderError && error.kind === "empty");
  }
  assert.equal(calls, 4);
});

test("主平台返回 429 时立即切换到方舟 Responses API", async () => {
  const audits: AiCallAudit[] = [];
  let primaryCalls = 0;
  let fallbackCalls = 0;
  let fallbackUrl = "";
  let fallbackBody: any;
  const gateway = new DeepSeekResponsesGateway({
    apiKey: "deepseek-key",
    fetchImpl: async () => {
      primaryCalls += 1;
      return new Response(JSON.stringify({ error: { message: "rate limited" } }), {
        status: 429,
        headers: { "Content-Type": "application/json" },
      });
    },
    auditSink: (audit) => { audits.push(audit); },
    fallback: {
      provider: "volcengine",
      apiKey: "ark-key",
      model: "ark-code-latest",
      endpoint: "https://ark.example/api/plan/v3/responses",
      protocol: "responses",
      fetchImpl: async (input, init) => {
        fallbackCalls += 1;
        fallbackUrl = String(input);
        fallbackBody = JSON.parse(String(init?.body));
        return modelResponse('{"answer":"YES"}');
      },
    },
  });

  const value = await gateway.callStructured({
    callType: "adjudication",
    schemaName: "test_answer",
    schema,
    example: { answer: "YES" },
    validator,
    instructions: "rules",
    input: "data",
    attempts: 3,
  });

  assert.deepEqual(value, { answer: "YES" });
  assert.equal(primaryCalls, 1);
  assert.equal(fallbackCalls, 1);
  assert.equal(fallbackUrl, "https://ark.example/api/plan/v3/responses");
  assert.equal(fallbackBody.model, "ark-code-latest");
  assert.equal(fallbackBody.input, "data");
  assert.equal(fallbackBody.text.format.type, "json_schema");
  assert.deepEqual(audits.map((audit) => [audit.provider, audit.success]), [
    ["deepseek", false],
    ["volcengine", true],
  ]);
});

test("主平台非 429 错误不得切换到备用平台", async () => {
  let fallbackCalls = 0;
  const gateway = new DeepSeekResponsesGateway({
    apiKey: "deepseek-key",
    fetchImpl: async () => new Response(JSON.stringify({ error: { message: "unavailable" } }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    }),
    fallback: {
      provider: "volcengine",
      apiKey: "ark-key",
      model: "ark-code-latest",
      endpoint: "https://ark.example/api/plan/v3/responses",
      protocol: "responses",
      fetchImpl: async () => {
        fallbackCalls += 1;
        return modelResponse('{"answer":"YES"}');
      },
    },
  });

  await assert.rejects(
    gateway.callStructured({
      callType: "adjudication",
      schemaName: "test_answer",
      schema,
      example: { answer: "YES" },
      validator,
      instructions: "rules",
      input: "data",
      attempts: 1,
    }),
    (error: unknown) => error instanceof AiProviderError && error.upstreamStatus === 503,
  );
  assert.equal(fallbackCalls, 0);
});

test("非结构化 Chat 短任务遇到 429 时切换模型且移除 DeepSeek 扩展参数", async () => {
  const calls: Array<{ url: string; body: any; authorization: string }> = [];
  const response = await fetchAiChatWithRateLimitFallback({
    model: "deepseek-v4-flash",
    messages: [{ role: "user", content: "test" }],
    thinking: { type: "disabled" },
  }, {
    primaryApiKey: "deepseek-key",
    fallbackApiKey: "ark-key",
    primaryEndpoint: "https://deepseek.example/chat/completions",
    fallbackEndpoint: "https://ark.example/api/plan/v3/chat/completions",
    fallbackModel: "ark-code-latest",
    fetchImpl: async (input, init) => {
      const headers = init?.headers as Record<string, string>;
      calls.push({
        url: String(input),
        body: JSON.parse(String(init?.body)),
        authorization: headers.Authorization,
      });
      return calls.length === 1
        ? new Response("{}", { status: 429, headers: { "Content-Type": "application/json" } })
        : chatModelResponse('{"answer":"YES"}');
    },
  });

  assert.equal(response.status, 200);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].authorization, "Bearer deepseek-key");
  assert.equal(calls[1].authorization, "Bearer ark-key");
  assert.equal(calls[1].body.model, "ark-code-latest");
  assert.equal("thinking" in calls[1].body, false);
});
