import { createHash, createHmac } from 'node:crypto';

const accountId = () => String(process.env.R2_ACCOUNT_ID || '').trim();
const accessKeyId = () => String(process.env.R2_ACCESS_KEY_ID || '').trim();
const secretAccessKey = () => String(process.env.R2_SECRET_ACCESS_KEY || '').trim();
const bucketName = () => String(process.env.R2_BUCKET_NAME || '').trim();
const publicBaseUrl = () => String(process.env.R2_PUBLIC_BASE_URL || '').trim().replace(/\/$/, '');
const privateBucketName = () => String(process.env.R2_PRIVATE_BUCKET_NAME || '').trim();
const r2CredentialsPresent = () => Boolean(accountId() && accessKeyId() && secretAccessKey());

export function isR2Configured() {
  return Boolean(r2CredentialsPresent() && bucketName() && publicBaseUrl());
}

export function isR2PrivateConfigured() {
  return Boolean(r2CredentialsPresent() && privateBucketName());
}

export function isR2PublicUrl(value: unknown) {
  const base = publicBaseUrl();
  return Boolean(base && typeof value === 'string' && value.startsWith(`${base}/`));
}

function sha256(value: Buffer | string) {
  return createHash('sha256').update(value).digest('hex');
}
function hmac(key: Buffer | string, value: string) {
  return createHmac('sha256', key).update(value).digest();
}
function encodeSegment(part: string) {
  return encodeURIComponent(part).replace(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}
function encodeKey(key: string) {
  return key.split('/').map(encodeSegment).join('/');
}
function signingKey(date: string) {
  const dateKey = hmac(`AWS4${secretAccessKey()}`, date);
  const regionKey = hmac(dateKey, 'auto');
  const serviceKey = hmac(regionKey, 's3');
  return hmac(serviceKey, 'aws4_request');
}

/** Uploads an object to an explicitly selected R2 bucket using the S3-compatible API. */
async function uploadToBucket(
  targetBucket: string,
  key: string,
  body: Buffer,
  options: { contentType: string; cacheControl?: string }
): Promise<void> {
  if (!r2CredentialsPresent() || !targetBucket) throw new Error('Cloudflare R2 credentials or bucket name are not configured.');
  if (!key || key.startsWith('/') || key.split('/').some(part => part === '..')) throw new Error('Invalid object key.');
  const date = new Date();
  const amzDate = date.toISOString().replace(/[:-]|\\.\\d{3}/g, '');
  const shortDate = amzDate.slice(0, 8);
  const host = `${accountId()}`.concat('.r2.cloudflarestorage.com');
  const canonicalUri = `/${encodeURIComponent(targetBucket)}/${encodeKey(key)}`;
  const payloadHash = sha256(body);
  const headers: Record<string, string> = {
    'content-type': options.contentType,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate
  };
  const signedHeaders = 'content-type;host;x-amz-content-sha256;x-amz-date';
  const canonicalHeaders = `content-type:${headers['content-type']}\\nhost:${host}\\nx-amz-content-sha256:${payloadHash}\\nx-amz-date:${amzDate}\\n`;
  const canonicalRequest = ['PUT', canonicalUri, '', canonicalHeaders, signedHeaders, payloadHash].join('\\n');
  const scope = `${shortDate}/auto/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonicalRequest)].join('\\n');
  const signature = createHmac('sha256', signingKey(shortDate)).update(stringToSign).digest('hex');
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId()}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  if (options.cacheControl) headers['cache-control'] = options.cacheControl;

  const response = await fetch(`https://${host}${canonicalUri}`, {
    method: 'PUT',
    headers,
    body: new Uint8Array(body)
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    throw new Error(`Cloudflare R2 upload failed (${response.status}): ${detail || response.statusText}`);
  }
}

/** Uploads a public media object and returns its public URL. */
export async function uploadPublicObject(
  key: string,
  body: Buffer,
  options: { contentType: string; cacheControl?: string }
): Promise<string> {
  if (!isR2Configured()) throw new Error('Cloudflare R2 public storage is not configured.');
  await uploadToBucket(bucketName(), key, body, options);
  return `${publicBaseUrl()}/${encodeKey(key)}`;
}

/** Uploads a private backup/archive object. It returns only the key, never a public URL. */
export async function uploadPrivateObject(
  key: string,
  body: Buffer,
  options: { contentType: string; cacheControl?: string } = { contentType: 'application/octet-stream' }
): Promise<string> {
  if (!isR2PrivateConfigured()) throw new Error('Private Cloudflare R2 storage is not configured. Set R2_PRIVATE_BUCKET_NAME and R2 credentials.');
  await uploadToBucket(privateBucketName(), key, body, options);
  return key;
}
