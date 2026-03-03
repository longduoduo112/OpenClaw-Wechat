import assert from "node:assert/strict";
import test from "node:test";

import { createWecomBotTranscriptFallbackReader } from "../src/wecom/bot-transcript-fallback.js";

test("readWecomBotTranscriptFallback returns latest undelivered reply", async () => {
  const readFallback = createWecomBotTranscriptFallbackReader({
    resolveSessionTranscriptFilePath: async () => "/tmp/s.jsonl",
    readTranscriptAppendedChunk: async () => ({
      nextOffset: 10,
      chunk: "line-1\nline-2\n",
    }),
    parseLateAssistantReplyFromTranscriptLine: (line) => {
      if (line === "line-1") return { text: "old", transcriptMessageId: "m1" };
      if (line === "line-2") return { text: "new", transcriptMessageId: "m2" };
      return null;
    },
    hasTranscriptReplyBeenDelivered: (_sessionId, messageId) => messageId === "m1",
    markdownToWecomText: (text) => `fmt:${text}`,
  });

  const result = await readFallback({
    storePath: "/tmp/store.json",
    sessionId: "wecom-bot:dingxiang",
    transcriptSessionId: "session-runtime-id",
    minTimestamp: 0,
    logger: { warn() {} },
  });

  assert.deepEqual(result, {
    text: "fmt:new",
    transcriptMessageId: "m2",
  });
});

test("readWecomBotTranscriptFallback swallows error and returns empty result", async () => {
  let warned = false;
  const readFallback = createWecomBotTranscriptFallbackReader({
    resolveSessionTranscriptFilePath: async () => {
      throw new Error("missing transcript");
    },
    readTranscriptAppendedChunk: async () => ({ nextOffset: 0, chunk: "" }),
    parseLateAssistantReplyFromTranscriptLine: () => null,
    hasTranscriptReplyBeenDelivered: () => false,
    markdownToWecomText: (text) => text,
  });

  const result = await readFallback({
    storePath: "/tmp/store.json",
    sessionId: "s1",
    transcriptSessionId: "s1",
    logger: {
      warn(message) {
        warned = /transcript fallback failed/.test(String(message));
      },
    },
    logErrors: true,
  });

  assert.deepEqual(result, {
    text: "",
    transcriptMessageId: "",
  });
  assert.equal(warned, true);
});
