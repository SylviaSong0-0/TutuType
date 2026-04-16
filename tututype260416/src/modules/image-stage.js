import { simplifyPointsRdp } from "./rdp.js";
import { buildSmoothPath } from "./smooth-path.js";

const RDP_EPSILON = 1.0;
const CLICK_LENGTH_THRESHOLD = 8;
const CLICK_POINT_THRESHOLD = 2;
const CLICK_TIME_THRESHOLD = 200;
const HELPER_PATH_OPACITY = "0.28";
const HITBOX_STROKE_WIDTH = 30;
const SAMPLE_STEP_PX = 4;
const BASE_CHAR_WIDTH = 16;
const DIRECT_DRAW_TEXT = "这是一条文字内容";

function createRandomPathId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `draw-path-${crypto.randomUUID()}`;
  }
  return `draw-path-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function formatMeta(file, image) {
  const kb = Math.max(1, Math.round(file.size / 1024));
  return `${file.name} | ${image.naturalWidth}x${image.naturalHeight} | ${kb} KB`;
}

function toLocalPoint(svg, clientX, clientY) {
  const svgPoint = svg.createSVGPoint();
  svgPoint.x = clientX;
  svgPoint.y = clientY;

  const matrix = svg.getScreenCTM();
  if (!matrix) return null;

  const localPoint = svgPoint.matrixTransform(matrix.inverse());
  return { x: localPoint.x, y: localPoint.y };
}

function syncOverlayToImage(frame, image, overlay) {
  const imageRect = image.getBoundingClientRect();
  const frameRect = frame.getBoundingClientRect();

  const width = imageRect.width;
  const height = imageRect.height;

  if (width <= 0 || height <= 0) {
    overlay.classList.remove("is-visible");
    return;
  }

  overlay.style.left = `${imageRect.left - frameRect.left}px`;
  overlay.style.top = `${imageRect.top - frameRect.top}px`;
  overlay.style.width = `${width}px`;
  overlay.style.height = `${height}px`;

  overlay.setAttribute("viewBox", `0 0 ${width} ${height}`);
  overlay.setAttribute("width", `${width}`);
  overlay.setAttribute("height", `${height}`);
  overlay.classList.add("is-visible");
}

function createStrokePath(overlay) {
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.id = createRandomPathId();
  path.dataset.helperPath = "true";
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "rgba(75, 85, 99, 1)");
  path.setAttribute("stroke-width", "2");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");
  path.setAttribute("opacity", HELPER_PATH_OPACITY);
  overlay.appendChild(path);
  return path;
}

function applyStyleToTextNode(textNode, layer) {
  textNode.setAttribute("fill", layer.color);
  textNode.setAttribute("font-family", layer.fontFamily || "'SourceHanSansHWSC', sans-serif");
  textNode.setAttribute("font-size", `${layer.fontSize}`);
  textNode.setAttribute("letter-spacing", `${layer.letterSpacing}`);
  textNode.setAttribute("font-weight", layer.isBold ? "bold" : "normal");
  // hasStroke=false 时强制描边宽度为 0，屏蔽描边
  const effectiveStrokeWidth = layer.hasStroke ? (layer.strokeWidth || 0) : 0;
  textNode.setAttribute("stroke", layer.strokeColor || "#ffffff");
  textNode.setAttribute("stroke-width", `${effectiveStrokeWidth}px`);
  textNode.setAttribute("paint-order", "stroke fill");
  textNode.setAttribute("stroke-linejoin", "round");
  // writing-mode is only for non-vertical path mode; vertical path mode uses per-char positioning
  textNode.style.writingMode = "";
  textNode.style.textCombineUpright = "";
}

function computeRenderedTextForPath(layer, pathEl) {
  const raw = layer.text ?? "";
  if (!layer.loop || !raw || !pathEl) return raw;

  const len = pathEl.getTotalLength?.() ?? 0;
  // 采用 0.2 倍字号作为最窄字符的保守宽度估计（如英文字母 'i', 'l'），防止短估长文字。
  const minCharWidth = Math.max(1, (Number(layer.fontSize) || BASE_CHAR_WIDTH) * 0.2);
  const safeMaxChars = Math.ceil(len / minCharWidth);
  
  const targetChars = Math.max(safeMaxChars, raw.length);
  
  let output = raw;
  while (output.length < targetChars) {
    output += raw;
  }
  return output;
}

function bindSelectableText(textNode, layerId, onSelect) {
  textNode.dataset.layerId = layerId;
  textNode.addEventListener("pointerdown", (event) => {
    event.stopPropagation();
  });
  textNode.addEventListener("click", (event) => {
    event.stopPropagation();
    onSelect(layerId);
  });
}

/**
 * For vertical mode: place each character individually along the path
 * without path-tangent rotation, so characters stay upright.
 */
function createVerticalPathText(overlay, layer, pathEl) {
  const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
  group.setAttribute("pointer-events", "none");

  const totalLen = pathEl.getTotalLength();
  const chars = [...(layer.text || "")];
  if (!chars.length) { overlay.appendChild(group); return group; }

  const fontSize = Number(layer.fontSize) || 16;
  const letterSpacing = Number(layer.letterSpacing) || 0;
  const charStep = fontSize + letterSpacing;

  let offset = 0;
  let charIndex = 0;

  while (offset <= totalLen) {
    const ch = chars[charIndex % chars.length];
    if (!ch) break;

    const pt = pathEl.getPointAtLength(offset);
    const charEl = document.createElementNS("http://www.w3.org/2000/svg", "text");
    applyStyleToTextNode(charEl, layer);
    charEl.setAttribute("x", pt.x);
    charEl.setAttribute("y", pt.y);
    charEl.setAttribute("text-anchor", "middle");
    charEl.setAttribute("dominant-baseline", "central");
    charEl.textContent = ch;
    group.appendChild(charEl);

    offset += charStep;
    charIndex++;

    // Stop if not looping and all source chars are placed
    if (!layer.loop && charIndex >= chars.length) break;
    // Safety: avoid infinite loop
    if (offset > totalLen + charStep) break;
  }

  overlay.appendChild(group);
  return group;
}

function createPathBoundText(overlay, layer, pathEl) {
  // Vertical mode: use per-character positioning to keep glyphs upright
  if (layer.isVertical) {
    return createVerticalPathText(overlay, layer, pathEl);
  }

  const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
  applyStyleToTextNode(text, layer);
  text.setAttribute("pointer-events", "none");

  const textPath = document.createElementNS("http://www.w3.org/2000/svg", "textPath");
  textPath.setAttribute("href", `#${layer.pathElementId}`);
  textPath.textContent = computeRenderedTextForPath(layer, pathEl);

  text.appendChild(textPath);
  overlay.appendChild(text);
  return text;
}

