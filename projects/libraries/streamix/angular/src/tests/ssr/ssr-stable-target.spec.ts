import ts from 'typescript';
import { Component, type AfterViewInit, type ApplicationRef } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { provideServerRendering, renderApplication } from '@angular/platform-server';
import { atom, scope, waitForDisposal } from '@epikodelabs/streamix';
import { transformAngularComponentTemplate } from '../../../compiler/src/build-transform';
import { createBindingTable, ɵinstallSxCompiledView, ɵsxFindTarget, ɵsxProperty } from '../../lib';

describe('stable Streamix targets during server rendering', () => {
  it('can await owned cleanup after Angular tears down the server application', async () => {
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    let app!: ApplicationRef;
    class ServerOwner {
      readonly state = scope({});
      readonly handle = ɵinstallSxCompiledView(this, undefined, { ownedScopes: () => [this.state] });

      constructor() {
        this.state.cleanups.add(async () => { started.resolve(); await release.promise; });
      }
    }
    Component({ selector: 'sx-ssr-owner', standalone: true, template: '<p>ready</p>' })(ServerOwner);
    const html = await renderApplication(
      async context => {
        app = await bootstrapApplication(ServerOwner, { providers: [provideServerRendering()] }, context);
        return app;
      },
      { document: '<sx-ssr-owner></sx-ssr-owner>', url: 'http://localhost/', allowedHosts: ['localhost'] },
    );
    expect(html).toContain('<p>ready</p>');
    const completion = waitForDisposal(app);
    let done = false;
    void completion.then(() => { done = true; });
    await started.promise;
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    expect(done).toBeFalse();
    release.resolve();
    await completion;
    expect(done).toBeTrue();
  });

  it('mounts emitted bindings after Angular-owned dynamic siblings in Domino', async () => {
    const compiled = transformAngularComponentTemplate(
      '<section>@if (show) { <aside><input data-sx-node="node1" value="nested"></aside> }' +
      '@for (item of items; track item) { <span>{{ item }}</span> }' +
      '<input id="target" [value]="message.value"></section>',
      'stable-target.html',
      { resolveReactiveSource: path => path === 'message' ? path : undefined },
    );
    expect(compiled.setup).toContain('ɵsxFindTarget(host, ["node0","node1"])');
    const javascript = ts.transpileModule(compiled.setup, {
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const setup = new Function('createBindingTable', 'ɵsxFindTarget', 'ɵsxProperty',
      javascript + '\nreturn ɵsetupSxBindings;')(createBindingTable, ɵsxFindTarget, ɵsxProperty);
    let mounts = 0;
    class StableTarget implements AfterViewInit {
      readonly show = true;
      readonly items = ['first', 'second'];
      readonly message = atom('hello');
      readonly ɵsx = ɵinstallSxCompiledView(this, (host, ctx, server) => {
        mounts++;
        return setup(host, ctx, server);
      });

      ngAfterViewInit(): void { this.ɵsx.ɵafterViewInit(); }
    }
    Component({ selector: 'sx-ssr-target', standalone: true, template: compiled.template })(StableTarget);

    const html = await renderApplication(
      context => bootstrapApplication(StableTarget, { providers: [provideServerRendering()] }, context),
      { document: '<sx-ssr-target></sx-ssr-target>', url: 'http://localhost/', allowedHosts: ['localhost'] },
    );
    expect(mounts).toBe(1);
    expect(html).toContain('value="nested"');
    expect(html).toMatch(/<input[^>]*id="target"[^>]*value="hello"/);
    expect(html).toContain('second');
  });
});
