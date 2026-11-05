export function smoothScroll(element: HTMLElement, lineHeight: number) {
  const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let frame = 0;
  let top = element.scrollTop;
  let left = element.scrollLeft;
  const cancel = () => {
    cancelAnimationFrame(frame);
    frame = 0;
  };
  const wheel = (event: WheelEvent) => {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || motion.matches) {
      cancel();
      return;
    }
    const scaleY = event.deltaMode === 1 ? lineHeight : event.deltaMode === 2 ? element.clientHeight : 1;
    const scaleX = event.deltaMode === 1 ? lineHeight : event.deltaMode === 2 ? element.clientWidth : 1;
    let dx = event.deltaX * scaleX;
    let dy = event.deltaY * scaleY;
    if (event.shiftKey && !dx) { dx = dy; dy = 0; }
    if (!frame) { top = element.scrollTop; left = element.scrollLeft; }
    if (dy * (top - element.scrollTop) < 0) top = element.scrollTop;
    if (dx * (left - element.scrollLeft) < 0) left = element.scrollLeft;
    top = Math.max(0, Math.min(element.scrollHeight - element.clientHeight, top + dy));
    left = Math.max(0, Math.min(element.scrollWidth - element.clientWidth, left + dx));
    if (top === element.scrollTop && left === element.scrollLeft) { cancel(); return; }
    event.preventDefault();
    cancel();
    const startTop = element.scrollTop;
    const startLeft = element.scrollLeft;
    const start = performance.now();
    const step = (now: number) => {
      const progress = Math.min(1, (now - start) / 120);
      const eased = 1 - (1 - progress) ** 3;
      element.scrollTop = startTop + (top - startTop) * eased;
      element.scrollLeft = startLeft + (left - startLeft) * eased;
      frame = progress < 1 ? requestAnimationFrame(step) : 0;
    };
    frame = requestAnimationFrame(step);
  };
  element.addEventListener("wheel", wheel, { passive: false });
  element.addEventListener("pointerdown", cancel);
  element.addEventListener("keydown", cancel);
  motion.addEventListener("change", cancel);
  return () => {
    cancel();
    element.removeEventListener("wheel", wheel);
    element.removeEventListener("pointerdown", cancel);
    element.removeEventListener("keydown", cancel);
    motion.removeEventListener("change", cancel);
  };
}