function createStampText(overlay, layer, onSelect) {
  const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
  text.setAttribute("x", `${layer.x}`);
  text.setAttribute("y", `${layer.y}`);
  text.textContent = layer.text;
  applyStyleToTextNode(text, layer);
  text.setAttribute("pointer-events", "none");
  overlay.appendChild(text);
  return text;
}

function cloneLayers(layers) {
  return JSON.parse(JSON.stringify(layers));
}

function parseTranslate(transform) {
  const match = /translate\(\s*([-\d.]+)\s*[ ,]\s*([-\d.]+)\s*\)/.exec(transform ?? "");
  if (!match) return { x: 0, y: 0 };
  return { x: Number(match[1]) || 0, y: Number(match[2]) || 0 };
}

function setHelperPathsVisibility(overlay, isVisible) {
  const helperNodes = overlay.querySelectorAll('[data-helper="true"]');
  helperNodes.forEach((node) => {
    node.setAttribute("opacity", isVisible ? "1" : "0");
  });
}

function serializeSvgToDataUrl(svgNode) {
  const serializer = new XMLSerializer();
  const raw = serializer.serializeToString(svgNode);
  const encoded = btoa(unescape(encodeURIComponent(raw)));
  return `data:image/svg+xml;base64,${encoded}`;
}

async function exportCompositeImage(image, overlay) {
  if (!image.src || !image.naturalWidth || !image.naturalHeight) return;

  await document.fonts.ready;

  const displayWidth = overlay.clientWidth;
  const displayHeight = overlay.clientHeight;
  if (!displayWidth || !displayHeight) return;

  setHelperPathsVisibility(overlay, false);

  try {
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.drawImage(image, 0, 0, image.naturalWidth, image.naturalHeight);

    const scaleX = image.naturalWidth / displayWidth;
    const scaleY = image.naturalHeight / displayHeight;

    const exportSvg = overlay.cloneNode(true);
    exportSvg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    exportSvg.setAttribute("viewBox", `0 0 ${image.naturalWidth} ${image.naturalHeight}`);
    exportSvg.setAttribute("width", `${image.naturalWidth}`);
    exportSvg.setAttribute("height", `${image.naturalHeight}`);
    
    const styleNode = document.createElementNS("http://www.w3.org/2000/svg", "style");
    const fontFaces = Array.from(document.styleSheets)
      .flatMap((sheet) => {
        try { return Array.from(sheet.cssRules); } catch (e) { return []; }
      })
      .filter((rule) => rule.type === CSSRule.FONT_FACE_RULE || rule.cssText.startsWith("@font-face"))
      .map((rule) => rule.cssText)
      .join("\\n");
      
    styleNode.textContent = fontFaces;
    exportSvg.insertBefore(styleNode, exportSvg.firstChild);

    exportSvg.querySelectorAll('[data-hitbox="true"]').forEach((node) => {
      node.setAttribute("stroke", "transparent");
      node.setAttribute("opacity", "0");
    });

    const wrapper = document.createElementNS("http://www.w3.org/2000/svg", "g");
    wrapper.setAttribute("transform", `scale(${scaleX} ${scaleY})`);
    wrapper.append(...Array.from(exportSvg.childNodes));
    exportSvg.appendChild(wrapper);

    const svgImage = new Image();
    const loadPromise = new Promise((resolve, reject) => {
      svgImage.onload = resolve;
      svgImage.onerror = reject;
    });
    svgImage.src = serializeSvgToDataUrl(exportSvg);
    await loadPromise;

    ctx.drawImage(svgImage, 0, 0, image.naturalWidth, image.naturalHeight);

    const downloadLink = document.createElement("a");
    downloadLink.href = canvas.toDataURL("image/png");
    downloadLink.download = "排版导出.png";
    downloadLink.click();
  } finally {
    setHelperPathsVisibility(overlay, true);
  }
}

