import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);
const account = '7f0a8b622397247110cfb9d14f47be7e';
let token = process.env.CLOUDFLARE_API_TOKEN;
if (!token) {
  // Read-only command refreshes Wrangler's OAuth token when necessary. Do not print credential files.
  await run(
    process.execPath,
    [
      resolve('node_modules/wrangler/bin/wrangler.js'),
      'd1',
      'info',
      'slowmass',
      '--env',
      'production',
    ],
    { maxBuffer: 1024 * 1024 },
  );
  const path =
    process.env.SLOWMASS_WRANGLER_AUTH_FILE ??
    join(
      homedir(),
      process.platform === 'darwin'
        ? 'Library/Preferences/.wrangler/config/default.toml'
        : '.config/.wrangler/config/default.toml',
    );
  token = (await readFile(path, 'utf8')).match(
    /oauth_token\s*=\s*"([^"]+)"/,
  )?.[1];
}
if (!token)
  throw new Error(
    'Cloudflare credentials are unavailable. Run wrangler login or provide CLOUDFLARE_API_TOKEN.',
  );
const from = new Date(Date.now() - 86400000).toISOString(),
  to = new Date().toISOString();
const query = `{viewer{accounts(filter:{accountTag:"${account}"}){
 workersInvocationsAdaptive(limit:20,filter:{scriptName:"slowmass",datetime_geq:"${from}",datetime_leq:"${to}"}){sum{requests errors subrequests} quantiles{cpuTimeP50 cpuTimeP99} dimensions{status}}
 d1AnalyticsAdaptiveGroups(limit:1,filter:{databaseId:"94db9800-be5d-43a4-8e31-bcd95f1324cd",datetime_geq:"${from}",datetime_leq:"${to}"}){sum{readQueries writeQueries rowsRead rowsWritten}}
 r2StorageAdaptiveGroups(limit:1,filter:{bucketName:"slowmass-photos",datetime_geq:"${from}",datetime_leq:"${to}"},orderBy:[datetime_DESC]){max{payloadSize objectCount} dimensions{datetime}}
}}}`;
const response = await fetch('https://api.cloudflare.com/client/v4/graphql', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ query }),
});
const result = await response.json();
if (!response.ok || result.errors?.length)
  throw new Error(
    'Cloudflare analytics request failed. Check token permissions and dataset availability.',
  );
console.log(
  JSON.stringify(
    { from, to, analytics: result.data.viewer.accounts[0] },
    null,
    2,
  ),
);
