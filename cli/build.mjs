import { build } from "esbuild";
import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
await build({
  absWorkingDir: dirname(fileURLToPath(import.meta.url)),
  entryPoints: ["src/index.ts"],
  outfile: "dist/bottle.mjs",
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  banner: { js: "#!/usr/bin/env node" },
  define: {
    BOTTLE_VERSION: JSON.stringify(version),
    // The published CLI talks to the public server unless BOTTLE_URL or --server says otherwise.
    BOTTLE_DEFAULT_SERVER: JSON.stringify(process.env.BOTTLE_DEFAULT_SERVER ?? "http://localhost:3000"),
  },
});
console.log(`built dist/bottle.mjs (${version})`);
