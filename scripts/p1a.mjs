import { execFileSync } from "node:child_process";
import { readFile, writeFile, copyFile, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
import { layout, source } from "../adapters/turbowarp/layout.mjs";
const dest = "docs/p1a-baseline";
const reference = JSON.parse(await readFile(dest + "/reference.json", "utf8"));
assert.equal(reference.commit, source.commit);
// Compare actual reference regions with the controlled layout, including borders.
const comparisons = [
  ["menu", layout.menu],
  ["tabs", layout.tabs],
  ["stage", layout.stage],
  ["sprite", layout.sprites],
  ["flyout", layout.toolbox],
  ["categories", layout.categories],
];
for (const [name, rect] of comparisons)
  for (const key of ["x", "y", "width", "height"])
    assert.ok(
      Math.abs(reference.measured[name][key] - rect[key]) <= 1,
      `${name}.${key} differs from reference`,
    );
execFileSync(process.execPath, ["scripts/p0.mjs"], { stdio: "inherit" });
await mkdir(dest, { recursive: true });
for (const name of [
  "initial",
  "drag-hat",
  "drag-move",
  "connected10",
  "connected20",
])
  for (const backend of ["browser", "video"])
    await copyFile(
      `artifacts/${backend}-${name}.png`,
      `${dest}/${backend}-${name}.png`,
    );
const report = JSON.parse(await readFile("artifacts/report.json", "utf8"));
await writeFile(
  dest + "/report.json",
  JSON.stringify(
    {
      ...report,
      referenceCommit: reference.commit,
      layoutComparison: "all measured region edges within 1px",
    },
    null,
    2,
  ),
);
