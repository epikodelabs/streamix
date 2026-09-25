import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { atom } from '@epikodelabs/streamix';

import { useAngularTestEnvironment } from './angular-test-environment';
import { idescribe } from '../../../src/tests/env.spec';
import { SxTextDirective } from '../lib/sx-text.directive';

idescribe('SxTextDirective', () => {
  useAngularTestEnvironment();
  @Component({
    standalone: true,
    imports: [SxTextDirective],
    template: '<span [sx.text]="count"></span>',
  })
  class HostComponent {
    readonly count = atom(1);
  }

  it('renders the source value immediately', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('span').textContent).toBe('1');
  });

  it('does not require another Angular change-detection pass for source emissions', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();

    fixture.componentInstance.count.set(2);

    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    // Deliberately no fixture.detectChanges().
    expect(fixture.nativeElement.querySelector('span').textContent).toBe('2');
  });

  it('unsubscribes on destroy', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();

    const source = fixture.componentInstance.count;
    expect(source.subscriberCount).toBe(1);

    fixture.destroy();

    expect(source.subscriberCount).toBe(0);
  });
});
