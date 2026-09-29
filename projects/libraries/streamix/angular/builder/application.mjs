import { createBuilder } from '@angular-devkit/architect';
import { spawn, spawnSync } from 'node:child_process';
import { watch } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildDelegateOptions, resolveSourceRoot, shouldRegenerateOn } from './options.mjs';

const REGENERATE_DEBOUNCE_MS = 50;

const generator = fileURLToPath(new URL('./generate-project.ts', import.meta.url));

// Registration form of the deprecated `--loader ts-node/esm/transpile-only`
// flag: the same hooks, installed through register() so no Experimental
// Warning is emitted and the flag cannot be removed from under us. The
// snippet resolves ts-node relative to the spawn cwd (the workspace root).
const TSNODE_IMPORT =
  'data:text/javascript,' +
  'import { register } from "node:module"; ' +
  'import { pathToFileURL } from "node:url"; ' +
  'register("ts-node/esm/transpile-only", pathToFileURL("./"));';

const generatorArgs = (sourceRoot) => [
  '--import',
  TSNODE_IMPORT,
  generator,
  sourceRoot,
];

async function* delegateOutputs(run) {
  const pending = [];
  let failure;
  let finished = false;
  let notify;
  const subscription = run.output.subscribe({
    next: (output) => {
      pending.push(output);
      notify?.();
    },
    error: (error) => {
      failure = error;
      notify?.();
    },
    complete: () => {
      finished = true;
      notify?.();
    },
  });
  try {
    while (!finished || pending.length > 0) {
      if (pending.length > 0) {
        yield pending.shift();
      } else if (failure) {
        throw failure;
      } else {
        await new Promise((resolve) => {
          notify = resolve;
        });
      }
    }
  } finally {
    subscription.unsubscribe();
    run.stop();
  }
}

function createRegenerator(context, sourceRoot) {
  let child;
  let queued = false;

  const run = () => {
    child = spawn(process.execPath, generatorArgs(sourceRoot), {
      cwd: context.workspaceRoot,
      stdio: 'inherit',
    });
    child.on('exit', (code) => {
      child = undefined;
      if (code !== 0) {
        // A mid-edit save can fail compilation; keep the previously generated
        // component serving and retry on the next change.
        context.logger.warn(
          'Streamix regeneration failed; keeping the previous generated component.',
        );
      }
      if (queued) {
        queued = false;
        run();
      }
    });
  };

  return {
    trigger() {
      if (child) {
        queued = true;
        return;
      }
      run();
    },
    stop() {
      queued = false;
      child?.kill();
    },
  };
}

function startSourceWatcher(context, sourceRoot, onChange) {
  const watchers = [];
  let timer;
  let stopped = false;

  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(onChange, REGENERATE_DEBOUNCE_MS);
  };

  const track = (watcher) => {
    if (stopped) {
      watcher.close();
      return;
    }
    // Watchers emit 'error' asynchronously (the watched directory being
    // renamed or deleted, permission loss); left unhandled it would crash
    // the dev-server process.
    watcher.on('error', (error) => {
      context.logger.warn(
        `Streamix rebuild hook stopped watching ${sourceRoot}: ${error.message}`,
      );
    });
    watchers.push(watcher);
  };

  const handleEvent = (_event, filename) => {
    if (shouldRegenerateOn(filename, '')) {
      schedule();
    }
  };

  const watchEachDirectory = async (rootDirectory) => {
    const directories = [rootDirectory];
    while (directories.length > 0) {
      const directory = directories.pop();
      let entries;
      try {
        entries = await readdir(directory, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (entry.isDirectory()) {
          directories.push(join(directory, entry.name));
        }
      }
      try {
        track(watch(directory, handleEvent));
      } catch (error) {
        context.logger.warn(
          `Streamix rebuild hook could not watch ${directory}: ${error.message}`,
        );
      }
    }
  };

  const rootDirectory = join(context.workspaceRoot, sourceRoot);
  try {
    // Recursive so components anywhere below the source root (src/app/...)
    // trigger regeneration; editors saving via rename/replace would
    // invalidate a direct file watcher on Windows.
    track(watch(rootDirectory, { recursive: true }, handleEvent));
  } catch {
    // Some platforms cannot watch recursively; fall back to one watch per
    // existing directory. Directories created after startup are not picked
    // up until the builder restarts.
    context.logger.warn(
      `Streamix rebuild hook fell back to per-directory watching for ${sourceRoot}.`,
    );
    void watchEachDirectory(rootDirectory);
  }

  return () => {
    stopped = true;
    clearTimeout(timer);
    for (const watcher of watchers) {
      watcher.close();
    }
  };
}

export default createBuilder(async function* (options, context) {
  const [project, target] = options.delegateTarget.split(':');
  if (!project || !target) {
    throw new Error('delegateTarget must be formatted as "project:target".');
  }

  const sourceRoot = resolveSourceRoot(options);

  const generated = spawnSync(process.execPath, generatorArgs(sourceRoot), {
    cwd: context.workspaceRoot,
    stdio: 'inherit',
  });
  if (generated.status !== 0) throw new Error(`Streamix compilation failed for ${sourceRoot}.`);

  const delegateOptions = buildDelegateOptions(options);

  const run = await context.scheduleTarget(
    { project, target, configuration: context.target?.configuration },
    delegateOptions,
  );

  // Rebuild hook: re-run the generator when its source inputs change. The
  // delegate (dev-server or watch build) rebuilds on its own once the
  // regenerated virtual component is rewritten.
  const regenerator = createRegenerator(context, sourceRoot);
  const stopWatcher = startSourceWatcher(context, sourceRoot, regenerator.trigger);
  try {
    yield* delegateOutputs(run);
  } finally {
    stopWatcher();
    regenerator.stop();
  }
});
