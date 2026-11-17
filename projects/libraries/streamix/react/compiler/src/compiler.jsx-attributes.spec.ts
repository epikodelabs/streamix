import { transformReactJsx } from "./compiler";

const compile = (source: string) => transformReactJsx(source, "component.tsx");
const errorsOf = (source: string) => compile(source).diagnostics.filter(diagnostic => diagnostic.category === "error");

describe("React JSX attribute contracts", () => {
  it("lowers reactive atom spreads to their values on intrinsic and component elements", () => {
    for (const tag of ["div", "Child"]) {
      const result = compile(`
        import { atom } from "@epikodelabs/streamix";
        const props = atom({ title: "one" });
        export function View() { return <${tag} {...props} />; }
      `);

      expect(result.diagnostics.filter(diagnostic => diagnostic.category === "error")).toEqual([]);
      expect(result.code).toContain('useStreamixSource(props, "props")');
      expect(result.code).toContain("{...__streamixBinding");
      expect(result.code).not.toContain("{...props}");
    }
  });

  it("lowers an explicit value spread without producing a second .value read", () => {
    const result = compile(`
      import { atom } from "@epikodelabs/streamix";
      const props = atom({ title: "one" });
      export function View() { return <div {...props.value} />; }
    `);

    expect(result.diagnostics.filter(diagnostic => diagnostic.category === "error")).toEqual([]);
    expect(result.code).toContain("{...__streamixBinding");
    expect(result.code).not.toContain("props.value");
  });

  it("leaves ordinary object spreads untouched", () => {
    const result = compile(`export function View() { return <div {...{ id: "x" }} />; }`);

    expect(result.diagnostics.filter(diagnostic => diagnostic.category === "error")).toEqual([]);
    expect(result.code).not.toContain("useStreamixSource");
    expect(result.code).toContain("id");
  });

  it("rejects atom values in the native ref slot", () => {
    for (const expression of ["count", "count.value"]) {
      const diagnostics = errorsOf(`
        import { atom } from "@epikodelabs/streamix";
        const count = atom(0);
        export function View() { return <div ref={${expression}} />; }
      `);
      expect(diagnostics.length).toBe(1);
      expect(diagnostics[0].message).toContain("ref slot");
      expect(diagnostics[0].message).toContain("transport the atom");
    }
  });

  it("preserves valid native refs and component ref transport", () => {
    const valid = compile(`
      import { atom } from "@epikodelabs/streamix";
      const count = atom(0);
      export function View() {
        const ref = () => {};
        return <div ref={ref} />;
      }
    `);
    expect(valid.diagnostics.filter(diagnostic => diagnostic.category === "error")).toEqual([]);
    expect(valid.code).toContain("ref={ref}");

    const transport = compile(`
      import { atom } from "@epikodelabs/streamix";
      const count = atom(0);
      export function View() { return <Child ref={count} />; }
    `);
    expect(transport.diagnostics.filter(diagnostic => diagnostic.category === "error")).toEqual([]);
    expect(transport.code).toContain("ref={count}");
  });

  it("respects shadowed names in ref and spread positions", () => {
    const result = compile(`
      import { atom } from "@epikodelabs/streamix";
      const count = atom(0);
      const attrs = atom({ title: "one" });
      export function View() {
        const count = 5;
        const attrs = { id: "x" };
        return <div ref={count} {...attrs} />;
      }
    `);

    expect(result.diagnostics.filter(diagnostic => diagnostic.category === "error")).toEqual([]);
    expect(result.code).toContain("ref={count}");
    expect(result.code).toContain("{...attrs}");
    expect(result.code).not.toContain("useStreamixSource");
  });
});
