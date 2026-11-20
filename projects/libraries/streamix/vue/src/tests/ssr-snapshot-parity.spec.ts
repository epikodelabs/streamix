import { atom, flow } from '@epikodelabs/streamix';
import * as react from '../../../react/src/lib/runtime';
import * as vue from '../lib/ssr-snapshot';

describe('React and Vue SSR snapshot parity', () => {
  for (const [framework, adapter] of Object.entries({ react, vue })) {
    it(`round-trips final emissions of completed and disposed flows in ${framework}`, async () => {
      const status = flow(async function* () { yield 'loading'; yield 'done'; });
      const explicit = flow<undefined>(async function* () { yield undefined; });
      const empty = flow<never>(async function* () {});
      const failed = atom('stale');
      const targetStatus = atom<string>();
      const targetExplicit = atom<undefined>();
      const sources = { status, explicit, empty, failed };

      const collect = async (source: AsyncIterable<unknown>) => {
        for await (const _ of source) { /* Wait for completion. */ }
      };
      try {
        await Promise.all([collect(status), collect(explicit), collect(empty)]);
        failed.fail(new Error('failed'));
        expect(adapter.createAtomSnapshot(sources)).toEqual({ status: 'done', explicit: undefined });

        for (const source of Object.values(sources)) source.dispose();
        expect(Object.values(sources).every(source => source.disposed)).toBeTrue();
        const script = adapter.renderAtomSnapshotScript(sources);
        expect(script).toContain('<script id="__streamix_snapshot" type="application/json">');
        const payload = adapter.parseAtomSnapshot(script.slice(script.indexOf('>') + 1, script.lastIndexOf('</script>')));
        expect(Object.keys(payload.atoms)).toEqual(['status', 'explicit']);
        adapter.hydrateAtomPayload({ status: targetStatus, explicit: targetExplicit }, payload);
        expect(targetStatus.value).toBe('done');
        expect(targetExplicit.value).toBeUndefined();
      } finally {
        for (const source of Object.values(sources)) source.dispose();
        targetStatus.dispose();
        targetExplicit.dispose();
      }
    });
  }
});
