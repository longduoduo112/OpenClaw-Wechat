import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";

async function runBotSelfcheck(args = []) {
  const scriptPath = path.resolve(process.cwd(), "scripts/wecom-bot-selfcheck.mjs");
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("close", (code) => {
      resolve({
        code: Number.isInteger(code) ? code : -1,
        stdout,
        stderr,
      });
    });
  });
}

test("wecom-bot-selfcheck supports --all-accounts discovery", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "wecom-bot-selfcheck-"));
  const configPath = path.join(tempDir, "openclaw.json");
  const config = {
    gateway: { port: 18885 },
    channels: {
      wecom: {
        bot: { enabled: false },
        accounts: {
          ops: { bot: { enabled: false } },
          qa: { bot: { enabled: false } },
        },
      },
    },
    env: {
      vars: {
        WECOM_MARKETING_BOT_ENABLED: "0",
      },
    },
  };
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");

  const result = await runBotSelfcheck(["--config", configPath, "--all-accounts", "--json"]);
  assert.equal(result.code, 1);
  const report = JSON.parse(result.stdout);
  assert.equal(report?.args?.allAccounts, true);
  assert.ok(Array.isArray(report?.accounts));
  const accountIds = new Set(report.accounts.map((item) => String(item?.account ?? "")));
  assert.equal(accountIds.has("default"), true);
  assert.equal(accountIds.has("marketing"), true);
  assert.equal(accountIds.has("ops"), true);
  assert.equal(accountIds.has("qa"), true);
  assert.ok((report?.summary?.accountsTotal ?? 0) >= 4);
  for (const accountReport of report.accounts) {
    const checkNames = accountReport.checks.map((check) => check.name);
    assert.equal(checkNames.includes("plugins.allow"), true);
  }
});

test("wecom-bot-selfcheck rejects --url with --all-accounts", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "wecom-bot-selfcheck-"));
  const configPath = path.join(tempDir, "openclaw.json");
  await writeFile(configPath, JSON.stringify({ channels: { wecom: {} } }, null, 2), "utf8");

  const result = await runBotSelfcheck([
    "--config",
    configPath,
    "--all-accounts",
    "--url",
    "http://127.0.0.1:8885/wecom/bot/callback",
  ]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /cannot be used with --all-accounts/i);
});
