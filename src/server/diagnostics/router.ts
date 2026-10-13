import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { Env } from '../env';
import { recordBrowserDiagnostic } from './index';
export const diagnostics = new Hono<{ Bindings: Env }>();
diagnostics.post(
  '/',
  bodyLimit({
    maxSize: 2048,
    onError: (c) => c.json({ error: 'Diagnostic is too large.' }, 413),
  }),
  async (c) => {
    const valid = await recordBrowserDiagnostic(
      c.env.DB,
      await c.req.json().catch(() => null),
    );
    return valid
      ? c.body(null, 204)
      : c.json({ error: 'Invalid diagnostic.' }, 400);
  },
);
