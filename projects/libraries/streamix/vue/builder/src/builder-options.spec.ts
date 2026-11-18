import { shouldWatchSources } from './options';

describe('Streamix Vue builder options', () => {
  it('watches serve and dev-server but not one-shot build targets', () => {
    expect(shouldWatchSources('application', 'build', undefined)).toBeFalse();
    expect(shouldWatchSources('application', 'build', true)).toBeTrue();
    expect(shouldWatchSources('dev-server', undefined, undefined)).toBeTrue();
    expect(shouldWatchSources('application', 'serve', undefined)).toBeTrue();
  });
});
