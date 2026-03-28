import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["cjs"],
  target: "node18",
  outDir: "dist",
  clean: true,
  splitting: false,
  sourcemap: false,
  minify: false,
  banner: {
    js: "#!/usr/bin/env node",
  },
});
