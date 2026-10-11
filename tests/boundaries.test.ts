import { expect, it } from 'vitest';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';

async function filesUnder(dir: string): Promise<string[]> {
  const entries = await readdir(dir);
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const file = path.join(dir, entry);
      return (await stat(file)).isDirectory() ? filesUnder(file) : [file];
    }),
  );
  return nested
    .flat()
    .filter((file) => /\.tsx?$/.test(file) && !file.endsWith('.test.ts'));
}
function group(file: string) {
  const parts = file.split(path.sep);
  return parts[2] === 'features'
    ? parts.slice(0, 4).join('/')
    : parts.slice(0, 3).join('/');
}
it('keeps client/server boundaries and module dependencies acyclic', async () => {
  const edges = new Map<string, Set<string>>();
  const violations: string[] = [];
  for (const file of await filesUnder('src')) {
    const source = ts.createSourceFile(
      file,
      await readFile(file, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    );
    const from = group(file);
    for (const statement of source.statements) {
      if (
        !ts.isImportDeclaration(statement) ||
        !ts.isStringLiteral(statement.moduleSpecifier)
      )
        continue;
      const target = statement.moduleSpecifier.text;
      if (!target.startsWith('.')) continue;
      const resolved = path.normalize(path.join(path.dirname(file), target));
      const to = group(resolved);
      if (file.startsWith('src/client/') && resolved.startsWith('src/server/'))
        violations.push(`${file} imports server code`);
      if (file.startsWith('src/server/') && resolved.startsWith('src/client/'))
        violations.push(`${file} imports client code`);
      if (file.startsWith('src/shared/') && !resolved.startsWith('src/shared/'))
        violations.push(`${file} imports application code`);
      const sharedServerModule =
        file.startsWith('src/server/') &&
        !file.startsWith('src/server/features/') &&
        file.split(path.sep).length > 3;
      if (sharedServerModule && resolved.includes('/features/'))
        violations.push(`${file} imports a feature`);
      if (from !== to) {
        const targets = edges.get(from) ?? new Set<string>();
        targets.add(to);
        edges.set(from, targets);
      }
    }
  }
  function visit(node: string, trail: string[]) {
    if (trail.includes(node)) {
      violations.push(`Dependency cycle: ${[...trail, node].join(' -> ')}`);
      return;
    }
    for (const target of edges.get(node) ?? []) visit(target, [...trail, node]);
  }
  for (const node of edges.keys()) visit(node, []);
  expect(violations).toEqual([]);
});
