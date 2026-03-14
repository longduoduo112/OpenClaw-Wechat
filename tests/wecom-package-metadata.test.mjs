import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { PLUGIN_VERSION } from "../src/wecom/plugin-constants.js";

test("package.json declares openclaw install metadata", () => {
  const packagePath = path.resolve(process.cwd(), "package.json");
  const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));
  assert.equal(pkg?.openclaw?.install?.defaultChoice, "npm");
  assert.equal(pkg?.openclaw?.install?.npmSpec, "@dingxiang-me/openclaw-wechat");
  assert.equal(pkg?.openclaw?.channel?.quickstartAllowFrom, true);
});

test("package metadata, plugin manifest, and runtime constant stay version-synced", () => {
  const packagePath = path.resolve(process.cwd(), "package.json");
  const manifestPath = path.resolve(process.cwd(), "openclaw.plugin.json");
  const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  assert.equal(pkg.version, "2.1.0");
  assert.equal(manifest.version, pkg.version);
  assert.equal(PLUGIN_VERSION, pkg.version);
  assert.equal(pkg?.openclaw?.channel?.id, "wecom");
  assert.deepEqual(manifest?.channels, ["wecom"]);
});
