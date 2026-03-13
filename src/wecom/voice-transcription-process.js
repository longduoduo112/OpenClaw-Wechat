import { spawn } from "node:child_process";

function assertFunction(name, value) {
  if (typeof value !== "function") {
    throw new Error(`createVoiceTranscriptionProcessRuntime: ${name} is required`);
  }
}

export function createVoiceTranscriptionProcessRuntime({
  runProcessWithTimeoutImpl,
  checkCommandAvailableImpl,
} = {}) {
  const ffmpegPathCheckCache = {
    checked: false,
    available: false,
  };
  const commandPathCheckCache = new Map();

  function runProcessWithTimeout({ command, args, timeoutMs = 15000, allowNonZeroExitCode = false }) {
    if (typeof runProcessWithTimeoutImpl === "function") {
      return runProcessWithTimeoutImpl({ command, args, timeoutMs, allowNonZeroExitCode });
    }

    return new Promise((resolve, reject) => {
      const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      const timer =
        timeoutMs > 0
          ? setTimeout(() => {
              timedOut = true;
              child.kill("SIGKILL");
            }, timeoutMs)
          : null;

      child.stdout.on("data", (chunk) => {
        stdout += String(chunk);
        if (stdout.length > 4000) stdout = stdout.slice(-4000);
      });
      child.stderr.on("data", (chunk) => {
        stderr += String(chunk);
        if (stderr.length > 4000) stderr = stderr.slice(-4000);
      });
      child.on("error", (err) => {
        if (timer) clearTimeout(timer);
        reject(err);
      });
      child.on("close", (code) => {
        if (timer) clearTimeout(timer);
        if (timedOut) {
          reject(new Error(`${command} timed out after ${timeoutMs}ms`));
          return;
        }
        if (code !== 0 && !allowNonZeroExitCode) {
          reject(new Error(`${command} exited with code ${code}: ${stderr.trim().slice(0, 500)}`));
          return;
        }
        resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
      });
    });
  }

  async function checkCommandAvailable(command) {
    const normalized = String(command ?? "").trim();
    if (!normalized) return false;

    if (typeof checkCommandAvailableImpl === "function") {
      return checkCommandAvailableImpl(normalized);
    }

    if (commandPathCheckCache.has(normalized)) {
      return commandPathCheckCache.get(normalized);
    }
    try {
      await runProcessWithTimeout({
        command: normalized,
        args: ["--help"],
        timeoutMs: 4000,
        allowNonZeroExitCode: true,
      });
      commandPathCheckCache.set(normalized, true);
      return true;
    } catch {
      commandPathCheckCache.set(normalized, false);
      return false;
    }
  }

  async function ensureFfmpegAvailable(logger) {
    if (ffmpegPathCheckCache.checked) return ffmpegPathCheckCache.available;
    const available = await checkCommandAvailable("ffmpeg");
    ffmpegPathCheckCache.checked = true;
    ffmpegPathCheckCache.available = available;
    if (!available) {
      logger?.warn?.("wecom: ffmpeg not available");
    }
    return available;
  }

  function listLocalWhisperCommandCandidates({ voiceConfig } = {}) {
    const provider = String(voiceConfig?.provider ?? "").trim().toLowerCase();
    const explicitCommand = String(voiceConfig?.command ?? "").trim();
    const fallbackCandidates =
      provider === "local-whisper"
        ? ["whisper"]
        : provider === "local-whisper-cli"
          ? ["whisper-cli"]
          : [];
    const candidates = explicitCommand ? [explicitCommand, ...fallbackCandidates] : fallbackCandidates;

    if (candidates.length === 0) {
      return {
        provider,
        explicitCommand,
        candidates: [],
        error: `unsupported voice transcription provider: ${provider || "unknown"} (supported: local-whisper-cli/local-whisper)`,
      };
    }

    return {
      provider,
      explicitCommand,
      candidates,
      error: "",
    };
  }

  async function resolveLocalWhisperCommand({ voiceConfig, logger }) {
    const resolution = listLocalWhisperCommandCandidates({ voiceConfig });
    if (resolution.error) {
      throw new Error(resolution.error);
    }

    for (const cmd of resolution.candidates) {
      // eslint-disable-next-line no-await-in-loop
      if (await checkCommandAvailable(cmd)) {
        if (resolution.explicitCommand && cmd !== resolution.explicitCommand) {
          logger?.warn?.(`wecom: voice command ${resolution.explicitCommand} unavailable, fallback to ${cmd}`);
        }
        return cmd;
      }
    }

    const checkedList = resolution.candidates.join(" / ");
    throw new Error(
      `local transcription command not found: checked ${checkedList}. ` +
        "Confirm the command is installed and available in PATH for the OpenClaw runtime.",
    );
  }

  async function inspectVoiceTranscriptionRuntime({ voiceConfig, logger } = {}) {
    const resolution = listLocalWhisperCommandCandidates({ voiceConfig });
    const commandChecks = [];
    for (const cmd of resolution.candidates) {
      // eslint-disable-next-line no-await-in-loop
      const available = await checkCommandAvailable(cmd);
      commandChecks.push({ command: cmd, available });
    }
    const resolvedCommand = commandChecks.find((item) => item.available)?.command || "";
    const ffmpegEnabled = voiceConfig?.ffmpegEnabled !== false;
    const ffmpegAvailable = ffmpegEnabled ? await ensureFfmpegAvailable(logger) : false;
    const provider = String(voiceConfig?.provider ?? "").trim().toLowerCase();
    const requireModelPath = provider === "local-whisper-cli" && voiceConfig?.requireModelPath !== false;
    const modelPath = String(voiceConfig?.modelPath ?? "").trim();
    const issues = [];
    if (!voiceConfig?.enabled) {
      issues.push("voice transcription disabled");
    }
    if (resolution.error) {
      issues.push(resolution.error);
    }
    if (resolution.candidates.length > 0 && !resolvedCommand) {
      issues.push(`no available command in PATH: ${resolution.candidates.join(" / ")}`);
    }
    if (requireModelPath && !modelPath) {
      issues.push("voiceTranscription.modelPath is required for local-whisper-cli");
    }
    if (ffmpegEnabled && !ffmpegAvailable) {
      issues.push("ffmpeg not available");
    }

    return {
      enabled: voiceConfig?.enabled === true,
      provider,
      explicitCommand: resolution.explicitCommand || "",
      commandCandidates: resolution.candidates,
      commandChecks,
      resolvedCommand,
      ffmpegEnabled,
      ffmpegAvailable,
      requireModelPath,
      modelPathConfigured: Boolean(modelPath),
      modelPath,
      issues,
    };
  }

  assertFunction("runProcessWithTimeout", runProcessWithTimeout);
  assertFunction("checkCommandAvailable", checkCommandAvailable);
  assertFunction("ensureFfmpegAvailable", ensureFfmpegAvailable);
  assertFunction("listLocalWhisperCommandCandidates", listLocalWhisperCommandCandidates);
  assertFunction("resolveLocalWhisperCommand", resolveLocalWhisperCommand);
  assertFunction("inspectVoiceTranscriptionRuntime", inspectVoiceTranscriptionRuntime);

  return {
    runProcessWithTimeout,
    checkCommandAvailable,
    ensureFfmpegAvailable,
    listLocalWhisperCommandCandidates,
    resolveLocalWhisperCommand,
    inspectVoiceTranscriptionRuntime,
  };
}
