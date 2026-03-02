import { normalizePluginHttpPath } from "openclaw/plugin-sdk";

function asNumber(v, fallback = null) {
  if (v == null) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function createRequireEnv(processEnv) {
  return function requireEnv(name, fallback) {
    const v = processEnv?.[name];
    if (v == null || v === "") return fallback;
    return v;
  };
}

export function createWecomAccountRegistry({
  normalizeWecomWebhookTargetMap,
  resolveWecomProxyConfig,
  processEnv = process.env,
} = {}) {
  if (typeof normalizeWecomWebhookTargetMap !== "function") {
    throw new Error("createWecomAccountRegistry requires normalizeWecomWebhookTargetMap");
  }
  if (typeof resolveWecomProxyConfig !== "function") {
    throw new Error("createWecomAccountRegistry requires resolveWecomProxyConfig");
  }

  const requireEnv = createRequireEnv(processEnv);
  const wecomAccounts = new Map();
  let defaultAccountId = "default";

  function normalizeAccountId(accountId) {
    const normalized = String(accountId ?? "default").trim().toLowerCase();
    return normalized || "default";
  }

  function normalizeAccountConfig(raw, accountId) {
    const normalizedId = normalizeAccountId(accountId);
    if (!raw || typeof raw !== "object") return null;

    const corpId = String(raw.corpId ?? "").trim();
    const corpSecret = String(raw.corpSecret ?? "").trim();
    const agentId = asNumber(raw.agentId);
    const callbackToken = String(raw.callbackToken ?? "").trim();
    const callbackAesKey = String(raw.callbackAesKey ?? "").trim();
    const webhookPath = String(raw.webhookPath ?? "/wecom/callback").trim() || "/wecom/callback";
    const outboundProxy = String(raw.outboundProxy ?? raw.proxyUrl ?? raw.proxy ?? "").trim();
    const webhooks = normalizeWecomWebhookTargetMap(raw.webhooks);
    const allowFrom = raw.allowFrom;
    const allowFromRejectMessage = String(
      raw.allowFromRejectMessage ?? raw.rejectUnauthorizedMessage ?? "",
    ).trim();

    if (!corpId || !corpSecret || !agentId) {
      return null;
    }

    return {
      accountId: normalizedId,
      corpId,
      corpSecret,
      agentId,
      callbackToken,
      callbackAesKey,
      webhookPath,
      outboundProxy: outboundProxy || undefined,
      webhooks: Object.keys(webhooks).length > 0 ? webhooks : undefined,
      allowFrom,
      allowFromRejectMessage: allowFromRejectMessage || undefined,
      enabled: raw.enabled !== false,
    };
  }

  function readAccountConfigFromEnv({ envVars, accountId }) {
    const normalizedId = normalizeAccountId(accountId);
    const prefix = normalizedId === "default" ? "WECOM" : `WECOM_${normalizedId.toUpperCase()}`;

    const readVar = (suffix) =>
      envVars?.[`${prefix}_${suffix}`] ??
      (normalizedId === "default" ? envVars?.[`WECOM_${suffix}`] : undefined) ??
      requireEnv(`${prefix}_${suffix}`) ??
      (normalizedId === "default" ? requireEnv(`WECOM_${suffix}`) : undefined);

    const corpId = String(readVar("CORP_ID") ?? "").trim();
    const corpSecret = String(readVar("CORP_SECRET") ?? "").trim();
    const agentId = asNumber(readVar("AGENT_ID"));
    const callbackToken = String(readVar("CALLBACK_TOKEN") ?? "").trim();
    const callbackAesKey = String(readVar("CALLBACK_AES_KEY") ?? "").trim();
    const webhookPath = String(readVar("WEBHOOK_PATH") ?? "/wecom/callback").trim() || "/wecom/callback";
    const outboundProxyRaw =
      readVar("PROXY") ??
      (normalizedId === "default"
        ? requireEnv("HTTPS_PROXY")
        : envVars?.WECOM_PROXY ?? requireEnv("WECOM_PROXY") ?? requireEnv("HTTPS_PROXY"));
    const outboundProxy = String(outboundProxyRaw ?? "").trim();
    const webhooks = normalizeWecomWebhookTargetMap(readVar("WEBHOOK_TARGETS"), readVar("WEBHOOKS"));
    const allowFrom = readVar("ALLOW_FROM");
    const allowFromRejectMessage = String(readVar("ALLOW_FROM_REJECT_MESSAGE") ?? "").trim();
    const enabledRaw = String(readVar("ENABLED") ?? "").trim().toLowerCase();
    const enabled = !["0", "false", "off", "no"].includes(enabledRaw);

    if (!corpId || !corpSecret || !agentId) return null;

    return {
      accountId: normalizedId,
      corpId,
      corpSecret,
      agentId,
      callbackToken,
      callbackAesKey,
      webhookPath,
      outboundProxy: outboundProxy || undefined,
      webhooks: Object.keys(webhooks).length > 0 ? webhooks : undefined,
      allowFrom,
      allowFromRejectMessage: allowFromRejectMessage || undefined,
      enabled,
    };
  }

  function rebuildWecomAccounts({ api, gatewayRuntime } = {}) {
    const cfg = api?.config ?? gatewayRuntime?.config ?? {};
    const channelConfig = cfg?.channels?.wecom;
    const envVars = cfg?.env?.vars ?? {};
    const globalWebhookTargets = normalizeWecomWebhookTargetMap(
      channelConfig?.webhooks,
      envVars?.WECOM_WEBHOOK_TARGETS,
      processEnv.WECOM_WEBHOOK_TARGETS,
    );
    const resolved = new Map();

    const upsert = (accountId, rawConfig) => {
      const normalized = normalizeAccountConfig(rawConfig, accountId);
      if (!normalized) return;
      resolved.set(normalized.accountId, normalized);
    };

    if (channelConfig && typeof channelConfig === "object") {
      upsert("default", channelConfig);
    }

    const channelAccounts = channelConfig?.accounts;
    if (channelAccounts && typeof channelAccounts === "object") {
      for (const [accountId, accountConfig] of Object.entries(channelAccounts)) {
        upsert(accountId, accountConfig);
      }
    }

    const envAccountIds = new Set(["default"]);
    for (const key of Object.keys(envVars)) {
      const m = key.match(/^WECOM_([A-Z0-9]+)_CORP_ID$/);
      if (m && m[1] !== "CORP") envAccountIds.add(m[1].toLowerCase());
    }
    for (const key of Object.keys(processEnv)) {
      const m = key.match(/^WECOM_([A-Z0-9]+)_CORP_ID$/);
      if (m && m[1] !== "CORP") envAccountIds.add(m[1].toLowerCase());
    }
    for (const accountId of envAccountIds) {
      if (resolved.has(normalizeAccountId(accountId))) continue;
      const envConfig = readAccountConfigFromEnv({ envVars, accountId });
      if (envConfig) resolved.set(envConfig.accountId, envConfig);
    }

    for (const [accountId, config] of resolved.entries()) {
      const mergedWebhookTargets = {
        ...globalWebhookTargets,
        ...normalizeWecomWebhookTargetMap(config?.webhooks),
      };
      config.webhooks = Object.keys(mergedWebhookTargets).length > 0 ? mergedWebhookTargets : undefined;
      config.outboundProxy = resolveWecomProxyConfig({
        channelConfig,
        accountConfig: config,
        envVars,
        processEnv,
        accountId,
      });
    }

    wecomAccounts.clear();
    for (const [accountId, config] of resolved) {
      wecomAccounts.set(accountId, config);
    }

    defaultAccountId = wecomAccounts.has("default")
      ? "default"
      : (Array.from(wecomAccounts.keys())[0] ?? "default");

    return wecomAccounts;
  }

  function getWecomConfig({ api, gatewayRuntime, accountId = null } = {}) {
    const accountMap = rebuildWecomAccounts({ api, gatewayRuntime });
    const targetAccountId = normalizeAccountId(accountId ?? defaultAccountId);

    if (accountMap.has(targetAccountId)) {
      return accountMap.get(targetAccountId);
    }

    if (targetAccountId !== "default" && accountMap.has("default")) {
      return accountMap.get("default");
    }

    return accountMap.values().next().value ?? null;
  }

  function listWecomAccountIds({ api, gatewayRuntime } = {}) {
    return Array.from(rebuildWecomAccounts({ api, gatewayRuntime }).keys());
  }

  function listEnabledWecomAccounts({ api, gatewayRuntime } = {}) {
    return Array.from(rebuildWecomAccounts({ api, gatewayRuntime }).values()).filter((cfg) => cfg?.enabled !== false);
  }

  function listWebhookTargetAliases(accountConfig) {
    const map = accountConfig?.webhooks;
    if (!map || typeof map !== "object") return [];
    const aliases = Object.keys(map)
      .map((item) => String(item ?? "").trim())
      .filter(Boolean);
    aliases.sort();
    return aliases;
  }

  function listAllWebhookTargetAliases({ api, gatewayRuntime } = {}) {
    const aliases = new Set();
    for (const account of listEnabledWecomAccounts({ api, gatewayRuntime })) {
      for (const alias of listWebhookTargetAliases(account)) {
        aliases.add(alias);
      }
    }
    return Array.from(aliases).sort();
  }

  function groupAccountsByWebhookPath({ api, gatewayRuntime } = {}) {
    const grouped = new Map();
    for (const account of listEnabledWecomAccounts({ api, gatewayRuntime })) {
      const normalizedPath =
        normalizePluginHttpPath(account.webhookPath ?? "/wecom/callback", "/wecom/callback") ?? "/wecom/callback";
      const existing = grouped.get(normalizedPath);
      if (existing) existing.push(account);
      else grouped.set(normalizedPath, [account]);
    }
    return grouped;
  }

  return {
    normalizeAccountId,
    rebuildWecomAccounts,
    getWecomConfig,
    listWecomAccountIds,
    listEnabledWecomAccounts,
    listWebhookTargetAliases,
    listAllWebhookTargetAliases,
    groupAccountsByWebhookPath,
  };
}
