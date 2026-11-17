import ts from 'typescript';
import { compileScript, parse } from '@vue/compiler-sfc';
import { transformVueSfc } from './compiler';

describe('Vue generated bridge types', () => {
  it('typechecks numeric and undefined-valued sources without using names as fallbacks', () => {
    if (typeof window !== 'undefined') { pending('Requires the TypeScript Node compiler host'); return; }
    const result = transformVueSfc(`<script setup lang="ts">
      import { atom, derived, flow, type Writable } from '@epikodelabs/streamix';
      let count = atom(1) as Writable<number>;
      const total = derived(() => count * 2);
      const empty = derived<number | undefined>(() => undefined);
      const updates = flow(async function* () { yield 1; });
    </script><template>{{ count }} {{ total }} {{ empty }} {{ updates }}</template>`);
    expect(result.diagnostics).toEqual([]);
    const script = compileScript(parse(result.code).descriptor, { id: 'bridge-parity' }).content;
    const config = ts.readConfigFile('tsconfig.json', ts.sys.readFile);
    const options = ts.parseJsonConfigFileContent(config.config, ts.sys, ts.sys.getCurrentDirectory()).options;
    const fileName = `${ts.sys.getCurrentDirectory().replace(/\\/g, '/')}/tmp/generated-bridge-parity.ts`;
    const host = ts.createCompilerHost(options);
    const original = host.getSourceFile.bind(host);
    host.getSourceFile = (name, version, onError, fresh) => name.replace(/\\/g, '/') === fileName
      ? ts.createSourceFile(fileName, script, version, true)
      : original(name, version, onError, fresh);
    const program = ts.createProgram([fileName], { ...options, noEmit: true }, host);
    expect(ts.getPreEmitDiagnostics(program).map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n'))).toEqual([]);
  });
});
