import { createBuilder, type BuilderOutput, type Target } from "@angular-devkit/architect";
import { Observable } from "rxjs";
import { generateReactProject } from "./generate-project";

interface ObservableLike<T> {
  subscribe(observer: { next(value: T): void; error(error: unknown): void; complete(): void }): { unsubscribe(): void };
}

export const applicationBuilder = createBuilder((options, context) => new Observable<BuilderOutput>((subscriber) => {
  let stopped = false;
  let run: { stop(): void; output: ObservableLike<BuilderOutput> } | undefined;
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
    outputSubscription?.unsubscribe();
    run?.stop();
  };
}));
