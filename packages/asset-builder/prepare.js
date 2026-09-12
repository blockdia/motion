/* Preparation-only pinned Blockly bridge. SVG normalization follows P0. */
window.startPreparation = async function (supported) {
  const B = Blockly;
  B.ScratchMsgs.setLocale('zh-cn');
  const font = new FontFace('Motion Sans', 'url(/font.ttf)');
  await font.load();
  document.fonts.add(font);
  const style = document.createElement('style');
  style.textContent =
    '.blocklyHtmlInput {font-family:"Motion Sans"!important} .blocklyText {font-family:"Motion Sans"!important;font-size:12pt!important;font-weight:400!important}';
  document.head.append(style);
  const ws = B.inject('workspace', {
    media: '/source/media/',
    // An omitted toolbox loads Blockly.Blocks.defaultToolbox, whose IDs can collide with tutorial IDs.
    toolbox: '<xml></xml>',
    sounds: false,
    scrollbars: false,
  });
  await document.fonts.ready;
  const resources = {},
    paints = {};
  async function capture(key, root) {
    root.render();
    await new Promise(requestAnimationFrame);
    const original = root.getSvgRoot();
    const box = original.getBBox(),
      xy = root.getRelativeToSurfaceXY();
    const clone = original.cloneNode(true);
    clone.removeAttribute('transform');
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
        ['previous', block.previousConnection],
        ['next', block.nextConnection],
        ['output', block.outputConnection],
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
    const originals = [original, ...original.querySelectorAll('*')];
    const copies = [clone, ...clone.querySelectorAll('*')];
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
      if (['foreignObject', 'filter', 'script'].includes(el.localName))
        throw Error(`Unsupported SVG ${el.localName}`);
      el.removeAttribute('style');
      for (const attr of [...el.attributes]) {
        if (attr.name.startsWith('on')) throw Error('Event attributes are unsupported');
        if (attr.value.includes('url(')) throw Error(`Unresolved SVG reference: ${attr.value}`);
      }
      for (const prop of ['fill', 'stroke']) {
        const value = css.getPropertyValue(prop);
        el.removeAttribute(prop);
        if (value && value !== 'none') {
          if (!(value in paints)) paints[value] = 'paint' + Object.keys(paints).length;
          el.classList.add(`${prop}-${paints[value]}`);
        } else el.setAttribute(prop, 'none');
      }
      for (const prop of ['stroke-width', 'fill-opacity', 'stroke-opacity', 'opacity'])
        el.setAttribute(prop, css.getPropertyValue(prop));
      el.removeAttribute('filter');
      if (el.localName === 'text') {
        el.setAttribute('font-family', 'Motion Sans');
        el.setAttribute('font-size', '16');
        el.setAttribute('font-weight', '400');
      }
      if (el.localName === 'image') {
        const href = el.getAttribute('href') || el.getAttribute('xlink:href');
        const res = await fetch(href);
        if (!res.ok) throw Error(`Missing image ${href}`);
        const bytes = new Uint8Array(await res.arrayBuffer());
        const data = `data:${res.headers.get('content-type')};base64,${btoa(String.fromCharCode(...bytes))}`;
        el.removeAttribute('href');
        el.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', data);
      }
    }
    const content = new XMLSerializer().serializeToString(clone);
    resources[key] = {
      content,
      box: { x: box.x, y: box.y, width: box.width, height: box.height },
      anchors,
    };
  }

  function connect(a, b) {
    if (!a || !b) throw Error('Missing connection');
    if (a.isConnected() || b.isConnected()) throw Error('Connection is occupied');
    a.checkConnection_(b);
    a.connect(b);
    if (a.targetConnection !== b || b.targetConnection !== a)
      throw Error('Blockly connection rejected');
  }
  function instantiate(def, shadow = false) {
    const rules = supported[def.opcode];
    if (!Object.hasOwn(supported, def.opcode)) throw Error(`Unsupported opcode ${def.opcode}`);
    const fields = Object.keys(def.fields || {}),
      inputs = Object.keys(def.inputs || {});
    if (fields.length !== rules.fields.length || fields.some((k) => !rules.fields.includes(k)))
      throw Error(`Explicit fields required for ${def.opcode}: ${rules.fields}`);
    if (inputs.length !== rules.inputs.length || inputs.some((k) => !rules.inputs.includes(k)))
      throw Error(`Explicit inputs required for ${def.opcode}: ${rules.inputs}`);
    const b = ws.newBlock(def.opcode, def.id);
    if (b.id !== def.id) throw Error(`Blockly did not retain requested ID ${def.id}`);
    if (shadow) b.setShadow(true);
    b.initSvg();
    for (const [name, value] of Object.entries(def.fields || {})) {
      const f = b.getField(name);
      if (!f) throw Error(`Missing field ${def.id}.${name}`);
      const validated = f.callValidator(value);
      if (validated === null) throw Error(`Field rejected ${def.id}.${name}: ${value}`);
      f.setValue(validated === undefined ? value : validated);
      const actual = String(f.getValue());
      if (actual !== value)
        throw Error(
          `Field normalized ${def.id}.${name}: requested ${JSON.stringify(value)}, actual ${JSON.stringify(actual)}`,
        );
    }
    for (const [name, input] of Object.entries(def.inputs || {})) {
      const child = instantiate(input.shadow || input.block, !!input.shadow);
      connect(b.getInput(name)?.connection, child.outputConnection || child.previousConnection);
    }
    if (def.next) connect(b.nextConnection, instantiate(def.next).previousConnection);
    b.render();
    return b;
  }
  window.prepareBlock = async (key, def, editing) => {
    ws.clear();
    try {
      const root = instantiate(def);
      if (editing) {
        const field = ws.getBlockById(editing.id)?.getField(editing.name);
        if (!field) throw Error(`Missing editing field ${editing.id}.${editing.name}`);
        // Match the real text editor, including transient setText (not final field validation).
        B.FieldTextInput.prototype.showEditor_.call(field, true);
        const input = B.FieldTextInput.htmlInput_;
        const widget = B.WidgetDiv.DIV;
        widget.style.transition = 'none';
        input.style.transition = 'none';
        input.value = editing.text;
        field.onHtmlInputChange_({ type: 'input' });
        field.resizeEditor_();
        await capture(key, root);
        field.resizeEditor_();
        const rect = widget.getBoundingClientRect(),
          rootRect = root.getSvgRoot().getBoundingClientRect();
        const box = resources[key].box;
        const widgetCss = getComputedStyle(widget),
          inputCss = getComputedStyle(input);
        const bounds = {
          x: rect.x - rootRect.x + box.x,
          y: rect.y - rootRect.y + box.y,
          width: rect.width,
          height: rect.height,
        };
        const canvas = document.createElement('canvas'),
          ctx = canvas.getContext('2d');
        ctx.font = `${inputCss.fontWeight} ${inputCss.fontSize} "Motion Sans"`;
        const metrics = ctx.measureText(editing.text);
        resources[key].input = {
          bounds,
          text: editing.text,
          radius: parseFloat(widgetCss.borderRadius),
          borderWidth: parseFloat(widgetCss.borderWidth),
          fontSize: parseFloat(inputCss.fontSize),
          fontWeight: inputCss.fontWeight,
          baseline:
            bounds.y +
            bounds.height / 2 +
            (metrics.fontBoundingBoxAscent - metrics.fontBoundingBoxDescent) / 2,
          textWidth: metrics.width,
          padding: parseFloat(inputCss.paddingLeft) + parseFloat(widgetCss.borderWidth),
          fill: inputCss.backgroundColor,
          stroke: widgetCss.borderColor,
          textColor: inputCss.color,
          shadowColor: B.Colours.fieldShadow,
          shadowWidth: 4,
        };
      } else await capture(key, root);
      return {
        resource: resources[key],
        theme: Object.entries(paints)
          .map(([value, id]) => `.fill-${id}{fill:${value}}.stroke-${id}{stroke:${value}}`)
          .join('\n'),
      };
    } finally {
      // Widget disposal commits its temporary text before destroying the preparation workspace.
      B.WidgetDiv.hide(true);
      ws.clear();
    }
  };
  window.disposePreparation = () => {
    ws.dispose();
    document.getElementById('workspace').remove();
    return !Object.keys(B.Workspace.WorkspaceDB_).length;
  };
};
