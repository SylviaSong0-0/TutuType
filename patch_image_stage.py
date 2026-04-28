import re

with open("src/modules/image-stage.js", "r") as f:
    content = f.read()

# 1. Add `isBaseImageVisible`
content = content.replace("let layers = [];", "let isBaseImageVisible = true;\n  let layers = [];")

# 2. Update `updateCanvasUI`
old_canvas_ui = """  const updateCanvasUI = () => {
    const hasImage = !!image.src;
    if (stageToolbar) stageToolbar.style.display = hasImage ? "flex" : "none";
    if (stageToolbarBottom) stageToolbarBottom.style.display = hasImage ? "flex" : "none";
    if (placeholder) placeholder.style.display = hasImage ? "none" : "flex";
  };"""

new_canvas_ui = """  const updateCanvasUI = () => {
    const hasImage = !!image.src;
    if (stageToolbarBottom) stageToolbarBottom.style.display = hasImage ? "flex" : "none";
    if (placeholder) placeholder.style.display = hasImage ? "none" : "flex";
    if (hasImage && !isBaseImageVisible) {
      image.style.opacity = '0';
      frame.classList.add('stage-checkerboard');
    } else {
      image.style.opacity = '1';
      frame.classList.remove('stage-checkerboard');
    }
  };"""
content = content.replace(old_canvas_ui, new_canvas_ui)

# 3. Replace renderLeftPanel
# Find it by start and finding where the function ends.
start_str = "  const renderLeftPanel = () => {"
end_str = "  // 右侧“直选态”：只选中/高亮/可移动，不自动展开编辑器\n" # We'll match up to this line or similar, but wait, `renderLeftPanel` ends and then event listeners are defined inside it.
# Actually, the quickest way to replace a very large function is to locate its end bracket.
# But it's easier to use a regex to match the innerHTML block and the layers.map block, or just do it programmatically.

# To be safer, I will do this in multiple small replacements to `image-stage.js`.
