import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizePath, isInsideFolder } from "../src/filePaths.ts";

test("normalizePath strips the verbatim prefix and matches the plain path", () => {
  assert.equal(normalizePath("\\\\?\\C:\\repo\\src"), normalizePath("C:\\repo\\src"));
});

test("normalizePath rewrites verbatim UNC paths to plain UNC paths", () => {
  assert.equal(normalizePath("\\\\?\\UNC\\server\\share"), "\\\\server\\share");
});

test("normalizePath converts forward slashes to backslashes", () => {
  assert.equal(normalizePath("C:/repo/src"), normalizePath("C:\\repo\\src"));
});

test("normalizePath drops trailing separators but keeps the drive root separator", () => {
  assert.equal(normalizePath("C:\\repo\\src\\"), normalizePath("C:\\repo\\src"));
  const expectedRoot = process.platform === "win32" ? "c:\\" : "C:\\";
  assert.equal(normalizePath("C:\\"), expectedRoot);
  assert.equal(normalizePath("C:/"), expectedRoot);
});

test("normalizePath lowercases only on Windows", { skip: process.platform !== "win32" }, () => {
  assert.equal(normalizePath("C:\\Repo\\SRC"), "c:\\repo\\src");
  assert.equal(normalizePath("c:\\repo\\src"), "c:\\repo\\src");
});

test("normalizePath preserves case off Windows", { skip: process.platform === "win32" }, () => {
  assert.equal(normalizePath("C:\\Repo\\SRC"), "C:\\Repo\\SRC");
});

test("isInsideFolder accepts the folder itself", () => {
  assert.equal(isInsideFolder("C:\\repo\\src", "C:\\repo\\src"), true);
});

test("isInsideFolder accepts nested paths", () => {
  assert.equal(isInsideFolder("C:\\repo\\src", "C:\\repo\\src\\components\\App.tsx"), true);
});

test("isInsideFolder rejects siblings that only share a prefix", () => {
  assert.equal(isInsideFolder("C:\\repo\\src", "C:\\repo\\src2"), false);
});

test("isInsideFolder rejects unrelated paths", () => {
  assert.equal(isInsideFolder("C:\\repo\\src", "C:\\other\\file.ts"), false);
});

test("isInsideFolder ignores case on Windows", { skip: process.platform !== "win32" }, () => {
  assert.equal(isInsideFolder("C:\\Repo\\src", "C:\\repo\\SRC\\file.ts"), true);
});
