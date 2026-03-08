import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { createWecomSessionResetter } from "../src/wecom/session-reset.js";

test("clearSessionStoreEntry removes session entry and archives transcript", async () => {
  const workdir = await mkdtemp(path.join(tmpdir(), "wecom-reset-"));
  const storePath = path.join(workdir, "sessions.json");
  const transcriptPath = path.join(workdir, "session-a.jsonl");
  await writeFile(transcriptPath, "hello\n", "utf8");
  await writeFile(
    storePath,
    JSON.stringify(
      {
        "Agent:Main:WeCom:Alice": {
          sessionFile: transcriptPath,
        },
        "agent:main:wecom:bob": {
          sessionFile: path.join(workdir, "session-b.jsonl"),
        },
      },
      null,
      2,
    ),
    "utf8",
  );

  const { clearSessionStoreEntry } = createWecomSessionResetter({
    dateNow: () => 1234567890,
  });
  const result = await clearSessionStoreEntry({
    storePath,
    sessionKey: "agent:main:wecom:alice",
    logger: { warn() {} },
  });

  assert.equal(result.cleared, true);
  assert.equal(result.transcriptArchived, true);
  assert.equal(result.archivedTranscriptPath, `${transcriptPath}.reset-1234567890`);

  const nextStore = JSON.parse(await readFile(storePath, "utf8"));
  assert.deepEqual(Object.keys(nextStore), ["agent:main:wecom:bob"]);
});

test("resetWecomConversationSession resolves route and clears watcher entry", async () => {
  const workdir = await mkdtemp(path.join(tmpdir(), "wecom-reset-route-"));
  const storePath = path.join(workdir, "sessions.json");
  const transcriptPath = path.join(workdir, "session.jsonl");
  await mkdir(workdir, { recursive: true });
  await writeFile(transcriptPath, "hello\n", "utf8");
  await writeFile(
    storePath,
    JSON.stringify(
      {
        "agent:helper:wecom:alice": {
          sessionFile: transcriptPath,
        },
      },
      null,
      2,
    ),
    "utf8",
  );

  const activeLateReplyWatchers = new Map([["agent:helper:wecom:alice", true]]);
  const { resetWecomConversationSession } = createWecomSessionResetter({
    dateNow: () => 987654321,
  });
  const result = await resetWecomConversationSession({
    api: { logger: { info() {}, warn() {} } },
    runtime: {
      channel: {
        session: {
          resolveStorePath: () => storePath,
        },
      },
    },
    cfg: { session: { store: "memory" } },
    baseSessionId: "wecom:alice",
    fromUser: "Alice",
    accountId: "default",
    resolveWecomAgentRoute: () => ({
      agentId: "helper",
      sessionKey: "agent:helper:wecom:alice",
    }),
    activeLateReplyWatchers,
  });

  assert.equal(result.cleared, true);
  assert.equal(result.sessionKey, "agent:helper:wecom:alice");
  assert.equal(activeLateReplyWatchers.has("agent:helper:wecom:alice"), false);
});
