/**
 * Source maps for the compiler's two-stage SFC edits. The generated Vite code
 * remains text (not a reprinted AST), so every surviving authored UTF-16 code
 * unit has an exact source location. Injected code is deliberately unmapped.
 *
 * Neither a token search nor a line-shift approximation is sufficient here:
 * repeated identifiers and interpolated templates need original occurrences.
 */
export interface VueSourceMap {
  readonly version: 3;
  readonly file: string;
  readonly sources: string[];
  readonly sourcesContent: string[];
  readonly names: string[];
  readonly mappings: string;
}

export interface MappedEdit {
  readonly start: number;
  readonly end: number;
  readonly replacement: string;
}

export interface MappedSource {
  readonly code: string;
  /** -1 for generated code; otherwise the offset in the original SFC. */
  readonly originalOffsets: readonly number[];
}

export function applyMappedEdits(source: string, edits: readonly MappedEdit[]): MappedSource {
  const sorted = [...edits].sort((a, b) => a.start - b.start || a.end - b.end);
  const result: string[] = [];
  const originalOffsets: number[] = [];
  let cursor = 0;
  const appendOriginal = (start: number, end: number): void => {
    result.push(source.slice(start, end));
    for (let offset = start; offset < end; offset++) originalOffsets.push(offset);
  };
  for (const edit of sorted) {
    if (edit.start < cursor || edit.start > edit.end || edit.end > source.length) {
      throw new Error(`Overlapping or invalid Streamix Vue edit at ${edit.start}.`);
    }
    appendOriginal(cursor, edit.start);
    result.push(edit.replacement);
    for (let index = 0; index < edit.replacement.length; index++) originalOffsets.push(-1);
    cursor = edit.end;
  }
  appendOriginal(cursor, source.length);
  return { code: result.join(''), originalOffsets };
}

export function insertMappedText(source: MappedSource, offset: number, value: string): MappedSource {
  if (offset < 0 || offset > source.code.length) throw new RangeError('Invalid generated import position.');
  return {
    code: source.code.slice(0, offset) + value + source.code.slice(offset),
    originalOffsets: [
      ...source.originalOffsets.slice(0, offset),
      ...Array<number>(value.length).fill(-1),
      ...source.originalOffsets.slice(offset),
    ],
  };
}

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function vlq(number: number): string {
  let value = number < 0 ? (-number * 2) + 1 : number * 2;
  let result = '';
  do {
    let digit = value % 32;
    value = Math.floor(value / 32);
    if (value > 0) digit |= 32;
    result += BASE64[digit];
  } while (value > 0);
  return result;
}

/** Encode exact authored locations and unmapped generated insertions. */
export function createVueSourceMap(original: string, output: MappedSource, fileName: string): VueSourceMap {
  if (output.originalOffsets.length !== output.code.length) {
    throw new Error('Streamix Vue source-map offsets do not match generated code.');
  }
  const originalLines = new Int32Array(original.length);
  const originalColumns = new Int32Array(original.length);
  let line = 0;
  let column = 0;
  for (let offset = 0; offset < original.length; offset++) {
    originalLines[offset] = line;
    originalColumns[offset] = column;
    if (original[offset] === '\n') { line++; column = 0; }
    else column++;
  }

  const lines: string[] = [];
  let segments: string[] = [];
  let generatedColumn = 0;
  let lastGeneratedColumn = 0;
  let lastSourceLine = 0;
  let lastSourceColumn = 0;
  let lastWasMapped = false;
  for (let offset = 0; offset < output.code.length; offset++) {
    const originalOffset = output.originalOffsets[offset];
    if (originalOffset >= 0) {
      const sourceLine = originalLines[originalOffset];
      const sourceColumn = originalColumns[originalOffset];
      segments.push(vlq(generatedColumn - lastGeneratedColumn) + vlq(0) +
        vlq(sourceLine - lastSourceLine) + vlq(sourceColumn - lastSourceColumn));
      lastGeneratedColumn = generatedColumn;
      lastSourceLine = sourceLine;
      lastSourceColumn = sourceColumn;
      lastWasMapped = true;
    } else if (lastWasMapped) {
      // A one-field segment deliberately ends the prior mapping. Without it
      // source-map consumers may attribute injected imports to authored code.
      segments.push(vlq(generatedColumn - lastGeneratedColumn));
      lastGeneratedColumn = generatedColumn;
      lastWasMapped = false;
    }
    if (output.code[offset] === '\n') {
      lines.push(segments.join(','));
      segments = [];
      generatedColumn = 0;
      lastGeneratedColumn = 0;
      lastWasMapped = false;
    } else {
      generatedColumn++;
    }
  }
  lines.push(segments.join(','));
  return {
    version: 3,
    file: fileName.replace(/\\/g, '/'),
    sources: [fileName.replace(/\\/g, '/')],
    sourcesContent: [original],
    names: [],
    mappings: lines.join(';'),
  };
}
