import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Env } from '../env';
import {
  createAuth,
  getActiveSession,
  handleAuthRequest,
  AuthUnavailableError,
} from './index';

const mocks = vi.hoisted(() => ({ create: vi.fn(), memberAccess: vi.fn() }));
vi.mock('better-auth', () => ({ betterAuth: mocks.create }));
vi.mock('./options', () => ({
  authOptions: () => ({}),
  authConfigured: () => true,
}));
vi.mock('../membership', () => ({
  memberAccess: mocks.memberAccess,
  EVENT_OVER_AFTER: 43_200_000,
}));
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function library(context: Promise<void> = Promise.resolve()) {
  return {
    $context: context,
    api: {
      getSession: vi.fn(async () => ({
        headers: new Headers(),
        response: {
          user: { id: 'alice', name: 'Alice', emailVerified: true },
          session: { id: 'test-session' },
        },
      })),
    },
    handler: vi.fn(async () => new Response('ok')),
  };
}
beforeEach(() => {
  mocks.create.mockReset();
  mocks.memberAccess.mockReset().mockResolvedValue({ hasProfilePhoto: true });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it('does not share an unfinished initialization with subsequent requests', async () => {
  const env = {} as Env;
  const abandoned = library(new Promise(() => {}));
  const ready = library();
  mocks.create.mockReturnValueOnce(abandoned).mockReturnValue(ready);
  expect(createAuth(env)).toBe(abandoned);
  expect(await getActiveSession(env, new Headers())).toEqual({
    user: { id: 'alice', name: 'Alice' },
    sessionId: 'test-session',
    hasProfilePhoto: true,
  });
  expect(createAuth(env)).toBe(ready);
  expect(mocks.create).toHaveBeenCalledTimes(3);
});

it('does not reuse an initialized instance whose later session work has become stuck', async () => {
  const env = {} as Env;
  const first = library();
  const second = library();
  mocks.create.mockReturnValueOnce(first).mockReturnValueOnce(second);
  expect(await getActiveSession(env, new Headers())).toMatchObject({
    user: { id: 'alice' },
  });
  first.api.getSession.mockImplementation(() => new Promise(() => {}));
  expect(await getActiveSession(env, new Headers())).toMatchObject({
    user: { id: 'alice' },
  });
  expect(first.api.getSession).toHaveBeenCalledTimes(1);
  expect(second.api.getSession).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

it('times out stalled session reads and preserves sign-in on an independent retry', async () => {
  const env = {} as Env;
  const stuck = library();
  stuck.api.getSession.mockImplementation(() => new Promise(() => {}));
  mocks.create.mockReturnValueOnce(stuck).mockReturnValue(library());
  const result = getActiveSession(
    env,
    new Headers({ Cookie: 'private-token' }),
  );
  const rejected = expect(result).rejects.toBeInstanceOf(AuthUnavailableError);
  await vi.advanceTimersByTimeAsync(8000);
  await rejected;
  expect(console.error).toHaveBeenCalledWith(
    JSON.stringify({ event: 'auth.timeout', phase: 'session' }),
  );
  expect(mocks.memberAccess).not.toHaveBeenCalled();
  expect(await getActiveSession(env, new Headers())).toMatchObject({
    user: { id: 'alice' },
  });
  expect(vi.getTimerCount()).toBe(0);
});

it('does not start an auth mutation after its initialization deadline', async () => {
  const initialization = deferred();
  const auth = library(initialization.promise);
  mocks.create.mockReturnValue(auth);
  const result = handleAuthRequest(
    {} as Env,
    new Request('https://slowmass.test/api/auth/sign-out', { method: 'POST' }),
  );
  const rejected = expect(result).rejects.toBeInstanceOf(AuthUnavailableError);
  await vi.advanceTimersByTimeAsync(20_000);
  await rejected;
  initialization.resolve();
  await Promise.resolve();
  expect(auth.handler).not.toHaveBeenCalled();
  expect(console.error).toHaveBeenCalledWith(
    JSON.stringify({ event: 'auth.timeout', phase: 'initialize' }),
  );
});

it('does not replay an auth mutation whose result is uncertain', async () => {
  const auth = library();
  auth.handler.mockImplementation(() => new Promise(() => {}));
  mocks.create.mockReturnValue(auth);
  const result = handleAuthRequest(
    {} as Env,
    new Request('https://slowmass.test/api/auth/sign-out', { method: 'POST' }),
  );
  const rejected = expect(result).rejects.toBeInstanceOf(AuthUnavailableError);
  await vi.advanceTimersByTimeAsync(20_000);
  await rejected;
  expect(auth.handler).toHaveBeenCalledTimes(1);
  expect(console.error).toHaveBeenCalledWith(
    JSON.stringify({ event: 'auth.timeout', phase: 'handler' }),
  );
});

it('returns a private retryable HTTP 503 rather than a signed-out bootstrap for stalled auth', async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
  const { default: worker } = await import('../index');
  const auth = library();
  auth.api.getSession.mockImplementation(() => new Promise(() => {}));
  mocks.create.mockReturnValue(auth);
  const response = worker.fetch(
    new Request('https://slowmass.test/api/bootstrap'),
    { DB: {}, APP_ORIGIN: 'https://slowmass.test' } as Env,
    {} as ExecutionContext,
  );
  await vi.advanceTimersByTimeAsync(8000);
  const result = await response;
  expect(result.status).toBe(503);
  expect(result.headers.get('Cache-Control')).toBe('private, no-store');
  expect(await result.json()).toEqual({
    error: 'Sign-in is temporarily unavailable. Please try again.',
  });
  expect(vi.getTimerCount()).toBe(0);
});

it('redirects rejected Google callbacks to login without exposing API errors', async () => {
  const auth = library();
  auth.handler.mockResolvedValue(
    Response.json({ message: 'Rejected' }, { status: 403 }),
  );
  mocks.create.mockReturnValue(auth);
  const response = await handleAuthRequest(
    {} as Env,
    new Request(
      'https://slowmass.example/api/auth/callback/google?code=synthetic',
    ),
  );
  expect(response.status).toBe(303);
  expect(response.headers.get('location')).toBe('/?auth=google&error=signin');
  expect(await response.text()).toBe('');
});
