import { isR2Configured, uploadPublicObject } from './objectStorage.js';

export interface PublishedArticleSnapshot {
  schemaVersion: 1;
  slug: string;
  versionId: string;
  publishedAt: string;
  article: Record<string, unknown>;
}

const publicBaseUrl = () => String(process.env.R2_PUBLIC_BASE_URL || '').trim().replace(/\/$/, '');

function safeSegment(value: string, label: string) {
  const clean = String(value || '').trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,159}$/.test(clean) || clean === '.' || clean === '..') {
    throw new Error(`Invalid ${label}.`);
  }
  return clean;
}

function snapshotKey(slug: string, versionId: string) {
  return `articles/${safeSegment(slug, 'article slug')}/${safeSegment(versionId, 'version ID')}.json`;
}

/**
 * Stores a published article as an immutable JSON snapshot in R2.
 * This is deliberately separate from the current database-backed routes: callers
 * must only pass already-published, public-safe article data and must not include
 * private user data, access tokens, or moderation-only fields.
 */
export async function writePublishedArticleSnapshot(input: {
  slug: string;
  versionId: string;
  publishedAt: string;
  article: Record<string, unknown>;
}): Promise<{ key: string; url: string }> {
  if (!isR2Configured()) throw new Error('Cloudflare R2 is not configured.');
  const slug = safeSegment(input.slug, 'article slug');
  const versionId = safeSegment(input.versionId, 'version ID');
  const publishedAt = new Date(input.publishedAt);
  if (!Number.isFinite(publishedAt.getTime())) throw new Error('Invalid publishedAt timestamp.');
  if (!input.article || typeof input.article !== 'object' || Array.isArray(input.article)) {
    throw new Error('Article must be a JSON object.');
  }

  const snapshot: PublishedArticleSnapshot = {
    schemaVersion: 1,
    slug,
    versionId,
    publishedAt: publishedAt.toISOString(),
    article: input.article
  };
  const key = snapshotKey(slug, versionId);
  const url = await uploadPublicObject(key, Buffer.from(JSON.stringify(snapshot), 'utf8'), {
    contentType: 'application/json; charset=utf-8',
    cacheControl: 'public, max-age=31536000, immutable'
  });
  return { key, url };
}

/**
 * Reads a public article snapshot by slug and immutable version ID.
 * The configured R2 public base URL must be reachable from the server.
 */
export async function readPublishedArticleSnapshot(
  slugValue: string,
  versionValue: string
): Promise<PublishedArticleSnapshot | null> {
  const base = publicBaseUrl();
  if (!base) throw new Error('R2_PUBLIC_BASE_URL is not configured.');
  const key = snapshotKey(slugValue, versionValue);
  const url = `${base}/${key.split('/').map(encodeURIComponent).join('/')}`;
  const response = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(10_000) });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Unable to read R2 article snapshot (${response.status}).`);
  const value: unknown = await response.json();
  if (!value || typeof value !== 'object') throw new Error('R2 article snapshot is invalid JSON.');
  const snapshot = value as Partial<PublishedArticleSnapshot>;
  if (
    snapshot.schemaVersion !== 1 ||
    snapshot.slug !== slugValue ||
    snapshot.versionId !== versionValue ||
    typeof snapshot.publishedAt !== 'string' ||
    !snapshot.article ||
    typeof snapshot.article !== 'object' ||
    Array.isArray(snapshot.article)
  ) {
    throw new Error('R2 article snapshot failed validation.');
  }
  return snapshot as PublishedArticleSnapshot;
}
