import assert from "node:assert/strict";
import test from "node:test";

import { markdownToWecomText } from "../src/wecom/text-format.js";

test("markdownToWecomText converts headings, links and code", () => {
  const input = [
    "# Title",
    "",
    "See [docs](https://example.com).",
    "",
    "`x`",
    "",
    "```js",
    "console.log(1)",
    "```",
  ].join("\n");
  const out = markdownToWecomText(input);
  assert.match(out, /◆ Title/);
  assert.match(out, /docs \(https:\/\/example.com\)/);
  assert.match(out, /\[js\]/);
  assert.match(out, /console\.log\(1\)/);
});

test("markdownToWecomText collapses excessive blank lines", () => {
  const out = markdownToWecomText("a\n\n\n\n b");
  assert.equal(out, "a\n\n b");
});

test("markdownToWecomText preserves underscores in raw urls", () => {
  const input = "下载链接：https://example.com/foo_bar/baz_qux?file=a_b_c";
  const out = markdownToWecomText(input);
  assert.equal(out, input);
});

test("markdownToWecomText preserves underscores in markdown link urls", () => {
  const out = markdownToWecomText("[下载地址](https://example.com/foo_bar/baz_qux?file=a_b_c)");
  assert.equal(out, "下载地址 (https://example.com/foo_bar/baz_qux?file=a_b_c)");
});
