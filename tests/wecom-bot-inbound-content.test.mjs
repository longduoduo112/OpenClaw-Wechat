import assert from "node:assert/strict";
import test from "node:test";

import { createWecomBotInboundContentBuilder } from "../src/wecom/bot-inbound-content.js";

function createBuilder(overrides = {}) {
  return createWecomBotInboundContentBuilder({
    fetchMediaFromUrl: async () => {
      throw new Error("unexpected fetch");
    },
    detectImageContentTypeFromBuffer: () => "image/png",
    decryptWecomMediaBuffer: ({ encryptedBuffer }) => encryptedBuffer,
    pickImageFileExtension: () => ".png",
    resolveWecomVoiceTranscriptionConfig: () => ({ enabled: false, maxBytes: 10 * 1024 * 1024 }),
    transcribeInboundVoice: async () => "voice text",
    inferFilenameFromMediaDownload: ({ explicitName }) => explicitName || "file.bin",
    smartDecryptWecomFileBuffer: ({ buffer }) => ({ buffer, decrypted: false }),
    basename: (name) => String(name ?? "").split("/").pop(),
    mkdir: async () => {},
    tmpdir: () => "/tmp",
    join: (...parts) => parts.join("/"),
    writeFile: async () => {},
    WECOM_TEMP_DIR_NAME: "openclaw-wecom",
    ...overrides,
  });
}

test("buildBotInboundContent keeps plain text", async () => {
  const build = createBuilder();
  const result = await build({
    api: { logger: {} },
    msgType: "text",
    commandBody: "hello",
    normalizedImageUrls: [],
  });
  assert.equal(result.aborted, false);
  assert.equal(result.abortText, "");
  assert.equal(result.messageText, "hello");
  assert.deepEqual(result.tempPathsToCleanup, []);
});

test("buildBotInboundContent aborts when image download fails and no text", async () => {
  const build = createBuilder({
    fetchMediaFromUrl: async () => {
      throw new Error("download failed");
    },
  });
  const result = await build({
    api: { logger: { warn() {} } },
    msgType: "image",
    commandBody: "",
    normalizedImageUrls: ["https://example.com/a.png"],
  });
  assert.equal(result.aborted, true);
  assert.match(result.abortText, /图片接收失败/);
});

test("buildBotInboundContent prepends quoted message", async () => {
  const build = createBuilder();
  const result = await build({
    api: { logger: {} },
    msgType: "text",
    commandBody: "回复内容",
    normalizedQuote: { msgType: "text", content: "上一条" },
  });
  assert.equal(result.aborted, false);
  assert.equal(result.messageText, "> 上一条\n\n回复内容");
});

test("buildBotInboundContent returns file fallback text when file download fails", async () => {
  const build = createBuilder({
    fetchMediaFromUrl: async () => {
      throw new Error("download failed");
    },
  });
  const result = await build({
    api: { logger: { warn() {} } },
    msgType: "file",
    commandBody: "",
    normalizedFileUrl: "https://example.com/a.pdf",
    normalizedFileName: "a.pdf",
  });
  assert.equal(result.aborted, false);
  assert.match(result.messageText, /下载失败/);
});

