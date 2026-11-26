import assert from "node:assert/strict";
import { test } from "node:test";
import { quickOpenMatches } from "../src/quickOpenFiles.ts";

const files = ["app/config.ts", "src/App.test.ts", "src/App.ts", "test/App.ts", "test/my-app.ts"]
  .map((relativePath) => ({ relativePath, path: `/workspace/${relativePath}` }));

test("Quick Open ranks filenames, then paths, without losing duplicate filenames", () => {
  const matches = quickOpenMatches(files, " APP ");
  assert.deepEqual(matches.map(({ relativePath }) => relativePath), [
    "src/App.test.ts", "src/App.ts", "test/App.ts", "test/my-app.ts", "app/config.ts",
  ]);
  assert.equal(matches[2].name, "App.ts");
  assert.equal(matches[2].path, "/workspace/test/App.ts");
  assert.equal(quickOpenMatches(files, "App.ts")[0].relativePath, "src/App.ts");
  assert.equal(quickOpenMatches(files, "src/app.ts").length, 1);
  assert.equal(quickOpenMatches(files, "missing").length, 0);
});

test("Quick Open accepts Windows separators in paths and queries", { skip: process.platform !== "win32" }, () => {
  const file = { path: "C:\\workspace\\src\\App.ts", relativePath: "src\\App.ts" };
  assert.deepEqual(quickOpenMatches([file], "src\\app"), [{ ...file, relativePath: "src/App.ts", name: "App.ts" }]);
});
