import path from 'node:path';
import ts from 'typescript';

const feature = (file: string) =>
  file.match(/^src\/(?:client|server)\/features\/[^/]+/)?.[0];
const group = (file: string) =>
  feature(file) ?? file.split('/').slice(0, 3).join('/');
const serverRoot = 'src/server/index.ts';

export function checkBoundaries(
  sources: Map<string, string>,
  options: ts.CompilerOptions,
) {
  const violations: string[] = [];
  const edges = new Map<string, Set<string>>();
  const relative = (file: string) =>
    path.relative(process.cwd(), file).split(path.sep).join('/');
  const host: ts.ModuleResolutionHost = {
    fileExists: (file) =>
      sources.has(relative(file)) || ts.sys.fileExists(file),
    readFile: (file) => sources.get(relative(file)) ?? ts.sys.readFile(file),
    directoryExists: (dir) =>
      [...sources.keys()].some((file) =>
        file.startsWith(relative(dir) + '/'),
      ) || ts.sys.directoryExists(dir),
    getCurrentDirectory: () => process.cwd(),
  };
  for (const [file, text] of sources) {
    const source = ts.createSourceFile(
      file,
      text,
      ts.ScriptTarget.Latest,
      true,
    );
    const specifiers: string[] = [];
    const add = (node: ts.Node) => {
      if (ts.isStringLiteralLike(node)) specifiers.push(node.text);
      else violations.push(`${file}: computed module loading is not allowed`);
    };
    function walk(node: ts.Node) {
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
        if (node.moduleSpecifier) add(node.moduleSpecifier);
      } else if (
        ts.isImportEqualsDeclaration(node) &&
        ts.isExternalModuleReference(node.moduleReference)
      ) {
        if (node.moduleReference.expression)
          add(node.moduleReference.expression);
      } else if (
        ts.isImportTypeNode(node) &&
        ts.isLiteralTypeNode(node.argument)
      ) {
        add(node.argument.literal);
      } else if (ts.isCallExpression(node)) {
        if (
          node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) &&
            node.expression.text === 'require')
        ) {
          if (node.arguments[0]) add(node.arguments[0]);
        }
        if (
          (file === serverRoot ||
            /src\/server\/features\/[^/]+\/router\.ts$/.test(file)) &&
          ts.isPropertyAccessExpression(node.expression) &&
          ['prepare', 'batch', 'exec'].includes(node.expression.name.text)
        ) {
          violations.push(`${file}: persistence belongs in a domain module`);
        }
      }
      ts.forEachChild(node, walk);
    }
    walk(source);
    for (const specifier of specifiers) {
      if (specifier.startsWith('node:')) continue;
      const resolved = ts.resolveModuleName(
        specifier,
        path.resolve(file),
        options,
        host,
      ).resolvedModule;
      if (!resolved) {
        if (
          specifier.endsWith('.css') &&
          host.fileExists(path.resolve(path.dirname(file), specifier))
        )
          continue;
        violations.push(`${file}: unresolved module ${specifier}`);
        continue;
      }
      if (resolved.isExternalLibraryImport) continue;
      const target = relative(resolved.resolvedFileName);
      if (!target.startsWith('src/')) continue;
      if (
        (file.startsWith('src/client/') && target.startsWith('src/server/')) ||
        (file.startsWith('src/server/') && target.startsWith('src/client/'))
      )
        violations.push(`${file}: client/server boundary violation: ${target}`);
      if (file.startsWith('src/shared/') && !target.startsWith('src/shared/'))
        violations.push(`${file}: shared code imports application code`);
      if (
        file.startsWith('src/server/') &&
        !feature(file) &&
        file !== serverRoot &&
        feature(target)
      )
        violations.push(`${file}: shared infrastructure imports a feature`);
      if (feature(target) && feature(file) !== feature(target)) {
        const entry = `${feature(target)}/index.ts`;
        const rootRouter =
          file === serverRoot && target === `${feature(target)}/router.ts`;
        if (target !== entry && !rootRouter)
          violations.push(
            `${file}: use the public feature entry point for ${target}`,
          );
      }
      if (
        file.startsWith('src/server/features/') &&
        file.endsWith('/index.ts') &&
        target.endsWith('/router.ts')
      )
        violations.push(`${file}: domain entry point imports an HTTP router`);
      const from = group(file),
        to = group(target);
      if (from !== to) {
        const targets = edges.get(from) ?? new Set<string>();
        targets.add(to);
        edges.set(from, targets);
      }
    }
  }
  const visited = new Set<string>();
  function visit(node: string, trail: string[]) {
    if (trail.includes(node)) {
      violations.push(`Dependency cycle: ${[...trail, node].join(' -> ')}`);
      return;
    }
    if (visited.has(node)) return;
    for (const target of edges.get(node) ?? []) visit(target, [...trail, node]);
    visited.add(node);
  }
  for (const node of edges.keys()) visit(node, []);
  return violations;
}
