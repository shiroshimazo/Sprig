// Adapted from TUFFUI (https://tuffui.com), MIT License.
// Copyright (c) 2026 TUFFUI contributors. See LICENSE.
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import type { CSSProperties } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { AlertCircleIcon, CheckmarkCircle02Icon, MultiplicationSignIcon } from "@hugeicons/core-free-icons";
import "./toast-stack.css";

type Toast = {
  id: number;
  tone: "success" | "error";
  title: string;
  description?: string;
  dismissing?: boolean;
};

const VISIBLE = 3;
const GAP = 8;
const PEEK = 10;
const listeners = new Set<() => void>();
let items: Toast[] = [];
let nextId = 0;

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function publish(next: Toast[]) {
  items = next;
  listeners.forEach((listener) => listener());
}

function notify(tone: Toast["tone"], title: string, description?: string) {
  publish([{ id: ++nextId, tone, title, description }, ...items]);
}

function dismiss(id: number) {
  if (!items.some((item) => item.id === id && !item.dismissing)) return;
  publish(items.map((item) => item.id === id ? { ...item, dismissing: true } : item));
  setTimeout(() => publish(items.filter((item) => item.id !== id)), 200);
}

export const toast = {
  success: (title: string, description?: string) => notify("success", title, description),
  error: (title: string, description?: string) => notify("error", title, description),
};

export function Toaster() {
  const snapshot = useSyncExternalStore(subscribe, () => items);
  const visible = snapshot.slice(0, VISIBLE);
  const newest = snapshot[0]?.id === nextId ? snapshot[0] : undefined;
  const list = useRef<HTMLOListElement>(null);
  const [heights, setHeights] = useState<number[]>([]);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(() => document.hidden);
  const expanded = hovered || focused;

  useEffect(() => {
    const update = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);

  useLayoutEffect(() => {
    const cards = Array.from(list.current?.querySelectorAll<HTMLElement>(".toast-card") ?? []);
    const measure = () => setHeights(cards.map((card) => card.offsetHeight));
    measure();
    const observer = new ResizeObserver(measure);
    cards.forEach((card) => observer.observe(card));
    return () => observer.disconnect();
  }, [snapshot]);

  const height = expanded
    ? heights.reduce((total, cardHeight) => total + cardHeight, 0) + GAP * Math.max(visible.length - 1, 0)
    : (heights[0] ?? 0) + PEEK * Math.max(visible.length - 1, 0);

  return (
    <section className="toast-stack" aria-label="Notifications">
      <ol
        ref={list}
        className="toast-list"
        style={{ height }}
        onPointerEnter={(event) => { if (event.pointerType !== "touch") setHovered(true); }}
        onPointerLeave={() => setHovered(false)}
        onFocus={() => setFocused(true)}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
        }}
      >
        {visible.map((item, index) => (
          <ToastItem
            key={item.id}
            item={item}
            index={index}
            expanded={expanded}
            paused={expanded || hidden}
            offset={heights.slice(0, index).reduce((total, cardHeight) => total + cardHeight + GAP, 0)}
          />
        ))}
      </ol>
      <p className="toast-announcement" role="status" aria-live="polite" aria-atomic="true">
        {newest && <span key={newest.id}>{[newest.title, newest.description].filter(Boolean).join(". ")}</span>}
      </p>
    </section>
  );
}

function ToastItem({ item, index, expanded, paused, offset }: {
  item: Toast;
  index: number;
  expanded: boolean;
  paused: boolean;
  offset: number;
}) {
  const [drag, setDrag] = useState<{ y: number; start: number; at: number } | null>(null);
  const dragging = drag !== null;
  const remaining = useRef(item.tone === "error" ? 6000 : 4000);
  const behind = index > 0 && !expanded;

  useEffect(() => {
    if (paused || dragging || item.dismissing) return;
    const start = performance.now();
    const timer = setTimeout(() => dismiss(item.id), remaining.current);
    return () => {
      clearTimeout(timer);
      remaining.current -= performance.now() - start;
    };
  }, [paused, dragging, item.dismissing, item.id]);

  const style = {
    zIndex: VISIBLE - index,
    "--toast-offset": `${expanded ? -offset : -index * PEEK}px`,
    "--toast-scale": expanded ? 1 : 1 - index * 0.05,
    "--toast-drag": `${drag ? (drag.y < 0 ? drag.y * 0.15 : drag.y) : 0}px`,
  } as CSSProperties;

  return (
    <li
      className="toast-item"
      data-behind={behind}
      data-dismissing={item.dismissing}
      data-dragging={dragging}
      style={style}
      inert={behind || item.dismissing}
      onPointerDown={(event) => {
        if (!event.isPrimary || event.button !== 0 || (event.target as Element).closest("button")) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        setDrag({ y: 0, start: event.clientY, at: performance.now() });
      }}
      onPointerMove={(event) => {
        if (!drag || !event.isPrimary) return;
        setDrag({ ...drag, y: event.clientY - drag.start });
      }}
      onPointerUp={(event) => {
        if (!drag || !event.isPrimary) return;
        const velocity = drag.y / Math.max(performance.now() - drag.at, 1);
        setDrag(null);
        if (drag.y > 45 || velocity > 0.11) dismiss(item.id);
      }}
      onLostPointerCapture={() => setDrag(null)}
    >
      <div className="toast-card" data-tone={item.tone}>
        <HugeiconsIcon
          className="toast-icon"
          icon={item.tone === "success" ? CheckmarkCircle02Icon : AlertCircleIcon}
          size={16}
          aria-hidden="true"
        />
        <div className="toast-text">
          <p className="toast-title">{item.title}</p>
          {item.description && <p className="toast-description">{item.description}</p>}
        </div>
        <button
          className="toast-close"
          type="button"
          aria-label={`Dismiss ${item.title}`}
          onClick={() => dismiss(item.id)}
        >
          <HugeiconsIcon icon={MultiplicationSignIcon} size={14} aria-hidden="true" />
        </button>
      </div>
    </li>
  );
}
