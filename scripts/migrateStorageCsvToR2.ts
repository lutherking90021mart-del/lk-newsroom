import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { readFile, writeFile, readdir, stat } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { uploadPublicObject, isR2Configured } from "../services/objectStorage.js";

type CsvRow = Record<string, string>;
const args = process.argv.slice(2);
const apply = args.includes("--apply");
const rootArg = args.find(arg => !arg.startsWith("--"));
const root = resolve(rootArg || join(process.env.USERPROFILE || process.env.HOME || ".", "Desktop", "LK-Newsroom-Complete-Backup"));
const limitArg = args.find(arg => arg.startsWith("--limit="));
const limit = limitArg ? Math.max(1, Number(limitArg.split("=")[1]) || 1) : Number.POSITIVE_INFINITY;
const bucketArg = args.find(arg => arg.startsWith("--bucket="))?.split("=").slice(1).join("=").trim() || "";
const supabaseUrl = process.env.SUPABASE_URL?.trim();
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

function parseCsvLineStream(csv: string): CsvRow[] {
  const records: string[][] = [];
  let row: string[] = [], field = "", quoted = false;
  for (let i = 0; i < csv.length; i++) {
    const ch = csv[i];
    if (quoted) {
      if (ch === '"' && csv[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else {
      if (ch === '"' && field.length === 0) quoted = true;
      else if (ch === ",") { row.push(field); field = ""; }
      else if (ch === "\n") { row.push(field.replace(/\r$/, "")); records.push(row); row = []; field = ""; }
      else field += ch;
    }
  }
  if (field.length || row.length) { row.push(field.replace(/\r$/, "")); records.push(row); }
  if (!records.length) return [];
  const headers = records.shift()!.map(h => h.trim().replace(/^\uFEFF/, ""));
  return records.filter(values => values.some(v => v !== "")).map(values => Object.fromEntries(headers.map((h, i) => [h, values[i] ?? ""])));
}
async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  let items;
  try { items = await readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const item of items) {
    const path = join(dir, item.name);
    if (item.isDirectory()) out.push(...await walk(path));
    else if (item.isFile()) out.push(path);
  }
  return out;
}
async function pickTableCsv(rootDir: string, schema: string, table: string): Promise<{ files: string[]; rows: CsvRow[]; folder: string } | null> {
  const files = await walk(rootDir);
  const grouped = new Map<string, string[]>();
  for (const path of files) {
    if (!/^part-\d+\.csv$/i.test(path.split(/[\\/]/).pop() || "")) continue;
    const parent = path.split(/[\\/]/).slice(-2, -1)[0] || "";
    const schemaParent = path.split(/[\\/]/).slice(-3, -2)[0] || "";
    if (parent.toLowerCase().replace(/[-.]/g, "_") !== table.toLowerCase().replace(/[-.]/g, "_")) continue;
    if (schema && schemaParent.toLowerCase() !== schema.toLowerCase()) continue;
    const folder = path.split(/[\\/]/).slice(0, -1).join("/");
    const arr = grouped.get(folder) || [];
    arr.push(path); grouped.set(folder, arr);
  }
  let best: { files: string[]; rows: CsvRow[]; folder: string } | null = null;
  for (const [folder, candidates] of grouped) {
    const paths = candidates.sort();
    const rows: CsvRow[] = [];
    for (const path of paths) rows.push(...parseCsvLineStream(await readFile(path, "utf8")));
    if (!best || rows.length > best.rows.length || (rows.length === best.rows.length && paths.length > best.files.length)) best = { files: paths, rows, folder: relative(rootDir, folder) };
  }
  return best;
}
function parseBoolean(value: unknown): boolean {
  return ["true", "t", "1", "yes"].includes(String(value || "").trim().toLowerCase());
}
function encodePath(value: string) {
  return value.split("/").map(part => encodeURIComponent(part)).join("/");
}
function csvEscape(value: unknown) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}
function metadataMime(raw: string, name: string) {
  try {
    const parsed = JSON.parse(raw || "{}");
    if (typeof parsed.mimetype === "string" && parsed.mimetype) return parsed.mimetype;
    if (typeof parsed.contentType === "string" && parsed.contentType) return parsed.contentType;
  } catch {}
  const extension = name.toLowerCase().split(".").pop();
  const mime: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", svg: "image/svg+xml", mp4: "video/mp4", webm: "video/webm", pdf: "application/pdf", mp3: "audio/mpeg", avif: "image/avif" };
  return mime[extension || ""] || "application/octet-stream";
}
async function runWithConcurrency<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>) {
  let next = 0;
  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      await fn(items[index]);
    }
  });
  await Promise.all(workers);
}

