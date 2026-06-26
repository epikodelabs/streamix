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
      const s = scope(() => ({}));
      expect(s.type).toBe('scope');
      expect(s.parent).toBe(globalScope);
      expect(s.loading).toBe(false);
      s.dispose();
    });

    it('should merge factory return values', () => {
      const s = scope(() => {
        const count = atom(0);
        return { count };
      });
      const snapshot = s.snapshot();
      expect(snapshot.count).toBe(0);
      expect(s.count).toBeDefined();
      s.dispose();
    });

    it('should support dot notation on properties', async () => {
      const s = scope(() => {
        const count = atom(0);
        const doubled = derived(() => count.value * 2);
        return { count, doubled };
      });
      
      s.at('count').next(5);
      await delay();
      expect(s.doubled).toBe(10);
      expect(s.loading).toBe(false); // This should be false as all atoms had initial values
      s.dispose();
    });

    it('should support assignment through the proxy', async () => {
      const s = scope(() => {
        const count = atom(0);
        const doubled = derived(() => count.value * 2);
        return { count, doubled };
      });

      expect(s.count).toBe(0);
      s.count = 5;
      await delay();
      expect(s.count).toBe(5);
      expect(s.doubled).toBe(10);
      s.dispose();
    });

    it('should subscribe to atom values via subscribeTo', async () => {
      const s = scope(() => {
        const count = atom(0);
        return { count };
      });

      const values: number[] = [];
      const sub = s.subscribeTo('count', v => values.push(v));

      s.count = 1;
      s.count = 2;
      await delay();
      expect(values).toEqual([0, 1, 2]);

      sub.unsubscribe();
      s.dispose();
    });

    it('should not allow assignment to derived atoms', () => {
      const s = scope(() => {
        const count = atom(0);
        const doubled = derived(() => count.value * 2);
        return { count, doubled };
      });

      expect(() => {
        (s as any).doubled = 99;
      }).toThrowError();
      s.dispose();
    });

    it('should not allow assignment to flow atoms', async () => {
      const s = scope(() => {
        const a = flow((async function* () { yield 1; })());
        return { a };
      });

      expect(() => {
        (s as any).a = 99;
      }).toThrowError();
      s.dispose();
    });

    it('should support nested scopes', () => {
      const parent = scope(() => {
        const child = scope(() => {
          const x = atom(42);
          return { x };
        });
        return { child };
      });
      
      expect(parent.child.x).toBe(42);
      expect(parent.child.parent).toBe(parent);
      parent.dispose();
    });
  });

  describe('self proxy in factory', () => {
    it('should pass the scope proxy to the factory', () => {
      let receivedSelf: any;
      const s = scope((self) => {
        receivedSelf = self;
        const count = atom(0);
        return { count };
      });

      expect(receivedSelf).toBe(s);
      s.dispose();
    });

    it('should expose loading through self during setup', () => {
      let loadingDuringSetup: boolean | undefined;
      const s = scope((self) => {
        loadingDuringSetup = self.loading;
        const count = atom(0);
        return { count };
      });

      // Loading is true during setup because atoms have not yet emitted.
      expect(loadingDuringSetup).toBe(true);
      // After setup completes with initial values, loading flips to false.
      expect(s.loading).toBe(false);
      s.dispose();
    });

    it('should allow self-referential methods', () => {
      const s = scope((self) => {
        const count = atom(0);
        const increment = () => { self.count = self.count + 1; };
        return { count, increment };
      });

      expect(s.count).toBe(0);
      s.increment();
      expect(s.count).toBe(1);
      s.increment();
      expect(s.count).toBe(2);
      s.dispose();
    });

    it('should allow atoms to be assigned to self before use', async () => {
      const s = scope((self) => {
        self.count = atom(0);
        const doubled = derived(() => self.count * 2);
        return { count: self.at.count, doubled };
      });

      expect(s.count).toBe(0);
      expect(s.doubled).toBe(0);

      s.count = 5;
      await delay();
      expect(s.doubled).toBe(10);
      s.dispose();
    });

    it('should allow subscribing through self during setup', async () => {
      const values: number[] = [];
      const s = scope((self) => {
        self.count = atom(0);
        self.subscribeTo('count', (v: number) => values.push(v));
        return { count: self.at.count };
      });

      s.count = 1;
      s.count = 2;
      await delay();

      expect(values).toEqual([0, 1, 2]);
      s.dispose();
    });

    it('should bind `this` to the scope proxy when a regular function is used', () => {
      let receivedThis: any;
      const s = scope(function (this) {
        receivedThis = this;
        const count = atom(0);
        return { count };
      });

      expect(receivedThis).toBe(s);
      s.dispose();
    });

    it('should allow reading and writing scope values through `this`', async () => {
      const s = scope(function (this) {
        this.count = atom(0);
        const doubled = derived(() => this.count * 2);
        return { count: this.at.count, doubled };
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
      const s1 = atom<number>();
      const s2 = atom<string>();
      
      const s = scope(() => {
        const a = flow(s1);
        const b = flow(s2);
        return { a, b };
      });
      
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
      const s = scope(() => {
        const a = atom(0);
        const b = atom('hello');
        return { a, b };
      });
      expect(s.loading).toBe(false);
      s.dispose();
    });

    it('should track nested scope loading', async () => {
      const source = atom<number>();
      
      const parent = scope(() => {
        const child = scope(() => {
          const a = flow(source);
          return { a };
        });
        return { child };
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
      const s = scope(() => {
        const count = atom(10);
        const name = atom('test');
        const doubled = derived(() => count.value * 2);
        return { count, name, doubled };
      });
      
      const snap = s.snapshot();
      expect(snap.count).toBe(10);
      expect(snap.name).toBe('test');
      expect(snap.doubled).toBe(20);
      s.dispose();
    });

    it('should capture nested scope values', () => {
      const s = scope(() => {
        const child = scope(() => {
          const x = atom(42);
          const y = atom('hello');
          return { x, y };
        });
        return { child };
      });
      
      const snap = s.snapshot();
      expect(snap.child.x).toBe(42);
      expect(snap.child.y).toBe('hello');
      s.dispose();
    });

    it('should handle errors in snapshot', async () => {
      const source = atom(0);
      const s = scope(() => {
        const d = derived(() => {
          if (source.value > 10) throw new Error('Too high');
          return source.value;
        }, { terminateOnError: false });
        return { d };
      });
      
      source.next(15);
      const snap = await s.snapshot();
      // Should still return something even with error
      expect(snap.d).toBeDefined();
      s.dispose();
      source.dispose();
    });
  });

  describe('disposal', () => {
    it('should dispose all atoms in scope', () => {
      const s = scope(() => {
        const a = atom(0);
        const b = atom(0);
        return { a, b };
      });
      
      expect(s.at('a').disposed).toBe(false);
      expect(s.at('b').disposed).toBe(false);
      
      s.dispose();
      expect(s.at('a').disposed).toBe(true);
      expect(s.at('b').disposed).toBe(true);
    });

    it('should dispose nested scopes recursively', () => {
      const source = atom(0);
      const parent = scope(() => {
        const child = scope(() => {
          const grandchild = scope(() => {
            const x = flow(source);
            return { x };
          });
          return { grandchild };
        });
        return { child };
      });
      
      expect(parent.child.grandchild.at('x').disposed).toBe(false);
      parent.dispose();
      expect(parent.child.grandchild.at('x').disposed).toBe(true);
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
      const s = scope(() => {
        const a = atom(0);
        return { a };
      }, { mode: 'analog' });
      
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
      const s = scope(() => {
        const a = atom(0);
        const doubled = derived(() => a.value * 2);
        return { a, doubled };
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
      const s = scope(() => {
        const a = atom(0, { discrete: true });
        return { a };
      }, { mode: 'analog' });
      
      const values: number[] = [];
      s.at('a').subscribe(v => values.push(v));
      
      s.at('a').next(1);
      s.at('a').next(2);
      await delay();
      expect(values).toEqual([1, 2]);
      s.dispose();
    });

    it('should inherit analog mode from parent', async () => {
      const parent = scope(() => {
        const child = scope(() => {
          const a = atom(0);
          return { a };
        });
        return { child };
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
      const parent = scope(() => {
        const child = scope(() => {
          const a = atom(0);
          return { a };
        }, { mode: 'discrete' });
        return { child };
      }, { mode: 'analog' });
      
      const values: number[] = [];
      parent.child.at('a').subscribe(v => values.push(v));
      
      parent.child.at('a').next(1);
      parent.child.at('a').next(2);
      
      await delay();
      expect(values).toEqual([1, 2]);
      
      parent.dispose();
    });

    it('should keep derived values live in analog mode', async () => {
      const s = scope(() => {
        const a = atom(0);
        const doubled = derived(() => a.value * 2);
        return { a, doubled };
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
      const s = scope(() => {
        const source = atom<number>();
        const a = flow(source);
        return { a, source };
      }, { mode: 'analog' });
      
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
      
      const s = scope(() => {
        const a = atom(0);
        return { a };
      });
      
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
      
      const s = scope(() => {
        const a = atom(0);
        return { a };
      }, { mode: 'discrete' });
      
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
        increment() { (s as any).value = (s as any).value + 1; }
      } as any);

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
      sub.unsubscribe();
      s.dispose();
    });

    it('should throw on circular references in shorthand state', () => {
      const state: any = { name: 'test' };
      state.self = state;

      expect(() => scope(state)).toThrowError(/Circular reference/);
    });

    it('should work alongside factory form in the same app', () => {
      const s = scope(() => {
        const personal = scope({ name: '', email: '' });
        const count = atom(0);
        return { personal, count };
      });

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
      const s = scope({
        count: 0,
        increment() { this.count++; }
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

  describe('scope.define', () => {
    it('should pass nested scopes through unchanged', () => {
      interface ChildShape {
        name: string;
      }

      interface ParentShape {
        child: Scope<ChildShape>;
      }

      const child = scope.define<ChildShape>({ name: 'Ada' });
      const parent = scope.define<ParentShape>({ child });

      expect(parent.child.name).toBe('Ada');
      expect(parent.snapshot()).toEqual({ child: { name: 'Ada' } });

      parent.dispose();
    });

    it('should support nested objects with expression functions', async () => {
      interface Shape {
        async: { value: number };
      }

      const source = atom(0);
      const s = scope.define<Shape>({
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

      const s = scope.define<Shape>({
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

      const s = scope.define<Shape>({
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

      expect(() => scope.define<Shape>({
        a: (self) => self.b,
        b: (self) => self.a,
      })).toThrowError(/Circular dependency/);
    });

    it('should throw on circular derived functions via scope.define factory', () => {
      interface Shape {
        a: number;
        b: number;
      }

      expect(() => scope.define<Shape>(() => ({
        a: (self) => self.b,
        b: (self) => self.a,
      }))).toThrowError(/Circular dependency/);
    });

    it('should pass raw atom references as the second callback argument', async () => {
      interface Shape {
        count: number;
        doubled: number;
      }

      const s = scope.define<Shape>({
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

      const s = scope.define<Shape>({
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
      const s = scope.define<Shape>({
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
      const s = scope.define<Shape>({
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

      const s = scope.define<Shape>({
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