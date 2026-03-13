import assert from "node:assert/strict";
import test from "node:test";

import { createWecomPluginServices } from "../src/wecom/plugin-services.js";

test("createWecomPluginServices returns core runtime service bindings", () => {
  const services = createWecomPluginServices();
  assert.equal(typeof services.sendWecomText, "function");
  assert.equal(typeof services.buildInboundContent, "function");
  assert.equal(typeof services.buildBotInboundContent, "function");
  assert.equal(typeof services.deliverBotReplyText, "function");
  assert.equal(typeof services.syncWecomSessionQueuePolicy, "function");
  assert.equal(typeof services.WecomChannelPlugin, "object");
  assert.equal(typeof services.registerWecomDocTools, "function");
  assert.equal(typeof services.clearSessionStoreEntry, "function");
  assert.equal(typeof services.readRequestBody, "function");
  assert.equal(typeof services.buildWecomBotEncryptedResponse, "function");
});
