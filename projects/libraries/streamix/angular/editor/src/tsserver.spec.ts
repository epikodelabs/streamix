import { createRequire } from "node:module";
import { resolve } from "node:path";
import ts from "typescript";

const require = createRequire(import.meta.url);
const createPlugin = require(resolve(process.cwd(), "projects/libraries/streamix/angular/editor/tsserver.cjs")) as
  ((modules: { typescript: typeof ts }) => ts.server.PluginModule);

describe("Streamix Angular tsserver plugin", () => {
  it("loads Angular's language-service factory and virtualizes inline atom templates", () => {
    const plugin = createPlugin({ typescript: ts }) as ts.server.PluginModule & {
      __streamixVirtualize(fileName: string, source: string): { code: string };
    };
    expect(typeof plugin.create).toBe("function");
    expect(typeof plugin.getExternalFiles).toBe("function");
    const source = [
      'import { Component } from "@angular/core";',
      'import { atom } from "@epikodelabs/streamix";',
      '@Component({ template: `<p>{{ count * 2 }}</p><button (click)="count += 1"></button>` })',
      'export class Counter { count = atom(1); }',
    ].join("\n");
    const document = plugin.__streamixVirtualize("counter.ts", source);
    expect(document.code).toContain("{{ count.value * 2 }}");
    expect(document.code).toContain('(click)="count.next(count.value + (1))"');
  });
});
