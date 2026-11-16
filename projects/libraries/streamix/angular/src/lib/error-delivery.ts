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

/** Replaces the delivery sink. Pass undefined to restore the console report. */
export function setSxRenderErrorSink(sink: SxRenderErrorSink | undefined): void {
  renderErrorSink = sink ?? reportToConsole;
}

export function getSxRenderErrorSink(): SxRenderErrorSink {
  return renderErrorSink;
}

/**
 * Compiler instruction: capture the application's ErrorHandler as the
 * delivery sink for reactive source failures. Must run inside an injection
 * context — generated component setup qualifies. Raw instruction rigs that
 * invoke setup outside Angular keep the default console report.
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
    setSxRenderErrorSink(error => errorHandler!.handleError(error));
  }
}
