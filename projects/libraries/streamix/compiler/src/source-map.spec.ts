import { createTokenSourceMap } from './source-map';

describe('token source maps', () => {
  it('maps repeated tokens to their corresponding lines for each TypeScript line terminator', () => {
    for (const ending of ['\n', '\r', '\r\n', '\u2028', '\u2029']) {
      const source = `same${ending}same`;
      expect(createTokenSourceMap(source, `generated\n${source}`, 'input.ts').mappings)
        .withContext(JSON.stringify(ending)).toBe(';AAAA;AACA');
    }
  });

  it('encodes large columns and negative original-column deltas', () => {
    const source = `${' '.repeat(1500)}same\nsame`;
    const generated = `same\n${' '.repeat(80)}same`;
    expect(createTokenSourceMap(source, generated, 'input.ts').mappings).toBe('AAA49C;gFAC59C');
  });

  it('keeps a stable anchor and leaves over-budget edits unmapped', () => {
    const prefix = 'keep anchor stable ';
    const map = createTokenSourceMap(prefix + '+ '.repeat(620), prefix + '- '.repeat(620), 'input.ts');
    expect(map.mappings).toBe('AAAA,KAAK,O');
  });
  it('anchors authored tokens and leaves generated inserts unmapped', () => {
    const source = 'const count = atom(0);\nexport const label = count;\n';
    const generated = 'import { useStreamixSource } from "@epikodelabs/streamix";\n' +
      'const count = atom(0);\nexport const label = useStreamixSource(count, "count");\n';
    const map = createTokenSourceMap(source, generated, 'projects/apps/demo/src/label.ts');
    expect(map.version).toBe(3);
    expect(map.file).toBe('label.ts');
    expect(map.sources).toEqual(['projects/apps/demo/src/label.ts']);
    expect(map.sourcesContent).toEqual([source]);
    expect(map.mappings.length).toBeGreaterThan(0);
  });

  it('emits no mappings when no authored token survives a complete rewrite', () => {
    const map = createTokenSourceMap('const alpha = 1;', 'beta gamma delta 42,', 'a.ts');
    expect(map.version).toBe(3);
    expect(map.mappings).toBe('');
  });
});
