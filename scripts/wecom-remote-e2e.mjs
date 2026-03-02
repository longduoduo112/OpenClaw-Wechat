#!/usr/bin/env node

import { spawn } from "node:child_process";

function parseArgs(argv) {
  const out = {
    botUrl: "",
    configPath: process.env.OPENCLAW_CONFIG_PATH || "",
    fromUser: "",
    timeoutMs: 12000,
    pollCount: 15,
    pollIntervalMs: 800,
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--bot-url" && next) {
      out.botUrl = next;
      i += 1;
    } else if (arg === "--config" && next) {
      out.configPath = next;
      i += 1;
    } else if (arg === "--from-user" && next) {
      out.fromUser = next;
      i += 1;
    } else if (arg === "--timeout-ms" && next) {
      const n = Number(next);
      if (Number.isFinite(n) && n > 0) out.timeoutMs = Math.floor(n);
      i += 1;
    } else if (arg === "--poll-count" && next) {
      const n = Number(next);
      if (Number.isFinite(n) && n > 0) out.pollCount = Math.floor(n);
      i += 1;
    } else if (arg === "--poll-interval-ms" && next) {
      const n = Number(next);
      if (Number.isFinite(n) && n > 0) out.pollIntervalMs = Math.floor(n);
      i += 1;
    } else if (arg === "-h" || arg === "--help") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!String(out.botUrl ?? "").trim()) {
    throw new Error("Missing required argument: --bot-url <https://.../wecom/bot/callback>");
  }

  return out;
}

function printHelp() {
  console.log(`OpenClaw-Wechat remote E2E

Usage:
  npm run wecom:remote:e2e -- --bot-url <https://.../wecom/bot/callback> [options]

Options:
  --bot-url <url>          Required: remote Bot callback URL
  --config <path>          Optional: OpenClaw config path
  --from-user <userid>     Optional: simulated sender
  --timeout-ms <ms>        Optional: HTTP timeout (default: 12000)
  --poll-count <n>         Optional: stream refresh polls (default: 15)
  --poll-interval-ms <ms>  Optional: stream refresh interval (default: 800)
  -h, --help               Show this help
`);
}

async function runNode(script, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], {
      stdio: "inherit",
      env: process.env,
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${script} exited with code ${code}`));
    });
  });
}

async function main() {
  const args = parseArgs(process.argv);

  const selfcheckArgs = ["--all-accounts", "--skip-local-webhook", "--timeout-ms", String(args.timeoutMs)];
  if (args.configPath) {
    selfcheckArgs.unshift(args.configPath);
    selfcheckArgs.unshift("--config");
  }

  const botArgs = [
    "--url",
    args.botUrl,
    "--content",
    "/status",
    "--timeout-ms",
    String(args.timeoutMs),
    "--poll-count",
    String(args.pollCount),
    "--poll-interval-ms",
    String(args.pollIntervalMs),
  ];
  if (args.configPath) {
    botArgs.unshift(args.configPath);
    botArgs.unshift("--config");
  }
  if (args.fromUser) {
    botArgs.push("--from-user", args.fromUser);
  }

  console.log("[1/2] WeCom account selfcheck (network)");
  await runNode("./scripts/wecom-selfcheck.mjs", selfcheckArgs);

  console.log("[2/2] WeCom Bot remote E2E");
  await runNode("./scripts/wecom-bot-selfcheck.mjs", botArgs);

  console.log("Remote E2E completed.");
}

main().catch((err) => {
  console.error(`Remote E2E failed: ${String(err?.message || err)}`);
  process.exit(1);
});
