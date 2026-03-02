import { createWecomDeliveryRouter, parseWecomResponseUrlResult } from "../core/delivery-router.js";
import { buildWecomBotMixedPayload, normalizeWecomBotOutboundMediaUrls } from "./webhook-adapter.js";
import { resolveWebhookBotSendUrl, webhookSendText } from "./webhook-bot.js";

function assertFunction(name, fn) {
  if (typeof fn !== "function") {
    throw new Error(`createWecomBotReplyDeliverer missing function dependency: ${name}`);
  }
}

export function createWecomBotReplyDeliverer({
  attachWecomProxyDispatcher,
  resolveWecomDeliveryFallbackPolicy,
  resolveWecomWebhookBotDeliveryPolicy,
  resolveWecomObservabilityPolicy,
  resolveWecomBotProxyConfig,
  buildWecomBotSessionId,
  upsertBotResponseUrlCache,
  getBotResponseUrlCache,
  markBotResponseUrlUsed,
  createDeliveryTraceId,
  hasBotStream,
  finishBotStream,
  getWecomConfig,
  sendWecomText,
  fetchImpl = fetch,
} = {}) {
  assertFunction("attachWecomProxyDispatcher", attachWecomProxyDispatcher);
  assertFunction("resolveWecomDeliveryFallbackPolicy", resolveWecomDeliveryFallbackPolicy);
  assertFunction("resolveWecomWebhookBotDeliveryPolicy", resolveWecomWebhookBotDeliveryPolicy);
  assertFunction("resolveWecomObservabilityPolicy", resolveWecomObservabilityPolicy);
  assertFunction("resolveWecomBotProxyConfig", resolveWecomBotProxyConfig);
  assertFunction("buildWecomBotSessionId", buildWecomBotSessionId);
  assertFunction("upsertBotResponseUrlCache", upsertBotResponseUrlCache);
  assertFunction("getBotResponseUrlCache", getBotResponseUrlCache);
  assertFunction("markBotResponseUrlUsed", markBotResponseUrlUsed);
  assertFunction("createDeliveryTraceId", createDeliveryTraceId);
  assertFunction("hasBotStream", hasBotStream);
  assertFunction("finishBotStream", finishBotStream);
  assertFunction("getWecomConfig", getWecomConfig);
  assertFunction("sendWecomText", sendWecomText);

  async function sendWecomBotPayloadViaResponseUrl({
    responseUrl,
    payload,
    logger,
    proxyUrl,
    timeoutMs = 8000,
  }) {
    const normalizedUrl = String(responseUrl ?? "").trim();
    if (!normalizedUrl) {
      throw new Error("missing response_url");
    }
    if (!payload || typeof payload !== "object") {
      throw new Error("missing response payload");
    }
    const requestOptions = attachWecomProxyDispatcher(
      normalizedUrl,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(Math.max(1000, Number(timeoutMs) || 8000)),
      },
      { proxyUrl, logger },
    );
    const response = await fetchImpl(normalizedUrl, requestOptions);
    const responseBody = await response.text().catch(() => "");
    const result = parseWecomResponseUrlResult(response, responseBody);
    if (!result.accepted) {
      throw new Error(
        `response_url rejected: status=${response.status} errcode=${result.errcode ?? "unknown"} errmsg=${result.errmsg || "n/a"}`,
      );
    }
    return {
      status: response.status,
      errcode: result.errcode,
    };
  }

  async function deliverBotReplyText({
    api,
    fromUser,
    sessionId,
    streamId,
    responseUrl,
    text,
    mediaUrl,
    mediaUrls,
    reason = "reply",
  } = {}) {
    const fallbackPolicy = resolveWecomDeliveryFallbackPolicy(api);
    const webhookBotPolicy = resolveWecomWebhookBotDeliveryPolicy(api);
    const observabilityPolicy = resolveWecomObservabilityPolicy(api);
    const botProxyUrl = resolveWecomBotProxyConfig(api);
    const normalizedText = String(text ?? "").trim();
    const normalizedMediaUrls = normalizeWecomBotOutboundMediaUrls({ mediaUrl, mediaUrls });
    const mixedPayload = buildWecomBotMixedPayload({
      text: normalizedText,
      mediaUrls: normalizedMediaUrls,
    });
    const mediaFallbackSuffix =
      normalizedMediaUrls.length > 0 ? `\n\n媒体链接：\n${normalizedMediaUrls.join("\n")}` : "";
    const fallbackText = normalizedText || "已收到模型返回的媒体结果，请查看以下链接。";

    const normalizedSessionId = String(sessionId ?? "").trim() || buildWecomBotSessionId(fromUser);
    const inlineResponseUrl = String(responseUrl ?? "").trim();
    if (inlineResponseUrl) {
      upsertBotResponseUrlCache({
        sessionId: normalizedSessionId,
        responseUrl: inlineResponseUrl,
      });
    }
    const cachedResponseUrl = getBotResponseUrlCache(normalizedSessionId);
    const traceId = createDeliveryTraceId("wecom-bot");
    const router = createWecomDeliveryRouter({
      logger: api.logger,
      fallbackConfig: fallbackPolicy,
      observability: observabilityPolicy,
      handlers: {
        active_stream: async ({ text: content }) => {
          if (normalizedMediaUrls.length > 0) {
            return { ok: false, reason: "stream-media-unsupported" };
          }
          if (!streamId || !hasBotStream(streamId)) {
            return { ok: false, reason: "stream-missing" };
          }
          finishBotStream(streamId, content);
          return {
            ok: true,
            meta: {
              streamId,
            },
          };
        },
        response_url: async ({ text: content }) => {
          const targetUrl = inlineResponseUrl || cachedResponseUrl?.url || "";
          if (!targetUrl) {
            return { ok: false, reason: "response-url-missing" };
          }
          if (cachedResponseUrl?.used) {
            return { ok: false, reason: "response-url-used" };
          }
          const payload = mixedPayload || {
            msgtype: "text",
            text: {
              content: content || fallbackText,
            },
          };
          const result = await sendWecomBotPayloadViaResponseUrl({
            responseUrl: targetUrl,
            payload,
            logger: api.logger,
            proxyUrl: botProxyUrl,
            timeoutMs: webhookBotPolicy.timeoutMs,
          });
          markBotResponseUrlUsed(normalizedSessionId);
          return {
            ok: true,
            meta: {
              status: result.status,
              errcode: result.errcode ?? 0,
            },
          };
        },
        webhook_bot: async ({ text: content }) => {
          if (!webhookBotPolicy.enabled) {
            return { ok: false, reason: "webhook-bot-disabled" };
          }
          const sendUrl = resolveWebhookBotSendUrl({
            url: webhookBotPolicy.url,
            key: webhookBotPolicy.key,
          });
          if (!sendUrl) {
            return { ok: false, reason: "webhook-bot-url-missing" };
          }
          await webhookSendText({
            url: webhookBotPolicy.url,
            key: webhookBotPolicy.key,
            content: `${content || fallbackText}${mediaFallbackSuffix}`.trim(),
            timeoutMs: webhookBotPolicy.timeoutMs,
          });
          return { ok: true };
        },
        agent_push: async ({ text: content }) => {
          const account = getWecomConfig(api, "default") ?? getWecomConfig(api);
          if (!account?.corpId || !account?.corpSecret || !account?.agentId) {
            return { ok: false, reason: "agent-config-missing" };
          }
          await sendWecomText({
            corpId: account.corpId,
            corpSecret: account.corpSecret,
            agentId: account.agentId,
            toUser: fromUser,
            text: `${content || fallbackText}${mediaFallbackSuffix}`.trim(),
            logger: api.logger,
            proxyUrl: account.outboundProxy,
          });
          return {
            ok: true,
            meta: {
              accountId: account.accountId || "default",
            },
          };
        },
      },
    });

    return router.deliverText({
      text: normalizedText || fallbackText,
      traceId,
      meta: {
        reason,
        fromUser,
        sessionId: normalizedSessionId,
        streamId: streamId || "",
        hasResponseUrl: Boolean(inlineResponseUrl || cachedResponseUrl?.url),
        mediaCount: normalizedMediaUrls.length,
      },
    });
  }

  return {
    deliverBotReplyText,
    sendWecomBotPayloadViaResponseUrl,
  };
}
