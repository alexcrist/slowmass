import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { open, stat, readFile } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
const magic = Buffer.from('SLOWMASS1');
export async function readKey(path) {
  if (process.platform !== 'win32' && (await stat(path)).mode & 0o077)
    throw new Error('Backup key file must be private (chmod 600).');
  const key = await readFile(path);
  if (key.length !== 32)
    throw new Error('Backup key must contain exactly 32 random bytes.');
  return key;
}
export async function encrypt(source, target, key) {
  const iv = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', key, iv);
  const file = await open(target, 'wx', 0o600);
  await file.write(Buffer.concat([magic, iv]));
  await file.close();
  try {
    await pipeline(
      createReadStream(source),
      cipher,
      createWriteStream(target, { flags: 'a', mode: 0o600 }),
    );
    const end = await open(target, 'a');
    await end.write(cipher.getAuthTag());
    await end.close();
  } catch (e) {
    throw new Error(
      'Backup encryption failed; discard the incomplete archive.',
      { cause: e },
    );
  }
}
export async function decrypt(source, target, key) {
  const { size } = await stat(source);
  if (size < 37) throw new Error('Invalid backup.');
  const file = await open(source, 'r'),
    header = Buffer.alloc(21),
    tag = Buffer.alloc(16);
  await file.read(header, 0, 21, 0);
  await file.read(tag, 0, 16, size - 16);
  await file.close();
  if (!header.subarray(0, 9).equals(magic))
    throw new Error('Invalid backup version.');
  const decipher = createDecipheriv('aes-256-gcm', key, header.subarray(9));
  decipher.setAuthTag(tag);
  // The caller must not consume output until authentication completes and must remove failed output.
  await pipeline(
    createReadStream(source, { start: 21, end: size - 17 }),
    decipher,
    createWriteStream(target, { flags: 'wx', mode: 0o600 }),
  );
}
