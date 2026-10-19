import {
  Component,
  DestroyRef,
  ElementRef,
  PLATFORM_ID,
  inject,
} from '@angular/core';
import {
  mountStreamixInspector,
  recordStreamixDevtoolsEvent,
  streamixDevtoolsEnabled,
  streamixDevtoolsSnapshot,
  subscribeStreamixDevtools,
  type StreamixDevtoolsEvent,
} from '@epikodelabs/streamix';

export {
  recordStreamixDevtoolsEvent,
  streamixDevtoolsEnabled,
  streamixDevtoolsSnapshot,
  subscribeStreamixDevtools,
};
export type { StreamixDevtoolsEvent };

/**
 * Opt-in DevTools panel rendering the shared Streamix trace. The panel builds
 * its DOM imperatively and re-renders on store notifications, so it stays
 * completely outside Angular change detection — no inputs, no signals, no
 * scheduler involvement. It renders nothing in production builds or on the
 * server.
 */
@Component({
  selector: 'streamix-devtools',
  standalone: true,
  template: '',
})
export class StreamixDevtools {
  private readonly unsubscribe = subscribeStreamixDevtools(() => this.scheduleRender());
  private panel: HTMLElement | undefined;
  private stopInspector: (() => void) | undefined;
  private renderQueued = false;

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.unsubscribe();
      this.stopInspector?.();
      this.panel?.remove();
      this.panel = undefined;
    });

    if (!streamixDevtoolsEnabled || inject(PLATFORM_ID) === 'server') {
      return;
    }

    if (typeof window !== 'undefined' && window.__streamix) {
      this.stopInspector = mountStreamixInspector(inject<ElementRef<HTMLElement>>(ElementRef).nativeElement);
      return;
    }
    const panel = document.createElement('aside');
    panel.setAttribute('data-streamix-devtools', '');
    const style = panel.style;
    style.fontFamily = 'monospace';
    style.fontSize = '12px';
    style.maxHeight = '240px';
    style.overflow = 'auto';
    style.padding = '8px';
    style.background = '#111';
    style.color = '#eee';
    this.panel = panel;
    inject<ElementRef<HTMLElement>>(ElementRef).nativeElement.appendChild(panel);
    this.renderPanel();
  }

  private scheduleRender(): void {
    if (this.renderQueued || !this.panel) {
      return;
    }

    this.renderQueued = true;
    queueMicrotask(() => {
      this.renderQueued = false;
      this.renderPanel();
    });
  }

  private renderPanel(): void {
    const panel = this.panel;
    if (!panel) {
      return;
    }

    const heading = document.createElement('strong');
    heading.textContent = 'Streamix trace (writes → committed renders)';
    panel.replaceChildren(
      heading,
      ...streamixDevtoolsSnapshot().slice(-50).reverse().map((event) => {
        const row = document.createElement('div');
        row.textContent = `${event.type}: ${event.source}`;
        return row;
      }),
    );
  }
}
