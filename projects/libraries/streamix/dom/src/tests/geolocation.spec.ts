import { on, type GeolocationState } from '@epikodelabs/streamix/dom';

const flush = () => new Promise<void>(resolve => setTimeout(resolve, 0));

describe('geolocation stream', () => {
  let restore: () => void;
  let success: PositionCallback;
  let failure: PositionErrorCallback;
  let watch: jasmine.Spy;
  let clear: jasmine.Spy;
  const position = {
    coords: { latitude: 50.45, longitude: 30.52, accuracy: 10 },
    timestamp: 123,
  } as GeolocationPosition;
  const error = { code: 1, message: 'Permission denied' } as GeolocationPositionError;

  beforeEach(() => {
    const original = Object.getOwnPropertyDescriptor(navigator, 'geolocation');
    watch = jasmine.createSpy('watchPosition').and.callFake((next: PositionCallback, fail: PositionErrorCallback) => {
      success = next;
      failure = fail;
      return 0; // Zero is a valid watch ID and must be cleaned up.
    });
    clear = jasmine.createSpy('clearWatch');
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true, value: { watchPosition: watch, clearWatch: clear },
    });
    restore = () => {
      if (original) Object.defineProperty(navigator, 'geolocation', original);
      else Reflect.deleteProperty(navigator, 'geolocation');
    };
  });

  afterEach(() => restore());

  it('starts one lazy watch with native options and clears it after the final consumer', async () => {
    const options = { enableHighAccuracy: true, timeout: 2000, maximumAge: 1000 };
    const locations = on('geolocation', options);
    expect(watch).not.toHaveBeenCalled();
    const values: GeolocationState[] = [];
    const stop1 = locations.subscribe(value => values.push(value));
    const stop2 = locations.subscribe();
    expect(watch).toHaveBeenCalledOnceWith(jasmine.any(Function), jasmine.any(Function), options);
    expect(values).toEqual([]);
    success(position);
    await flush();
    expect(values).toEqual([{ position, error: null }]);
    stop1();
    expect(clear).not.toHaveBeenCalled();
    stop2();
    expect(clear).toHaveBeenCalledOnceWith(0);
    locations.dispose();
    expect(clear.calls.count()).toBe(1);
  });

  it('emits permission errors as state and allows subsequent successful fixes', async () => {
    const locations = on('geolocation');
    const values: GeolocationState[] = [];
    const stop = locations.subscribe(value => values.push(value));
    failure(error);
    await flush();
    success(position);
    await flush();
    expect(values).toEqual([{ position: null, error }, { position, error: null }]);
    stop();
    locations.dispose();
  });

  it('ignores callbacks after unsubscription and opens a fresh watch on reconnection', async () => {
    const locations = on('geolocation');
    const values: GeolocationState[] = [];
    const stop1 = locations.subscribe(value => values.push(value));
    const oldSuccess = success;
    const oldFailure = failure;
    stop1();
    const stop2 = locations.subscribe(value => values.push(value));
    oldSuccess(position);
    oldFailure(error);
    await flush();
    expect(values).toEqual([]);
    expect(watch.calls.count()).toBe(2);
    success(position);
    await flush();
    expect(values).toEqual([{ position, error: null }]);
    stop2();
    locations.dispose();
  });

  it('clears the watch on disposal even with active subscribers', () => {
    const locations = on('geolocation');
    const stop = locations.subscribe();
    locations.dispose();
    stop();
    expect(clear).toHaveBeenCalledOnceWith(0);
  });

  it('supports async iteration and clears the watch when the iterator returns', async () => {
    const locations = on('geolocation');
    const iterator = locations[Symbol.asyncIterator]();
    const next = iterator.next();
    success(position);
    expect((await next).value).toEqual({ position, error: null });
    await iterator.return?.();
    expect(clear).toHaveBeenCalledOnceWith(0);
    locations.dispose();
  });

  it('stays silent when geolocation is unsupported', async () => {
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: undefined });
    const locations = on('geolocation');
    const callback = jasmine.createSpy('location');
    const stop = locations.subscribe(callback);
    await flush();
    expect(callback).not.toHaveBeenCalled();
    stop();
    locations.dispose();
  });

  it('reports synchronous API failures through the atom error channel', () => {
    watch.and.throwError('Location blocked');
    const locations = on('geolocation');
    const report = jasmine.createSpy('error');
    locations.onError(report);
    const stop = locations.subscribe();
    expect(report).toHaveBeenCalledWith(jasmine.any(Error));
    expect(locations.error?.message).toBe('Location blocked');
    stop();
    locations.dispose();
  });
});
