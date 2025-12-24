import type { Stream } from '@epikode/streamix';
import { onMediaQuery } from '@epikode/streamix/dom';
import { idescribe } from './env.spec';

idescribe('onMediaQuery', () => {
  let mqlMap: Record<string, any> = {};

  beforeEach(() => {
    mqlMap = {};

    // Mock window.matchMedia
    (window as any).matchMedia = jasmine.createSpy('matchMedia').and.callFake((query: string) => {
      if (!mqlMap[query]) {
        const listeners: ((event: MediaQueryListEvent) => void)[] = [];
        mqlMap[query] = {
          matches: false,
          media: query,
          addEventListener: (_: string, cb: (e: MediaQueryListEvent) => void) => listeners.push(cb),
          removeEventListener: (_: string, cb: (e: MediaQueryListEvent) => void) => {
            const index = listeners.indexOf(cb);
            if (index >= 0) listeners.splice(index, 1);
          },
          // Helper to manually dispatch events
          dispatchEvent: (matches: boolean) => {
            mqlMap[query].matches = matches;
            listeners.forEach(cb => cb({ matches } as MediaQueryListEvent));
          },
          listeners,
        };
      }
      return mqlMap[query];
    });
  });

  it('should emit initial value immediately', async () => {
    const stream: Stream<boolean> = onMediaQuery('(min-width: 600px)');
    const callback = jasmine.createSpy('callback');

    stream.subscribe(callback);

    // Wait for async emission
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(callback).toHaveBeenCalledWith(false);
  });

  it('should call callback on media query change', async () => {
    const query = '(min-width: 600px)';
    const stream: Stream<boolean> = onMediaQuery(query);
    const callback = jasmine.createSpy('callback');
    stream.subscribe(callback);

    // Wait for initial emission
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(callback).toHaveBeenCalledWith(false);

    const mql = mqlMap[query];

    // Dispatch change event
    mql.dispatchEvent(true);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(callback).toHaveBeenCalledWith(true);

    mql.dispatchEvent(false);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(callback).toHaveBeenCalledWith(false);

    expect(callback).toHaveBeenCalledTimes(3); // initial + 2 changes
  });

  it('should clean up listener on unsubscribe', async () => {
    const query = '(min-width: 600px)';
    const stream: Stream<boolean> = onMediaQuery(query);
    const callback = jasmine.createSpy('callback');

    const subscription = stream.subscribe(callback);
    
    // Wait for initial emission
    await new Promise(resolve => setTimeout(resolve, 0));
    
    const mql = mqlMap[query];
    expect(mql.listeners.length).toBe(1);

    subscription.unsubscribe();
    
    // Wait for cleanup
    await new Promise(resolve => setTimeout(resolve, 0));
    
    expect(mql.listeners.length).toBe(0);
  });

  it('should warn if matchMedia is not supported', () => {
    (window as any).matchMedia = undefined;
    spyOn(console, 'warn');

    const stream: Stream<boolean> = onMediaQuery('(min-width: 600px)');
    expect(console.warn).toHaveBeenCalledWith('matchMedia is not supported in this environment');

    const callback = jasmine.createSpy('callback');
    stream.subscribe(callback);

    expect(callback).not.toHaveBeenCalled();
  });

  it('should support promise media query strings', async () => {
    const query = '(min-width: 700px)';

    (window as any).matchMedia = jasmine.createSpy('matchMedia').and.callFake((_q: string) => {
      return {
        matches: true,
        addEventListener: () => {},
        removeEventListener: () => {},
      };
    });

    const stream: Stream<boolean> = onMediaQuery(Promise.resolve(query));
    const callback = jasmine.createSpy('callback');
    stream.subscribe(callback);

    await new Promise(resolve => setTimeout(resolve, 0));

    expect(callback).toHaveBeenCalledWith(false); // initial (thenable => false)
    expect(callback).toHaveBeenCalledWith(true);  // after promise resolves
  });

  it('should fall back to addListener/removeListener when addEventListener is not available', async () => {
    const query = '(min-width: 900px)';
    const listeners: ((event: MediaQueryListEvent) => void)[] = [];

    (window as any).matchMedia = jasmine.createSpy('matchMedia').and.callFake((_q: string) => {
      return {
        matches: false,
        addEventListener: undefined,
        removeEventListener: undefined,
        addListener: (cb: (e: MediaQueryListEvent) => void) => listeners.push(cb),
        removeListener: (cb: (e: MediaQueryListEvent) => void) => {
          const idx = listeners.indexOf(cb);
          if (idx >= 0) listeners.splice(idx, 1);
        },
      };
    });

    const stream: Stream<boolean> = onMediaQuery(query);
    const callback = jasmine.createSpy('callback');
    const sub = stream.subscribe(callback);

    await new Promise(resolve => setTimeout(resolve, 0));
    expect(listeners.length).toBe(1);

    listeners.forEach(cb => cb({ matches: true } as MediaQueryListEvent));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(callback).toHaveBeenCalledWith(true);

    sub.unsubscribe();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(listeners.length).toBe(0);
  });

  it('should keep a single listener until the last subscriber unsubscribes', async () => {
    const query = '(min-width: 1000px)';
    const listeners: ((event: MediaQueryListEvent) => void)[] = [];

    (window as any).matchMedia = jasmine.createSpy('matchMedia').and.callFake((_q: string) => {
      return {
        matches: false,
        addEventListener: (_: string, cb: (e: MediaQueryListEvent) => void) => listeners.push(cb),
        removeEventListener: (_: string, cb: (e: MediaQueryListEvent) => void) => {
          const idx = listeners.indexOf(cb);
          if (idx >= 0) listeners.splice(idx, 1);
        },
      };
    });

    const stream: Stream<boolean> = onMediaQuery(query);
    const cb1 = jasmine.createSpy('cb1');
    const cb2 = jasmine.createSpy('cb2');

    const s1 = stream.subscribe(cb1);
    const s2 = stream.subscribe(cb2);

    await new Promise(resolve => setTimeout(resolve, 0));
    expect(listeners.length).toBe(1);

    s1.unsubscribe();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(listeners.length).toBe(1);

    s2.unsubscribe();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(listeners.length).toBe(0);
  });
});

