function assertFunction(name, value) {
  if (typeof value !== "function") {
    throw new Error(`createWecomWebhookBotDeliverer: ${name} is required`);
  }
}

export function createWecomWebhookBotDeliverer({
  attachWecomProxyDispatcher,
  resolveWebhookBotSendUrl,
  webhookSendText,
  sendWebhookBotMediaBatch,
  fetchImpl = fetch,
} = {}) {
  assertFunction("attachWecomProxyDispatcher", attachWecomProxyDispatcher);
  assertFunction("resolveWebhookBotSendUrl", resolveWebhookBotSendUrl);
  assertFunction("webhookSendText", webhookSendText);
  assertFunction("sendWebhookBotMediaBatch", sendWebhookBotMediaBatch);
  assertFunction("fetchImpl", fetchImpl);

  return async function deliverWebhookBotReply({
    api,
    webhookBotPolicy,
    botProxyUrl = "",
    content = "",
    fallbackText = "",
    normalizedText = "",
    normalizedMediaUrls = [],
    mediaType,
  } = {}) {
    if (!webhookBotPolicy?.enabled) {
      return { ok: false, reason: "webhook-bot-disabled" };
    }
    const sendUrl = resolveWebhookBotSendUrl({
      url: webhookBotPolicy?.url,
      key: webhookBotPolicy?.key,
    });
    if (!sendUrl) {
      return { ok: false, reason: "webhook-bot-url-missing" };
    }

    const dispatcher = attachWecomProxyDispatcher(sendUrl, {}, { proxyUrl: botProxyUrl, logger: api?.logger })?.dispatcher;
    const textPayload = `${content || fallbackText}`.trim();
    let sentAny = false;

    if (textPayload && (normalizedText || normalizedMediaUrls.length === 0)) {
      await webhookSendText({
        url: webhookBotPolicy?.url,
        key: webhookBotPolicy?.key,
        content: textPayload,
        timeoutMs: webhookBotPolicy?.timeoutMs,
        dispatcher,
        fetchImpl,
      });
      sentAny = true;
    }

    let mediaMeta = { sentCount: 0, failedCount: 0, failedUrls: [] };
    if (normalizedMediaUrls.length > 0) {
      mediaMeta = await sendWebhookBotMediaBatch({
        api,
        webhookBotPolicy,
        proxyUrl: botProxyUrl,
        mediaUrls: normalizedMediaUrls,
        mediaType,
      });
      sentAny = sentAny || mediaMeta.sentCount > 0;
    }

    if (!sentAny) {
      return { ok: false, reason: mediaMeta.reason || "webhook-bot-send-failed" };
    }

    if (mediaMeta.failedCount > 0) {
      await webhookSendText({
        url: webhookBotPolicy?.url,
        key: webhookBotPolicy?.key,
        content: `以下媒体回传失败，已自动降级为链接：\n${mediaMeta.failedUrls.join("\n")}`,
        timeoutMs: webhookBotPolicy?.timeoutMs,
        dispatcher,
        fetchImpl,
      });
    }

    return {
      ok: true,
      meta: {
        mediaSent: mediaMeta.sentCount,
        mediaFailed: mediaMeta.failedCount,
      },
    };
  };
}
