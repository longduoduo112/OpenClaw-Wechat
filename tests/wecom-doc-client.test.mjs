import assert from "node:assert/strict";
import test from "node:test";

import { createWecomDocClient } from "../src/wecom/doc-client.js";

function createJsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("doc client createDoc builds official create_doc payload", async () => {
  const requests = [];
  const client = createWecomDocClient({
    getWecomAccessToken: async () => "token-1",
    fetchWithRetry: async (url, options) => {
      requests.push({ url, options: { ...options, body: JSON.parse(options.body) } });
      return createJsonResponse({ errcode: 0, errmsg: "ok", docid: "doc-1", url: "https://doc" });
    },
  });

  const result = await client.createDoc({
    account: { corpId: "ww1", corpSecret: "sec", logger: null, outboundProxy: "" },
    docName: "Roadmap",
    docType: "spreadsheet",
    spaceId: "space-1",
    fatherId: "folder-1",
    adminUsers: ["alice", "bob"],
  });

  assert.equal(requests.length, 1);
  assert.match(requests[0].url, /\/cgi-bin\/wedoc\/create_doc\?access_token=token-1$/);
  assert.deepEqual(requests[0].options.body, {
    doc_type: 4,
    doc_name: "Roadmap",
    spaceid: "space-1",
    fatherid: "folder-1",
    admin_users: ["alice", "bob"],
  });
  assert.equal(result.docId, "doc-1");
  assert.equal(result.docTypeLabel, "spreadsheet");
});

test("doc client maps get_doc_base_info and get_sheet_properties", async () => {
  const urls = [];
  const client = createWecomDocClient({
    getWecomAccessToken: async () => "token-2",
    fetchWithRetry: async (url) => {
      urls.push(url);
      if (url.includes("get_doc_base_info")) {
        return createJsonResponse({
          errcode: 0,
          errmsg: "ok",
          doc_base_info: { docid: "doc-2", doc_name: "Spec", doc_type: 3 },
        });
      }
      return createJsonResponse({
        errcode: 0,
        errmsg: "ok",
        properties: [{ sheet_id: "s1", title: "Sheet1" }],
      });
    },
  });

  const info = await client.getDocBaseInfo({
    account: { corpId: "ww1", corpSecret: "sec", logger: null, outboundProxy: "" },
    docId: "doc-2",
  });
  const sheet = await client.getSheetProperties({
    account: { corpId: "ww1", corpSecret: "sec", logger: null, outboundProxy: "" },
    docId: "doc-3",
  });

  assert.equal(info.info.doc_name, "Spec");
  assert.equal(sheet.properties.length, 1);
  assert.ok(urls.some((url) => url.includes("/cgi-bin/wedoc/get_doc_base_info")));
  assert.ok(urls.some((url) => url.includes("/cgi-bin/wedoc/spreadsheet/get_sheet_properties")));
});

test("doc client surfaces WeCom API errors", async () => {
  const client = createWecomDocClient({
    getWecomAccessToken: async () => "token-3",
    fetchWithRetry: async () =>
      createJsonResponse({ errcode: 60011, errmsg: "no privilege" }),
  });

  await assert.rejects(
    () =>
      client.shareDoc({
        account: { corpId: "ww1", corpSecret: "sec", logger: null, outboundProxy: "" },
        docId: "doc-9",
      }),
    /no privilege/,
  );
});

