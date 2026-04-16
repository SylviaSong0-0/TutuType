function getPerpendicularDistance(point, lineStart, lineEnd) {
  const dx = lineEnd.x - lineStart.x;
  const dy = lineEnd.y - lineStart.y;

  if (dx === 0 && dy === 0) {
    return Math.hypot(point.x - lineStart.x, point.y - lineStart.y);
  }

  const numerator = Math.abs(
    dy * point.x - dx * point.y + lineEnd.x * lineStart.y - lineEnd.y * lineStart.x,
  );
  const denominator = Math.hypot(dx, dy);
  return numerator / denominator;
}

function simplifySegment(points, startIndex, endIndex, epsilon, kept) {
  if (endIndex <= startIndex + 1) return;

  let maxDistance = -1;
  let index = -1;

  const start = points[startIndex];
  const end = points[endIndex];

  for (let i = startIndex + 1; i < endIndex; i += 1) {
    const distance = getPerpendicularDistance(points[i], start, end);
    if (distance > maxDistance) {
      maxDistance = distance;
      index = i;
    }
  }

  if (maxDistance > epsilon && index !== -1) {
    kept.add(index);
    simplifySegment(points, startIndex, index, epsilon, kept);
    simplifySegment(points, index, endIndex, epsilon, kept);
  }
}

export function simplifyPointsRdp(points, epsilon = 2.5) {
  if (!Array.isArray(points) || points.length <= 2) return points.slice();

  const kept = new Set([0, points.length - 1]);
  simplifySegment(points, 0, points.length - 1, epsilon, kept);

  return Array.from(kept)
    .sort((a, b) => a - b)
    .map((index) => points[index]);
}
