import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import { createWecomRequestParsers } from "../src/wecom/request-parsers.js";

function createMockReq() {
  const req = new EventEmitter();
  req.destroyed = false;
  req.destroy = () => {
    req.destroyed = true;
  };
  return req;
}

test("request parsers decode xml/json payload", () => {
  const { parseIncomingXml, parseIncomingJson } = createWecomRequestParsers();
  assert.deepEqual(parseIncomingXml("<xml><ToUserName>bot</ToUserName></xml>"), { ToUserName: "bot" });
  assert.deepEqual(parseIncomingJson('{"msg":"ok"}'), { msg: "ok" });
  assert.equal(parseIncomingJson(""), null);
});

test("request parsers preserve leading zero fields in xml", () => {
  const { parseIncomingXml } = createWecomRequestParsers();
  assert.deepEqual(parseIncomingXml("<xml><FromUserName>00123</FromUserName><AgentID>000045</AgentID></xml>"), {
    FromUserName: "00123",
    AgentID: "000045",
  });
});

test("readRequestBody reads request stream", async () => {
  const { readRequestBody } = createWecomRequestParsers();
  const req = createMockReq();
  const reading = readRequestBody(req);
  req.emit("data", Buffer.from("he"));
  req.emit("data", Buffer.from("llo"));
  req.emit("end");
  const body = await reading;
  assert.equal(body, "hello");
});

test("readRequestBody enforces max body size", async () => {
  const { readRequestBody } = createWecomRequestParsers();
  const req = createMockReq();
  const reading = readRequestBody(req, 5);
  req.emit("data", Buffer.from("123456"));
  await assert.rejects(reading, /Request body too large/);
  assert.equal(req.destroyed, true);
});
