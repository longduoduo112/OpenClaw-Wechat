import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

test("openclaw.plugin.json allows bot-only accounts (no required agent creds)", () => {
  const manifestPath = path.resolve(process.cwd(), "openclaw.plugin.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const accountSchema = manifest?.configSchema?.properties?.accounts?.additionalProperties;
  assert.ok(accountSchema && typeof accountSchema === "object");
  assert.equal(Array.isArray(accountSchema.required), false);
});

test("openclaw.plugin.json exposes wecom doc tool config", () => {
  const manifestPath = path.resolve(process.cwd(), "openclaw.plugin.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  assert.equal(manifest?.configSchema?.properties?.tools?.properties?.doc?.default, true);
  assert.equal(
    manifest?.configSchema?.properties?.tools?.properties?.docAutoGrantRequesterCollaborator?.default,
    true,
  );
  assert.equal(
    manifest?.configSchema?.properties?.accounts?.additionalProperties?.properties?.tools?.properties?.doc?.default,
    true,
  );
  assert.equal(
    manifest?.configSchema?.properties?.accounts?.additionalProperties?.properties?.tools?.properties
      ?.docAutoGrantRequesterCollaborator?.default,
    true,
  );
});

test("openclaw.plugin.json supports dm pairing mode", () => {
  const manifestPath = path.resolve(process.cwd(), "openclaw.plugin.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const topLevelModes = manifest?.configSchema?.properties?.dm?.properties?.mode?.enum ?? [];
  const accountModes =
    manifest?.configSchema?.properties?.accounts?.additionalProperties?.properties?.dm?.properties?.mode?.enum ?? [];
  assert.equal(topLevelModes.includes("pairing"), true);
  assert.equal(accountModes.includes("pairing"), true);
});
