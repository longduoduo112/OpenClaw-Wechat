import assert from "node:assert/strict";
import test from "node:test";

import { createWecomAgentLateReplyRuntime } from "../src/wecom/agent-late-reply-runtime.js";

function createDispatchState() {
  return {
    hasDeliveredReply: false,
    hasDeliveredPartialReply: false,
    hasSentProgressNotice: false,
  };
}

test("sendProgressNotice sends once and respects state flags", async () => {
  const sent = [];
  const runtime = createWecomAgentLateReplyRuntime({
    dispatchState: createDispatchState(),
    sessionId: "wecom:user-a",
    msgId: "m1",
    transcriptSessionId: "session-a",
    accountId: "default",
    storePath: "/tmp/store",
    lateReplyWatchMs: 60000,
    lateReplyPollMs: 1000,
    sendTextToUser: async (text) => sent.push(String(text)),
    ensureLateReplyWatcherRunner: () => async () => {},
    activeWatchers: new Map(),
    logger: { info() {}, warn() {} },
  });

  assert.equal(await runtime.sendProgressNotice("处理中"), true);
  assert.equal(await runtime.sendProgressNotice("处理中"), false);
  assert.deepEqual(sent, ["处理中"]);
});

test("sendFailureFallback sets delivered state and sends reason text", async () => {
  const sent = [];
  const state = createDispatchState();
  const runtime = createWecomAgentLateReplyRuntime({
    dispatchState: state,
    sessionId: "wecom:user-b",
    msgId: "m2",
    transcriptSessionId: "session-b",
    accountId: "default",
    storePath: "/tmp/store",
    lateReplyWatchMs: 60000,
    lateReplyPollMs: 1000,
    sendTextToUser: async (text) => sent.push(String(text)),
    ensureLateReplyWatcherRunner: () => async () => {},
    activeWatchers: new Map(),
    logger: { info() {}, warn() {} },
  });

  assert.equal(await runtime.sendFailureFallback(new Error("dispatch timeout")), true);
  assert.equal(state.hasDeliveredReply, true);
  assert.equal(sent.length, 1);
  assert.match(sent[0], /抱歉，当前模型请求超时或网络不稳定/);
  assert.match(sent[0], /dispatch timeout/);
});

test("sendFailureFallback auto-resets timed out session", async () => {
  const sent = [];
  const cleared = [];
  const logger = { info() {}, warn() {} };
  const runtime = createWecomAgentLateReplyRuntime({
    dispatchState: createDispatchState(),
    sessionId: "wecom:user-timeout",
    msgId: "m-timeout",
    transcriptSessionId: "session-timeout",
    accountId: "default",
    storePath: "/tmp/store-timeout",
    lateReplyWatchMs: 60000,
    lateReplyPollMs: 1000,
    sendTextToUser: async (text) => sent.push(String(text)),
    ensureLateReplyWatcherRunner: () => async () => {},
    activeWatchers: new Map(),
    clearSessionStoreEntry: async (options) => {
      cleared.push(options);
      return { cleared: true };
    },
    logger,
  });

  assert.equal(await runtime.sendFailureFallback("late reply watcher timed out after 180000ms"), true);
  assert.equal(sent.length, 1);
  assert.deepEqual(cleared, [
    {
      storePath: "/tmp/store-timeout",
      sessionKey: "wecom:user-timeout",
      logger,
    },
  ]);
});

test("sendFailureFallback keeps session when reason is not timeout", async () => {
  let cleared = 0;
  const logger = { info() {}, warn() {} };
  const runtime = createWecomAgentLateReplyRuntime({
    dispatchState: createDispatchState(),
    sessionId: "wecom:user-error",
    msgId: "m-error",
    transcriptSessionId: "session-error",
    accountId: "default",
    storePath: "/tmp/store-error",
    lateReplyWatchMs: 60000,
    lateReplyPollMs: 1000,
    sendTextToUser: async () => {},
    ensureLateReplyWatcherRunner: () => async () => {},
    activeWatchers: new Map(),
    clearSessionStoreEntry: async () => {
      cleared += 1;
      return { cleared: true };
    },
    logger,
  });

  assert.equal(await runtime.sendFailureFallback("upstream fetch failed"), true);
  assert.equal(cleared, 0);
});

test("startLateReplyWatcher starts once and forwards late text", async () => {
  const sent = [];
  const state = createDispatchState();
  let watcherCalls = 0;
  const runtime = createWecomAgentLateReplyRuntime({
    dispatchState: state,
    sessionId: "wecom:user-c",
    msgId: "m3",
    transcriptSessionId: "session-c",
    accountId: "default",
    storePath: "/tmp/store",
    lateReplyWatchMs: 60000,
    lateReplyPollMs: 1000,
    sendTextToUser: async (text) => sent.push(String(text)),
    ensureLateReplyWatcherRunner: () => async ({ sendText, markDelivered }) => {
      watcherCalls += 1;
      await sendText("late reply");
      markDelivered();
    },
    activeWatchers: new Map(),
    logger: { info() {}, warn() {} },
    now: () => 1000,
    randomToken: () => "abc123",
  });

  assert.equal(runtime.startLateReplyWatcher("dispatch-timeout"), true);
  assert.equal(runtime.startLateReplyWatcher("dispatch-timeout"), false);
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(watcherCalls, 1);
  assert.deepEqual(sent, ["late reply"]);
  assert.equal(state.hasDeliveredReply, true);
});
