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

const ICONS = {
  PENCIL: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>`,
  DOT: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="8"/></svg>`,
  SQUARE: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="4" y="4" width="16" height="16" rx="2"/></svg>`,
  STAR: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>`,
  FLOWER: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0 -6 0"/><path d="M12 7c0-2.5 2-4.5 4.5-4.5S21 4.5 21 7s-2 4.5-4.5 4.5"/><path d="M12 7c0-2.5-2-4.5-4.5-4.5S3 4.5 3 7s2 4.5 4.5 4.5"/><path d="M12 17c0 2.5 2 4.5 4.5 4.5s4.5-2 4.5-4.5-2-4.5-4.5-4.5"/><path d="M12 17c0 2.5-2 4.5-4.5 4.5S3 19.5 3 17s2-4.5 4.5-4.5"/></svg>`,
  SPARKLE: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 3l1.91 5.82L21 12l-7.09 3.18L12 21l-1.91-5.82L3 12l7.09-3.18L12 3z"/></svg>`,
  RAINDROP: `<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.5c-5 7-7 11-7 14.5 0 3.86 3.14 7 7 7s7-3.14 7-7c0-3.5-2-7.5-7-14.5z"/></svg>`,
  CHEVRON: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>`,
  COPY: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`,
  EDIT: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`,
  TRASH: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 6h18m-2 0v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6m3 0V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>`,
};

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
  let ff = layer.fontFamily || "'SourceHanSansHWSC', 'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', sans-serif";
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

function estimateTextWidth(text, layer) {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  const ff = layer.fontFamily || "sans-serif";
  ctx.font = `${layer.isBold ? 'bold ' : ''}${layer.fontSize}px ${ff}`;
  const metrics = ctx.measureText(text);
  // Total width approx = measured width + (charCount * letterSpacing)
  return metrics.width + ([...text].length * (Number(layer.letterSpacing) || 0));
}

