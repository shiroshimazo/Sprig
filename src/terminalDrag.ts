export function outsideWindow(x: number, y: number, width: number, height: number) {
  return x < 0 || y < 0 || x >= width || y >= height;
}

// How far the pointer must move before a press becomes a drag. Kept under
// the OS double-click tolerance so a normal click never detaches by accident.
export const DRAG_THRESHOLD = 6;

export function beyondDragThreshold(dx: number, dy: number, threshold = DRAG_THRESHOLD) {
  return dx * dx + dy * dy >= threshold * threshold;
}

export type WindowBounds = { x: number; y: number; width: number; height: number };

// Pointer positions while dragging are reported in screen coordinates, so
// convert to window-local coordinates before the bounds check. Works on
// multi-monitor setups where screenX/screenY can go negative.
export function windowLocalPoint(screenX: number, screenY: number, bounds: WindowBounds) {
  return { x: screenX - bounds.x, y: screenY - bounds.y };
}

export function isOutsideWindow(screenX: number, screenY: number, bounds: WindowBounds) {
  const point = windowLocalPoint(screenX, screenY, bounds);
  return outsideWindow(point.x, point.y, bounds.width, bounds.height);
}