test("buildBotInboundContent decrypts image with per-message aes key", async () => {
  const imageDecryptCalls = [];
  const build = createBuilder({
    fetchMediaFromUrl: async () => ({
      buffer: Buffer.from("encrypted-image"),
      contentType: "application/octet-stream",
    }),
    detectImageContentTypeFromBuffer: (buffer) =>
      String(buffer) === "decrypted-image" ? "image/png" : "",
    decryptWecomMediaBuffer: ({ aesKey }) => {
      imageDecryptCalls.push(aesKey);
      return Buffer.from("decrypted-image");
    },
  });
  const result = await build({
    api: { logger: { info() {}, warn() {} } },
    msgType: "image",
    normalizedImageEntries: [{ url: "https://example.com/a.png", aesKey: "image-key-1" }],
    normalizedImageUrls: ["https://example.com/a.png"],
  });
  assert.equal(result.aborted, false);
  assert.equal(imageDecryptCalls[0], "image-key-1");
  assert.match(result.messageText, /图片1: \/tmp\/openclaw-wecom\//);
});

test("buildBotInboundContent prefers per-message aes key for file decrypt", async () => {
  const fileDecryptCalls = [];
  const build = createBuilder({
    fetchMediaFromUrl: async () => ({
      buffer: Buffer.from("encrypted-pdf"),
      contentType: "application/octet-stream",
      contentDisposition: "attachment; filename=report.pdf",
      finalUrl: "https://example.com/report.pdf",
      source: "remote",
    }),
    smartDecryptWecomFileBuffer: ({ aesKey, buffer }) => {
      fileDecryptCalls.push(aesKey);
      return { buffer, decrypted: true };
    },
  });
  const result = await build({
    api: { logger: { info() {}, warn() {} } },
    botModeConfig: { encodingAesKey: "fallback-key" },
    msgType: "file",
    normalizedFileUrl: "https://example.com/report.pdf",
    normalizedFileName: "report.pdf",
    normalizedFileAesKey: "message-key-1",
  });
  assert.equal(result.aborted, false);
  assert.equal(fileDecryptCalls[0], "message-key-1");
  assert.match(result.messageText, /用户发送了一个文件/);
});

test("buildBotInboundContent transcribes voice from downloadable voice url", async () => {
  const calls = [];
  const build = createBuilder({
    fetchMediaFromUrl: async (url, options) => {
      calls.push({ url, options });
      return {
        buffer: Buffer.from("voice-bytes"),
        contentType: "audio/amr",
      };
    },
    resolveWecomVoiceTranscriptionConfig: () => ({
      enabled: true,
      maxBytes: 4 * 1024 * 1024,
    }),
    transcribeInboundVoice: async ({ mediaId, contentType }) => `voice:${mediaId}:${contentType}`,
  });
  const result = await build({
    api: { logger: {} },
    msgType: "voice",
    normalizedVoiceUrl: "https://example.com/voice.amr",
    normalizedVoiceMediaId: "voice-1",
    normalizedVoiceContentType: "audio/amr",
  });
  assert.equal(result.aborted, false);
  assert.match(result.messageText, /\[用户发送了一条语音\]/);
  assert.match(result.messageText, /voice:voice-1:audio\/amr/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://example.com/voice.amr");
});

test("buildBotInboundContent aborts when voice transcription fails", async () => {
  const build = createBuilder({
    fetchMediaFromUrl: async () => ({
      buffer: Buffer.from("voice-bytes"),
      contentType: "audio/amr",
    }),
    resolveWecomVoiceTranscriptionConfig: () => ({
      enabled: true,
      maxBytes: 4 * 1024 * 1024,
    }),
    transcribeInboundVoice: async () => {
      throw new Error("stt failed");
    },
  });
  const result = await build({
    api: { logger: { warn() {} } },
    msgType: "voice",
    normalizedVoiceUrl: "https://example.com/voice.amr",
    normalizedVoiceMediaId: "voice-2",
  });
  assert.equal(result.aborted, true);
  assert.match(result.abortText, /语音识别失败/);
});

test("buildBotInboundContent supports mixed message with file and voice", async () => {
  const build = createBuilder({
    fetchMediaFromUrl: async (url) => {
      if (url.includes("report.pdf")) {
        return {
          buffer: Buffer.from("pdf-bytes"),
          contentType: "application/pdf",
          contentDisposition: "attachment; filename=report.pdf",
          finalUrl: "https://example.com/report.pdf",
          source: "remote",
        };
      }
      return {
        buffer: Buffer.from("voice-bytes"),
        contentType: "audio/amr",
      };
    },
    resolveWecomVoiceTranscriptionConfig: () => ({
      enabled: true,
      maxBytes: 4 * 1024 * 1024,
    }),
    transcribeInboundVoice: async () => "混合语音转写",
  });
  const result = await build({
    api: { logger: { info() {}, warn() {} } },
    msgType: "mixed",
    commandBody: "请处理混合消息",
    normalizedFileUrl: "https://example.com/report.pdf",
    normalizedFileName: "report.pdf",
    normalizedVoiceUrl: "https://example.com/voice.amr",
    normalizedVoiceMediaId: "voice-mixed-1",
    normalizedVoiceContentType: "audio/amr",
  });
  assert.equal(result.aborted, false);
  assert.match(result.messageText, /请处理混合消息/);
  assert.match(result.messageText, /用户发送了一个文件/);
  assert.match(result.messageText, /用户发送了一条语音/);
});
