import { APIError } from 'better-auth/api';

// Consumer Gmail aliases only. Workspace and other domains keep dots/tags.
export function canonicalEmail(email: string): string {
  const normalized = email.trim().toLowerCase();
  const at = normalized.lastIndexOf('@');
  const domain = normalized.slice(at + 1);
  return at > 0 && (domain === 'gmail.com' || domain === 'googlemail.com')
    ? `${normalized.slice(0, at).split('+')[0].replaceAll('.', '')}@gmail.com`
    : normalized;
}

// Keep this expression identical to the migration's indexed expression.
export const emailIdentitySQL = `CASE WHEN lower(substr(trim(email),instr(trim(email),'@')+1)) IN ('gmail.com','googlemail.com') THEN replace(substr(substr(lower(trim(email)),1,instr(trim(email),'@')-1),1,instr(substr(lower(trim(email)),1,instr(trim(email),'@')-1)||'+','+')-1),'.','')||'@gmail.com' ELSE lower(trim(email)) END`;

export async function resolveSignInEmail(db: D1Database, email: string) {
  const canonical = canonicalEmail(email);
  const rows = await db
    .prepare(`SELECT email FROM user WHERE ${emailIdentitySQL}=? LIMIT 2`)
    .bind(canonical)
    .all<{ email: string }>();
  if (rows.results.length > 1)
    throw new APIError('CONFLICT', {
      code: 'EMAIL_IDENTITY_CONFLICT',
      message: 'Please contact support to recover this account.',
    });
  // Preserve stored addresses, IDs, and historical invitation email matches.
  return rows.results[0]?.email ?? canonical;
}
