import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createServer } from "node:http";
import { rm, mkdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import os from "node:os";
import { setTimeout as sleep } from "node:timers/promises";
import test from "node:test";

import {
  buildWecomSessionId,
  computeMsgSignature,
  extractLeadingSlashCommand,
  pickAccountBySignature,
  shouldStripWecomGroupMentions,
  stripWecomGroupMentions,
} from "../src/core.js";
import { createWecomBotEncryptedResponseBuilder } from "../src/wecom/bot-encrypted-response.js";
import { createWecomBotInboundContentBuilder } from "../src/wecom/bot-inbound-content.js";
import { createWecomBotWebhookHandler } from "../src/wecom/bot-webhook-handler.js";
import { decryptWecomPayload, encryptWecomPayload } from "../src/wecom/crypto-utils.js";
import { smartDecryptWecomFileBuffer } from "../src/wecom/media-download-decrypt.js";
import { inferFilenameFromMediaDownload } from "../src/wecom/media-download-filename.js";
import { detectImageContentTypeFromBuffer, pickImageFileExtension } from "../src/wecom/media-url-content.js";
import { createWecomRequestParsers } from "../src/wecom/request-parsers.js";
import { buildWecomBotSessionId } from "../src/wecom/runtime-utils.js";
import { createWecomTextInboundScheduler } from "../src/wecom/text-inbound-scheduler.js";
import { parseWecomBotInboundMessage, describeWecomBotParsedMessage, extractWecomXmlInboundEnvelope } from "../src/wecom/webhook-adapter.js";
import { createWecomAgentWebhookHandler } from "../src/wecom/agent-webhook-handler.js";

function createLogger() {
  return {
    info() {},
    warn() {},
    error() {},
  };
}

function createLimiter() {
  return {
    execute(fn) {
      return Promise.resolve().then(fn);
    },
  };
}

function createSignedEncryptedJson({ token, aesKey, payload }) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = `mx${Math.random().toString(16).slice(2, 10)}`;
  const encrypt = encryptWecomPayload({
    aesKey,
    plainText: JSON.stringify(payload ?? {}),
    corpId: "",
  });
  return {
    timestamp,
    nonce,
    encrypt,
    signature: computeMsgSignature({ token, timestamp, nonce, encrypt }),
  };
}

function createSignedEncryptedXml({ token, aesKey, xml }) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = `mx${Math.random().toString(16).slice(2, 10)}`;
  const encrypt = encryptWecomPayload({
    aesKey,
    plainText: xml,
    corpId: "",
  });
  const body = `<xml><Encrypt><![CDATA[${encrypt}]]></Encrypt></xml>`;
  return {
    timestamp,
    nonce,
    encrypt,
    body,
    signature: computeMsgSignature({ token, timestamp, nonce, encrypt }),
  };
}

function decodeEncryptedJsonResponse({ rawText, aesKey, token }) {
  const payload = JSON.parse(rawText);
  const expected = computeMsgSignature({
    token,
    timestamp: payload.timestamp,
    nonce: payload.nonce,
    encrypt: payload.encrypt,
  });
  assert.equal(payload.msgsignature, expected);
  const decrypted = decryptWecomPayload({
    aesKey,
    cipherTextBase64: payload.encrypt,
  });
  return JSON.parse(decrypted.msg);
}

