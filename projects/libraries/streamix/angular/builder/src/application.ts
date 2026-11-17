import { refreshApplication, watchLibraries } from './watch-libraries';
import { createBuilder, type Target } from '@angular-devkit/architect';
import { watch, type FSWatcher } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

import { generateProject, regenerateAngularFiles } from './generate-project';
import {
  buildDelegateOptions,
  resolveSourceRoot,
  shouldWatchSources,
  virtualRootOf,
  virtualTsconfigOf,
} from './options';

const SOURCE_WATCH_DEBOUNCE_MS = 50;

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
  readonly logger: { warn(message: string): void; error(message: string): void };
}

/**
 * Watches the application source root and reports batched source-root-relative
 * paths (or null when the platform reports no names). Recursive watching is
 * preferred so components anywhere below the root trigger regeneration;
 * editors that save via rename would otherwise invalidate a direct file
 * watcher on Windows, so a thrown recursive watch falls back to one watch per
 * existing directory. Directories created after startup are not picked up
 * until the builder restarts. Events inside the debounce window coalesce, so
 * a burst of saves regenerates each changed file exactly once.
 */
function startSourceWatcher(
  context: RegeneratorContext,
  sourceRoot: string,
  onEvent: (paths: string[] | null) => void,
): () => void {
  const watchers: FSWatcher[] = [];
  const rootDirectory = join(context.workspaceRoot, sourceRoot);
  const pending = new Set<string>();
  let unknown = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  const schedule = (): void => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const paths = unknown ? null : [...pending];
      pending.clear();
      unknown = false;
      if (!stopped) onEvent(paths !== null && paths.length > 0 ? paths : null);
    }, SOURCE_WATCH_DEBOUNCE_MS);
  };

  const handleEvent = (watchDirectory: string, filename: string | Buffer | null): void => {
    if (stopped) return;
    if (filename === null) {
      unknown = true;
      schedule();
      return;
    }
    const path = relative(rootDirectory, resolve(watchDirectory, String(filename))).replace(/\\/g, '/');
    if (path.startsWith('..') || path === '') return;
    pending.add(path);
    schedule();
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
      context.logger.error(
        `Streamix rebuild hook stopped watching ${sourceRoot}: ${error.message}`,
      );
    });

    watchers.push(watcher);
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
        track(watch(directory, (_event, filename) => handleEvent(directory, filename)));
      } catch (error) {
        context.logger.error(
          `Streamix rebuild hook could not watch ${directory}: ${String(error)}`,
        );
      }
    }
  };

  try {
    track(watch(rootDirectory, { recursive: true }, (_event, filename) => handleEvent(rootDirectory, filename)));
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
  const introspection = options['introspection'] === true;

  await generateProject({
    sourceRoot,
    introspection,
    workspaceRoot: context.workspaceRoot,
  });

  const delegateOptions = buildDelegateOptions(options);
  // Redirect both compiler roots into the generated tree. A consuming
  // workspace therefore never needs to add `.angular/.streamix` to its own
  // tsconfig or configure a file replacement by hand.
  const virtualRoot = virtualRootOf(sourceRoot);
  // Dev-server validates a different schema; its buildTarget supplies these roots.
  if (target !== 'serve' && target !== 'dev-server') {
    delegateOptions['browser'] = `${virtualRoot}/main.ts`;
    delegateOptions['tsConfig'] = virtualTsconfigOf(sourceRoot);
  }

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
  // regenerated virtual component is rewritten. A mid-edit save can fail
  // compilation; the queue keeps the previous virtual tree serving and
  // retries on the next change.
  const shouldWatch = shouldWatchSources(target, context.target?.target, delegateOptions['watch']);
  let stopped = false;
  let rebuildQueue = Promise.resolve();
  let stopWatcher: () => void = () => undefined;
  let stopLibraries: () => void = () => undefined;
  if (shouldWatch) {
    stopLibraries = watchLibraries(context.workspaceRoot, sourceRoot, () => {
      rebuildQueue = rebuildQueue.then(async () => {
        if (!stopped) await refreshApplication(context.workspaceRoot, sourceRoot,
          (workspace, root, files) => regenerateAngularFiles(workspace, root, files, introspection));
      }).catch(error => context.logger.warn(`Streamix library update failed: ${String(error)}`));
    }, message => context.logger.warn(message));
    stopWatcher = startSourceWatcher(context, sourceRoot, paths => {
      rebuildQueue = rebuildQueue.then(async () => {
        if (stopped) return;
        if (paths && !paths.some(path => path.endsWith('.html'))) {
          await regenerateAngularFiles(context.workspaceRoot, sourceRoot, paths, introspection);
        } else {
          await generateProject({ sourceRoot, introspection, workspaceRoot: context.workspaceRoot });
        }
      }).catch(error => context.logger.warn(`Streamix Angular source update failed: ${String(error)}`));
    });
  }

  try {
    yield* delegateOutputs(run);
  } finally {
    stopped = true;
    stopLibraries();
    stopWatcher();
  }
});

export { applicationBuilder };
export default applicationBuilder;
