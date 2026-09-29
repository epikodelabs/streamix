import { createBuilder } from '@angular-devkit/architect';
import { spawn, spawnSync } from 'node:child_process';
import { watch } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Default keeps the in-repo app6 demo building; consuming workspaces pass
// their own `sourceRoot` builder option.
const DEFAULT_SOURCE_ROOT = 'projects/apps/app6/src';
const REGENERATE_DEBOUNCE_MS = 50;

const generator = fileURLToPath(new URL('./generate-project.ts', import.meta.url));

const generatorArgs = (sourceRoot) => [
  '--loader',
  'ts-node/esm/transpile-only',
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
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(onChange, REGENERATE_DEBOUNCE_MS);
  };
  const inputs = [{ dir: sourceRoot, file: '' }];
  for (const input of inputs) {
    try {
      // Watch the directory recursively rather than individual files:
      // editors saving via rename/replace would invalidate a direct file
      // watcher on Windows, and components typically live in subdirectories
      // a plain directory watch would never report. An empty `file` accepts
      // every entry: fs.watch reports the changed entry's (possibly
      // relative) name on Windows/macOS/Linux, and `null` only on platforms
      // that do not provide one.
      watchers.push(
        watch(
          join(context.workspaceRoot, input.dir),
          { recursive: true },
          (_event, filename) => {
            if (filename === null || !input.file || filename === input.file) {
              schedule();
            }
          },
        ),
      );
    } catch (error) {
      context.logger.warn(
        `Streamix rebuild hook could not watch ${input.dir}: ${error.message}`,
      );
    }
  }
  return () => {
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

  const sourceRoot = options.sourceRoot || DEFAULT_SOURCE_ROOT;

  const generated = spawnSync(process.execPath, generatorArgs(sourceRoot), {
    cwd: context.workspaceRoot,
    stdio: 'inherit',
  });
  if (generated.status !== 0) throw new Error(`Streamix compilation failed for ${sourceRoot}.`);

  // The CLI's schema validation materializes every declared option as a key
  // (unset ones carry `undefined`, array/object ones empty containers), which
  // would clobber the delegate target's own options during architect's
  // shallow merge or trip the delegate's strict schema. Drop empty values and
  // this builder's own keys before forwarding.
  const delegateOptions = {};
  for (const [key, value] of Object.entries(options)) {
    if (key === 'delegateTarget' || key === 'sourceRoot' || value === undefined || value === null) {
      continue;
    }
    if (Array.isArray(value) ? value.length === 0 : typeof value === 'object' && Object.keys(value).length === 0) {
      continue;
    }
    delegateOptions[key] = value;
  }

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
