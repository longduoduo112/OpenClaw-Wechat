import { XMLParser } from "fast-xml-parser";

const DEFAULT_XML_PARSER_OPTIONS = {
  ignoreAttributes: false,
  trimValues: true,
  processEntities: false, // 防止 XXE
  parseTagValue: false, // 保留前导零，避免 FromUserName/MsgId 等字段被自动转数值
};

export const DEFAULT_MAX_REQUEST_BODY_SIZE = 1024 * 1024;

export function createWecomRequestParsers({
  xmlParserOptions = DEFAULT_XML_PARSER_OPTIONS,
  maxRequestBodySize = DEFAULT_MAX_REQUEST_BODY_SIZE,
} = {}) {
  const xmlParser = new XMLParser(xmlParserOptions);

  function readRequestBody(req, maxSize = maxRequestBodySize) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let totalSize = 0;

      req.on("data", (chunkLike) => {
        const chunk = Buffer.isBuffer(chunkLike) ? chunkLike : Buffer.from(chunkLike);
        totalSize += chunk.length;
        if (totalSize > maxSize) {
          reject(new Error(`Request body too large (limit: ${maxSize} bytes)`));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      req.on("error", reject);
    });
  }

  function parseIncomingXml(xml) {
    const parsed = xmlParser.parse(xml);
    return parsed?.xml ?? parsed;
  }

  function parseIncomingJson(jsonText) {
    if (!jsonText) return null;
    const parsed = JSON.parse(jsonText);
    return parsed && typeof parsed === "object" ? parsed : null;
  }

  return {
    readRequestBody,
    parseIncomingXml,
    parseIncomingJson,
    maxRequestBodySize,
  };
}
