import { createRequire } from "node:module";
import { resolve } from "node:path";
import ts from "typescript";

const require = createRequire(import.meta.url);
const createPlugin = require(resolve(process.cwd(), "projects/libraries/streamix/react/editor/tsserver.cjs")) as (modules: { typescript: typeof ts }) => {
  create(info: ts.server.PluginCreateInfo): ts.LanguageService;
};

describe("Streamix React tsserver plugin", () => {
  it("exposes implicit JSX atom reads as their value type and retains writable atom checks", () => {
    const fileName = ts.sys.resolvePath(resolve(process.cwd(), "virtual-streamix-editor.tsx")).replaceAll("\\", "/");
    const source = `
      import { atom } from "@epikodelabs/streamix";
      let count = atom(1);
      export const App = () => <button onClick={() => count += 1}>{count.toFixed()} {count.toUpperCase()}</button>;
    `;
    const options: ts.CompilerOptions = {
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
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

    const diagnostics = service.getSemanticDiagnostics(fileName);
    const propertyError = diagnostics.find(diagnostic =>
      ts.flattenDiagnosticMessageText(diagnostic.messageText, " ").includes("toUpperCase"),
    );

    expect(propertyError).toBeDefined();
    expect(propertyError!.start).toBe(source.indexOf("toUpperCase"));
    expect(diagnostics.some(diagnostic =>
      ts.flattenDiagnosticMessageText(diagnostic.messageText, " ").includes("Operator '+='"),
    )).toBe(false);
  });
});
