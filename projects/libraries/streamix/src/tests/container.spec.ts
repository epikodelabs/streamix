import {
  createContainer,
  createModule,
  createToken,
  globalContainer,
  registerMany,
  resetGlobalContainer
} from '@epikodelabs/streamix';

describe('IoC Container', () => {
  beforeEach(() => {
    resetGlobalContainer();
  });

  afterEach(async () => {
    await globalContainer.dispose();
  });

  describe('tokens', () => {
    it('creates unique tokens', () => {
      const a = createToken<number>('a');
      const b = createToken<number>('b');
      expect(a).not.toBe(b);
    });

    it('preserves type information', () => {
      const NumberToken = createToken<number>('number');
      const container = createContainer();
      container.register(NumberToken, () => 42);
      const value = container.resolve(NumberToken);
      expect(value).toBe(42);
    });
  });

  describe('registration & resolution', () => {
    it('registers and resolves a service', () => {
      const Logger = createToken<{ log(msg: string): void }>('logger');
      const container = createContainer();
      const logger = { log: jasmine.createSpy('log') };

      container.register(Logger, () => logger);

      expect(container.resolve(Logger)).toBe(logger);
    });

    it('throws when resolving unregistered token', () => {
      const Missing = createToken<string>('missing');
      const container = createContainer();
      expect(() => container.resolve(Missing)).toThrowError(/No registration found/);
    });

    it('supports optional resolution', () => {
      const Maybe = createToken<string>('maybe');
      const container = createContainer();
      expect(container.resolveOptional(Maybe)).toBeUndefined();

      container.register(Maybe, () => 'present');
      expect(container.resolveOptional(Maybe)).toBe('present');
    });

    it('chains registrations fluently', () => {
      const A = createToken<number>('a');
      const B = createToken<string>('b');
      const container = createContainer()
        .register(A, () => 1)
        .register(B, () => 'two');

      expect(container.resolve(A)).toBe(1);
      expect(container.resolve(B)).toBe('two');
    });
  });

  describe('dependency resolution', () => {
    it('resolves dependencies via context', () => {
      const Database = createToken<{ query(): number }>('database');
      const Repository = createToken<{ find(): number }>('repository');

      const db = { query: () => 42 };
      const container = createContainer()
        .register(Database, () => db)
        .register(Repository, (ctx) => ({
          find: () => ctx.resolve(Database).query(),
        }));

      expect(container.resolve(Repository).find()).toBe(42);
    });

    it('resolves optional dependencies via context', () => {
      const Optional = createToken<string>('optional');
      const Consumer = createToken<string>('consumer');

      const container = createContainer().register(Consumer, (ctx) => {
        const value = ctx.resolveOptional(Optional);
        return value ?? 'default';
      });

      expect(container.resolve(Consumer)).toBe('default');
    });
  });

  describe('lifetime management', () => {
    it('singleton returns the same instance', () => {
      const Counter = createToken<{ id: number }>('counter');
      let nextId = 1;
      const container = createContainer().register(
        Counter,
        () => ({ id: nextId++ }),
        { lifetime: 'singleton' }
      );

      const a = container.resolve(Counter);
      const b = container.resolve(Counter);
      expect(a).toBe(b);
      expect(a.id).toBe(1);
    });

    it('singletons are cached on the root container', () => {
      const Token = createToken<number>('root-singleton');
      let calls = 0;
      const root = createContainer().register(Token, () => ++calls, {
        lifetime: 'singleton',
      });
      const child = root.createChild();

      expect(child.resolve(Token)).toBe(1);
      expect(child.resolve(Token)).toBe(1);
      expect(calls).toBe(1);
    });

    it('scoped returns same instance per container', () => {
      const Token = createToken<number>('scoped');
      let calls = 0;
      const parent = createContainer().register(Token, () => ++calls, {
        lifetime: 'scoped',
      });
      const child = parent.createChild();

      expect(parent.resolve(Token)).toBe(1);
      expect(parent.resolve(Token)).toBe(1);
      expect(child.resolve(Token)).toBe(2);
      expect(child.resolve(Token)).toBe(2);
    });

    it('transient returns a new instance every time', () => {
      const Token = createToken<{ id: number }>('transient');
      let nextId = 1;
      const container = createContainer().register(
        Token,
        () => ({ id: nextId++ }),
        { lifetime: 'transient' }
      );

      const a = container.resolve(Token);
      const b = container.resolve(Token);
      expect(a).not.toBe(b);
      expect(a.id).toBe(1);
      expect(b.id).toBe(2);
    });

    it('defaults to transient lifetime', () => {
      const Token = createToken<number>('default-lifetime');
      let calls = 0;
      const container = createContainer().register(Token, () => ++calls);

      container.resolve(Token);
      container.resolve(Token);
      expect(calls).toBe(2);
    });
  });

  describe('hierarchical containers', () => {
    it('child resolves parent registrations', () => {
      const Token = createToken<string>('inherited');
      const parent = createContainer().register(Token, () => 'parent');
      const child = parent.createChild();

      expect(child.resolve(Token)).toBe('parent');
    });

    it('child override shadows parent', () => {
      const Token = createToken<string>('override');
      const parent = createContainer().register(Token, () => 'parent');
      const child = parent.createChild().register(Token, () => 'child');

      expect(parent.resolve(Token)).toBe('parent');
      expect(child.resolve(Token)).toBe('child');
    });

    it('has() checks hierarchy', () => {
      const ParentToken = createToken<string>('parent-token');
      const ChildToken = createToken<string>('child-token');
      const parent = createContainer().register(ParentToken, () => 'p');
      const child = parent.createChild().register(ChildToken, () => 'c');

      expect(child.has(ParentToken)).toBeTrue();
      expect(child.has(ChildToken)).toBeTrue();
      expect(parent.has(ChildToken)).toBeFalse();
    });
  });

  describe('resource cleanup', () => {
    it('calls cleanup on dispose in reverse resolution order', async () => {
      const order: string[] = [];
      const A = createToken<{ close(): void }>('a');
      const B = createToken<{ close(): void }>('b');

      const container = createContainer()
        .register(
          A,
          () => ({ close: () => order.push('a') }),
          { lifetime: 'singleton', cleanup: (v) => v.close() }
        )
        .register(
          B,
          () => ({ close: () => order.push('b') }),
          { lifetime: 'singleton', cleanup: (v) => v.close() }
        );

      container.resolve(A);
      container.resolve(B);
      await container.dispose();

      expect(order).toEqual(['b', 'a']);
    });

    it('awaits async cleanup', async () => {
      const Token = createToken<{ close(): Promise<void> }>('async');
      let closed = false;
      const container = createContainer().register(
        Token,
        () => ({ close: () => Promise.resolve().then(() => { closed = true; }) }),
        { lifetime: 'singleton', cleanup: (v) => v.close() }
      );

      container.resolve(Token);
      expect(closed).toBeFalse();
      await container.dispose();
      expect(closed).toBeTrue();
    });

    it('disposes child scoped services without disposing parent singletons', async () => {
      const Singleton = createToken<{ dispose(): void }>('singleton');
      const Scoped = createToken<{ dispose(): void }>('scoped');

      let singletonDisposed = false;
      let scopedDisposed = false;

      const parent = createContainer()
        .register(
          Singleton,
          () => ({ dispose: () => { singletonDisposed = true; } }),
          { lifetime: 'singleton', cleanup: (v) => v.dispose() }
        )
        .register(
          Scoped,
          () => ({ dispose: () => { scopedDisposed = true; } }),
          { lifetime: 'scoped', cleanup: (v) => v.dispose() }
        );

      const child = parent.createChild();
      child.resolve(Singleton);
      child.resolve(Scoped);

      await child.dispose();

      expect(scopedDisposed).toBeTrue();
      expect(singletonDisposed).toBeFalse();
    });

    it('collects cleanup errors and reports them', async () => {
      const Token = createToken<{}>('failing');
      const container = createContainer().register(
        Token,
        () => ({}),
        { lifetime: 'singleton', cleanup: () => { throw new Error('cleanup failed'); } }
      );

      container.resolve(Token);
      await expectAsync(container.dispose()).toBeRejectedWithError(/cleanup failed/);
    });
  });

  describe('circular dependencies', () => {
    it('throws on direct circular dependency', () => {
      const A = createToken<string>('a');
      const B = createToken<string>('b');
      const container = createContainer()
        .register(A, (ctx) => `a:${ctx.resolve(B)}`, { lifetime: 'singleton' })
        .register(B, (ctx) => `b:${ctx.resolve(A)}`, { lifetime: 'singleton' });

      expect(() => container.resolve(A)).toThrowError(/Circular dependency/);
    });

    it('throws on indirect circular dependency', () => {
      const A = createToken<string>('a');
      const B = createToken<string>('b');
      const C = createToken<string>('c');
      const container = createContainer()
        .register(A, (ctx) => ctx.resolve(B), { lifetime: 'singleton' })
        .register(B, (ctx) => ctx.resolve(C), { lifetime: 'singleton' })
        .register(C, (ctx) => ctx.resolve(A), { lifetime: 'singleton' });

      expect(() => container.resolve(A)).toThrowError(/Circular dependency/);
    });
  });

  describe('composition', () => {
    it('registerMany applies multiple registrations', () => {
      const A = createToken<number>('a');
      const B = createToken<string>('b');
      const container = registerMany(createContainer(), [
        { token: A, factory: () => 1 },
        { token: B, factory: () => 'two' },
      ]);

      expect(container.resolve(A)).toBe(1);
      expect(container.resolve(B)).toBe('two');
    });

    it('createModule composes registrations onto a container', () => {
      const A = createToken<number>('module-a');
      const B = createToken<string>('module-b');
      const module = createModule([
        { token: A, factory: () => 10 },
        { token: B, factory: () => 'twenty' },
      ]);

      const container = module(createContainer());
      expect(container.resolve(A)).toBe(10);
      expect(container.resolve(B)).toBe('twenty');
    });
  });

  describe('global container', () => {
    it('register and resolve use the global container', () => {
      const Token = createToken<string>('global');
      globalContainer.register(Token, () => 'global-value');
      expect(globalContainer.resolve(Token)).toBe('global-value');
    });

    it('resolveOptional returns undefined for unregistered global token', () => {
      const Token = createToken<string>('missing-global');
      expect(globalContainer.resolveOptional(Token)).toBeUndefined();
    });
  });
});
