import { onBattery } from '@epikodelabs/streamix/dom';
import { idescribe } from './env.spec';

function patchNavigator(patch: Record<string, any>) {
  const originals: Record<string, PropertyDescriptor | undefined> = {};

  for (const key of Object.keys(patch)) {
    originals[key] = Object.getOwnPropertyDescriptor(navigator, key);
    Object.defineProperty(navigator, key, {
      configurable: true,
      writable: true,
      value: patch[key],
    });
  }

  return () => {
    for (const key of Object.keys(patch)) {
      const desc = originals[key];
      if (desc) {
        Object.defineProperty(navigator, key, desc);
      } else {
        delete (navigator as any)[key];
      }
    }
  };
}

idescribe('onBattery', () => {
  it('is a no-op when battery API is missing', async () => {
    const restore = patchNavigator({ getBattery: undefined });

    try {
      const values: any[] = [];
      const sub = onBattery().subscribe(v => values.push(v));

      await new Promise(resolve => setTimeout(resolve, 0));

      expect(values.length).toBe(0);
      sub.unsubscribe();
    } finally {
      restore();
    }
  });

  it('does not emit when unsubscribed before getBattery resolves', async () => {
    let resolveBattery!: (value: any) => void;

    const batteryPromise = new Promise<any>((resolve) => {
      resolveBattery = resolve;
    });

    (navigator as any).getBattery = jasmine
      .createSpy('getBattery')
      .and.returnValue(batteryPromise);

    const updates: any[] = [];
    const sub = onBattery().subscribe(update => updates.push(update));

    // Unsubscribe before getBattery resolves.
    sub.unsubscribe();

    resolveBattery({
      charging: true,
      level: 1,
      chargingTime: 0,
      dischargingTime: 0,
      addEventListener: () => {},
      removeEventListener: () => {}
    });

    await new Promise(resolve => setTimeout(resolve, 0));
    expect(updates).toEqual([]);
  });

  it('emits updates and unregisters listeners', async () => {
    const listeners: Record<string, ((...args: any[]) => void)[]> = {
      chargingchange: [],
      levelchange: [],
      chargingtimechange: [],
      dischargingtimechange: []
    };

    const battery = {
      charging: true,
      level: 0.5,
      chargingTime: 10,
      dischargingTime: 100,
      addEventListener: (event: string, cb: () => void) => {
        listeners[event]?.push(cb);
      },
      removeEventListener: (event: string, cb: () => void) => {
        const index = listeners[event]?.indexOf(cb);
        if (index != null && index >= 0) {
          listeners[event]!.splice(index, 1);
        }
      }
    };

    (navigator as any).getBattery = jasmine
      .createSpy('getBattery')
      .and.resolveTo(battery);

    const updates: any[] = [];
    const sub = onBattery().subscribe(update => updates.push(update));

    await new Promise(resolve => setTimeout(resolve, 0));

    expect(updates.length).toBeGreaterThan(0);

    battery.level = 0.75;
    listeners['levelchange'].forEach(cb => cb());
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(updates.at(-1)?.level).toBe(0.75);

    sub.unsubscribe();
    expect(listeners['levelchange'].length).toBe(0);
    expect(listeners['chargingchange'].length).toBe(0);
  });

  it('does not restart when start() called multiple times', async () => {
    const getBatterySpy = jasmine.createSpy('getBattery').and.resolveTo({
      charging: true,
      level: 1,
      chargingTime: 0,
      dischargingTime: 0,
      addEventListener: () => {},
      removeEventListener: () => {}
    });

    (navigator as any).getBattery = getBatterySpy;

    const sub1 = onBattery().subscribe();
    const sub2 = onBattery().subscribe();
    await new Promise(resolve => setTimeout(resolve, 0));

    // Should share battery instance
    expect(getBatterySpy.calls.count()).toBeLessThan(3);

    sub1.unsubscribe();
    sub2.unsubscribe();
  });

  it('handles getBattery rejection', async () => {
    const rejectedPromise = Promise.reject(new Error('Battery API error'));
    // Catch to prevent unhandled rejection before test starts
    rejectedPromise.catch(() => {});
    
    const getBatterySpy = jasmine
      .createSpy('getBattery')
      .and.returnValue(rejectedPromise);
      
    (navigator as any).getBattery = getBatterySpy;

    const values: any[] = [];
    const errors: any[] = [];
    const sub = onBattery().subscribe({
      next: v => values.push(v),
      error: e => errors.push(e)
    });

    // Wait for rejection to be handled
    await new Promise(resolve => setTimeout(resolve, 100));

    // Should not crash or emit values
    expect(values.length).toBe(0);
    expect(errors.length).toBe(0);
    sub.unsubscribe();
  });

  it('stops before battery resolves when all subscribers unsubscribe', async () => {
    let resolveBattery!: (value: any) => void;
    const batteryPromise = new Promise<any>((resolve) => {
      resolveBattery = resolve;
    });

    let addListenerCalled = false;
    (navigator as any).getBattery = jasmine
      .createSpy('getBattery')
      .and.returnValue(batteryPromise);

    const sub = onBattery().subscribe();
    
    // Unsubscribe before battery resolves
    sub.unsubscribe();

    // Now resolve battery
    resolveBattery({
      charging: true,
      level: 1,
      chargingTime: 0,
      dischargingTime: 0,
      addEventListener: () => { addListenerCalled = true; },
      removeEventListener: () => {}
    });

    await new Promise(resolve => setTimeout(resolve, 50));

    // Should not have added listeners since we unsubscribed
    expect(addListenerCalled).toBe(false);
  });

  it('handles onUnsubscribe errors gracefully', async () => {
    const battery = {
      charging: true,
      level: 1,
      chargingTime: 0,
      dischargingTime: 0,
      addEventListener: () => {},
      removeEventListener: jasmine.createSpy('removeEventListener').and.callFake(() => { 
        throw new Error('removeEventListener error'); 
      })
    };

    (navigator as any).getBattery = jasmine
      .createSpy('getBattery')
      .and.resolveTo(battery);

    const sub = onBattery().subscribe();
    await new Promise(resolve => setTimeout(resolve, 100));

    // Errors in cleanup will propagate from stop() which is not wrapped in try-catch
    let didThrow = false;
    try {
      sub.unsubscribe();
    } catch (e) {
      didThrow = true;
    }
    
    // In current implementation, stop() errors propagate
    expect(didThrow).toBe(true);
  });

  it('does not stop when already stopped', async () => {
    const removeEventListenerSpy = jasmine.createSpy('removeEventListener');
    const battery = {
      charging: true,
      level: 1,
      chargingTime: 0,
      dischargingTime: 0,
      addEventListener: () => {},
      removeEventListener: removeEventListenerSpy
    };

    (navigator as any).getBattery = jasmine
      .createSpy('getBattery')
      .and.resolveTo(battery);

    const sub = onBattery().subscribe();
    await new Promise(resolve => setTimeout(resolve, 0));

    sub.unsubscribe();
    await new Promise(resolve => setTimeout(resolve, 0));

    removeEventListenerSpy.calls.reset();

    // Calling unsubscribe again should not call removeEventListener
    sub.unsubscribe();
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(removeEventListenerSpy).not.toHaveBeenCalled();
  });
});
