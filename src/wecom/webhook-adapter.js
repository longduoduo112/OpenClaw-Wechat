import {
  collectWecomBotImageEntries,
  collectWecomBotImageUrls,
  dedupeUrlList,
  normalizeLowerToken,
  normalizeQuotePayload,
  normalizeToken,
  normalizeWecomBotOutboundMediaUrls,
} from "./webhook-adapter-normalize.js";

export { collectWecomBotImageEntries, collectWecomBotImageUrls, normalizeWecomBotOutboundMediaUrls };

function dedupeMediaEntries(entries) {
  const seen = new Map();
  for (const rawEntry of Array.isArray(entries) ? entries : []) {
    if (!rawEntry || typeof rawEntry !== "object") continue;
    const url = normalizeToken(rawEntry.url);
    if (!url) continue;
    const aesKey = normalizeToken(rawEntry.aesKey);
    const existing = seen.get(url);
    if (!existing) {
      seen.set(url, { url, aesKey });
      continue;
    }
    if (!existing.aesKey && aesKey) {
      seen.set(url, { url, aesKey });
    }
  }
  return Array.from(seen.values());
}

function pickNestedValue(source, paths = []) {
  if (!source || typeof source !== "object") return undefined;
  for (const rawPath of Array.isArray(paths) ? paths : []) {
    const segments = Array.isArray(rawPath)
      ? rawPath
      : String(rawPath ?? "")
          .split(".")
          .map((part) => String(part ?? "").trim())
          .filter(Boolean);
    if (segments.length === 0) continue;
    let current = source;
    let found = true;
    for (const segment of segments) {
      if (!current || typeof current !== "object" || !Object.hasOwn(current, segment)) {
        found = false;
        break;
      }
      current = current[segment];
    }
    if (found && current != null) {
      return current;
    }
  }
  return undefined;
}

function collectWecomBotMixedItems(payload) {
  const directItems = pickNestedValue(payload, [
    ["mixed", "msg_item"],
    ["mixed", "msgItem"],
    ["mixed", "items"],
    ["mixed", "msgItems"],
    ["msg_item"],
    ["msgItem"],
    ["items"],
    ["attachments"],
    ["attachment"],
    ["message", "attachments"],
    ["message", "items"],
    ["message", "msg_item"],
    ["message", "msgItem"],
  ]);
  if (Array.isArray(directItems)) {
    return directItems.filter((item) => item && typeof item === "object");
  }
  return [];
}

function inferWecomBotItemType(item) {
  const explicitType = normalizeLowerToken(
    item?.msgtype ||
      item?.msg_type ||
      item?.msgType ||
      item?.type ||
      item?.message_type ||
      item?.messageType ||
      item?.kind,
  );
  if (explicitType) return explicitType;
  if (item?.text || item?.content_type === "text" || item?.contentType === "text") return "text";
  if (item?.image || item?.pic_url || item?.image_url || item?.imageUrl) return "image";
  if (item?.voice || item?.voice_url || item?.voiceUrl || item?.audio || item?.audio_url || item?.audioUrl) return "voice";
  if (
    item?.file ||
    item?.file_url ||
    item?.fileUrl ||
    item?.download_url ||
    item?.downloadUrl ||
    item?.filename ||
    item?.file_name
  ) {
    return "file";
  }
  if (item?.link || item?.url) return "link";
  if (item?.location || item?.latitude || item?.longitude) return "location";
  return "";
}

function normalizeWecomBotMediaPayload(payload) {
  if (!payload || typeof payload !== "object") return null;
  const nestedMessage = pickNestedValue(payload, [["message"], ["msg"], ["data"], ["event", "message"]]);
  const candidates = [payload];
  if (nestedMessage && typeof nestedMessage === "object" && nestedMessage !== payload) {
    candidates.unshift(nestedMessage);
  }

  for (const candidate of candidates) {
    const msgType = normalizeLowerToken(
      pickNestedValue(candidate, [
        ["msgtype"],
        ["msg_type"],
        ["msgType"],
        ["message_type"],
        ["messageType"],
        ["type"],
      ]),
    );
    if (!msgType) continue;
    return {
      source: candidate,
      msgType,
    };
  }
  return null;
}

function extractWecomBotTextContent(textLike, fallbackContent = "") {
  return normalizeToken(
    textLike?.content ||
      textLike?.text ||
      textLike?.body ||
      textLike?.message ||
      fallbackContent,
  );
}

