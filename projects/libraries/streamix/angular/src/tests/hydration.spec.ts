import { provideClientHydration } from '@angular/platform-browser';
import { bootstrapApplication } from '@angular/platform-browser';

import { rendererScheduler } from '../lib/render-scheduler';
import { SSR_FIXTURE_HTML } from './ssr/ssr-html';
import { SsrFixtureComponent } from './ssr/ssr-fixture';

import { idescribe } from '../../../src/tests/env.spec';

/**
 * The server renders empty block markers, the Angular-owned fallbacks for
 * every direct binding, and the `ng-state` script that enables DOM reuse on
 * the client. This suite boots the client over exactly that document and
 * asserts both halves: Angular reuses the server nodes, and the compiled view
 * then takes the markers over.
 */
idescribe('compiled view hydration', () => {
  // The DOM is removed inside the spec with `remove()` calls: clearing it with
  // `innerHTML` while Angular's hydration runtime is enabled makes testify
  // report an unrelated global TypeError from its page teardown.
  afterEach(() => {
    rendererScheduler.flushNow();
  });

  it('hydrates server HTML and takes the blocks over', async () => {
    const errors = spyOn(console, 'error');
    const warnings: string[] = [];
    spyOn(console, 'warn').and.callFake((...args: unknown[]) => {
      warnings.push(args.join(' '));
    });

    // The fixture is the full server document. Its body is reproduced node by
    // node instead of assigning `innerHTML`: a parser-created host element
    // makes testify's page teardown fail with an unrelated TypeError, so the
    // host is created and carries the server's annotations and children.
    const parsed = new DOMParser().parseFromString(
      SSR_FIXTURE_HTML,
      'text/html',
    );
    const serverHost = parsed.querySelector('sx-ssr-fixture') as HTMLElement;
    const serverState = parsed.querySelector('script') as HTMLScriptElement;

    const host = document.createElement('sx-ssr-fixture');
    for (const attribute of Array.from(serverHost.attributes)) {
      host.setAttribute(attribute.name, attribute.value);
    }
    host.innerHTML = serverHost.innerHTML;

    const state = document.createElement('script');
    for (const attribute of Array.from(serverState.attributes)) {
      state.setAttribute(attribute.name, attribute.value);
    }
    state.textContent = serverState.textContent;

    document.body.appendChild(document.adoptNode(parsed.body.firstChild!));
    document.body.appendChild(host);
    document.body.appendChild(state);

    // Server shape: the marker is present and empty, the fallbacks rendered.
    expect(host.querySelector('span[data-sx-block="0"]')).not.toBeNull();
    expect(host.querySelector('input')?.value).toBe('hello');

    const serverInput = host.querySelector('input') as HTMLInputElement;

    const appRef = await bootstrapApplication(SsrFixtureComponent, {
      providers: [provideClientHydration()],
    });
    await appRef.whenStable();

    // NG05xx mismatches land on console.error, NG0505 ("hydration was
    // requested, but there was no server-rendered context") on console.warn.
    expect(errors).not.toHaveBeenCalled();
    expect(warnings.filter(line => line.includes('NG05'))).toEqual([]);

    // Angular reused the node the server rendered — DOM reuse is on.
    expect(host.querySelector('input')).toBe(serverInput);

    // The compiled takeover then replaced the marker with a comment anchor and
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

    expect(host.querySelector('strong')?.textContent).toBe('world');
    expect(serverInput.value).toBe('world');
    expect(
      [...host.querySelectorAll('li')].map(node => node.textContent),
    ).toEqual(['3']);

    // The compiled listener is the only one on the button.
    (host.querySelector('button') as HTMLButtonElement).click();
    expect(instance.clicks).toBe(1);

    // DOM -> atom through the compiled two-way listener.
    serverInput.value = 'typed';
    serverInput.dispatchEvent(new Event('input'));

    expect(instance.message.value).toBe('typed');

    appRef.destroy();
    host.remove();
    state.remove();
    await new Promise(resolve => setTimeout(resolve, 0));
  });
});
