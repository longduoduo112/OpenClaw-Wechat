import { createWecomLateReplyWatcher } from "./agent-late-reply-watcher.js";
import { buildWecomBotInboundContextPayload, buildWecomBotInboundEnvelopePayload } from "./bot-context.js";
import { createWecomBotDispatchHandlers } from "./bot-dispatch-handlers.js";
import { createWecomBotTranscriptFallbackReader } from "./bot-transcript-fallback.js";

export function createWecomBotInboundProcessor(deps = {}) {
  const {
    buildWecomBotSessionId,
    resolveWecomBotConfig,
    resolveWecomBotProxyConfig,
    normalizeWecomBotOutboundMediaUrls,
    resolveWecomGroupChatPolicy,
    resolveWecomDynamicAgentPolicy,
    hasBotStream,
    finishBotStream,
    deliverBotReplyText,
    shouldTriggerWecomGroupResponse,
    shouldStripWecomGroupMentions,
    stripWecomGroupMentions,
    resolveWecomCommandPolicy,
    resolveWecomAllowFromPolicy,
    isWecomSenderAllowed,
    extractLeadingSlashCommand,
    buildWecomBotHelpText,
    buildWecomBotStatusText,
    buildBotInboundContent,
    resolveWecomAgentRoute,
    seedDynamicAgentWorkspace,
    resolveSessionTranscriptFilePath,
    readTranscriptAppendedChunk,
    parseLateAssistantReplyFromTranscriptLine,
    hasTranscriptReplyBeenDelivered,
    markTranscriptReplyDelivered,
    markdownToWecomText,
    sleep,
    withTimeout,
    isDispatchTimeoutError,
    queueBotStreamMedia,
    updateBotStream,
    isAgentFailureText,
    scheduleTempFileCleanup,
    ACTIVE_LATE_REPLY_WATCHERS,
  } = deps;

  let lateReplyWatcherRunner = null;
  let transcriptFallbackReader = null;
  function ensureLateReplyWatcherRunner() {
    if (lateReplyWatcherRunner) return lateReplyWatcherRunner;
    lateReplyWatcherRunner = createWecomLateReplyWatcher({
      resolveSessionTranscriptFilePath,
      readTranscriptAppendedChunk,
      parseLateAssistantReplyFromTranscriptLine,
      hasTranscriptReplyBeenDelivered,
      markTranscriptReplyDelivered,
      sleep,
      markdownToWecomText,
    });
    return lateReplyWatcherRunner;
  }
  function ensureTranscriptFallbackReader() {
    if (transcriptFallbackReader) return transcriptFallbackReader;
    transcriptFallbackReader = createWecomBotTranscriptFallbackReader({
      resolveSessionTranscriptFilePath,
      readTranscriptAppendedChunk,
      parseLateAssistantReplyFromTranscriptLine,
      hasTranscriptReplyBeenDelivered,
      markdownToWecomText,
    });
    return transcriptFallbackReader;
  }

async function processBotInboundMessage({
  api,
  streamId,
  fromUser,
  content,
  msgType = "text",
  msgId,
  chatId,
  isGroupChat = false,
  imageUrls = [],
  fileUrl = "",
  fileName = "",
  quote = null,
  responseUrl = "",
}) {
  const runtime = api.runtime;
  const cfg = api.config;
  const baseSessionId = buildWecomBotSessionId(fromUser);
  let sessionId = baseSessionId;
  let routedAgentId = "";
  const fromAddress = `wecom-bot:${fromUser}`;
  const normalizedFromUser = String(fromUser ?? "").trim().toLowerCase();
  const originalContent = String(content ?? "");
  let commandBody = originalContent;
  const dispatchStartedAt = Date.now();
  const tempPathsToCleanup = [];
  const botModeConfig = resolveWecomBotConfig(api);
  const botProxyUrl = resolveWecomBotProxyConfig(api);
  const normalizedFileUrl = String(fileUrl ?? "").trim();
  const normalizedFileName = String(fileName ?? "").trim();
  const normalizedQuote =
    quote && typeof quote === "object"
      ? {
          msgType: String(quote.msgType ?? "").trim().toLowerCase(),
          content: String(quote.content ?? "").trim(),
        }
      : null;
  const normalizedImageUrls = Array.from(
    new Set(
      (Array.isArray(imageUrls) ? imageUrls : [])
        .map((item) => String(item ?? "").trim())
        .filter(Boolean),
    ),
  );
  const groupChatPolicy = resolveWecomGroupChatPolicy(api);
  const dynamicAgentPolicy = resolveWecomDynamicAgentPolicy(api);

  const safeFinishStream = (text) => {
    if (!hasBotStream(streamId)) return;
    finishBotStream(streamId, String(text ?? ""));
  };
  const safeDeliverReply = async (reply, reason = "reply") => {
    const normalizedReply =
      typeof reply === "string"
        ? { text: reply }
        : reply && typeof reply === "object"
          ? reply
          : { text: "" };
    const contentText = String(normalizedReply.text ?? "").trim();
    const replyMediaUrls = normalizeWecomBotOutboundMediaUrls(normalizedReply);
    if (!contentText && replyMediaUrls.length === 0) return false;
    const result = await deliverBotReplyText({
      api,
      fromUser,
      sessionId,
      streamId,
      responseUrl,
      text: contentText,
      mediaUrls: replyMediaUrls,
      mediaType: String(normalizedReply.mediaType ?? "").trim().toLowerCase() || undefined,
      reason,
    });
    if (!result?.ok && hasBotStream(streamId)) {
      finishBotStream(streamId, contentText || "已收到模型返回的媒体结果，请稍后刷新。");
    }
    return result?.ok === true;
  };
  let startLateReplyWatcher = () => false;

  try {
    if (isGroupChat && msgType === "text") {
      if (!groupChatPolicy.enabled) {
        safeFinishStream("当前群聊消息处理未启用。");
        return;
      }
      if (!shouldTriggerWecomGroupResponse(commandBody, groupChatPolicy)) {
        const hint =
          groupChatPolicy.triggerMode === "mention"
            ? "请先 @ 机器人后再发送消息。"
            : groupChatPolicy.triggerMode === "keyword"
              ? "当前消息未命中群聊触发关键词。"
              : "当前消息不满足群聊触发条件。";
        safeFinishStream(hint);
        return;
      }
      if (shouldStripWecomGroupMentions(groupChatPolicy)) {
        commandBody = stripWecomGroupMentions(commandBody, groupChatPolicy.mentionPatterns);
      }
    }

    const commandPolicy = resolveWecomCommandPolicy(api);
    const isAdminUser = commandPolicy.adminUsers.includes(normalizedFromUser);
    const allowFromPolicy = resolveWecomAllowFromPolicy(api, "default", {});
    const senderAllowed = isAdminUser || isWecomSenderAllowed({
      senderId: normalizedFromUser,
      allowFrom: allowFromPolicy.allowFrom,
    });
    if (!senderAllowed) {
      safeFinishStream(allowFromPolicy.rejectMessage || "当前账号未授权，请联系管理员。");
      return;
    }

    if (msgType === "text") {
      let commandKey = extractLeadingSlashCommand(commandBody);
      if (commandKey === "/clear") {
        commandBody = commandBody.replace(/^\/clear\b/i, "/reset");
        commandKey = "/reset";
      }
      if (commandKey) {
        const commandAllowed =
          commandPolicy.allowlist.includes(commandKey) ||
          (commandKey === "/reset" && commandPolicy.allowlist.includes("/clear"));
        if (commandPolicy.enabled && !isAdminUser && !commandAllowed) {
          safeFinishStream(commandPolicy.rejectMessage);
          return;
        }
        if (commandKey === "/help") {
          safeFinishStream(buildWecomBotHelpText());
          return;
        }
        if (commandKey === "/status") {
          safeFinishStream(buildWecomBotStatusText(api, fromUser));
          return;
        }
      }
    }

    const inboundContentResult = await buildBotInboundContent({
      api,
      botModeConfig,
      botProxyUrl,
      msgType,
      commandBody,
      normalizedImageUrls,
      normalizedFileUrl,
      normalizedFileName,
      normalizedQuote,
    });
    if (Array.isArray(inboundContentResult.tempPathsToCleanup)) {
      tempPathsToCleanup.push(...inboundContentResult.tempPathsToCleanup);
    }
    if (inboundContentResult.aborted) {
      safeFinishStream(inboundContentResult.abortText || "消息处理失败，请稍后重试。");
      return;
    }
    const messageText = String(inboundContentResult.messageText ?? "").trim();

    if (!messageText) {
      safeFinishStream("消息内容为空，请发送有效文本。");
      return;
    }

    const route = resolveWecomAgentRoute({
      runtime,
      cfg,
      channel: "wecom",
      accountId: "bot",
      sessionKey: baseSessionId,
      fromUser,
      chatId,
      isGroupChat,
      content: commandBody || messageText,
      mentionPatterns: groupChatPolicy.mentionPatterns,
      dynamicConfig: dynamicAgentPolicy,
      isAdminUser,
      logger: api.logger,
    });
    routedAgentId = String(route?.agentId ?? "").trim();
    sessionId = String(route?.sessionKey ?? "").trim() || baseSessionId;
    api.logger.info?.(
      `wecom(bot): routed agent=${route.agentId} session=${sessionId} matchedBy=${route.dynamicMatchedBy || route.matchedBy || "default"}`,
    );
    try {
      await seedDynamicAgentWorkspace({
        api,
        agentId: route.agentId,
        workspaceTemplate: dynamicAgentPolicy.workspaceTemplate,
      });
    } catch (seedErr) {
      api.logger.warn?.(`wecom(bot): workspace seed failed: ${String(seedErr?.message || seedErr)}`);
    }
    const storePath = runtime.channel.session.resolveStorePath(cfg.session?.store, {
      agentId: route.agentId,
    });
    const envelopeOptions = runtime.channel.reply.resolveEnvelopeFormatOptions(cfg);
    const contextTimestamp = Date.now();
    const body = runtime.channel.reply.formatInboundEnvelope({
      ...buildWecomBotInboundEnvelopePayload({
        fromUser,
        chatId,
        isGroupChat,
        messageText,
        timestamp: contextTimestamp,
      }),
      ...envelopeOptions,
    });
    const ctxPayload = runtime.channel.reply.finalizeInboundContext(
      buildWecomBotInboundContextPayload({
        body,
        messageText,
        originalContent,
        commandBody,
        fromAddress,
        sessionId,
        isGroupChat,
        chatId,
        fromUser,
        msgId,
        timestamp: contextTimestamp,
      }),
    );
    const sessionRuntimeId = String(ctxPayload.SessionId ?? "").trim();

    await runtime.channel.session.recordInboundSession({
      storePath,
      sessionKey: sessionId,
      ctx: ctxPayload,
      updateLastRoute: {
        sessionKey: sessionId,
        channel: "wecom",
        to: fromUser,
        accountId: "bot",
      },
      onRecordError: (err) => {
        api.logger.warn?.(`wecom(bot): failed to record session: ${err}`);
      },
    });

    runtime.channel.activity.record({
      channel: "wecom",
      accountId: "bot",
      direction: "inbound",
    });

    const dispatchState = {
      blockText: "",
      streamFinished: false,
    };
    let lateReplyWatcherPromise = null;
    const replyTimeoutMs = Math.max(15000, Number(botModeConfig?.replyTimeoutMs) || 90000);
    const lateReplyWatchMs = Math.max(30000, Number(botModeConfig?.lateReplyWatchMs) || 180000);
    const lateReplyPollMs = Math.max(500, Number(botModeConfig?.lateReplyPollMs) || 2000);
    const readTranscriptFallback = ensureTranscriptFallbackReader();
    const readTranscriptFallbackResult = async ({
      runtimeStorePath = storePath,
      runtimeSessionId = sessionId,
      runtimeTranscriptSessionId = sessionRuntimeId || sessionId,
      minTimestamp = dispatchStartedAt,
      logErrors = true,
    } = {}) =>
      readTranscriptFallback({
        storePath: runtimeStorePath,
        sessionId: runtimeSessionId,
        transcriptSessionId: runtimeTranscriptSessionId,
        minTimestamp,
        logger: api.logger,
        logErrors,
      });
    const tryFinishFromTranscript = async (minTimestamp = dispatchStartedAt) => {
      const fallback = await readTranscriptFallbackResult({
        runtimeStorePath: storePath,
        runtimeSessionId: sessionId,
        runtimeTranscriptSessionId: sessionRuntimeId || sessionId,
        minTimestamp,
      });
      if (!fallback.text) return false;
      dispatchState.streamFinished = await safeDeliverReply(fallback.text, "transcript-fallback");
      if (dispatchState.streamFinished && fallback.transcriptMessageId) {
        markTranscriptReplyDelivered(sessionId, fallback.transcriptMessageId);
        api.logger.info?.(
          `wecom(bot): filled reply from transcript session=${sessionId} messageId=${fallback.transcriptMessageId}`,
        );
      }
      return dispatchState.streamFinished;
    };
    startLateReplyWatcher = (reason = "dispatch-timeout", minTimestamp = dispatchStartedAt) => {
      if (dispatchState.streamFinished || lateReplyWatcherPromise) return false;
      const watchStartedAt = Date.now();
      const watchId = `wecom-bot:${sessionId}:${msgId || watchStartedAt}:${Math.random().toString(36).slice(2, 8)}`;
      const runLateReplyWatcher = ensureLateReplyWatcherRunner();
      lateReplyWatcherPromise = runLateReplyWatcher({
        watchId,
        reason,
        sessionId,
        sessionTranscriptId: sessionRuntimeId || sessionId,
        accountId: "bot",
        storePath,
        logger: api.logger,
        watchStartedAt,
        watchMs: lateReplyWatchMs,
        pollMs: lateReplyPollMs,
        activeWatchers: ACTIVE_LATE_REPLY_WATCHERS,
        isDelivered: () => dispatchState.streamFinished,
        markDelivered: () => {
          dispatchState.streamFinished = true;
        },
        sendText: async (text) => {
          const delivered = await safeDeliverReply(text, "late-transcript-fallback");
          if (!delivered) {
            throw new Error("late transcript delivery failed");
          }
        },
        onFailureFallback: async (watchErr) => {
          if (dispatchState.streamFinished) return;
          const reasonText = String(watchErr?.message || watchErr || "");
          const isTimeout = reasonText.includes("timed out");
          await safeDeliverReply(
            isTimeout
              ? "抱歉，当前模型请求超时或网络不稳定，请稍后重试。"
              : `抱歉，当前模型请求超时或网络不稳定，请稍后重试。\n故障信息: ${reasonText.slice(0, 160)}`,
            isTimeout ? "late-timeout-fallback" : "late-watcher-error",
          );
        },
      }).finally(() => {
        lateReplyWatcherPromise = null;
      });
      return true;
    };
    const dispatchHandlers = createWecomBotDispatchHandlers({
      api,
      streamId,
      state: dispatchState,
      hasBotStream,
      normalizeWecomBotOutboundMediaUrls,
      queueBotStreamMedia,
      updateBotStream,
      markdownToWecomText,
      isAgentFailureText,
      safeDeliverReply,
    });

    await withTimeout(
      runtime.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
        ctx: ctxPayload,
        cfg,
        replyOptions: {
          disableBlockStreaming: false,
          routeOverrides:
            routedAgentId && sessionId
              ? {
                  sessionKey: sessionId,
                  agentId: routedAgentId,
                  accountId: "bot",
                }
              : undefined,
        },
        dispatcherOptions: {
          deliver: dispatchHandlers.deliver,
          onError: dispatchHandlers.onError,
        },
      }),
      replyTimeoutMs,
      `dispatch timed out after ${replyTimeoutMs}ms`,
    );

    if (!dispatchState.streamFinished) {
      const filledFromTranscript = await tryFinishFromTranscript(dispatchStartedAt);
      if (filledFromTranscript) return;
      const fallback = markdownToWecomText(dispatchState.blockText).trim();
      if (fallback) {
        await safeDeliverReply(fallback, "block-fallback");
      } else {
        const watcherStarted = startLateReplyWatcher("dispatch-finished-without-final", dispatchStartedAt);
        if (watcherStarted) return;
        api.logger.warn?.(
          `wecom(bot): dispatch finished without deliverable content; late watcher unavailable, fallback to timeout text session=${sessionId}`,
        );
        await safeDeliverReply("抱歉，当前模型请求超时或网络不稳定，请稍后重试。", "timeout-fallback");
      }
    }
  } catch (err) {
    api.logger.warn?.(`wecom(bot): processing failed: ${String(err?.message || err)}`);
    if (isDispatchTimeoutError(err)) {
      const watcherStarted = (() => {
        try {
          return startLateReplyWatcher("dispatch-timeout", dispatchStartedAt);
        } catch {
          return false;
        }
      })();
      if (watcherStarted) return;
    }
    try {
      const runtimeSessionId = sessionId || buildWecomBotSessionId(fromUser);
      const runtimeStorePath = runtime.channel.session.resolveStorePath(cfg.session?.store, {
        agentId: routedAgentId || "main",
      });
      const fallbackFromTranscript = await readTranscriptFallbackResult({
        runtimeStorePath,
        runtimeSessionId,
        runtimeTranscriptSessionId: runtimeSessionId,
        minTimestamp: dispatchStartedAt,
        logErrors: false,
      });
      if (fallbackFromTranscript.text) {
        const delivered = await safeDeliverReply(fallbackFromTranscript.text, "catch-transcript-fallback");
        if (delivered && fallbackFromTranscript.transcriptMessageId) {
          markTranscriptReplyDelivered(runtimeSessionId, fallbackFromTranscript.transcriptMessageId);
        }
        return;
      }
    } catch {
      // ignore transcript fallback errors in catch block
    }
    await safeDeliverReply(
      `抱歉，当前模型请求超时或网络不稳定，请稍后重试。\n故障信息: ${String(err?.message || err).slice(0, 160)}`,
      "catch-timeout-fallback",
    );
  } finally {
    for (const filePath of tempPathsToCleanup) {
      scheduleTempFileCleanup(filePath, api.logger);
    }
  }
}


  return processBotInboundMessage;
}
