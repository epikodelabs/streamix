#!/usr/bin/env node
/**
 * Runs the Angular renderer benchmarks once, headlessly, and prints the table.
 *
 * The benchmark cases are browser code — their subject is the DOM — so a real
 * browser is the only place they can run. This runner starts Vite to transform
 * and serve the modules, drives the installed Chrome (or Edge) in headless
 * mode, and reads the results out of the page. Chrome's `--dump-dom` dumps the
 * DOM after the load event, and the suite finishes synchronously before it
 * (`runBenchmark` never awaits), so the dump carries the complete result.
 *
 * Use `npm run bench:angular:serve` for the interactive page instead.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const BENCHMARKS_ROOT = fileURLToPath(
  new URL(
    '../projects/libraries/streamix/angular/benchmarks/',
    import.meta.url,
  ),
);
const BROWSER_TIMEOUT_MS = 180_000;
const WORKLOAD_PARAMS = new Set([
  'samples',
  'warmup',
  'scalar',
  'coalesced',
  'rows',
  'reorders',
]);

/** Turns `--samples=25` / `--samples 25` into the page's query string. */
function workloadQuery(argv) {
  const params = new URLSearchParams();

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (!argument.startsWith('--')) {
      throw new Error(`Unexpected argument "${argument}".`);
    }

    const [name, inlineValue] = argument.slice(2).split('=');

    if (!WORKLOAD_PARAMS.has(name)) {
      throw new Error(
        `Unknown option "--${name}". Valid: ` +
          `${[...WORKLOAD_PARAMS].map(param => `--${param}`).join(', ')}.`,
      );
    }

    const value = inlineValue ?? argv[(index += 1)];

    if (value === undefined || !/^\d+$/.test(value)) {
      throw new Error(`"--${name}" needs a whole number.`);
    }

    params.set(name, value);
  }

  const query = params.toString();

  return query ? `?${query}` : '';
}

function resolveBrowser() {
  const fromEnvironment =
    process.env['CHROME_PATH'] ?? process.env['CHROME_BIN'];

  if (fromEnvironment && existsSync(fromEnvironment)) {
    return fromEnvironment;
  }

  const programFiles =
    process.env['PROGRAMFILES'] ?? 'C:\\Program Files';
  const programFilesX86 =
    process.env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)';
  const localAppData = process.env['LOCALAPPDATA'] ?? '';

  const candidates =
    process.platform === 'win32'
      ? [
          join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
          join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
          join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe'),
          join(programFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
          join(programFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        ]
      : process.platform === 'darwin'
        ? [
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            '/Applications/Chromium.app/Contents/MacOS/Chromium',
            '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
          ]
        : [
            '/usr/bin/google-chrome',
            '/usr/bin/google-chrome-stable',
            '/usr/bin/chromium',
            '/usr/bin/chromium-browser',
            '/snap/bin/chromium',
          ];

  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) {
      return candidate;
    }
  }

  for (const name of [
    'google-chrome',
    'google-chrome-stable',
    'chromium',
    'chromium-browser',
    'chrome',
  ]) {
    if (!spawnSync(name, ['--version'], { stdio: 'ignore' }).error) {
      return name;
    }
  }

  throw new Error(
    'No Chrome/Chromium found. Point CHROME_PATH at the browser executable.',
  );
}

function runBrowser(browserPath, url) {
  return new Promise((resolve, reject) => {
    const profile = mkdtempSync(join(tmpdir(), 'sx-benchmarks-'));
    const child = spawn(
      browserPath,
      [
        '--headless=new',
        '--disable-gpu',
        '--no-first-run',
        '--no-default-browser-check',
        `--user-data-dir=${profile}`,
        '--dump-dom',
        url,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', chunk => (stdout += chunk));
    child.stderr.on('data', chunk => (stderr += chunk));

    const timer = setTimeout(() => {
      child.kill();
      reject(
        new Error(
          `The browser did not finish within ${BROWSER_TIMEOUT_MS} ms.`,
        ),
      );
    }, BROWSER_TIMEOUT_MS);

    child.on('error', error => {
      clearTimeout(timer);
      reject(error);
    });

    child.on('close', code => {
      clearTimeout(timer);

      try {
        // Windows may hold the profile open for a moment after exit.
        rmSync(profile, { recursive: true, force: true });
      } catch {
        /* leave the temp profile behind */
      }

      if (code !== 0) {
        reject(
          new Error(
            `The browser exited with code ${code}.\n${stderr.slice(-2000)}`,
          ),
        );
        return;
      }

      resolve(stdout);
    });
  });
}

function parseResults(dom) {
  const match = /<pre id="results">([\s\S]*?)<\/pre>/.exec(dom);

  if (!match) {
    return undefined;
  }

  try {
    return JSON.parse(match[1]);
  } catch {
    return undefined;
  }
}

function printTable(run) {
  console.log(`Browser: ${run.userAgent}`);
  console.log(`Run at:  ${run.generatedAt}\n`);

  console.table(
    run.results.map(result => ({
      case: result.name,
      iterations: result.iterations,
      medianMs: Number(result.medianMs.toFixed(3)),
      opsPerSecond: Math.round(result.opsPerSecond),
    })),
  );
}

async function main() {
  const query = workloadQuery(process.argv.slice(2));
  const browserPath = resolveBrowser();
  const server = await createServer({
    root: BENCHMARKS_ROOT,
    logLevel: 'warn',
  });

  await server.listen();

  try {
    const address = server.httpServer?.address();
    const port =
      typeof address === 'object' && address ? address.port : undefined;

    if (!port) {
      throw new Error('Vite did not report a port.');
    }

    console.log(`Driving ${browserPath}`);
    console.log(`Serving ${BENCHMARKS_ROOT}`);
    console.log(`Workload ${query || '(defaults)'}\n`);

    const dom = await runBrowser(browserPath, `http://localhost:${port}/${query}`);
    const run = parseResults(dom);

    if (!run) {
      throw new Error(
        'The page did not contain benchmark results. If a case became ' +
          'asynchronous it would finish after the load event, which ' +
          "Chrome's --dump-dom no longer captures.",
      );
    }

    printTable(run);
  } finally {
    await server.close();
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
