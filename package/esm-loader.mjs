// ESM loader for running TS/JS specs with:
// - ts-node/esm (TypeScript at runtime)
// - tsconfig "paths" + "baseUrl" (tsconfig-paths)
//
// Works on Windows by converting absolute `C:\...` specifiers to `file://` URLs.
//
// Usage example:
//   node --loader @epikodelabs/testify/esm-loader.mjs ./node_modules/@epikodelabs/testify/bin/jasmine --spec ./path/to/test.spec.ts
//
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath, pathToFileURL } from 'url';
import { createMatchPath } from 'tsconfig-paths';
import { load as loadTs, resolve as resolveTs } from 'ts-node/esm';

const require = createRequire(import.meta.url);

const WINDOWS_ABS_PATH_RE = /^[A-Za-z]:[\\/]/;

function isFileUrl(url) {
  return typeof url === 'string' && url.startsWith('file:');
}

function isWindowsAbsPath(specifier) {
  return typeof specifier === 'string' && WINDOWS_ABS_PATH_RE.test(specifier);
}

function cleanJsonLike(text) {
  // Removes // and /* */ comments and trailing commas; good enough for typical tsconfig.json.
  // This is intentionally lightweight to avoid extra deps in the published package.
  let out = '';
  let i = 0;
  let inString = false;
  let stringChar = null;
  let escapeNext = false;

  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];

    if (escapeNext) {
      out += ch;
      escapeNext = false;
      i += 1;
      continue;
    }

    if (inString && ch === '\\') {
      out += ch;
      escapeNext = true;
      i += 1;
      continue;
    }

    if ((ch === '"' || ch === "'") && !escapeNext) {
      if (!inString) {
        inString = true;
        stringChar = ch;
      } else if (ch === stringChar) {
        inString = false;
        stringChar = null;
      }
      out += ch;
      i += 1;
      continue;
    }

    if (!inString && ch === '/' && next === '/') {
      i += 2;
      while (i < text.length && text[i] !== '\n' && text[i] !== '\r') i += 1;
      continue;
    }

    if (!inString && ch === '/' && next === '*') {
      i += 2;
      while (i < text.length - 1) {
        if (text[i] === '*' && text[i + 1] === '/') {
          i += 2;
          break;
        }
        i += 1;
      }
      continue;
    }

    out += ch;
    i += 1;
  }

  // Remove trailing commas (outside strings).
  let out2 = '';
  i = 0;
  inString = false;
  stringChar = null;
  escapeNext = false;

  while (i < out.length) {
    const ch = out[i];

    if (escapeNext) {
      out2 += ch;
      escapeNext = false;
      i += 1;
      continue;
    }

    if (inString && ch === '\\') {
      out2 += ch;
      escapeNext = true;
      i += 1;
      continue;
    }

    if ((ch === '"' || ch === "'") && !escapeNext) {
      if (!inString) {
        inString = true;
        stringChar = ch;
      } else if (ch === stringChar) {
        inString = false;
        stringChar = null;
      }
      out2 += ch;
      i += 1;
      continue;
    }

    if (!inString && ch === ',') {
      let j = i + 1;
      while (j < out.length && /\s/.test(out[j])) j += 1;
      if (j < out.length && (out[j] === ']' || out[j] === '}')) {
        i += 1;
        continue;
      }
    }

    out2 += ch;
    i += 1;
  }

  return out2;
}

function readTsconfig(tsconfigPath, visited = new Set()) {
  const resolved = path.resolve(tsconfigPath);
  if (visited.has(resolved)) return {};
  visited.add(resolved);

  if (!fs.existsSync(resolved)) return {};

  const raw = fs.readFileSync(resolved, 'utf8');
  const parsed = JSON.parse(cleanJsonLike(raw));
  const tsconfigDir = path.dirname(resolved);

  let base = {};
  const ext = parsed.extends;
  if (typeof ext === 'string' && ext.length > 0) {
    const tryResolve = (specifier) => {
      // Relative / absolute
      if (
        specifier.startsWith('.') ||
        specifier.startsWith('/') ||
        isWindowsAbsPath(specifier)
      ) {
        const candidate = path.resolve(tsconfigDir, specifier);
        if (fs.existsSync(candidate)) return candidate;
        if (fs.existsSync(candidate + '.json')) return candidate + '.json';
        return null;
      }

      // Package-based (e.g. "@tsconfig/node20/tsconfig.json")
      try {
        return require.resolve(specifier, { paths: [tsconfigDir] });
      } catch {
        try {
          return require.resolve(specifier + '.json', { paths: [tsconfigDir] });
        } catch {
          return null;
        }
      }
    };

    const resolvedExt = tryResolve(ext);
    if (resolvedExt) {
      base = readTsconfig(resolvedExt, visited);
    }
  }

  const merged = {
    ...base,
    ...parsed,
    compilerOptions: {
      ...(base.compilerOptions ?? {}),
      ...(parsed.compilerOptions ?? {}),
      paths: {
        ...((base.compilerOptions ?? {}).paths ?? {}),
        ...((parsed.compilerOptions ?? {}).paths ?? {}),
      },
    },
  };

  // Preserve tsconfig directory (used for baseUrl resolution).
  merged.__tsconfigDir = tsconfigDir;
  return merged;
}

