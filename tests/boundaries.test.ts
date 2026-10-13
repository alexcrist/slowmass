import { expect, it } from 'vitest';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import { checkBoundaries } from './support/boundaries';

const config = ts.readConfigFile('tsconfig.json', ts.sys.readFile);
const { options } = ts.parseJsonConfigFileContent(
  config.config,
  ts.sys,
  process.cwd(),
);
async function filesUnder(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const file = path.join(dir, entry.name);
      return entry.isDirectory() ? filesUnder(file) : [file];
    }),
  );
  return nested
    .flat()
    .filter((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file));
}
it('enforces public entry points, client/server separation, persistence ownership and an acyclic graph', async () => {
  const sources = new Map(
    await Promise.all(
      (await filesUnder('src')).map(
        async (file) => [file, await readFile(file, 'utf8')] as const,
      ),
    ),
  );
  expect(checkBoundaries(sources, options)).toEqual([]);
});

it.each([
  "export { createDraft } from '../../server/features/posts';",
  "const load = () => import('../../server/features/posts');",
  "const server = require('../../server/features/posts');",
  "import server = require('../../server/features/posts');",
  "type Server = typeof import('../../server/features/posts');",
])('checks nonstandard imports: %s', (text) => {
  const sources = new Map([
    ['src/client/ui/probe.ts', text],
    ['src/server/features/posts/index.ts', 'export const createDraft = 1;'],
  ]);
  expect(
    checkBoundaries(sources, options).some((error) =>
      error.includes('client/server'),
    ),
  ).toBe(true);
});
it('resolves configured aliases before checking boundaries', () => {
  const sources = new Map([
    ['src/client/ui/probe.ts', "export * from '@server/features/posts';"],
    ['src/server/features/posts/index.ts', ''],
  ]);
  expect(
    checkBoundaries(sources, {
      ...options,
      paths: { '@server/*': ['./src/server/*'] },
      pathsBasePath: process.cwd(),
    } as ts.CompilerOptions).some((error) => error.includes('client/server')),
  ).toBe(true);
});
it('rejects computed imports, feature internals, router exports and SQL in routers', () => {
  const sources = new Map([
    [
      'src/server/features/people/index.ts',
      "export * from '../posts/thumbnails'; export * from './router'; const lazy = import(name);",
    ],
    ['src/server/features/people/router.ts', "db.prepare('SELECT 1');"],
    ['src/server/features/posts/thumbnails.ts', ''],
  ]);
  const errors = checkBoundaries(sources, options).join('\n');
  expect(errors).toContain('computed module');
  expect(errors).toContain('public feature entry point');
  expect(errors).toContain('domain entry point imports');
  expect(errors).toContain('persistence belongs');
});
it('detects cycles through re-exports and dynamic imports', () => {
  const sources = new Map([
    ['src/server/features/people/index.ts', "export * from '../posts';"],
    [
      'src/server/features/posts/index.ts',
      "const load = () => import('../people');",
    ],
  ]);
  expect(
    checkBoundaries(sources, options).some((error) =>
      error.includes('Dependency cycle'),
    ),
  ).toBe(true);
});
