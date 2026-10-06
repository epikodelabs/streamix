import { provideClientHydration } from '@angular/platform-browser';
import { bootstrapApplication } from '@angular/platform-browser';

import { rendererScheduler } from '../lib/render-scheduler';
import { SSR_FIXTURE_HTML } from './ssr/ssr-html';
import { SsrFixtureComponent } from './ssr/ssr-fixture';

import { idescribe } from '../../../src/tests/env.spec';

/**
 * The server ships empty block markers plus the Angular-owned fallbacks for
 * every direct binding. This suite boots the client over exactly that markup
 * and asserts the compiled takeover: the markers are replaced, the content is
 * rendered, listeners are attached once, and updates flow without change
 * detection.
 *
 * Angular's own DOM reuse additionally needs the `ng-state` handshake from a
 * full SSR build; this fixture deliberately exercises the takeover against
 * server-shaped markup instead. Bootstrapping over pre-existing markup also
 * makes testify report a teardown TypeError from Angular's own destroy pass —
 * it reproduces with a plain component and no Streamix code, and does not fail
 * the suite.
 */
idescribe('compiled view over server HTML', () => {
  afterEach(() => {
    rendererScheduler.flushNow();
  });

  it('takes over server markup and updates without change detection', async () => {
    // The fixture is the full server document; its body carries the markup the
    // client boots over.
    const parsed = new DOMParser().parseFromString(
      SSR_FIXTURE_HTML,
      'text/html',
    );
    // The `ngh`/`ng-server-context` annotations belong to Angular's DOM-reuse
    // handshake, which needs the serialized `ng-state` script; this fixture
    // ships the markup only, and the takeover contract is about that markup.
    document.body.innerHTML = parsed.body.innerHTML
      .replace(/<!--nghm-->/g, '')
      .replace(/ ngh="\d+"| ng-server-context="[^"]*"| ng-version="[^"]*"/g, '');

    const host = document.querySelector('sx-ssr-fixture') as HTMLElement;

    expect(host.querySelector('span[data-sx-block="0"]')).not.toBeNull();
    expect(host.querySelector('input')?.value).toBe('hello');

    const appRef = await bootstrapApplication(SsrFixtureComponent, {
      providers: [provideClientHydration()],
    });
    await appRef.whenStable();

    // The compiled takeover replaced the marker with a comment anchor and
    // rendered the block content itself.
    expect(host.querySelector('span[data-sx-block="0"]')).toBeNull();
    expect(host.querySelector('strong')?.textContent).toBe('hello');
    expect(
      [...host.querySelectorAll('li')].map(node => node.textContent),
    ).toEqual(['1', '2']);

    const instance = appRef.components[0].instance as SsrFixtureComponent;

    // Atom -> DOM without change detection.
    instance.message.set('world');
    instance.rows.set([{ id: 3 }]);
    rendererScheduler.flushNow();

    const input = host.querySelector('input') as HTMLInputElement;

    expect(host.querySelector('strong')?.textContent).toBe('world');
    expect(input.value).toBe('world');
    expect(
      [...host.querySelectorAll('li')].map(node => node.textContent),
    ).toEqual(['3']);

    // The compiled listener is the only one on the button.
    (host.querySelector('button') as HTMLButtonElement).click();
    expect(instance.clicks).toBe(1);

    // DOM -> atom through the compiled two-way listener.
    input.value = 'typed';
    input.dispatchEvent(new Event('input'));

    expect(instance.message.value).toBe('typed');

    appRef.destroy();
    await appRef.whenStable();
  });
});