async function requestHttp({ url, method = "GET", body = "", headers = {}, timeoutMs = 5000 }) {
  const response = await fetch(url, {
    method,
    headers,
    body: body || undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  return {
    status: response.status,
    text: await response.text(),
    headers: response.headers,
  };
}

function createTinyPngBuffer() {
  return Buffer.from(
    "89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de0000000a49444154789c6360000000020001e221bc330000000049454e44ae426082",
    "hex",
  );
}

test("local flow: bot mixed multi-image webhook keeps deduped images through content builder", async (t) => {
  const token = "bot-flow-token";
  const aesKey = Buffer.alloc(32, 12).toString("base64").replace(/=+$/g, "");
  const logger = createLogger();
  const { readRequestBody, parseIncomingJson } = createWecomRequestParsers();
  const { buildWecomBotEncryptedResponse } = createWecomBotEncryptedResponseBuilder({
    encryptWecom: ({ aesKey: key, plainText, corpId }) => encryptWecomPayload({ aesKey: key, plainText, corpId }),
    computeMsgSignature,
  });
  const buildBotInboundContent = createWecomBotInboundContentBuilder({
    fetchMediaFromUrl: async (url) => ({
      buffer: createTinyPngBuffer(),
      contentType: "image/png",
      finalUrl: url,
      contentDisposition: "",
    }),
    detectImageContentTypeFromBuffer,
    decryptWecomMediaBuffer: () => {
      throw new Error("not needed");
    },
    pickImageFileExtension,
    resolveWecomVoiceTranscriptionConfig: () => ({ enabled: false }),
    transcribeInboundVoice: async () => "",
    inferFilenameFromMediaDownload,
    smartDecryptWecomFileBuffer,
    basename,
    mkdir,
    tmpdir: os.tmpdir,
    join,
    writeFile,
    WECOM_TEMP_DIR_NAME: "openclaw-wechat-local-flow-test",
  });

  const processed = [];
  const streams = new Map();
  const handler = createWecomBotWebhookHandler({
    api: { logger },
    botConfig: {
      accountId: "default",
      token,
      encodingAesKey: aesKey,
      placeholderText: "处理中",
      streamExpireMs: 60_000,
    },
    normalizedPath: "/wecom/bot/callback",
    readRequestBody,
    parseIncomingJson,
    computeMsgSignature,
    decryptWecom: ({ aesKey: key, cipherTextBase64 }) => decryptWecomPayload({ aesKey: key, cipherTextBase64 }),
    parseWecomBotInboundMessage,
    describeWecomBotParsedMessage,
    cleanupExpiredBotStreams: () => {},
    getBotStream: (streamId) => streams.get(streamId) ?? null,
    buildWecomBotEncryptedResponse,
    markInboundMessageSeen: () => true,
    buildWecomBotSessionId,
    createBotStream: (streamId, content, options) => {
      streams.set(streamId, { content, finished: false, ...options });
    },
    upsertBotResponseUrlCache: () => {},
    messageProcessLimiter: createLimiter(),
    executeInboundTaskWithSessionQueue: async ({ task }) => task(),
    processBotInboundMessage: async (payload) => {
      const result = await buildBotInboundContent({
        api: { logger },
        botModeConfig: {
          accountId: payload.accountId,
          token,
          encodingAesKey: aesKey,
        },
        botProxyUrl: "",
        msgType: payload.msgType,
        commandBody: payload.content,
        normalizedImageUrls: payload.imageUrls,
        normalizedFileUrl: payload.fileUrl,
        normalizedFileName: payload.fileName,
        normalizedVoiceUrl: payload.voiceUrl,
        normalizedVoiceMediaId: payload.voiceMediaId,
        normalizedVoiceContentType: payload.voiceContentType,
        voiceInputMessageId: payload.msgId,
        normalizedQuote: payload.quote,
      });
      processed.push({ payload, result });
    },
    deliverBotReplyText: async () => ({ ok: true }),
    finishBotStream: (streamId, content) => {
      const current = streams.get(streamId) ?? {};
      streams.set(streamId, { ...current, finished: true, content });
    },
  });

  const server = createServer((req, res) => handler(req, res));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  assert.ok(port > 0);

  const payload = {
    msgtype: "mixed",
    msgid: `bot-mixed-${Date.now()}`,
    from: { userid: "dingxiang" },
    chattype: "single",
    mixed: {
      msg_item: [
        { msgtype: "text", text: { content: "请看这两张图" } },
        { msgtype: "image", image: { url: "https://example.com/a.png" } },
        { msgtype: "image", image: { url: "https://example.com/a.png" } },
        { msgtype: "image", image: { url: "https://example.com/b.png" } },
      ],
    },
    response_url: "https://example.invalid/response",
  };
  const signed = createSignedEncryptedJson({ token, aesKey, payload });
  const response = await requestHttp({
    url: `http://127.0.0.1:${port}/wecom/bot/callback?msg_signature=${encodeURIComponent(signed.signature)}&timestamp=${encodeURIComponent(signed.timestamp)}&nonce=${encodeURIComponent(signed.nonce)}`,
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ encrypt: signed.encrypt }),
  });
  assert.equal(response.status, 200);
  const plain = decodeEncryptedJsonResponse({
    rawText: response.text,
    aesKey,
    token,
  });
  assert.equal(plain?.msgtype, "stream");
  assert.equal(plain?.stream?.finish, false);
  assert.equal(plain?.stream?.content, "处理中");

  for (let i = 0; i < 20 && processed.length === 0; i += 1) {
    // Wait for the async pipeline kicked off by webhook dispatch.
    // eslint-disable-next-line no-await-in-loop
    await sleep(10);
  }
  assert.equal(processed.length, 1);
  assert.deepEqual(processed[0].payload.imageUrls, ["https://example.com/a.png", "https://example.com/b.png"]);
  assert.match(processed[0].result.messageText, /\[用户发送了多张图片\]/);
  assert.match(processed[0].result.messageText, /图片1: .*bot-image-/);
  assert.match(processed[0].result.messageText, /图片2: .*bot-image-/);
  assert.doesNotMatch(processed[0].result.messageText, /图片3:/);
  assert.equal(processed[0].result.tempPathsToCleanup.length, 2);

  for (const tempPath of processed[0].result.tempPathsToCleanup) {
    // Clean up temp artifacts created by the content builder.
    // eslint-disable-next-line no-await-in-loop
    await rm(tempPath, { force: true });
  }
});

