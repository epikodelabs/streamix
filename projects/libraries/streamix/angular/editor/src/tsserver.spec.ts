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

  it("virtualizes block headers, @let values, and two-way bindings", () => {
    const plugin = createPlugin({ typescript: ts }) as ts.server.PluginModule & {
      __streamixVirtualize(fileName: string, source: string): { code: string };
    };
    const source = [
      'import { Component } from "@angular/core";',
      'import { atom } from "@epikodelabs/streamix";',
      "@Component({ template: `",
      "  @if (count > 0) { <p>{{ count }}</p> } @else if (count < -1) { <s>-</s> }",
      "  @for (row of rows; track row.id) { <i>{{ row.name }}</i> }",
      '  @let doubled = count * 2;',
      '  <input [(value)]="count">',
      "  <input [value]=\"count\" (input)=\"count = $event.target.value\">",
      "  <span>{{ count.value }}</span>",
      "  <ul>@switch (count) { @case (1) { <li>one</li> } }</ul>",
      "  ` })",
      'export class Counter { count = atom(1); rows = atom([{ id: "a", name: "A" }]); }',
    ].join("\n");
    const document = plugin.__streamixVirtualize("counter.ts", source);

    expect(document.code).toContain("@if (count.value > 0) {");
    expect(document.code).toContain("@else if (count.value < -1) {");
    expect(document.code).toContain("@for (row of rows.value; track row.id) {");
    expect(document.code).toContain("@let doubled = count.value * 2;");
    // Two-way sugar stays a value read; the write side is compiler-owned.
    expect(document.code).toContain('[(value)]="count.value"');
    expect(document.code).toContain('[value]="count.value"');
    expect(document.code).toContain('(input)="count.next($event.target.value)"');
    // Explicit .value reads must not be double-wrapped.
    expect(document.code).not.toContain("count.value.value");
    // Inside @switch, only the header expression is a compiled position.
    expect(document.code).toContain("@switch (count.value) {");
    expect(document.code).toContain("@case (1) {");
  });

  it("virtualizes raw class atom reads inside derived callbacks", () => {
    const plugin = createPlugin({ typescript: ts }) as ts.server.PluginModule & {
      __streamixVirtualize(fileName: string, source: string): { code: string };
    };
    const source = [
      'import { Component } from "@angular/core";',
      'import { atom, derived } from "@epikodelabs/streamix";',
      '@Component({ template: `<p>{{ total }}</p>` })',
      'export class Counter { price = atom(2); quantity = atom(3); total = derived(() => this.price * this.quantity); }',
    ].join("\n");

    const document = plugin.__streamixVirtualize("counter.ts", source);
    expect(document.code).toContain('derived(() => this.price.value * this.quantity.value)');
  });
  it('never rewrites strings, comments, keys, or shadowed callback parameters', () => {
    const plugin = createPlugin({ typescript: ts }) as ts.server.PluginModule & {
      __streamixVirtualize(fileName: string, source: string): { code: string };
    };
    const source = [
      'import { atom } from "@epikodelabs/streamix";',
      '@Component({ template: `{{ "count" + obj.count + count }}',
      '  <button (click)="count += 1"></button>',
      '  @if (isReady((count + 1), "a)")) { <i>{{ count }}</i> }',
      '` })',
      'export class Test { count = atom(1); }',
    ].join("\n");
    const document = plugin.__streamixVirtualize('fixture.ts', source);
    expect(document.code).toContain('"count" + obj.count + count.value');
    expect(document.code).toContain('count.next(count.value + (1))');
    expect(document.code).toContain('isReady((count.value + 1), "a)")');
  });

  it('keeps exact offsets across separate atom reads in the same template', () => {
    const plugin = createPlugin({ typescript: ts }) as ts.server.PluginModule & {
      __streamixVirtualize(fileName: string, source: string): {
        code: string; toOriginal(offset: number): number; toGenerated(offset: number): number;
      };
    };
    const source = 'import { atom } from "@epikodelabs/streamix"; '
      + '@Component({ template: `<p>{{ count }}</p><output>{{ count }}</output>` }) '
      + 'export class Test { count = atom(1); }';
    const document = plugin.__streamixVirtualize('fixture.ts', source);
    const second = source.lastIndexOf('{{ count }}') + 3;
    const generated = document.code.lastIndexOf('{{ count.value }}') + 3;
    expect(document.toGenerated(second)).toBe(generated);
    expect(document.toOriginal(generated)).toBe(second);
    expect(document.toOriginal(document.toGenerated(source.indexOf('class Test'))))
      .toBe(source.indexOf('class Test'));
  });

});
