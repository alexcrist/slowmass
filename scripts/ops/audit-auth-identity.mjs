import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
if (args.length > 1 || (args.length === 1 && args[0] !== '--remote')) {
  console.error('Usage: npm run auth:audit -- [--remote]');
  process.exit(1);
}
const sql = readFileSync(
  new URL('./audit-auth-identity.sql', import.meta.url),
  'utf8',
);
const result = spawnSync(
  process.execPath,
  [
    'node_modules/wrangler/bin/wrangler.js',
    'd1',
    'execute',
    'slowmass',
    ...(args[0] === '--remote'
      ? ['--env', 'production', '--remote']
      : ['--local']),
    `--command=${sql}`,
    '--json',
  ],
  { encoding: 'utf8' },
);
if (result.status !== 0) {
  console.error(
    'Identity audit failed; check Cloudflare access and database migrations.',
  );
  process.exit(1);
}
const output = JSON.parse(result.stdout);
const email = output[0]?.results?.[0];
const provider = output[1]?.results?.[0];
if (
  typeof email?.email_collision_groups !== 'number' ||
  typeof email?.affected_accounts !== 'number' ||
  typeof provider?.provider_collision_groups !== 'number'
) {
  console.error('Identity audit returned an unexpected result.');
  process.exit(1);
}
console.log(JSON.stringify({ ...email, ...provider }));
if (email.email_collision_groups || provider.provider_collision_groups)
  process.exit(1);
