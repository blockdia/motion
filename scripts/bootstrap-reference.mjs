import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { source } from "../adapters/turbowarp/layout.mjs";
const checkout = resolve(process.env.TURBOWARP_GUI || "../scratch-gui");
const dest = resolve(".cache/gui");
await mkdir(dest, { recursive: true });
await rm(dest + "/reference-build.json", { force: true });
const archive = execFileSync(
  "git",
  ["-C", checkout, "archive", source.commit],
  { maxBuffer: 128 * 1024 * 1024 },
);
const unpack = spawnSync("tar", ["-x", "-C", dest], { input: archive });
if (unpack.status !== 0) throw Error(String(unpack.stderr));
// Install the snapshot's own lockfile. Never reuse mutable sibling dependencies.
for (const [cmd, args] of [
  ["npm", ["ci", "--ignore-scripts"]],
  ["node", ["scripts/prepublish.mjs"]],
  ["node", ["node_modules/webpack/bin/webpack.js"]],
]) {
  execFileSync(cmd, args, {
    cwd: dest,
    stdio: "inherit",
    env: { ...process.env, NODE_ENV: "development" },
  });
}
await writeFile(
  dest + "/reference-build.json",
  JSON.stringify(
    {
      ...source,
      lockSha256: createHash("sha256")
        .update(await readFile(dest + "/package-lock.json"))
        .digest("hex"),
    },
    null,
    2,
  ),
);
