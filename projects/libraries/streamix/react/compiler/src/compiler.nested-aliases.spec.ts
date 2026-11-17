import { transformReactJsx } from './compiler';

const errors = (source: string) => transformReactJsx(source).diagnostics.filter(item => item.category === 'error');

describe('React nested reactive aliases', () => {
  const blocks = {
    if: (body: string) => `if (visible) { ${body} }`,
    switch: (body: string) => `switch (visible) { case true: { ${body} } }`,
    try: (body: string) => `try { ${body} } catch { return null; }`,
    loop: (body: string) => `for (let i = 0; i < 1; i++) { ${body} }`,
  };
  for (const [name, wrap] of Object.entries(blocks)) {
    for (const declaration of [
      'const alias = count;',
      'const alias = (count as typeof count);',
      'const { count: alias } = model;',
      'const { count: alias } = { count };',
      'const [alias] = [count];',
      'const alias = model.count;',
      'const alias = atom(2);',
    ]) {
      it(`rejects ${declaration} in ${name}`, () => {
        const source = `import { atom } from '@epikodelabs/streamix';
function Counter({ visible }) {
  const count = atom(1);
  const model = { count };
  ${wrap(`${declaration} return <output>{alias}</output>;`)}
  return null;
}`;
        const result = transformReactJsx(source);
        const diagnostic = result.diagnostics.find(item => item.message.includes('nested block'));
        expect(diagnostic?.category).toBe('error');
        expect(source.slice(diagnostic!.start, diagnostic!.start + diagnostic!.length)).toContain('alias');
        expect(result.code).not.toContain('useStreamixSource(alias');
      });
    }
    it(`respects an ordinary shadow in ${name}`, () => {
      expect(errors(`const count = atom(1);
function Counter({ visible }) {
  ${wrap('const count = 2; const alias = count; return <output>{alias}</output>;')}
  return null;
}`)).toEqual([]);
    });
  }

  it('follows alias chains and destructured maps across enclosing blocks', () => {
    const result = errors(`function Counter() {
      const count = atom(1);
      const model = { count };
      if (true) { const inner = model; try { const { count: alias } = inner; return <p>{alias}</p>; } finally {} }
      return null;
    }`);
    expect(result.length).toBe(2);
    expect(result.every(item => item.message.includes('nested block'))).toBeTrue();
  });

  it('rejects aliases of sources returned by an explicit local hook', () => {
    expect(errors(`import { atom } from '@epikodelabs/streamix';
      import { useStreamixLocal } from '@epikodelabs/streamix/react';
      function Counter() { const count = useStreamixLocal(() => atom(1));
        if (true) { const alias = count; return <p>{alias}</p>; } return null;
      }`).some(item => item.message.includes('nested block'))).toBeTrue();
  });

  it('does not classify plain destructured members as reactive', () => {
    expect(errors(`function Counter() { const count = atom(1);
      if (true) { const { label: alias } = { count, label: 'plain' }; return <p>{alias}</p>; }
      return null;
    }`)).toEqual([]);
  });

  it('preserves catch and callback parameter shadows and unrelated hook helpers', () => {
    expect(errors(`import { useAtom } from '@epikodelabs/streamix/react';
      const count = atom(1);
      function Counter() {
        try { throw 1; } catch (count) { const alias = count; }
        const items = [1].map(count => { const alias = count; return alias; });
        { const useAtom = callback => 1; const alias = useAtom(() => atom(2)); }
        return <p>{items}</p>;
      }`)).toEqual([]);
  });

  it('keeps component-scope aliases supported with unconditional hooks', () => {
    const result = transformReactJsx(`function Counter() {
      const count = atom(1); const alias = count;
      const model = { count }; const { count: other } = model;
      return <p>{alias}{other}</p>;
    }`);
    expect(result.diagnostics).toEqual([]);
    expect(result.code).toContain('useStreamixSource(alias');
    expect(result.code).toContain('useStreamixSource(other');
  });
});
