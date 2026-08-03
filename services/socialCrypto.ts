import crypto from 'node:crypto';

/** Encrypts OAuth tokens before they are stored. Railway environment variables remain the preferred option for manual connections. */
function key(){
  const raw=process.env.SOCIAL_TOKEN_ENCRYPTION_KEY?.trim();
  if(!raw)throw new Error('SOCIAL_TOKEN_ENCRYPTION_KEY is required before OAuth connections can be saved.');
  const value=/^[0-9a-f]{64}$/i.test(raw)?Buffer.from(raw,'hex'):Buffer.from(raw,'base64');
  if(value.length!==32)throw new Error('SOCIAL_TOKEN_ENCRYPTION_KEY must be exactly 32 bytes, encoded as base64 or 64 hexadecimal characters.');
  return value;
}

export function encryptSocialToken(value:string){
  const iv=crypto.randomBytes(12);const cipher=crypto.createCipheriv('aes-256-gcm',key(),iv);
  const encrypted=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);const tag=cipher.getAuthTag();
  return `${iv.toString('base64url')}.${tag.toString('base64url')}.${encrypted.toString('base64url')}`;
}

export function decryptSocialToken(value:string){
  const [ivValue,tagValue,encryptedValue]=String(value||'').split('.');
  if(!ivValue||!tagValue||!encryptedValue)throw new Error('Saved OAuth credentials are invalid. Reconnect this social account.');
  const decipher=crypto.createDecipheriv('aes-256-gcm',key(),Buffer.from(ivValue,'base64url'));
  decipher.setAuthTag(Buffer.from(tagValue,'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(encryptedValue,'base64url')),decipher.final()]).toString('utf8');
}
