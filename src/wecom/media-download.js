import { basename, extname } from "node:path";

const FILE_MAGIC_SIGNATURES = [
  { magic: [0xff, 0xd8, 0xff], ext: ".jpg" }, // JPEG
  { magic: [0x89, 0x50, 0x4e, 0x47], ext: ".png" }, // PNG
  { magic: [0x47, 0x49, 0x46, 0x38], ext: ".gif" }, // GIF
  { magic: [0x25, 0x50, 0x44, 0x46], ext: ".pdf" }, // PDF
  { magic: [0x50, 0x4b, 0x03, 0x04], ext: ".zip" }, // ZIP / Office OpenXML
  { magic: [0xd0, 0xcf, 0x11, 0xe0], ext: ".doc" }, // OLE2
  { magic: [0x52, 0x61, 0x72, 0x21], ext: ".rar" }, // RAR
  { magic: [0x1f, 0x8b], ext: ".gz" }, // GZIP
  { magic: [0x42, 0x4d], ext: ".bmp" }, // BMP
  { magic: [0x49, 0x44, 0x33], ext: ".mp3" }, // MP3
  { magic: [0x52, 0x49, 0x46, 0x46], ext: ".wav" }, // RIFF
];

const CONTENT_TYPE_EXTENSIONS = new Map([
  ["application/pdf", ".pdf"],
  ["application/zip", ".zip"],
  ["application/json", ".json"],
  ["application/xml", ".xml"],
  ["application/msword", ".doc"],
  ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", ".docx"],
  ["application/vnd.ms-excel", ".xls"],
  ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ".xlsx"],
  ["application/vnd.ms-powerpoint", ".ppt"],
  ["application/vnd.openxmlformats-officedocument.presentationml.presentation", ".pptx"],
  ["text/plain", ".txt"],
  ["text/csv", ".csv"],
  ["text/markdown", ".md"],
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/gif", ".gif"],
  ["image/webp", ".webp"],
  ["image/bmp", ".bmp"],
  ["audio/mpeg", ".mp3"],
  ["audio/wav", ".wav"],
  ["audio/amr", ".amr"],
  ["video/mp4", ".mp4"],
  ["video/quicktime", ".mov"],
]);

const GENERIC_FILENAMES = new Set([
  "",
  "file",
  "attachment",
  "download",
  "media",
  "unnamed",
]);

function normalizeContentType(contentType) {
  return String(contentType ?? "")
    .trim()
    .toLowerCase()
    .split(";")[0]
    .trim();
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function sanitizeWecomFileName(fileName, fallback = "file") {
  const raw = basename(String(fileName ?? "").trim());
  const normalized = raw
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]+/g, "_")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return fallback;
  const maxLen = 180;
  if (normalized.length <= maxLen) return normalized;
  const ext = extname(normalized);
  if (!ext) return normalized.slice(0, maxLen);
  const stem = normalized.slice(0, Math.max(1, maxLen - ext.length));
  return `${stem}${ext}`;
}

export function pickExtensionFromContentType(contentType) {
  const normalized = normalizeContentType(contentType);
  return CONTENT_TYPE_EXTENSIONS.get(normalized) || "";
}

export function extractFilenameFromContentDisposition(contentDisposition) {
  const header = String(contentDisposition ?? "").trim();
  if (!header) return "";

  const encodedMatch = header.match(/filename\*\s*=\s*([^;]+)/i);
  if (encodedMatch?.[1]) {
    const raw = encodedMatch[1].trim().replace(/^"(.*)"$/, "$1");
    const encoded = raw.includes("''") ? raw.split("''").slice(1).join("''") : raw;
    const decoded = safeDecode(encoded);
    const safe = sanitizeWecomFileName(decoded, "");
    if (safe) return safe;
  }

  const plainMatch = header.match(/filename\s*=\s*("([^"]+)"|[^;]+)/i);
  if (plainMatch) {
    const rawValue = plainMatch[2] || plainMatch[1] || "";
    const decoded = safeDecode(String(rawValue).trim().replace(/^"(.*)"$/, "$1"));
    const safe = sanitizeWecomFileName(decoded, "");
    if (safe) return safe;
  }

  return "";
}

export function extractFilenameFromUrl(sourceUrl) {
  const raw = String(sourceUrl ?? "").trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    const qKeys = ["filename", "file", "name", "download", "attname"];
    for (const key of qKeys) {
      const value = parsed.searchParams.get(key);
      const safe = sanitizeWecomFileName(safeDecode(String(value ?? "")), "");
      if (safe) return safe;
    }
    const pathName = basename(parsed.pathname || "");
    return sanitizeWecomFileName(pathName, "");
  } catch {
    const noQuery = raw.split("?")[0].split("#")[0];
    return sanitizeWecomFileName(basename(noQuery), "");
  }
}

