import { ErrorHandler, inject } from '@angular/core';

/**
 * Angular delivery contract for reactive source failures (React/Vue parity):
 * a failed source read reaches Angular's ErrorHandler instead of being
 * reported only to the console. Compiled component setup installs an
 * ErrorHandler-backed sink through {@link ɵsxInstallErrorDelivery}; every
 * other caller keeps the default console report, so raw instruction rigs
 * behave exactly as before.
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
 * global sink applies, which {@link ɵsxInstallErrorDelivery} may have pointed
 * at an application's ErrorHandler.
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
 * Compiler instruction: capture the application's ErrorHandler as the
 * delivery sink for reactive source failures. Must run inside an injection
 * context — generated component setup qualifies. Raw instruction rigs that
 * invoke setup outside Angular keep the default console report.
 *
 * The installed handler becomes the global sink for consumers created
 * outside an injection context. It deliberately does not mark the sink
 * explicit: consumers created inside an injection context capture their own
 * application's handler through {@link ɵsxCurrentRenderErrorSink}, so
 * concurrently bootstrapped applications never share a handler.
 * @internal
 */
export function ɵsxInstallErrorDelivery(): void {
  let errorHandler: ErrorHandler | undefined;
  try {
    errorHandler = inject(ErrorHandler, { optional: true }) ?? undefined;
  } catch {
    // NG0203: no injection context (raw rigs) — keep the console sink.
    return;
  }
  if (errorHandler) {
    renderErrorSink = error => errorHandler!.handleError(error);
  }
}
