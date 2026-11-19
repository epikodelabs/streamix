import {
  Component,
} from '@angular/core';
import {
  TestBed,
} from '@angular/core/testing';
import {
  atom,
  type DependencySource,
} from '@epikodelabs/streamix';

import {
  createBindingTable,
  type SxSourceReferenceMap,
  ɵinstallSxCompiledView,
  ɵinstallSxSourceReferences,
} from '../lib';

import { idescribe } from '../../../src/tests/env.spec';
import {
  ensureAngularTestEnvironment,
  useAngularTestEnvironment,
} from './angular-test-environment';

ensureAngularTestEnvironment();

idescribe('ɵinstallSxSourceReferences', () => {
  useAngularTestEnvironment();

  it('rebinds a compiled view when an authored accessor field is replaced', async () => {
    @Component({
      standalone: true,
      template: '<span></span>',
    })
    class HostComponent {
      readonly first = atom('first');
      readonly second = atom('second');
      private current: DependencySource<string> = this.first;

      get source(): DependencySource<string> {
        return this.current;
      }

      set source(value: DependencySource<string>) {
        this.current = value;
      }

      readonly __sxRefs = ɵinstallSxSourceReferences(this, ['source']);

      constructor() {
        ɵinstallSxCompiledView(
          this,
          (host, context) => {
            const table = createBindingTable(1);
            const span = host.querySelector('span')!;

            table.bind(
              0,
              context.source,
              value => {
                span.textContent = value;
              },
            );

            return table;
          },
          {
            sourceReferences: this.__sxRefs,
          },
        );
      }
    }

    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    const component = fixture.componentInstance;
    const span = fixture.nativeElement.querySelector('span') as HTMLSpanElement;

    expect(span.textContent).toBe('first');
    expect(component.first.subscriberCount).toBe(1);
    expect(component.second.subscriberCount).toBe(0);

    // Replacing the source through the authored accessor rebinds the view
    // without any Angular change detection in between.
    component.source = component.second;

    expect(span.textContent).toBe('second');
    expect(component.first.subscriberCount).toBe(0);
    expect(component.second.subscriberCount).toBe(1);

    fixture.destroy();
    expect(component.second.subscriberCount).toBe(0);
  });

  it('emits identity changes for a prototype accessor and deduplicates stable identity', async () => {
    @Component({
      standalone: true,
      template: '<span></span>',
    })
    class HostComponent {
      private stored: unknown = atom('first');

      get source(): unknown {
        return this.stored;
      }

      set source(value: unknown) {
        this.stored = value;
      }

      readonly __sxRefs = ɵinstallSxSourceReferences(this, ['source']);
    }

    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    const component = fixture.componentInstance;
    const emitted: unknown[] = [];
    const subscription = component.__sxRefs['source'].subscribe(
      source => emitted.push(source),
    );

    const second = atom('second');
    component.source = second;
    expect(emitted).toEqual([second]);

    // Reassigning the same identity is not a source replacement.
    component.source = second;
    expect(emitted).toEqual([second]);

    const third = atom('third');
    component.source = third;
    expect(emitted).toEqual([second, third]);

    subscription();
    fixture.destroy();
  });

  it('wraps an own accessor property while preserving its authored setter', () => {
    TestBed.configureTestingModule({});

    const setterCalls: unknown[] = [];
    const stored: { current: unknown } = { current: atom('first') };
    const context: Record<string, unknown> = {};

    Object.defineProperty(context, 'source', {
      configurable: true,
      enumerable: true,
      get: () => stored.current,
      set: value => {
        setterCalls.push(value);
        stored.current = value;
      },
    });

    const refs = TestBed.runInInjectionContext(() =>
      ɵinstallSxSourceReferences(context, ['source']),
    );

    const emitted: unknown[] = [];
    const subscription = refs['source'].subscribe(
      source => emitted.push(source),
    );

    const next = atom('second');
    context['source'] = next;

    // The authored setter ran, and the reported identity is what the authored
    // getter exposes afterwards.
    expect(setterCalls).toEqual([next]);
    expect(context['source']).toBe(next);
    expect(emitted).toEqual([next]);

    subscription();
  });

  it('emits the getter value when an authored setter normalizes the assignment', () => {
    TestBed.configureTestingModule({});

    const fallback = atom('fallback');
    const stored: { current: unknown } = { current: atom('first') };
    const context: Record<string, unknown> = {};

    Object.defineProperty(context, 'source', {
      configurable: true,
      enumerable: true,
      get: () => stored.current,
      set: value => {
        stored.current = value ?? fallback;
      },
    });

    const refs = TestBed.runInInjectionContext(() =>
      ɵinstallSxSourceReferences(context, ['source']),
    );

    const emitted: unknown[] = [];
    const subscription = refs['source'].subscribe(
      source => emitted.push(source),
    );

    context['source'] = null;
    expect(emitted).toEqual([fallback]);

    subscription();
  });

  it('keeps the authored strict assignment failure for getter-only accessors', () => {
    TestBed.configureTestingModule({});

    const stored = atom('first');
    const context: Record<string, unknown> = {};

    Object.defineProperty(context, 'source', {
      configurable: true,
      enumerable: true,
      get: () => stored,
    });

    expect(() =>
      TestBed.runInInjectionContext(() =>
        ɵinstallSxSourceReferences(context, ['source']),
      ),
    ).not.toThrow();

    expect(() => {
      context['source'] = atom('second');
    }).toThrowError(/which has only a getter/);
    expect(context['source']).toBe(stored);
  });

  it('reveals the authored prototype accessor again after destroy', async () => {
    @Component({
      standalone: true,
      template: '<span></span>',
    })
    class HostComponent {
      private stored: unknown = atom('first');

      get source(): unknown {
        return this.stored;
      }

      set source(value: unknown) {
        this.stored = value;
      }

      readonly __sxRefs = ɵinstallSxSourceReferences(this, ['source']);
    }

    const fixture = TestBed.createComponent(HostComponent);
    const component = fixture.componentInstance;

    // The observing wrapper is an own property that shadows the prototype
    // accessor while the component is alive.
    expect(
      Object.prototype.hasOwnProperty.call(component, 'source'),
    ).toBeTrue();

    const emitted: unknown[] = [];
    const subscription = component.__sxRefs['source'].subscribe(
      source => emitted.push(source),
    );

    fixture.destroy();

    expect(
      Object.prototype.hasOwnProperty.call(component, 'source'),
    ).toBeFalse();

    const after = atom('after');
    component.source = after;
    expect(
      (component as unknown as { stored: unknown }).stored,
    ).toBe(after);

    // The channel is cleared with the component: no emissions leave a
    // destroyed source reference.
    expect(emitted).toEqual([]);

    subscription();
  });

  it('restores an authored own accessor descriptor after destroy', () => {
    let authoredGet!: () => unknown;
    let authoredSet!: (value: unknown) => void;

    @Component({
      standalone: true,
      template: '<span></span>',
    })
    class HostComponent {
      private stored: unknown = atom('first');
      __sxRefs!: SxSourceReferenceMap;

      constructor() {
        Object.defineProperty(this, 'source', {
          configurable: true,
          enumerable: true,
          get: () => this.stored,
          set: (value: unknown) => {
            this.stored = value;
          },
        });

        authoredGet = Object.getOwnPropertyDescriptor(this, 'source')!.get!;
        authoredSet = Object.getOwnPropertyDescriptor(this, 'source')!.set!;

        this.__sxRefs = ɵinstallSxSourceReferences(this, ['source']);
      }
    }

    const fixture = TestBed.createComponent(HostComponent);
    const component = fixture.componentInstance;

    const wrapped = Object.getOwnPropertyDescriptor(component, 'source')!;
    expect(wrapped.get).not.toBe(authoredGet);
    expect(wrapped.set).not.toBe(authoredSet);

    fixture.destroy();

    const restored = Object.getOwnPropertyDescriptor(component, 'source')!;
    expect(restored.get).toBe(authoredGet);
    expect(restored.set).toBe(authoredSet);
    expect(
      (component as unknown as Record<string, unknown>)['source'],
    ).toBe(restored.get!.call(component));
  });

  it('rejects non-configurable source reference fields', () => {
    TestBed.configureTestingModule({});

    const context: Record<string, unknown> = {};
    Object.defineProperty(context, 'source', {
      configurable: false,
      enumerable: true,
      value: atom('first'),
      writable: true,
    });

    expect(() =>
      TestBed.runInInjectionContext(() =>
        ɵinstallSxSourceReferences(context, ['source']),
      ),
    ).toThrowError(/not configurable/);
  });

  it('ignores duplicate and invalid field names', () => {
    TestBed.configureTestingModule({});

    const context: Record<string, unknown> = {
      source: atom('first'),
    };

    const refs = TestBed.runInInjectionContext(() =>
      ɵinstallSxSourceReferences(context, [
        'source',
        'source',
        'not-valid!',
        '3rd',
      ]),
    );

    expect(Object.keys(refs)).toEqual(['source']);

    const emitted: unknown[] = [];
    const subscription = refs['source'].subscribe(
      source => emitted.push(source),
    );

    const next = atom('second');
    context['source'] = next;
    expect(emitted).toEqual([next]);

    subscription();
  });
});
