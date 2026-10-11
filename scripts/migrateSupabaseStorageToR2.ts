import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { isR2Configured, uploadPublicObject } from '../services/objectStorage.js';

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceKey) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
if (!isR2Configured()) throw new Error('Configure all R2 variables before running the media migration.');

const apply = process.argv.includes('--apply');
const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
const buckets = ['news-images', 'social-graphics'];
const replacements = new Map<string, string>();
let copied = 0;
let failed = 0;

function r2UrlFor(key: string) {
  const base = String(process.env.R2_PUBLIC_BASE_URL || '').replace(/\/$/, '');
  return `${base}/${key.split('/').map(part => encodeURIComponent(part).replace(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)).join('/')}`;
}
function replaceUrl(value: unknown): unknown {
  if (typeof value === 'string') {
    const clean = value.split('?')[0];
    const replacement = replacements.get(clean);
    return replacement ? replacement + (value.includes('?') ? `?${value.split('?').slice(1).join('?')}` : '') : value;
  }
  if (Array.isArray(value)) return value.map(replaceUrl);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaceUrl(item)]));
  return value;
}
async function listAndCopy(bucket: string, prefix = ''): Promise<void> {
  let offset = 0;
  const limit = 100;
  while (true) {
    const { data, error } = await db.storage.from(bucket).list(prefix, { limit, offset, sortBy: { column: 'name', order: 'asc' } });
    if (error) throw new Error(`Unable to list ${bucket}/${prefix}: ${error.message}`);
    const entries = data || [];
    for (const entry of entries) {
      const key = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (!entry.id && !entry.metadata) {
        await listAndCopy(bucket, key);
        continue;
      }
      const oldUrl = db.storage.from(bucket).getPublicUrl(key).data.publicUrl.split('?')[0];
      if (!apply) {
        replacements.set(oldUrl, r2UrlFor(`${bucket}/${key}`));
        continue;
      }
      const { data: blob, error: downloadError } = await db.storage.from(bucket).download(key);
      if (downloadError || !blob) {
        failed++;
        console.error(`Download failed: ${bucket}/${key}: ${downloadError?.message || 'no file returned'}`);
        continue;
      }
      const bytes = Buffer.from(await blob.arrayBuffer());
      const mime = String(entry.metadata?.mimetype || (key.endsWith('.svg') ? 'image/svg+xml' : 'application/octet-stream'));
      try {
        await uploadPublicObject(`${bucket}/${key}`, bytes, { contentType: mime, cacheControl: 'public, max-age=31536000, immutable' });
        replacements.set(oldUrl, r2UrlFor(`${bucket}/${key}`));
        copied++;
      } catch (error) {
        failed++;
        console.error(`R2 upload failed: ${bucket}/${key}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (entries.length < limit) break;
    offset += limit;
  }
}
async function updateRows(table: string, select: string, idColumn: string, fields: string[]) {
  let offset = 0;
  const pageSize = 500;
  while (true) {
    let query = db.from(table).select(select).range(offset, offset + pageSize - 1);
    const { data, error } = await query;
    if (error) {
      if (/does not exist|schema cache|not find/i.test(error.message)) {
        console.warn(`Skipping optional table/fields ${table}: ${error.message}`);
        return;
      }
      throw error;
    }
    const rows = data || [];
    for (const row of rows as Record<string, any>[]) {
      const update: Record<string, unknown> = {};
      for (const field of fields) {
        const next = replaceUrl(row[field]);
        if (JSON.stringify(next) !== JSON.stringify(row[field])) update[field] = next;
      }
      if (!Object.keys(update).length) continue;
      if (!apply) {
        console.log(`Would update ${table} ${idColumn}=${row[idColumn]}: ${Object.keys(update).join(', ')}`);
        continue;
      }
      const { error: updateError } = await db.from(table).update(update).eq(idColumn, row[idColumn]);
      if (updateError) {
        failed++;
        console.error(`DB update failed for ${table} ${row[idColumn]}: ${updateError.message}`);
      }
    }
    if (rows.length < pageSize) break;
    offset += pageSize;
  }
}

console.log(apply ? 'RUNNING IN APPLY MODE: copying objects and updating database URLs.' : 'DRY RUN: no files or database rows will be changed. Re-run with --apply to execute.');
for (const bucket of buckets) {
  try { await listAndCopy(bucket); }
  catch (error) { failed++; console.error(error instanceof Error ? error.message : String(error)); }
}
console.log(`Storage scan complete. ${replacements.size} object URLs found; ${copied} copied; ${failed} failures.`);
if (apply) {
  await updateRows('articles', 'id,featured_image_url', 'id', ['featured_image_url']);
  await updateRows('advertisements', 'id,image_url', 'id', ['image_url']);
  await updateRows('social_templates', 'id,background_url', 'id', ['background_url']);
  await updateRows('social_graphics', 'article_id,source_image_url,assets', 'article_id', ['source_image_url', 'assets']);
  console.log(`Migration finished. ${copied} objects copied; ${failed} failures. Do not delete Supabase buckets until you verify the public R2 URLs and social publishing.`);
} else {
  console.log('Review the object count and database updates above. Run with --apply to copy objects and update known URL fields.');
}
