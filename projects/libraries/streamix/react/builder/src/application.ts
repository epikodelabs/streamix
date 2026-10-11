import { createBuilder, type BuilderOutput, type Target } from "@angular-devkit/architect";
import { Observable } from "rxjs";
import { generateReactProject, regenerateStreamixFile } from "./generate-project";
import { watch, type FSWatcher } from "node:fs";
import { join } from "node:path";

interface ObservableLike<T> {
  subscribe(observer: { next(value: T): void; error(error: unknown): void; complete(): void }): { unsubscribe(): void };
}

export const applicationBuilder = createBuilder((options, context) => new Observable<BuilderOutput>((subscriber) => {
  let stopped = false;
  let run: { stop(): void; output: ObservableLike<BuilderOutput> } | undefined;
  let watcher: FSWatcher | undefined;
  let rebuildQueue = Promise.resolve();
  let outputSubscription: { unsubscribe(): void } | undefined;

  void (async () => {
    const [project, target] = String(options["delegateTarget"] ?? "").split(":");
    const sourceRoot = String(options["sourceRoot"] ?? "");
    if (!project || !target || !sourceRoot) {
      subscriber.error(new Error("Streamix React builder requires delegateTarget and sourceRoot."));
      return;
    }

    try {
      await generateReactProject(context.workspaceRoot, sourceRoot);
      if (stopped) return;
      // Watch the actual authored tree; the delegated builder watches only the virtual copy.
      // Queue edits so writes never interleave, and retain the previous virtual copy on errors.
      if (context.target?.target === "serve" || target === "serve" || options["watch"] === true) {
        watcher = watch(join(context.workspaceRoot, sourceRoot), { recursive: true }, (_event, filename) => {
          if (stopped) return;
          rebuildQueue = rebuildQueue.then(async () => {
            if (stopped) return;
            if (filename) await regenerateStreamixFile(context.workspaceRoot, sourceRoot, String(filename));
            else await generateReactProject(context.workspaceRoot, sourceRoot);
          }).catch(error => context.logger.error(`Streamix React source update failed: ${String(error)}`));
        });
      }

      const delegate: Target = { project, target };
      if (context.target?.configuration !== undefined) delegate.configuration = context.target.configuration;
      const scheduledRun = await context.scheduleTarget(delegate) as NonNullable<typeof run>;
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
    watcher?.close();
    outputSubscription?.unsubscribe();
    run?.stop();
  };
}));
