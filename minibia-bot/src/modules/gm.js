window.__mageTuntunBundle = window.__mageTuntunBundle || {};

window.__mageTuntunBundle.installGmModule = function installGmModule(bot) {
  const configStorageKey = "mageTuntun.gm.config";
  const defaultStaffNames = ["God Minibia", "Gamemaster", "GM"];
  const defaultFirstReplies = ["hola", "claro", "como va?", "todo bien?", "buenassss", "dime", "si?", "aca toy", "q onda", "exura"];
  const defaultSecondReplies = ["todo bien?", "como va?", "pasa algo?", "aca ando", "toy cazando", "exura", ":)"];
  const legacyDefaultFirstReplies = [
    ["hi", "hey", "hello", "hi there", "yo", "hey :)"],
    ["hola", "hey", "hola!", "qué tal", "yo", "hey :)"],
    ["dime", "q onda", "buenas", "hola", "epa", "q paso", "wena", "si?", "mande", "aca toy", "exura"],
  ];
  const legacyDefaultSecondReplies = [
    ["exura", "all good?", "sup", "what's up?", ":)", "hmm?"],
    ["exura", "todo bien?", "qué hay?", "qué onda?", ":)", "mmm?"],
    ["dime jefe", "todo bien?", "pasa algo?", "aca ando", "toy cazando", "q se cuenta?", "exura", "si aca toy", "xd", ":)"],
  ];

  const state = {
    running: false,
    timerId: null,
    tickMs: 350,
    gmSeenHistory: new Map(),
    pausedAutomations: null,
    captchaSolveAttempted: false,
    captchaSolveTimerId: null,
    isGmCurrentlyVisible: false,
    captchaActive: false,
    countdownActive: false,
    countdownUntil: 0,
    seenChatKeys: new Set(),
    seenStaffChatKeys: new Set(),
    replyTimers: [],
  };

  const config = Object.assign(
    {
      enabled: false,
      staffNames: [...defaultStaffNames],
      reactOnGmVisible: true,
      reactOnGmChat: true,
      autoRepliesEnabled: false,
      pauseHuntingOnGm: true,
      ignoreGmInPz: true,
      soundOnGm: true,
      dontReactAgainMs: 10 * 60 * 1000,
      reactOnNameMention: true,
      soundOnName: true,
      firstReplies: [...defaultFirstReplies],
      secondReplies: [...defaultSecondReplies],
      firstReplyMinDelayMs: 4000,
      firstReplyMaxDelayMs: 7000,
      secondReplyMinDelayMs: 6000,
      secondReplyMaxDelayMs: 12000,
      captchaWatcherEnabled: true,
      soundOnCaptcha: true,
      pauseOnCaptcha: true,
      captchaAutoSolveEnabled: true,
      captchaAutoSolveDelayMs: 1500,
    },
    bot.storage.get(configStorageKey, {})
  );
  // Avoid instant replies. These lower bounds also migrate previously saved, faster values.
  config.firstReplyMinDelayMs = Math.max(4000, Number(config.firstReplyMinDelayMs) || 4000);
  config.firstReplyMaxDelayMs = Math.max(config.firstReplyMinDelayMs, Number(config.firstReplyMaxDelayMs) || 7000);
  config.secondReplyMinDelayMs = Math.max(6000, Number(config.secondReplyMinDelayMs) || 6000);
  config.secondReplyMaxDelayMs = Math.max(config.secondReplyMinDelayMs, Number(config.secondReplyMaxDelayMs) || 12000);

  // Migrate saved configs that still hold old default replies.
  if (legacyDefaultFirstReplies.some((legacy) => isSameReplyList(config.firstReplies, legacy))) {
    config.firstReplies = [...defaultFirstReplies];
  }
  if (legacyDefaultSecondReplies.some((legacy) => isSameReplyList(config.secondReplies, legacy))) {
    config.secondReplies = [...defaultSecondReplies];
  }

  function persistConfig() {
    bot.storage.set(configStorageKey, { ...config });
  }

  function normalizeText(value) {
    return String(value || "")
      .trim()
      .toLowerCase();
  }

  function normalizeCharacterName(value) {
    return normalizeText(value)
      .replace(/\s*\[[^\]]*\]\s*/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function getRandomBetween(min, max) {
    const minVal = Math.min(min, max);
    const maxVal = Math.max(min, max);
    return Math.floor(Math.random() * (maxVal - minVal + 1)) + minVal;
  }

  function pickRandom(array) {
    if (!Array.isArray(array) || !array.length) return null;
    return array[Math.floor(Math.random() * array.length)];
  }

  function isSameReplyList(value, reference) {
    if (!Array.isArray(value) || value.length !== reference.length) return false;
    return value.every((entry, index) => String(entry || "").trim() === reference[index]);
  }

  function clearReplyTimers() {
    while (state.replyTimers.length) {
      const timerId = state.replyTimers.pop();
      window.clearTimeout(timerId);
    }
  }

  function pauseAutomations(reason) {
    if (state.pausedAutomations) {
      return;
    }

    state.pausedAutomations = {
      cave: !!bot.cave?.status?.().running,
      attack: !!bot.attack?.status?.().running,
      rune: !!bot.rune?.status?.().running,
    };

    if (state.pausedAutomations.cave) {
      bot.cave?.stop?.({ reason });
      bot.ui?.refreshCaveStatus?.();
    }

    if (state.pausedAutomations.attack) {
      bot.attack?.stop?.();
      bot.ui?.refreshAutoAttackStatus?.();
    }

    if (state.pausedAutomations.rune) {
      bot.rune?.stop?.();
      bot.ui?.refreshRuneStatus?.();
    }

    bot.log("gm module paused hunting/automations", { reason, previous: state.pausedAutomations });
  }

  function resumeAutomations() {
    if (!state.pausedAutomations) {
      return;
    }

    const { cave, attack, rune } = state.pausedAutomations;
    state.pausedAutomations = null;

    if (cave && bot.cave?.start) {
      bot.cave.start();
      bot.ui?.refreshCaveStatus?.();
    }

    if (attack && bot.attack?.start) {
      bot.attack.start();
      bot.ui?.refreshAutoAttackStatus?.();
    }

    if (rune && bot.rune?.start) {
      bot.rune.start();
      bot.ui?.refreshRuneStatus?.();
    }

    bot.log("gm module resumed automations", { cave, attack, rune });
  }

  function getStaffNames() {
    return Array.from(
      new Set((config.staffNames || []).map(normalizeText).filter(Boolean))
    );
  }

  function isPlayerInProtectionZone() {
    if (!config.ignoreGmInPz) {
      return false;
    }

    const player = window.gameClient?.player;
    const pzConditionId = window.ConditionManager?.prototype?.PROTECTION_ZONE ?? 5;
    if (player?.conditions?.has?.(pzConditionId) || player?.hasCondition?.(pzConditionId)) {
      return true;
    }

    return !!bot.pz?.isPositionInPz?.(bot.getPlayerPosition?.());
  }

  function isCreatureVisuallyVisible(creature, me) {
    if (!creature?.__position || creature.__position.z !== me?.z) {
      return false;
    }

    const invisibleConditionId = window.ConditionManager?.prototype?.INVISIBLE ?? 4;
    if (creature?.conditions?.has?.(invisibleConditionId) || creature?.hasCondition?.(invisibleConditionId)) {
      return false;
    }

    // The client uses outfit id 0 for invisible/ghost creatures.
    if (Number(creature?.outfit?.id) === 0) {
      return false;
    }

    return true;
  }

  function getVisibleStaffCreatures() {
    const me = bot.getPlayerPosition?.();
    if (!me) return [];

    const staffNamesSet = new Set(getStaffNames());
    const creatures = bot.xray?.getVisibleCreatures?.({ sameFloorOnly: true }) || [];

    return creatures.filter((creature) => {
      if (!creature || creature.id === window.gameClient?.player?.id) {
        return false;
      }

      const name = normalizeCharacterName(creature.name);
      const isStaffName = !!name && staffNamesSet.has(name);

      // Creature.type is not reliable enough to identify staff in this client: ordinary
      // players can share the same value. Only explicitly configured staff names count.
      if (!isStaffName) {
        return false;
      }

      if (!isCreatureVisuallyVisible(creature, me)) {
        return false;
      }

      return true;
    });
  }

  function isStaffStillVisible(staffName) {
    const expectedName = normalizeText(staffName);
    return getVisibleStaffCreatures().some((staff) => {
      return !expectedName || normalizeText(staff.name) === expectedName;
    });
  }

  function queueRandomReplies(triggerReason, staffName = null) {
    clearReplyTimers();

    if (!config.autoRepliesEnabled) {
      bot.log("gm detector: automatic replies are disabled", { trigger: triggerReason });
      return;
    }

    const firstMsg = pickRandom(config.firstReplies);
    if (!firstMsg) return;

    const delay1 = getRandomBetween(config.firstReplyMinDelayMs || 1500, config.firstReplyMaxDelayMs || 3000);
    const timer1 = window.setTimeout(() => {
      if (!isStaffStillVisible(staffName)) {
        bot.log("gm detector cancelled reply: staff no longer visible", { trigger: triggerReason });
        return;
      }

      bot.sendChat?.(firstMsg);
      bot.log("gm detector sent 1st reply", { message: firstMsg, trigger: triggerReason });

      const secondMsg = pickRandom(config.secondReplies);
      if (secondMsg) {
        const delay2 = getRandomBetween(config.secondReplyMinDelayMs || 2500, config.secondReplyMaxDelayMs || 4500);
        const timer2 = window.setTimeout(() => {
          if (!isStaffStillVisible(staffName)) {
            bot.log("gm detector cancelled follow-up: staff no longer visible", { trigger: triggerReason });
            return;
          }

          bot.sendChat?.(secondMsg);
          bot.log("gm detector sent 2nd reply", { message: secondMsg, trigger: triggerReason });
        }, delay2);
        state.replyTimers.push(timer2);
      }
    }, delay1);

    state.replyTimers.push(timer1);
  }

  function checkGmDetection() {
    if (!config.reactOnGmVisible) {
      return;
    }

    const staff = getVisibleStaffCreatures();
    const isNowVisible = staff.length > 0;

    if (isNowVisible) {
      state.isGmCurrentlyVisible = true;
      const staffNames = staff.map((s) => s.name || "GM");
      const primaryName = normalizeText(staffNames[0]);
      const now = Date.now();
      const lastReactedAt = state.gmSeenHistory.get(primaryName) || 0;
      const cooldown = Math.max(10000, Number(config.dontReactAgainMs) || 600000);

      if (config.pauseHuntingOnGm) {
        pauseAutomations(`GM on screen: ${staffNames.join(", ")}`);
      }

      if (now - lastReactedAt >= cooldown) {
        state.gmSeenHistory.set(primaryName, now);
        bot.log("gm detected on screen", { staff: staffNames });

        if (config.soundOnGm && !isPlayerInProtectionZone()) {
          bot.playAlarm?.();
        }

        queueRandomReplies(`GM: ${staffNames.join(", ")}`, primaryName);
      }
    } else {
      if (state.isGmCurrentlyVisible) {
        state.isGmCurrentlyVisible = false;
        clearReplyTimers();
        bot.log("gm no longer on screen");
        if (!state.captchaActive) {
          resumeAutomations();
        }
      }
    }
  }

  function parseChatMessage(rawMessage) {
    const text = String(rawMessage || "").trim();
    const match = text.match(/^(.+?)\s+says:\s+(.+)$/i) || text.match(/^([^:\n]{2,80}):\s+(.+)$/);
    return match
      ? { sender: match[1].trim(), body: match[2].trim() }
      : { sender: "", body: text };
  }

  function getRecentMessages() {
    return (window.gameClient?.interface?.channelManager?.channels || []).flatMap((channel) =>
      (channel?.__contents || []).map((entry) => {
        const message = String(entry?.message || entry?.text || "");
        const parsed = parseChatMessage(message);
        return {
          channelName: channel?.name || null,
          message: parsed.sender ? parsed.body : String(entry?.text || parsed.body || message),
          sender:
            String(entry?.author || entry?.sender || entry?.name || parsed.sender || "").trim(),
          time: entry?.__time || null,
          senderType: entry?.type ?? entry?.senderType ?? null,
        };
      })
    );
  }

  function shouldReactToNameMention(message) {
    const playerType = window.CONST?.TYPES?.PLAYER;
    const senderName = normalizeCharacterName(message?.sender);
    if (!senderName) {
      return false;
    }

    const senderCreature = Object.values(window.gameClient?.world?.activeCreatures || {}).find(
      (creature) => normalizeCharacterName(creature?.name) === senderName
    );
    if (!senderCreature) {
      return false;
    }

    if (playerType != null && senderCreature.type === playerType) {
      return true;
    }

    // NPCs and creatures in a spawn are allowed; city NPCs are excluded by the PZ tile.
    return !bot.pz?.isPositionInPz?.(senderCreature.__position);
  }

  function isStaffSender(sender) {
    const normalizedSender = normalizeCharacterName(sender);
    return !!normalizedSender && getStaffNames().includes(normalizedSender);
  }

  function checkGmChat() {
    if (!config.reactOnGmChat) {
      return;
    }

    for (const msg of getRecentMessages()) {
      const key = `${msg.channelName}|${msg.time}|${msg.sender}|${msg.message}`;
      if (state.seenStaffChatKeys.has(key)) {
        continue;
      }
      state.seenStaffChatKeys.add(key);

      if (!isStaffSender(msg.sender)) {
        continue;
      }

      const staffName = normalizeCharacterName(msg.sender);
      const now = Date.now();
      const lastReactedAt = state.gmSeenHistory.get(staffName) || 0;
      const cooldown = Math.max(10000, Number(config.dontReactAgainMs) || 600000);
      if (now - lastReactedAt < cooldown) {
        continue;
      }

      // A chat message alone is not enough: the staff member must still be
      // on screen before alerting, pausing, or scheduling any response.
      if (!isStaffStillVisible(staffName)) {
        bot.log("gm chat ignored: staff not visible", { sender: msg.sender });
        continue;
      }

      state.gmSeenHistory.set(staffName, now);
      bot.log("gm message detected", { sender: msg.sender, message: msg.message });
      if (config.pauseHuntingOnGm) {
        pauseAutomations(`GM message from ${msg.sender}`);
      }
      if (config.soundOnGm && !isPlayerInProtectionZone()) {
        bot.playAlarm?.();
      }
      queueRandomReplies(`GM chat: ${msg.sender}`, staffName);
    }

    if (state.seenStaffChatKeys.size > 200) {
      state.seenStaffChatKeys = new Set(Array.from(state.seenStaffChatKeys).slice(-100));
    }
  }

  function isElementVisible(element) {
    const style = window.getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) {
      return false;
    }
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function checkNameMention() {
    if (!config.reactOnNameMention) {
      return;
    }

    const selfName = normalizeCharacterName(bot.getPlayerName?.());
    if (!selfName) {
      return;
    }

    const messages = getRecentMessages();
    for (const msg of messages) {
      const key = `${msg.channelName}|${msg.time}|${msg.sender}|${msg.message}`;
      if (state.seenChatKeys.has(key)) {
        continue;
      }
      state.seenChatKeys.add(key);

      const senderNorm = normalizeCharacterName(msg.sender);
      if ((senderNorm && senderNorm === selfName) || !shouldReactToNameMention(msg)) {
        continue;
      }

      const bodyNorm = normalizeText(msg.message);
      if (bodyNorm.includes(selfName)) {
        bot.log("character name mentioned in chat", { sender: msg.sender, message: msg.message });

        if (config.soundOnName && !isPlayerInProtectionZone()) {
          bot.playAlarm?.();
        }

        if (config.pauseHuntingOnGm) {
          pauseAutomations(`Name mentioned by ${msg.sender || "unknown"}`);
        }

        queueRandomReplies(`Name mention by ${msg.sender || "unknown"}`);
        break;
      }
    }

    if (state.seenChatKeys.size > 200) {
      state.seenChatKeys = new Set(Array.from(state.seenChatKeys).slice(-100));
    }
  }

  function isAntiBotWarningCountdown() {
    try {
      const warningRegex = /anti-bot.*(appear in|in \d+ seconds|aparecer[aá])|(will appear in|aparecer[aá] en)\s+\d+\s+(seconds|segundos)|anti-bot verification will appear/i;

      // 1. Check screenElementManager active text elements
      if (window.gameClient?.interface?.screenElementManager?.activeTextElements) {
        for (const item of window.gameClient.interface.screenElementManager.activeTextElements) {
          const msg = item?.__message || item?.element?.textContent || "";
          if (warningRegex.test(msg)) {
            return true;
          }
        }
      }

      // 2. Check DOM server-message, notification, zone-message
      for (const id of ["server-message", "notification", "zone-message"]) {
        const el = document.getElementById(id);
        if (el && isElementVisible(el)) {
          if (warningRegex.test(el.textContent || "")) {
            return true;
          }
        }
      }

      // 3. Check screen floating elements and DOM
      const candidates = document.querySelectorAll(".screen-element, .floating-text, .message-element, div, span, p");
      for (const el of candidates) {
        if (!el || el.id === "mage-tuntun-panel" || el.closest("#mage-tuntun-panel")) {
          continue;
        }
        if (!isElementVisible(el)) {
          continue;
        }
        const text = el.textContent || "";
        if (text.length > 300) {
          continue;
        }
        if (warningRegex.test(text)) {
          return true;
        }
      }

      return false;
    } catch (e) {
      return false;
    }
  }

  function isAntiBotCaptchaModalVisible() {
    try {
      const modalTexts = [
        /por d[oó]nde se fue la criatura/i,
        /which way did the creature go/i,
        /toca ese lado/i,
        /aplazar 30s/i,
        /mostrar de nuevo/i,
        /qu[eé] (item|ítem) se marc[oó]/i,
        /which item was marked/i,
        /anti-bot rune check/i,
        /verificaci[oó]n anti-bot/i,
      ];

      const modalElements = document.querySelectorAll("div, dialog, section, .window, .modal");
      for (const el of modalElements) {
        if (!el || el.id === "mage-tuntun-panel" || el.closest("#mage-tuntun-panel")) {
          continue;
        }
        // Exclude in-game character screen elements (names, health bars, chat bubbles)
        if (el.closest("#screen-element-wrapper") || el.classList.contains("character-name") || el.classList.contains("health-bar")) {
          continue;
        }
        if (!isElementVisible(el)) {
          continue;
        }

        const text = el.textContent || "";
        if (text.length > 500) {
          continue;
        }

        // If it's only the countdown warning, that's not the interactive modal yet
        if (/appear in \d+ seconds|aparecer[aá] en \d+ segundos/i.test(text)) {
          continue;
        }

        for (const regex of modalTexts) {
          if (regex.test(text)) {
            return true;
          }
        }
      }

      return false;
    } catch (error) {
      return false;
    }
  }

  function isAntiBotCheckVisible() {
    return isAntiBotWarningCountdown() || isAntiBotCaptchaModalVisible();
  }

  function getActiveCaptchaModalElement() {
    const modalTexts = [
      /por d[oó]nde se fue la criatura/i,
      /which way did the creature go/i,
      /toca ese lado/i,
      /aplazar 30s/i,
      /mostrar de nuevo/i,
      /qu[eé] (item|ítem) se marc[oó]/i,
      /which item was marked/i,
      /anti-bot rune check/i,
      /verificaci[oó]n anti-bot/i,
    ];

    const modalElements = document.querySelectorAll("div, dialog, section, .window, .modal");
    for (const el of modalElements) {
      if (!el || el.id === "mage-tuntun-panel" || el.closest("#mage-tuntun-panel")) {
        continue;
      }
      if (el.closest("#screen-element-wrapper") || el.classList.contains("character-name") || el.classList.contains("health-bar")) {
        continue;
      }
      if (!isElementVisible(el)) {
        continue;
      }
      const text = el.textContent || "";
      if (text.length > 500) {
        continue;
      }
      if (/appear in \d+ seconds|aparecer[aá] en \d+ segundos/i.test(text)) {
        continue;
      }
      for (const regex of modalTexts) {
        if (regex.test(text)) {
          return el;
        }
      }
    }
    return null;
  }

  function isYellowHighlighted(element) {
    try {
      const computed = window.getComputedStyle(element);
      const bgColor = computed.backgroundColor || "";
      const outline = computed.outlineColor || "";
      const border = computed.borderColor || "";
      const boxShadow = computed.boxShadow || "";

      // Check inline style for yellow background or border (NEVER font color)
      const inlineStyle = (element.getAttribute("style") || "").toLowerCase();
      if (/background.*(yellow|#ff0|#ffff00)|border.*(yellow|#ff0|#ffff00)|outline.*(yellow|#ff0|#ffff00)/.test(inlineStyle)) {
        return true;
      }

      // Parse RGB and check for yellow-ish tones
      const isYellowRgb = (rgbStr) => {
        const match = rgbStr.match(/rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
        if (!match) return false;
        const r = Number(match[1]);
        const g = Number(match[2]);
        const b = Number(match[3]);
        // Yellow: high red, high green, low blue
        return r >= 180 && g >= 180 && b <= 100;
      };

      // Only background, outline, border, or shadow indicate a highlighted option button
      // (NEVER font color, as character names on screen have yellow font)
      if (isYellowRgb(bgColor)) return true;
      if (isYellowRgb(outline)) return true;
      if (isYellowRgb(border)) return true;
      if (/yellow|#ff0|#ffff00/.test(boxShadow.toLowerCase())) return true;

      // Check for highlight class names combined with warm colors
      const classList = (element.className || "").toLowerCase();
      if (/highlight|selected|correct|marked/.test(classList)) {
        if (isYellowRgb(bgColor) || isYellowRgb(border) || isYellowRgb(outline)) return true;
        if (/yellow|correct|marked/.test(classList)) return true;
      }

      return false;
    } catch (error) {
      return false;
    }
  }

  function findYellowCaptchaOption() {
    try {
      // Search only within the active captcha modal dialog or window
      const modalEl = getActiveCaptchaModalElement() || document.querySelector("dialog, .modal, .window, [class*='captcha']");
      if (!modalEl) {
        return null;
      }

      const candidates = modalEl.querySelectorAll(
        "button, [role='button'], div, img, span, a, label, [class*='option'], [class*='answer'], [class*='choice']"
      );

      const yellowElements = [];

      for (const el of candidates) {
        // Skip our own bot panel
        if (el.id === "mage-tuntun-panel" || el.closest("#mage-tuntun-panel")) {
          continue;
        }

        // Never search inside the game canvas or screen wrapper
        if (el.closest("#screen-element-wrapper") || el.closest("#game-canvas") || el.closest("#world")) {
          continue;
        }

        // Skip very large container elements (we want specific option elements)
        const rect = el.getBoundingClientRect();
        if (rect.width > 400 || rect.height > 400 || rect.width < 10 || rect.height < 10) {
          continue;
        }

        // Skip elements not visible on screen
        if (rect.width === 0 || rect.height === 0) {
          continue;
        }

        if (isYellowHighlighted(el)) {
          yellowElements.push({ element: el, rect });
        }
      }

      if (!yellowElements.length) {
        return null;
      }

      // If multiple yellow elements found, prefer the one that looks most like a button/option
      // Sort by specificity: smaller elements are more likely to be the answer option
      yellowElements.sort((a, b) => {
        const aArea = a.rect.width * a.rect.height;
        const bArea = b.rect.width * b.rect.height;
        return aArea - bArea;
      });

      return yellowElements[0].element;
    } catch (error) {
      bot.log("captcha auto-solve: error finding yellow option", error?.message || error);
      return null;
    }
  }

  function simulateClick(element) {
    try {
      const rect = element.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;

      const eventOptions = {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: x,
        clientY: y,
      };

      element.dispatchEvent(new MouseEvent("pointerdown", eventOptions));
      element.dispatchEvent(new MouseEvent("mousedown", eventOptions));
      element.dispatchEvent(new MouseEvent("pointerup", eventOptions));
      element.dispatchEvent(new MouseEvent("mouseup", eventOptions));
      element.dispatchEvent(new MouseEvent("click", eventOptions));

      return true;
    } catch (error) {
      bot.log("captcha auto-solve: click simulation failed", error?.message || error);
      return false;
    }
  }

  function attemptCaptchaAutoSolve() {
    if (!config.captchaAutoSolveEnabled || state.captchaSolveAttempted) {
      return;
    }

    state.captchaSolveAttempted = true;
    bot.log("captcha auto-solve: searching for yellow-highlighted answer...");

    const yellowOption = findYellowCaptchaOption();

    if (!yellowOption) {
      bot.log("captcha auto-solve: no yellow option found, activating alarm for manual resolution");
      if (config.soundOnCaptcha) {
        bot.playCaptchaAlarm?.(true);
      }
      return;
    }

    bot.log("captcha auto-solve: yellow option found, clicking...", {
      tag: yellowOption.tagName,
      text: (yellowOption.textContent || "").slice(0, 50),
      class: yellowOption.className || "",
    });

    const clicked = simulateClick(yellowOption);

    if (!clicked) {
      bot.log("captcha auto-solve: click failed, activating alarm for manual resolution");
      if (config.soundOnCaptcha) {
        bot.playCaptchaAlarm?.(true);
      }
      return;
    }

    bot.log("captcha auto-solve: click sent successfully, waiting for verification...");

    // After clicking, wait a short time then check if verification passed
    window.setTimeout(() => {
      if (isVerificationPassed()) {
        bot.log("captcha auto-solve: SUCCESS! Verification passed automatically.");
        state.captchaActive = false;
        bot.stopCaptchaAlarm?.();
        if (!state.isGmCurrentlyVisible) {
          resumeAutomations();
        }
      } else if (isAntiBotCheckVisible()) {
        bot.log("captcha auto-solve: attempt failed, captcha still visible. Activating alarm for manual resolution.");
        if (config.soundOnCaptcha) {
          bot.playCaptchaAlarm?.(true);
        }
      }
    }, 2000);
  }

  function isVerificationPassed() {
    try {
      const passRegex = /verification passed|verificaci[oó]n (exitosa|correcta|completada)/i;

      // 1. Check screenElementManager active text elements
      if (window.gameClient?.interface?.screenElementManager?.activeTextElements) {
        for (const item of window.gameClient.interface.screenElementManager.activeTextElements) {
          const msg = item?.__message || item?.element?.textContent || "";
          if (passRegex.test(msg)) {
            return true;
          }
        }
      }

      // 2. Check DOM elements
      const elements = document.querySelectorAll("#server-message, #notification, div, span, p, .floating-text, .screen-element");
      for (const el of elements) {
        if (el.closest("#mage-tuntun-panel")) continue;
        if (!isElementVisible(el)) continue;
        const text = el.textContent || "";
        if (text.length > 200) continue;
        if (passRegex.test(text)) {
          return true;
        }
      }
      return false;
    } catch (e) {
      return false;
    }
  }

  function clearCaptchaSolveTimer() {
    if (state.captchaSolveTimerId != null) {
      window.clearTimeout(state.captchaSolveTimerId);
      state.captchaSolveTimerId = null;
    }
  }

  function checkCaptchaWatcher() {
    if (!config.captchaWatcherEnabled) {
      return;
    }

    const warningDetected = isAntiBotWarningCountdown();
    const modalDetected = isAntiBotCaptchaModalVisible();
    const passed = isVerificationPassed();

    // 1. If verification passed (auto-solved or manually completed)
    if (passed) {
      if (state.captchaActive || state.countdownActive) {
        state.captchaActive = false;
        state.countdownActive = false;
        state.countdownUntil = 0;
        state.captchaSolveAttempted = false;
        clearCaptchaSolveTimer();
        bot.log("ANTI-BOT VERIFICATION PASSED! Dismissing alerts.");
        bot.stopCaptchaAlarm?.();

        if (!state.isGmCurrentlyVisible) {
          resumeAutomations();
        }
      }
      return;
    }

    // 2. Pre-verification countdown warning ("An anti-bot verification will appear in 30 seconds.")
    if (warningDetected) {
      if (!state.countdownActive) {
        state.countdownActive = true;
        // Keep countdown active for up to 45 seconds to cover the 30s countdown plus network margin
        state.countdownUntil = Date.now() + 45000;
        bot.log("ANTI-BOT WARNING: Verification will appear in 30 seconds! Pausing automations.");

        if (config.pauseOnCaptcha) {
          pauseAutomations("Anti-bot verification countdown (appears in 30s)");
        }

        if (config.soundOnCaptcha) {
          bot.playCaptchaAlarm?.(true);
        }
      }
    }

    // 3. Safety check: countdown expired without any captcha modal appearing
    if (state.countdownActive && !modalDetected && !warningDetected) {
      if (Date.now() > state.countdownUntil) {
        bot.log("anti-bot countdown expired without verification modal appearing");
        state.countdownActive = false;
        state.countdownUntil = 0;
        bot.stopCaptchaAlarm?.();
        if (!state.isGmCurrentlyVisible && !state.captchaActive) {
          resumeAutomations();
        }
      }
    }

    // 4. Interactive captcha modal detected on screen
    if (modalDetected) {
      if (!state.captchaActive) {
        state.captchaActive = true;
        state.captchaSolveAttempted = false;
        bot.log("ANTI-BOT CAPTCHA MODAL DETECTED ON SCREEN!");

        if (config.pauseOnCaptcha) {
          pauseAutomations("Anti-bot captcha modal active");
        }

        // If auto-solve is enabled, give options 1.5s to fully render then click yellow
        if (config.captchaAutoSolveEnabled) {
          const solveDelay = Math.max(500, Number(config.captchaAutoSolveDelayMs) || 1500);
          bot.log(`captcha auto-solve: waiting ${solveDelay}ms for options to render...`);
          clearCaptchaSolveTimer();
          state.captchaSolveTimerId = window.setTimeout(() => {
            attemptCaptchaAutoSolve();
          }, solveDelay);
        } else {
          if (config.soundOnCaptcha) {
            bot.playCaptchaAlarm?.(true);
          }
        }
      }
    } else {
      // Modal is no longer on screen
      if (state.captchaActive) {
        // If countdown is not waiting, modal was dismissed or solved
        if (!state.countdownActive) {
          state.captchaActive = false;
          state.captchaSolveAttempted = false;
          clearCaptchaSolveTimer();
          bot.log("ANTI-BOT CAPTCHA MODAL DISMISSED");
          bot.stopCaptchaAlarm?.();

          if (!state.isGmCurrentlyVisible) {
            resumeAutomations();
          }
        }
      }
    }
  }

  function tick() {
    if (!state.running) return;

    try {
      checkCaptchaWatcher();
      checkGmDetection();
      checkGmChat();
      checkNameMention();
    } catch (error) {
      bot.log("gm tick failed", error?.message || error);
    } finally {
      if (state.running) {
        state.timerId = window.setTimeout(tick, state.tickMs);
      }
    }
  }

  function start(overrides = {}) {
    Object.assign(config, overrides, { enabled: true });
    persistConfig();

    if (state.running) {
      return false;
    }

    state.running = true;
    state.isGmCurrentlyVisible = false;
    state.captchaActive = false;
    state.seenChatKeys = new Set(getRecentMessages().map((m) => `${m.channelName}|${m.time}|${m.sender}|${m.message}`));
    state.seenStaffChatKeys = new Set(getRecentMessages().map((m) => `${m.channelName}|${m.time}|${m.sender}|${m.message}`));
    bot.log("gm & anti-bot module started", { ...config });
    tick();
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

    clearReplyTimers();
    clearCaptchaSolveTimer();
    bot.stopCaptchaAlarm?.();

    if (state.captchaActive || state.countdownActive || state.isGmCurrentlyVisible) {
      resumeAutomations();
    }

    state.captchaActive = false;
    state.countdownActive = false;
    state.countdownUntil = 0;
    state.captchaSolveAttempted = false;
    state.isGmCurrentlyVisible = false;
    bot.log("gm & anti-bot module stopped");
    return true;
  }

  function status() {
    return {
      running: state.running,
      captchaActive: state.captchaActive || state.countdownActive,
      countdownActive: state.countdownActive,
      isGmCurrentlyVisible: state.isGmCurrentlyVisible,
      config: { ...config },
    };
  }

  function updateConfig(nextConfig = {}) {
    Object.assign(config, nextConfig);
    persistConfig();
    bot.log("gm config updated", { ...config });
    return { ...config };
  }

  if (config.enabled) {
    start();
  }

  bot.gm = {
    start,
    stop,
    status,
    updateConfig,
    config,
  };
};