function extractWecomBotVoicePayload(voiceLike, fallback = {}) {
  const source = voiceLike && typeof voiceLike === "object" ? voiceLike : fallback;
  return {
    url: normalizeToken(
      source?.url ||
        source?.media_url ||
        source?.mediaUrl ||
        source?.download_url ||
        source?.downloadUrl ||
        source?.file_url ||
        source?.fileUrl ||
        source?.voice_url ||
        source?.voiceUrl ||
        source?.audio_url ||
        source?.audioUrl,
    ),
    mediaId: normalizeToken(
      source?.media_id ||
        source?.mediaid ||
        source?.mediaId ||
        source?.id,
    ),
    contentType: normalizeToken(
      source?.content_type ||
        source?.contentType ||
        source?.mime_type ||
        source?.mimeType ||
        source?.format,
    ),
    text: extractWecomBotTextContent(source, source?.content),
  };
}

function extractWecomBotFilePayload(fileLike, fallback = {}) {
  const source = fileLike && typeof fileLike === "object" ? fileLike : fallback;
  return {
    url: normalizeToken(
      source?.url ||
        source?.download_url ||
        source?.downloadUrl ||
        source?.media_url ||
        source?.mediaUrl ||
        source?.file_url ||
        source?.fileUrl,
    ),
    name: normalizeToken(
      source?.name ||
        source?.filename ||
        source?.file_name ||
        source?.fileName ||
        source?.title,
    ),
    aesKey: normalizeToken(
      source?.aeskey ||
        source?.aes_key ||
        source?.aesKey,
    ),
  };
}

export function buildWecomBotMixedPayload({ text = "", mediaUrl, mediaUrls } = {}) {
  const normalizedText = normalizeToken(text);
  const normalizedMediaUrls = normalizeWecomBotOutboundMediaUrls({ mediaUrl, mediaUrls }).slice(0, 6);

  if (normalizedMediaUrls.length === 0) {
    if (!normalizedText) return null;
    return {
      msgtype: "text",
      text: { content: normalizedText },
    };
  }

  const msgItems = [];
  if (normalizedText) {
    msgItems.push({
      msgtype: "text",
      text: { content: normalizedText },
    });
  }
  for (const imageUrl of normalizedMediaUrls) {
    msgItems.push({
      msgtype: "image",
      image: { url: imageUrl },
    });
  }

  if (msgItems.length === 0) return null;
  return {
    msgtype: "mixed",
    mixed: {
      msg_item: msgItems,
    },
  };
}

