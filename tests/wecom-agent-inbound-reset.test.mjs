import assert from "node:assert/strict";
import test from "node:test";

import { createWecomAgentInboundProcessor } from "../src/wecom/agent-inbound-processor.js";

test("agent inbound processor handles /reset locally without dispatch", async () => {
  const sentTexts = [];
  const resetCalls = [];
  let dispatchCalled = false;
  let inboundContentCalled = false;

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
      enabled: true,
      allowlist: ["/reset", "/clear", "/new"],
      adminUsers: [],
      rejectMessage: "blocked",
    }),
    resolveWecomAllowFromPolicy: () => ({ allowFrom: ["*"], rejectMessage: "blocked" }),
    resolveWecomDmPolicy: () => ({ mode: "open", allowFrom: [], rejectMessage: "" }),
    resolveWecomEventPolicy: () => ({ enabled: true, enterAgentWelcomeEnabled: false, enterAgentWelcomeText: "" }),
    isWecomSenderAllowed: () => true,
    sendWecomText: async ({ text }) => {
      sentTexts.push(String(text ?? ""));
    },
    extractLeadingSlashCommand: (text) => (String(text ?? "").startsWith("/reset") ? "/reset" : ""),
    COMMANDS: {},
    buildInboundContent: async () => {
      inboundContentCalled = true;
      return { aborted: true };
    },
    resolveWecomAgentRoute: () => ({ agentId: "main", sessionKey: "wecom:dingxiang" }),
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
    withTimeout: async () => {
      dispatchCalled = true;
    },
    isDispatchTimeoutError: () => false,
    isAgentFailureText: () => false,
    scheduleTempFileCleanup: () => {},
    ACTIVE_LATE_REPLY_WATCHERS: new Map(),
    resetWecomConversationSession: async (payload) => {
      resetCalls.push(payload);
      return { cleared: true };
    },
  });

  await processInboundMessage({
    api: {
      config: { channels: { wecom: {} }, env: { vars: {} }, session: { store: "memory" } },
      runtime: {
        channel: {
          session: {
            resolveStorePath: () => "/tmp/openclaw/store/main",
            recordInboundSession: async () => {},
          },
          reply: {
            dispatchReplyWithBufferedBlockDispatcher: async () => {
              dispatchCalled = true;
            },
          },
        },
      },
      logger: {
        info() {},
        warn() {},
        error() {},
      },
    },
    accountId: "default",
    fromUser: "DingXiang",
    content: "/reset",
    msgType: "text",
    chatId: "",
    isGroupChat: false,
    msgId: "msg-1",
  });

  assert.equal(resetCalls.length, 1);
  assert.equal(resetCalls[0].baseSessionId, "wecom:dingxiang");
  assert.equal(sentTexts.at(-1), "会话已重置。请继续发送你的新问题。");
  assert.equal(inboundContentCalled, false);
  assert.equal(dispatchCalled, false);
});