function findUp(startDir, filename) {
  let current = path.resolve(startDir);
  while (true) {
    const candidate = path.join(current, filename);
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function getTsconfigFor(startDir) {
  const envProject = process.env.TS_NODE_PROJECT;
  if (envProject) {
    const fromCwd = path.resolve(process.cwd(), envProject);
    if (fs.existsSync(fromCwd)) return fromCwd;
  }
  return findUp(startDir, 'tsconfig.json') ?? findUp(process.cwd(), 'tsconfig.json');
}

const matchPathCache = new Map();

function getMatchPath(startDir) {
  const tsconfigPath = getTsconfigFor(startDir);
  if (!tsconfigPath) return null;

  const key = tsconfigPath;
  const cached = matchPathCache.get(key);
  if (cached) return cached;

  const tsconfig = readTsconfig(tsconfigPath);
  const compilerOptions = tsconfig.compilerOptions ?? {};
  const tsconfigDir = tsconfig.__tsconfigDir ?? path.dirname(tsconfigPath);

  const baseUrl = compilerOptions.baseUrl
    ? path.resolve(tsconfigDir, compilerOptions.baseUrl)
    : tsconfigDir;
  const pathsMap = compilerOptions.paths ?? {};

  const matchPath = createMatchPath(baseUrl, pathsMap);
  matchPathCache.set(key, matchPath);
  return matchPath;
}

const EXTENSIONS = [
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.json',
];

function tryResolveWithExtensions(absPath) {
  for (const ext of EXTENSIONS) {
    const candidate = absPath.endsWith(ext) ? absPath : absPath + ext;
    if (fs.existsSync(candidate)) return candidate;
  }
  for (const ext of EXTENSIONS) {
    const idx = path.join(absPath, 'index' + ext);
    if (fs.existsSync(idx)) return idx;
  }
  return null;
}

export async function resolve(specifier, context, defaultResolve) {
  // Windows: absolute paths must be file:// URLs for ESM.
  if (isWindowsAbsPath(specifier)) {
    return resolveTs(pathToFileURL(specifier).href, context, defaultResolve);
  }

  const parentUrl = context?.parentURL;
  const startDir =
    isFileUrl(parentUrl) ? path.dirname(fileURLToPath(parentUrl)) : process.cwd();

  // 1) Try tsconfig paths mapping.
  const matchPath = getMatchPath(startDir);
  if (matchPath) {
    const resolved = matchPath(specifier, undefined, undefined, EXTENSIONS);
    if (resolved) {
      return resolveTs(pathToFileURL(resolved).href, context, defaultResolve);
    }
  }

  // 2) Relative specifiers without extension.
  if (
    (specifier.startsWith('./') || specifier.startsWith('../')) &&
    isFileUrl(parentUrl)
  ) {
    const parentFile = fileURLToPath(parentUrl);
    const candidate = path.resolve(path.dirname(parentFile), specifier);
    const withExt = tryResolveWithExtensions(candidate);
    if (withExt) {
      return resolveTs(pathToFileURL(withExt).href, context, defaultResolve);
    }
  }

  // 3) Fallback to ts-node/esm resolver.
  return resolveTs(specifier, context, defaultResolve);
}

export async function load(url, context, defaultLoad) {
  // ts-node's loader returns `format: null` for extensionless files, which breaks running
  // our (extensionless) bin entry under `--loader` on Windows.
  if (typeof url === 'string' && url.startsWith('file:')) {
    const filePath = fileURLToPath(url);
    const base = path.basename(filePath);
    const parent = path.basename(path.dirname(filePath));

    if (
      parent === 'bin' &&
      (base === 'jasmine') &&
      path.extname(filePath) === '' &&
      fs.existsSync(filePath)
    ) {
      const raw = fs.readFileSync(filePath, 'utf8');
      const source = raw.startsWith('#!') ? raw.replace(/^#!.*\r?\n/, '') : raw;
      return { format: 'module', source, shortCircuit: true };
    }
  }

  return loadTs(url, context, defaultLoad);
}
