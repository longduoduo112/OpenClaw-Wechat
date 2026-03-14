export function createWecomTargetResolver({ resolveWecomTarget } = {}) {
  if (typeof resolveWecomTarget !== "function") {
    throw new Error("createWecomTargetResolver: resolveWecomTarget is required");
  }

  function readString(value) {
    return String(value ?? "").trim();
  }

  function pickFirstString(...values) {
    for (const value of values) {
      const normalized = readString(value);
      if (normalized) return normalized;
    }
    return "";
  }

  function normalizeWecomResolvedTarget(rawTarget) {
    if (rawTarget && typeof rawTarget === "object") {
      const toUser = pickFirstString(
        rawTarget.toUser,
        rawTarget.userId,
        rawTarget.userid,
        rawTarget.user,
        rawTarget.username,
      );
      const toParty = pickFirstString(
        rawTarget.toParty,
        rawTarget.partyId,
        rawTarget.partyid,
        rawTarget.deptId,
        rawTarget.deptid,
        rawTarget.departmentId,
      );
      const toTag = pickFirstString(rawTarget.toTag, rawTarget.tagId, rawTarget.tagid);
      const chatId = pickFirstString(rawTarget.chatId, rawTarget.chatid, rawTarget.groupId, rawTarget.groupid);
      const webhook = pickFirstString(rawTarget.webhook, rawTarget.webhookId, rawTarget.webhookTarget);
      if (toUser || toParty || toTag || chatId || webhook) {
        return {
          ...(toUser ? { toUser } : {}),
          ...(toParty ? { toParty } : {}),
          ...(toTag ? { toTag } : {}),
          ...(chatId ? { chatId } : {}),
          ...(webhook ? { webhook } : {}),
        };
      }
      const nestedTarget = pickFirstString(
        rawTarget.to,
        rawTarget.target,
        rawTarget.value,
        rawTarget.address,
        rawTarget.rawTarget,
      );
      if (nestedTarget) {
        const resolvedNestedTarget = resolveWecomTarget(nestedTarget);
        return resolvedNestedTarget && typeof resolvedNestedTarget === "object" ? resolvedNestedTarget : null;
      }
    }
    const resolved = resolveWecomTarget(rawTarget);
    return resolved && typeof resolved === "object" ? resolved : null;
  }

  function formatWecomTargetForLog(target) {
    if (!target || typeof target !== "object") return "unknown";
    if (target.webhook) return `webhook:${target.webhook}`;
    if (target.chatId) return `chat:${target.chatId}`;
    const parts = [];
    if (target.toUser) parts.push(`user:${target.toUser}`);
    if (target.toParty) parts.push(`party:${target.toParty}`);
    if (target.toTag) parts.push(`tag:${target.toTag}`);
    return parts.join("|") || "unknown";
  }

  return {
    normalizeWecomResolvedTarget,
    formatWecomTargetForLog,
  };
}
