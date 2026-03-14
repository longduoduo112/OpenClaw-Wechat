import { normalizeWecomAllowFromEntry } from "../core.js";

function normalizeAccountId(accountId) {
  const normalized = String(accountId ?? "default").trim().toLowerCase();
  return normalized || "default";
}

function uniqueAllowFrom(values = []) {
  const out = [];
  const seen = new Set();
  for (const value of Array.isArray(values) ? values : []) {
    const normalized = normalizeWecomAllowFromEntry(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function getPairingRuntime(api) {
  const pairing = api?.runtime?.channel?.pairing;
  if (!pairing || typeof pairing !== "object") return null;
  if (typeof pairing.readAllowFromStore !== "function") return null;
  if (typeof pairing.upsertPairingRequest !== "function") return null;
  if (typeof pairing.buildPairingReply !== "function") return null;
  return pairing;
}

function matchesAllowFrom({ allowFrom = [], senderId = "", isWecomSenderAllowed } = {}) {
  const normalizedAllowFrom = Array.isArray(allowFrom) ? allowFrom : [];
  if (normalizedAllowFrom.includes("*")) return true;
  if (typeof isWecomSenderAllowed !== "function") return false;
  return isWecomSenderAllowed({
    senderId,
    allowFrom: normalizedAllowFrom,
  });
}

export async function readWecomPairingAllowFromStore({ api, accountId = "default" } = {}) {
  const pairing = getPairingRuntime(api);
  if (!pairing) return [];
  try {
    const storeEntries = await pairing.readAllowFromStore({
      channel: "wecom",
      accountId: normalizeAccountId(accountId),
    });
    return uniqueAllowFrom(storeEntries);
  } catch (err) {
    api?.logger?.warn?.(`wecom: failed to read pairing store: ${String(err?.message || err)}`);
    return [];
  }
}

export async function resolveWecomDirectMessageAccess({
  api,
  accountId = "default",
  dmPolicy = {},
  allowFromPolicy = {},
  normalizedFromUser = "",
  isAdminUser = false,
  isWecomSenderAllowed,
} = {}) {
  const mode = String(dmPolicy?.mode ?? "open").trim().toLowerCase() || "open";
  const normalizedSender = normalizeWecomAllowFromEntry(normalizedFromUser);
  const configuredAllowFrom = uniqueAllowFrom(dmPolicy?.allowFrom);
  const baseAllowFrom = Array.isArray(allowFromPolicy?.allowFrom) ? allowFromPolicy.allowFrom : [];
  const senderAllowedByBasePolicy =
    isAdminUser ||
    matchesAllowFrom({
      senderId: normalizedSender,
      allowFrom: baseAllowFrom,
      isWecomSenderAllowed,
    });

  if (mode === "deny") {
    return {
      decision: "block",
      reason: "dm-deny",
      rejectText: dmPolicy?.rejectMessage || "当前渠道私聊已关闭，请联系管理员。",
      configuredAllowFrom,
      effectiveAllowFrom: configuredAllowFrom,
      storeAllowFrom: [],
    };
  }

  if (mode === "open") {
    return {
      decision: senderAllowedByBasePolicy ? "allow" : "block",
      reason: senderAllowedByBasePolicy ? "dm-open" : "allowFrom",
      rejectText: senderAllowedByBasePolicy
        ? ""
        : allowFromPolicy?.rejectMessage || "当前账号未授权，请联系管理员。",
      configuredAllowFrom,
      effectiveAllowFrom: configuredAllowFrom,
      storeAllowFrom: [],
    };
  }

  if (mode === "allowlist") {
    const allowed =
      isAdminUser ||
      matchesAllowFrom({
        senderId: normalizedSender,
        allowFrom: configuredAllowFrom,
        isWecomSenderAllowed,
      });
    return {
      decision: senderAllowedByBasePolicy && allowed ? "allow" : "block",
      reason: !senderAllowedByBasePolicy ? "allowFrom" : allowed ? "dm-allowlist" : "dm-allowlist-blocked",
      rejectText: !senderAllowedByBasePolicy
        ? allowFromPolicy?.rejectMessage || "当前账号未授权，请联系管理员。"
        : dmPolicy?.rejectMessage || "当前私聊账号未授权，请联系管理员。",
      configuredAllowFrom,
      effectiveAllowFrom: configuredAllowFrom,
      storeAllowFrom: [],
    };
  }

  if (!senderAllowedByBasePolicy) {
    return {
      decision: "block",
      reason: "allowFrom",
      rejectText: allowFromPolicy?.rejectMessage || "当前账号未授权，请联系管理员。",
      configuredAllowFrom,
      effectiveAllowFrom: configuredAllowFrom,
      storeAllowFrom: [],
    };
  }

  const storeAllowFrom = await readWecomPairingAllowFromStore({
    api,
    accountId,
  });
  const effectiveAllowFrom = uniqueAllowFrom([...configuredAllowFrom, ...storeAllowFrom]);
  const allowed =
    isAdminUser ||
    matchesAllowFrom({
      senderId: normalizedSender,
      allowFrom: effectiveAllowFrom,
      isWecomSenderAllowed,
    });
  return {
    decision: allowed ? "allow" : "pairing",
    reason: allowed ? "dm-pairing-approved" : "dm-pairing",
    rejectText: allowed ? "" : dmPolicy?.rejectMessage || "当前私聊需先完成配对审批。",
    configuredAllowFrom,
    effectiveAllowFrom,
    storeAllowFrom,
  };
}

export async function issueWecomPairingChallenge({
  api,
  accountId = "default",
  fromUser = "",
  normalizedFromUser = "",
  sendPairingReply,
} = {}) {
  const pairing = getPairingRuntime(api);
  const senderId = normalizeWecomAllowFromEntry(normalizedFromUser || fromUser);
  if (!pairing || !senderId || typeof sendPairingReply !== "function") {
    return { created: false, unsupported: true };
  }

  const { code, created } = await pairing.upsertPairingRequest({
    channel: "wecom",
    accountId: normalizeAccountId(accountId),
    id: senderId,
    meta: {
      name: String(fromUser ?? "").trim() || undefined,
    },
  });
  if (!created) {
    return { created: false, code };
  }

  const replyText = pairing.buildPairingReply({
    channel: "wecom",
    idLine: `Your WeCom user id: ${senderId}`,
    code,
  });
  try {
    await sendPairingReply(replyText);
  } catch (err) {
    api?.logger?.warn?.(`wecom: pairing reply failed: ${String(err?.message || err)}`);
  }
  return { created: true, code, replyText };
}
