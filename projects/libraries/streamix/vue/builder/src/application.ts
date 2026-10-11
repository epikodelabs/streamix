import { createBuilder, type BuilderOutput, type Target } from '@angular-devkit/architect';
import { watch, type FSWatcher } from 'node:fs';
import { join } from 'node:path';
import { Observable } from 'rxjs';
import { generateVueProject, regenerateVueFile } from './generate-project';

interface ObservableLike<T> {
  subscribe(observer: {
    next(value: T): void;
    error(error: unknown): void;
    complete(): void;
  }): { unsubscribe(): void };
}

/**
 * Mirrors the authored Vue tree into `.angular/.streamix`, transforms SFCs,
 * then delegates to a Vue-capable Architect target. The delegate owns actual
 * Vue bundling; this builder owns only Streamix's pre-compilation step.
 */
export const applicationBuilder = createBuilder((options, context) => new Observable<BuilderOutput>((subscriber) => {
  let stopped = false;
  let run: { stop(): void; output: ObservableLike<BuilderOutput> } | undefined;
  let watcher: FSWatcher | undefined;
  let rebuildQueue = Promise.resolve();
  let outputSubscription: { unsubscribe(): void } | undefined;

  void (async () => {
    const [project, target] = String(options['delegateTarget'] ?? '').split(':');
    const sourceRoot = String(options['sourceRoot'] ?? '');
    if (!project || !target || !sourceRoot) {
      subscriber.error(new Error('Streamix Vue builder requires delegateTarget and sourceRoot.'));
      return;
    }

    try {
      await generateVueProject(context.workspaceRoot, sourceRoot);
      if (stopped) return;

      if (context.target?.target === 'serve' || target === 'serve') {
        watcher = watch(join(context.workspaceRoot, sourceRoot), { recursive: true }, (_event, filename) => {
          if (stopped) return;
          rebuildQueue = rebuildQueue.then(async () => {
            if (stopped) return;
            if (filename) await regenerateVueFile(context.workspaceRoot, sourceRoot, String(filename));
            else await generateVueProject(context.workspaceRoot, sourceRoot);
          }).catch(error => context.logger.error(`Streamix Vue source update failed: ${String(error)}`));
        });
      }

      const delegate: Target = { project, target };
      if (context.target?.configuration !== undefined) {
        delegate.configuration = context.target.configuration;
      }
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
