import ts from "typescript";
import type { ReactJsxSourceMap } from "./compiler";

type Token = { readonly key: string; readonly pos: number };
function tokens(source: string): Token[] {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.JSX, source);
  const result: Token[] = [];
  for (let kind = scanner.scan(); kind !== ts.SyntaxKind.EndOfFileToken; kind = scanner.scan()) {
    const text = scanner.getTokenText();
    if (text) result.push({ key: `${kind}:${text}`, pos: scanner.getTokenPos() });
  }
  return result;
}

/** Diff token *positions* rather than searching emitted spelling via indexOf.
 * Deleted/replaced/generated tokens stay unmapped; unchanged tokens map to the
 * exact authored occurrence, even when their spellings repeat across JSX.
 */
function matchTokens(original: readonly Token[], generated: readonly Token[]): Array<[number, number]> {
  const n = original.length, m = generated.length;
  const max = n + m;
  let frontier = new Map<number, number>([[1, 0]]);
  const trace: Array<Map<number, number>> = [];
  // A pathological complete rewrite should have incomplete mapping, never
  // fabricated coordinates or an unbounded quadratic memory allocation.
  const limit = Math.min(max, 600);
  for (let d = 0; d <= limit; d++) {
    const current = new Map<number, number>();
    for (let k = -d; k <= d; k += 2) {
      const down = k === -d || (k !== d && (frontier.get(k - 1) ?? -1) < (frontier.get(k + 1) ?? -1));
      let x = down ? (frontier.get(k + 1) ?? 0) : (frontier.get(k - 1) ?? 0) + 1;
      let y = x - k;
      while (x < n && y < m && original[x].key === generated[y].key) { x++; y++; }
      current.set(k, x);
      if (x === n && y === m) {
        trace.push(current);
        const matches: Array<[number, number]> = [];
        let rx = n, ry = m;
        for (let step = trace.length - 1; step > 0; step--) {
          const previous = trace[step - 1], diagonal = rx - ry;
          const wentDown = diagonal === -step ||
            (diagonal !== step && (previous.get(diagonal - 1) ?? -1) < (previous.get(diagonal + 1) ?? -1));
          const previousDiagonal = wentDown ? diagonal + 1 : diagonal - 1;
          const px = previous.get(previousDiagonal) ?? 0, py = px - previousDiagonal;
          while (rx > px && ry > py) { matches.push([rx - 1, ry - 1]); rx--; ry--; }
          rx = px; ry = py;
        }
        while (rx > 0 && ry > 0) { matches.push([rx - 1, ry - 1]); rx--; ry--; }
        return matches.reverse();
      }
    }
    trace.push(current);
    frontier = current;
  }
  // More changes than the bounded diff supports: no fake mappings.
  return [];
}

/** Anchor large source files by unique three-token contexts and align each
 * intervening region independently. This avoids the whole-file edit-distance
 * cap when a component introduces hundreds of bindings, without associating
 * one repeated `count` spelling with an unrelated original occurrence.
 */
