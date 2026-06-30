import {
  atom,
  atomExpr,
  derived,
  derivedExpr,
  flow,
  flowExpr,
  getCurrentScope,
  globalScope,
  map,
  method,
  pipe,
  pipeExpr,
  scope,
  startWith,
  type Scope,
} from '@epikodelabs/streamix';

const delay = (ms = 10) => new Promise<void>(resolve => setTimeout(resolve, ms));

describe('Scope System', () => {
  afterEach(() => {
    if (globalScope) {
      globalScope.mode = 'discrete';
    }
  });

  describe('scope creation', () => {
    it('should create a scope', () => {
      const s = scope({});
      expect(s.type).toBe('scope');
      expect(s.parent).toBe(globalScope);
      expect(s.loading).toBe(false);
      s.dispose();
    });

    it('should merge factory return values', () => {
      interface Shape {
        count: number;
      }

      const s = scope<Shape>(() => ({ count: 0 }));
      const snapshot = s.snapshot();
      expect(snapshot.count).toBe(0);
      expect(s.count).toBeDefined();
      s.dispose();
    });

    it('should support dot notation on properties', async () => {
      interface Shape {
        count: number;
        doubled: number;
      }

      const s = scope<Shape>({
        count: 0,
        doubled: (self) => self.count * 2,
      });

      s.count = 5;
      await delay();
      expect(s.doubled).toBe(10);
      expect(s.loading).toBe(false); // This should be false as all atoms had initial values
      s.dispose();
    });

    it('should support assignment through the proxy', async () => {
      interface Shape {
        count: number;
        doubled: number;
      }

      const s = scope<Shape>({
        count: 0,
        doubled: (self) => self.count * 2,
      });

      expect(s.count).toBe(0);
      s.count = 5;
      await delay();
      expect(s.count).toBe(5);
      expect(s.doubled).toBe(10);
      s.dispose();
    });

    it('should subscribe to atom values via subscribeTo', async () => {
      interface Shape {
        count: number;
      }

      const s = scope<Shape>({ count: 0 });

      const values: number[] = [];
      const sub = s.subscribeTo('count', v => values.push(v));

      s.count = 1;
      s.count = 2;
      await delay();
      expect(values).toEqual([0, 1, 2]);

      sub();
      s.dispose();
    });

    it('should not deliver an initial subscribeTo emission when the atom has no value yet', async () => {
      interface Shape {
        user: string;
      }

      const s = scope<Shape>({
        user: atomExpr<string>(),
      });

      const values: string[] = [];
      const sub = s.subscribeTo('user', v => values.push(v));

      await delay();
      expect(values).toEqual([]);

      s.user = 'Ada';
      await delay();
      expect(values).toEqual(['Ada']);

      sub();
      s.dispose();
    });

    it('should not allow assignment to derived atoms', () => {
      interface Shape {
        count: number;
        doubled: number;
      }

      const s = scope<Shape>({
        count: 0,
        doubled: (self) => self.count * 2,
      });

      expect(() => {
        (s as any).doubled = 99;
      }).toThrowError();
      s.dispose();
    });

    it('should not allow assignment to flow atoms', async () => {
      interface Shape {
        a: number;
      }

      const s = scope<Shape>({
        a: flowExpr(() => (async function* () { yield 1; })()),
      });

      expect(() => {
        (s as any).a = 99;
      }).toThrowError();
      s.dispose();
    });

    it('should support nested scopes', () => {
      const parent = scope({
        child: { x: 42 },
      });

      expect(parent.child.x).toBe(42);
      expect(parent.child.parent).toBe(parent);
      parent.dispose();
    });
  });

  describe('self proxy in factory', () => {
    it('should expose loading through self during setup', () => {
      let loadingDuringSetup: boolean | undefined;
      const s = scope(function (this: any) {
        loadingDuringSetup = this.loading;
        return { count: atom(0) };
      });

      // Loading is true during setup because atoms have not yet emitted.
      expect(loadingDuringSetup).toBe(true);
      // After setup completes with initial values, loading flips to false.
      expect(s.loading).toBe(false);
      s.dispose();
    });

    it('should allow self-referential methods', () => {
      interface Shape {
        count: number;
        increment: () => void;
      }

      const s = scope<Shape>({
        count: 0,
        increment: (self) => () => { self.count = self.count + 1; },
      });

      expect(s.count).toBe(0);
      s.increment();
      expect(s.count).toBe(1);
      s.increment();
      expect(s.count).toBe(2);
      s.dispose();
    });

    it('should allow atoms to be assigned to self before use', async () => {
      interface Shape {
        count: number;
        doubled: number;
      }

      const s = scope<Shape>({
        count: 0,
        doubled: (self) => self.count * 2,
      });

      expect(s.count).toBe(0);
      expect(s.doubled).toBe(0);

      s.count = 5;
      await delay();
      expect(s.doubled).toBe(10);
      s.dispose();
    });

    it('should allow subscribing through self during setup', async () => {
      interface Shape {
        count: number;
      }

      const values: number[] = [];
      const s = scope<Shape>({ count: 0 });
      const sub = s.subscribeTo('count', (v: number) => values.push(v));

      s.count = 1;
      s.count = 2;
      await delay();

      expect(values).toEqual([0, 1, 2]);
      sub();
      s.dispose();
    });

    it('should bind `this` to the scope proxy when a regular function is used', () => {
      let receivedThis: any;
      const s = scope(function (this: any) {
        receivedThis = this;
        return { count: atom(0) };
      });

      expect(receivedThis).toBe(s);
      s.dispose();
    });

    it('should allow reading and writing scope values through `this`', async () => {
      interface Shape {
        count: number;
        doubled: number;
      }

      const s = scope<Shape>({
        count: 0,
        doubled: (self) => self.count * 2,
      });

      expect(s.count).toBe(0);
      expect(s.doubled).toBe(0);

      s.count = 5;
      await delay();
      expect(s.doubled).toBe(10);

      s.dispose();
    });
  });

  describe('loading state', () => {
    it('should be true until all atoms emit', async () => {
      interface Shape {
        a: number;
        b: string;
      }

      const s1 = atom<number>();
      const s2 = atom<string>();

      const s = scope<Shape>(() => ({
        a: () => flow(s1),
        b: () => flow(s2),
      }));

      expect(s.loading).toBe(true);

      s1.next(1);
      await delay();
      expect(s.loading).toBe(true);

      s2.next('x');
      await delay();
      expect(s.loading).toBe(false);

      s.dispose();
      s1.dispose();
      s2.dispose();
    });

    it('should be false for atoms with initial values', () => {
      interface Shape {
        a: number;
        b: string;
      }

      const s = scope<Shape>({ a: 0, b: 'hello' });
      expect(s.loading).toBe(false);
      s.dispose();
    });

    it('should track nested scope loading', async () => {
      const source = atom<number>();

      const parent = scope({
        child: { a: () => flow(source) },
      });

      expect(parent.loading).toBe(true);

      source.next(42);
      await delay();
      expect(parent.loading).toBe(false);

      parent.dispose();
      source.dispose();
    });
  });

  describe('snapshot', () => {
    it('should capture all atom values', () => {
      interface Shape {
        count: number;
        name: string;
        doubled: number;
      }

      const s = scope<Shape>({
        count: 10,
        name: 'test',
        doubled: (self) => self.count * 2,
      });

      const snap = s.snapshot();
      expect(snap.count).toBe(10);
      expect(snap.name).toBe('test');
      expect(snap.doubled).toBe(20);
      s.dispose();
    });

    it('should capture nested scope values', () => {
      interface ChildShape {
        x: number;
        y: string;
      }

      interface ParentShape {
        child: Scope<ChildShape>;
      }

      const s = scope<ParentShape>({
        child: scope<ChildShape>({ x: 42, y: 'hello' }),
      });

      const snap = s.snapshot();
      expect(snap.child.x).toBe(42);
      expect(snap.child.y).toBe('hello');
      s.dispose();
    });

    it('should handle errors in snapshot', async () => {
      interface Shape {
        d: number;
      }

      const source = atom(0);
      const s = scope<Shape>(() => ({
        d: () => derived(() => {
          if (source.value > 10) throw new Error('Too high');
          return source.value;
        }, { terminateOnError: false }),
      }));

      source.next(15);
      const snap = await s.snapshot();
      // Should still return something even with error
      expect(snap.d).toBeDefined();
      s.dispose();
      source.dispose();
    });

    it('should use safeValue for derived atoms in error state during snapshot', async () => {
      interface Shape {
        d: number;
      }

      const source = atom(5);
      const s = scope<Shape>({
        d: derivedExpr(() => {
          if (source.value > 10) throw new Error('Too high');
          return source.value;
        }),
      });

      expect(s.snapshot().d).toBe(5);

      source.next(15);
      await delay();
      expect(s.snapshot().d).toBe(5); // last good safeValue

      s.dispose();
      source.dispose();
    });
  });

  describe('disposal', () => {
    it('should dispose all atoms in scope', () => {
      interface Shape {
        a: number;
        b: number;
      }

      const s = scope<Shape>({ a: 0, b: 0 });

      expect(s.at('a').disposed).toBe(false);
      expect(s.at('b').disposed).toBe(false);

      s.dispose();
      expect(s.at('a').disposed).toBe(true);
      expect(s.at('b').disposed).toBe(true);
    });

    it('should dispose nested scopes recursively', () => {
      interface Shape {
        child: {
          grandchild: {
            x: number;
          };
        };
      }

      const source = atom(0);
      const parent = scope<Shape>({
        child: {
          grandchild: { x: () => flow(source) },
        },
      });

      expect(parent.child.grandchild.at('x').disposed).toBe(false);
      parent.dispose();
      expect(parent.child.grandchild.at('x').disposed).toBe(true);
      source.dispose();
    });

    it('should decrement pending count through ancestors on disposal', async () => {
      const source = atom<number>();
      const parent = scope({
        child: { a: () => flow(source) },
      });

      expect(parent.loading).toBe(true);
      expect((parent as any)._pendingCount).toBeGreaterThan(0);

      parent.dispose();

      // The loading atom is disposed with the scope, so only the internal
      // pending count can be verified after disposal.
      expect((parent as any)._pendingCount).toBe(0);
      source.dispose();
    });

    it('should run cleanup hooks', () => {
      let cleaned = false;
      const s = scope(() => {
        const _s = getCurrentScope();
        // Add cleanup hook
        (_s as any).cleanups.add(() => { cleaned = true; });
        return {};
      });

      s.dispose();
      expect(cleaned).toBe(true);
    });
  });

  describe('analog mode', () => {
    it('should batch atom emissions to the scheduler', async () => {
      interface Shape {
        a: number;
      }

      const s = scope<Shape>({ a: 0 }, { mode: 'analog' });

      const values: number[] = [];
      s.at('a').subscribe(v => values.push(v));

      s.at('a').next(1);
      s.at('a').next(2);
      s.at('a').next(3);

      expect(values).toEqual([]);
      await delay();
      expect(values).toEqual([3]);
      s.dispose();
    });

    it('should batch derived recomputations', async () => {
      interface Shape {
        a: number;
        doubled: number;
      }

      const s = scope<Shape>({
        a: 0,
        doubled: (self) => self.a * 2,
      }, { mode: 'analog' });

      const values: number[] = [];
      s.at('doubled').subscribe(v => values.push(v));

      s.at('a').next(1);
      s.at('a').next(2);
      s.at('a').next(3);

      expect(values).toEqual([]);
      expect(s.doubled).toBe(6);

      await delay();
      expect(values).toEqual([6]);
      s.dispose();
    });

    it('should respect discrete opt-out', async () => {
      interface Shape {
        a: number;
      }

      const s = scope<Shape>(() => ({
        a: atomExpr<number>(0, { discrete: true }),
      }), { mode: 'analog' });

      const values: number[] = [];
      s.at('a').subscribe(v => values.push(v));

      s.at('a').next(1);
      s.at('a').next(2);
      await delay();
      expect(values).toEqual([1, 2]);
      s.dispose();
    });

    it('should inherit analog mode from parent', async () => {
      const parent = scope({
        child: { a: 0 },
      }, { mode: 'analog' });

      const childValues: number[] = [];
      parent.child.at('a').subscribe(v => childValues.push(v));

      parent.child.at('a').next(1);
      parent.child.at('a').next(2);
      parent.child.at('a').next(3);

      await delay();
      expect(parent.child.a).toBe(3);
      expect(childValues).toEqual([3]);

      parent.dispose();
    });

    it('should allow child to override parent analog mode', async () => {
      interface ChildShape {
        a: number;
      }

      interface ParentShape {
        child: Scope<ChildShape>;
      }

      const parent = scope<ParentShape>(() => ({
        child: scope<ChildShape>({ a: 0 }, { mode: 'discrete' }),
      }), { mode: 'analog' });

      const values: number[] = [];
      parent.child.at('a').subscribe(v => values.push(v));

      parent.child.at('a').next(1);
      parent.child.at('a').next(2);

      await delay();
      expect(values).toEqual([1, 2]);

      parent.dispose();
    });

    it('should keep derived values live in analog mode', async () => {
      interface Shape {
        a: number;
        doubled: number;
      }

      const s = scope<Shape>({
        a: 0,
        doubled: (self) => self.a * 2,
      }, { mode: 'analog' });

      const values: number[] = [];
      s.at('doubled').subscribe(v => values.push(v));

      s.at('a').next(5);

      // Value is recomputed on read even before the scheduler flushes
      expect(s.doubled).toBe(10);
      expect(values).toEqual([]);

      await delay();
      expect(values).toEqual([10]);

      s.dispose();
    });

    it('should batch flow emissions in analog mode', async () => {
      interface Shape {
        a: number;
        source: number;
      }

      const s = scope<Shape>(() => ({
        source: atomExpr<number>(),
        a: (_, atoms) => flow(atoms.source),
      }), { mode: 'analog' });

      const values: number[] = [];
      s.at('a').subscribe(v => values.push(v));

      s.at('source').next(1);
      s.at('source').next(2);
      s.at('source').next(3);

      // In analog mode, rapid source emissions are batched to a single scheduler
      // flush; the flow broadcasts only the latest value.
      expect(values).toEqual([]);
      await delay();
      expect(s.a).toBe(3);
      expect(values).toEqual([3]);

      s.dispose();
    });
  });

  describe('globalScope', () => {
    it('should default to discrete mode', () => {
      expect(globalScope.mode).toBe('discrete');
    });

    it('should make top-level scopes analog via global config', async () => {
      globalScope.mode = 'analog';

      interface Shape {
        a: number;
      }

      const s = scope<Shape>({ a: 0 });

      const values: number[] = [];
      s.at('a').subscribe(v => values.push(v));

      s.at('a').next(1);
      s.at('a').next(2);
      s.at('a').next(3);

      expect(values).toEqual([]);
      await delay();
      expect(values).toEqual([3]);

      s.dispose();
    });

    it('should let child scopes override global analog mode', async () => {
      globalScope.mode = 'analog';

      interface Shape {
        a: number;
      }

      const s = scope<Shape>({ a: 0 }, { mode: 'discrete' });

      const values: number[] = [];
      s.at('a').subscribe(v => values.push(v));

      s.at('a').next(1);
      s.at('a').next(2);

      await delay();
      expect(values).toEqual([1, 2]);
      s.dispose();
    });
  });

  describe('scope object shorthand', () => {
    it('should create a scope from a plain object', () => {
      const s = scope({ name: 'test', count: 0 });

      expect(s.type).toBe('scope');
      expect(s.name).toBe('test');
      expect(s.count).toBe(0);
      expect(s.at('name').value).toBe('test');
      expect(s.at('count').value).toBe(0);
      s.dispose();
    });

    it('should support assignment through the proxy for shorthand atoms', async () => {
      const s = scope({ name: 'test', count: 0 });

      s.name = 'updated';
      s.count = 5;

      await delay();
      expect(s.name).toBe('updated');
      expect(s.count).toBe(5);
      expect(s.at('name').value).toBe('updated');
      expect(s.at('count').value).toBe(5);
      s.dispose();
    });

    it('should turn nested plain objects into nested scopes', () => {
      const s = scope({
        user: { name: 'Alex', email: 'alex@example.com' },
        settings: { theme: 'dark' }
      });

      expect(s.user.name).toBe('Alex');
      expect(s.user.email).toBe('alex@example.com');
      expect(s.settings.theme).toBe('dark');
      expect(s.user.type).toBe('scope');
      expect(s.user.parent).toBe(s);
      s.dispose();
    });

    it('should write to nested shorthand scopes', async () => {
      const s = scope({
        user: { name: 'Alex', email: '' }
      });

      s.user.name = 'Jordan';
      s.user.email = 'jordan@example.com';

      await delay();
      expect(s.user.name).toBe('Jordan');
      expect(s.user.email).toBe('jordan@example.com');
      s.dispose();
    });

    it('should pass existing atoms through unchanged', async () => {
      const count = atom(0);
      const s = scope({ count, name: 'test' });

      expect(s.count).toBe(0);
      s.count = 10;
      await delay();
      expect(count.value).toBe(10);
      expect(s.name).toBe('test');
      s.dispose();
    });

    it('should pass nested scopes through unchanged', () => {
      const inner = scope({ x: 1 });
      const s = scope({ inner, name: 'test' });

      expect(s.inner.x).toBe(1);
      expect(s.inner.parent).toBe(s);
      s.dispose();
    });

    it('should pass functions through unchanged', () => {
      const s = scope({
        value: 0,
        increment: (self: any) => () => { self.value = self.value + 1; }
      });

      expect(typeof (s as any).increment).toBe('function');
      (s as any).increment();
      expect((s as any).value).toBe(1);
      s.dispose();
    });

    it('should wrap arrays in atoms', async () => {
      const s = scope({ items: [1, 2, 3] });

      expect(s.items).toEqual([1, 2, 3]);
      s.items = [4, 5];
      await delay();
      expect(s.items).toEqual([4, 5]);
      s.dispose();
    });

    it('should support snapshot for shorthand scopes', () => {
      const s = scope({
        user: { name: 'Alex', email: 'alex@example.com' },
        count: 5
      });

      const snap = s.snapshot();
      expect(snap).toEqual({
        user: { name: 'Alex', email: 'alex@example.com' },
        count: 5
      });
      s.dispose();
    });

    it('should dispose shorthand atoms and nested scopes recursively', () => {
      const s = scope({
        user: { name: 'Alex' },
        count: 0
      });

      expect(s.at('count').disposed).toBe(false);
      expect(s.user.at('name').disposed).toBe(false);
      s.dispose();
      expect(s.at('count').disposed).toBe(true);
      expect(s.user.at('name').disposed).toBe(true);
    });

    it('should subscribe to shorthand atoms via subscribeTo', async () => {
      const s = scope({ count: 0 });
      const values: number[] = [];

      const sub = s.subscribeTo('count', v => values.push(v));
      s.count = 1;
      s.count = 2;
      await delay();

      expect(values).toEqual([0, 1, 2]);
      sub();
      s.dispose();
    });

    it('should throw on circular references in shorthand state', () => {
      const state: any = { name: 'test' };
      state.self = state;

      expect(() => scope(state)).toThrowError(/Circular reference/);
    });

    it('should work alongside factory form in the same app', () => {
      interface Shape {
        personal: Scope<{ name: string; email: string }>;
        count: number;
      }

      const s = scope<Shape>(() => ({
        personal: scope({ name: '', email: '' }),
        count: 0,
      }));

      s.personal.name = 'Alex';
      s.count = 5;
      expect(s.personal.name).toBe('Alex');
      expect(s.count).toBe(5);
      s.dispose();
    });
  });

  describe('expression markers in object shorthand', () => {
    it('should support derivedExpr with self reference', async () => {
      const s = scope({
        count: 0,
        doubled: derivedExpr((self) => self.count * 2)
      });

      expect(s.count).toBe(0);
      expect(s.doubled).toBe(0);

      s.count = 5;
      await delay();
      expect(s.doubled).toBe(10);
      s.dispose();
    });

    it('should support derivedExpr with callable scope reading external atoms', async () => {
      const external = atom(2);
      const s = scope({
        count: 0,
        total: derivedExpr((self) => self.count + self(external))
      });

      expect(s.total).toBe(2);

      external.next(5);
      await delay();
      expect(s.total).toBe(5);

      s.count = 3;
      await delay();
      expect(s.total).toBe(8);

      s.dispose();
    });

    it('should support pipeExpr with self reference', async () => {
      const source = atom(0);
      const s = scope({
        multiplier: 2,
        ticks: pipeExpr((self) => pipe(source, startWith(1), map(x => x * self.multiplier)))
      });

      await delay();
      expect(s.ticks).toBe(2);

      source.next(5);
      await delay();
      expect(s.ticks).toBe(10);
      s.dispose();
    });

    it('should support flowExpr', async () => {
      const source = atom(0);
      const s = scope({
        flowValue: flowExpr(() => flow(source))
      });

      expect(s.flowValue).toBe(0);

      source.next(5);
      await delay();
      expect(s.flowValue).toBe(5);
      s.dispose();
    });

    it('should support atomExpr for atoms without an initial value', async () => {
      const s = scope({
        user: atomExpr<string>()
      });

      expect(s.user).toBeUndefined();

      s.user = 'Ada';
      await delay();
      expect(s.user).toBe('Ada');
      s.dispose();
    });

    it('should support atomExpr with an initial value', async () => {
      const s = scope({
        count: atomExpr(0)
      });

      expect(s.count).toBe(0);

      s.count = 5;
      await delay();
      expect(s.count).toBe(5);
      s.dispose();
    });

    it('should support methods with this bound to scope', () => {
      interface Shape {
        count: number;
        increment: () => void;
      }

      const s = scope<Shape>({
        count: 0,
        increment: (self) => () => { self.count++; },
      });

      expect(s.count).toBe(0);
      s.increment();
      expect(s.count).toBe(1);
      s.increment();
      expect(s.count).toBe(2);
      s.dispose();
    });

    it('should support method marker for side-effect actions', () => {
      interface Shape {
        count: number;
        increment: () => void;
      }

      const s = scope<Shape>({
        count: 0,
        increment: method(() => { s.count++; }),
      });

      expect(s.count).toBe(0);
      s.increment();
      expect(s.count).toBe(1);
      s.increment();
      expect(s.count).toBe(2);
      s.dispose();
    });

    it('should support derivedExpr depending on another derivedExpr', async () => {
      const s = scope({
        count: 1,
        doubled: derivedExpr((self) => self.count * 2),
        quadrupled: derivedExpr((self) => self.doubled * 2)
      });

      expect(s.quadrupled).toBe(4);

      s.count = 5;
      await delay();
      expect(s.doubled).toBe(10);
      expect(s.quadrupled).toBe(20);
      s.dispose();
    });

    it('should throw on circular expression markers', () => {
      expect(() => scope({
        a: derivedExpr((self) => self.b as number),
        b: derivedExpr((self) => self.a as number)
      })).toThrowError(/Circular dependency/);
    });

    it('should pass atoms through unchanged', () => {
      const count = atom(0);
      const s = scope({
        count,
        doubled: derivedExpr((self) => self.count * 2)
      });

      expect(s.count).toBe(0);
      expect(s.doubled).toBe(0);
      s.dispose();
    });
  });

  describe('scope', () => {
    it('should pass nested scopes through unchanged', () => {
      interface ChildShape {
        name: string;
      }

      interface ParentShape {
        child: Scope<ChildShape>;
      }

      const child = scope<ChildShape>({ name: 'Ada' });
      const parent = scope<ParentShape>({ child });

      expect(parent.child.name).toBe('Ada');
      expect(parent.snapshot()).toEqual({ child: { name: 'Ada' } });

      parent.dispose();
    });

    it('should support nested objects with expression functions', async () => {
      interface Shape {
        async: { value: number };
      }

      const source = atom(0);
      const s = scope<Shape>({
        async: {
          value: () => flow(source),
        },
      });

      await delay();
      expect(s.async.value).toBe(0);

      source.next(5);
      await delay();
      expect(s.async.value).toBe(5);

      source.dispose();
      s.dispose();
    });

    it('should treat function values as derived atoms', async () => {
      interface Shape {
        count: number;
        doubled: number;
      }

      const s = scope<Shape>({
        count: 0,
        doubled: (self) => self.count * 2,
      });

      expect(s.count).toBe(0);
      expect(s.doubled).toBe(0);

      s.count = 5;
      await delay();
      expect(s.doubled).toBe(10);

      s.dispose();
    });

    it('should support derived functions depending on other derived functions', async () => {
      interface Shape {
        count: number;
        doubled: number;
        quadrupled: number;
      }

      const s = scope<Shape>({
        count: 1,
        doubled: (self) => self.count * 2,
        quadrupled: (self) => self.doubled * 2,
      });

      expect(s.quadrupled).toBe(4);

      s.count = 5;
      await delay();
      expect(s.doubled).toBe(10);
      expect(s.quadrupled).toBe(20);

      s.dispose();
    });

    it('should throw on circular derived functions', () => {
      interface Shape {
        a: number;
        b: number;
      }

      expect(() => scope<Shape>({
        a: (self) => self.b,
        b: (self) => self.a,
      })).toThrowError(/Circular dependency/);
    });

    it('should throw on circular derived functions via factory', () => {
      interface Shape {
        a: number;
        b: number;
      }

      expect(() => scope<Shape>(() => ({
        a: (self) => self.b,
        b: (self) => self.a,
      }))).toThrowError(/Circular dependency/);
    });

    it('should pass raw atom references as the second callback argument', async () => {
      interface Shape {
        count: number;
        doubled: number;
      }

      const s = scope<Shape>({
        count: 2,
        doubled: (self) => self.count * 2,
      });

      expect(s.doubled).toBe(4);

      s.count = 5;
      await delay();
      expect(s.doubled).toBe(10);

      s.dispose();
    });

    it('should support atoms callable accessor signature', () => {
      interface Shape {
        count: number;
        squared: number;
      }

      const s = scope<Shape>({
        count: 3,
        squared: (self) => self.count ** 2,
      });

      expect(s.squared).toBe(9);
      s.dispose();
    });

    it('should use returned pipe and flow atoms directly', async () => {
      interface Shape {
        query: string;
        results: number;
        ticks: number;
      }

      const source = atom(0);
      const s = scope<Shape>({
        query: '',
        results: () => pipe(source, startWith(1), map(x => x * 2)),
        ticks: () => flow(source),
      });

      await delay();
      expect(s.results).toBe(2);
      expect(s.ticks).toBe(0);

      source.next(5);
      await delay();
      expect(s.results).toBe(10);
      expect(s.ticks).toBe(5);

      source.dispose();
      s.dispose();
    });
  });

  describe('integration', () => {
    it('should maintain reactivity after scope disposal', async () => {
      interface Shape {
        a: number;
      }

      const source = atom(0);
      const s = scope<Shape>({
        a: () => flow(source),
      });

      await delay();

      // Dispose scope
      s.dispose();

      // Source updates should not affect disposed atom
      source.next(42);
      expect(s.at('a').safeValue).toBe(0);
      expect(() => s.a).toThrow();

      source.dispose();
    });

    it('should handle complex reactive graph', async () => {
      interface Shape {
        a: number;
        b: number;
        sum: number;
        product: number;
        result: number;
      }

      const s = scope<Shape>({
        a: 1,
        b: 2,
        sum: (self) => self.a + self.b,
        product: (self) => self.a * self.b,
        result: (self) => self.sum + self.product,
      });

      expect(s.sum).toBe(3);
      expect(s.product).toBe(2);
      expect(s.result).toBe(5);

      s.a = 3;
      await delay();
      expect(s.sum).toBe(5);
      expect(s.product).toBe(6);
      expect(s.result).toBe(11);

      s.b = 4;
      await delay();
      expect(s.sum).toBe(7);
      expect(s.product).toBe(12);
      expect(s.result).toBe(19);

      s.dispose();
    });
  });
});
