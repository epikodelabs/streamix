import { scheduler } from '@epikode/streamix';
import { onBattery } from '@epikode/streamix/dom';
import { idescribe } from './env.spec';

/* -------------------------------------------------- */
/* Helpers                                            */
/* -------------------------------------------------- */

async function flush() {
  await scheduler.flush();
}

/* -------------------------------------------------- */
/* Safe navigator patch (browser-compatible)          */
/* -------------------------------------------------- */

function patchGetBattery(value: any) {
  const nav = navigator as any;
  const desc = Object.getOwnPropertyDescriptor(nav, 'getBattery');

  Object.defineProperty(nav, 'getBattery', {
    configurable: true,
    writable: true,
    value,
  });

  return () => {
    if (desc) {
      Object.defineProperty(nav, 'getBattery', desc);
    } else {
      delete nav.getBattery;
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

  return {
    battery,

    getBattery: jasmine
      .createSpy('navigator.getBattery')
      .and.resolveTo(battery),

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

idescribe('onBattery', () => {
  let restore: (() => void) | undefined;

  afterEach(() => {
    restore?.();
    restore = undefined;
  });

  it('emits initial battery snapshot on subscribe', async () => {
    const env = mockBatteryEnv();
    restore = patchGetBattery(env.getBattery);

    const values: any[] = [];
    const sub = onBattery().subscribe(v => values.push(v));
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

  it('emits on charging change', async () => {
    const env = mockBatteryEnv();
    restore = patchGetBattery(env.getBattery);

    const values: any[] = [];
    const sub = onBattery().subscribe(v => values.push(v));
    await flush();

    env.setCharging(false);
    await flush();

    expect(values.map(v => v.charging)).toEqual([true, false]);
    sub.unsubscribe();
  });

  it('emits on level change', async () => {
    const env = mockBatteryEnv();
    restore = patchGetBattery(env.getBattery);

    const values: any[] = [];
    const sub = onBattery().subscribe(v => values.push(v));
    await flush();

    env.setLevel(0.42);
    await flush();

    expect(values[1].level).toBe(0.42);
    sub.unsubscribe();
  });

  it('adds listeners on start and removes on stop', async () => {
    const env = mockBatteryEnv();
    restore = patchGetBattery(env.getBattery);

    const sub = onBattery().subscribe();
    await flush();

    expect(env.battery.addEventListener).toHaveBeenCalled();

    sub.unsubscribe();
    await flush();

    expect(env.battery.removeEventListener).toHaveBeenCalled();
  });

  it('supports async iteration', async () => {
    const env = mockBatteryEnv();
    restore = patchGetBattery(env.getBattery);

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

  it('is silent when Battery API is unavailable', async () => {
    restore = patchGetBattery(undefined);

    const values: any[] = [];
    const sub = onBattery().subscribe(v => values.push(v));
    await flush();

    expect(values).toEqual([]);
    sub.unsubscribe();
  });
});

