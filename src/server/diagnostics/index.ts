const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const diagnosticId = (value: unknown): value is string =>
  typeof value === 'string' && uuid.test(value);
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const integer = (value: unknown, max: number): value is number =>
  Number.isInteger(value) &&
  typeof value === 'number' &&
  value >= 0 &&
  value <= max;

export async function retainDiagnostic(
  db: D1Database,
  id: string,
  source: 'browser' | 'server',
  detail: object,
) {
  try {
    await db
      .prepare(
        `INSERT INTO startup_diagnostic(id, created_at, source, detail)
      SELECT ?, ?, ?, ? WHERE (SELECT count(*) FROM startup_diagnostic) < 200
      ON CONFLICT(id) DO NOTHING`,
      )
      .bind(id, Date.now(), source, JSON.stringify(detail))
      .run();
  } catch {
    // Diagnostics must never make startup fail, including before migration rollout.
    console.warn(JSON.stringify({ event: 'startup.diagnostic_unavailable' }));
  }
}

export async function recordBrowserDiagnostic(
  db: D1Database,
  body: unknown,
): Promise<boolean> {
  if (
    !object(body) ||
    Object.keys(body).sort().join() !== 'failures,recovered,startupId' ||
    !diagnosticId(body.startupId) ||
    typeof body.recovered !== 'boolean' ||
    !Array.isArray(body.failures) ||
    body.failures.length < 1 ||
    body.failures.length > 2
  )
    return false;
  const failures = [];
  for (const [index, item] of body.failures.entries()) {
    if (
      !object(item) ||
      Object.keys(item).sort().join() !==
        'attempt,durationMs,outcome,requestId,status' ||
      item.attempt !== index + 1 ||
      !integer(item.durationMs, 20_000) ||
      typeof item.outcome !== 'string' ||
      !['network', 'http', 'timeout', 'invalid_response'].includes(
        item.outcome,
      ) ||
      (item.status !== null &&
        (!integer(item.status, 599) || item.status < 100)) ||
      (item.requestId !== null && !diagnosticId(item.requestId))
    )
      return false;
    failures.push({
      attempt: item.attempt,
      outcome: item.outcome,
      durationMs: item.durationMs,
      status: item.status,
      requestId: item.requestId,
    });
  }
  await retainDiagnostic(db, `browser:${body.startupId}`, 'browser', {
    startupId: body.startupId,
    recovered: body.recovered,
    failures,
  });
  return true;
}

export async function cleanupDiagnostics(db: D1Database) {
  await db
    .prepare('DELETE FROM startup_diagnostic WHERE created_at <= ?')
    .bind(Date.now() - 86_400_000)
    .run();
}
