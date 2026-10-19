/**
 * Dev-only creation-site capture. Lets every node describe itself with the
 * file position of the user code that created it, without build tooling.
 * Production builds keep one boolean check per creation and nothing more.
 */

export interface RuntimeOrigin {
  readonly file: string;
  readonly line: number;
  readonly column?: number;
  /** Function or method name from the stack frame, when present. */
  readonly fn?: string;
}

const DEV = (import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV === true;
let enabled = DEV;

/** Tests and tooling may toggle capture explicitly; dev builds default to on. */
export function setOriginCapture(next: boolean): void {
  enabled = next;
}

// Frames from this library's own sources are never the creation site. Source
// checkouts and published packages get separate patterns; separators are
// normalized before matching.
const INTERNAL_FRAME = [
  /projects\/libraries\/streamix\//,
  /node_modules\/@epikodelabs\/streamix(\/|$)/,
  /@epikodelabs\/streamix\//,
  /^node:internal/,
];

// In bundled builds every frame shares one file URL, so the creation chain is
// recognized by function name instead. Kept to the known factory path; a user
// helper wrapping atom() is external and stops the walk correctly.
const INTERNAL_FN = new Set([
  "captureOrigin", "register", "finalizeAtomInstance", "createAtomBase",
  "atomFromIteratorInternal", "atom", "derived", "flow", "pipe", "scope",
  "createScopeInternal", "evaluateExprMarker", "createOperator",
  "createPushOperator", "apply", "trackOperatorExecution",
]);

function parseFrame(frame: string): (RuntimeOrigin & { internal: boolean }) | undefined {
  const match = frame.match(/^\s*at\s+(?:(.*?)\s+\()?([^\s()]+?):(\d+):(\d+)\)?$/);
  if (!match) return undefined;
  const [, fn, rawFile, line, column] = match;
  const file = rawFile.replace(/\\/g, "/");
  const internal = INTERNAL_FRAME.some(pattern => pattern.test(file))
    || (fn !== undefined && INTERNAL_FN.has(fn));
  return {
    file,
    line: Number(line),
    column: Number(column),
    ...(fn && fn !== "Error" ? { fn } : {}),
    internal,
  };
}

/**
 * The position of the first stack frame outside this library — the user code
 * that created the node. Returns undefined when capture is off (production)
 * or no external frame exists (library-internal creation). In per-module dev
 * serving the file paths are exact; in bundled builds they refer to the bundle.
 */
export function captureOrigin(): RuntimeOrigin | undefined {
  if (!enabled) return undefined;
  const frames = (new Error().stack ?? "").split("\n");
  for (const frame of frames) {
    if (frame.startsWith("Error")) continue;
    const origin = parseFrame(frame);
    if (origin && !origin.internal) {
      const { internal: _ignored, ...result } = origin;
      return result;
    }
  }
  return undefined;
}
