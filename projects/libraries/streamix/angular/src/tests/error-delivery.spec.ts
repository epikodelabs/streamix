import {
  createEnvironmentInjector,
  EnvironmentInjector,
  ErrorHandler,
  runInInjectionContext,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { atom, flow } from '@epikodelabs/streamix';
import {
  createBindingTable,
  RendererScheduler,
  rendererScheduler,
  setSxRenderErrorSink,
  ɵcreateSxValueBlock,
  ɵsxBlockAnchor,
  ɵsxInstallErrorDelivery,
} from '../lib';
import type { CancelRender, RenderScheduler } from '../lib/render-scheduler';
import { idescribe } from './env.spec';
import {
  ensureAngularTestEnvironment,
  useAngularTestEnvironment,
} from './angular-test-environment';

// Testify bundles specs independently: without this init the TestBed tests
// only pass when another spec bundle happens to initialize the platform
// first, so a filtered run of this file fails.
ensureAngularTestEnvironment();

class ManualFrameScheduler implements RenderScheduler {
  callback?: () => void;
  scheduleCount = 0;

  schedule(callback: () => void): CancelRender {
    this.scheduleCount += 1;
    this.callback = callback;

    return () => {
      if (this.callback === callback) {
        this.callback = undefined;
      }
    };
  }

  flush(): void {
    const callback = this.callback;
    this.callback = undefined;
    callback?.();
  }
}

function frameScheduler(): RendererScheduler {
  return new RendererScheduler(new ManualFrameScheduler());
}

idescribe('Angular error delivery', () => {
  useAngularTestEnvironment();
  let captured: unknown[];

  beforeEach(() => {
    captured = [];
    setSxRenderErrorSink(error => { captured.push(error); });
  });

  afterEach(() => {
    setSxRenderErrorSink(undefined);
  });

  it('delivers a direct-binding source failure through the error sink and recovers in place', () => {
    const table = createBindingTable(1, frameScheduler());
    const source = atom('ok');
    const target = document.createElement('span');
    table.bind(0, source, value => { target.textContent = String(value); });
    expect(target.textContent).toBe('ok');

    source.fail(new Error('boom'));
    table.flushNow();
    expect(captured.length).toBe(1);
    expect((captured[0] as Error).message).toBe('boom');
    // The stale successful value is no longer refreshed while failed.
    expect(target.textContent).toBe('ok');

    // A later successful emission clears the failure: the binding recovers
    // in place on the next flush.
    source.next('fixed');
    table.flushNow();
    expect(target.textContent).toBe('fixed');
    expect(captured.length).toBe(1);
    table.destroy();
    source.dispose();
  });

  it('routes delivered failures through the application ErrorHandler', () => {
    const handled: unknown[] = [];
    class CapturingErrorHandler implements ErrorHandler {
      handleError(error: unknown): void { handled.push(error); }
    }
    TestBed.configureTestingModule({ providers: [{ provide: ErrorHandler, useClass: CapturingErrorHandler }] });
    // The compiler emits this call inside the component's injection context.
    TestBed.runInInjectionContext(() => ɵsxInstallErrorDelivery());

    const table = createBindingTable(1, frameScheduler());
    const source = atom('ok');
    const target = document.createElement('span');
    table.bind(0, source, value => { target.textContent = String(value); });

    source.fail(new Error('via error handler'));
    table.flushNow();
    expect(handled.length).toBe(1);
    expect((handled[0] as Error).message).toBe('via error handler');
    table.destroy();
    source.dispose();
  });

  it('keeps a completed flow readable without delivering a failure', async () => {
    let release!: () => void;
    const finished = new Promise<void>(resolve => release = resolve);
    const frame = new ManualFrameScheduler();
    const table = createBindingTable(1, new RendererScheduler(frame));
    const source = flow(async function* () { yield 'only'; await finished; });
    const target = document.createElement('span');
    table.bind(0, source, value => { target.textContent = String(value); });
    // Flows activate on subscribe: the first emission lands asynchronously.
    await new Promise(resolve => setTimeout(resolve, 0));
    frame.flush();
    expect(target.textContent).toBe('only');
    // Let the flow complete and dispose its backing atom, then flush again:
    // the last emission stays and no failure is delivered.
    release();
    await new Promise(resolve => setTimeout(resolve, 0));
    frame.flush();
    expect(target.textContent).toBe('only');
    expect(captured).toEqual([]);
    table.destroy();
    source.dispose();
  });

  it('delivers structural block failures through the error sink and recovers', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const anchor = ɵsxBlockAnchor(host, 'spec');
    const section = document.createElement('section');
    const source = atom('on');
    const block = ɵcreateSxValueBlock(anchor, source, {
      create: value => {
        section.textContent = String(value);
        return { first: section, last: section, destroy() { section.remove(); } };
      },
      update: (instance, value) => { (instance.first as HTMLElement).textContent = String(value); },
    });

    source.fail(new Error('boom'));
    rendererScheduler.flushNow();
    expect(captured.length).toBe(1);
    expect((captured[0] as Error).message).toBe('boom');

    source.next('recovered');
    rendererScheduler.flushNow();
    expect(captured.length).toBe(1);
    expect(section.textContent).toBe('recovered');
    block.destroy();
    source.dispose();
  });
});

