/**
 * Build script for Bento CLI
 *
 * Compiles TypeScript to JavaScript for Node.js compatibility.
 * Uses Bun's bundler with external dependencies (not bundled).
 */

import { $ } from "bun";

const entrypoint = "src/cli.ts";
const outdir = "dist";

console.log("Building Bento CLI...");

// Clean dist folder
await $`rm -rf ${outdir}`;

// Build with Bun
const result = await Bun.build({
  entrypoints: [entrypoint],
  outdir,
  target: "node",
  format: "esm",
  minify: false,
  sourcemap: "external",
  external: [
    // Don't bundle dependencies - they'll be installed via npm
    "@bentonow/bento-node-sdk",
    "@inquirer/prompts",
    "chalk",
    "commander",
    "csv-parse",
    "env-paths",
    "ora",
    "tty-table",
    // Node built-ins
    "node:*",
    "fs",
    "path",
    "os",
    "child_process",
    "events",
    "util",
    "stream",
    "buffer",
    "crypto",
  ],
});

if (!result.success) {
  console.error("Build failed:");
  for (const log of result.logs) {
    console.error(log);
  }
  process.exit(1);
}

console.log(`✓ Built ${result.outputs.length} file(s) to ${outdir}/`);

// Show output files
for (const output of result.outputs) {
  const size = (output.size / 1024).toFixed(1);
  console.log(`  - ${output.path} (${size} KB)`);
}

console.log("\nDone!");
