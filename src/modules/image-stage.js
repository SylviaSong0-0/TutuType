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
const MOBILE_BREAKPOINT_MEDIA = "(max-width: 768px)";

function createRandomPathId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `draw-path-${crypto.randomUUID()}`;
  }
  return `draw-path-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function isMobileViewport() {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(MOBILE_BREAKPOINT_MEDIA).matches;
}

function formatMeta(file, image) {
  const kb = Math.max(1, Math.round(file.size / 1024));
  return `${file.name} | ${image.naturalWidth}x${image.naturalHeight} | ${kb} KB`;
}

/**
 * Downsamples an image using Canvas to protect mobile memory.
 * Caps long edge at MAX_SIZE and exports as lightweight JPEG.
 */
async function downsampleImage(file, maxSize = 1920) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > maxSize || height > maxSize) {
          if (width > height) {
            height = Math.round(height * (maxSize / width));
            width = maxSize;
          } else {
            width = Math.round(width * (maxSize / height));
            height = maxSize;
          }
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("Failed to get canvas context"));
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        // Export as JPEG with 0.8 quality for significant memory savings
        resolve(canvas.toDataURL("image/jpeg", 0.8));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
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
  path.dataset.helper = "true";
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
  
  // V6.8: Ensure font-family is properly quoted if it contains spaces
  let ff = layer.fontFamily || "'SourceHanSansHWSC', sans-serif";
  textNode.setAttribute("font-family", ff);
  
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

function isLikelyMobileDevice() {
  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || (navigator.maxTouchPoints && navigator.maxTouchPoints > 2);
  return !!isMobile;
}

const fontBase64Cache = new Map();

async function fetchFontAsBase64(url) {
  const absoluteUrl = new URL(url, window.location.href).href;
  if (fontBase64Cache.has(absoluteUrl)) return fontBase64Cache.get(absoluteUrl);
  try {
    const response = await fetch(absoluteUrl);
    const blob = await response.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = reader.result;
        fontBase64Cache.set(absoluteUrl, base64);
        resolve(base64);
      };
      reader.readAsDataURL(blob);
    });
  } catch (e) {
    console.error("Font fetch failed:", absoluteUrl, e);
    return null;
  }
}

const hitTestCanvas = document.createElement("canvas");

const hitTestCtx = hitTestCanvas.getContext("2d");

function isPointInPencilStroke(x, y, layer) {
  if (!layer.d || !layer.box) return false;
  const path = new Path2D(layer.d);
  hitTestCtx.save();
  const tx = layer.translateX || 0;
  const ty = layer.translateY || 0;
  const cx = layer.cx || 0;
  const cy = layer.cy || 0;
  const rot = (layer.rotation || 0) * Math.PI / 180;
  const scale = layer.scale || 1;

  hitTestCtx.translate(tx + cx, ty + cy);
  hitTestCtx.rotate(rot);
  hitTestCtx.scale(scale, scale);
  hitTestCtx.translate(-cx, -cy);

  hitTestCtx.lineWidth = 40;
  const hit = hitTestCtx.isPointInStroke(path, x, y);
  hitTestCtx.restore();
  return hit;
}

function isPointInBBox(x, y, layer) {
  if (!layer.box) return false;
  const pad = 20;
  const tx = layer.translateX || 0;
  const ty = layer.translateY || 0;
  const cx = tx + layer.cx;
  const cy = ty + layer.cy;
  const scale = layer.scale || 1;
  const w = layer.box.width * scale + pad;
  const h = layer.box.height * scale + pad;
  return Math.abs(x - cx) < w / 2 && Math.abs(y - cy) < h / 2;
}

function debounce(fn, delay) {

  let timer = null;
  return function(...args) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

function showToast(message) {
  const toast = document.createElement("div");
  toast.className = "tutu-toast";
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 1500);
}

function downloadBlobAsPng(blob, fileName) {

  const url = URL.createObjectURL(blob);
  const downloadLink = document.createElement("a");
  downloadLink.href = url;
  downloadLink.download = fileName;
  downloadLink.click();
  showToast("图片已保存至本地");
  setTimeout(() => URL.revokeObjectURL(url), 1000);

}

function showLongPressPreviewModal(imageUrl) {
  const existing = document.querySelector(".preview-modal");
  if (existing) existing.remove();

  const modal = document.createElement("div");
  modal.className = "preview-modal";

  const content = document.createElement("div");
  content.className = "preview-modal-content";

  const hint = document.createElement("p");
  hint.className = "preview-modal-hint";
  hint.textContent = "👉 请长按图片保存到系统相册 👈";

  const image = document.createElement("img");
  image.className = "preview-modal-image";
  image.src = imageUrl;
  image.alt = "导出预览";

  const closeButton = document.createElement("button");
  closeButton.className = "preview-modal-close";
  closeButton.type = "button";
  closeButton.textContent = "关闭 / 返回编辑";

  const closeModal = () => {
    modal.remove();
    URL.revokeObjectURL(imageUrl);
  };

  closeButton.addEventListener("click", closeModal);
  modal.addEventListener("click", (event) => {
    if (event.target === modal) closeModal();
  });

  content.appendChild(hint);
  content.appendChild(image);
  content.appendChild(closeButton);
  modal.appendChild(content);
  document.body.appendChild(modal);
}

async function exportCompositeImage(image, overlay, layers) {
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
  
    // V6.8: Physical Base64 Font Injection
    const usedFontFamilies = new Set(layers.map(l => {
      const ff = l.fontFamily || "'SourceHanSansHWSC', sans-serif";
      // Extract the first font name (e.g., 'LXGWWenKaiMono' from "'LXGWWenKaiMono', serif")
      const match = ff.match(/'([^']+)'/);
      return match ? match[1] : ff.split(',')[0].trim();
    }));

    const fontFaceRules = [];
    const styleSheets = Array.from(document.styleSheets);
    for (const sheet of styleSheets) {
      try {
        const rules = Array.from(sheet.cssRules);
        for (const rule of rules) {
          if (rule.type === CSSRule.FONT_FACE_RULE) {
            const family = rule.style.getPropertyValue("font-family").replace(/['"]/g, "").trim();
            if (usedFontFamilies.has(family)) {
              const src = rule.style.getPropertyValue("src");
              const urlMatch = src.match(/url\(["']?([^"']+)["']?\)/);
              if (urlMatch) {
                const fontUrl = urlMatch[1];
                const base64 = await fetchFontAsBase64(fontUrl);
                if (base64) {
                  fontFaceRules.push(`@font-face { font-family: '${family}'; src: url("${base64}") format('woff2'); }`);
                }
              }
            }
          }
        }
      } catch (e) {
        // Skip cross-origin sheets that we can't read
      }
    }

    const exportSvg = overlay.cloneNode(true);
    exportSvg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    exportSvg.setAttribute("viewBox", `0 0 ${image.naturalWidth} ${image.naturalHeight}`);
    exportSvg.setAttribute("width", `${image.naturalWidth}`);
    exportSvg.setAttribute("height", `${image.naturalHeight}`);
    
    const styleNode = document.createElementNS("http://www.w3.org/2000/svg", "style");
    styleNode.textContent = fontFaceRules.join("\n");
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

    const blob = await new Promise((resolve) => {
      canvas.toBlob((result) => resolve(result), "image/png");
    });
    if (!blob) return;

    const fileName = `TutuType_${Date.now()}.png`;
    const file = new File([blob], fileName, { type: "image/png" });
    const isMobile = isLikelyMobileDevice();

    // V4.6 Routing Override: Strictly lock Share API to mobile devices
    if (isMobile && navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({
          files: [file],
          title: "TutuType 导出",
        });
        showToast("图片已保存至本地");
        return;

      } catch (error) {
        console.error("Share failed:", error);
        // Fallback for mobile if sharing is interrupted or fails
        const previewUrl = URL.createObjectURL(blob);
        showLongPressPreviewModal(previewUrl);
        return;
      }
    }

    // Desktop logic: Direct silent download
    // Mobile fallback (if share is not supported): Show long-press modal
    if (isMobile) {
      const previewUrl = URL.createObjectURL(blob);
      showLongPressPreviewModal(previewUrl);
    } else {
      downloadBlobAsPng(blob, fileName);
    }
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
  const emptyStateTrigger = document.querySelector("#empty-state-trigger");


  if (!input || !image || !placeholder || !frame || !overlay || !leftPanelRoot || !undoButton || !redoButton) {
    return;
  }

  const updateCanvasUI = () => {
    const hasImage = !!image.src;
    if (stageToolbar) stageToolbar.style.display = hasImage ? "flex" : "none";
    if (stageToolbarBottom) stageToolbarBottom.style.display = hasImage ? "flex" : "none";
    if (placeholder) placeholder.style.display = hasImage ? "none" : "flex";
  };

  if (emptyStateTrigger) {
    emptyStateTrigger.addEventListener("click", () => input.click());
  }


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

  const createLayerRecord = ({ type, text, fontFamily, fontSize, color, letterSpacing, isBold, strokeColor, strokeWidth, hasStroke, isVertical, pathMode, scale, rotation, d, x, y, pathElementId }) => ({
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
    pathMode: pathMode || 'freehand',
    scale: scale ?? 1,
    rotation: rotation ?? 0,
    d,
    freehandD: d,
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
    gizmoElement: null,
  });

  const updateSelectionStyles = () => {
    layers.forEach((layer) => {
      const isActive = layer.id === activeLayerId;
      const isExpanded = layer.id === expandedLayerId;
      if (layer.pathElement) {
        layer.pathElement.setAttribute("opacity", isExpanded ? HELPER_PATH_OPACITY : "0");
      }
      if (layer.hitboxElement) {
        layer.hitboxElement.setAttribute("stroke", isActive && isExpanded ? "rgba(38, 38, 38, 0.12)" : "transparent");
      }
      if (layer.handleElement) {
        layer.handleElement.setAttribute("display", isActive && isExpanded ? "block" : "none");
      }
      const gizmo = layer.gizmoElement || layer.groupElement?.querySelector?.('[data-role="gizmo"]') || null;
      if (gizmo) {
        gizmo.setAttribute("display", isExpanded ? "block" : "none");
        layer.gizmoElement = gizmo;
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
    renderCanvasFromLayers();
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

  const generateStaticPath = (mode) => {
    if (!overlay) return "";
    const cx = overlay.clientWidth / 2;
    const cy = overlay.clientHeight / 2;
    const r = Math.min(cx, cy) * 0.5;
    let d = "";
    if (mode === "circle") {
       d = `M ${cx-r},${cy} A ${r},${r} 0 1,1 ${cx+r},${cy} A ${r},${r} 0 1,1 ${cx-r},${cy}`;
    } else if (mode === "rectangle") {
       d = `M ${cx-r},${cy-r} L ${cx+r},${cy-r} L ${cx+r},${cy+r} L ${cx-r},${cy+r} Z`;
    } else if (mode === "star") {
       for(let i=0; i<5; i++) {
         const a1 = -Math.PI/2 + (i*2*Math.PI)/5;
         const a2 = -Math.PI/2 + ((i+0.5)*2*Math.PI)/5;
         const p1x = cx + r * Math.cos(a1);
         const p1y = cy + r * Math.sin(a1);
         const p2x = cx + r * 0.4 * Math.cos(a2);
         const p2y = cy + r * 0.4 * Math.sin(a2);
         if(i===0) d += `M ${p1x},${p1y} `;
         else d += `L ${p1x},${p1y} `;
         d += `L ${p2x},${p2y} `;
       }
       d += "Z";
    } else if (mode === "flower") {
       const N = 5; // Number of petals
       const R = r * 0.8; // Base radius
       const A = r * 0.22; // Amplitude for 5 petals
       const numSamples = 120;
       
       const points = [];
       for (let i = 0; i <= numSamples; i++) {
         const theta = (i * Math.PI * 2) / numSamples;
         const currentR = R + A * Math.sin(N * theta);
         points.push({
           x: cx + currentR * Math.cos(theta - Math.PI / 2),
           y: cy + currentR * Math.sin(theta - Math.PI / 2)
         });
       }

       // Generate smoothed path using cubic bazier spline logic
       d = `M ${points[0].x},${points[0].y} `;
       for (let i = 0; i < numSamples; i++) {
         const p0 = points[i === 0 ? numSamples - 1 : i - 1];
         const p1 = points[i];
         const p2 = points[i + 1];
         const p3 = points[i + 2 >= numSamples ? i + 2 - numSamples : i + 2];
         
         const cp1x = p1.x + (p2.x - p0.x) / 6;
         const cp1y = p1.y + (p2.y - p0.y) / 6;
         
         const cp2x = p2.x - (p3.x - p1.x) / 6;
         const cp2y = p2.y - (p3.y - p1.y) / 6;
         
         d += `C ${cp1x},${cp1y} ${cp2x},${cp2y} ${p2.x},${p2.y} `;
       }
       d += "Z";
    }
    return d;
  };

  let gizmoState = null;
  const startGizmoAction = (e, action, layer, cx, cy, box) => {
     gizmoState = {
        pointerId: e.pointerId,
        action,
        layerId: layer.id,
        cx, cy,
        boxWidth: box.width,
        boxHeight: box.height,
        startScale: layer.scale || 1,
        startRot: layer.rotation || 0,
        startX: e.clientX,
        startY: e.clientY,
     };
     overlay.setPointerCapture(e.pointerId);
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
      const showLayerGuides = layer.id === expandedLayerId;

      const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
      group.dataset.layerId = layer.id;
      group.setAttribute("transform", `translate(${layer.translateX || 0}, ${layer.translateY || 0})`);
        overlay.appendChild(group);
        layer.groupElement = group;
  
        // V6.6: Listeners removed from group. Centralized in overlay.pointerdown.
  
        if (layer.type === "path") {

          layer.gizmoElement = null;
          const innerGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
          group.appendChild(innerGroup);
  
          // Hitbox
          const hitbox = document.createElementNS("http://www.w3.org/2000/svg", "path");
          hitbox.dataset.hitbox = "true";
          hitbox.setAttribute("d", layer.d);
          hitbox.setAttribute("fill", "none");
          hitbox.setAttribute("stroke", "transparent");
          hitbox.setAttribute("stroke-width", `${HITBOX_STROKE_WIDTH}`);
          hitbox.setAttribute("pointer-events", "stroke");
          innerGroup.appendChild(hitbox);
          layer.hitboxElement = hitbox;
  
          // Actual path for textPath reference
          const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
          path.id = layer.pathElementId || createRandomPathId();
          layer.pathElementId = path.id;
          path.dataset.helper = "true";
          path.setAttribute("fill", "transparent");
          path.setAttribute("pointer-events", "all");
          path.setAttribute("stroke", "rgba(75, 85, 99, 1)");
          path.setAttribute("stroke-width", "2");
          path.setAttribute("stroke-linecap", "round");
          path.setAttribute("stroke-linejoin", "round");
          path.setAttribute("opacity", showLayerGuides ? HELPER_PATH_OPACITY : "0");
          path.setAttribute("d", layer.d);
          innerGroup.appendChild(path);
          layer.pathElement = path;
  
          // V6.4 Unified Hitbox: Only for geometric shapes now (V6.5 split)
          if (showLayerGuides && layer.pathMode && layer.pathMode !== "freehand") {
            try {
              const box = path.getBBox();
              if (box.width > 0 && box.height > 0) {
                const dragZone = document.createElementNS("http://www.w3.org/2000/svg", "rect");
                dragZone.setAttribute("x", box.x);
                dragZone.setAttribute("y", box.y);
                dragZone.setAttribute("width", box.width);
                dragZone.setAttribute("height", box.height);
                dragZone.setAttribute("fill", "transparent");
                dragZone.setAttribute("pointer-events", "all");
                dragZone.style.cursor = "move";
                innerGroup.insertBefore(dragZone, hitbox);
              }
            } catch (e) {}
          }

  
          // Text (visual, no pointer events)

        const text = createPathBoundText(innerGroup, layer, path);
        layer.textElement = text;

        let cx = 0, cy = 0, scale = layer.scale || 1, rotation = layer.rotation || 0;
        try {
          const box = path.getBBox();
          layer.box = { x: box.x, y: box.y, width: box.width, height: box.height };
          if (box.width > 0 && box.height > 0) {
            cx = box.x + box.width / 2;
            cy = box.y + box.height / 2;
            layer.cx = cx;
            layer.cy = cy;
            innerGroup.setAttribute("transform", `translate(${cx}, ${cy}) rotate(${rotation}) scale(${scale}) translate(${-cx}, ${-cy})`);


            if (layer.pathMode && layer.pathMode !== "freehand") {
              const pad = 10;
              const scaledWidth = box.width * scale;
              const scaledHeight = box.height * scale;
              const sx = cx - scaledWidth / 2 - pad;
              const sy = cy - scaledHeight / 2 - pad;
              const sw = scaledWidth + pad * 2;
              const sh = scaledHeight + pad * 2;

              const gizmo = document.createElementNS("http://www.w3.org/2000/svg", "g");
              gizmo.dataset.helper = "true";
              gizmo.dataset.role = "gizmo";
              gizmo.setAttribute("display", showLayerGuides ? "block" : "none");
              gizmo.setAttribute("transform", `translate(${cx}, ${cy}) rotate(${rotation}) translate(${-cx}, ${-cy})`);

              const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
              rect.setAttribute("x", sx);
              rect.setAttribute("y", sy);
              rect.setAttribute("width", sw);
              rect.setAttribute("height", sh);
              rect.setAttribute("fill", "none");
              rect.setAttribute("stroke", "#555");
              rect.setAttribute("stroke-width", "1");
              rect.setAttribute("stroke-dasharray", "4 4");
              // V6.5: Pencil gizmos are click-through
              rect.setAttribute("pointer-events", layer.pathMode === "freehand" ? "none" : "none"); 
              gizmo.style.pointerEvents = layer.pathMode === "freehand" ? "none" : "all";
              gizmo.appendChild(rect);


              const createHandle = (x, y, cursor, action) => {
                const handleSize = isMobileViewport() ? 24 : 8;
                const halfHandleSize = handleSize / 2;
                const h = document.createElementNS("http://www.w3.org/2000/svg", "rect");
                h.setAttribute("x", x - halfHandleSize);
                h.setAttribute("y", y - halfHandleSize);
                h.setAttribute("width", handleSize);
                h.setAttribute("height", handleSize);
                h.setAttribute("fill", "#262626");
                h.setAttribute("cursor", cursor);
                h.dataset.action = action;
                h.style.pointerEvents = "all";
                h.addEventListener("pointerdown", (e) => {
                  e.stopPropagation();
                  setActiveLayerOnly(layer.id);
                  startGizmoAction(e, action, layer, cx, cy, box);
                });
                return h;
              };

              gizmo.appendChild(createHandle(sx, sy, "nwse-resize", "scale-tl"));
              gizmo.appendChild(createHandle(sx + sw, sy, "nesw-resize", "scale-tr"));
              gizmo.appendChild(createHandle(sx, sy + sh, "nesw-resize", "scale-bl"));
              gizmo.appendChild(createHandle(sx + sw, sy + sh, "nwse-resize", "scale-br"));

              const rotLine = document.createElementNS("http://www.w3.org/2000/svg", "line");
              rotLine.setAttribute("x1", sx + sw / 2);
              rotLine.setAttribute("y1", sy);
              rotLine.setAttribute("x2", sx + sw / 2);
              rotLine.setAttribute("y2", sy - 20);
              rotLine.setAttribute("stroke", "#555");
              rotLine.setAttribute("stroke-width", "1");
              gizmo.appendChild(rotLine);

              const rotGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
              rotGroup.style.cursor = "crosshair";
              rotGroup.style.pointerEvents = "all";
              rotGroup.addEventListener("pointerdown", (e) => {
                e.stopPropagation();
                setActiveLayerOnly(layer.id);
                startGizmoAction(e, "rotate", layer, cx, cy, box);
              });

              const rotHandle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
              const rotateHandleRadius = isMobileViewport() ? 12 : 8;
              rotHandle.setAttribute("cx", sx + sw / 2);
              rotHandle.setAttribute("cy", sy - 20);
              rotHandle.setAttribute("r", `${rotateHandleRadius}`);
              rotHandle.setAttribute("fill", "#262626");
              rotGroup.appendChild(rotHandle);

              const rotIcon = document.createElementNS("http://www.w3.org/2000/svg", "path");
              const rx = sx + sw / 2;
              const ry = sy - 20;
              // Simple refresh/rotate icon path
              rotIcon.setAttribute("d", `M ${rx-3} ${ry-1} A 3.5 3.5 0 1 1 ${rx+3} ${ry+1} M ${rx+1} ${ry-4} L ${rx+4.5} ${ry-1} L ${rx+1} ${ry+1.5}`);
              rotIcon.setAttribute("stroke", "#ffffff");
              rotIcon.setAttribute("stroke-width", "1");
              rotIcon.setAttribute("fill", "none");
              rotIcon.setAttribute("stroke-linecap", "round");
              rotGroup.appendChild(rotIcon);

              gizmo.appendChild(rotGroup);

              group.appendChild(gizmo);
              layer.gizmoElement = gizmo;
            }
          }
        } catch (e) {}

        // Extend handle follows selected state for completed freehand paths.
        if (layer.status === "completed" && (!layer.pathMode || layer.pathMode === "freehand")) {
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
          handle.setAttribute("display", layer.id === activeLayerId && showLayerGuides ? "block" : "none");
          handle.setAttribute("pointer-events", "all");
          handle.setAttribute("transform", `translate(${cx}, ${cy}) rotate(${rotation}) scale(${scale}) translate(${-cx}, ${-cy})`);
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
        layer.gizmoElement = null;
        const text = createStampText(group, layer, () => {});
        layer.textElement = text;
      }
    });
    if (expandedLayerId) {
      const expandedLayer = layers.find((layer) => layer.id === expandedLayerId);
      const expandedGroup = expandedLayer?.groupElement;
      if (expandedGroup && expandedGroup.parentNode === overlay) {
        overlay.appendChild(expandedGroup);
      }
    }
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
        pathMode: layer.pathMode || 'freehand',
        scale: layer.scale ?? 1,
        rotation: layer.rotation ?? 0,
        d: layer.d,
        freehandD: layer.freehandD,
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
      gizmoElement: null,
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
                    ? `
                      <p class="pending-hint">请在图片上绘制轨迹，或直接选择快捷几何图形：</p>
                      <div class="quick-shape-matrix">
                        <button class="quick-shape-btn ${!layer.pathMode || layer.pathMode === 'freehand' ? 'active' : ''}" data-action="quick-shape" data-shape="freehand" data-layer-id="${layer.id}" title="自由手绘">
                          <span class="shape-icon">✏️</span>
                          <span>手绘</span>
                        </button>
                        <button class="quick-shape-btn" data-action="quick-shape" data-shape="circle" data-layer-id="${layer.id}" title="生成圆形路径">
                          <span class="shape-icon">⭕️</span>
                          <span>圆形</span>
                        </button>
                        <button class="quick-shape-btn" data-action="quick-shape" data-shape="rectangle" data-layer-id="${layer.id}" title="生成矩形路径">
                          <span class="shape-icon">🔲</span>
                          <span>矩形</span>
                        </button>
                        <button class="quick-shape-btn" data-action="quick-shape" data-shape="star" data-layer-id="${layer.id}" title="生成五角星路径">
                          <span class="shape-icon">⭐</span>
                          <span>五角星</span>
                        </button>
                        <button class="quick-shape-btn" data-action="quick-shape" data-shape="flower" data-layer-id="${layer.id}" title="生成花型路径">
                          <span class="shape-icon">✿</span>
                          <span>花型</span>
                        </button>
                      </div>
                    `
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
                    <div class="path-mode-card">
                      <label class="path-mode-label">路径模式 (Path Mode)</label>
                      <div class="segmented-control">
                        <button class="segment-btn ${!layer.pathMode || layer.pathMode === 'freehand' ? 'active' : ''}" data-prop="pathMode" data-val="freehand" data-layer-id="${layer.id}" title="自由手绘">✏️</button>
                        <button class="segment-btn ${layer.pathMode === 'circle' ? 'active' : ''}" data-prop="pathMode" data-val="circle" data-layer-id="${layer.id}" title="圆形">●</button>
                        <button class="segment-btn ${layer.pathMode === 'rectangle' ? 'active' : ''}" data-prop="pathMode" data-val="rectangle" data-layer-id="${layer.id}" title="矩形">■</button>
                        <button class="segment-btn ${layer.pathMode === 'star' ? 'active' : ''}" data-prop="pathMode" data-val="star" data-layer-id="${layer.id}" title="五角星">★</button>
                        <button class="segment-btn ${layer.pathMode === 'flower' ? 'active' : ''}" data-prop="pathMode" data-val="flower" data-layer-id="${layer.id}" title="花型">✿</button>
                      </div>
                    </div>
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

    const hasPendingLayer = layers.some((layer) => !layer.isDraft && layer.status === "pending");

    leftPanelRoot.innerHTML = `
      ${uploadStateHtml}
      ${image.src ? `
      <section class="panel-section">
        <div class="layer-stack">${layerCardsHtml}</div>
        ${hasPendingLayer ? "" : `<button class="add-layer-button" data-action="add-layer" type="button" style="margin-top: 10px;">添加新文字路径</button>`}
      </section>
      ` : ''}
    `;

    leftPanelRoot.querySelector('[data-action="pick-image"]')?.addEventListener("click", () => input.click());
    leftPanelRoot.querySelector('[data-action="add-layer"]')?.addEventListener("click", () => {
      const layer = createLayerRecord({
        type: "path",
        text: "",
        fontFamily: "'SourceHanSansHWSC', sans-serif",
        fontSize: 20,
        color: "#000000",
        letterSpacing: 0,
        isBold: false,
        strokeColor: "#ffffff",
        strokeWidth: 2,
        hasStroke: true,
        pathMode: "freehand",
        scale: 1,
        rotation: 0,
        d: "",
        x: null,
        y: null,
        pathElementId: createRandomPathId(),
      });
      layer.isDraft = true;
      layers.push(layer);
      activeLayerId = layer.id;
      expandedLayerId = null;
      renderCanvasFromLayers();
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
        renderCanvasFromLayers();
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
        renderCanvasFromLayers();
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

    leftPanelRoot.querySelectorAll('[data-action="quick-shape"]').forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-layer-id");
        const shape = btn.getAttribute("data-shape");
        updateLayerAndRender(id, (layer) => {
          const oldMode = layer.pathMode;
          // Cache current freehand path if switching AWAY from freehand
          if (oldMode === "freehand" && shape !== "freehand") {
            layer.freehandD = layer.d;
          }
          layer.pathMode = shape;
          if (shape === "freehand") {
            layer.d = layer.freehandD || "";
            layer.status = layer.d ? "completed" : "pending";
          } else {
            layer.d = generateStaticPath(shape);
            layer.status = "completed";
          }
        }, true);
        saveState();
      });
    });



    leftPanelRoot.querySelectorAll('.segment-btn[data-prop="pathMode"]').forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-layer-id");
        const val = btn.getAttribute("data-val");
        updateLayerAndRender(id, (layer) => {
          const oldMode = layer.pathMode;
          if (oldMode === "freehand" && val !== "freehand") {
             layer.freehandD = layer.d;
          }
          layer.pathMode = val;
          if (val !== "freehand") {
            layer.d = generateStaticPath(val);
            layer.status = "completed";
          } else {
            // Restore from cache instead of instant clear
            layer.d = layer.freehandD || "";
            layer.status = layer.d ? "completed" : "pending";
          }
        }, true);
        saveState();
      });
    });



    leftPanelRoot.querySelectorAll('input[data-prop], select[data-prop], textarea[data-prop]').forEach((control) => {
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
      const debouncedApply = debounce(() => apply(false), 200);

      control.addEventListener("input", () => {
        if (prop === "color" || prop === "strokeColor") {
          debouncedApply();
        } else {
          apply(false);
        }
        if (prop === "fontSize" || prop === "letterSpacing" || prop === "strokeWidth") {
          const output = control.previousElementSibling?.querySelector("output");
          if (output) output.textContent = `${control.value}px`;
        }
      });

      control.addEventListener("change", () => {
        apply(true);
        saveState();
      });
      if (control instanceof HTMLInputElement && control.type === "range") {
        control.addEventListener("touchmove", (event) => {
          if (!isLikelyMobileDevice()) return;
          // Stop touchmove from bubbling to browser edge-swipe handlers.
          event.stopPropagation();
        }, { passive: true });
      }
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
      handle.addEventListener("touchstart", () => {
        card.setAttribute("draggable", "true");
      }, { passive: true });
      handle.addEventListener("mouseup", disableDrag);
      handle.addEventListener("touchend", disableDrag, { passive: true });
      handle.addEventListener("touchcancel", disableDrag, { passive: true });
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
    await exportCompositeImage(image, overlay, layers);
  });


  const handleResize = () => syncOverlayToImage(frame, image, overlay);
  const resizeObserver = new ResizeObserver(handleResize);
  resizeObserver.observe(frame);
  resizeObserver.observe(image);
  window.addEventListener("resize", handleResize);

  overlay.addEventListener("pointerdown", (event) => {
    if (!overlay.classList.contains("is-visible")) return;
    const p = localPointInOverlay(event.clientX, event.clientY);
    if (!p) return;

    // V6.6 Global Event Dispatcher: Loop through layers top to bottom
    const hitTestOrder = [...layers].reverse();
    let hitLayer = null;

    // We check handles/gizmos first (handled by their own bubbling listeners usually,
    // but here we ensure they don't trigger layer selection if clicked directly)
    if (event.target && event.target.closest?.('[data-role="gizmo"]')) return;
    if (event.target && event.target.closest?.('[data-role="extend-handle"]')) return;

    for (const layer of hitTestOrder) {
      if (!layer.box) continue;
      const hit = (layer.pathMode === "freehand") 
          ? isPointInPencilStroke(p.x, p.y, layer) 
          : isPointInBBox(p.x, p.y, layer);
      
      if (hit) {
        hitLayer = layer;
        break;
      }
    }

    if (hitLayer) {
      event.stopPropagation();
      setActiveLayerAndExpand(hitLayer.id);
      moveState = {
        pointerId: event.pointerId,
        startX: p.x,
        startY: p.y,
        baseTranslateX: hitLayer.translateX || 0,
        baseTranslateY: hitLayer.translateY || 0,
        layerId: hitLayer.id,
      };
      overlay.setPointerCapture(event.pointerId);
      return;
    }

    // No hit? Handle deselection and new drawing
    const activeLayer = getActiveLayer();
    if (activeLayer && !activeLayer.isDraft && activeLayer.status === "completed") {
      activeLayerId = null;
      expandedLayerId = null;
      renderCanvasFromLayers();
      renderLeftPanel();
      updateSelectionStyles();
      // If we were just deselecting, stop here or continue to start new path if in freehand
      if (event.target !== overlay) return;
    }

    if (event.target !== overlay) return;

    // V6.0 State Machine Guard: If the current layer is in a geometric mode, block drawing.
    if (activeLayer && activeLayer.pathMode && activeLayer.pathMode !== "freehand") {
      return;
    }

    overlay.setPointerCapture(event.pointerId);
    drawingState = {
      isDrawing: true,
      points: [p],
      activePath: null, // V6.4: Lazy create path to protect cache
      pointerId: event.pointerId,
      startPoint: p,
      startedAt: Date.now(),
      startedWithCompletedSelection: Boolean(
        activeLayer && !activeLayer.isDraft && activeLayer.status === "completed",
      ),
      clearedSelectionOnDrag: false,
    };

    if (drawingState.startedWithCompletedSelection) {
      activeLayerId = null;
      expandedLayerId = null;
      renderCanvasFromLayers();
      renderLeftPanel();
      updateSelectionStyles();
      hideSelectionVisuals();
      drawingState.clearedSelectionOnDrag = true;
    }
  });


  let moveRafPending = false;
  let latestMoveEvent = null;

  overlay.addEventListener("pointermove", (event) => {
    latestMoveEvent = event;
    if (moveRafPending) return;
    moveRafPending = true;

    requestAnimationFrame(() => {
      moveRafPending = false;
      const e = latestMoveEvent;
      if (!e) return;

      if (gizmoState && gizmoState.pointerId === e.pointerId) {
        const layer = layers.find((l) => l.id === gizmoState.layerId);
        if (!layer) return;
        const localP = localPointInLayer(layer, e.clientX, e.clientY);
        if (!localP) return;

        if (gizmoState.action === "rotate") {
          const dx = localP.x - gizmoState.cx;
          const dy = localP.y - gizmoState.cy;
          let angle = (Math.atan2(dy, dx) * 180) / Math.PI;
          layer.rotation = angle + 90;
          renderCanvasFromLayers();
        } else if (gizmoState.action.startsWith("scale")) {
          const dx = localP.x - gizmoState.cx;
          const dy = localP.y - gizmoState.cy;
          const rad = -(gizmoState.startRot) * Math.PI / 180;
          const urx = dx * Math.cos(rad) - dy * Math.sin(rad);
          const ury = dx * Math.sin(rad) + dy * Math.cos(rad);
          
          const ratioX = Math.abs(urx) / (gizmoState.boxWidth / 2);
          const ratioY = Math.abs(ury) / (gizmoState.boxHeight / 2);
          const newScale = e.shiftKey ? Math.max(ratioX, ratioY) : Math.max(ratioX, ratioY);
          layer.scale = Math.max(0.1, newScale);
          renderCanvasFromLayers();
        }
        return;
      }

      if (moveState && moveState.pointerId === e.pointerId) {
        const layer = layers.find((l) => l.id === moveState.layerId);
        const p = localPointInOverlay(e.clientX, e.clientY);
        if (!layer || !p) return;
        const dx = p.x - moveState.startX;
        const dy = p.y - moveState.startY;
        layer.translateX = moveState.baseTranslateX + dx;
        layer.translateY = moveState.baseTranslateY + dy;
        layer.groupElement?.setAttribute("transform", `translate(${layer.translateX}, ${layer.translateY})`);
        return;
      }

      if (extendState && extendState.pointerId === e.pointerId) {
        const layer = layers.find((l) => l.id === extendState.layerId);
        if (!layer || !layer.pathElement) return;
        const p = localPointInLayer(layer, e.clientX, e.clientY);
        if (!p) return;
        extendState.appendedPoints.push(p);
        
        const simplified = simplifyPointsRdp(extendState.appendedPoints, RDP_EPSILON);
        const combined = extendState.basePoints.concat(simplified);
        const simplifiedAll = simplifyPointsRdp(combined, RDP_EPSILON);
        layer.pathElement.setAttribute("d", buildSmoothPath(simplifiedAll));
        return;
      }

      if (!drawingState.isDrawing || drawingState.pointerId !== e.pointerId) return;

      const point = toLocalPoint(overlay, e.clientX, e.clientY);
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
          renderCanvasFromLayers();
          renderLeftPanel();
          updateSelectionStyles();
          drawingState.clearedSelectionOnDrag = true;
        }
      }

      drawingState.points.push(point);

      // V6.4: Only initialize a new path and clear cache if movement exceeds threshold
      if (!drawingState.activePath) {
        const movedDistance = Math.hypot(
          point.x - drawingState.startPoint.x,
          point.y - drawingState.startPoint.y,
        );
        if (movedDistance > CLICK_LENGTH_THRESHOLD) {
          const layer = getActiveLayer();
          if (layer && (layer.isDraft || layer.status === "pending" || layer.pathMode === "freehand")) {
             layer.d = "";
             layer.freehandD = "";
          }
          drawingState.activePath = createStrokePath(overlay);
        } else {
          return; // Wait for more movement
        }
      }

      const simplified = simplifyPointsRdp(drawingState.points, RDP_EPSILON);
      drawingState.activePath?.setAttribute("d", buildSmoothPath(simplified));
    });

  });

  overlay.addEventListener("touchmove", (event) => {
    if (drawingState.isDrawing || moveState || extendState || gizmoState) {
      event.preventDefault();
    }
  }, { passive: false });

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
    const isStationaryPress =
      movedDistance <= CLICK_LENGTH_THRESHOLD &&
      (simplified.length <= CLICK_POINT_THRESHOLD || pathLength <= CLICK_LENGTH_THRESHOLD);
    const startedWithCompletedSelection = drawingState.startedWithCompletedSelection;
    const source = getActiveLayer();
    const text = DIRECT_DRAW_TEXT;
    const fontFamily = source?.fontFamily ?? "'SourceHanSansHWSC', sans-serif";
    const fontSize = source?.fontSize ?? 20;
    const color = source?.color ?? "#000000";
    const letterSpacing = source?.letterSpacing ?? 0;
    const isBold = source?.isBold ?? false;
    const hasStroke = source?.hasStroke ?? true;
    const strokeColor = source?.strokeColor ?? "#ffffff";
    const strokeWidth = source?.strokeWidth ?? 2;
    const isVertical = source?.isVertical ?? false;

    const shouldReuseActiveLayer = source && (source.isDraft || source.status === "pending");

    if (isClickMode || isStationaryPress) {
      drawingState.activePath?.remove();
      if (startedWithCompletedSelection) {
        activeLayerId = null;
        expandedLayerId = null;
        renderCanvasFromLayers();
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
      // Disable single-click stamp creation; only freehand path drawing creates text paths.
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
            hasStroke,
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
      record.hasStroke = hasStroke;
      record.strokeColor = strokeColor;
      record.strokeWidth = strokeWidth;
      record.isVertical = isVertical;
      record.d = d;
      record.freehandD = d;
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
    if (gizmoState && gizmoState.pointerId === event.pointerId) {
      gizmoState = null;
      saveState();
      return;
    }
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
        layer.freehandD = layer.d;
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

  input.addEventListener("change", async () => {
    const [file] = input.files ?? [];
    if (!file) return;

    uploadFileName = file.name;
    
    // Hard Reset Logic
    layers = [];
    history = [];
    historyIndex = -1;
    activeLayerId = null;
    expandedLayerId = null;
    overlay.replaceChildren();


    try {
      // Intercept original file and downsample it before set to image.src
      const compressedUrl = await downsampleImage(file, 1920);
      
      if (objectUrl && objectUrl.startsWith("blob:")) {
        URL.revokeObjectURL(objectUrl);
      }
      objectUrl = compressedUrl;

      image.onload = () => {
        image.classList.add("is-visible");

        syncOverlayToImage(frame, image, overlay);
        renderCanvasFromLayers();
        renderLeftPanel();
        updateCanvasUI();
      };

      image.onerror = () => {
        image.classList.remove("is-visible");

        overlay.classList.remove("is-visible");
        updateCanvasUI();
      };

      image.src = objectUrl;
    } catch (err) {
      console.error("Image processing failed:", err);
      alert("图片处理失败，请尝试换一张图片。");
    }
  });

  renderLeftPanel();
  refreshHistoryButtons();
  updateCanvasUI();
}
