import assert from "node:assert/strict";
import test from "node:test";

import { createWecomWebhookBotDeliverer } from "../src/wecom/outbound-webhook-delivery.js";

function createDeliverer(overrides = {}) {
  const textCalls = [];
  const mediaCalls = [];
  const deliver = createWecomWebhookBotDeliverer({
    attachWecomProxyDispatcher: (_url, options) => options,
    resolveWebhookBotSendUrl: ({ url }) => url || "",
    webhookSendText: async (payload) => {
      textCalls.push(payload);
    },
    sendWebhookBotMediaBatch: async (payload) => {
      mediaCalls.push(payload);
      return { sentCount: 0, failedCount: 0, failedUrls: [], reason: "ok" };
    },
    ...overrides,
  });
  return { deliver, textCalls, mediaCalls };
}

test("deliverWebhookBotReply returns disabled when webhook bot is off", async () => {
  const { deliver } = createDeliverer();
  const result = await deliver({
    webhookBotPolicy: { enabled: false },
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "webhook-bot-disabled");
});

test("deliverWebhookBotReply returns url-missing when send url is absent", async () => {
  const { deliver } = createDeliverer({
    resolveWebhookBotSendUrl: () => "",
  });
  const result = await deliver({
    webhookBotPolicy: { enabled: true, url: "", key: "", timeoutMs: 8000 },
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "webhook-bot-url-missing");
});

test("deliverWebhookBotReply sends text when no media", async () => {
  const { deliver, textCalls, mediaCalls } = createDeliverer();
  const result = await deliver({
    api: { logger: { warn() {} } },
    webhookBotPolicy: {
      enabled: true,
      url: "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=test",
      key: "",
      timeoutMs: 8000,
    },
    content: "hello",
    fallbackText: "fallback",
    normalizedText: "hello",
    normalizedMediaUrls: [],
  });
  assert.equal(result.ok, true);
  assert.equal(textCalls.length, 1);
  assert.equal(mediaCalls.length, 0);
});

test("deliverWebhookBotReply sends media and warning text for failed media", async () => {
  const { deliver, textCalls, mediaCalls } = createDeliverer({
    sendWebhookBotMediaBatch: async (payload) => {
      mediaCalls.push(payload);
      return {
        sentCount: 1,
        failedCount: 1,
        failedUrls: ["https://example.com/a.png"],
      };
    },
  });
  const result = await deliver({
    api: { logger: { warn() {} } },
    webhookBotPolicy: {
      enabled: true,
      url: "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=test",
      key: "",
      timeoutMs: 8000,
    },
    content: "hello",
    fallbackText: "fallback",
    normalizedText: "hello",
    normalizedMediaUrls: ["https://example.com/a.png"],
    mediaType: "image",
  });
  assert.equal(result.ok, true);
  assert.equal(result.meta.mediaSent, 1);
  assert.equal(result.meta.mediaFailed, 1);
  assert.equal(mediaCalls.length, 1);
  assert.equal(textCalls.length, 2);
  assert.match(textCalls[1].content, /以下媒体回传失败/);
});
