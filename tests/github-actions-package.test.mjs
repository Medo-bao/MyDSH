import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflow = await readFile(
  new URL("../.github/workflows/package.yml", import.meta.url),
  "utf8",
);

test("GitHub Actions packages only Windows x64", () => {
  assert.match(workflow, /runs-on: windows-2025/u);
  assert.match(workflow, /architecture: x64/u);
  assert.match(workflow, /process\.platform !== 'win32'/u);
  assert.match(workflow, /process\.arch !== 'x64'/u);
  assert.match(workflow, /pnpm package/u);
  assert.match(workflow, /pnpm nsis:make/u);
  assert.match(workflow, /pnpm nsis:make --publish never/u);
  assert.doesNotMatch(workflow, /macos-|ubuntu-24\.04[\s\S]*pnpm make|AppImage|\.dmg|\.deb|\.rpm/iu);
});

test("Windows x64 workflow uses frozen root and Harness lockfiles", () => {
  assert.match(workflow, /pnpm install --frozen-lockfile/u);
  assert.match(
    workflow,
    /pnpm --dir vendor\/deepseek-harness install --recursive --frozen-lockfile/u,
  );
  assert.match(workflow, /pnpm-lock\.yaml/u);
  assert.match(workflow, /vendor\/deepseek-harness\/pnpm-lock\.yaml/u);
});

test("tag releases publish one stable Windows x64 installer with checksums", () => {
  assert.match(workflow, /MyDSH-windows-x64-Setup\.exe/u);
  assert.match(workflow, /SHA256SUMS/u);
  assert.match(workflow, /gh release (?:upload|create)/u);
  assert.match(workflow, /contents: write/u);
});

test("workflow action references are pinned to commits", () => {
  const actionUses = [...workflow.matchAll(/^\s*uses:\s*([^\s#]+)/gmu)].map(
    (match) => match[1],
  );
  assert.ok(actionUses.length >= 4);
  for (const reference of actionUses) {
    assert.match(reference, /@[a-f0-9]{40}$/u);
  }
});
