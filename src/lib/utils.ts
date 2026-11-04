export type ClassValue = string | false | null | undefined;

/** Tiny class-name joiner (no Tailwind required). */
export function cn(...inputs: ClassValue[]) {
  return inputs.filter(Boolean).join(" ");
}
