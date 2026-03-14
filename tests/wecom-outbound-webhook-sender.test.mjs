import assert from "node:assert/strict";
import test from "node:test";

import { createWecomWebhookOutboundSender } from "../src/wecom/outbound-webhook-sender.js";

function createDeps(overrides = {}) {
  return {
    resolveWecomWebhookTargetConfig: () => ({ url: "https://qyapi.weixin.qq.com/cgi-bin/webhook/send", key: "k1" }),
    resolveWebhookBotSendUrl: ({ url, key }) => `${url}?key=${key}`,
    attachWecomProxyDispatcher: () => ({ dispatcher: { id: "d1" } }),
    splitWecomText: (text) => [String(text ?? "")],
    webhookSendText: async () => {},
    webhookSendImage: async () => {},
    webhookSendFileBuffer: async () => {},
    normalizeOutboundMediaUrls: ({ mediaUrl, mediaUrls } = {}) => [
      ...new Set([mediaUrl, ...(Array.isArray(mediaUrls) ? mediaUrls : [])].filter(Boolean)),
    ],
    resolveWecomOutboundMediaTarget: ({ mediaUrl }) =>
      String(mediaUrl).endsWith(".png") ? { type: "image", filename: "a.png" } : { type: "file", filename: "a.txt" },
    fetchMediaFromUrl: async () => ({ buffer: Buffer.from("hello") }),
    createHash: (_algo, input) => Buffer.from(input).toString("hex").slice(0, 8),
    sleep: async () => {},
    fetchImpl: async () => ({ ok: true }),
    ...overrides,
  };
}

test("sendWecomWebhookMediaBatch sends image and tracks failed file sends", async () => {
  const sentImages = [];
  const sentFiles = [];
  const sender = createWecomWebhookOutboundSender(
    createDeps({
      webhookSendImage: async (payload) => {
        sentImages.push(payload);
      },
      webhookSendFileBuffer: async (payload) => {
        sentFiles.push(payload.filename);
        throw new Error("file send failed");
      },
    }),
  );

  const result = await sender.sendWecomWebhookMediaBatch({
    webhook: "main",
    webhookTargets: {},
    mediaUrls: ["https://example.com/a.png", "https://example.com/a.txt"],
    logger: { info() {}, warn() {}, error() {} },
  });

  assert.equal(result.total, 2);
  assert.equal(result.sentCount, 1);
  assert.equal(result.failed.length, 1);
  assert.match(result.failed[0].reason, /file send failed/);
  assert.equal(sentImages.length, 1);
  assert.equal(sentImages[0].base64, Buffer.from("hello").toString("base64"));
  assert.equal(sentImages[0].md5, "68656c6c");
  assert.deepEqual(sentFiles, ["a.txt"]);
});

test("sendWecomWebhookText serializes concurrent sends to the same webhook target", async () => {
  const sentTexts = [];
  let releaseFirstSend;
  const firstSendBlocked = new Promise((resolve) => {
    releaseFirstSend = resolve;
  });
  const sender = createWecomWebhookOutboundSender(
    createDeps({
      webhookSendText: async ({ content }) => {
        sentTexts.push(String(content));
        if (sentTexts.length === 1) {
          await firstSendBlocked;
        }
      },
    }),
  );

  const firstSend = sender.sendWecomWebhookText({
    webhook: "main",
    webhookTargets: {},
    text: "first",
    logger: { info() {}, warn() {}, error() {} },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  const secondSend = sender.sendWecomWebhookText({
    webhook: "main",
    webhookTargets: {},
    text: "second",
    logger: { info() {}, warn() {}, error() {} },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(sentTexts, ["first"]);
  releaseFirstSend();
  await Promise.all([firstSend, secondSend]);
  assert.deepEqual(sentTexts, ["first", "second"]);
});
