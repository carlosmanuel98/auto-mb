window.__mageTuntunBundle = window.__mageTuntunBundle || {};

window.__mageTuntunBundle.installTalkModule = function installTalkModule(bot) {
  const configStorageKey = "mageTuntun.talk.config";
  const legacyDefaultModels = ["gemini-3-pro-preview", "gemini-2.0-flash"];
  const defaultModel = "gemini-2.5-flash-lite";
  const defaultSystemPrompt =
    "You are a normal Tibia MMORPG player chatting in Minibia in live in-game chat. Every reply must be written in Spanish and must sound like Tibia player chat: casual, brief, informal, fully lowercase, and natural for a real player typing quickly. Use plain text only. Keep it under 90 characters and under 12 words. Prefer short phrasing, light slang, abbreviations, and simple punctuation when natural. Avoid polished grammar, title case, or assistant-like wording. Write like someone typing mid-hunt or while afk for a sec. Never say you are a bot or AI.";
  const defaultGreetingPrompt =
    "Respond to greetings like a Tibia MMORPG player in chat, always in Spanish. Be short, casual, friendly, and in-character for fast Tibia-style game chat. Use lowercase. One sentence only. Plain text only.";
  const defaultQuestionPrompt =
    "Respond to questions like a Tibia MMORPG player in chat, always in Spanish, but stay vague and noncommittal. Keep it brief, casual, and a little evasive. Use lowercase and do not explain much. One short sentence only. Plain text only. If asked whether you are a bot, reply with no.";
  const defaultStatementPrompt =
    "Respond to statements like a Tibia MMORPG player in chat, always in Spanish. Keep it short, casual, reactive, and natural for live Tibia-style game chat. Use lowercase. One sentence only. Plain text only.";
  const legacyDefaultSystemPrompt =
    "You are a normal Tibia MMORPG player chatting in Minibia in live in-game chat. Every reply must sound like Tibia player chat: casual, brief, informal, fully lowercase, and natural for a real player typing quickly. Use plain text only. Keep it under 90 characters and under 12 words. Prefer short Tibia-style phrasing, light slang, abbreviations, and simple punctuation when natural. Avoid polished grammar, title case, or assistant-like wording. Write like someone typing mid-hunt or while afk for a sec. Never say you are a bot or AI.";
  const legacyDefaultGreetingPrompt =
    "Respond to greetings like a Tibia MMORPG player in chat. Be short, casual, friendly, and in-character for fast Tibia-style game chat. Use lowercase. One sentence only. Plain text only.";
  const legacyDefaultQuestionPrompt =
    "Respond to questions like a Tibia MMORPG player in chat, but stay vague and noncommittal. Keep it brief, casual, and a little evasive. Use lowercase and do not explain much. One short sentence only. Plain text only. If asked whether you are a bot, reply with no.";
  const legacyDefaultStatementPrompt =
    "Respond to statements like a Tibia MMORPG player in chat. Keep it short, casual, reactive, and natural for live Tibia-style game chat. Use lowercase. One sentence only. Plain text only.";
  const minPollMs = 1000;
  const maxMessageAgeMs = 2 * 60 * 1000;
  const state = {
    running: false,
    pending: false,
    timerId: null,
    lastReplyAt: 0,
    seenKeys: [],
    seenSignatures: [],
  };
  const playerReplies = ["hola", "claro", "como va?", "todo bien?", "buenassss", "dime", "si?", "aca toy", "q onda"];
  const greetingReplies = ["hola", "buenassss", "como va?", "q onda", "buenas", "wena", "ey"];
  const presenceOrBotReplies = ["hola", "claro", "como va?", "todo bien?", "buenassss", "dime", "si?", "aca toy", "here"];
  const agreeReplies = ["claro", "see", "de una", "mal", "si", "obvio", "jajaja", "xd"];
  const vagueQuestionReplies = ["todo bien?", "como va?", "claro", "ni idea", "ns", "capaz", "despues veo"];

  function getRandomBetween(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  const config = Object.assign(
    {
      enabled: false,
      apiKey: "",
      model: defaultModel,
      pollMs: minPollMs,
      replyCooldownMs: 1500,
      systemPrompt: defaultSystemPrompt,
      greetingPrompt: defaultGreetingPrompt,
      questionPrompt: defaultQuestionPrompt,
      statementPrompt: defaultStatementPrompt,
    },
    bot.storage.get(configStorageKey, {})
  );

  function persistConfig() {
    bot.storage.set(configStorageKey, { ...config });
  }

  function normalizeText(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
  }

  function sanitizeConfig() {
    config.apiKey = String(config.apiKey || "").trim();
    config.model = String(config.model || defaultModel).trim() || defaultModel;
    if (legacyDefaultModels.includes(config.model)) {
      config.model = defaultModel;
    }
    config.pollMs = Math.max(minPollMs, Number(config.pollMs) || minPollMs);
    config.replyCooldownMs = Math.max(0, Number(config.replyCooldownMs) || 1500);
    config.systemPrompt = String(config.systemPrompt || defaultSystemPrompt).trim() || defaultSystemPrompt;
    config.greetingPrompt = String(config.greetingPrompt || defaultGreetingPrompt).trim() || defaultGreetingPrompt;
    config.questionPrompt = String(config.questionPrompt || defaultQuestionPrompt).trim() || defaultQuestionPrompt;
    config.statementPrompt = String(config.statementPrompt || defaultStatementPrompt).trim() || defaultStatementPrompt;

    // Migrate saved configs that still hold the old English default prompts.
    if (config.systemPrompt === legacyDefaultSystemPrompt) {
      config.systemPrompt = defaultSystemPrompt;
    }
    if (config.greetingPrompt === legacyDefaultGreetingPrompt) {
      config.greetingPrompt = defaultGreetingPrompt;
    }
    if (config.questionPrompt === legacyDefaultQuestionPrompt) {
      config.questionPrompt = defaultQuestionPrompt;
    }
    if (config.statementPrompt === legacyDefaultStatementPrompt) {
      config.statementPrompt = defaultStatementPrompt;
    }
  }

  function trimSeen() {
    const maxSeenEntries = 200;
    if (state.seenKeys.length > maxSeenEntries) {
      state.seenKeys = state.seenKeys.slice(-maxSeenEntries);
    }

    if (state.seenSignatures.length > maxSeenEntries) {
      state.seenSignatures = state.seenSignatures.slice(-maxSeenEntries);
    }
  }

  function getSelfNames() {
    return new Set(
      ["you", bot.getPlayerName?.(), window.gameClient?.player?.name, window.gameClient?.player?.state?.name]
        .map((name) => normalizeText(name))
        .filter(Boolean)
    );
  }

  function extractSenderFromMessage(message) {
    const text = String(message || "").trim();
    if (!text) {
      return { sender: null, body: "" };
    }

    const patterns = [
      /^\[[^\]]+\]\s*([^:\n]{2,40}):\s+(.+)$/i,
      /^([^:\n]{2,40}):\s+(.+)$/i,
      /^([^:\n]{2,40})\s+says:\s+(.+)$/i,
      /^From\s+([^:\n]{2,40}):\s+(.+)$/i,
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        return {
          sender: String(match[1] || "").trim() || null,
          body: String(match[2] || "").trim(),
        };
      }
    }

    return { sender: null, body: text };
  }

  function getRawChatEntries() {
    return (window.gameClient?.interface?.channelManager?.channels || []).flatMap((channel) =>
      (channel?.__contents || []).map((entry, index) => ({
        channelName: channel?.name || null,
        entry,
        index,
      }))
    );
  }

  function toChatMessage(rawEntry) {
    const entry = rawEntry?.entry || {};
    const rawMessage = String(entry?.message || entry?.text || "").trim();
    const parsed = extractSenderFromMessage(rawMessage);
    const sender =
      String(entry?.author || entry?.sender || entry?.name || parsed.sender || "").trim() || null;
    const body = String(entry?.text || parsed.body || rawMessage).trim();
    const time = entry?.__time || entry?.time || null;
    const senderType = entry?.type;
    const key = [
      rawEntry?.channelName || "",
      time || "",
      sender || "",
      rawMessage || "",
      rawEntry?.index || 0,
    ].join("|");

    return {
      key,
      channelName: rawEntry?.channelName || null,
      sender,
      body,
      rawMessage,
      time,
      senderType,
    };
  }

  function getChatMessages() {
    return getRawChatEntries().map(toChatMessage).filter((message) => message.body);
  }

  function getMessageTimestamp(message) {
    const rawTime = message?.time;
    if (typeof rawTime === "number" && Number.isFinite(rawTime)) {
      return rawTime < 1e12 ? rawTime * 1000 : rawTime;
    }

    if (rawTime instanceof Date) {
      return rawTime.getTime();
    }

    const parsed = Date.parse(String(rawTime || ""));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function getMessageSignature(message) {
    return [
      normalizeText(message?.channelName),
      normalizeText(message?.sender),
      normalizeText(message?.body || message?.rawMessage),
      String(getMessageTimestamp(message) || ""),
    ].join("|");
  }

  function hasSeenMessage(message) {
    return state.seenKeys.includes(message?.key) || state.seenSignatures.includes(getMessageSignature(message));
  }

  function rememberSeenMessage(message) {
    if (!message) {
      return;
    }

    if (message.key && !state.seenKeys.includes(message.key)) {
      state.seenKeys.push(message.key);
    }

    const signature = getMessageSignature(message);
    if (signature && !state.seenSignatures.includes(signature)) {
      state.seenSignatures.push(signature);
    }

    trimSeen();
  }

  function rememberSeenMessages(messages) {
    messages.forEach((message) => rememberSeenMessage(message));
  }

  function isSelfMessage(message) {
    if (getSelfNames().has(normalizeText(message?.sender))) {
      return true;
    }

    return [message?.body, message?.rawMessage].some((text) => bot.isRecentSentChat?.(text, 20000));
  }

  function isTrustedSender(message) {
    const senderName = normalizeText(message?.sender);
    if (!senderName) {
      return false;
    }

    const trustedNames = bot.panic?.getTrustedNames?.() || [];
    return trustedNames.includes(senderName);
  }

  function isNpcMessage(message) {
    const npcType = window.CONST?.TYPES?.NPC;
    return npcType != null && message?.senderType === npcType;
  }

  function isWithinVisibleRange(me, pos) {
    if (!me || !pos) {
      return false;
    }

    const dx = Math.abs(pos.x - me.x);
    const dy = Math.abs(pos.y - me.y);
    return dx <= 8 && dy <= 6;
  }

  function isSenderVisiblePlayer(message) {
    const me = bot.getPlayerPosition?.();
    const myId = window.gameClient?.player?.id;
    const senderName = normalizeText(message?.sender);
    const playerType = window.CONST?.TYPES?.PLAYER;

    if (!me || !senderName || playerType == null) {
      return false;
    }

    return Object.values(window.gameClient?.world?.activeCreatures || {}).some((creature) => {
      if (!creature) {
        return false;
      }

      if (creature.id === myId || creature.type !== playerType) {
        return false;
      }

      if (normalizeText(creature.name) !== senderName) {
        return false;
      }

      return isWithinVisibleRange(me, creature.__position);
    });
  }

  function getDefaultMessages() {
    return getChatMessages().filter((message) => message.channelName === "Default");
  }

  function getNewestPendingMessage() {
    const pendingMessages = getDefaultMessages().filter((message) => {
      if (!message?.body || !message?.key) {
        return false;
      }

      if (hasSeenMessage(message)) {
        return false;
      }

      if (!message.sender || isSelfMessage(message) || isNpcMessage(message) || isTrustedSender(message)) {
        rememberSeenMessage(message);
        return false;
      }

      const timestamp = getMessageTimestamp(message);
      if (timestamp && Date.now() - timestamp > maxMessageAgeMs) {
        rememberSeenMessage(message);
        return false;
      }

      return true;
    });

    if (!pendingMessages.length) {
      return null;
    }

    return {
      targetMessage: pendingMessages[pendingMessages.length - 1],
      pendingMessages,
    };
  }

  function buildClassifierPrompt(targetMessage, contextMessages) {
    const transcript = contextMessages
      .map((message) => `${message.sender || "player"}: ${message.body}`)
      .join("\n");

    return [
      "Channel: Default",
      "Recent chat:",
      transcript || "(none)",
      "",
      `Last message from ${targetMessage.sender}: ${targetMessage.body}`,
      "Classify the last message as exactly one label:",
      "greeting",
      "question",
      "statement",
      "Reply with the label only.",
    ].join("\n");
  }

  function getTypePrompt(messageType) {
    if (messageType === "greeting") {
      return config.greetingPrompt;
    }

    if (messageType === "question") {
      return config.questionPrompt;
    }

    return config.statementPrompt;
  }

  function buildReplyPrompt(targetMessage, contextMessages, messageType) {
    const transcript = contextMessages
      .map((message) => `${message.sender || "player"}: ${message.body}`)
      .join("\n");

    return [
      config.systemPrompt,
      getTypePrompt(messageType),
      "",
      "Channel: Default",
      `Message type: ${messageType}`,
      "Recent chat:",
      transcript || "(none)",
      "",
      `Last message from ${targetMessage.sender}: ${targetMessage.body}`,
      "Reply with one short sentence only.",
      "Avoid repeating the same wording again and again.",
      "Reply text only:",
    ].join("\n");
  }

  async function generateText(prompt, generationConfig = {}) {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.model)}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": config.apiKey,
        },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [{ text: prompt }],
            },
          ],
          generationConfig: Object.assign(
            {
              temperature: 0.9,
              topP: 0.95,
              maxOutputTokens: 40,
            },
            generationConfig
          ),
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gemini request failed (${response.status}): ${errorText}`);
    }

    const data = await response.json();
    return (
      data?.candidates?.[0]?.content?.parts
        ?.map((part) => String(part?.text || ""))
        .join(" ")
        .trim() || ""
    );
  }

  async function classifyMessageType(targetMessage, contextMessages) {
    const rawType = normalizeText(
      await generateText(buildClassifierPrompt(targetMessage, contextMessages), {
        temperature: 0.1,
        topP: 0.8,
        maxOutputTokens: 8,
      })
    );

    if (rawType === "greeting" || rawType === "question" || rawType === "statement") {
      return rawType;
    }

    if (isGreeting(targetMessage?.body)) {
      return "greeting";
    }

    if (/\?/.test(String(targetMessage?.body || ""))) {
      return "question";
    }

    return "statement";
  }

  function sanitizeReply(text) {
    const singleLine = String(text || "")
      .replace(/\s+/g, " ")
      .replace(/^["'`]+|["'`]+$/g, "")
      .trim();

    if (!singleLine) {
      return "";
    }

    const firstSentence = singleLine.split(/(?<=[.!?])\s+/)[0] || singleLine;
    const trimmed = firstSentence.slice(0, 90).trim();
    if (!trimmed) {
      return "";
    }

    if (trimmed === "?") {
      return bot.isRecentSentChat?.("?", 20000) ? "" : "?";
    }

    const styled = trimmed
      .toLowerCase()
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'")
      .replace(/^[¿¡]+/g, "")
      .replace(/\s+([,.!?])/g, "$1")
      .replace(/([!?.,]){2,}/g, "$1")
      .trim();

    const normalized = normalizeText(styled);
    if (!normalized || /^[^a-z0-9]+$/i.test(styled)) {
      return "";
    }

    if (/\b(soy (un |una )?(bot|ia|robot|asistente)|as an ai|language model|modelo de lenguaje|asistente virtual)\b/i.test(styled)) {
      return "";
    }

    if (bot.isRecentSentChat?.(styled, 20000)) {
      return "";
    }

    return styled;
  }

  function pickUnusedReply(replies, withinMs = 30000, fallback = "?") {
    for (const reply of replies) {
      if (!bot.isRecentSentChat?.(reply, withinMs)) {
        return reply;
      }
    }

    return fallback;
  }

  function isGreeting(text) {
    return /^(hi|hey|yo|sup|howdy|hello|hiya|h[oó]la|s[aá]ludos|buenos d[ií]as|buenas tardes|buenas noches|qu[eé] tal|qu[eé] onda|ey|buenas|wena)\b/i.test(String(text || "").trim());
  }

  function isBotOrPresenceQuestion(text) {
    return /\b(are you|u|r u|are u)\b.*\b(there|here|bot|afk|on)\b|\b(there|here|bot)\b.*\?|\b(sos|eres|es|tas|estas)\b.*\b(bot|ia|macro|robot|ahi|on|aca)\b|\b(estas|tas)\s+(ahi|on|aca)\b|\b(here|bot)\?+/i.test(String(text || ""));
  }

  function isSimpleReaction(text) {
    return /^(based|true|real|lol|lmao|xd|nice|ok|kk|k|jaja|jajaja|s[ií]|vale|claro|de una|bien|mal|see|sep)\b[!.?]*$/i.test(String(text || "").trim());
  }

  function pickFallbackReply(targetMessage, messageType) {
    const messageText = String(targetMessage?.body || "").trim();

    if (messageType === "bot" || isBotOrPresenceQuestion(messageText)) {
      return pickUnusedReply(presenceOrBotReplies, 25000, "hola");
    }

    if (messageType === "greeting" || isGreeting(messageText)) {
      return pickUnusedReply(greetingReplies, 15000, "hola");
    }

    if (messageType === "statement" && isSimpleReaction(messageText)) {
      return pickUnusedReply(agreeReplies, 15000, "claro");
    }

    if (messageType === "question" || /\?$/.test(messageText)) {
      return pickUnusedReply(vagueQuestionReplies, 20000, "como va?");
    }

    return pickUnusedReply(playerReplies, 25000, "todo bien?");
  }

  async function maybeRespond() {
    if (!state.running || state.pending || !config.enabled) {
      return false;
    }

    if (Date.now() - state.lastReplyAt < config.replyCooldownMs) {
      return false;
    }

    const pending = getNewestPendingMessage();
    if (!pending?.targetMessage) {
      return false;
    }

    state.pending = true;

    try {
      const contextMessages = getDefaultMessages().slice(-6);
      if (!isSenderVisiblePlayer(pending.targetMessage)) {
        rememberSeenMessages(pending.pendingMessages);
        bot.log("talk skipped reply", {
          sender: pending.targetMessage.sender,
          message: pending.targetMessage.body,
          reason: "sender-not-visible",
        });
        return false;
      }

      let reply = "";
      let messageType = "statement";
      const msgBody = String(pending.targetMessage?.body || "");

      if (isBotOrPresenceQuestion(msgBody)) {
        messageType = "bot";
        reply = pickFallbackReply(pending.targetMessage, "bot");
      } else if (config.apiKey) {
        try {
          messageType = await classifyMessageType(pending.targetMessage, contextMessages);
          const rawReply = await generateText(buildReplyPrompt(pending.targetMessage, contextMessages, messageType));
          reply = sanitizeReply(rawReply);
        } catch (error) {
          bot.log("talk generation failed, using fallback", error?.message || error);
        }
      }

      if (!reply) {
        if (isGreeting(msgBody)) messageType = "greeting";
        else if (isSimpleReaction(msgBody)) messageType = "statement";
        else if (/\?/.test(msgBody)) messageType = "question";
        reply = sanitizeReply(pickFallbackReply(pending.targetMessage, messageType));
      }

      rememberSeenMessages(pending.pendingMessages);

      if (!reply) {
        bot.log("talk skipped reply", {
          sender: pending.targetMessage.sender,
          message: pending.targetMessage.body,
          messageType,
        });
        return false;
      }

      // Natural human typing delay (3s to 5.5s) so the character doesn't reply instantly
      const typingDelay = getRandomBetween(3000, 5500);
      await new Promise((resolve) => window.setTimeout(resolve, typingDelay));

      // The API response or typing delay takes a moment. Do not answer someone who has
      // left the visible area or become invisible while waiting.
      if (!isSenderVisiblePlayer(pending.targetMessage)) {
        bot.log("talk skipped reply", {
          sender: pending.targetMessage.sender,
          message: pending.targetMessage.body,
          reason: "sender-no-longer-visible",
        });
        return false;
      }

      const sent = bot.sendChat(reply);
      if (sent) {
        state.lastReplyAt = Date.now();
        bot.log("talk replied", {
          sender: pending.targetMessage.sender,
          message: pending.targetMessage.body,
          messageType,
          reply,
        });
      }

      return sent;
    } finally {
      state.pending = false;
    }
  }

  function scheduleNextTick() {
    if (!state.running) {
      return;
    }

    state.timerId = window.setTimeout(async () => {
      try {
        await maybeRespond();
      } catch (error) {
        bot.log("talk request failed", error?.message || error);
      }

      scheduleNextTick();
    }, config.pollMs);
  }

  function seedSeenMessages() {
    rememberSeenMessages(getDefaultMessages());
  }

  function start(overrides = {}) {
    Object.assign(config, overrides, { enabled: true });
    sanitizeConfig();
    persistConfig();

    if (state.running) {
      return false;
    }

    state.running = true;
    seedSeenMessages();
    bot.log("talk module started", {
      mode: config.apiKey ? `gemini (${config.model})` : "player-replies (sin api key)",
      channel: "Default",
    });
    scheduleNextTick();
    return true;
  }

  function stop(options = {}) {
    const shouldPersistEnabled = options.persistEnabled !== false;
    state.running = false;

    if (shouldPersistEnabled) {
      config.enabled = false;
      persistConfig();
    }

    if (state.timerId != null) {
      window.clearTimeout(state.timerId);
      state.timerId = null;
    }

    return true;
  }

  function status() {
    return {
      running: state.running,
      pending: state.pending,
      lastReplyAt: state.lastReplyAt,
      config: {
        ...config,
        apiKey: config.apiKey ? "***configured***" : "",
      },
    };
  }

  function updateConfig(nextConfig = {}) {
    Object.assign(config, nextConfig);
    sanitizeConfig();
    persistConfig();
    return status().config;
  }

  sanitizeConfig();

  if (config.enabled && config.apiKey) {
    start();
  }

  bot.talk = {
    start,
    stop,
    status,
    updateConfig,
    getChatMessages,
    config,
  };
};
