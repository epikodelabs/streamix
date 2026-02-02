import fs from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';

const repoRoot = path.resolve(process.cwd());
const streamixRoot = path.join(repoRoot, 'projects', 'libraries', 'streamix');

const EXCLUDE_DIRS = new Set(['node_modules', 'dist', 'coverage']);
const EXCLUDE_FILE_RE = /(?:\.spec\.ts$|\.test\.ts$|\.d\.ts$)/i;

async function* walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (EXCLUDE_DIRS.has(entry.name)) continue;
      yield* walk(path.join(dir, entry.name));
      continue;
    }

    if (!entry.isFile()) continue;
    const filePath = path.join(dir, entry.name);
    if (!filePath.endsWith('.ts')) continue;
    if (EXCLUDE_FILE_RE.test(filePath)) continue;
    yield filePath;
  }
}

function toPosix(p) {
  return p.split(path.sep).join('/');
}

function rel(p) {
  return toPosix(path.relative(repoRoot, p));
}

function hasExportModifier(node) {
  return !!node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
}

function nodeName(node) {
  if ('name' in node && node.name && ts.isIdentifier(node.name)) return node.name.text;
  return '(anonymous)';
}

function leadingJsdocExists(sourceFile, node) {
  // Prefer the AST's JSDoc attachment when available.
  // (This is more reliable than manually scanning text, especially with
  // overload signatures and varying trivia.)
  const anyNode = /** @type {any} */ (node);
  if (Array.isArray(anyNode.jsDoc) && anyNode.jsDoc.length > 0) return true;

  // Fallback: scan raw leading comments.
  const text = sourceFile.getFullText();
  const start = node.getStart(sourceFile, false);
  const ranges = ts.getLeadingCommentRanges(text, start) ?? [];
  for (const r of ranges) {
    const comment = text.slice(r.pos, r.end);
    if (comment.startsWith('/**')) return true;
  }
  return false;
}

function getLine(sourceFile, node) {
  const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile, false));
  return line + 1;
}

function collectTopLevelDeclsByName(sourceFile) {
  /** @type {Map<string, ts.Node[]>} */
  const map = new Map();

  for (const st of sourceFile.statements) {
    if (ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st) || ts.isInterfaceDeclaration(st) || ts.isTypeAliasDeclaration(st) || ts.isEnumDeclaration(st) || ts.isModuleDeclaration(st)) {
      const nm = nodeName(st);
      if (nm && nm !== '(anonymous)') {
        const list = map.get(nm) ?? [];
        list.push(st);
        map.set(nm, list);
      }
    } else if (ts.isVariableStatement(st)) {
      for (const decl of st.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) {
          const nm = decl.name.text;
          const list = map.get(nm) ?? [];
          // store the VariableStatement (docs are typically on statement) and the declarator as fallback
          list.push(st);
          list.push(decl);
          map.set(nm, list);
        }
      }
    }
  }

  return map;
}

function exportedDeclsInFile(sourceFile) {
  /** @type {{node: ts.Node, displayName: string, kind: string}[]} */
  const results = [];
  const declsByName = collectTopLevelDeclsByName(sourceFile);

  for (const st of sourceFile.statements) {
    // Direct `export` declarations
    if (hasExportModifier(st)) {
      if (ts.isFunctionDeclaration(st)) results.push({ node: st, displayName: nodeName(st), kind: 'function' });
      else if (ts.isClassDeclaration(st)) results.push({ node: st, displayName: nodeName(st), kind: 'class' });
      else if (ts.isInterfaceDeclaration(st)) results.push({ node: st, displayName: nodeName(st), kind: 'interface' });
      else if (ts.isTypeAliasDeclaration(st)) results.push({ node: st, displayName: nodeName(st), kind: 'type' });
      else if (ts.isEnumDeclaration(st)) results.push({ node: st, displayName: nodeName(st), kind: 'enum' });
      else if (ts.isModuleDeclaration(st)) results.push({ node: st, displayName: nodeName(st), kind: 'namespace' });
      else if (ts.isVariableStatement(st)) {
        for (const decl of st.declarationList.declarations) {
          const nm = ts.isIdentifier(decl.name) ? decl.name.text : '(pattern)';
          results.push({ node: st, displayName: nm, kind: 'variable' });
        }
      }
      continue;
    }

    // `export { foo, bar as baz }` (locals only)
    if (ts.isExportDeclaration(st) && !st.moduleSpecifier && st.exportClause && ts.isNamedExports(st.exportClause)) {
      for (const el of st.exportClause.elements) {
        const localName = el.propertyName?.text ?? el.name.text;
        const exportedAs = el.name.text;
        const candidates = declsByName.get(localName) ?? [];
        if (candidates.length > 0) {
          // Prefer non-VariableDeclaration node if present; otherwise use first
          const preferred = candidates.find((n) => !ts.isVariableDeclaration(n)) ?? candidates[0];
          results.push({ node: preferred, displayName: exportedAs === localName ? localName : `${localName} (as ${exportedAs})`, kind: 're-export(local)' });
        } else {
          results.push({ node: st, displayName: `${localName} (as ${exportedAs})`, kind: 're-export(local-unresolved)' });
        }
      }
    }
  }

  return results;
}

function isProbablyBarrelFile(filePath) {
  const base = path.basename(filePath);
  if (base !== 'index.ts' && base !== 'public-api.ts') return false;
  return true;
}

async function main() {
  const files = [];
  for await (const f of walk(streamixRoot)) files.push(f);

  /** @type {{file: string, line: number, kind: string, name: string}[]} */
  const missing = [];
  /** @type {{file: string, line: number, kind: string, name: string}[]} */
  const exportsFound = [];

  for (const filePath of files) {
    const text = await fs.readFile(filePath, 'utf8');
    const sourceFile = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

    const exported = exportedDeclsInFile(sourceFile);
    if (exported.length === 0) continue;

    for (const e of exported) {
      // For variable statements, check docs on the statement node.
      const docNode = ts.isVariableDeclaration(e.node) ? e.node.parent?.parent ?? e.node : e.node;
      const has = leadingJsdocExists(sourceFile, docNode);
      const line = getLine(sourceFile, docNode);

      exportsFound.push({ file: rel(filePath), line, kind: e.kind, name: e.displayName });

      // Ignore barrels (export-only files) from doc requirement: they typically contain no declarations.
      if (!has) {
        // If it's a barrel/index file and the export is likely re-export-only, we still report only if it's an actual declaration.
        const barrel = isProbablyBarrelFile(filePath);
        const isDeclaration =
          ts.isFunctionDeclaration(docNode) ||
          ts.isClassDeclaration(docNode) ||
          ts.isInterfaceDeclaration(docNode) ||
          ts.isTypeAliasDeclaration(docNode) ||
          ts.isEnumDeclaration(docNode) ||
          ts.isModuleDeclaration(docNode) ||
          ts.isVariableStatement(docNode) ||
          ts.isVariableDeclaration(docNode);

        if (!barrel || isDeclaration) {
          missing.push({ file: rel(filePath), line, kind: e.kind, name: e.displayName });
        }
      }
    }
  }

  // De-dupe missing entries
  const seen = new Set();
  const uniqueMissing = missing.filter((m) => {
    const key = `${m.file}:${m.line}:${m.kind}:${m.name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  uniqueMissing.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file.localeCompare(b.file)));

  const summary = {
    scannedFiles: files.length,
    exportsFound: exportsFound.length,
    missingJsdoc: uniqueMissing.length,
  };

  console.log(JSON.stringify({ summary, missing: uniqueMissing }, null, 2));
  if (uniqueMissing.length > 0) process.exitCode = 2;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
