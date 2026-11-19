import * as domPackage from '@epikodelabs/streamix/dom';

/**
 * The dom package deliberately exposes a single public entry point: the `on`
 * dispatcher (documented in docs/DOM.md). Individual factory modules such as
 * `intersection` are implementation details of that dispatcher and must not
 * leak into the package surface.
 */
describe('dom package public surface', () => {
  it('exposes the on dispatcher as the single entry point', () => {
    expect(Object.keys(domPackage).sort()).toEqual(['on']);
    expect(typeof domPackage.on).toBe('function');
  });
});
