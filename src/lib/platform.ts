declare const process: { platform?: string } | undefined;

export function isWindows(): boolean {
  if (typeof process !== "undefined" && process.platform) return process.platform === "win32";
  return typeof navigator !== "undefined"
    && (/^win/i.test(navigator.platform) || /\bWindows\b/i.test(navigator.userAgent));
}
