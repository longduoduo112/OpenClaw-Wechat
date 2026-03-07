export function markdownToWecomText(markdown) {
  if (!markdown) return markdown;

  let text = markdown;
  const placeholders = [];

  function storePlaceholder(value, prefix) {
    const token = `@@${prefix}${placeholders.length}@@`;
    placeholders.push({ token, value });
    return token;
  }

  function restorePlaceholders(input) {
    let restored = input;
    for (const item of placeholders) {
      restored = restored.split(item.token).join(item.value);
    }
    return restored;
  }

  text = text.replace(/```(\w*)\n([\s\S]*?)```/g, (match, lang, code) => {
    const lines = code.trim().split("\n").map((line) => `  ${line}`).join("\n");
    return storePlaceholder(lang ? `[${lang}]\n${lines}` : lines, "CODE");
  });

  text = text.replace(/`([^`]+)`/g, (match, code) => storePlaceholder(code, "INLINE"));

  text = text.replace(/!\[([^\]]*)\]\([^)]+\)/g, "[图片: $1]");
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)");
  text = text.replace(/https?:\/\/[^\s)]+/g, (url) => storePlaceholder(url, "URL"));

  text = text.replace(/^### (.+)$/gm, "▸ $1");
  text = text.replace(/^## (.+)$/gm, "■ $1");
  text = text.replace(/^# (.+)$/gm, "◆ $1");

  text = text.replace(/\*\*\*([^*]+)\*\*\*/g, "$1");
  text = text.replace(/\*\*([^*]+)\*\*/g, "$1");
  text = text.replace(/\*([^*]+)\*/g, "$1");
  text = text.replace(/___([^_]+)___/g, "$1");
  text = text.replace(/__([^_]+)__/g, "$1");
  text = text.replace(/_([^_]+)_/g, "$1");

  text = text.replace(/^[\*\-] /gm, "• ");
  text = text.replace(/^[-*_]{3,}$/gm, "────────────");
  text = text.replace(/\n{3,}/g, "\n\n");

  return restorePlaceholders(text).trim();
}
