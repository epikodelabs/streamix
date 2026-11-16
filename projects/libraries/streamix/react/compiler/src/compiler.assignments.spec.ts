import { transformReactJsx } from "./compiler";

const compile = (source: string): string => transformReactJsx(source, "component.tsx").code;

describe("React JSX compiler nested assignments", () => {
  it("lowers both targets of a nested atom assignment", () => {
    const code = compile(`
      import { atom } from "@epikodelabs/streamix";
      export function C() {
        let a = atom(1);
        let b = atom(2);
        return <button onClick={() => { a = b = 0; }}>{a}{b}</button>;
      }
    `);

    expect(code).toContain("a.next(");
    expect(code).toContain("b.next(__streamixAssigned");
    expect(code).not.toContain("a.next(b =");
    expect(code).not.toContain("b = 0");
  });

  it("lowers a chain of three atom targets in evaluation order", () => {
    const code = compile(`
      import { atom } from "@epikodelabs/streamix";
      export function C() {
        let a = atom(0);
        let b = atom(0);
        let c = atom(0);
        return <button onClick={() => { a = b = c = 7; }}>{a}{b}{c}</button>;
      }
    `);

    expect(code).toContain("a.next(");
    expect((code.match(/b\.next\(/g) ?? []).length).toBe(1);
    expect((code.match(/c\.next\(/g) ?? []).length).toBe(1);
    expect(code).not.toMatch(/b\s*=\s*c\s*=/);
    expect(code).not.toMatch(/c\s*=\s*7/);
  });

  it("keeps ordinary targets ordinary while lowering an atom in the chain", () => {
    const code = compile(`
      import { atom } from "@epikodelabs/streamix";
      export function C() {
        let a = atom(0);
        let plain = 0;
        return <button onClick={() => { a = plain = 1; }}>{a}{plain}</button>;
      }
    `);

    expect(code).toContain("a.next(plain = 1)");
    expect(code).not.toContain("plain.next(");
  });

  it("preserves the assigned value when the atom is the inner target", () => {
    const code = compile(`
      import { atom } from "@epikodelabs/streamix";
      export function C() {
        let a = atom(0);
        let plain = 0;
        return <button onClick={() => { plain = a = 1; }}>{a}{plain}</button>;
      }
    `);

    expect(code).toContain("plain = ((__streamixAssigned");
    expect(code).toContain("a.next(__streamixAssigned");
    expect(code).not.toContain("plain = a = 1");
  });

  it("evaluates a side-effecting right side once across the chain", () => {
    const code = compile(`
      import { atom } from "@epikodelabs/streamix";
      const nextValue = () => 5;
      export function C() {
        let a = atom(0);
        let b = atom(0);
        return <button onClick={() => { a = b = nextValue(); }}>{a}{b}</button>;
      }
    `);

    expect((code.match(/nextValue\(\)/g) ?? []).length).toBe(1);
    expect(code).toContain("b.next(__streamixAssigned");
    expect(code).not.toContain("a.next(b =");
  });

  it("returns the assigned value from a chain used in a value position", () => {
    const code = compile(`
      import { atom } from "@epikodelabs/streamix";
      export function C() {
        let a = atom(0);
        let b = atom(0);
        return <button onClick={() => { const result = a = b = 3; console.log(result); }}>{a}{b}</button>;
      }
    `);

    expect(code).toContain("const result = ((__streamixAssigned");
    expect((code.match(/return __streamixAssigned/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(code).not.toContain("b = 3");
  });

  it("does not rewrite a shadowing plain local as an atom target", () => {
    const code = compile(`
      import { atom } from "@epikodelabs/streamix";
      export function C() {
        let a = atom(0);
        let b = atom(0);
        return <button onClick={() => { { let b = 5; a = b = 1; } }}>{a}{b}</button>;
      }
    `);

    expect(code).toContain("a.next(b = 1)");
    expect(code).not.toContain("b.next(");
  });

  it("retains atom identity through a writable alias in a chain", () => {
    const code = compile(`
      import { atom } from "@epikodelabs/streamix";
      export function C() {
        let a = atom(0);
        let b = atom(0);
        let alias = a;
        return <button onClick={() => { alias = b = 2; }}>{alias}{b}</button>;
      }
    `);

    expect(code).toContain("alias.next(");
    expect(code).toContain("b.next(__streamixAssigned");
    expect(code).not.toContain("alias.next(b =");
    expect(code).not.toContain("b = 2");
  });

  it("lowers a compound assignment used as a chain value", () => {
    const code = compile(`
      import { atom } from "@epikodelabs/streamix";
      export function C() {
        let a = atom(0);
        let b = atom(1);
        return <button onClick={() => { a = b += 1; }}>{a}{b}</button>;
      }
    `);

    expect(code).toContain("b.value + 1");
    expect(code).toContain("b.next(__streamixAssigned");
    expect(code).not.toContain("a.next(b +=");
  });

  it("lowers a logical assignment used as a chain value", () => {
    const code = compile(`
      import { atom } from "@epikodelabs/streamix";
      export function C() {
        let flag = atom(false);
        let b = atom(0);
        return <button onClick={() => { flag = b ||= 4; }}>{flag}{b}</button>;
      }
    `);

    expect(code).not.toContain("b ||= 4");
    expect(code).toContain("b.next(4)");
    expect(code).toContain("flag.next(");
  });

  it("lowers a chain in a concise handler body", () => {
    const code = compile(`
      import { atom } from "@epikodelabs/streamix";
      export function C() {
        let a = atom(0);
        let b = atom(0);
        return <button onClick={() => a = b = 1}>{a}{b}</button>;
      }
    `);

    expect(code).toContain("a.next(__streamixAssigned");
    expect(code).toContain("b.next(__streamixAssigned");
    expect(code).not.toContain("a.next(b =");
  });

  it("still lowers JSX assigned to an ordinary local", () => {
    const code = compile(`
      import { atom } from "@epikodelabs/streamix";
      export function C() {
        let a = atom(0);
        let element;
        element = <span>{a}</span>;
        return element;
      }
    `);

    expect(code).toContain("useStreamixSource(a");
    expect(code).toContain("__streamixBinding");
    expect(code).not.toContain("element = a.value");
  });
});
