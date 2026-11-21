import { refreshApplication, watchLibraries } from "./watch-libraries";
import { createBuilder, type BuilderOutput, type Target } from "@angular-devkit/architect";
import { Observable } from "rxjs";
import { generateReactProject, regenerateReactFiles } from "./generate-project";
import { shouldWatchSources } from "./options";
import { existsSync, watch, type FSWatcher } from "node:fs";
import { virtualApplicationPathOverrides } from "@epikodelabs/streamix/compiler";
import { readdir } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

interface ObservableLike<T> {
  subscribe(observer: { next(value: T): void; error(error: unknown): void; complete(): void }): { unsubscribe(): void };
}

interface WatcherContext {
  readonly workspaceRoot: string;
  readonly logger: { warn(message: string): void; error(message: string): void };
}

const SOURCE_WATCH_DEBOUNCE_MS = 50;

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
  context: WatcherContext,
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
    const path = relative(rootDirectory, resolve(watchDirectory, String(filename))).replace(/\\/g, "/");
    if (path.startsWith("..") || path === "") return;
    pending.add(path);
    schedule();
  };

  const track = (watcher: FSWatcher): void => {
    if (stopped) {
      watcher.close();
      return;
    }
    // Watchers emit 'error' asynchronously (the watched directory being
    // renamed or deleted, permission loss); left unhandled it would crash
    // the dev-server process.
    watcher.on("error", (error: Error) => {
      context.logger.error(`Streamix rebuild hook stopped watching ${sourceRoot}: ${error.message}`);
    });
    watchers.push(watcher);
  };

  const watchEachDirectory = async (root: string): Promise<void> => {
    const directories = [root];
    while (directories.length > 0) {
      const directory = directories.pop() as string;
      let entries;
      try {
        entries = await readdir(directory, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (entry.isDirectory()) directories.push(join(directory, entry.name));
      }
      try {
        track(watch(directory, (_event, filename) => handleEvent(directory, filename)));
      } catch (error) {
        context.logger.error(`Streamix rebuild hook could not watch ${directory}: ${String(error)}`);
      }
    }
  };

  try {
    track(watch(rootDirectory, { recursive: true }, (_event, filename) => handleEvent(rootDirectory, filename)));
  } catch {
    context.logger.warn(`Streamix rebuild hook fell back to per-directory watching for ${sourceRoot}.`);
    void watchEachDirectory(rootDirectory);
  }

  return () => {
    stopped = true;
    clearTimeout(timer);
    for (const watcher of watchers) watcher.close();
  };
}

export const applicationBuilder = createBuilder((options, context) => new Observable<BuilderOutput>((subscriber) => {
  let stopped = false;
  let run: { stop(): void; output: ObservableLike<BuilderOutput> } | undefined;
  let stopWatcher: (() => void) | undefined;
  let stopLibraries: (() => void) | undefined;
  let rebuildQueue = Promise.resolve();
  let outputSubscription: { unsubscribe(): void } | undefined;

  void (async () => {
    const [project, target] = String(options["delegateTarget"] ?? "").split(":");
    const sourceRoot = String(options["sourceRoot"] ?? "");
    const introspection = options["introspection"] === true;
    if (!project || !target || !sourceRoot) {
      subscriber.error(new Error("Streamix React builder requires delegateTarget and sourceRoot."));
      return;
    }

    try {
      const generatedRoot = await generateReactProject(context.workspaceRoot, sourceRoot, introspection);
      if (stopped) return;
      // Watch the actual authored tree; the delegated builder watches only the virtual copy.
      // Queue edits so writes never interleave, and retain the previous virtual copy on errors.
      if (shouldWatchSources(target, context.target?.target, options["watch"])) {
        stopLibraries = watchLibraries(context.workspaceRoot, sourceRoot, () => {
          rebuildQueue = rebuildQueue.then(async () => {
            if (!stopped) await refreshApplication(context.workspaceRoot, sourceRoot,
              (workspace, root, files) => regenerateReactFiles(workspace, root, files, introspection));
          }).catch(error => context.logger.warn(`Streamix library update failed: ${String(error)}`));
        }, message => context.logger.warn(message));
        stopWatcher = startSourceWatcher(context, sourceRoot, paths => {
          rebuildQueue = rebuildQueue.then(async () => {
            if (stopped) return;
            if (paths) {
              await regenerateReactFiles(context.workspaceRoot, sourceRoot, paths, introspection);
            } else {
              await generateReactProject(context.workspaceRoot, sourceRoot, introspection);
            }
          }).catch(error => context.logger.warn(`Streamix React source update failed: ${String(error)}`));
        });
      }

      const delegate: Target = { project, target };
      if (context.target?.configuration !== undefined) delegate.configuration = context.target.configuration;
      const builderName = await context.getBuilderNameForTarget(delegate);
      const delegateOverrides = builderName === "@angular/build:application" ||
          builderName === "@angular-devkit/build-angular:application"
        ? virtualApplicationPathOverrides(
            await context.getTargetOptions(delegate), {}, sourceRoot,
            relative(context.workspaceRoot, generatedRoot),
            path => existsSync(resolve(context.workspaceRoot, path)),
          )
        : undefined;
      if (stopped) return;
      const scheduledRun = await context.scheduleTarget(
        delegate, delegateOverrides as Parameters<typeof context.scheduleTarget>[1],
      ) as NonNullable<typeof run>;
      run = scheduledRun;
      if (stopped) {
        scheduledRun.stop();
        return;
      }

      outputSubscription = scheduledRun.output.subscribe({
        next(output) { subscriber.next(output); },
        error(error) { subscriber.error(error); },
        complete() { subscriber.complete(); },
      });
    } catch (error) {
      subscriber.error(error);
    }
  })();

  return () => {
    stopped = true;
    stopLibraries?.();
    stopWatcher?.();
    outputSubscription?.unsubscribe();
    run?.stop();
  };
}));