export function parseWecomBotInboundMessage(payload) {
  if (!payload || typeof payload !== "object") return null;
  const normalizedPayload = normalizeWecomBotMediaPayload(payload);
  if (!normalizedPayload) return null;
  const source = normalizedPayload.source;
  const msgType = normalizedPayload.msgType;
  const feedbackId = normalizeToken(
    pickNestedValue(source, [["feedback", "id"], ["stream", "feedback", "id"], ["stream", "feedbackId"], ["feedbackId"]]),
  );
  if (msgType === "stream") {
    return {
      kind: "stream-refresh",
      streamId: normalizeToken(pickNestedValue(source, [["stream", "id"], ["streamId"]])),
      feedbackId,
    };
  }

  const msgId =
    normalizeToken(
      pickNestedValue(source, [["msgid"], ["msg_id"], ["msgId"], ["message_id"], ["messageId"], ["id"]]),
    ) || `wecom-bot-${Date.now()}`;
  const fromUser = normalizeToken(
    pickNestedValue(source, [
      ["from", "userid"],
      ["from", "user_id"],
      ["from", "userId"],
      ["sender", "userid"],
      ["sender", "user_id"],
      ["sender", "userId"],
      ["sender", "id"],
      ["userid"],
      ["user_id"],
      ["userId"],
    ]),
  );
  const chatType =
    normalizeLowerToken(
      pickNestedValue(source, [["chattype"], ["chat_type"], ["chatType"]]) || "single",
    ) || "single";
  const chatId = normalizeToken(
    pickNestedValue(source, [["chatid"], ["chat_id"], ["chatId"], ["conversation_id"], ["conversationId"]]),
  );
  const responseUrl = normalizeToken(
    pickNestedValue(source, [["response_url"], ["responseUrl"], ["reply_url"], ["replyUrl"]]),
  );
  const quote = normalizeQuotePayload(pickNestedValue(source, [["quote"], ["quoted_message"], ["quotedMessage"]]));
  let content = "";
  const imageEntries = [];
  const imageUrls = [];
  let fileUrl = "";
  let fileName = "";
  let fileAesKey = "";
  let voiceUrl = "";
  let voiceMediaId = "";
  let voiceContentType = "";

  if (msgType === "text") {
    content = extractWecomBotTextContent(
      pickNestedValue(source, [["text"], ["message", "text"]]),
      pickNestedValue(source, [["content"], ["text_content"], ["textContent"]]),
    );
  } else if (msgType === "voice") {
    const voicePayload = extractWecomBotVoicePayload(
      pickNestedValue(source, [["voice"], ["audio"], ["message", "voice"], ["message", "audio"]]),
      source,
    );
    content = voicePayload.text;
    voiceUrl = voicePayload.url;
    voiceMediaId = voicePayload.mediaId;
    voiceContentType = voicePayload.contentType;
  } else if (msgType === "link") {
    const linkPayload = pickNestedValue(source, [["link"], ["message", "link"]]) || source;
    const title = normalizeToken(linkPayload?.title);
    const description = normalizeToken(linkPayload?.description);
    const url = normalizeToken(linkPayload?.url);
    content = [title ? `[链接] ${title}` : "", description, url].filter(Boolean).join("\n").trim();
  } else if (msgType === "location") {
    const locationPayload = pickNestedValue(source, [["location"], ["message", "location"]]) || source;
    const latitude = normalizeToken(locationPayload?.latitude);
    const longitude = normalizeToken(locationPayload?.longitude);
    const name = normalizeToken(locationPayload?.name || locationPayload?.label);
    content = name ? `[位置] ${name} (${latitude}, ${longitude})` : `[位置] ${latitude}, ${longitude}`;
  } else if (msgType === "image") {
    const topLevelImageEntries = collectWecomBotImageEntries(
      pickNestedValue(source, [["image"], ["message", "image"]]) || source,
    );
    imageEntries.push(...topLevelImageEntries);
    imageUrls.push(...topLevelImageEntries.map((entry) => entry.url));
    content = "[图片]";
  } else if (msgType === "mixed") {
    const items = collectWecomBotMixedItems(source);
    const parts = [];
    for (const item of items) {
      const itemType = inferWecomBotItemType(item);
      if (itemType === "text") {
        const text = extractWecomBotTextContent(item?.text, item?.content);
        if (text) parts.push(text);
      } else if (itemType === "image") {
        const itemImageEntries = collectWecomBotImageEntries(item?.image || item);
        if (itemImageEntries.length > 0) {
          imageEntries.push(...itemImageEntries);
          imageUrls.push(...itemImageEntries.map((entry) => entry.url));
          parts.push("[图片]");
        }
      } else if (itemType === "voice") {
        const voicePayload = extractWecomBotVoicePayload(item?.voice || item?.audio, item);
        const itemVoiceUrl = voicePayload.url;
        const itemVoiceMediaId = voicePayload.mediaId;
        const itemVoiceContentType = voicePayload.contentType;
        if (itemVoiceUrl) {
          voiceUrl = voiceUrl || itemVoiceUrl;
          voiceMediaId = voiceMediaId || itemVoiceMediaId;
          voiceContentType = voiceContentType || itemVoiceContentType;
          parts.push("[语音]");
        }
      } else if (itemType === "file") {
        const filePayload = extractWecomBotFilePayload(item?.file, item);
        const itemFileUrl = filePayload.url;
        const itemFileName = filePayload.name;
        const itemFileAesKey = filePayload.aesKey;
        if (itemFileUrl || itemFileName) {
          fileUrl = fileUrl || itemFileUrl;
          fileName = fileName || itemFileName;
          fileAesKey = fileAesKey || itemFileAesKey;
          const displayName = itemFileName || itemFileUrl || "附件";
          parts.push(`[文件] ${displayName}`);
        }
      } else if (itemType === "link") {
        const title = normalizeToken(item?.link?.title || item?.title);
        const description = normalizeToken(item?.link?.description || item?.description);
        const url = normalizeToken(item?.link?.url || item?.url);
        const linkText = [title ? `[链接] ${title}` : "", description, url].filter(Boolean).join("\n").trim();
        if (linkText) parts.push(linkText);
      } else if (itemType === "location") {
        const latitude = normalizeToken(item?.location?.latitude || item?.latitude);
        const longitude = normalizeToken(item?.location?.longitude || item?.longitude);
        const name = normalizeToken(item?.location?.name || item?.location?.label || item?.name || item?.label);
        const locationText = name ? `[位置] ${name} (${latitude}, ${longitude})` : `[位置] ${latitude}, ${longitude}`;
        if (locationText.trim() !== "[位置] ,") {
          parts.push(locationText);
        }
      }
    }
    content = parts.join("\n").trim();
  } else if (msgType === "file") {
    const filePayload = extractWecomBotFilePayload(
      pickNestedValue(source, [["file"], ["message", "file"], ["attachment"], ["document"]]),
      source,
    );
    fileUrl = filePayload.url;
    fileName = filePayload.name;
    fileAesKey = filePayload.aesKey;
    const displayName = fileName || fileUrl || "附件";
    content = `[文件] ${displayName}`;
  } else if (msgType === "event") {
    return {
      kind: "event",
      eventType: normalizeToken(
        pickNestedValue(source, [["event", "event_type"], ["event", "eventType"], ["event"], ["event_type"], ["eventType"]]),
      ),
      fromUser,
    };
  } else {
    return {
      kind: "unsupported",
      msgType,
      fromUser,
      msgId,
    };
  }

  if (!fromUser) {
    return {
      kind: "invalid",
      reason: "missing-from-user",
      msgType,
      msgId,
    };
  }

  return {
    kind: "message",
    msgType,
    msgId,
    fromUser,
    chatType,
    chatId,
    responseUrl,
    content,
    imageUrls: dedupeUrlList(imageUrls),
    imageEntries: dedupeMediaEntries(imageEntries),
    fileUrl,
    fileName,
    fileAesKey,
    voiceUrl,
    voiceMediaId,
    voiceContentType,
    feedbackId,
    quote,
    isGroupChat: chatType === "group" || Boolean(chatId),
  };
}

