export function handleShiftEnter(event: KeyboardEvent, send: (data: string) => void): boolean {
  if (event.key !== "Enter" || !event.shiftKey || event.ctrlKey || event.altKey || event.metaKey || event.isComposing) return true;
  event.preventDefault();
  if (event.type === "keydown") send("\u001b[13;2u");
  return false;
}
