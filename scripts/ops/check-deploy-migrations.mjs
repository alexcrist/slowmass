import { readFile, readdir } from 'node:fs/promises';

export function checkMigrationHistory(localNames, response) {
  if (
    !Array.isArray(response) ||
    response.length !== 1 ||
    response[0]?.success !== true ||
    !Array.isArray(response[0].results) ||
    response[0].results.some((row) => typeof row?.name !== 'string')
  ) {
    throw new Error(
      'Invalid production migration history; deployment stopped.',
    );
  }
  const applied = new Set(response[0].results.map((row) => row.name));
  const local = new Set(localNames);
  const pending = localNames.filter((name) => !applied.has(name));
  const unknown = [...applied].filter((name) => !local.has(name));
  if (pending.length || unknown.length) {
    throw new Error(
      `Migration history mismatch; deployment stopped. Pending: ${pending.join(', ') || 'none'}. Unknown: ${unknown.join(', ') || 'none'}. Follow the backup/migration runbook, then rerun the latest main workflow.`,
    );
  }
}

if (import.meta.main) {
  const local = (await readdir('migrations')).filter((name) =>
    name.endsWith('.sql'),
  );
  checkMigrationHistory(
    local,
    JSON.parse(await readFile(process.argv[2], 'utf8')),
  );
  console.log('Production migration history matches this release.');
}
