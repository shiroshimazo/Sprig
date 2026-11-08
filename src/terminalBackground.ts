import type { IBufferCell, ITheme } from "@xterm/xterm";

const ansiColors = [
  ["black", "#2e3436"], ["red", "#cc0000"], ["green", "#4e9a06"], ["yellow", "#c4a000"],
  ["blue", "#3465a4"], ["magenta", "#75507b"], ["cyan", "#06989a"], ["white", "#d3d7cf"],
  ["brightBlack", "#555753"], ["brightRed", "#ef2929"], ["brightGreen", "#8ae234"], ["brightYellow", "#fce94f"],
  ["brightBlue", "#729fcf"], ["brightMagenta", "#ad7fa8"], ["brightCyan", "#34e2e2"], ["brightWhite", "#eeeeec"],
] as const;

function cellBackground(cell: IBufferCell, theme: ITheme): string {
  const inverse = cell.isInverse();
  const color = inverse ? cell.getFgColor() : cell.getBgColor();
  if (inverse ? cell.isFgRGB() : cell.isBgRGB()) return `#${color.toString(16).padStart(6, "0")}`;
  if (inverse ? cell.isFgPalette() : cell.isBgPalette()) {
    if (color < 16) return theme[ansiColors[color][0]] ?? ansiColors[color][1];
    if (theme.extendedAnsi?.[color - 16]) return theme.extendedAnsi[color - 16];
    if (color >= 232) {
      const shade = 8 + (color - 232) * 10;
      return `rgb(${shade}, ${shade}, ${shade})`;
    }
    const levels = [0, 95, 135, 175, 215, 255];
    const index = color - 16;
    return `rgb(${levels[Math.floor(index / 36)]}, ${levels[Math.floor(index / 6) % 6]}, ${levels[index % 6]})`;
  }
  return inverse ? (theme.foreground ?? "#e5e5e5") : (theme.background ?? "#090909");
}

export function terminalBackground(cells: (IBufferCell | undefined)[], theme: ITheme = {}): string {
  const counts = new Map<string, number>();
  let background = theme.background ?? "#090909";
  for (const cell of cells) {
    if (!cell) continue;
    const color = cellBackground(cell, theme);
    const count = (counts.get(color) ?? 0) + 1;
    counts.set(color, count);
    if (count > (counts.get(background) ?? 0)) background = color;
  }
  return background;
}
