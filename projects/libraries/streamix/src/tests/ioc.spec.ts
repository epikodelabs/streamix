import {
  atomExpr,
  createToken,
  derivedExpr,
  globalContainer,
  globalScope,
  inject,
  injectOptional,
  provide,
  resetGlobalContainer,
  scope,
} from '@epikodelabs/streamix';

describe('IoC Scope Integration', () => {
  beforeEach(() => {
    resetGlobalContainer();
  });

  afterEach(async () => {
    await globalContainer.dispose();
  });

  it('global scope exposes the global container', () => {
    expect(globalScope.container).toBe(globalContainer);
  });

  it('scope has a child container', () => {
    const s = scope({});
    expect(s.container).toBeDefined();
    expect(s.container.parent).toBe(globalContainer);
    s.dispose();
  });

  it('nested scopes form a container hierarchy', () => {
    interface ParentShape { child: any; }
    const parent = scope<ParentShape>(() => ({
      child: scope({}),
    }));

    expect(parent.container.parent).toBe(globalContainer);
    expect(parent.child.container.parent).toBe(parent.container);

    parent.dispose();
  });

  it('provide() registers on the current scope container', () => {
    const Token = createToken<string>('scoped-service');
    const s = scope(() => {
      provide(Token, () => 'scoped-value');
      return {};
    });

    expect(s.container.has(Token)).toBeTrue();
    expect(s.container.resolve(Token)).toBe('scoped-value');
    s.dispose();
  });

  it('inject() uses the current scope container', () => {
    interface Shape { value: string; }
    const Token = createToken<string>('service');
    provide(Token, () => 'global-value');

    const s = scope<Shape>(() => {
      provide(Token, () => 'scoped-value');
      return { value: inject(Token) };
    });

    expect(s.value).toBe('scoped-value');
    s.dispose();
  });

  it('inject() falls back to global container outside a scope', () => {
    const Token = createToken<string>('global-fallback');
    provide(Token, () => 'global');
    expect(inject(Token)).toBe('global');
  });

  it('injectOptional() returns undefined for unregistered token in scope', () => {
    interface Shape { value: string | undefined; }
    const Token = createToken<string>('optional-scope');
    const s = scope<Shape>(() => ({
      value: injectOptional(Token),
    }));

    expect(s.value).toBeUndefined();
    s.dispose();
  });

  it('child scope inherits parent scope registrations', () => {
    interface ChildShape { value: string; }
    interface ParentShape { child: any; }
    const Token = createToken<string>('inherited');
    const parent = scope<ParentShape>(() => {
      provide(Token, () => 'from-parent');
      const child = scope<ChildShape>(() => ({
        value: inject(Token),
      }));
      return { child };
    });

    expect(parent.child.value).toBe('from-parent');
    parent.dispose();
  });

  it('child scope can override parent scope registrations', () => {
    interface ChildShape { value: string; }
    interface ParentShape { child: any; }
    const Token = createToken<string>('overridden');
    const parent = scope<ParentShape>(() => {
      provide(Token, () => 'parent');
      const child = scope<ChildShape>(() => {
        provide(Token, () => 'child');
        return { value: inject(Token) };
      });
      return { child };
    });

    expect(parent.child.value).toBe('child');
    parent.dispose();
  });

  it('scope disposal disposes scoped services', async () => {
    const Token = createToken<{ dispose(): void }>('scoped-disposable');
    let disposed = false;

    const s = scope(() => {
      provide(Token, () => ({ dispose: () => { disposed = true; } }), {
        lifetime: 'scoped',
        cleanup: (v) => v.dispose(),
      });
      inject(Token); // force resolution
      return {};
    });

    expect(disposed).toBeFalse();
    s.dispose();
    await new Promise((r) => setTimeout(r, 10));
    expect(disposed).toBeTrue();
  });

  it('scope disposal does not dispose parent singletons', async () => {
    const Token = createToken<{ dispose(): void }>('parent-singleton');
    let disposed = false;

    provide(Token, () => ({ dispose: () => { disposed = true; } }), {
      lifetime: 'singleton',
      cleanup: (v) => v.dispose(),
    });

    const child = scope(() => {
      inject(Token); // resolves from global root
      return {};
    });

    child.dispose();
    await new Promise((r) => setTimeout(r, 10));
    expect(disposed).toBeFalse();
  });

  it('atoms can use services resolved from their containing scope', () => {
    interface Shape {
      message: string;
      computed: string;
    }
    const Config = createToken<{ prefix: string }>('config');

    const s = scope<Shape>(() => {
      provide(Config, () => ({ prefix: 'scoped' }));
      const config = inject(Config); // resolved eagerly while scope is active
      return {
        message: atomExpr(''),
        computed: derivedExpr((self) => `${config.prefix}:${self.message}`),
      };
    });

    s.message = 'hello';
    expect(s.computed).toBe('scoped:hello');
    s.dispose();
  });
});