export function describeWecomBotParsedMessage(parsed) {
  if (!parsed || typeof parsed !== "object") return "unknown";
  if (parsed.kind === "message") {
    const imageCount = Array.isArray(parsed.imageUrls) ? parsed.imageUrls.length : 0;
    const imageSuffix = imageCount > 0 ? ` images=${imageCount}` : "";
    return `message msgType=${parsed.msgType || "unknown"} from=${parsed.fromUser || "unknown"} msgId=${parsed.msgId || "n/a"}${imageSuffix}`;
  }
  if (parsed.kind === "stream-refresh") {
    return `stream-refresh streamId=${parsed.streamId || "unknown"}`;
  }
  if (parsed.kind === "unsupported") {
    return `unsupported msgType=${parsed.msgType || "unknown"} from=${parsed.fromUser || "unknown"} msgId=${parsed.msgId || "n/a"}`;
  }
  if (parsed.kind === "invalid") {
    return `invalid reason=${parsed.reason || "unknown"} msgType=${parsed.msgType || "unknown"} msgId=${parsed.msgId || "n/a"}`;
  }
  if (parsed.kind === "event") {
    return `event eventType=${parsed.eventType || "unknown"} from=${parsed.fromUser || "unknown"}`;
  }
  return parsed.kind || "unknown";
}

export function extractWecomXmlInboundEnvelope(msgObj) {
  if (!msgObj || typeof msgObj !== "object") return null;
  return {
    msgType: normalizeLowerToken(msgObj.MsgType),
    fromUser: normalizeToken(msgObj.FromUserName),
    chatId: normalizeToken(msgObj.ChatId),
    msgId: normalizeToken(msgObj.MsgId),
    eventType: normalizeLowerToken(msgObj.Event),
    eventKey: normalizeToken(msgObj.EventKey),
    content: normalizeToken(msgObj.Content),
    mediaId: normalizeToken(msgObj.MediaId),
    picUrl: normalizeToken(msgObj.PicUrl),
    recognition: normalizeToken(msgObj.Recognition),
    thumbMediaId: normalizeToken(msgObj.ThumbMediaId),
    fileName: normalizeToken(msgObj.FileName),
    fileSize: normalizeToken(msgObj.FileSize),
    linkTitle: normalizeToken(msgObj.Title),
    linkDescription: normalizeToken(msgObj.Description),
    linkUrl: normalizeToken(msgObj.Url),
    linkPicUrl: normalizeToken(msgObj.PicUrl),
  };
}
