import { fileName } from "./filePaths.ts";

const imageTypes = new Map([
  ["png", "image/png"],
  ["apng", "image/apng"],
  ["jpg", "image/jpeg"],
  ["jpeg", "image/jpeg"],
  ["jpe", "image/jpeg"],
  ["jfif", "image/jpeg"],
  ["gif", "image/gif"],
  ["webp", "image/webp"],
  ["svg", "image/svg+xml"],
  ["bmp", "image/bmp"],
  ["avif", "image/avif"],
  ["ico", "image/x-icon"],
  ["cur", "image/x-icon"],
  ["tif", "image/tiff"],
  ["tiff", "image/tiff"],
  ["heic", "image/heic"],
  ["heif", "image/heif"],
  ["jxl", "image/jxl"],
]);

export function imageMediaType(path: string): string | undefined {
  const name = fileName(path);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? imageTypes.get(name.slice(dot + 1).toLowerCase()) : undefined;
}
