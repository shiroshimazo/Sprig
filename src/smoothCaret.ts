import { animate } from "motion";

// Adapted from Skiper UI's Skiper106: https://skiper-ui.com/v1/skiper106 (gxuri).
type CaretPosition = { left: number; top: number; height: number; color?: string };

export function createSmoothCaret(host: HTMLElement, measure: () => CaretPosition | null, native?: (hidden: boolean) => void) {
  const layer = document.createElement("div");
  layer.className = "smooth-caret-layer";
  layer.setAttribute("aria-hidden", "true");
  const caret = document.createElement("div");
  caret.className = "smooth-caret";
  layer.append(caret);
  document.body.append(layer);
  const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const forcedColors = window.matchMedia("(forced-colors: active)");
  let frame = 0;
  let visible = false;
  let composing = false;
  let disposed = false;
  let previous: CaretPosition | null = null;
  let animation: ReturnType<typeof animate> | undefined;
  const hide = () => {
    layer.hidden = true;
    animation?.stop();
    if (visible) {
      host.classList.remove("smooth-caret-active");
      native?.(false);
    }
    visible = false;
    previous = null;
  };
  const draw = () => {
    frame = 0;
    if (disposed) return;
    if (motion.matches || forcedColors.matches || composing || !document.hasFocus() || !host.contains(document.activeElement)) {
      hide();
      return;
    }
    const position = measure();
    if (!position) { hide(); return; }
    const bounds = host.getBoundingClientRect();
    let { left, top, right, bottom } = bounds;
    for (let parent = host.parentElement; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent);
      const rect = parent.getBoundingClientRect();
      if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) { left = Math.max(left, rect.left); right = Math.min(right, rect.right); }
      if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) { top = Math.max(top, rect.top); bottom = Math.min(bottom, rect.bottom); }
    }
    if (right <= left || bottom <= top || position.left < left || position.left > right || position.top + position.height <= top || position.top >= bottom) {
      hide();
      return;
    }
    Object.assign(layer.style, { left: `${left}px`, top: `${top}px`, width: `${right - left}px`, height: `${bottom - top}px` });
    const next = { ...position, left: position.left - left, top: position.top - top };
    caret.style.height = `${position.height}px`;
    caret.style.background = position.color || getComputedStyle(host).color;
    layer.hidden = false;
    if (!previous || next.left !== previous.left || next.top !== previous.top) {
      animation?.stop();
      animation = animate(caret, { x: next.left, y: next.top }, previous
        ? { type: "spring", stiffness: 500, damping: 30, mass: 0.5 }
        : { duration: 0 });
    }
    previous = next;
    if (!visible) {
      visible = true;
      host.classList.add("smooth-caret-active");
      native?.(true);
    }
  };
  const update = () => { if (!disposed && !frame) frame = requestAnimationFrame(draw); };
  const startComposition = () => { composing = true; hide(); };
  const endComposition = () => { composing = false; update(); };
  const events = ["focusin", "focusout", "input", "keyup", "pointerup", "selectionchange", "scroll"];
  for (const event of events) document.addEventListener(event, update, true);
  host.addEventListener("compositionstart", startComposition);
  host.addEventListener("compositionend", endComposition);
  window.addEventListener("resize", update);
  window.addEventListener("focus", update);
  window.addEventListener("blur", hide);
  motion.addEventListener("change", update);
  forcedColors.addEventListener("change", update);
  document.fonts.addEventListener("loadingdone", update);
  const observer = new ResizeObserver(update);
  observer.observe(host);
  update();
  return { update, dispose: () => {
    disposed = true;
    cancelAnimationFrame(frame);
    hide();
    observer.disconnect();
    for (const event of events) document.removeEventListener(event, update, true);
    host.removeEventListener("compositionstart", startComposition);
    host.removeEventListener("compositionend", endComposition);
    window.removeEventListener("resize", update);
    window.removeEventListener("focus", update);
    window.removeEventListener("blur", hide);
    motion.removeEventListener("change", update);
    forcedColors.removeEventListener("change", update);
    document.fonts.removeEventListener("loadingdone", update);
    layer.remove();
  } };
}

export function installInputCarets() {
  let current: ReturnType<typeof createSmoothCaret> | undefined;
  const mirror = document.createElement("div");
  mirror.setAttribute("aria-hidden", "true");
  const focus = () => {
    current?.dispose();
    current = undefined;
    mirror.remove();
    const field = document.activeElement;
    if (!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) || field.closest(".xterm") || field.selectionStart === null) return;
    document.body.append(mirror);
    current = createSmoothCaret(field, () => {
      if (field.disabled || field.readOnly || field.selectionStart !== field.selectionEnd) return null;
      const style = getComputedStyle(field);
      // Mirror the full text so wrapping, tabs, ligatures and scroll offsets match the native field.
      for (const property of ["box-sizing", "font-family", "font-size", "font-style", "font-weight", "font-variant", "font-feature-settings", "font-variation-settings", "letter-spacing", "line-height", "text-align", "text-indent", "text-transform", "direction", "tab-size", "padding-top", "padding-right", "padding-bottom", "padding-left", "border-top-width", "border-right-width", "border-bottom-width", "border-left-width"]) {
        mirror.style.setProperty(property, style.getPropertyValue(property));
      }
      const multiline = field instanceof HTMLTextAreaElement;
      Object.assign(mirror.style, {
        position: "fixed", left: "0", top: "0", visibility: "hidden", pointerEvents: "none",
        boxSizing: "border-box", borderStyle: "solid", width: `${field.clientWidth + field.clientLeft + parseFloat(style.borderRightWidth)}px`,
        whiteSpace: multiline ? "pre-wrap" : "pre", overflowWrap: "break-word",
      });
      const index = field.selectionStart ?? 0;
      const value = field instanceof HTMLInputElement && field.type === "password" ? "\u2022".repeat(field.value.length) : field.value;
      const marker = document.createElement("span");
      marker.textContent = value.slice(index) || "\u200b";
      mirror.replaceChildren(document.createTextNode(value.slice(0, index)), marker);
      const rect = field.getBoundingClientRect();
      const point = marker.getClientRects()[0];
      if (!point) return null;
      const height = parseFloat(style.fontSize);
      return {
        left: rect.left + point.left - field.scrollLeft,
        top: multiline ? rect.top + point.top - field.scrollTop : rect.top + field.clientTop + (field.clientHeight - height) / 2,
        height, color: style.color,
      };
    });
  };
  document.addEventListener("focusin", focus);
  document.addEventListener("focusout", focus);
  focus();
  return () => {
    document.removeEventListener("focusin", focus);
    document.removeEventListener("focusout", focus);
    current?.dispose();
    mirror.remove();
  };
}
