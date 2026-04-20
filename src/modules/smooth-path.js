export function buildSmoothPath(points) {
  if (!points || points.length === 0) return "";
  if (points.length === 1) return `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
  if (points.length === 2) return `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)} L ${points[1].x.toFixed(2)} ${points[1].y.toFixed(2)}`;

  // 使用二次贝塞尔曲线 (quadraticCurveTo 逻辑)
  // 起始点
  let d = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
  
  // 按照 "两点之间的中点作为端点，原始点作为控制点" 的逻辑进行平滑
  for (let i = 1; i < points.length - 1; i++) {
    const cp = points[i];
    const next = points[i + 1];
    const mx = (cp.x + next.x) / 2;
    const my = (cp.y + next.y) / 2;
    d += ` Q ${cp.x.toFixed(2)} ${cp.y.toFixed(2)}, ${mx.toFixed(2)} ${my.toFixed(2)}`;
  }

  // 最后一个点直接连接
  const last = points[points.length - 1];
  d += ` L ${last.x.toFixed(2)} ${last.y.toFixed(2)}`;

  return d;
}

