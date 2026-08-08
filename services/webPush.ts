import {createCipheriv,createECDH,createPrivateKey,randomBytes,sign, hkdfSync} from 'node:crypto';

type PushKeys={p256dh?:string;auth?:string;};
export type PushSubscriptionPayload={endpoint?:string;keys?:PushKeys;};

const asBase64Url=(value:Buffer|Uint8Array|string)=>Buffer.from(value).toString('base64url');
const fromBase64Url=(value:string)=>Buffer.from(value.replace(/-/g,'+').replace(/_/g,'/'),'base64');
const json=(value:unknown)=>asBase64Url(JSON.stringify(value));

function config(){
  const subject=String(process.env.VAPID_SUBJECT||'').trim();
  const publicKey=String(process.env.VAPID_PUBLIC_KEY||'').trim();
  const privateKey=String(process.env.VAPID_PRIVATE_KEY||'').trim();
  if(!subject||!publicKey||!privateKey)throw new Error('Web Push is not configured. Add VAPID_SUBJECT, VAPID_PUBLIC_KEY, and VAPID_PRIVATE_KEY in Railway.');
  if(!/^mailto:|^https:\/\//i.test(subject))throw new Error('VAPID_SUBJECT must be a mailto: address or HTTPS URL.');
  return {subject,publicKey,privateKey};
}

function hkdf(key:Buffer,salt:Buffer,info:Buffer,length:number){return Buffer.from(hkdfSync('sha256',key,salt,info,length));}

function vapidToken(audience:string,publicKey:string,privateKey:string,subject:string){
  const ecdh=createECDH('prime256v1');ecdh.setPrivateKey(fromBase64Url(privateKey));const rawPublic=ecdh.getPublicKey();
  const jwk={kty:'EC',crv:'P-256',d:asBase64Url(ecdh.getPrivateKey()),x:asBase64Url(rawPublic.subarray(1,33)),y:asBase64Url(rawPublic.subarray(33,65))};
  const header=json({typ:'JWT',alg:'ES256'});const payload=json({aud:audience,exp:Math.floor(Date.now()/1000)+10*60*60,sub:subject});const unsigned=`${header}.${payload}`;
  const signature=sign('sha256',Buffer.from(unsigned),{key:createPrivateKey({key:jwk,format:'jwk'}),dsaEncoding:'ieee-p1363'});
  return {token:`${unsigned}.${asBase64Url(signature)}`,publicKey};
}

/**
 * Send a standards-based RFC 8291 Web Push message without exposing VAPID secrets to
 * the browser. This keeps LK Newsroom deployable without a vendor-specific push gateway.
 */
export async function sendWebPush(subscription:PushSubscriptionPayload,payload:Record<string,unknown>){
  const endpoint=String(subscription.endpoint||'');const keys=subscription.keys||{};
  if(!/^https:\/\//i.test(endpoint)||!keys.p256dh||!keys.auth)throw new Error('This browser push subscription is incomplete. Ask the reader to enable notifications again.');
  const {subject,publicKey,privateKey}=config();const clientPublic=fromBase64Url(keys.p256dh);const auth=fromBase64Url(keys.auth);
  if(clientPublic.length!==65||auth.length<12)throw new Error('This browser push subscription has invalid encryption keys.');
  const local=createECDH('prime256v1');local.generateKeys();const localPublic=local.getPublicKey();const shared=local.computeSecret(clientPublic);
  const info=Buffer.concat([Buffer.from('WebPush: info\0'),clientPublic,localPublic]);const ikm=hkdf(shared,auth,info,32);const salt=randomBytes(16);
  const cek=hkdf(ikm,salt,Buffer.from('Content-Encoding: aes128gcm\0'),16);const nonce=hkdf(ikm,salt,Buffer.from('Content-Encoding: nonce\0'),12);
  // RFC 8291 records end with a non-zero padding delimiter (0x02). Without it,
  // compliant browsers reject an otherwise correctly encrypted notification.
  const cipher=createCipheriv('aes-128-gcm',cek,nonce);const plaintext=Buffer.concat([Buffer.from(JSON.stringify(payload)),Buffer.from([2])]);const encrypted=Buffer.concat([cipher.update(plaintext),cipher.final(),cipher.getAuthTag()]);
  const recordSize=4096;const body=Buffer.concat([salt,Buffer.from([0,0,16,0,localPublic.length]),localPublic,encrypted]);
  const target=new URL(endpoint);const vapid=vapidToken(target.origin,publicKey,privateKey,subject);
  const response=await fetch(endpoint,{method:'POST',headers:{'Content-Encoding':'aes128gcm','Content-Type':'application/octet-stream','Content-Length':String(body.length),'TTL':'86400','Authorization':`vapid t=${vapid.token}, k=${vapid.publicKey}`},body,signal:AbortSignal.timeout(25_000)});
  if(!response.ok){const error=new Error(`Push service returned ${response.status}.`);(error as Error & {status?:number}).status=response.status;throw error;}
}

export function webPushPublicKey(){return String(process.env.VAPID_PUBLIC_KEY||'').trim()||null;}

export function createVapidKeyPair(){const ecdh=createECDH('prime256v1');ecdh.generateKeys();return {publicKey:asBase64Url(ecdh.getPublicKey()),privateKey:asBase64Url(ecdh.getPrivateKey())};}
