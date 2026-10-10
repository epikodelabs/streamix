import { createElement } from "react";
import * as React from "react";
import { renderToString } from "react-dom/server";
import * as jsxRuntime from "react/jsx-runtime";
import ts from "typescript";
import { atom } from "@epikodelabs/streamix";
import { transformReactJsx } from "./compiler";

type CompiledModule = {
  App: () => ReturnType<typeof createElement>;
  status: ReturnType<typeof atom>;
};

function compileGeneratedModule(source: string): CompiledModule {
  const generated = transformReactJsx(source, "server-component.tsx");
  const javascript = ts.transpileModule(generated.code, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
    fileName: "server-component.tsx",
  }).outputText;
  const module = { exports: {} as CompiledModule };
  const require = (name: string): unknown => {
    if (name === "react") return React;
    if (name === "react/jsx-runtime") return jsxRuntime;
    if (name === "@epikodelabs/streamix") return { atom };
    throw new Error(`Unexpected generated import: ${name}`);
  };

  new Function("require", "module", "exports", javascript)(require, module, module.exports);
  return module.exports;
}

describe("React JSX compiler SSR", () => {
  it("renders an atom's server snapshot without subscribing", () => {
    const module = compileGeneratedModule(`
      import { atom } from "@epikodelabs/streamix";
      export const status = atom("Saved");
      export function App() { return <output>{status}</output>; }
    `);

    expect(renderToString(createElement(module.App))).toBe("<output>Saved</output>");
    expect(module.status.subscriberCount).toBe(0);
  });
});