export function detectMagicFileExtension(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 2) return "";
  for (const signature of FILE_MAGIC_SIGNATURES) {
    if (
      buffer.length >= signature.magic.length &&
      signature.magic.every((value, index) => buffer[index] === value)
    ) {
      return signature.ext;
    }
  }
  return "";
}

export function isLikelyTextContentType(contentType) {
  const normalized = normalizeContentType(contentType);
  if (!normalized) return false;
  return (
    normalized.startsWith("text/") ||
    normalized === "application/json" ||
    normalized === "application/xml" ||
    normalized === "application/x-www-form-urlencoded" ||
    normalized === "application/javascript"
  );
}

export function isLikelyUtf8TextBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return false;
  const sample = buffer.subarray(0, Math.min(buffer.length, 4096));
  const text = sample.toString("utf8");
  if (!text) return false;
  if (text.includes("\uFFFD")) return false;
  let printable = 0;
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    if (code === 9 || code === 10 || code === 13 || (code >= 32 && code <= 126) || code >= 160) {
      printable += 1;
    }
  }
  return printable / Math.max(1, text.length) >= 0.88;
}

export function looksLikePlainFileBuffer({ buffer, contentType }) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return false;
  if (detectMagicFileExtension(buffer)) return true;
  if (isLikelyTextContentType(contentType) && isLikelyUtf8TextBuffer(buffer)) return true;
  return false;
}

export function inferFilenameFromMediaDownload({
  explicitName,
  contentDisposition,
  sourceUrl,
  contentType,
}) {
  const explicit = sanitizeWecomFileName(explicitName, "");
  const dispositionName = extractFilenameFromContentDisposition(contentDisposition);
  const fromUrl = extractFilenameFromUrl(sourceUrl);

  let selected = explicit || dispositionName || fromUrl || "file";
  if (GENERIC_FILENAMES.has(selected.toLowerCase()) && (dispositionName || fromUrl)) {
    selected = dispositionName || fromUrl;
  }
  if (!extname(selected)) {
    const ext = pickExtensionFromContentType(contentType);
    if (ext) selected = `${selected}${ext}`;
  }
  return sanitizeWecomFileName(selected, "file");
}

export function buildMediaFetchErrorMessage({ url, status, statusText, contentType, bodyPreview } = {}) {
  const parts = ["download media failed"];
  const code = Number(status);
  if (Number.isFinite(code) && code > 0) {
    parts.push(String(code));
  }
  const statusDetail = String(statusText ?? "").trim();
  if (statusDetail) parts.push(statusDetail);
  const normalizedType = normalizeContentType(contentType);
  if (normalizedType) parts.push(`content-type=${normalizedType}`);
  const target = String(url ?? "").trim();
  if (target) parts.push(`url=${target}`);
  const preview = String(bodyPreview ?? "").trim();
  if (preview) parts.push(`body=${preview.slice(0, 200)}`);
  return parts.join(" | ");
}

export function smartDecryptWecomFileBuffer({
  buffer,
  aesKey,
  contentType,
  sourceUrl,
  decryptFn,
  logger,
}) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    return { buffer, decrypted: false, reason: "empty-buffer" };
  }

  if (looksLikePlainFileBuffer({ buffer, contentType })) {
    return { buffer, decrypted: false, reason: "plain-buffer" };
  }

  const normalizedAesKey = String(aesKey ?? "").trim();
  if (!normalizedAesKey || typeof decryptFn !== "function") {
    return { buffer, decrypted: false, reason: "decrypt-unavailable" };
  }

  try {
    const decryptedBuffer = decryptFn({
      aesKey: normalizedAesKey,
      encryptedBuffer: buffer,
    });
    if (!Buffer.isBuffer(decryptedBuffer) || decryptedBuffer.length === 0) {
      return { buffer, decrypted: false, reason: "decrypt-empty" };
    }

    const rawLooksPlain = looksLikePlainFileBuffer({ buffer, contentType });
    const decryptedLooksPlain = looksLikePlainFileBuffer({
      buffer: decryptedBuffer,
      contentType,
    });
    if (decryptedLooksPlain && !rawLooksPlain) {
      return { buffer: decryptedBuffer, decrypted: true, reason: "decrypt-plain-detected" };
    }
    if (rawLooksPlain && !decryptedLooksPlain) {
      return { buffer, decrypted: false, reason: "raw-plain-preferred" };
    }
    if (decryptedLooksPlain) {
      return { buffer: decryptedBuffer, decrypted: true, reason: "decrypt-plain-possible" };
    }
    return { buffer, decrypted: false, reason: "decrypt-not-recognized" };
  } catch (err) {
    logger?.warn?.(
      `wecom(bot): smart decrypt failed url=${String(sourceUrl ?? "").slice(0, 120)} reason=${String(err?.message || err)}`,
    );
    return { buffer, decrypted: false, reason: "decrypt-failed" };
  }
}
