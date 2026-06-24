import {
  atom,
  createContainer,
  createToken,
  derived,
  globalContainer,
  globalScope,
  inject,
  injectOptional,
  provide,
  resetGlobalContainer,
  scope,
  type Container,
  type Scope,
  type Token,
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
    const s = scope(() => ({}));
    expect(s.container).toBeDefined();
    expect(s.container.parent).toBe(globalContainer);
    s.dispose();
  });

  it('nested scopes form a container hierarchy', () => {
    const parent = scope(() => {
      const child = scope(() => ({}));
      return { child };
    });

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
    const Token = createToken<string>('service');
    provide(Token, () => 'global-value');

    const s = scope(() => {
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
    const Token = createToken<string>('optional-scope');
    const s = scope(() => ({
      value: injectOptional(Token),
    }));

    expect(s.value).toBeUndefined();
    s.dispose();
  });

  it('child scope inherits parent scope registrations', () => {
    const Token = createToken<string>('inherited');
    const parent = scope(() => {
      provide(Token, () => 'from-parent');
      const child = scope(() => ({
        value: inject(Token),
      }));
      return { child };
    });

    expect(parent.child.value).toBe('from-parent');
    parent.dispose();
  });

  it('child scope can override parent scope registrations', () => {
    const Token = createToken<string>('overridden');
    const parent = scope(() => {
      provide(Token, () => 'parent');
      const child = scope(() => {
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
    const Config = createToken<{ prefix: string }>('config');

    const s = scope(() => {
      provide(Config, () => ({ prefix: 'scoped' }));
      const config = inject(Config); // resolved eagerly while scope is active
      const message = atom('');
      const computed = derived(() => `${config.prefix}:${message.value}`);
      return { message, computed };
    });

    s.message.set('hello');
    expect(s.computed.value).toBe('scoped:hello');
    s.dispose();
  });
});