async function main() {
  if (!await stat(root).catch(() => null)) throw new Error("Backup folder not found: " + root);
  const objects = await pickTableCsv(root, "storage", "objects");
  const buckets = await pickTableCsv(root, "storage", "buckets");
  if (!objects?.rows.length) throw new Error("No storage.objects part-*.csv files found. This script expects the exported storage metadata.");
  if (!buckets?.rows.length) throw new Error("No storage.buckets part-*.csv files found. Public/private bucket flags are required; refusing to guess which objects are public.");
  const publicBuckets = new Set(buckets.rows.filter(row => parseBoolean(row.public)).map(row => row.id).filter(Boolean));
  const eligible = objects.rows.filter(row => row.bucket_id && row.name && publicBuckets.has(row.bucket_id) && (!bucketArg || row.bucket_id === bucketArg));
  const selected = eligible.slice(0, limit);
  console.log("Backup folder:", root);
  console.log("Objects metadata rows found:", objects.rows.length, "from", objects.folder);
  console.log("Bucket metadata rows found:", buckets.rows.length, "from", buckets.folder);
  console.log("Public buckets:", [...publicBuckets].join(", ") || "(none)");
  console.log("Objects selected:", selected.length, apply ? "(APPLY: downloads and uploads actual file bytes)" : "(DRY RUN: no network requests or uploads)");
  console.log("Target R2 bucket:", process.env.R2_BUCKET_NAME || "(not configured)");
  if (!apply) {
    console.log("Dry-run complete. Add --apply only after confirming this public-object count and the R2 bucket configuration.");
    return;
  }
  if (!supabaseUrl || !serviceKey) throw new Error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in your local environment; do not paste them into chat.");
  if (!isR2Configured()) throw new Error("Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME and R2_PUBLIC_BASE_URL in your local environment.");
  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const mappingPath = join(root, "cloudflare-media-map.csv");
  const mappings: string[] = ["bucket_id,name,old_public_url,new_public_url,status,error"];
  let copied = 0, failed = 0, skipped = 0;
  await runWithConcurrency(selected, 4, async row => {
    const bucket = String(row.bucket_id);
    const name = String(row.name);
    const oldUrl = supabase.storage.from(bucket).getPublicUrl(name).data.publicUrl;
    const key = "media/" + bucket + "/" + name.replace(/^\/+/, "");
    let newUrl = "";
    let status = "failed";
    let message = "";
    try {
      const { data, error } = await supabase.storage.from(bucket).download(name);
      if (error || !data) throw new Error(error?.message || "Storage returned no file data");
      const body = Buffer.from(await data.arrayBuffer());
      if (body.byteLength > 1_950_000) {
        // D1 doesn't store media bytes, so large files are valid for R2. This only guards memory mistakes.
        console.log("Large media file:", bucket + "/" + name, body.byteLength, "bytes");
      }
      newUrl = await uploadPublicObject(key, body, {
        contentType: metadataMime(String(row.metadata || ""), name),
        cacheControl: "public, max-age=31536000, immutable"
      });
      status = "copied"; copied++;
    } catch (error) {
      failed++;
      message = (error instanceof Error ? error.message : String(error)).replace(/[\r\n,]+/g, " ").slice(0, 300);
      if (/quota|402|restricted|not authorized|forbidden/i.test(message)) {
        console.error("Source download failed; the Supabase Storage API may still be restricted. Stopping after this object to avoid repeated failures.");
        status = "source_unavailable";
      }
    }
    mappings.push([bucket, name, oldUrl, newUrl, status, message].map(csvEscape).join(","));
    if (status === "source_unavailable") skipped = selected.length - copied - failed;
    if ((copied + failed) % 100 === 0) console.log("Progress:", copied + failed, "/", selected.length, "copied:", copied, "failed:", failed);
    // A source restriction should be investigated rather than hammering the old project.
    if (status === "source_unavailable") throw new Error("STOP_ON_SOURCE_RESTRICTION");
  }).catch(async error => {
    if (!(error instanceof Error && error.message === "STOP_ON_SOURCE_RESTRICTION")) throw error;
  });
  await writeFile(mappingPath, mappings.join("\n") + "\n", "utf8");
  console.log("Media migration attempt complete. Copied:", copied, "Failed:", failed, "Not attempted:", skipped);
  console.log("URL mapping written to:", mappingPath);
  console.log("Review failed rows before generating the D1 import. Do not change DNS or delete old storage based on a partial copy.");
}
main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
