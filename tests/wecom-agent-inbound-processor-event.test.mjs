import assert from "node:assert/strict";
import test from "node:test";

import { createWecomAgentInboundProcessor } from "../src/wecom/agent-inbound-processor.js";

function createProcessorContext({ eventPolicy } = {}) {
  const sentTexts = [];
  const api = {
    config: {
      channels: { wecom: {} },
      env: { vars: {} },
      session: { store: "memory" },
    },
    runtime: {
      channel: {
        session: {
          resolveStorePath: () => "/tmp/openclaw/store/main",
          recordInboundSession: async () => {},
        },
        reply: {
          dispatchReplyWithBufferedBlockDispatcher: async () => {},
        },
      },
    },
    logger: {
      info() {},
      warn() {},
      error() {},
    },
  };

  const processInboundMessage = createWecomAgentInboundProcessor({
    getWecomConfig: () => ({
      accountId: "default",
      corpId: "ww-test",
      corpSecret: "secret",
      agentId: 1000001,
      outboundProxy: "",
    }),
    buildWecomSessionId: (fromUser) => `wecom:${String(fromUser ?? "").trim().toLowerCase()}`,
    resolveWecomGroupChatPolicy: () => ({ enabled: true, triggerMode: "direct", mentionPatterns: [] }),
    resolveWecomDynamicAgentPolicy: () => ({ enabled: false }),
    shouldTriggerWecomGroupResponse: () => true,
    shouldStripWecomGroupMentions: () => false,
    stripWecomGroupMentions: (text) => String(text ?? ""),
    resolveWecomCommandPolicy: () => ({
      enabled: false,
      allowlist: [],
      adminUsers: [],
      rejectMessage: "blocked",
    }),
    resolveWecomAllowFromPolicy: () => ({ allowFrom: ["*"], rejectMessage: "blocked" }),
    resolveWecomDmPolicy: () => ({ mode: "open", allowFrom: [], rejectMessage: "" }),
    resolveWecomEventPolicy: () =>
      eventPolicy ?? {
        enabled: true,
        enterAgentWelcomeEnabled: true,
        enterAgentWelcomeText: "欢迎使用 OpenClaw-Wechat",
      },
    isWecomSenderAllowed: () => true,
    sendWecomText: async ({ text }) => {
      sentTexts.push(String(text ?? ""));
    },
    extractLeadingSlashCommand: () => "",
    COMMANDS: {},
    buildInboundContent: async () => ({ aborted: true }),
    resolveWecomAgentRoute: () => ({ agentId: "main", sessionKey: "wecom:u1", matchedBy: "default" }),
    seedDynamicAgentWorkspace: async () => {},
    resolveWecomReplyStreamingPolicy: () => ({ enabled: false }),
    asNumber: (value, fallback = 0) => {
      const n = Number(value);
      return Number.isFinite(n) ? n : fallback;
    },
    requireEnv: () => "",
    getByteLength: (text) => Buffer.byteLength(String(text ?? ""), "utf8"),
    markdownToWecomText: (text) => String(text ?? ""),
    autoSendWorkspaceFilesFromReplyText: async () => ({ sentCount: 0, failedCount: 0 }),
    sendWecomOutboundMediaBatch: async () => ({ sentCount: 0, failedUrls: [] }),
    sleep: async () => {},
    resolveSessionTranscriptFilePath: async () => "",
    readTranscriptAppendedChunk: async () => ({ nextOffset: 0, chunk: "" }),
    parseLateAssistantReplyFromTranscriptLine: () => null,
    hasTranscriptReplyBeenDelivered: () => false,
    markTranscriptReplyDelivered: () => {},
    withTimeout: async (promise) => promise,
    isDispatchTimeoutError: () => false,
    isAgentFailureText: () => false,
    scheduleTempFileCleanup: () => {},
    ACTIVE_LATE_REPLY_WATCHERS: new Map(),
  });

  return { api, processInboundMessage, sentTexts };
}

test("agent inbound processor sends enter_agent welcome text when enabled", async () => {
  const { api, processInboundMessage, sentTexts } = createProcessorContext();
  await processInboundMessage({
    api,
    accountId: "default",
    fromUser: "dingxiang",
    msgType: "event",
    eventType: "enter_agent",
  });
  assert.equal(sentTexts.length, 1);
  assert.equal(sentTexts[0], "欢迎使用 OpenClaw-Wechat");
});

test("agent inbound processor skips enter_agent welcome when disabled", async () => {
  const { api, processInboundMessage, sentTexts } = createProcessorContext({
    eventPolicy: {
      enabled: true,
      enterAgentWelcomeEnabled: false,
      enterAgentWelcomeText: "不应发送",
    },
  });
  await processInboundMessage({
    api,
    accountId: "default",
    fromUser: "dingxiang",
    msgType: "event",
    eventType: "enter_agent",
  });
  assert.equal(sentTexts.length, 0);
});
