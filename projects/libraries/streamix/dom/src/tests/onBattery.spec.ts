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
});
