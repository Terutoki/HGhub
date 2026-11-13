#!/usr/bin/env node
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const root = process.argv[2] ? resolve(process.argv[2]) : join(here, "..");
// Tauri CLI 2.10.1 templates/mobile/ios/Assets.xcassets/AppIcon.appiconset/Contents.json.
const contents = readFileSync(join(here, "fixtures", "ios-appicon-contents.json"));
const manifest = JSON.parse(contents);
const temp = mkdtempSync(join(tmpdir(), "hghubx-ios-icons-"));

try {
  const script = join(root, "scripts", "sync-ios-icons.mjs");
  assert(existsSync(script), "iOS icon sync missing; generated projects keep Tauri template icons");
  const config = JSON.parse(readFileSync(join(root, "src-tauri", "tauri.conf.json"), "utf8"));
  assert(config.build.beforeBuildCommand.includes("node scripts/sync-ios-icons.mjs"), "Normal Tauri builds must sync iOS icons");
  const build = readFileSync(join(root, "scripts", "build-ios-unsigned.sh"), "utf8");
  const syncIndex = build.indexOf("node scripts/sync-ios-icons.mjs --required");
  assert(syncIndex >= 0 && syncIndex < build.indexOf("pnpm tauri ios build"), "Unsigned builds must sync before starting Tauri/Xcode");
  console.log("PASS: standard and unsigned build hooks");

  mkdirSync(join(temp, "scripts"), { recursive: true });
  cpSync(script, join(temp, "scripts", "sync-ios-icons.mjs"));
  const invoke = (...args) => spawnSync(process.execPath, [join(temp, "scripts", "sync-ios-icons.mjs"), ...args], { encoding: "utf8" });
  const expectFailure = (pattern, ...args) => {
    const result = invoke(...args);
    assert.equal(result.status, 1);
    assert.match(result.stderr, pattern);
  };
  const skipped = invoke();
  assert.equal(skipped.status, 0);
  assert.match(skipped.stdout, /skipped/);
  expectFailure(/Apple project missing/, "--required");
  console.log("PASS: desktop skip and required Apple project");

  const apple = join(temp, "src-tauri", "gen", "apple");
  const catalog = join(apple, "Assets.xcassets", "AppIcon.appiconset");
  mkdirSync(catalog, { recursive: true });
  expectFailure(/Contents.json/);
  writeFileSync(join(catalog, "Contents.json"), contents);
  const source = join(temp, "src-tauri", "icons", "ios");
  cpSync(join(root, "src-tauri", "icons", "ios"), source, { recursive: true });
  const seed = () => {
    for (const { filename } of manifest.images) writeFileSync(join(catalog, filename), "template icon");
  };
  const assertSeeded = () => {
    for (const { filename } of manifest.images) assert.equal(readFileSync(join(catalog, filename), "utf8"), "template icon");
  };
  seed();
  const last = manifest.images.at(-1).filename;
  const artwork = readFileSync(join(source, last));
  rmSync(join(source, last));
  expectFailure(new RegExp(last.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assertSeeded();
  writeFileSync(join(source, last), artwork);
  const wrongSize = Buffer.from(artwork);
  wrongSize.writeUInt32BE(1, 16);
  writeFileSync(join(source, last), wrongSize);
  expectFailure(/Wrong dimensions/);
  assertSeeded();
  writeFileSync(join(source, last), artwork);
  console.log("PASS: missing manifest, missing artwork and wrong dimensions fail before copying");

  for (const bad of [{ images: [] }, { images: [{ filename: "../outside.png", size: "20x20", scale: "1x" }] }]) {
    writeFileSync(join(catalog, "Contents.json"), JSON.stringify(bad));
    expectFailure(/no image slots|no valid PNG filename/);
    assertSeeded();
  }
  writeFileSync(join(catalog, "Contents.json"), contents);
  console.log("PASS: malformed icon catalog is rejected");

  for (let pass = 0; pass < 2; pass++) {
    const result = invoke("--required");
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /synced and verified: 18 slots/);
    for (const { filename } of manifest.images) {
      assert.deepEqual(readFileSync(join(catalog, filename)), readFileSync(join(source, filename)), filename);
    }
    assert.deepEqual(readFileSync(join(catalog, "Contents.json")), contents);
  }
  console.log("PASS: all 18 iPhone/iPad/marketing slots match tracked artwork; manifest preserved; repeat run unchanged");
} catch (error) {
  console.error(`FAIL: ${error.message}`);
  process.exitCode = 1;
} finally {
  rmSync(temp, { recursive: true, force: true });
}
