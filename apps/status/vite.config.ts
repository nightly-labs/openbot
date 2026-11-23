import solidPlugin from "@solidjs/vite-plugin";
import { defineConfig } from "vite";

export default defineConfig({
  resolve: { dedupe: ["solid-js", "@solidjs/web", "@solidjs/signals"] },
  plugins: [solidPlugin()],
  base: "./",
  build: { outDir: "dist", emptyOutDir: true },
});