export function initImageStage() {
  const input = document.querySelector("#image-input");
  const image = document.querySelector("#stage-image");
  const placeholder = document.querySelector("#stage-placeholder");
  const frame = document.querySelector(".stage-frame");
  const overlay = document.querySelector("#draw-overlay");
  const leftPanelRoot = document.querySelector("#left-panel-root");
  const undoButton = document.querySelector('[data-action="undo"]');
  const redoButton = document.querySelector('[data-action="redo"]');
  const stageToolbar = document.querySelector(".stage-toolbar");
  const stageToolbarBottom = document.querySelector(".stage-toolbar-bottom");

  if (!input || !image || !placeholder || !frame || !overlay || !leftPanelRoot || !undoButton || !redoButton) {
    return;
  }

  const updateCanvasUI = () => {
    const hasImage = !!image.src;
    if (stageToolbar) stageToolbar.style.display = hasImage ? "flex" : "none";
    if (stageToolbarBottom) stageToolbarBottom.style.display = hasImage ? "flex" : "none";
  };

  let layers = [];
  let activeLayerId = null;
  let expandedLayerId = null;
  let history = [];
  let historyIndex = -1;
  let uploadFileName = "";
  let draggingLayerId = null;
  let objectUrl = "";
  let drawingState = {
    isDrawing: false,
    points: [],
    activePath: null,
    pointerId: null,
    startPoint: null,
    startedAt: 0,
    startedWithCompletedSelection: false,
    clearedSelectionOnDrag: false,
  };
  let moveState = null;
  let extendState = null;

  const getActiveLayer = () => layers.find((item) => item.id === activeLayerId) ?? null;

  const setActiveLayer = (id) => {
    activeLayerId = id;
    renderLeftPanel();
  };

  const createLayerRecord = ({ type, text, fontFamily, fontSize, color, letterSpacing, isBold, strokeColor, strokeWidth, hasStroke, isVertical, d, x, y, pathElementId }) => ({
    id: createRandomPathId(),
    type,
    text,
    fontFamily: fontFamily || "'SourceHanSansHWSC', sans-serif",
    fontSize,
    color,
    letterSpacing,
    isBold: isBold ?? false,
    strokeColor: strokeColor || "#ffffff",
    strokeWidth: strokeWidth || 0,
    hasStroke: hasStroke ?? false,
    isVertical: isVertical ?? false,
    d,
    x,
    y,
    pathElementId,
    textElement: null,
    pathElement: null,
    loop: true,
    isDraft: false,
    status: "pending",
    translateX: 0,
    translateY: 0,
    groupElement: null,
    hitboxElement: null,
    handleElement: null,
  });

  const updateSelectionStyles = () => {
    layers.forEach((layer) => {
      if (!layer.hitboxElement) return;
      const isActive = layer.id === activeLayerId;
      layer.hitboxElement.setAttribute("stroke", isActive ? "rgba(38, 38, 38, 0.12)" : "transparent");
      if (layer.handleElement) {
        layer.handleElement.setAttribute("display", isActive ? "block" : "none");
      }
    });
  };

  const hideSelectionVisuals = () => {
    layers.forEach((layer) => {
      if (layer.hitboxElement) {
        layer.hitboxElement.setAttribute("stroke", "transparent");
      }
      if (layer.handleElement) {
        layer.handleElement.setAttribute("display", "none");
      }
    });
  };

  const scrollActiveLayerCardIntoView = () => {
    if (!activeLayerId) return;
    const card = leftPanelRoot.querySelector(`.layer-card[data-layer-id="${activeLayerId}"]`);
    card?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  };

  // 左侧“编辑态”：显式展开并 focus
  const setActiveLayerAndExpand = (id) => {
    activeLayerId = id;
    expandedLayerId = id;
    renderLeftPanel();
    scrollActiveLayerCardIntoView();
    updateSelectionStyles();
  };

  // 右侧“直选态”：只选中/高亮/可移动，不自动展开编辑器
  const setActiveLayerOnly = (id) => {
    activeLayerId = id;
    renderLeftPanel();
    updateSelectionStyles();
  };

  const localPointInOverlay = (clientX, clientY) => toLocalPoint(overlay, clientX, clientY);

  const localPointInLayer = (layer, clientX, clientY) => {
    const p = localPointInOverlay(clientX, clientY);
    if (!p) return null;
    return { x: p.x - (layer.translateX || 0), y: p.y - (layer.translateY || 0) };
  };

  const samplePathPoints = (pathEl) => {
    const len = pathEl.getTotalLength();
    const points = [];
    for (let d = 0; d <= len; d += SAMPLE_STEP_PX) {
      const p = pathEl.getPointAtLength(d);
      points.push({ x: p.x, y: p.y });
    }
    const last = pathEl.getPointAtLength(len);
    points.push({ x: last.x, y: last.y });
    return points;
  };

  const renderCanvasFromLayers = () => {
    overlay.replaceChildren();
    layers.forEach((layer) => {
      if (!layer.d && layer.type === "path") return;
      if (layer.type === "stamp" && (layer.x === null || layer.y === null)) return;

      const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
      group.dataset.layerId = layer.id;
      group.setAttribute("transform", `translate(${layer.translateX || 0}, ${layer.translateY || 0})`);
      overlay.prepend(group);
      layer.groupElement = group;

      // Level B: group move/select
      group.addEventListener("pointerdown", (event) => {
        if (event.target && event.target.closest?.('[data-role="extend-handle"]')) return;
        event.stopPropagation();
        setActiveLayerAndExpand(layer.id);
        const p = localPointInOverlay(event.clientX, event.clientY);
        if (!p) return;
        moveState = {
          pointerId: event.pointerId,
          startX: p.x,
          startY: p.y,
          baseTranslateX: layer.translateX || 0,
          baseTranslateY: layer.translateY || 0,
          layerId: layer.id,
        };
        overlay.setPointerCapture(event.pointerId);
      });

      if (layer.type === "path") {
        // Hitbox
        const hitbox = document.createElementNS("http://www.w3.org/2000/svg", "path");
        hitbox.dataset.hitbox = "true";
        hitbox.setAttribute("d", layer.d);
        hitbox.setAttribute("fill", "none");
        hitbox.setAttribute("stroke", "transparent");
        hitbox.setAttribute("stroke-width", `${HITBOX_STROKE_WIDTH}`);
        hitbox.setAttribute("pointer-events", "stroke");
        group.appendChild(hitbox);
        layer.hitboxElement = hitbox;

        // Actual path for textPath reference (not interactive)
        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.id = layer.pathElementId || createRandomPathId();
        layer.pathElementId = path.id;
        path.dataset.helperPath = "true";
        path.dataset.helper = "true";
        path.setAttribute("fill", "none");
        path.setAttribute("stroke", "rgba(75, 85, 99, 1)");
        path.setAttribute("stroke-width", "2");
        path.setAttribute("stroke-linecap", "round");
        path.setAttribute("stroke-linejoin", "round");
        path.setAttribute("opacity", HELPER_PATH_OPACITY);
        path.setAttribute("d", layer.d);
        group.appendChild(path);
        layer.pathElement = path;

        // Text (visual, no pointer events)
        const text = createPathBoundText(group, layer, path);
        layer.textElement = text;

        // Extend handle follows selected state for completed paths.
        if (layer.status === "completed") {
          const len = path.getTotalLength();
          const end = path.getPointAtLength(len);
          const handle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
          handle.dataset.role = "extend-handle";
          handle.dataset.helper = "true";
          handle.setAttribute("cx", `${end.x}`);
          handle.setAttribute("cy", `${end.y}`);
          handle.setAttribute("r", "6");
          handle.setAttribute("fill", "#262626");
          handle.setAttribute("stroke", "#ffffff");
          handle.setAttribute("stroke-width", "2");
          handle.setAttribute("display", layer.id === activeLayerId ? "block" : "none");
          handle.setAttribute("pointer-events", "all");
          group.appendChild(handle);
          layer.handleElement = handle;

          // Level A: extend
          handle.addEventListener("pointerdown", (event) => {
            event.stopPropagation();
            setActiveLayerOnly(layer.id);
            const basePathPoints = samplePathPoints(path);
            const startLocal = localPointInLayer(layer, event.clientX, event.clientY);
            extendState = {
              pointerId: event.pointerId,
              layerId: layer.id,
              basePoints: basePathPoints,
              appendedPoints: startLocal ? [startLocal] : [],
            };
            overlay.setPointerCapture(event.pointerId);
          });
        } else {
          layer.handleElement = null;
        }
      } else {
        layer.pathElement = null;
        layer.hitboxElement = null;
        const text = createStampText(group, layer, () => {});
        layer.textElement = text;
      }
    });
    updateSelectionStyles();
  };

  const refreshHistoryButtons = () => {
    if (undoButton) undoButton.disabled = historyIndex <= 0;
    if (redoButton) redoButton.disabled = historyIndex >= history.length - 1;
  };

  const saveState = () => {
    const snapshot = cloneLayers(
      layers.map((layer) => ({
        id: layer.id,
        text: layer.text,
        fontFamily: layer.fontFamily,
        fontSize: layer.fontSize,
        color: layer.color,
        letterSpacing: layer.letterSpacing,
        isBold: layer.isBold,
        strokeColor: layer.strokeColor,
        strokeWidth: layer.strokeWidth,
        hasStroke: layer.hasStroke ?? false,
        isVertical: layer.isVertical ?? false,
        d: layer.d,
        type: layer.type,
        x: layer.x,
        y: layer.y,
        pathElementId: layer.pathElementId,
        loop: layer.loop,
        status: layer.status,
        isDraft: layer.isDraft,
        translateX: layer.translateX || 0,
        translateY: layer.translateY || 0,
      })),
    );
    if (historyIndex < history.length - 1) {
      history = history.slice(0, historyIndex + 1);
    }
    history.push(snapshot);
    historyIndex = history.length - 1;
    refreshHistoryButtons();
  };

  const restoreFromHistory = (nextIndex) => {
    if (nextIndex < 0 || nextIndex >= history.length) return;
    historyIndex = nextIndex;
    layers = cloneLayers(history[historyIndex]).map((layer) => ({
      ...layer,
      textElement: null,
      pathElement: null,
      groupElement: null,
      hitboxElement: null,
      handleElement: null,
    }));
    if (!layers.some((layer) => layer.id === activeLayerId)) {
      activeLayerId = layers.length ? layers[layers.length - 1].id : null;
    }
    if (!layers.some((layer) => layer.id === expandedLayerId)) {
      expandedLayerId = activeLayerId;
    }
    renderCanvasFromLayers();
    renderLeftPanel();
    refreshHistoryButtons();
  };

  const updateLayerAndRender = (layerId, updater, rerenderPanel = true) => {
    const layer = layers.find((item) => item.id === layerId);
    if (!layer) return;
    updater(layer);
    renderCanvasFromLayers();
    if (rerenderPanel) renderLeftPanel();
  };

  const renderLeftPanel = () => {
    const uploadStateHtml = image.src
      ? `
        <section class="panel-section">
          <h2 class="section-title">图片</h2>
          <div class="upload-state">
            <div class="upload-filled">
              <img class="upload-thumb" src="${image.src}" alt="缩略图" />
              <div class="upload-name" title="${uploadFileName}">${uploadFileName || "已上传图片"}</div>
              <button class="minor-button" data-action="pick-image" type="button">重新上传</button>
            </div>
          </div>
        </section>
      `
      : `
        <section class="panel-section">
          <h2 class="section-title">图片</h2>
          <div class="upload-state">
            <p class="upload-empty-text">请先上传图片作为底图</p>
            <button class="upload-button" data-action="pick-image" type="button">选择本地图片</button>
          </div>
        </section>
      `;

    const layerCardsHtml = layers
      .map((layer) => {
        if (layer.isDraft) {
          return `
            <article class="layer-card" data-layer-id="${layer.id}">
              <input class="layer-input" data-role="layer-name-input" data-layer-id="${layer.id}" placeholder="输入图层文本后回车" value="${layer.text}" />
            </article>
          `;
        }
        const expanded = expandedLayerId === layer.id;
        const isPending = layer.status === "pending";
        return `
          <article class="layer-card${isPending ? " is-pending" : ""}" data-layer-id="${layer.id}" draggable="false">
            <div class="layer-head">
              <span class="drag-handle" data-role="drag-handle">::</span>
              <div class="layer-title" title="${layer.text || "未命名图层"}">${layer.text || "未命名图层"}</div>
              <button class="icon-button" data-action="edit-layer" data-layer-id="${layer.id}" type="button" style="display: flex; align-items: center; gap: 2px;">
                编辑
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="chevron-icon ${expanded ? 'is-expanded' : ''}"><polyline points="6 9 12 15 18 9"></polyline></svg>
              </button>
              <button class="icon-button" data-action="delete-layer" data-layer-id="${layer.id}" type="button">删除</button>
            </div>
            ${
              expanded
                ? `
              <div class="layer-props">
                ${
                  isPending
                    ? '<p class="pending-hint">请在右侧图片上绘制轨迹...</p>'
                    : `
                  <!-- 内容区块 -->
                  <div class="prop-section">
                    <textarea data-prop="text" data-layer-id="${layer.id}" class="layer-text-edit">${layer.text}</textarea>
                    <div class="checkbox-inline-row">
                      <label class="checkbox-row">
                        <input data-prop="loop" data-layer-id="${layer.id}" type="checkbox" ${layer.loop ? 'checked' : ''} />
                        <span>循环</span>
                      </label>
                      <label class="checkbox-row">
                        <input data-prop="isVertical" data-layer-id="${layer.id}" type="checkbox" ${layer.isVertical ? 'checked' : ''} />
                        <span>竖排</span>
                      </label>
                    </div>
                  </div>

                  <!-- 排版区块 -->
                  <div class="prop-section">
                    <select data-prop="fontFamily" data-layer-id="${layer.id}" class="layer-input">
                      <optgroup label="中文">
                        <option value="'SourceHanSansHWSC', sans-serif" ${String(layer.fontFamily).includes('SourceHanSansHWSC') ? 'selected' : ''}>思源黑体</option>
                        <option value="'SourceHanSerifSC', serif" ${String(layer.fontFamily).includes('SourceHanSerifSC') ? 'selected' : ''}>思源宋体 SC</option>
                        <option value="'SmileySans', sans-serif" ${String(layer.fontFamily).includes('SmileySans') ? 'selected' : ''}>得意黑</option>
                        <option value="'LXGWWenKaiMono', serif" ${String(layer.fontFamily).includes('LXGWWenKaiMono') ? 'selected' : ''}>霞鹜文楷</option>
                      </optgroup>
                      <optgroup label="英文">
                        <option value="'Inter', sans-serif" ${String(layer.fontFamily).includes('Inter') ? 'selected' : ''}>Inter</option>
                        <option value="'PlayfairDisplay', serif" ${String(layer.fontFamily).includes('PlayfairDisplay') ? 'selected' : ''}>Playfair Display</option>
                        <option value="'Caveat', cursive" ${String(layer.fontFamily).includes('Caveat') ? 'selected' : ''}>Caveat</option>
                      </optgroup>
                      <optgroup label="韩语">
                        <option value="'SourceHanSerifK', serif" ${String(layer.fontFamily).includes('SourceHanSerifK') ? 'selected' : ''}>思源韩文宋体</option>
                        <option value="'NanumPenScript', cursive" ${String(layer.fontFamily).includes('NanumPenScript') ? 'selected' : ''}>Nanum Pen Script</option>
                      </optgroup>
                      <optgroup label="日语">
                        <option value="'SourceHanSerif', serif" ${String(layer.fontFamily) === "'SourceHanSerif', serif" ? 'selected' : ''}>思源宋体</option>
                        <option value="'NotoSansJP', sans-serif" ${String(layer.fontFamily).includes('NotoSansJP') ? 'selected' : ''}>Noto Sans JP</option>
                      </optgroup>
                    </select>
                    <div class="typo-compact">
                      <div class="typo-row">
                        <label class="typo-label">字号 <output>${layer.fontSize}px</output></label>
                        <input data-prop="fontSize" data-layer-id="${layer.id}" type="range" min="10" max="120" value="${layer.fontSize}" />
                      </div>
                      <div class="typo-row">
                        <label class="typo-label">字距 <output>${layer.letterSpacing}px</output></label>
                        <input data-prop="letterSpacing" data-layer-id="${layer.id}" type="range" min="0" max="40" value="${layer.letterSpacing}" />
                      </div>
                      <label class="checkbox-row">
                        <input data-prop="isBold" data-layer-id="${layer.id}" type="checkbox" ${layer.isBold ? 'checked' : ''} />
                        <span>加粗</span>
                      </label>
                    </div>
                  </div>

                  <!-- 样式区块 -->
                  <div class="prop-section">
                    <div class="color-row">
                      <label class="color-label">颜色</label>
                      <input data-prop="color" data-layer-id="${layer.id}" class="color-picker" type="color" value="${layer.color}" />
                    </div>
                    <label class="checkbox-row">
                      <input data-prop="hasStroke" data-layer-id="${layer.id}" type="checkbox" ${layer.hasStroke ? 'checked' : ''} />
                      <span>启用描边</span>
                    </label>
                    ${layer.hasStroke ? `
                    <div class="color-row">
                      <label class="color-label">描边颜色</label>
                      <input data-prop="strokeColor" data-layer-id="${layer.id}" class="color-picker" type="color" value="${layer.strokeColor}" />
                    </div>
                    <div class="typo-row">
                      <label class="typo-label">描边宽度 <output>${layer.strokeWidth}px</output></label>
                      <input data-prop="strokeWidth" data-layer-id="${layer.id}" type="range" min="0" max="15" value="${layer.strokeWidth}" />
                    </div>
                    ` : ''}
                  </div>
                `
                }
              </div>
            `
                : ""
            }
          </article>
        `;
      })
      .join("");

    leftPanelRoot.innerHTML = `
      ${uploadStateHtml}
      ${image.src ? `
      <section class="panel-section">
        <div class="layer-stack">${layerCardsHtml}</div>
        <button class="add-layer-button" data-action="add-layer" type="button" style="margin-top: 10px;">添加文字路径</button>
      </section>
      ` : ''}
    `;

    leftPanelRoot.querySelector('[data-action="pick-image"]')?.addEventListener("click", () => input.click());
    leftPanelRoot.querySelector('[data-action="add-layer"]')?.addEventListener("click", () => {
      const layer = createLayerRecord({
        type: "path",
        text: "",
        fontFamily: "'SourceHanSansHWSC', sans-serif",
        fontSize: 36,
        color: "#000000",
        letterSpacing: 0,
        isBold: false,
        strokeColor: "#ffffff",
        strokeWidth: 3,
        d: "",
        x: null,
        y: null,
        pathElementId: createRandomPathId(),
      });
      layer.isDraft = true;
      layers.push(layer);
      activeLayerId = layer.id;
      expandedLayerId = null;
      renderLeftPanel();
      const inputNode = leftPanelRoot.querySelector(`[data-role="layer-name-input"][data-layer-id="${layer.id}"]`);
      inputNode?.focus();
    });

    leftPanelRoot.querySelectorAll('[data-role="layer-name-input"]').forEach((nameInput) => {
      const finalize = () => {
        const id = nameInput.getAttribute("data-layer-id");
        const layer = layers.find((item) => item.id === id);
        if (!layer) return;
        layer.text = nameInput.value.trim() || "未命名图层";
        layer.isDraft = false;
        layer.status = "pending";
        activeLayerId = layer.id;
        expandedLayerId = layer.id;
        renderLeftPanel();
        saveState();
      };
      nameInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter") finalize();
      });
      nameInput.addEventListener("blur", finalize);
    });

    leftPanelRoot.querySelectorAll('[data-action="edit-layer"]').forEach((button) => {
      button.addEventListener("click", () => {
        const id = button.getAttribute("data-layer-id");
        activeLayerId = id;
        expandedLayerId = expandedLayerId === id ? null : id;
        renderLeftPanel();
        scrollActiveLayerCardIntoView();
        updateSelectionStyles();
      });
    });

    leftPanelRoot.querySelectorAll('[data-action="delete-layer"]').forEach((button) => {
      button.addEventListener("click", () => {
        const id = button.getAttribute("data-layer-id");
        layers = layers.filter((layer) => layer.id !== id);
        if (activeLayerId === id) activeLayerId = layers[0]?.id ?? null;
        if (expandedLayerId === id) expandedLayerId = null;
        renderCanvasFromLayers();
        renderLeftPanel();
        saveState();
      });
    });

    leftPanelRoot.querySelectorAll('[data-prop]').forEach((control) => {
      const id = control.getAttribute("data-layer-id");
      const prop = control.getAttribute("data-prop");
      const apply = (rerenderPanel = true) => {
        updateLayerAndRender(id, (layer) => {
          if (prop === "fontFamily") layer.fontFamily = control.value;
          if (prop === "fontSize") layer.fontSize = Number(control.value) || 16;
          if (prop === "letterSpacing") layer.letterSpacing = Number(control.value) || 0;
          if (prop === "color") layer.color = control.value || "#000000";
          if (prop === "isBold") layer.isBold = control.checked;
          if (prop === "hasStroke") layer.hasStroke = control.checked;
          if (prop === "strokeColor") layer.strokeColor = control.value || "#ffffff";
          if (prop === "strokeWidth") layer.strokeWidth = Number(control.value) || 0;
          if (prop === "loop") layer.loop = control.checked;
          if (prop === "isVertical") layer.isVertical = control.checked;
          if (prop === "text") layer.text = control.value ?? "";
        }, rerenderPanel);
      };
      control.addEventListener("input", () => {
        apply(false);
        if (prop === "fontSize" || prop === "letterSpacing" || prop === "strokeWidth") {
          const output = control.previousElementSibling?.querySelector("output");
          if (output) output.textContent = `${control.value}px`;
        }
      });
      control.addEventListener("change", () => {
        apply(true);
        saveState();
      });
    });

    leftPanelRoot.querySelectorAll("[data-role='drag-handle']").forEach((handle) => {
      const card = handle.closest(".layer-card");
      if (!card) return;
      const disableDrag = () => {
        card.setAttribute("draggable", "false");
      };
      handle.addEventListener("mousedown", () => {
        card.setAttribute("draggable", "true");
      });
      handle.addEventListener("mouseup", disableDrag);
      handle.addEventListener("mouseleave", disableDrag);
      card.addEventListener("dragend", disableDrag);
    });

    leftPanelRoot.querySelectorAll(".layer-card").forEach((card) => {
      card.addEventListener("dragstart", () => {
        draggingLayerId = card.getAttribute("data-layer-id");
      });
      card.addEventListener("dragover", (event) => {
        event.preventDefault();
      });
      card.addEventListener("drop", (event) => {
        event.preventDefault();
        const targetId = card.getAttribute("data-layer-id");
        if (!draggingLayerId || draggingLayerId === targetId) return;
        const fromIndex = layers.findIndex((layer) => layer.id === draggingLayerId);
        const toIndex = layers.findIndex((layer) => layer.id === targetId);
        if (fromIndex < 0 || toIndex < 0) return;
        const [moved] = layers.splice(fromIndex, 1);
        layers.splice(toIndex, 0, moved);
        renderCanvasFromLayers();
        renderLeftPanel();
        saveState();
      });
    });

    refreshHistoryButtons();
  };

  // One-time binding for static toolbar buttons
  document.querySelector('[data-action="export"]')?.addEventListener("click", async () => {
    await exportCompositeImage(image, overlay);
  });

  const handleResize = () => syncOverlayToImage(frame, image, overlay);
  const resizeObserver = new ResizeObserver(handleResize);
  resizeObserver.observe(frame);
  resizeObserver.observe(image);
  window.addEventListener("resize", handleResize);

  overlay.addEventListener("pointerdown", (event) => {
    // Level C: new path, only from background overlay
    if (event.target !== overlay) return;
    if (!overlay.classList.contains("is-visible")) return;
    const activeLayer = getActiveLayer();
    // Clicking blank area should clear selection only for completed layers.
    // Keep pending/draft drawing interactions unchanged.
    if (activeLayer && !activeLayer.isDraft && activeLayer.status === "completed") {
      activeLayerId = null;
      expandedLayerId = null;
      renderLeftPanel();
      updateSelectionStyles();
      return;
    }

    const point = toLocalPoint(overlay, event.clientX, event.clientY);
    if (!point) return;

    overlay.setPointerCapture(event.pointerId);
    drawingState = {
      isDrawing: true,
      points: [point],
      activePath: createStrokePath(overlay),
      pointerId: event.pointerId,
      startPoint: point,
      startedAt: Date.now(),
      startedWithCompletedSelection: Boolean(
        activeLayer && !activeLayer.isDraft && activeLayer.status === "completed",
      ),
      clearedSelectionOnDrag: false,
    };
    if (drawingState.startedWithCompletedSelection) {
      activeLayerId = null;
      expandedLayerId = null;
      renderLeftPanel();
      updateSelectionStyles();
      hideSelectionVisuals();
      drawingState.clearedSelectionOnDrag = true;
    }
    drawingState.activePath.setAttribute("d", buildSmoothPath([point]));
  });

  overlay.addEventListener("pointermove", (event) => {
    if (moveState && moveState.pointerId === event.pointerId) {
      const layer = layers.find((l) => l.id === moveState.layerId);
      const p = localPointInOverlay(event.clientX, event.clientY);
      if (!layer || !p) return;
      const dx = p.x - moveState.startX;
      const dy = p.y - moveState.startY;
      layer.translateX = moveState.baseTranslateX + dx;
      layer.translateY = moveState.baseTranslateY + dy;
      layer.groupElement?.setAttribute("transform", `translate(${layer.translateX}, ${layer.translateY})`);
      return;
    }

    if (extendState && extendState.pointerId === event.pointerId) {
      const layer = layers.find((l) => l.id === extendState.layerId);
      if (!layer) return;
      const p = localPointInLayer(layer, event.clientX, event.clientY);
      if (!p) return;
      extendState.appendedPoints.push(p);
      return;
    }

    if (!drawingState.isDrawing || drawingState.pointerId !== event.pointerId) return;

    const point = toLocalPoint(overlay, event.clientX, event.clientY);
    if (!point) return;

    if (
      drawingState.startedWithCompletedSelection &&
      !drawingState.clearedSelectionOnDrag &&
      drawingState.startPoint
    ) {
      const movedDistance = Math.hypot(
        point.x - drawingState.startPoint.x,
        point.y - drawingState.startPoint.y,
      );
      if (movedDistance > CLICK_LENGTH_THRESHOLD) {
        activeLayerId = null;
        expandedLayerId = null;
        renderLeftPanel();
        updateSelectionStyles();
        drawingState.clearedSelectionOnDrag = true;
      }
    }

    drawingState.points.push(point);
    const simplified = simplifyPointsRdp(drawingState.points, RDP_EPSILON);
    drawingState.activePath?.setAttribute("d", buildSmoothPath(simplified));
  });

  const endDrawing = (event) => {
    if (!drawingState.isDrawing || drawingState.pointerId !== event.pointerId) return;

    const point = toLocalPoint(overlay, event.clientX, event.clientY);
    if (point) drawingState.points.push(point);

    const simplified = simplifyPointsRdp(drawingState.points, RDP_EPSILON);
    const d = buildSmoothPath(simplified);
    drawingState.activePath?.setAttribute("d", d);

    const pathLength = drawingState.activePath?.getTotalLength() ?? 0;
    const elapsed = Date.now() - drawingState.startedAt;
    const currentPoint = point ?? drawingState.startPoint;
    const movedDistance = drawingState.startPoint && currentPoint
      ? Math.hypot(currentPoint.x - drawingState.startPoint.x, currentPoint.y - drawingState.startPoint.y)
      : 0;
    const isClickMode =
      elapsed < CLICK_TIME_THRESHOLD &&
      movedDistance <= CLICK_LENGTH_THRESHOLD &&
      (simplified.length <= CLICK_POINT_THRESHOLD || pathLength <= CLICK_LENGTH_THRESHOLD);
    const startedWithCompletedSelection = drawingState.startedWithCompletedSelection;
    const source = getActiveLayer();
    const text = DIRECT_DRAW_TEXT;
    const fontFamily = source?.fontFamily ?? "'SourceHanSansHWSC', sans-serif";
    const fontSize = source?.fontSize ?? 36;
    const color = source?.color ?? "#000000";
    const letterSpacing = source?.letterSpacing ?? 0;
    const isBold = source?.isBold ?? false;
    const strokeColor = source?.strokeColor ?? "#ffffff";
    const strokeWidth = source?.strokeWidth ?? 0;
    const isVertical = source?.isVertical ?? false;

    const shouldReuseActiveLayer = source && (source.isDraft || source.status === "pending");

    if (isClickMode) {
      drawingState.activePath?.remove();
      if (startedWithCompletedSelection) {
        activeLayerId = null;
        expandedLayerId = null;
        renderLeftPanel();
        updateSelectionStyles();
        drawingState = {
          isDrawing: false,
          points: [],
          activePath: null,
          pointerId: null,
          startPoint: null,
          startedAt: 0,
          startedWithCompletedSelection: false,
          clearedSelectionOnDrag: false,
        };
        return;
      }
      const stampPoint = simplified[0] ?? point;
      if (stampPoint) {
        const record = shouldReuseActiveLayer
          ? source
          : createLayerRecord({
              type: "stamp",
              text: text.slice(0, 1),
              fontFamily,
              fontSize,
              color,
              letterSpacing,
              isBold,
              strokeColor,
              strokeWidth,
              d: "",
              x: stampPoint.x,
              y: stampPoint.y,
              pathElementId: null,
            });
        record.type = "stamp";
        record.text = (record.text || text).slice(0, 1);
        record.fontFamily = fontFamily;
        record.fontSize = fontSize;
        record.color = color;
        record.letterSpacing = letterSpacing;
        record.isBold = isBold;
        record.strokeColor = strokeColor;
        record.strokeWidth = strokeWidth;
        record.x = stampPoint.x;
        record.y = stampPoint.y;
        record.d = "";
        record.pathElementId = null;
        record.isDraft = false;
        record.status = "completed";
        if (!layers.some((layer) => layer.id === record.id)) layers.push(record);
        renderCanvasFromLayers();
        setActiveLayerAndExpand(record.id);
        saveState();
      }
    } else if (drawingState.activePath) {
      const record = shouldReuseActiveLayer
        ? source
        : createLayerRecord({
            type: "path",
            text,
            fontFamily,
            fontSize,
            color,
            letterSpacing,
            isBold,
            strokeColor,
            strokeWidth,
            d,
            x: null,
            y: null,
            pathElementId: drawingState.activePath.id,
          });
      record.type = "path";
      record.text = record.text || text || "未命名图层";
      record.fontFamily = fontFamily;
      record.fontSize = fontSize;
      record.color = color;
      record.letterSpacing = letterSpacing;
      record.isBold = isBold;
      record.strokeColor = strokeColor;
      record.strokeWidth = strokeWidth;
      record.isVertical = isVertical;
      record.d = d;
      record.x = null;
      record.y = null;
      record.pathElementId = drawingState.activePath.id;
      record.isDraft = false;
      record.status = "completed";
      if (!layers.some((layer) => layer.id === record.id)) layers.push(record);
      renderCanvasFromLayers();
      setActiveLayerAndExpand(record.id);
      saveState();
    }

    drawingState = {
      isDrawing: false,
      points: [],
      activePath: null,
      pointerId: null,
      startPoint: null,
      startedAt: 0,
      startedWithCompletedSelection: false,
      clearedSelectionOnDrag: false,
    };
  };

  overlay.addEventListener("pointerup", endDrawing);
  overlay.addEventListener("pointercancel", endDrawing);

  overlay.addEventListener("pointerup", (event) => {
    if (moveState && moveState.pointerId === event.pointerId) {
      moveState = null;
      saveState();
      return;
    }
    if (extendState && extendState.pointerId === event.pointerId) {
      const layer = layers.find((l) => l.id === extendState.layerId);
      if (layer && layer.type === "path") {
        const simplified = simplifyPointsRdp(extendState.appendedPoints, RDP_EPSILON);
        const combined = extendState.basePoints.concat(simplified);
        const simplifiedAll = simplifyPointsRdp(combined, RDP_EPSILON);
        layer.d = buildSmoothPath(simplifiedAll);
        layer.status = "completed";
        renderCanvasFromLayers();
        renderLeftPanel();
        saveState();
      }
      extendState = null;
    }
  });

  window.addEventListener("keydown", (event) => {
    const isMetaOrCtrl = event.metaKey || event.ctrlKey;
    if (!isMetaOrCtrl) return;
    const key = event.key.toLowerCase();
    if (key === "z" && event.shiftKey) {
      event.preventDefault();
      restoreFromHistory(historyIndex + 1);
      return;
    }
    if (key === "y") {
      event.preventDefault();
      restoreFromHistory(historyIndex + 1);
      return;
    }
    if (key === "z") {
      event.preventDefault();
      restoreFromHistory(historyIndex - 1);
    }
  });

  undoButton.addEventListener("click", () => {
    restoreFromHistory(historyIndex - 1);
  });
  redoButton.addEventListener("click", () => {
    restoreFromHistory(historyIndex + 1);
  });

  input.addEventListener("change", () => {
    const [file] = input.files ?? [];
    if (!file) return;

    uploadFileName = file.name;
    overlay.replaceChildren();

    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = URL.createObjectURL(file);

    image.onload = () => {
      placeholder.hidden = true;
      image.classList.add("is-visible");
      syncOverlayToImage(frame, image, overlay);
      renderCanvasFromLayers();
      renderLeftPanel();
      updateCanvasUI();
    };

    image.onerror = () => {
      placeholder.hidden = false;
      image.classList.remove("is-visible");
      overlay.classList.remove("is-visible");
      updateCanvasUI();
    };

    image.src = objectUrl;
  });

  renderLeftPanel();
  refreshHistoryButtons();
  updateCanvasUI();
}
