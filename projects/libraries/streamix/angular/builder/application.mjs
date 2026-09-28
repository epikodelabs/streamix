import { createBuilder } from '@angular-devkit/architect';
import { spawn, spawnSync } from 'node:child_process';
import { watch } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Must stay in sync with the source inputs read by generate-app6.ts.
const GENERATOR_INPUTS = [{ dir: 'projects/apps/app6/src/app', file: 'app.component.ts' }];
const REGENERATE_DEBOUNCE_MS = 50;

const generator = fileURLToPath(new URL('./generate-app6.ts', import.meta.url));

const generatorArgs = () => ['--loader', 'ts-node/esm/transpile-only', generator];

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

function createRegenerator(context) {
  let child;
  let queued = false;

  const run = () => {
    child = spawn(process.execPath, generatorArgs(), {
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

function startSourceWatcher(context, onChange) {
  const watchers = [];
  let timer;
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(onChange, REGENERATE_DEBOUNCE_MS);
  };
  for (const input of GENERATOR_INPUTS) {
    try {
      // Watch the directory and filter by filename: editors saving via
      // rename/replace would invalidate a direct file watcher on Windows.
      watchers.push(
        watch(join(context.workspaceRoot, input.dir), (_event, filename) => {
          if (filename === null || filename === input.file) {
            schedule();
          }
        }),
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

  const generated = spawnSync(process.execPath, generatorArgs(), {
    cwd: context.workspaceRoot,
    stdio: 'inherit',
  });
  if (generated.status !== 0) throw new Error('Streamix App6 compilation failed.');

  // The CLI's schema validation materializes every declared option as a key
  // (unset ones carry `undefined`, array/object ones empty containers), which
  // would clobber the delegate target's own options during architect's
  // shallow merge or trip the delegate's strict schema. Drop empty values
  // before forwarding.
  const delegateOptions = {};
  for (const [key, value] of Object.entries(options)) {
    if (key === 'delegateTarget' || value === undefined || value === null) {
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
  const regenerator = createRegenerator(context);
  const stopWatcher = startSourceWatcher(context, regenerator.trigger);
  try {
    yield* delegateOutputs(run);
  } finally {
    stopWatcher();
    regenerator.stop();
  }
});
