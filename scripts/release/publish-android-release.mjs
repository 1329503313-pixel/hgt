import { readFileSync } from "node:fs";

if (!process.argv.includes("--confirm-publish")) {
  throw new Error("Refusing to publish without --confirm-publish.");
}
const descriptorIndex = process.argv.indexOf("--descriptor");
const descriptorPath = process.argv[descriptorIndex + 1];
if (descriptorIndex < 0 || !descriptorPath) throw new Error("--descriptor is required.");

const descriptor = JSON.parse(readFileSync(descriptorPath, "utf8").replace(/^\uFEFF/, ""));
if (!Number.isInteger(descriptor.versionCode) || descriptor.versionCode < 1) throw new Error("Invalid versionCode.");
if (!descriptor.versionName || descriptor.minSupportedVersionCode !== 0) throw new Error("Only a non-forced release with minSupportedVersionCode=0 is accepted.");
if (!descriptor.apkUrl?.startsWith("https://zgkc-storage.kjcxchina.com/hgt/apps/")) throw new Error("Invalid APK URL.");
if (!/^[0-9a-f]{64}$/.test(descriptor.apkSha256 ?? "")) throw new Error("Invalid APK SHA-256.");
if (!Array.isArray(descriptor.releaseNotes) || descriptor.releaseNotes.length < 1) throw new Error("Release notes are required.");
if (descriptor.releaseNotes.length > 30 || descriptor.releaseNotes.some((note) => typeof note !== "string" || !note.trim() || note.length > 500)) {
  throw new Error("Release notes must contain 1-30 non-empty strings of at most 500 characters.");
}
if (Number.isNaN(new Date(descriptor.publishedAt).getTime())) throw new Error("Invalid publishedAt.");
if (descriptor.enabled !== true) throw new Error("The release must be enabled.");
const publishPayload = {
  versionCode: descriptor.versionCode,
  versionName: descriptor.versionName,
  minSupportedVersionCode: descriptor.minSupportedVersionCode,
  apkUrl: descriptor.apkUrl,
  releaseNotes: descriptor.releaseNotes,
  publishedAt: descriptor.publishedAt,
  enabled: descriptor.enabled
};

const baseUrl = process.env.HGT_ADMIN_API_ORIGIN?.trim() || "http://127.0.0.1:4000";
const username = process.env.HGT_ADMIN_USERNAME?.trim() || "admin";
const password = process.env.HGT_ADMIN_PASSWORD_FILE
  ? readFileSync(process.env.HGT_ADMIN_PASSWORD_FILE, "utf8").trim()
  : process.env.ADMIN_DEFAULT_PASSWORD?.trim();
if (!password) throw new Error("Administrator credential is unavailable.");

const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Accept: "application/json" },
  body: JSON.stringify({ username, password })
});
if (!loginResponse.ok) throw new Error(`Administrator login failed (${loginResponse.status}).`);
const login = await loginResponse.json();
if (!(["admin", "super_admin"].includes(login?.user?.role)) || !login?.token) {
  throw new Error("Authenticated account is not an administrator.");
}
const headers = { Accept: "application/json", Authorization: `Bearer ${login.token}` };
const readReleases = async () => {
  const response = await fetch(`${baseUrl}/api/admin/android-releases`, { headers });
  if (!response.ok) throw new Error(`Unable to read Android releases (${response.status}).`);
  return (await response.json()).releases;
};
const normalize = (record) => ({
  versionCode: record.latestVersionCode,
  versionName: record.latestVersionName,
  minSupportedVersionCode: record.minSupportedVersionCode,
  apkUrl: record.apkUrl,
  releaseNotes: record.releaseNotes,
  publishedAt: new Date(record.publishedAt).toISOString(),
  enabled: record.enabled
});
const expected = normalize({
  latestVersionCode: descriptor.versionCode,
  latestVersionName: descriptor.versionName,
  ...publishPayload
});
const canonical = (records) => JSON.stringify([...records].sort((a, b) => a.id.localeCompare(b.id)));
const before = await readReleases();
const existing = before.find((record) => record.latestVersionCode === descriptor.versionCode);
if (existing) {
  if (JSON.stringify(normalize(existing)) !== JSON.stringify(expected)) {
    throw new Error(`versionCode ${descriptor.versionCode} exists with different metadata.`);
  }
  process.stdout.write(`${JSON.stringify({ id: existing.id, status: "already-published", otherRecordsUnchanged: true }, null, 2)}\n`);
  process.exit(0);
}
const beforeCanonical = canonical(before);
const createResponse = await fetch(`${baseUrl}/api/admin/android-releases`, {
  method: "POST",
  headers: { ...headers, "Content-Type": "application/json" },
  body: JSON.stringify(publishPayload)
});
if (!createResponse.ok) throw new Error(`Android release publish failed (${createResponse.status}): ${await createResponse.text()}`);
const { id } = await createResponse.json();
const after = await readReleases();
const created = after.find((record) => record.id === id);
if (!created || JSON.stringify(normalize(created)) !== JSON.stringify(expected)) {
  throw new Error("Published Android release metadata does not match the descriptor.");
}
if (canonical(after.filter((record) => record.id !== id)) !== beforeCanonical) {
  throw new Error("Another Android release changed unexpectedly.");
}
process.stdout.write(`${JSON.stringify({ id, status: "published", beforeCount: before.length, afterCount: after.length, otherRecordsUnchanged: true }, null, 2)}\n`);
