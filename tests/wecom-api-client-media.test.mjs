import assert from "node:assert/strict";
import test from "node:test";

import { createWecomApiMediaClient } from "../src/wecom/api-client-media.js";

test("createWecomApiMediaClient uploadWecomMedia returns media_id", async () => {
  const mediaClient = createWecomApiMediaClient({
    fetchWithRetry: async () => ({
      async json() {
        return { errcode: 0, media_id: "media-1" };
      },
    }),
    getWecomAccessToken: async () => "token-1",
  });

  const mediaId = await mediaClient.uploadWecomMedia({
    corpId: "ww-1",
    corpSecret: "secret",
    type: "image",
    buffer: Buffer.from("hello"),
    filename: "a.png",
    logger: { info() {}, warn() {}, error() {} },
  });
  assert.equal(mediaId, "media-1");
});

test("createWecomApiMediaClient downloadWecomMedia throws json error", async () => {
  const mediaClient = createWecomApiMediaClient({
    fetchWithRetry: async () => ({
      ok: true,
      headers: {
        get(name) {
          if (String(name).toLowerCase() === "content-type") return "application/json";
          return "";
        },
      },
      async json() {
        return { errcode: 40007, errmsg: "invalid media_id" };
      },
      async arrayBuffer() {
        return new Uint8Array().buffer;
      },
    }),
    getWecomAccessToken: async () => "token-1",
  });

  await assert.rejects(
    () =>
      mediaClient.downloadWecomMedia({
        corpId: "ww-1",
        corpSecret: "secret",
        mediaId: "bad-media",
        logger: { info() {}, warn() {}, error() {} },
      }),
    /WeCom media download failed/,
  );
});
