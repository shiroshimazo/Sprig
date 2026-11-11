import type { Terminal } from "@xterm/xterm";

type Suggestion = { label: string; kind: string };

export function createTerminalSuggestions(terminal: Terminal, element: HTMLElement, send: (data: string) => void) {
  const popup = document.createElement("div");
  popup.className = "terminal-suggestions";
  popup.id = `terminal-suggestions-${crypto.randomUUID()}`;
  popup.setAttribute("role", "listbox");
  popup.setAttribute("aria-label", "Terminal suggestions");
  popup.hidden = true;
  document.body.append(popup);
  terminal.textarea?.setAttribute("aria-autocomplete", "list");
  let shellReady = false;
  let pending = 0;
  let requested = false;
  let selected = 0;
  let items: Suggestion[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;

  const hide = () => {
    popup.hidden = true;
    terminal.textarea?.setAttribute("aria-expanded", "false");
    terminal.textarea?.removeAttribute("aria-activedescendant");
  };
  const dismiss = () => { requested = false; clearTimeout(timer); hide(); };
  const setShellReady = (ready: boolean) => {
    shellReady = ready;
    pending = 0;
    dismiss();
  };
  const position = () => {
    if (popup.hidden) return;
    const screen = element.querySelector(".xterm-screen")?.getBoundingClientRect();
    const row = terminal.buffer.active.baseY + terminal.buffer.active.cursorY - terminal.buffer.active.viewportY;
    if (!screen?.width || !element.clientHeight || row < 0 || row >= terminal.rows) { hide(); return; }
    const lineHeight = screen.height / terminal.rows;
    const cursorTop = screen.top + row * lineHeight;
    const below = cursorTop + lineHeight + 3;
    popup.style.left = `${Math.max(8, Math.min(screen.left + terminal.buffer.active.cursorX * screen.width / terminal.cols, innerWidth - popup.offsetWidth - 8))}px`;
    popup.style.top = `${Math.max(8, below + popup.offsetHeight < innerHeight - 8 ? below : cursorTop - popup.offsetHeight - 3)}px`;
  };
  const highlight = (index: number) => {
    selected = (index + items.length) % items.length;
    [...popup.children].forEach((option, i) => option.setAttribute("aria-selected", String(i === selected)));
    terminal.textarea?.setAttribute("aria-activedescendant", `${popup.id}-${selected}`);
  };
  const accept = (index: number) => {
    if (!shellReady || terminal.options.disableStdin || popup.hidden) return;
    dismiss();
    send(index === 0 ? "\x1b[23~" : `\x1b[23;${index + 1}~`);
    terminal.focus();
  };
  const receive = (data: string) => {
    if (data === "sprig;shell=ready") { setShellReady(true); return true; }
    if (data === "sprig;shell=busy") { setShellReady(false); return true; }
    const prefix = "sprig;suggestions=";
    if (!data.startsWith(prefix)) return false;
    pending = Math.max(0, pending - 1);
    if (!shellReady || !requested || pending || terminal.options.disableStdin || terminal.textarea !== document.activeElement) return true;
    let payload: unknown;
    try { payload = JSON.parse(data.slice(prefix.length)); } catch { hide(); return true; }
    const candidates = (payload as { items?: unknown } | null)?.items;
    if (!Array.isArray(candidates) || candidates.length > 8 || !candidates.every((item) =>
      item && typeof item.label === "string" && ["command", "history", "path", "argument"].includes(item.kind))) { hide(); return true; }
    items = candidates;
    popup.replaceChildren();
    if (!items.length) { hide(); return true; }
    items.forEach((item, index) => {
      const option = document.createElement("button");
      option.type = "button";
      option.id = `${popup.id}-${index}`;
      option.tabIndex = -1;
      option.setAttribute("role", "option");
      option.title = item.label;
      const label = document.createElement("span");
      label.textContent = item.label;
      const kind = document.createElement("small");
      kind.textContent = item.kind;
      option.append(label, kind);
      option.addEventListener("pointerdown", (event) => { event.preventDefault(); accept(index); });
      option.addEventListener("pointermove", () => highlight(index));
      popup.append(option);
    });
    popup.hidden = false;
    terminal.textarea?.setAttribute("aria-controls", popup.id);
    terminal.textarea?.setAttribute("aria-expanded", "true");
    highlight(0);
    position();
    return true;
  };
  const input = (data: string) => {
    if (/^\x1b\[\??[\d;]*[Rctn]$/.test(data) || /^\x1b\](?:4|10|11);/.test(data)) { send(data); return; }
    hide();
    requested = false;
    clearTimeout(timer);
    if (/[\r\n\x03]/.test(data)) { shellReady = false; pending = 0; }
    send(data);
    const editing = /^[^\x00-\x1f\x7f]+$/.test(data) || data === "\x7f" || data === "\b" ||
      /^\x1b\[(?:[CDFH]|[13]~|[12];5[CD])$/.test(data) || data.startsWith("\x1b[200~");
    if (shellReady && editing) timer = setTimeout(() => {
      if (!terminal.options.disableStdin && element.clientWidth && element.clientHeight) {
        pending++;
        requested = true;
        send("\x1b[24~");
      }
    }, 120);
  };
  const key = (event: KeyboardEvent) => {
    if (popup.hidden || event.type !== "keydown" || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey || event.isComposing) return true;
    if (!["ArrowDown", "ArrowUp", "Tab", "Escape"].includes(event.key)) return true;
    event.preventDefault();
    if (event.key === "ArrowDown") highlight(selected + 1);
    else if (event.key === "ArrowUp") highlight(selected - 1);
    else if (event.key === "Tab") accept(selected);
    else dismiss();
    return false;
  };
  const render = terminal.onRender(position);
  // The popup is anchored to the cursor, so it has to follow the terminal when the
  // window changes size.
  window.addEventListener("resize", position);
  const outside = (event: PointerEvent) => { if (!popup.contains(event.target as Node)) dismiss(); };
  document.addEventListener("pointerdown", outside);
  terminal.textarea?.addEventListener("blur", dismiss);
  return { input, key, receive, setShellReady, get shellReady() { return shellReady; }, dispose: () => {
    clearTimeout(timer);
    render.dispose();
    window.removeEventListener("resize", position);
    document.removeEventListener("pointerdown", outside);
    terminal.textarea?.removeEventListener("blur", dismiss);
    for (const attribute of ["aria-autocomplete", "aria-controls", "aria-expanded", "aria-activedescendant"]) terminal.textarea?.removeAttribute(attribute);
    popup.remove();
  } };
}
