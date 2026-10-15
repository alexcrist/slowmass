import { readFile, readdir } from 'node:fs/promises';

export function checkMigrationPolicy(localNames, policy) {
  if (!policy || typeof policy !== 'object' || Array.isArray(policy))
    throw new Error('Invalid migration deployment policy.');
  for (const name of localNames) {
    if (!['automatic', 'manual'].includes(policy[name]))
      throw new Error(
        `Migration ${name} needs an automatic or manual deployment policy.`,
      );
  }
  for (const name of Object.keys(policy)) {
    if (!localNames.includes(name))
      throw new Error(`Migration policy references missing file: ${name}`);
  }
}

export function checkMigrationHistory(localNames, response, automaticPolicy) {
  if (automaticPolicy !== undefined)
    checkMigrationPolicy(localNames, automaticPolicy);
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
  if (unknown.length) {
    throw new Error(
      `Migration history mismatch; deployment stopped. Unknown: ${unknown.join(', ')}.`,
    );
  }
  if (automaticPolicy !== undefined) {
    const manual = pending.filter(
      (name) => automaticPolicy[name] !== 'automatic',
    );
    if (manual.length)
      throw new Error(
        `Manual migrations pending: ${manual.join(', ')}. Follow the backup/maintenance runbook before deploying.`,
      );
  } else if (pending.length) {
    throw new Error(
      `Migration history mismatch; deployment stopped. Pending: ${pending.join(', ') || 'none'}. Unknown: ${unknown.join(', ') || 'none'}. Follow the backup/migration runbook, then rerun the latest main workflow.`,
    );
  }
  return pending;
}

if (import.meta.main) {
  const local = (await readdir('migrations')).filter((name) =>
    name.endsWith('.sql'),
  );
  const mode = process.argv[3];
  if (mode !== undefined && mode !== '--allow-automatic')
    throw new Error('Unknown migration check mode.');
  const policy = JSON.parse(
    await readFile('migrations/deployment-policy.json', 'utf8'),
  );
  checkMigrationPolicy(local, policy);
  const pending = checkMigrationHistory(
    local,
    JSON.parse(await readFile(process.argv[2], 'utf8')),
    mode === '--allow-automatic' ? policy : undefined,
  );
  console.log(
    pending.length
      ? `Automatic migrations ready: ${pending.join(', ')}`
      : 'Production migration history matches this release.',
  );
}
