import { generateRandomString } from 'better-auth/crypto';

// Event link credentials: 48 random characters, stored only as this hash.

export async function invitationTokenHash(token: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(token),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

export async function newInvitationCredential() {
  const token = generateRandomString(48, 'a-z', 'A-Z', '0-9');
  return { token, hash: await invitationTokenHash(token) };
}
