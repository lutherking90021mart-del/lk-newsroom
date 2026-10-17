import "dotenv/config";
import { createHash } from "node:crypto";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";
import { uploadPrivateObject, isR2PrivateConfigured } from "../services/objectStorage.js";

const argv = process.argv.slice(2);
const apply = argv.includes("--apply");
const pathArg = argv.find(value => !value.startsWith("--"));
const root = resolve(pathArg || join(process.env.USERPROFILE || process.env.HOME || ".", "Desktop", "LK-Newsroom-Complete-Backup"));
const desktop = resolve(root, "..");
const manifestPath = join(root, "cloudflare-private-archive-manifest.csv");
const batchPattern = /^(?:LK-Newsroom.*|social-graphics.*|feed-logs.*)\.csv$/i;

async function walk(folder: string): Promise<string[]> {
  const found: string[] = [];
  let entries;
  try { entries = await readdir(folder, { withFileTypes: true }); } catch { return found; }
  for (const entry of entries) {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) found.push(...await walk(path));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith(".csv")) found.push(path);
  }
  return found;
}
function csvEscape(value: unknown) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}
function contentType(path: string) {
  return path.toLowerCase().endsWith(".csv") ? "text/csv; charset=utf-8" : "application/octet-stream";
}
function safeKey(value: string) {
  return value.replace(/\\/g, "/").split("/").filter(part => part && part !== "." && part !== "..").map(part => part.replace(/[^\w.\-]/g, "_")).join("/");
}
async function main() {
  if (!await stat(root).catch(() => null)) throw new Error("Backup folder not found: " + root);
  const backupCsvs = (await walk(root)).filter(path => basename(path).toLowerCase() !== 'cloudflare-private-archive-manifest.csv');
  const desktopCsvs = (await readdir(desktop, { withFileTypes: true }).catch(() => []))
    .filter(entry => entry.isFile() && batchPattern.test(entry.name))
    .map(entry => join(desktop, entry.name));
  const unique = Array.from(new Set([...backupCsvs, ...desktopCsvs])).sort();
  if (!unique.length) throw new Error("No CSV export files found inside the backup folder or verified batch CSVs directly on the Desktop.");
  const totalBytes = (await Promise.all(unique.map(async path => (await stat(path)).size))).reduce((sum, value) => sum + value, 0);
  console.log("CSV archive root:", root);
  console.log("Direct Desktop batch files:", desktopCsvs.length);
  console.log("CSV files selected:", unique.length);
  console.log("Total bytes:", totalBytes.toLocaleString());
  console.log("Target bucket: R2_PRIVATE_BUCKET_NAME (must be a private R2 bucket with no public development URL)");
  console.log("Mode:", apply ? "APPLY — uploads private archives; leaves every local file unchanged" : "DRY RUN — no uploads");
  if (!apply) {
    console.log("To archive the files, create the private bucket and set R2_PRIVATE_BUCKET_NAME plus an R2 token with write access to that bucket, then rerun with --apply.");
    return;
  }
  if (!isR2PrivateConfigured()) throw new Error("Private R2 is not configured. Set R2_PRIVATE_BUCKET_NAME and the R2 credentials locally. Do not put secrets in GitHub or chat.");
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "").replace("T", "-").replace("Z", "");
  const lines = ["local_path,bytes,sha256,r2_key,status,error"];
  let success = 0, failed = 0;
  for (let index = 0; index < unique.length; index++) {
    const path = unique[index];
    const buffer = await readFile(path);
    const hash = createHash("sha256").update(buffer).digest("hex");
    const localRelative = path.startsWith(root + "\\") || path.startsWith(root + "/")
      ? relative(root, path)
      : "desktop-batches/" + basename(path);
    const key = "database-export-archive/" + safeKey(localRelative) + "." + hash.slice(0, 12) + ".csv";
    let status = "failed", errorText = "";
    try {
      await uploadPrivateObject(key, buffer, { contentType: contentType(path), cacheControl: "private, max-age=0, no-cache" });
      status = "copied"; success++;
      console.log("[" + (index + 1) + "/" + unique.length + "] archived " + localRelative);
    } catch (error) {
      failed++;
      errorText = (error instanceof Error ? error.message : String(error)).replace(/[\r\n,]+/g, " ").slice(0, 300);
      console.error("[" + (index + 1) + "/" + unique.length + "] failed " + localRelative + ": " + errorText);
    }
    lines.push([localRelative, buffer.byteLength, hash, key, status, errorText].map(csvEscape).join(","));
  }
  const manifest = lines.join("\n") + "\n";
  await writeFile(manifestPath, manifest, "utf8");
  // Store the manifest itself in the private bucket, and keep the local copy.
  const manifestKey = "database-export-archive/manifests/" + stamp + ".csv";
  try {
    await uploadPrivateObject(manifestKey, Buffer.from(manifest, "utf8"), { contentType: "text/csv; charset=utf-8", cacheControl: "private, max-age=0, no-cache" });
    console.log("Private archive manifest:", manifestKey);
  } catch (error) {
    failed++;
    console.error("Manifest upload failed: " + (error instanceof Error ? error.message : String(error)));
  }
  console.log("Archive finished. Copied:", success, "Failed:", failed, "Local files preserved.");
  console.log("Local manifest:", manifestPath);
  if (failed) process.exitCode = 1;
}
main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
