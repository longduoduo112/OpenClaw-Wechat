import assert from "node:assert/strict";
import test from "node:test";

import { normalizeAccountConfig, readAccountConfigFromEnv } from "../src/wecom/account-config-core.js";

function normalizeWecomWebhookTargetMap(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  return { ...input };
}

test("normalizeAccountConfig supports legacy token/encodingAesKey keys", () => {
  const normalized = normalizeAccountConfig({
    raw: {
      corpId: "ww_test",
      corpSecret: "secret",
      agentId: 1000001,
      token: "legacy-token",
      encodingAesKey: "legacy-aes",
    },
    accountId: "default",
    normalizeWecomWebhookTargetMap,
  });

  assert.equal(normalized.callbackToken, "legacy-token");
  assert.equal(normalized.callbackAesKey, "legacy-aes");
});

test("normalizeAccountConfig prefers callbackToken/callbackAesKey over legacy keys", () => {
  const normalized = normalizeAccountConfig({
    raw: {
      corpId: "ww_test",
      corpSecret: "secret",
      agentId: 1000001,
      callbackToken: "new-token",
      callbackAesKey: "new-aes",
      token: "legacy-token",
      encodingAesKey: "legacy-aes",
    },
    accountId: "default",
    normalizeWecomWebhookTargetMap,
  });

  assert.equal(normalized.callbackToken, "new-token");
  assert.equal(normalized.callbackAesKey, "new-aes");
});

test("readAccountConfigFromEnv supports legacy default env vars", () => {
  const processEnvStub = {
    WECOM_CORP_ID: "ww_env",
    WECOM_CORP_SECRET: "env-secret",
    WECOM_AGENT_ID: "1000002",
    WECOM_TOKEN: "legacy-token",
    WECOM_ENCODING_AES_KEY: "legacy-aes",
  };

  const normalized = readAccountConfigFromEnv({
    envVars: {},
    accountId: "default",
    requireEnv: (name) => processEnvStub[name],
    normalizeWecomWebhookTargetMap,
  });

  assert.equal(normalized.callbackToken, "legacy-token");
  assert.equal(normalized.callbackAesKey, "legacy-aes");
});

test("readAccountConfigFromEnv supports legacy scoped env vars", () => {
  const processEnvStub = {
    WECOM_BETA_CORP_ID: "ww_beta",
    WECOM_BETA_CORP_SECRET: "beta-secret",
    WECOM_BETA_AGENT_ID: "1000003",
    WECOM_BETA_TOKEN: "beta-legacy-token",
    WECOM_BETA_ENCODING_AES_KEY: "beta-legacy-aes",
  };

  const normalized = readAccountConfigFromEnv({
    envVars: {},
    accountId: "beta",
    requireEnv: (name) => processEnvStub[name],
    normalizeWecomWebhookTargetMap,
  });

  assert.equal(normalized.callbackToken, "beta-legacy-token");
  assert.equal(normalized.callbackAesKey, "beta-legacy-aes");
});
