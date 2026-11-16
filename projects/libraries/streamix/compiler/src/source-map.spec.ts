import { createTokenSourceMap } from './source-map';

describe('token source maps', () => {
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
