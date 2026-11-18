import { transformReactJsx } from "./compiler";

describe("React JSX scope member classification", () => {
  it("bridges a nested scope value read through the nested scope", () => {
    const result = transformReactJsx(`
      function Profile() {
        const state = scope({ profile: { name: "Ada", age: 36 } });
        return <output>{state.profile.name}</output>;
      }
    `);

    expect(result.diagnostics).toEqual([]);
    expect(result.bindingCount).toBe(1);
    expect(result.code).toContain(
      'useStreamixSource(state.get("profile").get("name"), "state.profile.name")',
    );
    expect(result.code).toContain("{__streamixBinding0}");
  });

  it("never bridges or invokes a method member", () => {
    const result = transformReactJsx(`
      function Counter() {
        const state = scope({ count: 0, increment: method(self => self.count++) });
        return <button onClick={() => state.increment()}>{state.count}</button>;
      }
    `);

    expect(result.diagnostics).toEqual([]);
    expect(result.bindingCount).toBe(1);
    expect(result.code).not.toContain('state.get("increment")');
    expect(result.code).toContain("state.increment()");
    expect(result.code).toContain('useStreamixSource(state.get("count"), "state.count")');
  });

  it("recognizes an aliased method(...) import", () => {
    const result = transformReactJsx(`
      import { method as action, scope } from "@epikodelabs/streamix";
      function Counter() {
        const state = scope({ count: 0, increment: action(self => self.count++) });
        return <button onClick={() => state.increment()}>{state.count}</button>;
      }
    `);

    expect(result.diagnostics).toEqual([]);
    expect(result.code).not.toContain('state.get("increment")');
    expect(result.code).toContain("state.increment()");
  });

  it("leaves a whole nested scope reference authored", () => {
    const result = transformReactJsx(`
      function Profile() {
        const state = scope({ profile: { name: "Ada" } });
        return <Editor state={state.profile} />;
      }
    `);

    expect(result.diagnostics).toEqual([]);
    expect(result.bindingCount).toBe(0);
    expect(result.code).toContain("state={state.profile}");
    expect(result.code).not.toContain('state.get("profile")');
  });

  it("bridges a value member prefix and keeps its property reads", () => {
    const result = transformReactJsx(`
      function Profile() {
        const state = scope({ form: atom({ name: "Ada" }) });
        return <output>{state.form.name}</output>;
      }
    `);

    expect(result.diagnostics).toEqual([]);
    expect(result.code).toContain('useStreamixSource(state.get("form"), "state.form")');
    expect(result.code).toContain("{__streamixBinding0.name}");
  });

  it("reports a missing scope member instead of subscribing to it", () => {
    const result = transformReactJsx(`
      function Profile() {
        const state = scope({ profile: { name: "Ada" } });
        return <output>{state.missing}</output>;
      }
    `);

    expect(result.diagnostics.length).toBe(1);
    expect(result.diagnostics[0].message).toContain("state.missing");
    expect(result.bindingCount).toBe(0);
  });

  it("classifies nested scope reads and method calls in class components", () => {
    const result = transformReactJsx(`
      const state = scope({
        profile: { name: "Ada" },
        count: 0,
        increment: method(self => self.count++),
      });
      class Profile extends React.Component {
        render() {
          return <button onClick={() => state.increment()}>{state.profile.name} {state.count}</button>;
        }
      }
    `);

    expect(result.diagnostics).toEqual([]);
    expect(result.code).toContain(
      'useStreamixSource(state.get("profile").get("name"), "state.profile.name")',
    );
    expect(result.code).toContain('useStreamixSource(state.get("count"), "state.count")');
    expect(result.code).not.toContain('state.get("increment")');
    expect(result.code).toContain("state.increment()");
  });

  it("rejects reads through a nested scope the compiler cannot inspect", () => {
    const result = transformReactJsx(`
      function Profile() {
        const state = scope({ profile: scope(() => ({ name: "Ada" })) });
        return <output>{state.profile.name}</output>;
      }
    `);

    expect(result.diagnostics.length).toBe(1);
    expect(result.diagnostics[0].message).toContain("cannot inspect");
    expect(result.bindingCount).toBe(0);
  });
});
