import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const publicPrefix = "apps/web/public/";

export function createAssetManifest(commit, cwd) {
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error("A full release commit is required.");
  // NUL delimiters and explicit UTF-8 avoid both Git's quoted paths and the shell code page.
  const tree = execFileSync("git", ["ls-tree", "-r", "-z", commit, "--", publicPrefix], {
    cwd, encoding: "utf8", maxBuffer: 16 * 1024 * 1024
  });
  const files = tree.split("\0").filter(Boolean).map((entry) => {
    const match = /^(100644|100755) blob ([0-9a-f]{40})\t([\s\S]+)$/.exec(entry);
    if (!match || !match[3].startsWith(publicPrefix)) throw new Error("Unexpected public asset tree entry.");
    return { path: match[3].slice(publicPrefix.length), gitBlob: match[2] };
  });
  if (!files.length) throw new Error("Release has no public assets.");
  return { version: 1, commit, files };
}

export function verifyAssets(manifest, root) {
  if (manifest.version !== 1 || !Array.isArray(manifest.files) || !manifest.files.length) {
    throw new Error("Invalid public asset manifest.");
  }
  const base = resolve(root);
  const failures = [];
  for (const file of manifest.files) {
    const target = resolve(base, file.path);
    if (!target.startsWith(base + sep) || !/^[0-9a-f]{40}$/.test(file.gitBlob)) {
      throw new Error("Invalid public asset manifest entry.");
    }
    try {
      if (!lstatSync(target).isFile()) throw new Error("not a regular file");
      const bytes = readFileSync(target);
      const hash = createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
      if (hash !== file.gitBlob) throw new Error("content differs from Git");
    } catch (error) {
      failures.push(`${file.path}: ${error.code === "ENOENT" ? "missing (check filename encoding)" : error.message}`);
    }
  }
  if (failures.length) throw new Error(`Public asset verification failed (${failures.length}):\n${failures.join("\n")}`);
  return manifest.files.length;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [mode, ...args] = process.argv.slice(2);
  const option = (name) => {
    const index = args.indexOf(name);
    if (index < 0 || !args[index + 1]) throw new Error(`Missing ${name}`);
    return args[index + 1];
  };
  if (mode === "create") {
    const manifest = createAssetManifest(option("--commit"), resolve(import.meta.dirname, "../.."));
    writeFileSync(option("--manifest"), JSON.stringify(manifest, null, 2) + "\n", "utf8");
    console.log(`Recorded ${manifest.files.length} public assets from ${manifest.commit}`);
  } else if (mode === "verify") {
    const manifest = JSON.parse(readFileSync(option("--manifest"), "utf8"));
    console.log(`Verified ${verifyAssets(manifest, option("--root"))} public asset paths and contents`);
  } else {
    throw new Error("Expected create or verify.");
  }
}
