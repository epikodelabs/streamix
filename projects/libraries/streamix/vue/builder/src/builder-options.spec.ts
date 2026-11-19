import { shouldWatchSources, stripStreamixVuePlugins } from './options';

describe('Streamix Vue builder options', () => {
  it('watches serve and dev-server but not one-shot build targets', () => {
    expect(shouldWatchSources('application', 'build', undefined)).toBeFalse();
    expect(shouldWatchSources('application', 'build', true)).toBeTrue();
    expect(shouldWatchSources('dev-server', undefined, undefined)).toBeTrue();
    expect(shouldWatchSources('application', 'serve', undefined)).toBeTrue();
  });

  it('strips authored sxVue plugins from the delegate config', () => {
    const sxVue = { name: 'streamix-vue' };
    const vue = { name: 'vite:vue' };
    const other = { name: 'custom-plugin' };

    const result = stripStreamixVuePlugins([[sxVue, { apply: 'build' }], false, vue, other]);

    expect(result.removed).toBe(1);
    expect(result.plugins).toEqual([{ apply: 'build' }, vue, other]);
  });

  it('leaves configs without sxVue untouched', () => {
    const vue = { name: 'vite:vue' };
    const result = stripStreamixVuePlugins([vue, null]);

    expect(result.removed).toBe(0);
    expect(result.plugins).toEqual([vue]);
  });
});