function computeRenderedTextForPath(layer, pathEl) {
  const raw = layer.text ?? "";
  if (!raw || !pathEl) return raw;

  const len = pathEl.getTotalLength?.() ?? 0;
  if (len <= 0) return raw;

  // Original V1.0 Loop Mode
  if (!layer.loop) return raw;

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

  if (layer.showTextJitter) {
    if (!layer.textRandomCache || layer.textRandomCache.length < chars.length || layer.needsTextJitterUpdate) {
      updateTextJitterCache(layer);
      layer.needsTextJitterUpdate = false;
    }
  }

  while (offset <= totalLen) {
    const ch = chars[charIndex % chars.length];
    if (!ch) break;

    const pt = pathEl.getPointAtLength(offset);
    const charEl = document.createElementNS("http://www.w3.org/2000/svg", "text");
    applyStyleToTextNode(charEl, layer);

    let x = pt.x;
    let y = pt.y;
    let charFontSize = fontSize;
    let transformRotation = 0;

    if (layer.showTextJitter && layer.textDNA) {
      const dna = layer.textDNA[charIndex % layer.textDNA.length];
      const sizeMultiplier = (layer.jitterSize ?? 50) / 125;
      const frequencyMultiplier = (layer.jitterFrequency ?? 50) / 50;
      const scatterMultiplier = (layer.jitterScatter ?? 25) / 50;

      const scale = 1.0 + dna.scaleNoise * sizeMultiplier;
      charFontSize *= scale;
      charEl.setAttribute("font-size", `${charFontSize}px`);

      x += dna.xNoise * (fontSize * 0.5) * frequencyMultiplier;
      y += dna.yNoise * (fontSize * 0.5) * frequencyMultiplier;

      transformRotation = dna.xNoise * 30 * scatterMultiplier;
    }

    charEl.setAttribute("x", x);
    charEl.setAttribute("y", y);
    charEl.setAttribute("text-anchor", "middle");
    charEl.setAttribute("dominant-baseline", "central");
    if (transformRotation !== 0) {
      charEl.setAttribute("transform", `rotate(${transformRotation}, ${x}, ${y})`);
    }
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

/**
 * V2.0 Horizontal Stamp Mode: place the entire string unit at intervals
 * without any rotation, creating a stacked "stamp" effect.
 */
function createStampFillText(overlay, layer, pathEl) {
  const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
  group.setAttribute("pointer-events", "none");

  const totalLen = pathEl.getTotalLength();
  const textContent = layer.text || "";
  if (!textContent || totalLen <= 0) { overlay.appendChild(group); return group; }

  // 1. Extreme Brush Algorithm (文字笔刷模式)
  // Measure full sentence width as visual reference
  const unitWidth = estimateTextWidth(textContent, { ...layer, letterSpacing: 0 });

  // 2. High-Density Step Calculation
  // We decouple Step from "readability". 
  // Default step (S=0) is only 5% of the width, creating a 95% overlap.
  const sliderS = Number(layer.letterSpacing) || 0;
  const rawStep = (unitWidth * 0.05) + (sliderS * 0.8);

  // 3. Performance Safety Barrier
  // Force a minimum of 5px to prevent browser hang while maintaining "ink" density
  const Step = Math.max(5, rawStep);

  // 4. Center Anchoring Stamp Loop
  let stepIndex = 0;
  for (let d = 0; d < totalLen; d += Step) {
    const pt = pathEl.getPointAtLength(d);
    const unitEl = document.createElementNS("http://www.w3.org/2000/svg", "text");

    // Internal char spacing is locked to 0 for sentence integrity
    applyStyleToTextNode(unitEl, { ...layer, letterSpacing: 0 });

    let finalX = pt.x;
    let finalY = pt.y;
    let finalRotation = 0;
    let baseFontSize = layer.fontSize || 20;
    let finalFontSize = baseFontSize;

    // Apply Jitter if enabled
    if (layer.showTextJitter && layer.textDNA) {
      const dna = layer.textDNA[stepIndex % layer.textDNA.length];
      const sizeMultiplier = (layer.jitterSize ?? 50) / 125;
      const frequencyMultiplier = (layer.jitterFrequency ?? 50) / 50;
      const scatterMultiplier = (layer.jitterScatter ?? 25) / 50;

      const scale = 1.0 + dna.scaleNoise * sizeMultiplier;
      finalFontSize = baseFontSize * scale;

      const offset = dna.yNoise * (baseFontSize * 0.5) * frequencyMultiplier;
      finalY += offset;

      finalRotation = dna.xNoise * 30 * scatterMultiplier;
      stepIndex++;
    }

    unitEl.setAttribute("x", finalX);
    unitEl.setAttribute("y", finalY);
    unitEl.setAttribute("font-size", `${finalFontSize}px`);
    if (finalRotation !== 0) {
      unitEl.setAttribute("transform", `rotate(${finalRotation}, ${finalX}, ${finalY})`);
    }
    unitEl.setAttribute("text-anchor", "middle");
    unitEl.setAttribute("dominant-baseline", "central");
    unitEl.textContent = textContent;
    group.appendChild(unitEl);
  }

  overlay.appendChild(group);
  return group;
}

function createShapeElement(shape, x, y, r, color) {
  let el;
  if (shape === "circle") {
    el = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    el.setAttribute("cx", x);
    el.setAttribute("cy", y);
    el.setAttribute("r", r);
  } else if (shape === "square") {
    el = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    el.setAttribute("x", x - r);
    el.setAttribute("y", y - r);
    el.setAttribute("width", r * 2);
    el.setAttribute("height", r * 2);
  } else if (shape === "star") {
    el = document.createElementNS("http://www.w3.org/2000/svg", "path");
    const points = [];
    const numPoints = 5;
    for (let i = 0; i < numPoints * 2; i++) {
      const angle = (i * Math.PI) / numPoints - Math.PI / 2;
      const radius = i % 2 === 0 ? r : r * 0.4;
      points.push(`${x + radius * Math.cos(angle)},${y + radius * Math.sin(angle)}`);
    }
    el.setAttribute("d", `M ${points.join(" L ")} Z`);
  } else if (shape === "raindrop") {
    el = document.createElementNS("http://www.w3.org/2000/svg", "path");
    const d = `M ${x},${y - r * 1.5} C ${x + r},${y} ${x + r},${y + r} ${x},${y + r} S ${x - r},${y} ${x},${y - r * 1.5} Z`;
    el.setAttribute("d", d);
  }
  el.setAttribute("fill", color);
  return el;
}

function createStarPath(cx, cy, r1, r2, points) {
  let d = "";
  for (let i = 0; i < points * 2; i++) {
    const angle = (i * Math.PI) / points - Math.PI / 2;
    const r = i % 2 === 0 ? r1 : r2;
    const x = cx + r * Math.cos(angle);
    const y = cy + r * Math.sin(angle);
    d += (i === 0 ? "M" : "L") + `${x} ${y}`;
  }
  d += "Z";
  const el = document.createElementNS("http://www.w3.org/2000/svg", "path");
  el.setAttribute("d", d);
  return el;
}


function generateLayerDNA(layer, pathEl) {
  const text = layer.text || "";
  const textDNA = [];
  for (let i = 0; i < 500; i++) { // Generate more than enough
    textDNA.push({
      scaleNoise: (Math.random() - 0.5) * 2,
      xNoise: (Math.random() - 0.5) * 2,
      yNoise: (Math.random() - 0.5) * 2,
      triggerRatio: Math.random() * 100
    });
  }
  layer.textDNA = textDNA;

  const decorDNA = [];
  for (let i = 0; i < 300; i++) {
    decorDNA.push({
      t: Math.random(), // Random position along path
      xNoise: (Math.random() - 0.5) * 2,
      yNoise: (Math.random() - 0.5) * 2,
      triggerRatio: Math.random() * 100
    });
  }
  // Sort decorDNA by t for consistency if needed, but random is fine
  layer.decorDNA = decorDNA;
}

function createDecorationGroup(overlay, layer, pathEl) {
  const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
  if (!layer.showDecorations || !layer.decorDNA) {
    overlay.appendChild(group);
    return group;
  }

  const totalLen = pathEl.getTotalLength();
  const density = layer.decorationDensity ?? 20;
  const scatter = layer.decorationScatter ?? 10;
  const baseRadius = layer.decorationRadius ?? 8;

  layer.decorDNA.forEach(dna => {
    if (dna.triggerRatio > density) return;

    const pos = pathEl.getPointAtLength(dna.t * totalLen);
    const x = pos.x + dna.xNoise * scatter;
    const y = pos.y + dna.yNoise * scatter;

    let shape;
    if (layer.decorationShape === 'star') {
      shape = createStarPath(x, y, baseRadius, baseRadius / 2, 5);
    } else if (layer.decorationShape === 'square') {
      shape = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      shape.setAttribute("x", x - baseRadius);
      shape.setAttribute("y", y - baseRadius);
      shape.setAttribute("width", baseRadius * 2);
      shape.setAttribute("height", baseRadius * 2);
    } else if (layer.decorationShape === 'raindrop') {
      shape = document.createElementNS("http://www.w3.org/2000/svg", "path");
      shape.setAttribute("d", `M${x} ${y - baseRadius * 1.2} C${x - baseRadius} ${y} ${x - baseRadius} ${y + baseRadius} ${x} ${y + baseRadius} C${x + baseRadius} ${y + baseRadius} ${x + baseRadius} ${y} ${x} ${y - baseRadius * 1.2} Z`);
    } else {
      shape = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      shape.setAttribute("cx", x);
      shape.setAttribute("cy", y);
      shape.setAttribute("r", baseRadius);
    }

    shape.setAttribute("fill", layer.decorationColor || "#F472B6");
    group.appendChild(shape);
  });

  overlay.appendChild(group);
  return group;
}

function createPathBoundText(overlay, layer, pathEl) {
  // V2.0 "Horizontal Stamp Mode" (fillPath)
  if (layer.fillPath) {
    return createStampFillText(overlay, layer, pathEl);
  }

  // Vertical mode: use per-character positioning to keep glyphs upright
  if (layer.isVertical) {
    return createVerticalPathText(overlay, layer, pathEl);
  }

  const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
  applyStyleToTextNode(text, layer);
  text.setAttribute("pointer-events", "none");

  const textPath = document.createElementNS("http://www.w3.org/2000/svg", "textPath");
  textPath.setAttribute("href", `#${layer.pathElementId}`);

  const rawText = computeRenderedTextForPath(layer, pathEl);
  const baseFontSize = layer.fontSize || 20;

  if (layer.showTextJitter && layer.textDNA) {
    const sizeMultiplier = (layer.jitterSize ?? 50) / 125;
    const frequencyMultiplier = (layer.jitterFrequency ?? 50) / 50;
    const scatterMultiplier = (layer.jitterScatter ?? 25) / 50;

    for (let i = 0; i < rawText.length; i++) {
      const char = rawText[i];
      const dna = layer.textDNA[i % layer.textDNA.length];
      const tspan = document.createElementNS("http://www.w3.org/2000/svg", "tspan");
      tspan.textContent = char;

      const scale = 1.0 + dna.scaleNoise * sizeMultiplier;
      tspan.setAttribute("font-size", `${baseFontSize * scale}px`);

      const baselineOffset = dna.yNoise * (baseFontSize * 0.5) * frequencyMultiplier;
      if (baselineOffset !== 0) {
        tspan.setAttribute("baseline-shift", `${baselineOffset}px`);
      }

      const rotation = dna.xNoise * 30 * scatterMultiplier;
      if (rotation !== 0) {
        tspan.setAttribute("rotate", `${rotation}`);
      }

      textPath.appendChild(tspan);
    }
  } else {
    const tspan = document.createElementNS("http://www.w3.org/2000/svg", "tspan");
    tspan.textContent = rawText;
    textPath.appendChild(tspan);
  }

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
  // Use UTF-8 URI encoding which is safer and has no size limits unlike btoa
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(raw);
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
  return function (...args) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

/** Keeps the thick slider's active-fill gradient in sync with its value. */
function updateSliderFill(input) {
  const min = Number(input.min) || 0;
  const max = Number(input.max) || 100;
  const val = Number(input.value) || 0;
  const pct = Math.max(0, Math.min(100, ((val - min) / (max - min)) * 100));
  input.style.setProperty('--fill-pct', `${pct}%`);
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

async function exportCompositeImage(image, overlay, layers, isBaseImageVisible = true) {
  if (!image.src || !image.naturalWidth || !image.naturalHeight) {
    alert("图片尚未加载完成，请稍后再试");
    return;
  }

  // Create or show loading indicator
  let loadingEl = document.getElementById('export-loading-toast');
  if (!loadingEl) {
    loadingEl = document.createElement('div');
    loadingEl.id = 'export-loading-toast';
    loadingEl.style.cssText = `
      position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
      background: rgba(0,0,0,0.8); color: white; padding: 16px 24px;
      border-radius: 12px; z-index: 9999; font-size: 15px;
      display: flex; align-items: center; gap: 10px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.3);
    `;
    loadingEl.innerHTML = `<div class="loading-spinner"></div><span>图片生成中，请稍候...</span>`;
    document.body.appendChild(loadingEl);
  }
  loadingEl.style.display = 'flex';

  const exportBtn = document.querySelector('[data-action="export-right"]');
  if (exportBtn) exportBtn.style.opacity = '0.5', exportBtn.style.pointerEvents = 'none';

  try {
    // Wait for fonts properly to ensure quality
    await document.fonts.ready;

    const displayWidth = overlay.clientWidth;
    const displayHeight = overlay.clientHeight;
    if (!displayWidth || !displayHeight) {
      alert("画布尺寸异常，无法导出");
      return;
    }

    setHelperPathsVisibility(overlay, false);

    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("无法创建Canvas上下文");

    if (isBaseImageVisible) {
      ctx.drawImage(image, 0, 0, image.naturalWidth, image.naturalHeight);
    } else {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }

    const scaleX = image.naturalWidth / displayWidth;
    const scaleY = image.naturalHeight / displayHeight;

    // V6.8: Physical Base64 Font Injection
    const usedFontFamilies = new Set(layers.map(l => {
      const ff = l.fontFamily || "'SourceHanSansHWSC', 'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', sans-serif";
      // Extract the first font name
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
        // Skip cross-origin
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
        const previewUrl = URL.createObjectURL(blob);
        showLongPressPreviewModal(previewUrl);
        return;
      }
    }

    if (isMobile) {
      const previewUrl = URL.createObjectURL(blob);
      showLongPressPreviewModal(previewUrl);
    } else {
      downloadBlobAsPng(blob, fileName);
    }
  } catch (error) {
    console.error("Export Critical Error:", error);
    alert("导出失败: " + (error.message || "未知错误"));
  } finally {
    if (loadingEl) loadingEl.style.display = 'none';
    if (exportBtn) exportBtn.style.opacity = '1', exportBtn.style.pointerEvents = 'auto';
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
    if (hasImage && !isBaseImageVisible) {
      image.style.opacity = '0';
      frame.classList.add('stage-checkerboard');
    } else {
      image.style.opacity = '1';
      frame.classList.remove('stage-checkerboard');
    }
  };

  if (emptyStateTrigger) {
    emptyStateTrigger.addEventListener("click", () => input.click());
  }


  let layers = [];
  let isBaseImageVisible = true;
  let activeLayerId = null;
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

  const createLayerRecord = (props) => ({
    id: createRandomPathId(),
    type: props.type || 'path',
    text: props.text ?? "",
    fontFamily: props.fontFamily || "'SourceHanSansHWSC', 'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', sans-serif",
    fontSize: props.fontSize || 20,
    color: props.color || "#000000",
    letterSpacing: props.letterSpacing ?? 0,
    isBold: props.isBold ?? false,
    strokeColor: props.strokeColor || "#ffffff",
    strokeWidth: props.strokeWidth || 0,
    hasStroke: props.hasStroke ?? false,
    isVertical: props.isVertical ?? false,
    fillPath: props.fillPath ?? false,
    pathMode: props.pathMode || 'freehand',
    showDecorations: props.showDecorations ?? false,
    decorationShape: props.decorationShape || 'circle',
    decorationColor: props.decorationColor || '#F472B6',
    decorationRadius: props.decorationRadius ?? 8,
    decorationDensity: props.decorationDensity ?? 20,
    decorationScatter: props.decorationScatter ?? 10,
    decorationLayering: props.decorationLayering || 'below',
    showTextJitter: props.showTextJitter ?? false,
    jitterSize: props.jitterSize ?? 50,
    jitterFrequency: props.jitterFrequency ?? 50,
    jitterScatter: props.jitterScatter ?? 25,
    textDNA: null,
    decorDNA: null,
    isDecorExpanded: props.isDecorExpanded ?? false,
    scale: props.scale ?? 1,
    rotation: props.rotation ?? 0,
    d: props.d || "",
    freehandD: props.d || "",
    x: props.x ?? null,
    y: props.y ?? null,
    pathElementId: props.pathElementId || createRandomPathId(),
    textElement: null,
    pathElement: null,
    status: "completed",
    loop: true,
    isHidden: false,
    isDraft: false
  });


  const updateSelectionStyles = () => {
    layers.forEach((layer) => {
      const isActive = layer.id === activeLayerId;
      const isExpanded = layer.id === activeLayerId;
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
      d = `M ${cx - r},${cy} A ${r},${r} 0 1,1 ${cx + r},${cy} A ${r},${r} 0 1,1 ${cx - r},${cy}`;
    } else if (mode === "rectangle") {
      d = `M ${cx - r},${cy - r} L ${cx + r},${cy - r} L ${cx + r},${cy + r} L ${cx - r},${cy + r} Z`;
    } else if (mode === "star") {
      for (let i = 0; i < 5; i++) {
        const a1 = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
        const a2 = -Math.PI / 2 + ((i + 0.5) * 2 * Math.PI) / 5;
        const p1x = cx + r * Math.cos(a1);
        const p1y = cy + r * Math.sin(a1);
        const p2x = cx + r * 0.4 * Math.cos(a2);
        const p2y = cy + r * 0.4 * Math.sin(a2);
        if (i === 0) d += `M ${p1x},${p1y} `;
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
      if (layer.isHidden) return;
      const showLayerGuides = layer.id === activeLayerId;

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
          } catch (e) { }
        }


        // Text (visual, no pointer events)

        // V3.2: DNA Lifecycle Management
        if (!layer.textDNA || !layer.decorDNA) {
          generateLayerDNA(layer, path);
        }

        if (layer.showDecorations && layer.decorationLayering === "below") {
          createDecorationGroup(innerGroup, layer, path);
        }

        const text = createPathBoundText(innerGroup, layer, path);
        layer.textElement = text;

        if (layer.showDecorations && layer.decorationLayering === "above") {
          createDecorationGroup(innerGroup, layer, path);
        }

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
              rotIcon.setAttribute("d", `M ${rx - 3} ${ry - 1} A 3.5 3.5 0 1 1 ${rx + 3} ${ry + 1} M ${rx + 1} ${ry - 4} L ${rx + 4.5} ${ry - 1} L ${rx + 1} ${ry + 1.5}`);
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
        } catch (e) { }

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
        const text = createStampText(group, layer, () => { });
        layer.textElement = text;
      }
    });
    if (activeLayerId) {
      const expandedLayer = layers.find((layer) => layer.id === activeLayerId);
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
        ...layer,
        textElement: undefined,
        pathElement: undefined,
        groupElement: undefined,
        hitboxElement: undefined,
        handleElement: undefined,
        gizmoElement: undefined,
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
    if (!layers.some((layer) => layer.id === activeLayerId)) {
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
              <button class="icon-button" data-action="toggle-base-image" title="${isBaseImageVisible ? '隐藏底图' : '显示底图'}" style="flex-shrink: 0;">
                ${isBaseImageVisible
        ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>'
        : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>'}
              </button>
              <button class="minor-button" data-action="pick-image" type="button" style="flex-shrink: 0;">重新上传</button>
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
              <div class="card-inner">
                <input class="layer-input" data-role="layer-name-input" data-layer-id="${layer.id}" placeholder="输入图层文本后回车" value="${layer.text}" />
              </div>
            </article>
          `;
        }
        const expanded = activeLayerId === layer.id;
        const isPending = layer.status === "pending";

        return `
          <article class="layer-card${isPending ? " is-pending" : ""}${activeLayerId === layer.id ? " active" : ""}" data-layer-id="${layer.id}" draggable="false">
              <div class="layer-head" data-action="expand-layer" data-layer-id="${layer.id}">
                <div style="display: flex; align-items: center; gap: 12px; flex: 1; min-width: 0;">
                  <span class="drag-handle" data-role="drag-handle">::</span>
                  <div class="layer-title" title="${layer.text || "未命名图层"}">${layer.text || "未命名"}</div>
                </div>
                
                <div style="display: flex; gap: 8px; align-items: center;" onclick="event.stopPropagation()">
                  <button class="icon-button" data-action="copy-layer" data-layer-id="${layer.id}" title="复制图层">${ICONS.COPY}</button>
                  <button class="icon-button" data-action="delete-layer" data-layer-id="${layer.id}" title="删除">${ICONS.TRASH}</button>
                  <button class="icon-button chevron-icon ${expanded ? 'is-expanded' : ''}" data-action="expand-layer" data-layer-id="${layer.id}">${ICONS.CHEVRON}</button>
                </div>
              </div>
            ${expanded
            ? `
              <div class="layer-props" onclick="event.stopPropagation()">
                ${isPending
              ? `
                    <div class="ui-card" style="margin-bottom: 0; border: none; padding: 0;">
                      <p style="font-size: 12px; color: var(--text-secondary); margin-bottom: 12px;">请绘制轨迹或选择几何图形：</p>
                      <div class="quick-shape-matrix">
                        <button class="quick-shape-btn ${!layer.pathMode || layer.pathMode === 'freehand' ? 'active' : ''}" data-action="quick-shape" data-shape="freehand" data-layer-id="${layer.id}">
                          <span class="shape-icon">${ICONS.PENCIL}</span>
                          <span>手绘</span>
                        </button>
                        <button class="quick-shape-btn" data-action="quick-shape" data-shape="circle" data-layer-id="${layer.id}">
                          <span class="shape-icon">${ICONS.DOT}</span>
                          <span>圆形</span>
                        </button>
                        <button class="quick-shape-btn" data-action="quick-shape" data-shape="rectangle" data-layer-id="${layer.id}">
                          <span class="shape-icon">${ICONS.SQUARE}</span>
                          <span>矩形</span>
                        </button>
                        <button class="quick-shape-btn" data-action="quick-shape" data-shape="star" data-layer-id="${layer.id}">
                          <span class="shape-icon">${ICONS.STAR}</span>
                          <span>五角星</span>
                        </button>
                        <button class="quick-shape-btn" data-action="quick-shape" data-shape="flower" data-layer-id="${layer.id}">
                          <span class="shape-icon">${ICONS.FLOWER}</span>
                          <span>花型</span>
                        </button>
                      </div>
                    </div>
                    `
              : `
                  <!-- Card 1: Basic Typography -->
                  <div class="ui-card">
                    <div class="control-row">
                      <div class="control-label">路径类型</div>
                      <div class="control-content" style="gap:16px;">
                        <button class="segment-btn ${!layer.pathMode || layer.pathMode === 'freehand' ? 'active' : ''}" data-prop="pathMode" data-val="freehand" data-layer-id="${layer.id}" style="background:transparent;border:none;cursor:pointer;color:var(--p2-dark);opacity:${!layer.pathMode || layer.pathMode === 'freehand' ? '1' : '0.3'};padding:2px;display:flex;">${ICONS.PENCIL}</button>
                        <button class="segment-btn ${layer.pathMode === 'rectangle' ? 'active' : ''}" data-prop="pathMode" data-val="rectangle" data-layer-id="${layer.id}" style="background:transparent;border:none;cursor:pointer;color:var(--p2-dark);opacity:${layer.pathMode === 'rectangle' ? '1' : '0.3'};padding:2px;display:flex;">${ICONS.SQUARE}</button>
                        <button class="segment-btn ${layer.pathMode === 'circle' ? 'active' : ''}" data-prop="pathMode" data-val="circle" data-layer-id="${layer.id}" style="background:transparent;border:none;cursor:pointer;color:var(--p2-dark);opacity:${layer.pathMode === 'circle' ? '1' : '0.3'};padding:2px;display:flex;">${ICONS.DOT}</button>
                        <button class="segment-btn ${layer.pathMode === 'star' ? 'active' : ''}" data-prop="pathMode" data-val="star" data-layer-id="${layer.id}" style="background:transparent;border:none;cursor:pointer;color:var(--p2-dark);opacity:${layer.pathMode === 'star' ? '1' : '0.3'};padding:2px;display:flex;">${ICONS.STAR}</button>
                        <button class="segment-btn ${layer.pathMode === 'flower' ? 'active' : ''}" data-prop="pathMode" data-val="flower" data-layer-id="${layer.id}" style="background:transparent;border:none;cursor:pointer;color:var(--p2-dark);opacity:${layer.pathMode === 'flower' ? '1' : '0.3'};padding:2px;display:flex;">${ICONS.FLOWER}</button>
                      </div>
                    </div>
                    <div class="control-row" style="align-items:flex-start;padding-top:4px;min-height:unset;">
                      <div class="control-label" style="padding-top:12px;">文字内容</div>
                      <div class="control-content">
                        <div class="muted-textarea-wrapper">
                          <textarea data-prop="text" data-layer-id="${layer.id}" class="muted-textarea" rows="2">${layer.text}</textarea>
                          <div class="textarea-icon">${ICONS.EDIT}</div>
                        </div>
                      </div>
                    </div>
                    <div class="control-row">
                      <div class="control-label">排版属性</div>
                      <div class="control-content" style="gap:14px;">
                        <label class="check-label"><input data-prop="loop" data-layer-id="${layer.id}" type="checkbox" ${layer.loop ? 'checked' : ''} ${layer.fillPath ? 'disabled' : ''} />循环</label>
                        <label class="check-label"><input data-prop="isVertical" data-layer-id="${layer.id}" type="checkbox" ${layer.isVertical ? 'checked' : ''} ${layer.fillPath ? 'disabled' : ''} />竖排</label>
                        <label class="check-label"><input data-prop="fillPath" data-layer-id="${layer.id}" type="checkbox" ${layer.fillPath ? 'checked' : ''} />平铺</label>
                      </div>
                    </div>
                    <div class="control-row">
                      <div class="control-label">字体</div>
                      <div class="control-content">
                        <div class="muted-wrapper">
                          <select data-prop="fontFamily" data-layer-id="${layer.id}">
                            <optgroup label="中文">
                              <option value="'SourceHanSansHWSC', sans-serif" ${String(layer.fontFamily).includes('SourceHanSansHWSC') ? 'selected' : ''}>思源黑体</option>
                              <option value="'SourceHanSerif', serif" ${String(layer.fontFamily).includes('SourceHanSerif') ? 'selected' : ''}>思源宋体</option>
                              <option value="'SmileySans', sans-serif" ${String(layer.fontFamily).includes('SmileySans') ? 'selected' : ''}>得意黑</option>
                              <option value="'LXGWWenKaiMono', serif" ${String(layer.fontFamily).includes('LXGWWenKaiMono') ? 'selected' : ''}>霞鹜文楷</option>
                            </optgroup>
                            <optgroup label="韩文">
                              <option value="'NanumMyeongjo', serif" ${String(layer.fontFamily).includes('NanumMyeongjo') ? 'selected' : ''}>Nanum 明朝</option>
                              <option value="'NanumPenScript', cursive" ${String(layer.fontFamily).includes('NanumPenScript') ? 'selected' : ''}>Nanum 手写</option>
                            </optgroup>
                            <optgroup label="英文/艺术">
                              <option value="'PlayfairDisplay', serif" ${String(layer.fontFamily).includes('PlayfairDisplay') ? 'selected' : ''}>Playfair</option>
                              <option value="'Caveat', cursive" ${String(layer.fontFamily).includes('Caveat') ? 'selected' : ''}>Caveat</option>
                              <option value="'DelaGothicOne', sans-serif" ${String(layer.fontFamily).includes('DelaGothicOne') ? 'selected' : ''}>Dela Gothic</option>
                            </optgroup>
                          </select>
                        </div>
                      </div>
                    </div>
                    <div class="control-row">
                      <div class="control-label">字号</div>
                      <div class="control-content">
                        <input data-prop="fontSize" data-layer-id="${layer.id}" type="range" min="10" max="120" value="${layer.fontSize}" />
                        <span class="value-display">${layer.fontSize}</span>
                      </div>
                    </div>
                    <div class="control-row">
                      <div class="control-label">字距</div>
                      <div class="control-content">
                        <input data-prop="letterSpacing" data-layer-id="${layer.id}" type="range" min="0" max="40" value="${layer.letterSpacing ?? 0}" />
                        <span class="value-display">${layer.letterSpacing ?? 0}</span>
                      </div>
                    </div>
                    <div class="control-row">
                      <div class="control-label">文字颜色</div>
                      <div class="control-content" style="justify-content:space-between;">
                        <input data-prop="color" data-layer-id="${layer.id}" type="color" value="${layer.color}" class="color-swatch" />
                        <label class="check-label"><input data-prop="isBold" data-layer-id="${layer.id}" type="checkbox" ${layer.isBold ? 'checked' : ''} />加粗</label>
                      </div>
                    </div>
                  </div>

                  <!-- Card 2: Stroke -->
                  <div class="ref-card">
                    <div class="ref-card-header">
                      <input data-prop="hasStroke" data-layer-id="${layer.id}" type="checkbox" ${layer.hasStroke ? 'checked' : ''} />
                      <span class="ref-card-title">描边</span>
                      <span style="font-size:11px;color:#aaa;white-space:nowrap;">描边颜色</span>
                      <input data-prop="strokeColor" data-layer-id="${layer.id}" type="color" value="${layer.strokeColor}" class="color-swatch" />
                    </div>
                    ${layer.hasStroke ? `<div class="ref-card-body">
                      <div class="control-row">
                        <div class="control-label">描边宽度</div>
                        <div class="control-content">
                          <input data-prop="strokeWidth" data-layer-id="${layer.id}" type="range" min="0" max="15" value="${layer.strokeWidth}" />
                          <span class="value-display">${layer.strokeWidth}</span>
                        </div>
                      </div>
                    </div>` : ''}
                  </div>

                  <!-- Card 3: Decorations -->
                  <div class="ref-card">
                    <div class="ref-card-header">
                      <input data-prop="showDecorations" data-layer-id="${layer.id}" type="checkbox" ${layer.showDecorations ? 'checked' : ''} />
                      <span class="ref-card-title">添加波点</span>
                    </div>
                    ${layer.showDecorations ? `<div class="ref-card-body">
                      <div class="control-row" style="min-height:unset;padding:8px 0;">
                        <div class="control-label">形状</div>
                        <div class="control-content">
                          <div class="shape-picker">
                            <button class="shape-pick-btn ${layer.decorationShape === 'circle' ? 'active' : ''}" data-prop="decorationShape" data-val="circle" data-layer-id="${layer.id}">${ICONS.DOT}</button>
                            <button class="shape-pick-btn ${layer.decorationShape === 'star' ? 'active' : ''}" data-prop="decorationShape" data-val="star" data-layer-id="${layer.id}">${ICONS.STAR}</button>
                            <button class="shape-pick-btn ${layer.decorationShape === 'raindrop' ? 'active' : ''}" data-prop="decorationShape" data-val="raindrop" data-layer-id="${layer.id}">${ICONS.RAINDROP}</button>
                            <button class="shape-pick-btn ${layer.decorationShape === 'square' ? 'active' : ''}" data-prop="decorationShape" data-val="square" data-layer-id="${layer.id}">${ICONS.SQUARE}</button>
                          </div>
                        </div>
                      </div>
                      <div class="control-row">
                        <div class="control-label">颜色</div>
                        <div class="control-content">
                          <input data-prop="decorationColor" data-layer-id="${layer.id}" type="color" value="${layer.decorationColor || '#F472B6'}" class="color-swatch" />
                        </div>
                      </div>
                      <div class="control-row">
                        <div class="control-label">大小</div>
                        <div class="control-content">
                          <input data-prop="decorationRadius" data-layer-id="${layer.id}" type="range" min="3" max="40" value="${layer.decorationRadius}" />
                          <span class="value-display">${layer.decorationRadius}</span>
                        </div>
                      </div>
                      <div class="control-row">
                        <div class="control-label">数量</div>
                        <div class="control-content">
                          <input data-prop="decorationDensity" data-layer-id="${layer.id}" type="range" min="1" max="100" value="${layer.decorationDensity ?? 20}" />
                          <span class="value-display">${layer.decorationDensity ?? 20}</span>
                        </div>
                      </div>
                      <div class="control-row">
                        <div class="control-label">分散</div>
                        <div class="control-content">
                          <input data-prop="decorationScatter" data-layer-id="${layer.id}" type="range" min="0" max="50" value="${layer.decorationScatter ?? 10}" />
                          <span class="value-display">${layer.decorationScatter ?? 10}</span>
                        </div>
                      </div>
                      <div class="control-row" style="margin-bottom:4px;">
                        <div class="control-label">层级</div>
                        <div class="control-content">
                          <div class="layer-pick layer-pick--seg">
                            <button class="layer-pick-btn ${(!layer.decorationLayering || layer.decorationLayering === 'below') ? 'active' : ''}" data-prop="decorationLayering" data-val="below" data-layer-id="${layer.id}">文字下方</button>
                            <button class="layer-pick-btn ${layer.decorationLayering === 'above' ? 'active' : ''}" data-prop="decorationLayering" data-val="above" data-layer-id="${layer.id}">文字上方</button>
                          </div>
                        </div>
                      </div>
                    </div>` : ''}
                  </div>

                  <!-- Card 4: Text Jitter -->
                  <div class="ref-card">
                    <div class="ref-card-header">
                      <input data-prop="showTextJitter" data-layer-id="${layer.id}" type="checkbox" ${layer.showTextJitter ? 'checked' : ''} />
                      <span class="ref-card-title">随机性</span>
                    </div>
                    ${layer.showTextJitter ? `<div class="ref-card-body">
                      <div class="control-row">
                        <div class="control-label">文字大小</div>
                        <div class="control-content">
                          <input data-prop="jitterSize" data-layer-id="${layer.id}" type="range" min="0" max="100" value="${layer.jitterSize ?? 50}" />
                          <span class="value-display">${layer.jitterSize ?? 50}</span>
                        </div>
                      </div>
                      <div class="control-row">
                        <div class="control-label">文字起伏</div>
                        <div class="control-content">
                          <input data-prop="jitterFrequency" data-layer-id="${layer.id}" type="range" min="0" max="100" value="${layer.jitterFrequency ?? 50}" />
                          <span class="value-display">${layer.jitterFrequency ?? 50}</span>
                        </div>
                      </div>
                      <div class="control-row" style="margin-bottom:4px;">
                        <div class="control-label">文字偏转</div>
                        <div class="control-content">
                          <input data-prop="jitterScatter" data-layer-id="${layer.id}" type="range" min="0" max="50" value="${layer.jitterScatter ?? 25}" />
                          <span class="value-display">${layer.jitterScatter ?? 25}</span>
                        </div>
                      </div>
                    </div>` : ''}
                  </div>
                `
            }
              </div>
            `
            : ''
          }
              </div>
            </article>
        `;
      })
      .join("");

    leftPanelRoot.innerHTML = `
      ${uploadStateHtml}
      ${image.src ? `
      <section class="panel-section">
        <div class="layer-stack">${layerCardsHtml}</div>
      </section>
      <!-- 底部固定动作区 -->
      <div class="panel-actions">
        <button class="add-layer-button" data-action="add-layer" type="button">添加新文字路径</button>
        <button class="export-button" data-action="export" type="button">导出图片</button>
      </div>
      ` : ''}
    `;

    // Handlers
    leftPanelRoot.querySelector('[data-action="pick-image"]')?.addEventListener("click", () => input.click());

    leftPanelRoot.querySelector('.add-layer-button')?.addEventListener("click", () => {
      const layer = createLayerRecord({
        type: "path",
        text: "",
        fontFamily: "'SourceHanSansHWSC', 'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', sans-serif",
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
      renderCanvasFromLayers();
      renderLeftPanel();
      const inputNode = leftPanelRoot.querySelector(`[data-role="layer-name-input"][data-layer-id="${layer.id}"]`);
      inputNode?.focus();
    });

    leftPanelRoot.querySelector('[data-action="export"]')?.addEventListener("click", async () => {
      await exportCompositeImage(image, overlay, layers, isBaseImageVisible);
    });

    leftPanelRoot.querySelector('[data-action="toggle-base-image"]')?.addEventListener("click", () => {
      isBaseImageVisible = !isBaseImageVisible;
      updateCanvasUI();
      renderLeftPanel(); // Update eye icon state
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
        renderCanvasFromLayers();
        renderLeftPanel();
        saveState();
      };
      nameInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter") finalize();
      });
      nameInput.addEventListener("blur", finalize);
    });

    leftPanelRoot.querySelectorAll('[data-action="expand-layer"]').forEach((button) => {
      button.addEventListener("click", () => {
        const id = button.getAttribute("data-layer-id");
        if (activeLayerId !== id) {
          activeLayerId = id;
        } else {
          activeLayerId = null;
        }
        renderCanvasFromLayers();
        renderLeftPanel();
        if (activeLayerId) {
          scrollActiveLayerCardIntoView();
          updateSelectionStyles();
        }
      });
    });

    leftPanelRoot.querySelectorAll('[data-action="delete-layer"]').forEach((button) => {
      button.addEventListener("click", (e) => {
        e.stopPropagation();
        const id = button.getAttribute("data-layer-id");
        layers = layers.filter((layer) => layer.id !== id);
        if (activeLayerId === id) activeLayerId = layers[0]?.id ?? null;
        renderCanvasFromLayers();
        renderLeftPanel();
        saveState();
      });
    });

    leftPanelRoot.querySelectorAll('[data-action="copy-layer"]').forEach((button) => {
      button.addEventListener("click", (e) => {
        e.stopPropagation();
        const id = button.getAttribute("data-layer-id");
        const originLayer = layers.find(l => l.id === id);
        if (originLayer) {
          const cloned = cloneLayers([originLayer])[0];
          cloned.id = createRandomPathId();
          if (cloned.pathElementId) cloned.pathElementId = createRandomPathId();
          if (cloned.type === "path") cloned.d = originLayer.d;
          const index = layers.findIndex(l => l.id === id);
          layers.splice(index + 1, 0, cloned);
          activeLayerId = cloned.id;
          renderCanvasFromLayers();
          renderLeftPanel();
          saveState();
        }
      });
    });

    leftPanelRoot.querySelectorAll('[data-action="quick-shape"]').forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const id = btn.getAttribute("data-layer-id");
        const val = btn.getAttribute("data-shape");

        updateLayerAndRender(id, (layer) => {
          const oldMode = layer.pathMode || "freehand";
          if (oldMode === "freehand" && val !== "freehand") {
            layer.freehandD = layer.d;
          }
          layer.pathMode = val;
          if (val !== "freehand") {
            layer.d = generateStaticPath(val);
            layer.status = "completed";
          } else {
            layer.d = layer.freehandD || "";
            layer.status = layer.d ? "completed" : "pending";
          }
        });
      });
    });

    leftPanelRoot.querySelectorAll('.segment-btn').forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const id = btn.getAttribute("data-layer-id");
        const prop = btn.getAttribute("data-prop");
        const val = btn.getAttribute("data-val");

        updateLayerAndRender(id, (layer) => {
          if (prop === "pathMode") {
            const oldMode = layer.pathMode;
            if (oldMode === "freehand" && val !== "freehand") {
              layer.freehandD = layer.d;
            }
            layer.pathMode = val;
            if (val !== "freehand") {
              layer.d = generateStaticPath(val);
              layer.status = "completed";
            } else {
              layer.d = layer.freehandD || "";
              layer.status = layer.d ? "completed" : "pending";
            }
          } else if (prop === "decorationShape") {
            layer.decorationShape = val;
          } else if (prop === "decorationLayering") {
            layer.decorationLayering = val;
          }
        }, true);
        saveState();
      });
    });

    // shape-pick-btn: decorationShape selector
    leftPanelRoot.querySelectorAll('.shape-pick-btn').forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const id = btn.getAttribute("data-layer-id");
        const val = btn.getAttribute("data-val");
        updateLayerAndRender(id, (layer) => { layer.decorationShape = val; }, true);
        saveState();
      });
    });

    // layer-pick-btn: decorationLayering selector
    leftPanelRoot.querySelectorAll('.layer-pick-btn').forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const id = btn.getAttribute("data-layer-id");
        const val = btn.getAttribute("data-val");
        updateLayerAndRender(id, (layer) => { layer.decorationLayering = val; }, true);
        saveState();
      });
    });


    leftPanelRoot.querySelectorAll("[data-action='toggle-decor']").forEach((header) => {
      header.addEventListener("click", (e) => {
        e.stopPropagation();
        const id = header.getAttribute("data-layer-id");
        updateLayerAndRender(id, (layer) => {
          layer.isDecorExpanded = !layer.isDecorExpanded;
        }, true);
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
          if (prop === "fillPath") {
            layer.fillPath = control.checked;
            if (layer.fillPath) {
              layer.letterSpacing = 25;
            }
          }
          if (prop === "showDecorations") {
            layer.showDecorations = control.checked;
            if (layer.showDecorations) layer.needsDecorUpdate = true;
          }
          if (prop === "decorationColor") layer.decorationColor = control.value;
          if (prop === "decorationRadius") layer.decorationRadius = Number(control.value) || 0;
          if (prop === "decorationDensity") {
            layer.decorationDensity = Number(control.value) || 1;
            layer.needsDecorUpdate = true;
          }
          if (prop === "decorationScatter") {
            layer.decorationScatter = Number(control.value) || 0;
            layer.needsDecorUpdate = true;
          }
          if (prop === "showDecorations") layer.showDecorations = control.checked;
          if (prop === "showTextJitter") layer.showTextJitter = control.checked;
          if (prop === "jitterSize") layer.jitterSize = Number(control.value) || 0;
          if (prop === "jitterFrequency") layer.jitterFrequency = Number(control.value) || 0;
          if (prop === "jitterScatter") layer.jitterScatter = Number(control.value) || 0;
          if (prop === "decorationDensity") layer.decorationDensity = Number(control.value) || 1;
          if (prop === "decorationScatter") layer.decorationScatter = Number(control.value) || 0;
          if (prop === "text") {
            layer.text = control.value ?? "";
            layer.textDNA = null; // Mark for regeneration
          }
        }, rerenderPanel);
      };

      const debouncedApply = debounce(() => apply(false), 200);

      control.addEventListener("change", () => {
        if (prop === "loop" || prop === "isVertical" || prop === "fillPath" || prop === "showDecorations") {
          apply(true);
        }
      });

      control.addEventListener("input", () => {
        if (prop === "loop" || prop === "isVertical" || prop === "fillPath") return;

        // Live update value-display span next to range inputs
        if (control.type === "range") {
          updateSliderFill(control);
          const display = control.nextElementSibling;
          if (display && (display.classList.contains('value-display') || display.classList.contains('numeric-feedback'))) {
            display.textContent = control.value;
          }
        }

        if (prop === "color" || prop === "strokeColor" || prop === "decorationColor") {
          debouncedApply();
        } else {
          apply(false);
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
    // Initialise all slider fill gradients after panel render
    leftPanelRoot.querySelectorAll('input[type="range"]').forEach(updateSliderFill);
  };

  // 动态控件绑定已移入 renderLeftPanel

  // 右侧画板固定按钮绑定
  document.querySelector('[data-action="export-right"]')?.addEventListener("click", async () => {
    await exportCompositeImage(image, overlay, layers, isBaseImageVisible);
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
    const fontFamily = source?.fontFamily ?? "'SourceHanSansHWSC', 'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', sans-serif";
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
