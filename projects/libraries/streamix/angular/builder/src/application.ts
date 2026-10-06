import { createBuilder, type Target } from '@angular-devkit/architect';
import { watch, type FSWatcher } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { generateProject } from './generate-project';
import {
  buildDelegateOptions,
  resolveSourceRoot,
  shouldRegenerateOn,
} from './options';

const REGENERATE_DEBOUNCE_MS = 50;

interface ObservableLike<T> {
  subscribe(observer: {
    next(value: T): void;
    error(error: unknown): void;
    complete(): void;
  }): { unsubscribe(): void };
}

interface BuilderRunLike<T> {
  readonly output: ObservableLike<T>;
  stop(): void;
}

/**
 * Streams the delegate's output while it runs, releasing the scheduled target
 * once it completes or fails.
 */
async function* delegateOutputs<T>(
  run: BuilderRunLike<T>,
): AsyncGenerator<T> {
  const pending: T[] = [];
  let failure: unknown;
  let finished = false;
  let notify: (() => void) | undefined;

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
        yield pending.shift() as T;
      } else if (failure) {
        throw failure;
      } else {
        await new Promise<void>((resolve) => {
          notify = resolve;
        });
      }
    }
  } finally {
    subscription.unsubscribe();
    run.stop();
  }
}

interface RegeneratorContext {
  readonly workspaceRoot: string;
  readonly logger: { warn(message: string): void };
}

/**
 * Re-runs the generator on demand, coalescing requests that arrive while a
 * pass is already running. The generator is called in process: the compiled
 * builder needs no separate generator script or loader registration.
 */
function createRegenerator(
  context: RegeneratorContext,
  sourceRoot: string,
): { trigger(): void; stop(): void } {
  let running = false;
  let queued = false;
  let stopped = false;

  const run = async (): Promise<void> => {
    running = true;

    try {
      await generateProject({
        sourceRoot,
        workspaceRoot: context.workspaceRoot,
      });
    } catch (error) {
      // A mid-edit save can fail compilation; keep the previously generated
      // component serving and retry on the next change.
      context.logger.warn(
        `Streamix regeneration failed; keeping the previous generated component. ${String(error)}`,
      );
    } finally {
      running = false;

      if (queued && !stopped) {
        queued = false;
        void run();
      }
    }
  };

  return {
    trigger() {
      if (stopped) {
        return;
      }

      if (running) {
        queued = true;
        return;
      }

      void run();
    },
    stop() {
      stopped = true;
      queued = false;
    },
  };
}

/**
 * Watches the application source root and reports changes. Recursive watching
 * is preferred so components anywhere below the root trigger regeneration;
 * editors that save via rename would otherwise invalidate a direct file
 * watcher on Windows.
 */
function startSourceWatcher(
  context: RegeneratorContext,
  sourceRoot: string,
  onChange: () => void,
): () => void {
  const watchers: FSWatcher[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  const schedule = (): void => {
    clearTimeout(timer);
    timer = setTimeout(onChange, REGENERATE_DEBOUNCE_MS);
  };

  const track = (watcher: FSWatcher): void => {
    if (stopped) {
      watcher.close();
      return;
    }

    // Watchers emit 'error' asynchronously (the watched directory being
    // renamed or deleted, permission loss); left unhandled it would crash the
    // dev-server process.
    watcher.on('error', (error: Error) => {
      context.logger.warn(
        `Streamix rebuild hook stopped watching ${sourceRoot}: ${error.message}`,
      );
    });

    watchers.push(watcher);
  };

  const handleEvent = (_event: string, filename: string | Buffer | null): void => {
    if (shouldRegenerateOn(filename, '')) {
      schedule();
    }
  };

  const watchEachDirectory = async (rootDirectory: string): Promise<void> => {
    const directories = [rootDirectory];

    while (directories.length > 0) {
      const directory = directories.pop() as string;
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
          `Streamix rebuild hook could not watch ${directory}: ${String(error)}`,
        );
      }
    }
  };

  const rootDirectory = join(context.workspaceRoot, sourceRoot);

  try {
    track(watch(rootDirectory, { recursive: true }, handleEvent));
  } catch {
    // Some platforms cannot watch recursively; fall back to one watch per
    // existing directory. Directories created after startup are not picked up
    // until the builder restarts.
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

/**
 * Angular architect builder that compiles an application's components through
 * the Streamix virtual layer before delegating to the regular Angular
 * application build or dev server.
 */
const applicationBuilder = createBuilder(async function* (options, context) {
  const [project, target] = String(options['delegateTarget'] ?? '').split(':');

  if (!project || !target) {
    throw new Error('delegateTarget must be formatted as "project:target".');
  }

  const sourceRoot = resolveSourceRoot(options);

  await generateProject({
    sourceRoot,
    workspaceRoot: context.workspaceRoot,
  });

  const delegateOptions = buildDelegateOptions(options);

  const delegate: Target = { project, target };

  if (context.target?.configuration !== undefined) {
    delegate.configuration = context.target.configuration;
  }

  // `buildDelegateOptions` returns plain JSON values; architect types its
  // options map with a recursion this module deliberately does not import.
  const run = await context.scheduleTarget(
    delegate,
    delegateOptions as Parameters<typeof context.scheduleTarget>[1],
  );

  // Rebuild hook: re-run the generator when its source inputs change. The
  // delegate (dev-server or watch build) rebuilds on its own once the
  // regenerated virtual component is rewritten.
  const regenerator = createRegenerator(context, sourceRoot);
  const stopWatcher = startSourceWatcher(
    context,
    sourceRoot,
    regenerator.trigger,
  );

  try {
    yield* delegateOutputs(run);
  } finally {
    stopWatcher();
    regenerator.stop();
  }
});

export { applicationBuilder };
export default applicationBuilder;
