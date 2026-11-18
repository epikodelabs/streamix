// The Streamix Vue builder loads this config from the virtual project and
// overlays root, outDir, and the dev-server port. Streamix SFC transforms
// already ran in the virtual tree, so Vue and Tailwind own the rest.
import fs from "node:fs";
import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

const CONTENT_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

export default defineConfig(() => {
  // The virtual project root is the authored src directory.
  const sourceRoot = import.meta.dirname;
  let outDir = "";
  return {
    base: "./",
    plugins: [
      vue(),
      tailwindcss(),
      {
        // The app references plate images by the sibling project's root-relative
        // URLs (`/src/assets/...`). Serve and emit that layout unchanged.
        name: "streamix-quiz-assets",
        configResolved(config) {
          outDir = path.resolve(config.root, config.build.outDir);
        },
        configureServer(server) {
          const prefix = "/src/assets/";
          const assetsDir = path.join(sourceRoot, "assets");
          server.middlewares.use((request, response, next) => {
            const url = (request.url ?? "").split("?")[0];
            if (!url.startsWith(prefix)) { next(); return; }
            const file = path.resolve(assetsDir, decodeURIComponent(url.slice(prefix.length)));
            if (!file.startsWith(assetsDir + path.sep) || !fs.existsSync(file)) { next(); return; }
            response.setHeader("Content-Type", CONTENT_TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream");
            fs.createReadStream(file).pipe(response);
          });
        },
        closeBundle(error?: Error) {
          if (error) return;
          const assets = path.join(sourceRoot, "assets");
          if (outDir && fs.existsSync(assets)) {
            fs.cpSync(assets, path.join(outDir, "src/assets"), { recursive: true, force: true });
          }
        },
      },
    ],
    resolve: {
      alias: { "@": sourceRoot },
    },
  };
});
