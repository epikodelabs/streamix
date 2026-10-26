import { createRequire } from "node:module";
import { resolve } from "node:path";
import ts from "typescript";

const require = createRequire(import.meta.url);
const createPlugin = require(resolve(process.cwd(), "projects/libraries/streamix/react/editor/tsserver.cjs")) as (modules: { typescript: typeof ts }) => {
  create(info: ts.server.PluginCreateInfo): ts.LanguageService;
};

describe("Streamix React tsserver plugin", () => {
  function diagnose(source: string): ts.Diagnostic[] {
    const fileName = ts.sys.resolvePath(resolve(process.cwd(), "virtual-streamix-editor.tsx")).replaceAll("\\", "/");
    const options: ts.CompilerOptions = {
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      // Without an explicit target, TypeScript 5 defaults to ES5 libs and the
      // library sources lose Set/Proxy/Reflect/AsyncIterator, degrading the
      // atom types until `.value` checks out as `any`.
      target: ts.ScriptTarget.ES2022,
      baseUrl: process.cwd(),
      paths: { "@epikodelabs/streamix": ["projects/libraries/streamix/src/lib/index.ts"] },
      skipLibCheck: true,
      strict: true,
    };
    const host: ts.LanguageServiceHost = {
      getCompilationSettings: () => options,
      getScriptFileNames: () => [fileName],
      getScriptVersion: () => "1",
      getScriptSnapshot: name => {
        const text = name === fileName ? source : ts.sys.readFile(name);
        return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text);
      },
      getCurrentDirectory: () => process.cwd(),
      getDefaultLibFileName: settings => ts.getDefaultLibFilePath(settings),
      fileExists: name => name === fileName || ts.sys.fileExists(name),
      readFile: name => name === fileName ? source : ts.sys.readFile(name),
      readDirectory: ts.sys.readDirectory,
    };
    const languageService = ts.createLanguageService(host);
    const service = createPlugin({ typescript: ts }).create({
      languageService,
      languageServiceHost: host,
      project: { projectService: { logger: { info: () => undefined } } },
      config: {},
    } as unknown as ts.server.PluginCreateInfo);
    return service.getSemanticDiagnostics(fileName);
  }

  const messageOf = (diagnostic: ts.Diagnostic): string =>
    ts.flattenDiagnosticMessageText(diagnostic.messageText, " ");

  it("exposes implicit JSX atom reads as their value type and retains writable atom checks", () => {
    const source = `
      import { atom } from "@epikodelabs/streamix";
      let count = atom(1);
      export const App = () => <button onClick={() => count += 1}>{count.toFixed()} {count.toUpperCase()}</button>;
    `;

    const diagnostics = diagnose(source);
    const propertyError = diagnostics.find(diagnostic => messageOf(diagnostic).includes("toUpperCase"));

    expect(propertyError).toBeDefined();
    expect(propertyError!.start).toBe(source.indexOf("toUpperCase"));
    expect(diagnostics.some(diagnostic => messageOf(diagnostic).includes("Operator '+='"))).toBe(false);
  });

  it("does not double-.value explicit reads and lowers every compound write", () => {
    const source = `
      import { atom } from "@epikodelabs/streamix";
      let count = atom(1);
      let title = atom("x");
      export const App = () => (
        <button
          onClick={() => {
            count = count.value + 1;
            count *= 3;
            count **= 2;
            count <<= 1;
            count ??= 0;
            count &&= 2;
            count ||= 5;
            count++;
            --count;
            title ||= "y";
          }}>
          {count} {count.value} {count.toFixed()}
        </button>
      );
    `;

    const diagnostics = diagnose(source);
    // The only tolerated diagnostic family would be genuine authoring errors;
    // none of these shapes may surface operator or double-read false errors.
    const offenders = diagnostics.filter(diagnostic =>
      /Operator '|read-only|\.value|Cannot find/.test(messageOf(diagnostic)));
    expect(offenders.map(offender => messageOf(offender))).toEqual([]);
  });

  it("treats raw atom reads in derived callbacks as their value type", () => {
    const source = `
      import { atom, derived } from "@epikodelabs/streamix";
      const price = atom(2);
      const quantity = atom(3);
      const total = derived(() => price * quantity);
      export const App = () => <output>{total}</output>;
    `;

    const diagnostics = diagnose(source);
    expect(diagnostics.filter(diagnostic => /Operator '\*'/.test(messageOf(diagnostic)))).toEqual([]);
  });
  it("keeps derived and JSX object shorthand keys valid while rewriting their values", () => {
    const source = `
      import { atom, derived } from "@epikodelabs/streamix";
      let count = atom(1);
      const view = derived(() => ({ count }));
      export const App = () => <output title={JSON.stringify({ count })}>{view}</output>;
    `;
    expect(() => diagnose(source)).not.toThrow();
    const diagnostics = diagnose(source);
    expect(diagnostics.some(d => /Debug Failure|Shorthand property/.test(messageOf(d)))).toBe(false);
  });

  it("lowers shorthand-derived reads in ordinary TypeScript files", () => {
    const source = `import { atom, derived } from "@epikodelabs/streamix";\nconst count = atom(2);\nexport const total = derived(() => count * 2);`;
    const fileName = ts.sys.resolvePath(resolve(process.cwd(), "streamix-plain-helper.ts"));
    const host: ts.LanguageServiceHost = {
      getCompilationSettings: () => ({ strict: true, noEmit: true }),
      getScriptFileNames: () => [fileName],
      getScriptVersion: () => "1",
      getScriptSnapshot: name => name === fileName ? ts.ScriptSnapshot.fromString(source) : undefined,
      getCurrentDirectory: () => process.cwd(),
      getDefaultLibFileName: settings => ts.getDefaultLibFilePath(settings),
      fileExists: name => name === fileName || ts.sys.fileExists(name),
      readFile: name => name === fileName ? source : ts.sys.readFile(name),
    };
    createPlugin({ typescript: ts }).create({
      languageService: ts.createLanguageService(host), languageServiceHost: host,
      project: { projectService: { logger: { info: () => undefined } } }, config: {},
    } as unknown as ts.server.PluginCreateInfo);
    const rewritten = host.getScriptSnapshot(fileName)!.getText(0, 10000);
    expect(rewritten).toContain("count.value * 2");
  });

  it("does not apply TSX virtual source offsets to ordinary TypeScript files", () => {
    const source = `const value: number = "not a number";`;
    // TypeScript 6 matches language service files by normalized path; an
    // unnormalized name fails the lookup with "Could not find source file".
    const fileName = ts.sys.resolvePath(resolve(process.cwd(), "plain-streamix-editor.ts")).replaceAll("\\", "/");
    const options: ts.CompilerOptions = { strict: true, noEmit: true, skipLibCheck: true };
    const host: ts.LanguageServiceHost = {
      getCompilationSettings: () => options,
      getScriptFileNames: () => [fileName],
      getScriptVersion: () => "1",
      getScriptSnapshot: name => {
        const value = name === fileName ? source : ts.sys.readFile(name);
        return value === undefined ? undefined : ts.ScriptSnapshot.fromString(value);
      },
      getCurrentDirectory: () => process.cwd(),
      getDefaultLibFileName: settings => ts.getDefaultLibFilePath(settings),
      fileExists: name => name === fileName || ts.sys.fileExists(name),
      readFile: name => name === fileName ? source : ts.sys.readFile(name),
      readDirectory: ts.sys.readDirectory,
    };
    const languageService = ts.createLanguageService(host);
    const plugin = createPlugin({ typescript: ts }).create({
      languageService, languageServiceHost: host,
      project: { projectService: { logger: { info: () => undefined } } }, config: {},
    } as unknown as ts.server.PluginCreateInfo);
    const diagnostics = plugin.getSemanticDiagnostics(fileName);
    expect(diagnostics.some(d => messageOf(d).includes("string"))).toBe(true);
  });

});
