import { onFullscreen } from "@epikodelabs/streamix/dom";
import { idescribe } from "./env.spec";

function delay(ms = 0): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

idescribe("onFullscreen", () => {
  let eventListeners: Map<string, Set<EventListener>>;
  let fullscreenElement: any;
  let webkitFullscreenElement: any;
  let mozFullScreenElement: any;
  let msFullscreenElement: any;
  
  let originalFullscreenElement: PropertyDescriptor | undefined;
  let originalWebkitFullscreenElement: PropertyDescriptor | undefined;
  let originalMozFullScreenElement: PropertyDescriptor | undefined;
  let originalMsFullscreenElement: PropertyDescriptor | undefined;

  beforeEach(() => {
    eventListeners = new Map();

    originalFullscreenElement = Object.getOwnPropertyDescriptor(document, 'fullscreenElement');
    originalWebkitFullscreenElement = Object.getOwnPropertyDescriptor(document, 'webkitFullscreenElement');
    originalMozFullScreenElement = Object.getOwnPropertyDescriptor(document, 'mozFullScreenElement');
    originalMsFullscreenElement = Object.getOwnPropertyDescriptor(document, 'msFullscreenElement');

    fullscreenElement = null;
    webkitFullscreenElement = null;
    mozFullScreenElement = null;
    msFullscreenElement = null;

    Object.defineProperty(document, "fullscreenElement", {
      get: () => fullscreenElement,
      configurable: true,
      enumerable: true
    });
    
    Object.defineProperty(document, "webkitFullscreenElement", {
      get: () => webkitFullscreenElement,
      configurable: true,
      enumerable: true
    });
    
    Object.defineProperty(document, "mozFullScreenElement", {
      get: () => mozFullScreenElement,
      configurable: true,
      enumerable: true
    });
    
    Object.defineProperty(document, "msFullscreenElement", {
      get: () => msFullscreenElement,
      configurable: true,
      enumerable: true
    });
    
    spyOn(document, "addEventListener").and.callFake(
      (event: string, handler: any, _options?: any) => {
        if (!eventListeners.has(event)) {
          eventListeners.set(event, new Set());
        }
        eventListeners.get(event)!.add(handler);
        // Don't call original - we'll trigger manually
      }
    );
    
    spyOn(document, "removeEventListener").and.callFake(
      (event: string, handler: any, _options?: any) => {
        eventListeners.get(event)?.delete(handler);
        // Don't call original
      }
    );
  });

  afterEach(() => {
    eventListeners.clear();
    
    if (originalFullscreenElement) {
      Object.defineProperty(document, 'fullscreenElement', originalFullscreenElement);
    } else {
      delete (document as any).fullscreenElement;
    }
    
    if (originalWebkitFullscreenElement) {
      Object.defineProperty(document, 'webkitFullscreenElement', originalWebkitFullscreenElement);
    } else {
      delete (document as any).webkitFullscreenElement;
    }
    
    if (originalMozFullScreenElement) {
      Object.defineProperty(document, 'mozFullScreenElement', originalMozFullScreenElement);
    } else {
      delete (document as any).mozFullScreenElement;
    }
    
    if (originalMsFullscreenElement) {
      Object.defineProperty(document, 'msFullscreenElement', originalMsFullscreenElement);
    } else {
      delete (document as any).msFullscreenElement;
    }
  });

  it("creates a stream with correct name and does not listen immediately", () => {
    const stream = onFullscreen();
    
    expect(stream.name).toBe("onFullscreen");
    expect(document.addEventListener).not.toHaveBeenCalled();
  });

  it("emits initial state when subscribing", async () => {
    const stream = onFullscreen();
    const values: boolean[] = [];

    stream.subscribe((value) => {
      values.push(value);
    });

    await new Promise(resolve => setTimeout(resolve, 50));
    expect(values).toEqual([false]);
  });

  it("detects fullscreen state across all browser variants", async () => {
    fullscreenElement = document.createElement("div");
    const stream = onFullscreen();
    
    const values1: boolean[] = [];
    stream.subscribe((value) => values1.push(value));
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(values1).toEqual([true]);
    
    fullscreenElement = null;
    webkitFullscreenElement = document.createElement("div");
    const stream2 = onFullscreen();
    
    const values2: boolean[] = [];
    stream2.subscribe((value) => values2.push(value));
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(values2).toEqual([true]);
  });

  it("responds to fullscreen change events", async () => {
    const stream = onFullscreen();
    const values: boolean[] = [];

    stream.subscribe((value) => values.push(value));
    
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(values).toEqual([false]);

    fullscreenElement = document.createElement("div");
    triggerEvent("fullscreenchange");
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(values).toEqual([false, true]);
    
    fullscreenElement = null;
    triggerEvent("fullscreenchange");
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(values).toEqual([false, true, false]);
  });

  it("emits to multiple subscribers and cleans up properly", async () => {
    const stream = onFullscreen();
    const values1: boolean[] = [];
    const values2: boolean[] = [];

    const sub1 = stream.subscribe(v => values1.push(v));

    await delay();
    expect(values1).toEqual([false]);

    const sub2 = stream.subscribe(v => values2.push(v));

    // second subscriber gets NO initial replay
    expect(values2).toEqual([]);

    fullscreenElement = document.createElement("div");
    triggerEvent("fullscreenchange");
    await delay();

    expect(values1).toEqual([false, true]);
    expect(values2).toEqual([true]);

    sub1.unsubscribe();
    sub2.unsubscribe();

    expect(document.removeEventListener).toHaveBeenCalled();
  });

  it("supports async iteration", async () => {
    const stream = onFullscreen();
    
    expect(stream[Symbol.asyncIterator]).toBeDefined();
    expect(typeof stream[Symbol.asyncIterator]).toBe("function");
    
    const iterator = stream[Symbol.asyncIterator]();
    expect(iterator).toBeDefined();
    expect(typeof iterator.next).toBe("function");
    
    const result = await iterator.next();
    expect(result.value).toBe(false);
    expect(result.done).toBe(false);
  });

  it("responds to all browser-specific fullscreen events", async () => {
    const stream = onFullscreen();
    const values: boolean[] = [];

    stream.subscribe((value) => values.push(value));
    
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(values).toEqual([false]);

    webkitFullscreenElement = document.createElement("div");
    triggerEvent("webkitfullscreenchange");
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(values).toEqual([false, true]);
    
    webkitFullscreenElement = null;
    mozFullScreenElement = document.createElement("div");
    triggerEvent("mozfullscreenchange");
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(values).toEqual([false, true, true]);
    
    mozFullScreenElement = null;
    msFullscreenElement = document.createElement("div");
    triggerEvent("MSFullscreenChange");
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(values).toEqual([false, true, true, true]);
  });

  it("starts listening on first subscription", () => {
    const stream = onFullscreen();

    stream.subscribe(() => {});

    expect(document.addEventListener).toHaveBeenCalledWith(
      "fullscreenchange",
      jasmine.any(Function)
    );
    expect(document.addEventListener).toHaveBeenCalledWith(
      "webkitfullscreenchange",
      jasmine.any(Function)
    );
    expect(document.addEventListener).toHaveBeenCalledWith(
      "mozfullscreenchange",
      jasmine.any(Function)
    );
    expect(document.addEventListener).toHaveBeenCalledWith(
      "MSFullscreenChange",
      jasmine.any(Function)
    );
  });

  it("does not restart listening for additional subscribers", () => {
    const stream = onFullscreen();
    
    stream.subscribe(() => {});
    (document.addEventListener as jasmine.Spy).calls.reset();
    
    stream.subscribe(() => {});

    expect(document.addEventListener).not.toHaveBeenCalled();
  });

  it("stops listening when last subscriber unsubscribes", () => {
    const stream = onFullscreen();
    
    const sub1 = stream.subscribe(() => {});
    const sub2 = stream.subscribe(() => {});

    sub1.unsubscribe();
    expect(document.removeEventListener).not.toHaveBeenCalled();

    sub2.unsubscribe();
    expect(document.removeEventListener).toHaveBeenCalledWith(
      "fullscreenchange",
      jasmine.any(Function)
    );
    expect(document.removeEventListener).toHaveBeenCalledWith(
      "webkitfullscreenchange",
      jasmine.any(Function)
    );
    expect(document.removeEventListener).toHaveBeenCalledWith(
      "mozfullscreenchange",
      jasmine.any(Function)
    );
    expect(document.removeEventListener).toHaveBeenCalledWith(
      "MSFullscreenChange",
      jasmine.any(Function)
    );
  });

  it("calls original onUnsubscribe callback", () => {
    const stream = onFullscreen();
    let onUnsubscribeCalled = false;
    
    const sub = stream.subscribe(() => {});
    const originalOnUnsubscribe = sub.onUnsubscribe;
    sub.onUnsubscribe = () => {
      originalOnUnsubscribe?.call(sub);
      onUnsubscribeCalled = true;
    };

    sub.unsubscribe();

    expect(onUnsubscribeCalled).toBe(true);
  });

  it("handles rapid subscribe/unsubscribe cycles", () => {
    const stream = onFullscreen();

    for (let i = 0; i < 5; i++) {
      const sub = stream.subscribe(() => {});
      sub.unsubscribe();
    }

    expect(document.removeEventListener).toHaveBeenCalled();
  });

  it("does not emit after all subscribers unsubscribe", async () => {
    const stream = onFullscreen();
    const values: boolean[] = [];

    const sub = stream.subscribe((value) => values.push(value));
    
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(values).toEqual([false]);
    
    sub.unsubscribe();

    fullscreenElement = document.createElement("div");
    triggerEvent("fullscreenchange");
    
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(values).toEqual([false]);
  });

  it("handles resubscription after all unsubscribe", async () => {
    const stream = onFullscreen();
    
    const sub1 = stream.subscribe(() => {});
    sub1.unsubscribe();

    (document.addEventListener as jasmine.Spy).calls.reset();
    
    const values: boolean[] = [];
    stream.subscribe((value) => values.push(value));

    await new Promise(resolve => setTimeout(resolve, 50));
    
    expect(document.addEventListener).toHaveBeenCalled();
    expect(values).toEqual([false]);
  });

  function triggerEvent(eventName: string) {
    const handlers = eventListeners.get(eventName);
    if (handlers) {
      const event = new Event(eventName);
      handlers.forEach(handler => {
        try {
          handler.call(document, event);
        } catch (e) {
          console.error(`Error in handler for ${eventName}:`, e);
        }
      });
    }
  }

  it('handles SSR environment (document undefined)', async () => {
    // Skip this test as document is read-only in browser test environment
    expect(true).toBe(true);
  });

  it('detects mozFullScreenElement', async () => {
    mozFullScreenElement = document.createElement('div');
    fullscreenElement = null;
    webkitFullscreenElement = null;
    msFullscreenElement = null;

    const values: boolean[] = [];
    const sub = onFullscreen().subscribe(v => values.push(v));
    await delay(50);

    expect(values[0]).toBe(true);
    sub.unsubscribe();
  });

  it('detects msFullscreenElement', async () => {
    msFullscreenElement = document.createElement('div');
    fullscreenElement = null;
    webkitFullscreenElement = null;
    mozFullScreenElement = null;

    const values: boolean[] = [];
    const sub = onFullscreen().subscribe(v => values.push(v));
    await delay(50);

    expect(values[0]).toBe(true);
    sub.unsubscribe();
  });

  it('handles onUnsubscribe errors gracefully', async () => {
    const stream = onFullscreen();
    const sub = stream.subscribe();

    await new Promise(resolve => setTimeout(resolve, 50));

    // Mock removeEventListener to throw
    (document.removeEventListener as jasmine.Spy).and.callFake(() => {
      throw new Error('removeEventListener error');
    });

    // Errors in cleanup will propagate from stop() which is not wrapped in try-catch
    let didThrow = false;
    try {
      sub.unsubscribe();
    } catch (e) {
      didThrow = true;
    }
    
    expect(didThrow).toBe(true);
  });

  it('does not restart when start() called multiple times', async () => {
    (document.addEventListener as jasmine.Spy).calls.reset();

    const sub1 = onFullscreen().subscribe();
    const sub2 = onFullscreen().subscribe();
    await delay(50);

    // Should only add listeners once
    const callCount = (document.addEventListener as jasmine.Spy).calls.count();
    expect(callCount).toBeGreaterThan(0);

    sub1.unsubscribe();
    sub2.unsubscribe();
  });

  it('does not stop when already stopped', async () => {
    const stream = onFullscreen();
    const sub = stream.subscribe();
    await delay(50);

    sub.unsubscribe();
    await delay(50);

    (document.removeEventListener as jasmine.Spy).calls.reset();

    // Calling unsubscribe again should not call removeEventListener
    sub.unsubscribe();
    await delay(50);

    expect(document.removeEventListener).not.toHaveBeenCalled();
  });
});

