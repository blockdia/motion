/* Preparation-only pinned Blockly bridge. SVG normalization preserves measured geometry and internal references. */
window.startPreparation = async function (
  project,
  locale = 'zh-CN',
  theme = 'light',
  fontConfig = { family: 'system-ui, sans-serif' },
) {
  // The pinned editor intentionally randomizes colour_picker defaults and generated IDs.
  // A preparation-only seed makes those real defaults reproducible, without replacing definitions.
  const originalRandom = Math.random;
  let randomState = 0x4d6f7469;
  Math.random = () => {
    randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
    return randomState / 4294967296;
  };
  const B = Blockly;
  window.editorAppearance = window.prepareEditorTheme(theme);
  B.Events.disable();
  B.recordSoundCallback = () => {};
  const editor = window.createEditorContext(project);
  let currentTarget;
  B.ScratchMsgs.setLocale(locale === 'zh-CN' ? 'zh-cn' : 'en');
  const fontFamily = fontConfig.family;
  if (fontConfig.url) {
    const font = await new FontFace(fontFamily, `url(${JSON.stringify(fontConfig.url)})`).load();
    document.fonts.add(font);
  }
  await document.fonts.load(`16px ${fontFamily}`);
  await document.fonts.ready;
  const style = document.createElement('style');
  document.head.append(style);
  style.sheet.insertRule('.blocklyHtmlInput,.blocklyText {}');
  const rule = style.sheet.cssRules[0].style;
  rule.setProperty('font-family', fontFamily, 'important');
  style.sheet.insertRule('.blocklyText {font-size:12pt!important;font-weight:400!important}', 1);
  const ws = B.inject('workspace', {
    media: new URL('media/', location.href).href,
    // An omitted toolbox loads Blockly.Blocks.defaultToolbox, whose IDs can collide with tutorial IDs.
    toolbox: '<xml></xml>',
    sounds: false,
    scrollbars: false,
  });
  await document.fonts.ready;
  const resources = {},
    paints = {};
  async function capture(key, root) {
    const blockScale = root.workspace.scale;
    root.render();
    await new Promise(requestAnimationFrame);
    const original = root.getSvgRoot();
    const box = original.getBBox(),
      xy = root.getRelativeToSurfaceXY();
    const clone = original.cloneNode(true);
    let replacementFilter;
    clone.removeAttribute('transform');
    const anchors = {};
    for (const block of root.getDescendants()) {
      if (block.isInsertionMarker()) continue;
      const at = block.getRelativeToSurfaceXY();
      const anchor = {
        opcode: block.type,
        bounds: (() => {
          const b = block.svgPath_.getBBox();
          return { x: at.x - xy.x + b.x, y: at.y - xy.y + b.y, width: b.width, height: b.height };
        })(),
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
            x: (rect.x - rootRect.x) / blockScale + box.x,
            y: (rect.y - rootRect.y) / blockScale + box.y,
            width: rect.width / blockScale,
            height: rect.height / blockScale,
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
      const nativeFilter = el.getAttribute('filter');
      el.removeAttribute('filter');
      if (nativeFilter) {
        const id = root.workspace.options.replacementGlowFilterId;
        if (nativeFilter !== `url(#${id})`) throw Error('Unsupported native filter');
        replacementFilter = document.getElementById(id).cloneNode(true);
        replacementFilter.id = key + '-replacement';
      }
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
      if (nativeFilter) el.setAttribute('filter', `url(#${key}-replacement)`);
      if (el.localName === 'text') {
        el.setAttribute('font-family', fontFamily);
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
    if (replacementFilter) {
      const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
      defs.append(replacementFilter);
      clone.prepend(defs);
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
    if (!Object.hasOwn(B.Blocks, def.opcode)) throw Error(`Unsupported opcode ${def.opcode}`);
    const b = ws.newBlock(def.opcode, def.id);
    if (def.mutation) {
      const mutation = B.Xml.textToDom(`<xml>${def.mutation}</xml>`).firstElementChild;
      if (mutation?.tagName !== 'mutation' || !b.domToMutation)
        throw Error('CAPABILITY: Unsupported mutation');
      b.domToMutation(mutation);
    }
    if (b.id !== def.id) throw Error(`Blockly did not retain requested ID ${def.id}`);
    if (shadow) b.setShadow(true);
    b.initSvg();
    for (const [name, value] of Object.entries(def.fields || {})) {
      const f = b.getField(name);
      if (!f) throw Error(`Missing field ${def.id}.${name}`);
      if (f.referencesVariables() && !ws.getVariableById(value))
        throw Error(`Field variable is outside target context: ${value}`);
      if (
        f instanceof B.FieldDropdown &&
        !f.referencesVariables() &&
        !f.getOptions().some((o) => String(o[1]) === value)
      )
        throw Error(`Field option rejected ${def.id}.${name}: ${value}`);
      const validated = f.callValidator(value);
      if (validated === null) throw Error(`Field rejected ${def.id}.${name}: ${value}`);
      f.setValue(validated === undefined ? value : validated);
      const actual = String(f.getValue());
      if (actual !== value)
        throw Error(
          `Field normalized ${def.id}.${name}: requested ${JSON.stringify(value)}, actual ${JSON.stringify(actual)}`,
        );
    }
    const actualFields = b.inputList.flatMap((i) => i.fieldRow).filter((f) => f.name);
    for (const f of actualFields)
      if (!Object.hasOwn(def.fields || {}, f.name))
        throw Error(`Explicit field required: ${def.id}.${f.name}`);
    for (const [name, input] of Object.entries(def.inputs || {})) {
      let shadowDom;
      if (input.shadow && input.block) {
        const shadow = instantiate(input.shadow, true);
        shadowDom = B.Xml.blockToDom(shadow);
        shadow.dispose(false);
      }
      const child = instantiate(input.block || input.shadow, !input.block);
      connect(b.getInput(name)?.connection, child.outputConnection || child.previousConnection);
      if (shadowDom) b.getInput(name).connection.setShadowDom(shadowDom);
    }
    if (def.next) connect(b.nextConnection, instantiate(def.next).previousConnection);
    b.render();
    return b;
  }
  window.prepareContextMenu = (def, id) => {
    seedWorkspace(ws, currentTarget);
    const originalShow = B.ContextMenu.show;
    try {
      instantiate(def);
      const block = ws.getBlockById(id);
      if (!block || block.isShadow()) throw Error('CAPABILITY: No block context menu');
      let captured;
      const deleteLabel = B.ContextMenu.blockDeleteOption(block).text;
      B.ContextMenu.show = (_event, options) => {
        captured = options;
      };
      block.showContextMenu_({ clientX: 0, clientY: 0, preventDefault() {}, stopPropagation() {} });
      if (!captured?.length) throw Error('CAPABILITY: No block context menu');
      const ctx = document.createElement('canvas').getContext('2d');
      ctx.font = `13px ${fontFamily}`;
      return {
        options: captured.map((o, i) => [o.text, o.text === deleteLabel ? 'delete' : `item:${i}`]),
        enabled: captured.map((o) => !!o.enabled),
        width: Math.max(160, ...captured.map((o) => ctx.measureText(o.text).width + 32)),
        rowHeight: 28,
        fontSize: 13,
        fill: B.Colours.contextMenuBackground,
        stroke: B.Colours.contextMenuBorder,
        context: true,
      };
    } finally {
      B.ContextMenu.show = originalShow;
      B.ContextMenu.currentBlock = null;
      ws.clear();
    }
  };
  window.deleteBlock = (def, id) => {
    seedWorkspace(ws, currentTarget);
    try {
      const root = instantiate(def),
        origin = root.getRelativeToSurfaceXY();
      const block = ws.getBlockById(id);
      if (!block || block.isShadow()) throw Error('CAPABILITY: Cannot delete shadow');
      block.dispose(true, false);
      return ws
        .getTopBlocks(false)
        .filter((b) => !b.isShadow() && !b.type.startsWith('procedures_'))
        .map((b) => {
          const at = b.getRelativeToSurfaceXY();
          return {
            block: definitionFromXml(B.Xml.blockToDom(b), b.id, true),
            position: { x: at.x - origin.x, y: at.y - origin.y },
          };
        });
    } finally {
      ws.clear();
    }
  };
  window.prepareMenu = (def, target) => {
    seedWorkspace(ws, currentTarget);
    try {
      instantiate(def);
      const field = ws.getBlockById(target.id)?.getField(target.name);
      if (!(field instanceof B.FieldDropdown))
        throw Error('CAPABILITY: choose requires a dropdown');
      const options = field.getOptions();
      if (options.some((o) => typeof o[0] !== 'string' || typeof o[1] !== 'string'))
        throw Error('CAPABILITY: Image menu options are not supported');
      const source = field.sourceBlock_;
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      ctx.font = `bold 13px ${fontFamily}`;
      return {
        options,
        width: Math.max(150, ...options.map((o) => ctx.measureText(o[0]).width + 60)),
        rowHeight: 32,
        fontSize: 13,
        fill: (source.isShadow() ? source.getParent() : source).getColour(),
        stroke: source.getColourTertiary(),
      };
    } finally {
      ws.clear();
    }
  };
  window.prepareBlock = async (key, def, editing, markerId, dropdown) => {
    seedWorkspace(ws, currentTarget);
    try {
      function xmlFor(def, tag = 'block') {
        const xml = document.createElement(tag);
        xml.setAttribute('type', def.opcode);
        xml.setAttribute('id', def.id);
        for (const [name, value] of Object.entries(def.fields || {})) {
          const field = document.createElement('field');
          field.setAttribute('name', name);
          field.textContent = value;
          xml.append(field);
        }
        for (const [name, input] of Object.entries(def.inputs || {})) {
          const value = document.createElement('value');
          value.setAttribute('name', name);
          for (const [tag, child] of Object.entries(input)) value.append(xmlFor(child, tag));
          xml.append(value);
        }
        if (def.next) {
          const next = document.createElement('next');
          next.append(xmlFor(def.next));
          xml.append(next);
        }
        return xml;
      }
      editor.sync(xmlFor(def).outerHTML);
      const root = instantiate(def);
      if (markerId) {
        const source = ws.getBlockById(markerId);
        const connection = source.outputConnection || source.previousConnection;
        const parent = connection?.targetConnection;
        if (!parent) throw Error('CAPABILITY: Missing insertion parent');
        if (source.outputConnection) {
          source.dispose(false, false);
          root.render();
          if (parent.targetBlock()) parent.targetBlock().highlightForReplacement(true);
          else parent.sourceBlock_.highlightShapeForInput(parent, true);
        } else {
          let previewId = markerId + ':preview';
          while (ws.getBlockById(previewId)) previewId += ':preview';
          const marker = ws.newBlock(source.type, previewId);
          marker.setInsertionMarker(true, source.width);
          marker.initSvg();
          source.dispose(false, false);
          marker.render();
          parent.connect(marker.outputConnection || marker.previousConnection);
        }
      }
      if (dropdown) ws.getBlockById(dropdown.id).getField(dropdown.name).showEditor_();
      if (editing) {
        const field = ws.getBlockById(editing.id)?.getField(editing.name);
        if (!field) throw Error(`Missing editing field ${editing.id}.${editing.name}`);
        if (!(field instanceof B.FieldTextInput) || field instanceof B.FieldDropdown)
          throw Error('CAPABILITY: type requires a text input field');
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
        ctx.font = `${inputCss.fontWeight} ${inputCss.fontSize} ${fontFamily}`;
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
          ...(editing.preeditStart === undefined
            ? {}
            : {
                preeditOffset: ctx.measureText(editing.text.slice(0, editing.preeditStart)).width,
              }),
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
      B.DropDownDiv.hideWithoutAnimation();
      B.WidgetDiv.hide(true);
      ws.clear();
    }
  };

  function seedWorkspace(workspace, id) {
    workspace.clear();
    workspace.getVariableMap().clear();
    const target = project.targets.find((t) => t.id === id);
    if (!target) throw Error(`Unknown target ${id}`);
    const stage = project.targets.find((t) => t.isStage);
    for (const owner of target.isStage ? [stage] : [stage, target])
      for (const v of owner.variables) {
        const created = workspace.createVariable(v.name, v.type, v.id, !owner.isStage, false);
        if (created.getId() !== v.id)
          throw Error(
            `CAPABILITY: Blockly cannot preserve variable identity ${v.id} (${v.name}) in this context`,
          );
      }
    for (const [i, p] of target.procedures.entries()) {
      const prototype = workspace.newBlock('procedures_prototype', `@context.procedure.${i}`);
      const mutation = document.createElement('mutation');
      for (const [name, value] of Object.entries({
        proccode: p.code,
        argumentids: JSON.stringify(p.argumentIds),
        argumentnames: JSON.stringify(p.argumentNames),
        argumentdefaults: JSON.stringify(p.argumentDefaults),
        warp: String(p.warp),
      }))
        mutation.setAttribute(name, value);
      prototype.domToMutation(mutation);
      prototype.initSvg();
      prototype.render();
    }
  }
  window.selectPreparationTarget = (id) => {
    currentTarget = id;
    editor.select(id);
  };
  const catalogHost = document.createElement('div');
  catalogHost.style.cssText = 'width:780px;height:590px';
  document.body.append(catalogHost);
  const catalogWs = B.inject(catalogHost, {
    media: new URL('media/', location.href).href,
    toolbox: '<xml><category name="Loading" id="loading"/></xml>',
    sounds: false,
    scrollbars: true,
    zoom: { startScale: 0.675 },
  });
  // These buttons are visible but are not authoring operations in Motion.
  for (const key of ['CREATE_VARIABLE', 'CREATE_LIST', 'CREATE_PROCEDURE', 'OPEN_RETURN_DOCS'])
    catalogWs.registerButtonCallback(key, () => {});
  function definitionFromXml(xml, id = 'entry', preserveIds = false) {
    if (preserveIds) id = xml.getAttribute('id') || id;
    const definition = { id, opcode: xml.getAttribute('type') };
    for (const child of xml.children) {
      if (child.tagName.toLowerCase() === 'field') {
        (definition.fields ??= {})[child.getAttribute('name')] =
          child.getAttribute('id') || child.textContent;
      } else if (child.tagName.toLowerCase() === 'mutation') {
        definition.mutation = new XMLSerializer().serializeToString(child);
      } else if (
        child.tagName.toLowerCase() === 'value' ||
        child.tagName.toLowerCase() === 'statement'
      ) {
        const name = child.getAttribute('name');
        const input = {};
        for (const nested of child.children)
          if (['block', 'shadow'].includes(nested.tagName.toLowerCase()))
            input[nested.tagName.toLowerCase()] = definitionFromXml(
              nested,
              `${id}.${name}.${nested.tagName.toLowerCase()}`,
              preserveIds,
            );
        if (Object.keys(input).length) (definition.inputs ??= {})[name] = input;
      } else if (child.tagName.toLowerCase() === 'next' && child.firstElementChild)
        definition.next = definitionFromXml(child.firstElementChild, `${id}.next`, preserveIds);
    }
    return definition;
  }
  window.extractCatalog = async (id) => {
    window.selectPreparationTarget(id);
    seedWorkspace(catalogWs, id);
    const xml = editor.select(id);
    catalogWs.updateToolbox(xml);
    const flyout = catalogWs.getFlyout();
    await new Promise(requestAnimationFrame);
    // Match the GUI's live target-position defaults after toolbox construction.
    const target = project.targets.find((t) => t.id === id);
    for (const prefix of ['glide', 'move', 'set'])
      for (const axis of ['x', 'y']) {
        const block = flyout.workspace_.getBlockById(`${prefix}${axis}`);
        if (block) block.setFieldValue(String(Math.round(target[axis])), 'NUM');
      }
    // Mirror the GUI's flyout block listener before asking VM-backed dependent menus.
    editor.sync(
      flyout.workspace_
        .getTopBlocks(false)
        .map((b) => B.Xml.domToText(B.Xml.blockToDom(b)))
        .join(''),
      true,
    );
    for (const block of flyout.workspace_.getAllBlocks())
      for (const input of block.inputList)
        for (const field of input.fieldRow) {
          if (field instanceof B.FieldDropdown && !field.referencesVariables()) {
            const options = field.getOptions();
            if (
              !options.some((o) => o[1] === field.getValue()) &&
              typeof options[0]?.[1] === 'string'
            )
              field.setValue(options[0][1]);
          }
        }
    flyout.reflow();
    const scale = catalogWs.scale;
    const cats = catalogWs.getToolbox().categoryMenu_.categories_;
    const categories = flyout.categoryScrollPositions.map((c, i) => ({
      key: c.categoryId,
      label: B.utils.replaceMessageReferences(c.categoryName),
      scroll: c.position * scale,
      color: cats[i].colour_,
      borderColor: cats[i].secondaryColour_,
    }));
    const entries = [];
    for (const [index, root] of flyout.workspace_
      .getTopBlocks(false)
      .sort((a, b) => a.getRelativeToSurfaceXY().y - b.getRelativeToSurfaceXY().y)
      .entries()) {
      const at = root.getRelativeToSurfaceXY();
      const category = categories.filter((c) => c.scroll <= at.y * scale).at(-1)?.key;
      const xmlBlock = B.Xml.blockToDom(root);
      const definition = definitionFromXml(xmlBlock);
      const mapping = {},
        metadata = {};
      function describe(block, def) {
        mapping[block.id] = def.id;
        const fields = {};
        for (const input of block.inputList)
          for (const f of input.fieldRow)
            if (f.name) {
              fields[f.name] = {
                value: String(f.getValue()),
                kind: f.referencesVariables()
                  ? 'variable'
                  : f instanceof B.FieldDropdown
                    ? 'dropdown'
                    : f instanceof B.FieldTextInput
                      ? 'text'
                      : 'other',
              };
              if (f instanceof B.FieldDropdown) {
                fields[f.name].options = f
                  .getOptions()
                  .filter((o) => typeof o[1] === 'string')
                  .map((o) => [typeof o[0] === 'string' ? o[0] : o[0].alt || '', o[1]]);
                fields[f.name].actions = f
                  .getOptions()
                  .filter((o) => typeof o[1] === 'function')
                  .map((o) => (typeof o[0] === 'string' ? o[0] : o[0].alt || ''));
              }
            }
        metadata[def.id] = {
          fields,
          inputs: block.inputList.filter((i) => i.connection).map((i) => i.name),
          connections: ['previous', 'next', 'output'].filter((n) => !!block[n + 'Connection']),
        };
        for (const [name, input] of Object.entries(def.inputs || {})) {
          const child = block.getInputTargetBlock(name);
          if (child) describe(child, input.block || input.shadow);
        }
        if (def.next) describe(block.getNextBlock(), def.next);
      }
      describe(root, definition);
      const asset = `catalog-${id}-${index}`;
      await capture(asset, root);
      const resource = resources[asset];
      resource.anchors = Object.fromEntries(
        Object.entries(resource.anchors).map(([old, anchor]) => [mapping[old], anchor]),
      );
      entries.push({
        category,
        definition,
        metadata,
        resource,
        position: { x: at.x * scale, y: at.y * scale },
      });
    }
    const callbacks = cats.flatMap((category) => {
      const content = category.getContents();
      const nodes =
        typeof content === 'string'
          ? catalogWs.getToolboxCategoryCallback(content)(catalogWs)
          : content;
      return nodes
        .filter((node) => node.tagName?.toLowerCase() === 'button')
        .map((node) => node.getAttribute('callbackKey'));
    });
    let buttonIndex = 0;
    const decorations = flyout.buttons_.map((b) => ({
      kind: b.isLabel_ ? 'label' : 'button',
      text: B.utils.replaceMessageReferences(b.getText()),
      position: { x: b.getPosition().x * scale, y: b.getPosition().y * scale },
      width: b.width * scale,
      height: b.height * scale,
      ...(!b.isLabel_ && callbacks[buttonIndex] ? { callback: callbacks[buttonIndex++] } : {}),
    }));
    for (const checkbox of Object.values(flyout.checkboxes_)) {
      const transform = checkbox.svgRoot.transform.baseVal.consolidate().matrix;
      decorations.push({
        kind: 'checkbox',
        text: '',
        position: { x: transform.e * scale, y: transform.f * scale },
        width: flyout.CHECKBOX_SIZE * scale,
        height: flyout.CHECKBOX_SIZE * scale,
      });
    }
    const contentHeight = flyout.getMetrics_().contentHeight;
    return {
      categories,
      entries,
      decorations,
      contentHeight,
      xml,
      theme: Object.entries(paints)
        .map(([v, k]) => `.fill-${k}{fill:${v}}.stroke-${k}{stroke:${v}}`)
        .join('\n'),
    };
  };
  window.disposePreparation = () => {
    ws.dispose();
    catalogWs.dispose();
    editor.dispose();
    Math.random = originalRandom;
    document.getElementById('workspace').remove();
    catalogHost.remove();
    return !Object.keys(B.Workspace.WorkspaceDB_).length;
  };
};
