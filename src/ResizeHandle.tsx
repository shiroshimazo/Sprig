import { useRef } from "react";

type ResizeHandleProps = {
  panel: string;
  label: string;
  orientation: "vertical" | "horizontal";
  value: number;
  onResize: (value: number) => void;
};

export default function ResizeHandle({ panel, label, orientation, value, onResize }: ResizeHandleProps) {
  const drag = useRef<{ pointer: number; start: number; value: number; size: number } | null>(null);
  const vertical = orientation === "vertical";
  const min = 15;
  const max = vertical ? 45 : 60;
  const resize = (next: number) => onResize(Math.min(max, Math.max(min, next)));

  return (
    <div
      className={`resize-handle resize-handle--${orientation}`}
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-controls={panel}
      aria-orientation={orientation}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={Math.round(value)}
      aria-valuetext={`${Math.round(value)} percent`}
      onPointerDown={(event) => {
        if (event.button !== 0 || drag.current) return;
        const bounds = event.currentTarget.parentElement!.getBoundingClientRect();
        event.preventDefault();
        event.currentTarget.focus();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = {
          pointer: event.pointerId,
          start: vertical ? event.clientX : event.clientY,
          value,
          size: vertical ? bounds.width : bounds.height,
        };
      }}
      onPointerMove={(event) => {
        const current = drag.current;
        if (!current || current.pointer !== event.pointerId || current.size === 0) return;
        const delta = (vertical ? event.clientX : event.clientY) - current.start;
        resize(current.value + (delta / current.size) * 100 * (vertical ? 1 : -1));
      }}
      onPointerUp={(event) => {
        if (drag.current?.pointer !== event.pointerId) return;
        drag.current = null;
        event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={() => { drag.current = null; }}
      onLostPointerCapture={() => { drag.current = null; }}
      onKeyDown={(event) => {
        const increase = vertical ? "ArrowRight" : "ArrowUp";
        const decrease = vertical ? "ArrowLeft" : "ArrowDown";
        if (![increase, decrease, "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        if (event.key === "Home") resize(min);
        else if (event.key === "End") resize(max);
        else resize(value + (event.key === increase ? 2 : -2));
      }}
    />
  );
}
