import { betterAuth } from 'better-auth';
import type { Env } from '../env';
import { authOptions } from './options';
import { activeMember } from '../membership';

export function createAuth(env: Env) {
  return betterAuth(authOptions(env));
}

export async function getActiveUser(env: Env, headers: Headers) {
  const session = await createAuth(env).api.getSession({ headers });
  if (
    !session?.user.emailVerified ||
    !(await activeMember(env.DB, session.user.id))
  )
    return null;
  return { id: session.user.id, name: session.user.name };
}
