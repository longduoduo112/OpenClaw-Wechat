import assert from "node:assert/strict";
import test from "node:test";

import { createWecomVoiceTranscriber } from "../src/wecom/voice-transcription.js";

function createTranscriber(overrides = {}) {
  return createWecomVoiceTranscriber({
    tempDirName: "openclaw-wechat-test",
    resolveVoiceTranscriptionConfig: ({ channelConfig }) => ({
      enabled: Boolean(channelConfig?.voiceTranscription?.enabled),
      provider: "local-whisper-cli",
      command: "whisper-cli",
      maxBytes: 1024,
      transcodeToWav: true,
      ffmpegEnabled: true,
      timeoutMs: 15000,
      requireModelPath: true,
      modelPath: "./model.bin",
      model: "base",
      language: "zh",
      prompt: "",
    }),
    normalizeAudioContentType: (v) => String(v ?? "").trim().toLowerCase(),
    isLocalVoiceInputTypeDirectlySupported: (v) => ["audio/wav", "audio/x-wav", "audio/amr", "audio/mpeg"].includes(v),
    pickAudioFileExtension: ({ contentType }) => {
      const t = String(contentType ?? "");
      if (t.includes("wav")) return ".wav";
      if (t.includes("amr")) return ".amr";
      if (t.includes("mpeg")) return ".mp3";
      return ".bin";
    },
    processEnv: {},
    ...overrides,
  });
}

test("resolveWecomVoiceTranscriptionConfig reads api config", () => {
  const transcriber = createTranscriber();
  const cfg = transcriber.resolveWecomVoiceTranscriptionConfig({
    config: {
      channels: { wecom: { voiceTranscription: { enabled: true } } },
      env: { vars: {} },
    },
  });
  assert.equal(cfg.enabled, true);
  assert.equal(cfg.provider, "local-whisper-cli");
});

test("resolveLocalWhisperCommand falls back when explicit command unavailable", async () => {
  const transcriber = createTranscriber({
    checkCommandAvailableImpl: async (cmd) => cmd === "whisper",
  });

  const command = await transcriber.__internal.resolveLocalWhisperCommand({
    voiceConfig: {
      provider: "local-whisper",
      command: "custom-whisper",
    },
    logger: { warn() {} },
  });
  assert.equal(command, "whisper");
});

test("inspectWecomVoiceTranscriptionRuntime reports missing command and ffmpeg", async () => {
  const transcriber = createTranscriber({
    checkCommandAvailableImpl: async () => false,
  });

  const info = await transcriber.inspectWecomVoiceTranscriptionRuntime({
    api: { logger: { warn() {} } },
    voiceConfig: {
      enabled: true,
      provider: "local-whisper-cli",
      command: "custom-whisper",
      ffmpegEnabled: true,
      requireModelPath: true,
      modelPath: "",
    },
  });

  assert.equal(info.enabled, true);
  assert.equal(info.resolvedCommand, "");
  assert.equal(info.ffmpegAvailable, false);
  assert.deepEqual(
    info.commandCandidates,
    ["custom-whisper", "whisper-cli"],
  );
  assert.match(info.issues.join(" | "), /no available command in PATH/);
  assert.match(info.issues.join(" | "), /modelPath is required/);
  assert.match(info.issues.join(" | "), /ffmpeg not available/);
});

test("transcribeInboundVoice throws when disabled", async () => {
  const transcriber = createTranscriber();
  await assert.rejects(
    transcriber.transcribeInboundVoice({
      api: { logger: { warn() {}, info() {}, error() {} } },
      buffer: Buffer.from("abc"),
      contentType: "audio/wav",
      mediaId: "m1",
      voiceConfig: { enabled: false },
    }),
    /disabled/,
  );
});

test("transcribeInboundVoice enforces maxBytes", async () => {
  const transcriber = createTranscriber();
  await assert.rejects(
    transcriber.transcribeInboundVoice({
      api: { logger: { warn() {}, info() {}, error() {} } },
      buffer: Buffer.alloc(2048, 1),
      contentType: "audio/wav",
      mediaId: "m1",
      voiceConfig: {
        enabled: true,
        maxBytes: 100,
        transcodeToWav: false,
        ffmpegEnabled: true,
        provider: "local-whisper",
        command: "whisper",
        timeoutMs: 1000,
        model: "base",
      },
    }),
    /exceeds maxBytes/,
  );
});

test("transcribeInboundVoice rejects unsupported type when ffmpeg disabled", async () => {
  const transcriber = createTranscriber({
    isLocalVoiceInputTypeDirectlySupported: () => false,
  });
  await assert.rejects(
    transcriber.transcribeInboundVoice({
      api: { logger: { warn() {}, info() {}, error() {} } },
      buffer: Buffer.from("abc"),
      contentType: "audio/ogg",
      mediaId: "m1",
      voiceConfig: {
        enabled: true,
        maxBytes: 1024,
        transcodeToWav: true,
        ffmpegEnabled: false,
        provider: "local-whisper",
        command: "whisper",
        timeoutMs: 1000,
        model: "base",
      },
    }),
    /ffmpegEnabled=false/,
  );
});
