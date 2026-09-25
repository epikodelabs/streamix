import {
  ChangeDetectionStrategy,
  Component,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { atom } from '@epikodelabs/streamix';

import {
  rendererScheduler,
} from '../lib/render-scheduler';
import {
  ɵinstallSxSourceReferences,
} from '../lib/source-reference';
import { SxDirective } from '../lib/sx.directive';

import { useAngularTestEnvironment } from './angular-test-environment';

describe('SxDirective', () => {
  useAngularTestEnvironment();
  it('accepts Angular empty structural marker for collection microsyntax', () => {
    const marker: SxDirective<{ id: number }>['sx'] = '';
    expect(marker).toBe('');
  });

  afterEach(() => {
    rendererScheduler.flushNow();
  });

  it('renders synchronously and reacts without a parent Angular check', () => {
    @Component({
      standalone: true,
      imports: [SxDirective],
      changeDetection: ChangeDetectionStrategy.OnPush,
      template: '<span *sx="count as value">{{ value }}</span>',
    })
    class HostComponent {
      readonly count = atom(1);
    }

    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent.trim()).toBe('1');

    fixture.componentInstance.count.set(2);
    fixture.componentInstance.count.set(3);
    rendererScheduler.flushNow();

    expect(fixture.nativeElement.textContent.trim()).toBe('3');
  });

  it('clears a scalar view on undefined and recreates it later', () => {
    @Component({
      standalone: true,
      imports: [SxDirective],
      template: '<span *sx="value as current">{{ current }}</span>',
    })
    class HostComponent {
      readonly value = atom<number | undefined>(1);
    }

    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();

    fixture.componentInstance.value.set(undefined);
    rendererScheduler.flushNow();
    expect(fixture.nativeElement.querySelector('span')).toBeNull();

    fixture.componentInstance.value.set(4);
    rendererScheduler.flushNow();
    expect(fixture.nativeElement.textContent.trim()).toBe('4');
  });

  it('unsubscribes a replaced source and ignores stale pending emissions', () => {
    @Component({
      standalone: true,
      imports: [SxDirective],
      changeDetection: ChangeDetectionStrategy.OnPush,
      template: `
        <span *sx="source as value; sourceRef: __sxRefs.source">{{ value }}</span>
      `,
    })
    class HostComponent {
      source = atom('first');
      readonly replacement = atom('second');
      readonly __sxRefs = ɵinstallSxSourceReferences(this, ['source']);
    }

    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();

    const first = fixture.componentInstance.source;
    const second = fixture.componentInstance.replacement;

    first.set('stale');

    // This is the compiler-generated source-reference path: a plain field
    // assignment notifies sx directly. No signal, ChangeDetectorRef, event, or
    // Angular change-detection pass participates in the rebind.
    fixture.componentInstance.source = second;

    expect(fixture.nativeElement.querySelector('span').textContent.trim()).toBe('second');
    expect(first.subscriberCount).toBe(0);
    expect(second.subscriberCount).toBe(1);

    rendererScheduler.flushNow();
    expect(fixture.nativeElement.querySelector('span').textContent.trim()).toBe('second');

    first.set('ignored');
    rendererScheduler.flushNow();
    expect(fixture.nativeElement.querySelector('span').textContent.trim()).toBe('second');
  });

  it('reuses keyed collection views across reorder and updates context', () => {
    @Component({
      standalone: true,
      imports: [SxDirective],
      template: `
        <span *sx="let item of items; trackBy: trackItem; let i = index">
          {{ item.name }}:{{ i }}
        </span>
      `,
    })
    class HostComponent {
      readonly items = atom([
        { id: 1, name: 'one' },
        { id: 2, name: 'two' },
      ]);

      readonly trackItem = (_index: number, item: { id: number }) => item.id;
    }

    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();

    const before = Array.from(
      fixture.nativeElement.querySelectorAll('span') as NodeListOf<HTMLSpanElement>,
    );

    fixture.componentInstance.items.set([
      { id: 2, name: 'TWO' },
      { id: 1, name: 'ONE' },
    ]);
    rendererScheduler.flushNow();

    const after = Array.from(
      fixture.nativeElement.querySelectorAll('span') as NodeListOf<HTMLSpanElement>,
    );

    expect(after[0]).toBe(before[1]);
    expect(after[1]).toBe(before[0]);
    expect(after.map(node => node.textContent?.replace(/\s+/g, ' ').trim()))
      .toEqual(['TWO:0', 'ONE:1']);
  });

  it('rejects duplicate collection keys before mutating the view set', () => {
    @Component({
      standalone: true,
      imports: [SxDirective],
      template: `
        <span *sx="let item of items; trackBy: trackItem">{{ item.name }}</span>
      `,
    })
    class HostComponent {
      readonly items = atom([
        { id: 1, name: 'one' },
        { id: 1, name: 'duplicate' },
      ]);

      readonly trackItem = (_index: number, item: { id: number }) => item.id;
    }

    const fixture = TestBed.createComponent(HostComponent);

    expect(() => fixture.detectChanges())
      .toThrowError(/duplicate sx collection key/i);
  });

  it('releases the source subscription when the host is destroyed', () => {
    @Component({
      standalone: true,
      imports: [SxDirective],
      template: '<span *sx="count as value">{{ value }}</span>',
    })
    class HostComponent {
      readonly count = atom(1);
    }

    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();

    expect(fixture.componentInstance.count.subscriberCount).toBe(1);

    fixture.destroy();

    expect(fixture.componentInstance.count.subscriberCount).toBe(0);
  });
});
