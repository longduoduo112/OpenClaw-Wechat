import assert from "node:assert/strict";
import test from "node:test";

import { createWecomDocToolRegistrar } from "../src/wecom/doc-tool.js";

function normalizeAccountId(value) {
  return String(value ?? "default").trim().toLowerCase() || "default";
}

function createLogger() {
  return {
    info() {},
    warn() {},
    error() {},
  };
}

test("doc tool registers and uses configured defaultAccount", async () => {
  const registerCalls = [];
  const requests = [];
  const registerWecomDocTools = createWecomDocToolRegistrar({
    listEnabledWecomAccounts: () => [
      { accountId: "default", corpId: "ww1", corpSecret: "sec1", agentId: 1001, tools: { doc: true } },
      { accountId: "docs", corpId: "ww2", corpSecret: "sec2", agentId: 1002, tools: { doc: true } },
    ],
    normalizeAccountId,
    getWecomAccessToken: async ({ corpId }) => `${corpId}-token`,
    fetchWithRetry: async (url, options) => {
      requests.push({ url, options: { ...options, body: JSON.parse(options.body) } });
      return new Response(JSON.stringify({ errcode: 0, errmsg: "ok", docid: "doc-77", url: "https://doc/77" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });

  registerWecomDocTools({
    config: { channels: { wecom: { defaultAccount: "docs", tools: { doc: true } } } },
    logger: createLogger(),
    registerTool(tool) {
      registerCalls.push(tool);
    },
  });

  assert.equal(registerCalls.length, 1);
  const tool = registerCalls[0]({ agentAccountId: "default" });
  const result = await tool.execute("call-1", {
    action: "create",
    docName: "Quarterly Review",
  });
  assert.equal(result.details.ok, true);
  assert.equal(result.details.accountId, "default");
  assert.match(requests[0].url, /access_token=ww1-token/);
});

test("doc tool lets explicit account override context/default selection", async () => {
  const registerCalls = [];
  const requests = [];
  const registerWecomDocTools = createWecomDocToolRegistrar({
    listEnabledWecomAccounts: () => [
      { accountId: "default", corpId: "ww1", corpSecret: "sec1", agentId: 1001, tools: { doc: true } },
      { accountId: "docs", corpId: "ww2", corpSecret: "sec2", agentId: 1002, tools: { doc: true } },
    ],
    normalizeAccountId,
    getWecomAccessToken: async ({ corpId }) => `${corpId}-token`,
    fetchWithRetry: async (url) => {
      requests.push(url);
      return new Response(JSON.stringify({ errcode: 0, errmsg: "ok", docid: "doc-88", url: "https://doc/88" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });

  registerWecomDocTools({
    config: { channels: { wecom: { defaultAccount: "default", tools: { doc: true } } } },
    logger: createLogger(),
    registerTool(tool) {
      registerCalls.push(tool);
    },
  });

  const tool = registerCalls[0]({ agentAccountId: "default" });
  const result = await tool.execute("call-2", {
    action: "create",
    accountId: "docs",
    docName: "Explicit Docs Account",
  });
  assert.equal(result.details.ok, true);
  assert.equal(result.details.accountId, "docs");
  assert.ok(requests[0].includes("access_token=ww2-token"));
});

test("doc tool skips registration when globally disabled", () => {
  let registered = false;
  const registerWecomDocTools = createWecomDocToolRegistrar({
    listEnabledWecomAccounts: () => [
      { accountId: "default", corpId: "ww1", corpSecret: "sec1", agentId: 1001, tools: { doc: true } },
    ],
    normalizeAccountId,
    getWecomAccessToken: async () => "token",
    fetchWithRetry: async () => {
      throw new Error("should not call");
    },
  });

  registerWecomDocTools({
    config: { channels: { wecom: { tools: { doc: false } } } },
    logger: createLogger(),
    registerTool() {
      registered = true;
    },
  });

  assert.equal(registered, false);
});

test("doc tool returns readable error when explicit account is unavailable", async () => {
  const registerCalls = [];
  const registerWecomDocTools = createWecomDocToolRegistrar({
    listEnabledWecomAccounts: () => [
      { accountId: "default", corpId: "ww1", corpSecret: "sec1", agentId: 1001, tools: { doc: true } },
    ],
    normalizeAccountId,
    getWecomAccessToken: async () => "token",
    fetchWithRetry: async () => {
      throw new Error("should not call");
    },
  });

  registerWecomDocTools({
    config: { channels: { wecom: { tools: { doc: true } } } },
    logger: createLogger(),
    registerTool(tool) {
      registerCalls.push(tool);
    },
  });

  const tool = registerCalls[0]({});
  const result = await tool.execute("call-3", {
    action: "get_info",
    accountId: "missing",
    docId: "doc-x",
  });

  assert.equal(result.details.ok, false);
  assert.match(result.details.error, /account not found/i);
});

test("doc tool supports collect creation and form info retrieval", async () => {
  const registerCalls = [];
  const requests = [];
  const registerWecomDocTools = createWecomDocToolRegistrar({
    listEnabledWecomAccounts: () => [
      { accountId: "default", corpId: "ww1", corpSecret: "sec1", agentId: 1001, tools: { doc: true } },
    ],
    normalizeAccountId,
    getWecomAccessToken: async () => "token",
    fetchWithRetry: async (url, options) => {
      requests.push({ url, body: JSON.parse(options.body) });
      if (url.includes("/create_collect")) {
        return new Response(JSON.stringify({ errcode: 0, errmsg: "ok", formid: "form-100" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(
        JSON.stringify({
          errcode: 0,
          errmsg: "ok",
          form_info: { form_title: "报名表", question_list: [] },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    },
  });

  registerWecomDocTools({
    config: { channels: { wecom: { tools: { doc: true } } } },
    logger: createLogger(),
    registerTool(tool) {
      registerCalls.push(tool);
    },
  });

  const tool = registerCalls[0]({});
  const created = await tool.execute("call-4", {
    action: "create_collect",
    formInfo: { form_title: "报名表", question_list: [] },
  });
  const info = await tool.execute("call-5", {
    action: "get_form_info",
    formId: "form-100",
  });

  assert.equal(created.details.ok, true);
  assert.equal(created.details.formId, "form-100");
  assert.match(created.details.summary, /已创建收集表/);
  assert.equal(info.details.ok, true);
  assert.match(info.details.summary, /信息已获取/);
  assert.equal(requests.length, 2);
});

test("doc tool supports join rule updates and delete action", async () => {
  const registerCalls = [];
  const requests = [];
  const registerWecomDocTools = createWecomDocToolRegistrar({
    listEnabledWecomAccounts: () => [
      { accountId: "default", corpId: "ww1", corpSecret: "sec1", agentId: 1001, tools: { doc: true } },
    ],
    normalizeAccountId,
    getWecomAccessToken: async () => "token",
    fetchWithRetry: async (url, options) => {
      requests.push({ url, body: JSON.parse(options.body) });
      return new Response(JSON.stringify({ errcode: 0, errmsg: "ok" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });

  registerWecomDocTools({
    config: { channels: { wecom: { tools: { doc: true } } } },
    logger: createLogger(),
    registerTool(tool) {
      registerCalls.push(tool);
    },
  });

  const tool = registerCalls[0]({});
  const updated = await tool.execute("call-6", {
    action: "set_join_rule",
    docId: "doc-join-2",
    request: { enable_corp_internal: true },
  });
  const deleted = await tool.execute("call-7", {
    action: "delete",
    docId: "doc-join-2",
  });

  assert.equal(updated.details.ok, true);
  assert.match(updated.details.summary, /查看规则已更新/);
  assert.equal(deleted.details.ok, true);
  assert.match(deleted.details.summary, /已删除/);
  assert.deepEqual(requests[0].body, { enable_corp_internal: true, docid: "doc-join-2" });
  assert.deepEqual(requests[1].body, { docid: "doc-join-2" });
});

test("doc tool diagnose_auth returns readable diagnosis", async () => {
  const registerCalls = [];
  const registerWecomDocTools = createWecomDocToolRegistrar({
    listEnabledWecomAccounts: () => [
      { accountId: "default", corpId: "ww1", corpSecret: "sec1", agentId: 1001, tools: { doc: true } },
    ],
    normalizeAccountId,
    getWecomAccessToken: async () => "token",
    fetchWithRetry: async () =>
      new Response(
        JSON.stringify({
          errcode: 0,
          errmsg: "ok",
          access_rule: {
            enable_corp_internal: true,
            enable_corp_external: false,
            ban_share_external: true,
          },
          doc_member_list: [{ userid: "alice" }],
          co_auth_list: [{ userid: "dingxiang" }],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
  });

  registerWecomDocTools({
    config: { channels: { wecom: { tools: { doc: true } } } },
    logger: createLogger(),
    registerTool(tool) {
      registerCalls.push(tool);
    },
  });

  const tool = registerCalls[0]({ requesterSenderId: "dingxiang" });
  const result = await tool.execute("call-auth-1", {
    action: "diagnose_auth",
    docId: "doc-auth-1",
  });

  assert.equal(result.details.ok, true);
  assert.equal(result.details.diagnosis.internalAccessEnabled, true);
  assert.equal(result.details.diagnosis.externalAccessEnabled, false);
  assert.equal(result.details.diagnosis.externalShareAllowed, false);
  assert.equal(result.details.diagnosis.requesterRole, "collaborator");
  assert.equal(result.details.diagnosis.likelyAnonymousLinkFailure, true);
  assert.match(result.details.summary, /企业内访问：开启/);
  assert.match(result.details.summary, /企业外访问：关闭/);
});

test("doc tool validate_share_link diagnoses guest blankpage", async () => {
  const registerCalls = [];
  const html =
    '<!doctype html><script>window.basicClientVars={"userInfo":{"loginType":0,"userType":"guest"},"docInfo":{"padInfo":{"padId":"e3AF","padTitle":"","padType":"blankpage"},"ownerInfo":{},"shareInfo":{},"aclInfo":{}}};</script>';
  const registerWecomDocTools = createWecomDocToolRegistrar({
    listEnabledWecomAccounts: () => [
      { accountId: "default", corpId: "ww1", corpSecret: "sec1", agentId: 1001, tools: { doc: true } },
    ],
    normalizeAccountId,
    getWecomAccessToken: async () => "token",
    fetchWithRetry: async () => {
      throw new Error("should not call WeCom API");
    },
    fetchImpl: async () =>
      new Response(html, {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      }),
  });

  registerWecomDocTools({
    config: { channels: { wecom: { tools: { doc: true } } } },
    logger: createLogger(),
    registerTool(tool) {
      registerCalls.push(tool);
    },
  });

  const tool = registerCalls[0]({});
  const result = await tool.execute("call-share-1", {
    action: "validate_share_link",
    shareUrl: "https://doc.weixin.qq.com/sheet/e3AF?scode=abc",
  });

  assert.equal(result.details.ok, true);
  assert.equal(result.details.diagnosis.isGuest, true);
  assert.equal(result.details.diagnosis.padType, "blankpage");
  assert.equal(result.details.diagnosis.pathResourceType, "sheet");
  assert.equal(result.details.diagnosis.pathResourceId, "e3AF");
  assert.equal(result.details.diagnosis.shareCode, "abc");
  assert.equal(result.details.diagnosis.likelyUnavailableToGuest, true);
  assert.match(result.details.summary, /访问身份：guest/);
  assert.match(result.details.summary, /页面类型：blankpage/);
});

test("doc tool create can immediately grant viewer/collaborator access", async () => {
  const registerCalls = [];
  const requests = [];
  const registerWecomDocTools = createWecomDocToolRegistrar({
    listEnabledWecomAccounts: () => [
      { accountId: "default", corpId: "ww1", corpSecret: "sec1", agentId: 1001, tools: { doc: true } },
    ],
    normalizeAccountId,
    getWecomAccessToken: async () => "token",
    fetchWithRetry: async (url, options) => {
      requests.push({ url, body: JSON.parse(options.body) });
      if (url.includes("/create_doc")) {
        return new Response(JSON.stringify({ errcode: 0, errmsg: "ok", docid: "doc-access-9", url: "https://doc/9" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ errcode: 0, errmsg: "ok" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });

  registerWecomDocTools({
    config: { channels: { wecom: { tools: { doc: true } } } },
    logger: createLogger(),
    registerTool(tool) {
      registerCalls.push(tool);
    },
  });

  const tool = registerCalls[0]({});
  const result = await tool.execute("call-8", {
    action: "create",
    docName: "可访问文档",
    viewers: ["alice"],
    collaborators: ["bob"],
  });

  assert.equal(result.details.ok, true);
  assert.match(result.details.summary, /权限已更新/);
  assert.match(result.details.summary, /docId: doc-access-9/);
  assert.equal(result.details.canonicalDocId, "doc-access-9");
  assert.equal(requests.length, 2);
  assert.ok(requests[0].url.includes("/create_doc"));
  assert.deepEqual(requests[1].body, {
    docid: "doc-access-9",
    update_doc_member_list: [{ userid: "alice" }],
    update_co_auth_list: [{ userid: "bob" }],
  });
});

test("doc tool create auto-adds requester sender as collaborator by default", async () => {
  const registerCalls = [];
  const requests = [];
  const registerWecomDocTools = createWecomDocToolRegistrar({
    listEnabledWecomAccounts: () => [
      { accountId: "default", corpId: "ww1", corpSecret: "sec1", agentId: 1001, tools: { doc: true } },
    ],
    normalizeAccountId,
    getWecomAccessToken: async () => "token",
    fetchWithRetry: async (url, options) => {
      requests.push({ url, body: JSON.parse(options.body) });
      if (url.includes("/create_doc")) {
        return new Response(JSON.stringify({ errcode: 0, errmsg: "ok", docid: "doc-auto-1", url: "https://doc/auto-1" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ errcode: 0, errmsg: "ok" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });

  registerWecomDocTools({
    config: { channels: { wecom: { tools: { doc: true } } } },
    logger: createLogger(),
    registerTool(tool) {
      registerCalls.push(tool);
    },
  });

  const tool = registerCalls[0]({ requesterSenderId: "dingxiang" });
  const result = await tool.execute("call-11", {
    action: "create",
    docName: "自动加协作者",
  });

  assert.equal(result.details.ok, true);
  assert.match(result.details.summary, /新增协作者 1/);
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[1].body, {
    docid: "doc-auto-1",
    update_co_auth_list: [{ userid: "dingxiang" }],
  });
});

test("doc tool create skips requester auto-grant when disabled", async () => {
  const registerCalls = [];
  const requests = [];
  const registerWecomDocTools = createWecomDocToolRegistrar({
    listEnabledWecomAccounts: () => [
      { accountId: "default", corpId: "ww1", corpSecret: "sec1", agentId: 1001, tools: { doc: true } },
    ],
    normalizeAccountId,
    getWecomAccessToken: async () => "token",
    fetchWithRetry: async (url, options) => {
      requests.push({ url, body: JSON.parse(options.body) });
      return new Response(JSON.stringify({ errcode: 0, errmsg: "ok", docid: "doc-auto-2", url: "https://doc/auto-2" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });

  registerWecomDocTools({
    config: { channels: { wecom: { tools: { doc: true, docAutoGrantRequesterCollaborator: false } } } },
    logger: createLogger(),
    registerTool(tool) {
      registerCalls.push(tool);
    },
  });

  const tool = registerCalls[0]({ requesterSenderId: "dingxiang" });
  const result = await tool.execute("call-12", {
    action: "create",
    docName: "关闭自动授权",
  });

  assert.equal(result.details.ok, true);
  assert.equal(requests.length, 1);
  assert.doesNotMatch(result.details.summary, /新增协作者/);
});

test("doc tool supports grant_access and add_collaborators", async () => {
  const registerCalls = [];
  const requests = [];
  const registerWecomDocTools = createWecomDocToolRegistrar({
    listEnabledWecomAccounts: () => [
      { accountId: "default", corpId: "ww1", corpSecret: "sec1", agentId: 1001, tools: { doc: true } },
    ],
    normalizeAccountId,
    getWecomAccessToken: async () => "token",
    fetchWithRetry: async (url, options) => {
      requests.push({ url, body: JSON.parse(options.body) });
      return new Response(JSON.stringify({ errcode: 0, errmsg: "ok" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });

  registerWecomDocTools({
    config: { channels: { wecom: { tools: { doc: true } } } },
    logger: createLogger(),
    registerTool(tool) {
      registerCalls.push(tool);
    },
  });

  const tool = registerCalls[0]({});
  const granted = await tool.execute("call-9", {
    action: "grant_access",
    docId: "doc-grant-1",
    viewers: ["alice"],
    collaborators: ["bob"],
    removeCollaborators: ["carol"],
  });
  const added = await tool.execute("call-10", {
    action: "add_collaborators",
    docId: "doc-grant-1",
    collaborators: ["dave", "erin"],
  });

  assert.equal(granted.details.ok, true);
  assert.match(granted.details.summary, /新增查看成员 1/);
  assert.match(granted.details.summary, /新增协作者 1/);
  assert.match(granted.details.summary, /移除协作者 1/);
  assert.equal(added.details.ok, true);
  assert.match(added.details.summary, /协作者已添加：2/);
  assert.deepEqual(requests[0].body, {
    docid: "doc-grant-1",
    update_doc_member_list: [{ userid: "alice" }],
    update_co_auth_list: [{ userid: "bob" }],
    del_co_auth_list: [{ userid: "carol" }],
  });
  assert.deepEqual(requests[1].body, {
    docid: "doc-grant-1",
    update_co_auth_list: [{ userid: "dave" }, { userid: "erin" }],
  });
});
