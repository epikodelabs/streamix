import { createRequire } from "node:module";
import { resolve } from "node:path";
import ts from "typescript";

const require = createRequire(import.meta.url);
const createPlugin = require(resolve(process.cwd(), "projects/libraries/streamix/react/editor/tsserver.cjs"));

describe("React tsserver production gates", () => {
  it("does not virtualize calls to local functions shadowing imported atom factories", () => {
    const fileName = "/virtual/Shadow.tsx";
    const source = `import { atom } from '@epikodelabs/streamix'; function App() { const atom = (n: number) => ({ value: n }); const ordinary = atom(1); return <span>{ordinary}{ordinary.value}</span>; }`;
    const host = {
      getScriptSnapshot: (name: string) => name === fileName ? ts.ScriptSnapshot.fromString(source) : undefined,
      getScriptVersion: () => "1",
    };
    const service = { getSemanticDiagnostics: () => [] };
    createPlugin({ typescript: ts }).create({ languageService: service, languageServiceHost: host });
    const virtual = host.getScriptSnapshot(fileName)!.getText(0, 10000);
    expect(virtual).toContain("{ordinary}");
    expect(virtual).not.toContain("ordinary.value.value");
  });
});
