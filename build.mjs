import { build } from "esbuild";

await build({
  entryPoints: ["src/preview-storage.ts"],
  outfile: "docs/preview-storage.js",
  bundle: true,
  format: "iife",
  platform: "browser",
  target: ["es2020"],
  legalComments: "none",
  sourcemap: false,
});
