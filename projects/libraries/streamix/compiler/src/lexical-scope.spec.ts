import ts from 'typescript';
import { hoistedVarDeclarations } from './lexical-scope';

describe('hoisted var declarations', () => {
  it('collects block and loop vars per scope while skipping block bindings and nested scopes', () => {
    const source = ts.createSourceFile('hoisted.ts', `
      if (true) { var root; let block; }
      for (var index = 0; index < 2; index++) {}
      class Hidden { static { var staticOnly; } }
      namespace HiddenNamespace { var namespaceOnly; }
      function outer() {
        try { var local; const blockOnly = 1; } catch {}
        function inner() { var nested; }
      }
    `, ts.ScriptTarget.Latest, true);
    const outer = source.statements.find(ts.isFunctionDeclaration)!;
    const names = (nodes: readonly ts.VariableDeclaration[]) => nodes.map(node => node.name.getText(source));
    const root = hoistedVarDeclarations(source);
    expect(names(root)).toEqual(['root', 'index']);
    expect(hoistedVarDeclarations(source)).toBe(root);
    expect(names(hoistedVarDeclarations(outer))).toEqual(['local']);
    expect(hoistedVarDeclarations(source.statements[0])).toEqual([]);
  });
});