function alignedMatches(original: readonly Token[], generated: readonly Token[]): Array<[number, number]> {
  const signatures = (tokens: readonly Token[]) => {
    const signatures = new Map<string, number>();
    const ambiguous = new Set<string>();
    for (let i = 1; i < tokens.length - 1; i++) {
      const signature = `${tokens[i - 1].key}\u0000${tokens[i].key}\u0000${tokens[i + 1].key}`;
      if (signatures.has(signature)) ambiguous.add(signature);
      else signatures.set(signature, i);
    }
    for (const name of ambiguous) signatures.delete(name);
    return signatures;
  };
  const left = signatures(original), right = signatures(generated);
  const candidates: Array<[number, number]> = [];
  for (const [signature, i] of left) {
    const j = right.get(signature);
    if (j !== undefined) candidates.push([i, j]);
  }
  candidates.sort((a, b) => a[0] - b[0]);
  const tails: number[] = [], parents: number[] = [];
  for (let i = 0; i < candidates.length; i++) {
    const j = candidates[i][1];
    let lo = 0, hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (candidates[tails[mid]][1] < j) lo = mid + 1;
      else hi = mid;
    }
    parents[i] = lo === 0 ? -1 : tails[lo - 1];
    tails[lo] = i;
  }
  const anchors: Array<[number, number]> = [];
  if (tails.length) {
    let k = tails[tails.length - 1];
    while (k >= 0) { anchors.push(candidates[k]); k = parents[k]; }
    anchors.reverse();
  }
  const result: Array<[number, number]> = [];
  let beforeOriginal = -1, beforeGenerated = -1;
  for (const [nextOriginal, nextGenerated] of [...anchors, [original.length, generated.length] as [number, number]]) {
    const leftStart = beforeOriginal + 1, rightStart = beforeGenerated + 1;
    const region = matchTokens(original.slice(leftStart, nextOriginal), generated.slice(rightStart, nextGenerated));
    for (const [i, j] of region) result.push([leftStart + i, rightStart + j]);
    if (nextOriginal !== original.length) result.push([nextOriginal, nextGenerated]);
    beforeOriginal = nextOriginal;
    beforeGenerated = nextGenerated;
  }
  return result;
}

function vlq(value: number): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let rest = (Math.abs(value) << 1) | Number(value < 0);
  let out = "";
  do { let digit = rest & 31; rest >>>= 5; if (rest) digit |= 32; out += alphabet[digit]; } while (rest);
  return out;
}

function locations(text: string, offsets: readonly number[]): Array<{ line: number; column: number }> {
  const result: Array<{ line: number; column: number }> = [];
  let line = 0, lastNewline = -1, from = 0;
  for (const offset of offsets) {
    for (let i = from; i < offset; i++) if (text.charCodeAt(i) === 10) { line++; lastNewline = i; }
    result.push({ line, column: offset - lastNewline - 1 });
    from = offset;
  }
  return result;
}

export function createTokenSourceMap(source: string, generated: string, fileName: string): ReactJsxSourceMap {
  const originals = tokens(source), outputs = tokens(generated);
  const matches = alignedMatches(originals, outputs);
  const originalLocations = locations(source, originals.map(token => token.pos));
  const outputLocations = locations(generated, outputs.map(token => token.pos));
  const mapped = new Map<number, number>(matches.map(([sourceIndex, outputIndex]) => [outputIndex, sourceIndex]));
  const segments: Array<Array<{ col: number; row?: number; originalCol?: number }>> = [];
  // A one-field segment explicitly ends a source mapping. Omitting it would
  // misleadingly attribute generated imports/hooks to the preceding authored
  // token until the next mapped location.
  let wasMapped = false;
  for (let outputIndex = 0; outputIndex < outputs.length; outputIndex++) {
    const sourceIndex = mapped.get(outputIndex);
    const location = outputLocations[outputIndex];
    if (sourceIndex === undefined) {
      if (wasMapped) (segments[location.line] ??= []).push({ col: location.column });
      wasMapped = false;
      continue;
    }
    const from = originalLocations[sourceIndex];
    (segments[location.line] ??= []).push({ col: location.column, row: from.line, originalCol: from.column });
    wasMapped = true;
  }
  let previousRow = 0, previousColumn = 0;
  const mappings = segments.map(line => {
    let previousGeneratedColumn = 0;
    return (line ?? []).map(entry => {
      let encoded = vlq(entry.col - previousGeneratedColumn);
      previousGeneratedColumn = entry.col;
      if (entry.row !== undefined && entry.originalCol !== undefined) {
        encoded += vlq(0) + vlq(entry.row - previousRow) + vlq(entry.originalCol - previousColumn);
        previousRow = entry.row;
        previousColumn = entry.originalCol;
      }
      return encoded;
    }).join(",");
  }).join(";");
  return { version: 3, file: fileName.split(/[\\/]/).pop() || fileName, sources: [fileName], sourcesContent: [source], names: [], mappings };
}
