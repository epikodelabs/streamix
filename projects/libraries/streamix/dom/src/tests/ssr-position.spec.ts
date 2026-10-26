import { on } from '@epikodelabs/streamix/dom';
import { ndescribe } from './env.spec';

const flush = () => new Promise<void>(resolve => setTimeout(resolve, 0));

// Node-only: this suite needs an environment without `window`, which the
// browser runner cannot provide. It runs through the testify.infra.json
// configuration (`npm run test:infra`).
ndescribe('SSR position streams', () => {
  it('stays silent without a window and disposes safely', async () => {
    for (const source of [on('pointer'), on('scroll')]) {
      const callback = jasmine.createSpy('position');
      const stop = source.subscribe(callback);
      await flush();
      expect(callback).not.toHaveBeenCalled();
      stop();
      expect(() => source.dispose()).not.toThrow();
    }
  });
});
