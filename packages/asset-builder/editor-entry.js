import Runtime from '../../.cache/gui/node_modules/scratch-vm/src/engine/runtime';
import Blocks from '../../.cache/gui/node_modules/scratch-vm/src/engine/blocks';
import convertBlocks from '../../.cache/gui/node_modules/scratch-vm/src/engine/adapter';
import Sprite from '../../.cache/gui/node_modules/scratch-vm/src/sprites/sprite';
import bindBlocks from '../../.cache/gui/src/lib/blocks';
import makeToolboxXML from '../../.cache/gui/src/lib/make-toolbox-xml';

// Only project data models are used. No VM clock, renderer, audio, or project execution.
window.createEditorContext = (project) => {
  const runtime = new Runtime();
  const vm = { runtime, editingTarget: null };
  for (const data of project.targets) {
    const sprite = new Sprite(null, runtime);
    sprite.name = data.name;
    sprite.costumes = data.costumes.map((name) => ({ name }));
    sprite.sounds = data.sounds.map((name) => ({ name }));
    const target = sprite.createClone();
    target.id = data.id;
    target.isStage = data.isStage;
    target.x = data.x;
    target.y = data.y;
    target.size = data.size;
    target.direction = data.direction;
    target.visible = data.visible;
    runtime.targets.push(target);
    for (const variable of data.variables)
      target.createVariable(variable.id, variable.name, variable.type, false);
  }
  bindBlocks(vm);
  return {
    select(id) {
      const target = runtime.targets.find((t) => t.id === id);
      vm.editingTarget = target;
      runtime.setEditingTarget(target);
      const stage = runtime.getTargetForStage();
      return makeToolboxXML(
        false,
        target.isStage,
        target.id,
        runtime.getBlocksXML(target),
        target.getCostumes().at(-1).name,
        stage.getCostumes().at(-1).name,
        target.getSounds().at(-1)?.name ?? '',
      );
    },
    sync(xml, flyout = false) {
      const blocks = new Blocks(runtime);
      for (const block of convertBlocks({ xml: { outerHTML: xml } })) blocks.createBlock(block);
      if (flyout) runtime.flyoutBlocks = blocks;
      else vm.editingTarget.blocks = blocks;
    },
    dispose() {
      runtime.dispose();
    },
  };
};