idescribe('Angular error-delivery injection fallback', () => {
  useAngularTestEnvironment();

  it('keeps the console sink outside an injection context', () => {
    expect(() => ɵsxInstallErrorDelivery()).not.toThrow();
    const errorSpy = spyOn(console, 'error');
    const table = createBindingTable(1, frameScheduler());
    const source = atom('ok');
    const target = document.createElement('span');
    table.bind(0, source, value => { target.textContent = String(value); });
    source.fail(new Error('console path'));
    table.flushNow();
    expect(errorSpy).toHaveBeenCalled();
    table.destroy();
    source.dispose();
  });

  it('delivers each application\'s failures through its own ErrorHandler', () => {
    const handledA: unknown[] = [];
    const handledB: unknown[] = [];

    class HandlerA implements ErrorHandler {
      handleError(error: unknown): void { handledA.push(error); }
    }
    class HandlerB implements ErrorHandler {
      handleError(error: unknown): void { handledB.push(error); }
    }

    const parent = TestBed.inject(EnvironmentInjector);
    const injectorA = createEnvironmentInjector(
      [{ provide: ErrorHandler, useClass: HandlerA }],
      parent,
    );
    const injectorB = createEnvironmentInjector(
      [{ provide: ErrorHandler, useClass: HandlerB }],
      parent,
    );

    const tableIn = (injector: EnvironmentInjector) =>
      runInInjectionContext(injector, () => createBindingTable(1, frameScheduler()));

    const route = (table: ReturnType<typeof tableIn>, message: string): void => {
      const source = atom('ok');
      const target = document.createElement('span');
      table.bind(0, source, value => { target.textContent = String(value); });
      source.fail(new Error(message));
      table.flushNow();
      source.dispose();
    };

    let destroyedA = false;
    let destroyedB = false;

    try {
      const tableA = tableIn(injectorA);
      const tableB = tableIn(injectorB);

      // The old module-global model routed A's failures through whichever
      // application initialized a component last. Per-view capture keeps
      // every application's routing intact, in both orders.
      route(tableB, 'b-fail');
      expect(handledB.map(error => (error as Error).message)).toEqual(['b-fail']);
      expect(handledA).toEqual([]);

      route(tableA, 'a-fail');
      expect(handledA.map(error => (error as Error).message)).toEqual(['a-fail']);
      expect(handledB.length).toBe(1);

      // Destroying one injector cannot reroute a surviving application.
      injectorB.destroy();
      destroyedB = true;
      route(tableA, 'a-still');
      expect(handledA.map(error => (error as Error).message)).toEqual(['a-fail', 'a-still']);
      expect(handledB.length).toBe(1);

      tableA.destroy();
      tableB.destroy();
    } finally {
      if (!destroyedA) {
        injectorA.destroy();
      }
      if (!destroyedB) {
        injectorB.destroy();
      }
    }
  });
});
