import OSS from "ali-oss";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { config } from "./config.js";

const OSS_REF_PREFIX = "oss://";
let client: OSS | null = null;

export type StoredMediaInput = {
  category: string;
  entityId: string;
  variant: string;
  contentType: string;
  extension: string;
  cacheControl?: string;
};

function cleanPathPart(value: string) {
  return value
    .trim()
    .replaceAll("\\", "/")
    .split("/")
    .filter(Boolean)
    .map((part) => encodeURIComponent(part).replaceAll("%", "_"))
    .join("/");
}

function normalizedEndpoint() {
  return config.aliyunOss.endpoint.trim().replace(/\/+$/, "");
}

function normalizedPrefix() {
  return cleanPathPart(config.aliyunOss.keyPrefix);
}

export function ossConfigured() {
  const values = [
    config.aliyunOss.endpoint,
    config.aliyunOss.region,
    config.aliyunOss.bucket,
    config.aliyunOss.keyPrefix,
    config.aliyunOss.accessKeyId,
    config.aliyunOss.accessKeySecret
  ];
  return values.every((value) => Boolean(value.trim()));
}

export function assertOssConfigured() {
  if (!ossConfigured()) {
    throw new Error("OSS_CONFIG_INCOMPLETE");
  }
}

export function ossClient() {
  assertOssConfigured();
  if (!client) {
    client = new OSS({
      endpoint: normalizedEndpoint(),
      region: config.aliyunOss.region,
      bucket: config.aliyunOss.bucket,
      accessKeyId: config.aliyunOss.accessKeyId,
      accessKeySecret: config.aliyunOss.accessKeySecret,
      authorizationV4: true,
      secure: normalizedEndpoint().startsWith("https://"),
      timeout: 120_000
    });
  }
  return client;
}

export function isOssRef(value: unknown): value is string {
  return typeof value === "string" && value.startsWith(OSS_REF_PREFIX);
}

export function ossKeyFromRef(value: string) {
  if (!isOssRef(value)) return null;
  const withoutScheme = value.slice(OSS_REF_PREFIX.length);
  const slash = withoutScheme.indexOf("/");
  if (slash < 1) return null;
  const bucket = withoutScheme.slice(0, slash);
  if (bucket !== config.aliyunOss.bucket) return null;
  const key = withoutScheme.slice(slash + 1);
  return key && !key.startsWith("/") && !key.includes("..") ? key : null;
}

export function ossRef(key: string) {
  return `${OSS_REF_PREFIX}${config.aliyunOss.bucket}/${key}`;
}

export function publicOssUrl(value: unknown) {
  if (!isOssRef(value)) return value ? String(value) : null;
  const key = ossKeyFromRef(value);
  if (!key) return null;
  const endpoint = new URL(normalizedEndpoint());
  return `${endpoint.protocol}//${config.aliyunOss.bucket}.${endpoint.host}/${key.split("/").map(encodeURIComponent).join("/")}`;
}

export function ossRefFromPublicUrl(value: string) {
  try {
    const url = new URL(value);
    const endpoint = new URL(normalizedEndpoint());
    if (url.protocol !== endpoint.protocol || url.host !== `${config.aliyunOss.bucket}.${endpoint.host}`) return null;
    const key = url.pathname.slice(1).split("/").map(decodeURIComponent).join("/");
    return key ? ossRef(key) : null;
  } catch {
    return null;
  }
}

export function mediaObjectKey(input: StoredMediaInput, content: Buffer) {
  const digest = createHash("sha256").update(content).digest("hex");
  const parts = [
    normalizedPrefix(),
    cleanPathPart(input.category),
    cleanPathPart(input.entityId),
    cleanPathPart(input.variant),
    `${digest}.${cleanPathPart(input.extension).replace(/^\./, "")}`
  ].filter(Boolean);
  return parts.join("/");
}

export async function storeMediaBuffer(content: Buffer, input: StoredMediaInput) {
  assertOssConfigured();
  if (!content.length) throw new Error("OSS_MEDIA_EMPTY");
  const key = mediaObjectKey(input, content);
  await ossClient().put(key, content, {
    headers: {
      "Content-Type": input.contentType,
      "Cache-Control": input.cacheControl ?? "public, max-age=31536000, immutable",
      "x-oss-object-acl": "public-read",
      "x-oss-forbid-overwrite": "true"
    }
  }).catch((error: { code?: string }) => {
    if (error?.code !== "FileAlreadyExists") throw error;
  });
  return ossRef(key);
}

export async function storeDataImage(value: string, input: StoredMediaInput) {
  const match = /^data:(image\/[^;]+);base64,([\s\S]+)$/i.exec(value);
  if (!match) throw new Error("MEDIA_DATA_URL_INVALID");
  return storeMediaBuffer(Buffer.from(match[2], "base64"), {
    ...input,
    contentType: match[1]
  });
}

export async function readOssBuffer(value: string) {
  const key = ossKeyFromRef(value);
  if (!key) throw new Error("OSS_REF_INVALID");
  const result = await ossClient().get(key);
  return Buffer.isBuffer(result.content) ? result.content : Buffer.from(result.content);
}

export async function readStoredMediaBuffer(value: string, legacyRoot?: string) {
  if (isOssRef(value)) return readOssBuffer(value);
  const data = /^data:[^;,]+;base64,([\s\S]+)$/i.exec(value);
  if (data) return Buffer.from(data[1], "base64");
  if (/^https?:\/\//i.test(value)) {
    const response = await fetch(value);
    if (!response.ok) throw new Error(`MEDIA_DOWNLOAD_FAILED:${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  }
  if (legacyRoot) {
    const absolute = isAbsolute(value) ? value : resolve(legacyRoot, value);
    return readFile(absolute);
  }
  throw new Error("MEDIA_SOURCE_UNSUPPORTED");
}

export async function verifyPublicObject(value: string) {
  const url = publicOssUrl(value);
  if (!url) return false;
  const response = await fetch(url, { method: "GET", headers: { Range: "bytes=0-0" } });
  return response.status === 200 || response.status === 206;
}
