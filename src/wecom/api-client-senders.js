export function createWecomApiSenders({
  sleep,
  splitWecomText,
  getByteLength,
  apiLimiter,
  fetchWithRetry,
  getWecomAccessToken,
  buildWecomMessageSendRequest,
} = {}) {
  if (typeof sleep !== "function") throw new Error("createWecomApiSenders: sleep is required");
  if (typeof splitWecomText !== "function") throw new Error("createWecomApiSenders: splitWecomText is required");
  if (typeof getByteLength !== "function") throw new Error("createWecomApiSenders: getByteLength is required");
  if (!apiLimiter || typeof apiLimiter.execute !== "function") {
    throw new Error("createWecomApiSenders: apiLimiter.execute is required");
  }
  if (typeof fetchWithRetry !== "function") throw new Error("createWecomApiSenders: fetchWithRetry is required");
  if (typeof getWecomAccessToken !== "function") {
    throw new Error("createWecomApiSenders: getWecomAccessToken is required");
  }
  if (typeof buildWecomMessageSendRequest !== "function") {
    throw new Error("createWecomApiSenders: buildWecomMessageSendRequest is required");
  }

  async function sendWecomTypedMessage({
    corpId,
    corpSecret,
    agentId,
    toUser,
    toParty,
    toTag,
    chatId,
    msgType,
    payload,
    logger,
    proxyUrl,
    errorPrefix,
  }) {
    return apiLimiter.execute(async () => {
      const accessToken = await getWecomAccessToken({ corpId, corpSecret, proxyUrl, logger });
      const { sendUrl, body, isAppChat } = buildWecomMessageSendRequest({
        accessToken,
        agentId,
        toUser,
        toParty,
        toTag,
        chatId,
        msgType,
        payload,
      });
      const sendRes = await fetchWithRetry(
        sendUrl,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
        3,
        1000,
        { proxyUrl, logger },
      );
      const sendJson = await sendRes.json();
      if (sendJson?.errcode !== 0) {
        if (errorPrefix) {
          throw new Error(`${errorPrefix}: ${JSON.stringify(sendJson)}`);
        }
        throw new Error(`WeCom ${isAppChat ? "appchat/send" : "message/send"} failed: ${JSON.stringify(sendJson)}`);
      }
      return sendJson;
    });
  }

  async function sendWecomTextSingle({
    corpId,
    corpSecret,
    agentId,
    toUser,
    toParty,
    toTag,
    chatId,
    text,
    logger,
    proxyUrl,
  }) {
    const sendJson = await sendWecomTypedMessage({
      corpId,
      corpSecret,
      agentId,
      toUser,
      toParty,
      toTag,
      chatId,
      msgType: "text",
      payload: {
        text: { content: text },
      },
      logger,
      proxyUrl,
      errorPrefix: "",
    });
    const isAppChat = Boolean(chatId);
    const targetLabel = isAppChat ? `chat:${chatId}` : [toUser, toParty, toTag].filter(Boolean).join("|");
    logger?.info?.(`wecom: message sent ok (to=${targetLabel || "unknown"}, msgid=${sendJson?.msgid || "n/a"})`);
    return sendJson;
  }

  async function sendWecomText({
    corpId,
    corpSecret,
    agentId,
    toUser,
    toParty,
    toTag,
    chatId,
    text,
    logger,
    proxyUrl,
  }) {
    const chunks = splitWecomText(text);

    logger?.info?.(`wecom: splitting message into ${chunks.length} chunks, total bytes=${getByteLength(text)}`);

    for (let i = 0; i < chunks.length; i += 1) {
      logger?.info?.(`wecom: sending chunk ${i + 1}/${chunks.length}, bytes=${getByteLength(chunks[i])}`);
      await sendWecomTextSingle({
        corpId,
        corpSecret,
        agentId,
        toUser,
        toParty,
        toTag,
        chatId,
        text: chunks[i],
        logger,
        proxyUrl,
      });
      if (i < chunks.length - 1) {
        await sleep(300);
      }
    }
  }

  async function sendWecomImage({ corpId, corpSecret, agentId, toUser, toParty, toTag, chatId, mediaId, logger, proxyUrl }) {
    return sendWecomTypedMessage({
      corpId,
      corpSecret,
      agentId,
      toUser,
      toParty,
      toTag,
      chatId,
      msgType: "image",
      payload: {
        image: { media_id: mediaId },
      },
      logger,
      proxyUrl,
      errorPrefix: "WeCom image send failed",
    });
  }

  async function sendWecomVideo({
    corpId,
    corpSecret,
    agentId,
    toUser,
    toParty,
    toTag,
    chatId,
    mediaId,
    title,
    description,
    logger,
    proxyUrl,
  }) {
    const videoPayload = {
      media_id: mediaId,
      ...(title ? { title } : {}),
      ...(description ? { description } : {}),
    };
    return sendWecomTypedMessage({
      corpId,
      corpSecret,
      agentId,
      toUser,
      toParty,
      toTag,
      chatId,
      msgType: "video",
      payload: {
        video: videoPayload,
      },
      logger,
      proxyUrl,
      errorPrefix: "WeCom video send failed",
    });
  }

  async function sendWecomFile({ corpId, corpSecret, agentId, toUser, toParty, toTag, chatId, mediaId, logger, proxyUrl }) {
    return sendWecomTypedMessage({
      corpId,
      corpSecret,
      agentId,
      toUser,
      toParty,
      toTag,
      chatId,
      msgType: "file",
      payload: {
        file: { media_id: mediaId },
      },
      logger,
      proxyUrl,
      errorPrefix: "WeCom file send failed",
    });
  }

  async function sendWecomVoice({ corpId, corpSecret, agentId, toUser, toParty, toTag, chatId, mediaId, logger, proxyUrl }) {
    return sendWecomTypedMessage({
      corpId,
      corpSecret,
      agentId,
      toUser,
      toParty,
      toTag,
      chatId,
      msgType: "voice",
      payload: {
        voice: { media_id: mediaId },
      },
      logger,
      proxyUrl,
      errorPrefix: "WeCom voice send failed",
    });
  }

  return {
    sendWecomText,
    sendWecomImage,
    sendWecomVideo,
    sendWecomFile,
    sendWecomVoice,
  };
}
