/* Preparation only: no Blockly is loaded by the player. */
window.prepare = async function () {
  const B = Blockly;
  B.ScratchMsgs.setLocale("zh-cn");
  const font = new FontFace("Motion Sans", "url(/font.ttf)");
  await font.load();
  document.fonts.add(font);
  const style = document.createElement("style");
  style.textContent =
    '.blocklyText {font-family:"Motion Sans"!important;font-size:12pt!important;font-weight:400!important}';
  document.head.append(style);
  const ws = B.inject("workspace", {
    media: "/source/media/",
    sounds: false,
    scrollbars: false,
  });
  await document.fonts.ready;
  const resources = {},
    paints = {};
  const num = (value) =>
    `<shadow type="math_number"><field name="NUM">${value}</field></shadow>`;
  const move = (value) =>
    `<block type="motion_movesteps" id="move"><value name="STEPS">${num(value)}</value></block>`;
  const hat = '<block type="event_whenflagclicked" id="start"></block>';
  function create(xml) {
    ws.clear();
    const dom = B.Xml.textToDom(`<xml>${xml}</xml>`);
    [...dom.querySelectorAll("block,shadow")].forEach((node, i) => {
      if (!node.hasAttribute("id")) node.setAttribute("id", `block-${i}`);
    });
    B.Xml.domToWorkspace(dom, ws);
    return ws.getTopBlocks(false)[0];
  }
  async function capture(key, root) {
    root.render();
    await new Promise(requestAnimationFrame);
    const original = root.getSvgRoot();
    const box = original.getBBox(),
      xy = root.getRelativeToSurfaceXY();
    const clone = original.cloneNode(true);
    clone.removeAttribute("transform");
    const anchors = {};
    for (const block of root.getDescendants()) {
      const at = block.getRelativeToSurfaceXY();
      const anchor = {
        opcode: block.type,
        x: at.x - xy.x,
        y: at.y - xy.y,
        fields: {},
        connections: {},
      };
      for (const [name, c] of [
        ["previous", block.previousConnection],
        ["next", block.nextConnection],
        ["output", block.outputConnection],
        ...block.inputList.map((i) => [i.name, i.connection]),
      ]) {
        if (c) anchor.connections[name] = { x: c.x_ - xy.x, y: c.y_ - xy.y };
      }
      for (const input of block.inputList)
        for (const field of input.fieldRow) {
          if (!field.name) continue;
          const rect = field.getSvgRoot()?.getBoundingClientRect();
          const rootRect = original.getBoundingClientRect();
          anchor.fields[field.name] = {
            value: field.getValue(),
            x: rect.x - rootRect.x + box.x,
            y: rect.y - rootRect.y + box.y,
            width: rect.width,
            height: rect.height,
          };
        }
      anchors[block.id] = anchor;
    }
    // Resolve inherited appearance once, keeping paint in an independent stylesheet.
    const originals = [original, ...original.querySelectorAll("*")];
    const copies = [clone, ...clone.querySelectorAll("*")];
    const idMap = new Map();
    for (const [i, el] of copies.entries())
      if (el.id) {
        idMap.set(el.id, `${key}-${i}`);
        el.id = `${key}-${i}`;
      }
    for (let i = 0; i < copies.length; i++) {
      const el = copies[i],
        source = originals[i],
        css = getComputedStyle(source);
      if (["foreignObject", "filter", "script"].includes(el.localName))
        throw Error(`Unsupported SVG ${el.localName}`);
      el.removeAttribute("style");
      for (const attr of [...el.attributes]) {
        if (attr.name.startsWith("on"))
          throw Error("Event attributes are unsupported");
        if (attr.value.includes("url("))
          throw Error(`Unresolved SVG reference: ${attr.value}`);
      }
      for (const prop of ["fill", "stroke"]) {
        const value = css.getPropertyValue(prop);
        el.removeAttribute(prop);
        if (value && value !== "none") {
          if (!(value in paints))
            paints[value] = "paint" + Object.keys(paints).length;
          el.classList.add(`${prop}-${paints[value]}`);
        } else el.setAttribute(prop, "none");
      }
      for (const prop of [
        "stroke-width",
        "fill-opacity",
        "stroke-opacity",
        "opacity",
      ])
        el.setAttribute(prop, css.getPropertyValue(prop));
      el.removeAttribute("filter");
      if (el.localName === "text") {
        el.setAttribute("font-family", "Motion Sans");
        el.setAttribute("font-size", "16");
        el.setAttribute("font-weight", "400");
      }
      if (el.localName === "image") {
        const href = el.getAttribute("href") || el.getAttribute("xlink:href");
        const res = await fetch(href);
        if (!res.ok) throw Error(`Missing image ${href}`);
        const bytes = new Uint8Array(await res.arrayBuffer());
        const data = `data:${res.headers.get("content-type")};base64,${btoa(String.fromCharCode(...bytes))}`;
        el.removeAttribute("href");
        el.setAttributeNS("http://www.w3.org/1999/xlink", "xlink:href", data);
      }
    }
    const content = new XMLSerializer().serializeToString(clone);
    resources[key] = {
      content,
      box: { x: box.x, y: box.y, width: box.width, height: box.height },
      anchors,
    };
  }
  try {
    await capture("hat", create(hat));
    await capture("move10", create(move(10)));
    create(hat + move(10));
    const start = ws.getBlockById("start"),
      moving = ws.getBlockById("move");
    start.nextConnection.connect(moving.previousConnection);
    if (start.getNextBlock() !== moving) throw Error("Connection failed");
    await capture("stack10", start);
    const field = moving.getInputTargetBlock("STEPS").getField("NUM");
    const validated = field.callValidator("20");
    if (validated === null) throw Error("Field validator rejected 20");
    field.setValue(validated === undefined ? "20" : validated);
    if (field.getValue() !== "20") throw Error("Field normalized unexpectedly");
    await capture("stack20", start);
    await capture(
      "nested",
      create(
        '<block type="motion_movesteps"><value name="STEPS"><block type="operator_add"><value name="NUM1">' +
          num(10) +
          '</value><value name="NUM2">' +
          num(20) +
          "</value></block></value></block>",
      ),
    );
    await capture(
      "container",
      create(
        '<block type="control_repeat"><value name="TIMES">' +
          num(10) +
          '</value><statement name="SUBSTACK">' +
          move(20) +
          "</statement></block>",
      ),
    );
    await capture(
      "longText",
      create(
        '<block type="looks_say"><value name="MESSAGE"><shadow type="text"><field name="TEXT">你好，世界！这是一段用于检查中文字体与长文本布局的教程。</field></shadow></value></block>',
      ),
    );
    let rejected = false;
    create(hat + move(10));
    try {
      ws.getBlockById("start").nextConnection.connect(
        ws.getBlockById("move").getInputTargetBlock("STEPS").outputConnection,
      );
    } catch {
      rejected = true;
    }
    if (!rejected) throw Error("Invalid connection was accepted");
    return {
      resources,
      theme: Object.entries(paints)
        .map(
          ([value, id]) =>
            `.fill-${id}{fill:${value}}.stroke-${id}{stroke:${value}}`,
        )
        .join("\n"),
      validation: {
        connected: true,
        fieldValue: "20",
        invalidConnectionRejected: rejected,
      },
    };
  } finally {
    ws.dispose();
    document.getElementById("workspace").remove();
    window.workspaceDisposed = !Object.keys(B.Workspace.WorkspaceDB_).length;
  }
};
