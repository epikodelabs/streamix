import { scheduler } from '@actioncrew/streamix';
import { onBattery } from '@actioncrew/streamix/dom';
import { ndescribe } from './env.spec';

/* -------------------------------------------------- */
/* Helpers                                            */
/* -------------------------------------------------- */

async function flush() {
  await scheduler.flush();
}

/* -------------------------------------------------- */
/* Global patch helper (CRITICAL)                      */
/* -------------------------------------------------- */

function defineGlobal(name: string, value: any) {
  const desc = Object.getOwnPropertyDescriptor(globalThis, name);

  Object.defineProperty(globalThis, name, {
    configurable: true,
    writable: true,
    value,
  });

  return () => {
    if (desc) {
      Object.defineProperty(globalThis, name, desc);
    } else {
      delete (globalThis as any)[name];
    }
  };
}

/* -------------------------------------------------- */
/* Battery mock                                       */
/* -------------------------------------------------- */

type Listener = () => void;

function mockBatteryEnv() {
  let charging = true;
  let level = 0.75;
  let chargingTime = 0;
  let dischargingTime = 3600;

  const listeners = new Map<string, Set<Listener>>();

  const battery = {
    get charging() {
      return charging;
    },
    get level() {
      return level;
    },
    get chargingTime() {
      return chargingTime;
    },
    get dischargingTime() {
      return dischargingTime;
    },

    addEventListener: jasmine
      .createSpy('battery.addEventListener')
      .and.callFake((type: string, cb: Listener) => {
        if (!listeners.has(type)) {
          listeners.set(type, new Set());
        }
        listeners.get(type)!.add(cb);
      }),

    removeEventListener: jasmine
      .createSpy('battery.removeEventListener')
      .and.callFake((type: string, cb: Listener) => {
        listeners.get(type)?.delete(cb);
      }),
  };

  const navigatorMock = {
    getBattery: jasmine.createSpy('navigator.getBattery').and.resolveTo(battery),
  };

  return {
    navigator: navigatorMock,
    battery,

    setCharging(next: boolean) {
      charging = next;
      listeners.get('chargingchange')?.forEach(l => l());
    },

    setLevel(next: number) {
      level = next;
      listeners.get('levelchange')?.forEach(l => l());
    },

    setTimes(nextCharging: number, nextDischarging: number) {
      chargingTime = nextCharging;
      dischargingTime = nextDischarging;
      listeners.get('chargingtimechange')?.forEach(l => l());
      listeners.get('dischargingtimechange')?.forEach(l => l());
    },
  };
}

/* -------------------------------------------------- */
/* Tests                                              */
/* -------------------------------------------------- */

ndescribe('onBattery', () => {
  let restoreNavigator: () => void;

  afterEach(() => {
    restoreNavigator?.();
  });

  /* -------------------------------------------------- */
  /* Basic behavior                                     */
  /* -------------------------------------------------- */

  it('emits initial battery snapshot on subscribe', async () => {
    const env = mockBatteryEnv();
    restoreNavigator = defineGlobal('navigator', env.navigator);

    const values: any[] = [];
    const stream = onBattery();

    const sub = stream.subscribe(v => values.push(v));
    await flush();

    expect(values.length).toBe(1);
    expect(values[0]).toEqual(
      jasmine.objectContaining({
        charging: true,
        level: 0.75,
        chargingTime: 0,
        dischargingTime: 3600,
      })
    );

    sub.unsubscribe();
  });

  /* -------------------------------------------------- */
  /* Battery events                                     */
  /* -------------------------------------------------- */

  it('emits on charging change', async () => {
    const env = mockBatteryEnv();
    restoreNavigator = defineGlobal('navigator', env.navigator);

    const values: any[] = [];
    const stream = onBattery();

    const sub = stream.subscribe(v => values.push(v));
    await flush();

    env.setCharging(false);
    await flush();

    expect(values.map(v => v.charging)).toEqual([true, false]);

    sub.unsubscribe();
  });

  it('emits on level change', async () => {
    const env = mockBatteryEnv();
    restoreNavigator = defineGlobal('navigator', env.navigator);

    const values: any[] = [];
    const stream = onBattery();

    const sub = stream.subscribe(v => values.push(v));
    await flush();

    env.setLevel(0.42);
    await flush();

    expect(values[1]).toEqual(
      jasmine.objectContaining({
        level: 0.42,
      })
    );

    sub.unsubscribe();
  });

  it('emits on charging / discharging time change', async () => {
    const env = mockBatteryEnv();
    restoreNavigator = defineGlobal('navigator', env.navigator);

    const values: any[] = [];
    const stream = onBattery();

    const sub = stream.subscribe(v => values.push(v));
    await flush();

    env.setTimes(120, 1800);
    await flush();

    expect(values[1]).toEqual(
      jasmine.objectContaining({
        chargingTime: 120,
        dischargingTime: 1800,
      })
    );

    sub.unsubscribe();
  });

  /* -------------------------------------------------- */
  /* Listener lifecycle                                 */
  /* -------------------------------------------------- */

  it('adds listeners on start and removes on stop', async () => {
    const env = mockBatteryEnv();
    restoreNavigator = defineGlobal('navigator', env.navigator);

    const stream = onBattery();

    const sub = stream.subscribe();
    await flush();

    expect(env.battery.addEventListener).toHaveBeenCalled();

    sub.unsubscribe();
    await flush();

    expect(env.battery.removeEventListener).toHaveBeenCalled();
  });

  /* -------------------------------------------------- */
  /* Async iteration                                    */
  /* -------------------------------------------------- */

  it('supports async iteration', async () => {
    const env = mockBatteryEnv();
    restoreNavigator = defineGlobal('navigator', env.navigator);

    const stream = onBattery();

    const iter = (async () => {
      const out: any[] = [];
      for await (const v of stream) {
        out.push(v);
        if (out.length === 2) break;
      }
      return out;
    })();

    await flush();

    env.setCharging(false);
    await flush();

    const values = await iter;

    expect(values.map(v => v.charging)).toEqual([true, false]);
  });

  /* -------------------------------------------------- */
  /* SSR safety                                         */
  /* -------------------------------------------------- */

  it('is SSR-safe when navigator is undefined', async () => {
    restoreNavigator = defineGlobal('navigator', undefined);

    const values: any[] = [];
    const stream = onBattery();

    const sub = stream.subscribe(v => values.push(v));
    await flush();

    expect(values).toEqual([]);
    sub.unsubscribe();
  });

  /* -------------------------------------------------- */
  /* Graceful degradation                               */
  /* -------------------------------------------------- */

  it('is silent when Battery API is unavailable', async () => {
    restoreNavigator = defineGlobal('navigator', {});

    const values: any[] = [];
    const stream = onBattery();

    const sub = stream.subscribe(v => values.push(v));
    await flush();

    expect(values).toEqual([]); // no getBattery → no emission
    sub.unsubscribe();
  });
});
