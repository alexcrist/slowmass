import { betterAuth } from 'better-auth';
import type { Env } from '../env';
import { authOptions } from './options';
import { activeMember } from '../membership';

const instances = new WeakMap<Env, ReturnType<typeof betterAuth>>();
export function createAuth(env: Env) {
  let auth = instances.get(env);
  if (!auth) {
    auth = betterAuth(authOptions(env));
    instances.set(env, auth);
  }
  return auth;
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
