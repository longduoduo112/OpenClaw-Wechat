import assert from "node:assert/strict";
import test from "node:test";

import {
  finalizeWecomAgentVisiblePartialReply,
  handleWecomAgentPostDispatchFallback,
} from "../src/wecom/agent-dispatch-fallback.js";

function createState(overrides = {}) {
  return {
    hasDeliveredReply: false,
    hasDeliveredPartialReply: false,
    blockTextFallback: "",
    streamChunkSendChain: Promise.resolve(),
    ...overrides,
  };
}

test("handleWecomAgentPostDispatchFallback delivers block fallback text", async () => {
  const sent = [];
  const watchers = [];
  const state = createState({
    blockTextFallback: "line-1\nline-2",
  });
  await handleWecomAgentPostDispatchFallback({
    api: { logger: { info() {}, warn() {} } },
    state,
    streamingEnabled: false,
    flushStreamingBuffer: async () => false,
    sendTextToUser: async (text) => sent.push(String(text)),
    markdownToWecomText: (text) => `fmt:${text}`,
    sendProgressNotice: async () => {},
    startLateReplyWatcher: async (reason) => watchers.push(reason),
    dispatchResult: { counts: { final: 0, block: 0, tool: 0 }, queuedFinal: false },
  });

  assert.deepEqual(sent, ["fmt:line-1\nline-2"]);
  assert.deepEqual(watchers, []);
  assert.equal(state.hasDeliveredReply, true);
});

test("handleWecomAgentPostDispatchFallback starts queued watcher when no output", async () => {
  const notices = [];
  const watchers = [];
  const state = createState();
  await handleWecomAgentPostDispatchFallback({
    api: { logger: { info() {}, warn() {} } },
    state,
    streamingEnabled: false,
    flushStreamingBuffer: async () => false,
    sendTextToUser: async () => {},
    markdownToWecomText: (text) => String(text),
    sendProgressNotice: async (text) => notices.push(String(text)),
    startLateReplyWatcher: async (reason) => watchers.push(reason),
    queuedNoticeText: "queued",
    processingNoticeText: "processing",
    dispatchResult: { counts: { final: 0, block: 0, tool: 0 }, queuedFinal: false },
  });

  assert.deepEqual(notices, ["queued"]);
  assert.deepEqual(watchers, ["queued-no-final"]);
  assert.equal(state.hasDeliveredReply, false);
});

test("handleWecomAgentPostDispatchFallback starts dispatch-finished watcher when queuedFinal true", async () => {
  const notices = [];
  const watchers = [];
  const state = createState();
  await handleWecomAgentPostDispatchFallback({
    api: { logger: { info() {}, warn() {} } },
    state,
    streamingEnabled: false,
    flushStreamingBuffer: async () => false,
    sendTextToUser: async () => {},
    markdownToWecomText: (text) => String(text),
    sendProgressNotice: async (text) => notices.push(String(text)),
    startLateReplyWatcher: async (reason) => watchers.push(reason),
    queuedNoticeText: "queued",
    processingNoticeText: "processing",
    dispatchResult: { counts: { final: 0, block: 0, tool: 0 }, queuedFinal: true },
  });

  assert.deepEqual(notices, ["processing"]);
  assert.deepEqual(watchers, ["dispatch-finished-without-final"]);
});

test("finalizeWecomAgentVisiblePartialReply flushes pending partials and avoids timeout fallback", async () => {
  const sent = [];
  const state = createState({
    hasDeliveredPartialReply: true,
    streamChunkBuffer: "第二句",
  });
  const finalized = await finalizeWecomAgentVisiblePartialReply({
    api: { logger: { info() {} } },
    state,
    flushStreamingBuffer: async ({ force, reason }) => {
      assert.equal(force, true);
      assert.equal(reason, "dispatch-timeout");
      state.streamChunkBuffer = "";
      state.streamChunkSendChain = Promise.resolve().then(async () => {
        sent.push("第二句");
      });
      await state.streamChunkSendChain;
      return true;
    },
    reason: "dispatch-timeout",
  });

  assert.equal(finalized, true);
  assert.equal(state.hasDeliveredReply, true);
  assert.deepEqual(sent, ["第二句"]);
});

test("handleWecomAgentPostDispatchFallback marks visible partial as delivered without watcher", async () => {
  const sent = [];
  const watchers = [];
  const state = createState({
    hasDeliveredPartialReply: true,
    streamChunkBuffer: "",
  });
  await handleWecomAgentPostDispatchFallback({
    api: { logger: { info() {}, warn() {} } },
    state,
    streamingEnabled: true,
    flushStreamingBuffer: async () => false,
    sendTextToUser: async (text) => sent.push(String(text)),
    markdownToWecomText: (text) => String(text),
    sendProgressNotice: async () => {},
    startLateReplyWatcher: async (reason) => watchers.push(reason),
    dispatchResult: { counts: { final: 0, block: 1, tool: 0 }, queuedFinal: false },
  });

  assert.equal(state.hasDeliveredReply, true);
  assert.deepEqual(sent, []);
  assert.deepEqual(watchers, []);
});