test("local flow: agent webhook text debounce merges two encrypted callbacks into one inbound task", async (t) => {
  const account = {
    accountId: "sales",
    corpId: "ww-sales",
    corpSecret: "secret-sales",
    agentId: 1002,
    callbackToken: "agent-flow-token",
    callbackAesKey: Buffer.alloc(32, 13).toString("base64").replace(/=+$/g, ""),
    webhookPath: "/wecom/sales/callback",
  };
  const logger = createLogger();
  const { readRequestBody, parseIncomingXml } = createWecomRequestParsers();
  const processedPayloads = [];
  const sessionIds = [];
  const scheduler = createWecomTextInboundScheduler({
    resolveWecomGroupChatPolicy: () => ({ enabled: true, triggerMode: "direct", mentionPatterns: ["@"] }),
    shouldStripWecomGroupMentions,
    stripWecomGroupMentions,
    extractLeadingSlashCommand,
    resolveWecomTextDebouncePolicy: () => ({ enabled: true, windowMs: 80, maxBatch: 10 }),
    buildWecomSessionId,
    messageProcessLimiter: createLimiter(),
    executeInboundTaskWithSessionQueue: async ({ sessionId, task }) => {
      sessionIds.push(sessionId);
      return task();
    },
    getProcessInboundMessage: () => async (payload) => {
      processedPayloads.push(payload);
    },
  });

  const handler = createWecomAgentWebhookHandler({
    api: { logger },
    accounts: [account],
    readRequestBody,
    parseIncomingXml,
    pickAccountBySignature,
    decryptWecom: ({ aesKey, cipherTextBase64 }) => decryptWecomPayload({ aesKey, cipherTextBase64 }),
    markInboundMessageSeen: () => true,
    extractWecomXmlInboundEnvelope,
    buildWecomSessionId,
    scheduleTextInboundProcessing: scheduler.scheduleTextInboundProcessing,
    messageProcessLimiter: createLimiter(),
    executeInboundTaskWithSessionQueue: async ({ sessionId, task }) => {
      sessionIds.push(sessionId);
      return task();
    },
    processInboundMessage: async (payload) => {
      processedPayloads.push(payload);
    },
  });

  const server = createServer((req, res) => handler(req, res));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  assert.ok(port > 0);

  const baseUrl = `http://127.0.0.1:${port}${account.webhookPath}`;
  const xml1 = `<xml><ToUserName><![CDATA[openclaw-selfcheck]]></ToUserName><FromUserName><![CDATA[DingXiang]]></FromUserName><CreateTime>${Math.floor(Date.now() / 1000)}</CreateTime><MsgType><![CDATA[text]]></MsgType><Content><![CDATA[第一段]]></Content><MsgId>flow-1</MsgId></xml>`;
  const xml2 = `<xml><ToUserName><![CDATA[openclaw-selfcheck]]></ToUserName><FromUserName><![CDATA[DingXiang]]></FromUserName><CreateTime>${Math.floor(Date.now() / 1000)}</CreateTime><MsgType><![CDATA[text]]></MsgType><Content><![CDATA[第二段]]></Content><MsgId>flow-2</MsgId></xml>`;

  const signed1 = createSignedEncryptedXml({
    token: account.callbackToken,
    aesKey: account.callbackAesKey,
    xml: xml1,
  });
  const signed2 = createSignedEncryptedXml({
    token: account.callbackToken,
    aesKey: account.callbackAesKey,
    xml: xml2,
  });

  const response1 = await requestHttp({
    url: `${baseUrl}?msg_signature=${encodeURIComponent(signed1.signature)}&timestamp=${encodeURIComponent(signed1.timestamp)}&nonce=${encodeURIComponent(signed1.nonce)}`,
    method: "POST",
    headers: { "content-type": "application/xml" },
    body: signed1.body,
  });
  const response2 = await requestHttp({
    url: `${baseUrl}?msg_signature=${encodeURIComponent(signed2.signature)}&timestamp=${encodeURIComponent(signed2.timestamp)}&nonce=${encodeURIComponent(signed2.nonce)}`,
    method: "POST",
    headers: { "content-type": "application/xml" },
    body: signed2.body,
  });
  assert.equal(response1.status, 200);
  assert.equal(response1.text.trim().toLowerCase(), "success");
  assert.equal(response2.status, 200);
  assert.equal(response2.text.trim().toLowerCase(), "success");

  await sleep(160);

  assert.equal(processedPayloads.length, 1);
  assert.equal(processedPayloads[0].accountId, "sales");
  assert.equal(processedPayloads[0].fromUser, "DingXiang");
  assert.equal(processedPayloads[0].content, "第一段\n第二段");
  assert.equal(processedPayloads[0].msgId, "flow-1");
  assert.deepEqual(sessionIds, ["wecom:sales:dingxiang"]);
});
