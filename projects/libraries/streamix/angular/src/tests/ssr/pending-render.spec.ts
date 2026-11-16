import '@angular/compiler';
import { Component } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { provideServerRendering, renderApplication } from '@angular/platform-server';
import { atom } from '@epikodelabs/streamix';
import { ɵsxNoInitialValue } from '../../lib/view-value';
import { transformAngularComponentTemplate } from '../../../compiler/src/build-transform';

describe('Angular pending SSR markup', () => {
  it('renders generated interpolation and native-binding fallbacks without a sentinel', async () => {
    const compiled = transformAngularComponentTemplate(
      '<output>{{ count.value + "!" }}</output><button [disabled]="count.value">Run</button>',
      'pending.html',
      { resolveReactiveSource: path => path === 'count' ? 'count' : undefined },
    );
    class PendingFixture {
      readonly count = atom<string>();
      readonly __sxNoInitialValue = ɵsxNoInitialValue;
    }
    Component({ selector: 'sx-pending', standalone: true, template: compiled.template })(PendingFixture);
    const html = await renderApplication(context => bootstrapApplication(PendingFixture, {
      providers: [provideServerRendering()],
    }, context), {
      document: '<sx-pending></sx-pending>',
      url: 'http://localhost/',
      allowedHosts: ['localhost'],
    });
    expect(html).toContain('<output></output>');
    expect(html).not.toContain('disabled="');
    expect(html).not.toContain('streamix.noInitialValue');
  });
});
