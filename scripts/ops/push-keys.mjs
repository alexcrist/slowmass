import { createECDH } from 'node:crypto';
import { writeFile } from 'node:fs/promises';

const destination = process.argv[2];
if (!destination)
  throw new Error('Usage: node scripts/ops/push-keys.mjs <new-private-file>');
const key = createECDH('prime256v1');
key.generateKeys();
await writeFile(
  destination,
  JSON.stringify({
    PUSH_PUBLIC_KEY: key.getPublicKey().toString('base64url'),
    PUSH_PRIVATE_KEY: key.getPrivateKey().toString('base64url'),
  }) + '\n',
  { mode: 0o600, flag: 'wx' },
);
console.log(
  'Created private VAPID key file. Keep it outside source control and reuse it across deployments.',
);
