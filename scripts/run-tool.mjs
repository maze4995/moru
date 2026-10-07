import { build } from "esbuild";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
const projectRoot = fileURLToPath(new URL("..", import.meta.url));
process.chdir(projectRoot);
const tool = process.argv[2];
if (!["seed", "worker", "dots-mcp"].includes(tool))
  throw new Error("Unknown local tool");
const outfile = resolve(`work/runtime/${tool}.mjs`);
await build({
  absWorkingDir: projectRoot,
  entryPoints: [resolve(projectRoot, `scripts/${tool}.ts`)],
  outfile,
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
});
const child = spawn(
  process.execPath,
  ["--env-file=.env.local", outfile, ...process.argv.slice(3)],
  { stdio: "inherit", env: process.env },
);
child.on("exit", (code) => process.exit(code || 0));
