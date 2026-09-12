// Run after reference.mjs. Only explicitly selected static controls enter the template.
import { readFile, writeFile } from "node:fs/promises";
const { images } = JSON.parse(
  await readFile(".cache/reference-details.json", "utf8"),
);
const names = [
  "settings",
  "caret-settings",
  "file",
  "caret-file",
  "edit",
  "caret-edit",
  "addons",
  "advanced",
  "project-page",
  "code",
  "costume",
  "sound",
  "extension",
  "flag",
  "pause",
  "stop",
  "small-stage",
  "large-stage",
  "fullscreen",
  "x",
  "y",
  "show",
  "hide",
];
const selected = [
  ...names.map((name, i) => [name, i]),
  ["choose-sprite", 25],
  ["choose-backdrop", 31],
];
const icons = {};
for (const [name, i] of selected) {
  const im = images[i];
  let svg;
  if (im.src.startsWith("data:")) {
    const comma = im.src.indexOf(",");
    svg = im.src.slice(0, comma).includes("base64")
      ? Buffer.from(im.src.slice(comma + 1), "base64").toString()
      : decodeURIComponent(im.src.slice(comma + 1));
  } else svg = await readFile(".cache/gui-icons/" + im.file, "utf8");
  // Resolve the grayscale applied by the source UI to inactive controls.
  if (["costume", "sound", "small-stage", "fullscreen", "hide"].includes(name))
    svg = svg.replace(/#[\da-f]{6}/gi, "#777777");
  if (["flag", "pause", "stop"].includes(name)) {
    im.x += 6;
    im.y += 6;
    im.width = 20;
    im.height = 20;
  }
  icons[name] = {
    x: im.x,
    y: im.y,
    width: im.width,
    height: im.height,
    uri: "data:image/svg+xml;base64," + Buffer.from(svg).toString("base64"),
  };
}
await writeFile(
  "adapters/turbowarp/icons.mjs",
  "// Extracted from fixed TurboWarp GUI; see THIRD_PARTY_NOTICES.md.\nexport const icons = " +
    JSON.stringify(icons, null, 2) +
    ";\n",
);
