import crypto from "node:crypto";
import { createWecomBotParsedDispatcher } from "./bot-webhook-dispatch.js";

export function createWecomBotWebhookHandler({
  api,
  botConfig,
  normalizedPath,
  readRequestBody,
  parseIncomingJson,
  computeMsgSignature,
  decryptWecom,
  parseWecomBotInboundMessage,
  describeWecomBotParsedMessage,
  cleanupExpiredBotStreams,
  getBotStream,
  buildWecomBotEncryptedResponse,
  markInboundMessageSeen,
  buildWecomBotSessionId,
  createBotStream,
  upsertBotResponseUrlCache,
  messageProcessLimiter,
  executeInboundTaskWithSessionQueue,
  processBotInboundMessage,
  deliverBotReplyText,
  finishBotStream,
} = {}) {
  const dispatchParsed = createWecomBotParsedDispatcher({
    api,
    botConfig,
    cleanupExpiredBotStreams,
    getBotStream,
    buildWecomBotEncryptedResponse,
    markInboundMessageSeen,
    buildWecomBotSessionId,
    createBotStream,
    upsertBotResponseUrlCache,
    messageProcessLimiter,
    executeInboundTaskWithSessionQueue,
    processBotInboundMessage,
    deliverBotReplyText,
    finishBotStream,
    randomUuid: () => crypto.randomUUID?.(),
  });

  return async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const msg_signature = url.searchParams.get("msg_signature") ?? "";
      const timestamp = url.searchParams.get("timestamp") ?? "";
      const nonce = url.searchParams.get("nonce") ?? "";
      const echostr = url.searchParams.get("echostr") ?? "";

      if (req.method === "GET" && !echostr) {
        res.statusCode = 200;
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.end("wecom bot webhook ok");
        return;
      }

      if (req.method === "GET") {
        if (!msg_signature || !timestamp || !nonce || !echostr) {
          res.statusCode = 400;
          res.setHeader("Content-Type", "text/plain; charset=utf-8");
          res.end("Missing query params");
          return;
        }
        const expected = computeMsgSignature({
          token: botConfig.token,
          timestamp,
          nonce,
          encrypt: echostr,
        });
        if (expected !== msg_signature) {
          res.statusCode = 401;
          res.setHeader("Content-Type", "text/plain; charset=utf-8");
          res.end("Invalid signature");
          return;
        }
        const { msg: plainEchostr } = decryptWecom({
          aesKey: botConfig.encodingAesKey,
          cipherTextBase64: echostr,
        });
        res.statusCode = 200;
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.end(plainEchostr);
        api.logger.info?.(`wecom(bot): verified callback URL at ${normalizedPath}`);
        return;
      }

      if (req.method !== "POST") {
        res.statusCode = 405;
        res.setHeader("Allow", "GET, POST");
        res.end();
        return;
      }

      let encryptedBody = "";
      try {
        const rawBody = await readRequestBody(req);
        const parsedBody = parseIncomingJson(rawBody);
        encryptedBody = String(parsedBody?.encrypt ?? "").trim();
      } catch (err) {
        res.statusCode = 400;
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.end("Invalid request body");
        api.logger.warn?.(`wecom(bot): failed to parse callback body: ${String(err?.message || err)}`);
        return;
      }

      if (!msg_signature || !timestamp || !nonce || !encryptedBody) {
        res.statusCode = 400;
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.end("Missing required params");
        return;
      }

      const expected = computeMsgSignature({
        token: botConfig.token,
        timestamp,
        nonce,
        encrypt: encryptedBody,
      });
      if (expected !== msg_signature) {
        res.statusCode = 401;
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.end("Invalid signature");
        return;
      }

      let incomingPayload = null;
      try {
        const { msg: decryptedPayload } = decryptWecom({
          aesKey: botConfig.encodingAesKey,
          cipherTextBase64: encryptedBody,
        });
        incomingPayload = parseIncomingJson(decryptedPayload);
      } catch (err) {
        res.statusCode = 400;
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.end("Decrypt failed");
        api.logger.warn?.(`wecom(bot): failed to decrypt payload: ${String(err?.message || err)}`);
        return;
      }

      const parsed = parseWecomBotInboundMessage(incomingPayload);
      api.logger.info?.(`wecom(bot): inbound ${describeWecomBotParsedMessage(parsed)}`);
      const handled = await dispatchParsed({
        parsed,
        res,
        timestamp,
        nonce,
      });
      if (handled) {
        return;
      }

      res.statusCode = 200;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("success");
    } catch (err) {
      api.logger.error?.(`wecom(bot): webhook handler failed: ${String(err?.message || err)}`);
      if (!res.writableEnded) {
        res.statusCode = 500;
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.end("Internal error");
      }
    }
  };
}