test("doc client supports delete_doc and collect APIs", async () => {
  const requests = [];
  const client = createWecomDocClient({
    getWecomAccessToken: async () => "token-4",
    fetchWithRetry: async (url, options) => {
      const body = JSON.parse(options.body);
      requests.push({ url, body });
      if (url.includes("/cgi-bin/wedoc/del_doc")) {
        return createJsonResponse({ errcode: 0, errmsg: "ok" });
      }
      if (url.includes("/cgi-bin/wedoc/create_collect")) {
        return createJsonResponse({ errcode: 0, errmsg: "ok", formid: "form-9" });
      }
      return createJsonResponse([
        { errcode: 0, errmsg: "ok", formid: "form-9", question_id: 1, question_type: 1, statistics: [] },
      ]);
    },
  });

  const account = { corpId: "ww1", corpSecret: "sec", logger: null, outboundProxy: "" };
  const deleted = await client.deleteDoc({ account, docId: "doc-del-1" });
  const created = await client.createCollect({
    account,
    formInfo: { form_title: "报名表", question_list: [] },
    spaceId: "space-collect",
  });
  const stats = await client.getFormStatistic({
    account,
    requests: [{ formid: "form-9", question_id: 1, question_type: 1 }],
  });

  assert.equal(deleted.docId, "doc-del-1");
  assert.equal(created.formId, "form-9");
  assert.equal(stats.items.length, 1);
  assert.match(requests[0].url, /\/cgi-bin\/wedoc\/del_doc\?/);
  assert.deepEqual(requests[0].body, { docid: "doc-del-1" });
  assert.match(requests[1].url, /\/cgi-bin\/wedoc\/create_collect\?/);
  assert.deepEqual(requests[1].body, {
    form_info: { form_title: "报名表", question_list: [] },
    spaceid: "space-collect",
  });
  assert.match(requests[2].url, /\/cgi-bin\/wedoc\/get_form_statistic\?/);
});

test("doc client merges docid for join rule/member/safety mutations", async () => {
  const requests = [];
  const client = createWecomDocClient({
    getWecomAccessToken: async () => "token-5",
    fetchWithRetry: async (url, options) => {
      requests.push({ url, body: JSON.parse(options.body) });
      return createJsonResponse({ errcode: 0, errmsg: "ok" });
    },
  });

  const account = { corpId: "ww1", corpSecret: "sec", logger: null, outboundProxy: "" };
  await client.setDocJoinRule({
    account,
    docId: "doc-join-1",
    request: { enable_corp_internal: true },
  });
  await client.setDocMemberAuth({
    account,
    docId: "doc-member-1",
    request: { update_doc_member_list: [{ userid: "alice" }] },
  });
  await client.setDocSafetySetting({
    account,
    docId: "doc-safe-1",
    request: { enable_readonly_copy: true },
  });

  assert.deepEqual(requests[0].body, { enable_corp_internal: true, docid: "doc-join-1" });
  assert.deepEqual(requests[1].body, {
    update_doc_member_list: [{ userid: "alice" }],
    docid: "doc-member-1",
  });
  assert.deepEqual(requests[2].body, { enable_readonly_copy: true, docid: "doc-safe-1" });
  assert.ok(requests[0].url.includes("/cgi-bin/wedoc/mod_doc_join_rule"));
  assert.ok(requests[1].url.includes("/cgi-bin/wedoc/mod_doc_member"));
  assert.ok(requests[2].url.includes("/cgi-bin/wedoc/mod_doc_safty_setting"));
});

test("doc client grantDocAccess normalizes viewer and collaborator lists", async () => {
  const requests = [];
  const client = createWecomDocClient({
    getWecomAccessToken: async () => "token-6",
    fetchWithRetry: async (url, options) => {
      requests.push({ url, body: JSON.parse(options.body) });
      return createJsonResponse({ errcode: 0, errmsg: "ok" });
    },
  });

  const account = { corpId: "ww1", corpSecret: "sec", logger: null, outboundProxy: "" };
  const result = await client.grantDocAccess({
    account,
    docId: "doc-access-1",
    viewers: ["alice", { userid: "bob" }],
    collaborators: [{ userId: "carol" }],
    removeCollaborators: ["dave"],
  });

  assert.equal(result.addedViewerCount, 2);
  assert.equal(result.addedCollaboratorCount, 1);
  assert.equal(result.removedCollaboratorCount, 1);
  assert.deepEqual(requests[0].body, {
    docid: "doc-access-1",
    update_doc_member_list: [{ userid: "alice" }, { userid: "bob" }],
    update_co_auth_list: [{ userid: "carol" }],
    del_co_auth_list: [{ userid: "dave" }],
  });
  assert.ok(requests[0].url.includes("/cgi-bin/wedoc/mod_doc_member"));
});
