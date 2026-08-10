import { createReadStream, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import OSS from "ali-oss";

const repoRoot = resolve(import.meta.dirname, "..", "..");
const artifactRoot = resolve(repoRoot, "artifacts", "web-resources");
const bucket = "zgkc-storage";
const keyPrefix = "hgt/web-resources";

function secret(envName, fileEnvName) {
  if (process.env[fileEnvName]) return readFileSync(process.env[fileEnvName], "utf8").trim();
  return process.env[envName]?.trim() ?? "";
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

if (!process.argv.includes("--confirm-upload")) {
  fail("Refusing to upload without --confirm-upload.");
}

const version = JSON.parse(
  readFileSync(resolve(repoRoot, "apps", "app-android", "release", "version.json"), "utf8").replace(/^﻿/, "")
);
const versionName = version.versionName;

const manifest = JSON.parse(
  readFileSync(resolve(artifactRoot, versionName, "web-resource-manifest.json"), "utf8")
);

const zipPath = resolve(artifactRoot, versionName, manifest.fileName);
if (!statSync(zipPath).isFile()) fail(`ZIP not found: ${zipPath}`);

const endpoint = process.env.ALIYUN_OSS_ENDPOINT?.trim() ?? "";
const region = process.env.ALIYUN_OSS_REGION?.trim() ?? "";
const accessKeyId = secret("ALIYUN_OSS_ACCESS_KEY_ID", "ALIYUN_OSS_ACCESS_KEY_ID_FILE");
const accessKeySecret = secret("ALIYUN_OSS_ACCESS_KEY_SECRET", "ALIYUN_OSS_ACCESS_KEY_SECRET_FILE");

if (!endpoint || !region || !accessKeyId || !accessKeySecret) {
  fail("OSS credentials are incomplete; upload was not attempted.");
}

const objectKey = `${keyPrefix}/${versionName}/${manifest.fileName}`;
const publicUrl = `https://zgkc-storage.kjcxchina.com/${objectKey.split("/").map(encodeURIComponent).join("/")}`;

const client = new OSS({
  endpoint,
  region,
  bucket,
  accessKeyId,
  accessKeySecret,
  authorizationV4: true,
  secure: endpoint.startsWith("https://"),
  timeout: 300_000
});

await client.put(objectKey, createReadStream(zipPath), {
  headers: {
    "Content-Type": "application/zip",
    "Cache-Control": "public, max-age=31536000, immutable",
    "Content-Disposition": `attachment; filename="${manifest.fileName}"`,
    "x-oss-object-acl": "public-read",
    "x-oss-forbid-overwrite": "true"
  }
});

process.stdout.write(`ZIP_URL=${publicUrl}\n`);
process.stdout.write(`ZIP_SIZE=${manifest.fileSize}\n`);
process.stdout.write(`ZIP_SHA256=${manifest.sha256}\n`);
