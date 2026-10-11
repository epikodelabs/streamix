import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "vite";
import { sx } from "./plugin";

describe("Streamix React Vite fixture", () => {
  jasmine.DEFAULT_TIMEOUT_INTERVAL = 20_000;
  it("builds authored TSX through Streamix before the React plugin", async () => {
    const root = await mkdtemp(join(tmpdir(), "streamix-vite-"));
    try {
      const entry = join(root, "src", "main.tsx");
      await mkdir(join(root, "src"), { recursive: true });
      await writeFile(join(root, "tsconfig.json"), JSON.stringify({
        compilerOptions: {
          baseUrl: process.cwd(),
          jsx: "preserve",
          paths: {
            "@epikodelabs/streamix": ["projects/libraries/streamix/src/public-api.ts"],
          },
        },
        include: ["src/**/*.tsx"],
      }));
      await writeFile(join(root, "src", "store.ts"), `
        import { atom, derived } from '@epikodelabs/streamix';
        let price = atom(1);
        export const inc = () => price++;
        export const total = derived(() => price * 2);
      `);
      await writeFile(join(root, "src", "Widget.jsx"), `
        import { atom } from '@epikodelabs/streamix';
        let quantity = atom(1);
        export const Widget = () => <span>{quantity}</span>;
      `);
      await writeFile(entry, `
        import { atom } from "@epikodelabs/streamix";
        import { inc, total } from './store';
        import { Widget } from './Widget';
        export const count = atom(0);
        export function Counter() { return <button onClick={inc}>{count}<Widget />{total}</button>; }
      `);

      const output = await build({
        configFile: false,
        root,
        logLevel: "silent",
        plugins: [sx()],
        esbuild: { jsx: "automatic" },
        build: {
          write: false,
          rollupOptions: {
            input: entry,
            preserveEntrySignatures: "strict",
            external: [
              "react",
              "react/jsx-runtime",
              "react/jsx-dev-runtime",
              "@epikodelabs/streamix",
              "@epikodelabs/streamix/react",
            ],
          },
        },
      }) as { output: Array<{ type: string; code?: string }> };

      const code = output.output
        .filter(item => item.type === "chunk")
        .map(item => item.code ?? "")
        .join("\n");
      expect(code).toContain("useStreamixSource");
      expect(code).toContain("@epikodelabs/streamix/react");
      expect(code).toContain("price.value * 2");
      expect(code).toContain("price.next(");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
