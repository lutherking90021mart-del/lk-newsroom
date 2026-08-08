import {createECDH} from 'node:crypto';

const keyPair=createECDH('prime256v1');
keyPair.generateKeys();
console.log(`VAPID_PUBLIC_KEY=${keyPair.getPublicKey().toString('base64url')}`);
console.log(`VAPID_PRIVATE_KEY=${keyPair.getPrivateKey().toString('base64url')}`);
