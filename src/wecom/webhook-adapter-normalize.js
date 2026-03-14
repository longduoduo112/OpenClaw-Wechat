export function normalizeToken(value) {
  return String(value ?? "").trim();
}

export function normalizeLowerToken(value) {
  return normalizeToken(value).toLowerCase();
}

export function dedupeUrlList(urls) {
  const dedupe = new Set();
  const out = [];
  for (const rawUrl of urls) {
    const url = normalizeToken(rawUrl);
    if (!url || dedupe.has(url)) continue;
    dedupe.add(url);
    out.push(url);
  }
  return out;
}

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

export function collectWecomBotImageUrls(imageLike) {
  return dedupeUrlList([
    imageLike?.url,
    imageLike?.pic_url,
    imageLike?.picUrl,
    imageLike?.image_url,
    imageLike?.imageUrl,
  ]);
}

export function collectWecomBotImageEntries(imageLike) {
  const aesKey = normalizeToken(imageLike?.aeskey || imageLike?.aes_key || imageLike?.aesKey);
  return dedupeMediaEntries(
    collectWecomBotImageUrls(imageLike).map((url) => ({
      url,
      aesKey,
    })),
  );
}

export function normalizeWecomBotOutboundMediaUrls(payload = {}) {
  return dedupeUrlList([
    payload?.mediaUrl,
    ...(Array.isArray(payload?.mediaUrls) ? payload.mediaUrls : []),
  ]);
}

export function normalizeQuotePayload(quotePayload) {
  if (!quotePayload || typeof quotePayload !== "object") return null;
  const msgType = normalizeLowerToken(quotePayload.msgtype);
  if (!msgType) return null;
  let content = "";
  if (msgType === "text") {
    content = normalizeToken(quotePayload?.text?.content);
  } else if (msgType === "image") {
    content = normalizeToken(quotePayload?.image?.url) || "[图片]";
  } else if (msgType === "file") {
    content = normalizeToken(quotePayload?.file?.name || quotePayload?.file?.filename || quotePayload?.file?.url);
  } else if (msgType === "link") {
    content = normalizeToken(quotePayload?.link?.title || quotePayload?.link?.url);
  }
  if (!content) return null;
  return {
    msgType,
    content,
  };
}
