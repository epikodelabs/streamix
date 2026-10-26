// The Streamix Vue builder loads this config from the virtual project and
// overlays root, outDir, and the dev-server port. Vue owns its plugin stack
// here; Streamix SFC transforms already ran in the virtual tree.
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  base: "./",
  plugins: [vue()],
});
