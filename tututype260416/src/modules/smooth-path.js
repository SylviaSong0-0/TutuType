export function buildSmoothPath(points, smoothing = 0.2) {
  if (!points || points.length === 0) return "";
  if (points.length === 1) return `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
  if (points.length === 2) return `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)} L ${points[1].x.toFixed(2)} ${points[1].y.toFixed(2)}`;

  // 计算控制点：通过相邻点差值计算当前点的切线向
  const controlPoint = (current, previous, next, reverse) => {
    const p = previous || current;
    const n = next || current;

    const lengthX = n.x - p.x;
    const lengthY = n.y - p.y;

    // 反向控制点需要增加 PI 的角度
    const angle = Math.atan2(lengthY, lengthX) + (reverse ? Math.PI : 0);
    // smoothing 控制张力
    const length = Math.hypot(lengthX, lengthY) * smoothing;

    const x = current.x + Math.cos(angle) * length;
    const y = current.y + Math.sin(angle) * length;

    return { x, y };
  };

  // 生成从上一节点到当前节点的 C 指令片段
  const bezierCommand = (point, i, a) => {
    // start control point (关联上一个点)
    const cp1 = controlPoint(a[i - 1], a[i - 2], point, false);
    // end control point (关联当前点，需要反向切线)
    const cp2 = controlPoint(point, a[i - 1], a[i + 1], true);
    
    return `C ${cp1.x.toFixed(2)},${cp1.y.toFixed(2)} ${cp2.x.toFixed(2)},${cp2.y.toFixed(2)} ${point.x.toFixed(2)},${point.y.toFixed(2)}`;
  };

  let d = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
  for (let i = 1; i < points.length; i++) {
    d += ` ${bezierCommand(points[i], i, points)}`;
  }
  return d;
}
