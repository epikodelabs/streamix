import { ErrorHandler, inject } from '@angular/core';

/**
 * Angular delivery contract for reactive source failures (React/Vue parity):
 * a failed source read reaches Angular's ErrorHandler instead of being
 * reported only to the console. Compiled component setup installs an
 * ErrorHandler-backed sink in the component's injection context.
 */
export type SxRenderErrorSink = (error: unknown) => void;

function reportToConsole(error: unknown): void {
  console.error('[streamix] A reactive render failure was not delivered through ErrorHandler.', error);
}

let renderErrorSink: SxRenderErrorSink = reportToConsole;
let explicitSink = false;

/** Replaces the delivery sink. Pass undefined to restore the console report. */
export function setSxRenderErrorSink(sink: SxRenderErrorSink | undefined): void {
  explicitSink = sink !== undefined;
  renderErrorSink = sink ?? reportToConsole;
}

export function getSxRenderErrorSink(): SxRenderErrorSink {
  return renderErrorSink;
}

/**
 * Resolves the delivery sink for a newly created consumer - a binding table,
 * direct binding, or structural block.
 *
 * Consumers capture the sink at creation instead of reading a process global
 * at delivery time: a module-global would route every application's
 * asynchronous reactive failures through the handler of the application that
 * initialized a component last. Inside an injection context the owning
 * application's ErrorHandler is used directly, so concurrent applications
 * never share a handler and destroying one application cannot reroute
 * another's. An explicit sink set through setSxRenderErrorSink (tests, raw
 * rigs) overrides everything; outside an injection context the configured
 * global sink applies.
 * @internal
 */
export function ɵsxCurrentRenderErrorSink(): SxRenderErrorSink {
  if (explicitSink) {
    return renderErrorSink;
  }

  try {
    const errorHandler = inject(ErrorHandler, { optional: true });
    if (errorHandler) {
      return error => errorHandler.handleError(error);
    }
  } catch {
    // NG0203: no injection context - the configured global sink applies.
  }

  return renderErrorSink;
}

/**
 * Compatibility instruction for existing generated setup. Compiled views
 * now run setup inside the owning injector so each consumer captures its sink.
 * @internal
 */
export function ɵsxInstallErrorDelivery(): void {}
