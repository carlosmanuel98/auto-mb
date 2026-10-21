window.__mageTuntunBundle = window.__mageTuntunBundle || {};

window.__mageTuntunBundle.installRuneModule = function installRuneModule(bot) {
  const configStorageKey = "mageTuntun.rune.config";
  const state = {
    running: false,
    timerId: null,
    lastRuneAt: 0,
    nextRuneAt: 0,
    cycleStartedAt: 0,
  };
  let resumeListenersAttached = false;

  const config = Object.assign(
    {
      tickMs: 250,
      minHpPercent: 50,
      minFoodSeconds: 30,
      runeSpellWords: "adori vita vis",
      runeManaCost: 600,
      runeCooldownMs: 3500,
      castsPerMinute: 15,
      activeMinutes: 0,
      pauseMinutes: 0,
      enabled: false,
    },
    bot.storage.get(configStorageKey, {})
  );
  config.tickMs = 250;
  delete config.timingVariationPercent;
  config.runeCooldownMs = Math.max(1000, Number(config.runeCooldownMs) || 3500);
  config.castsPerMinute = Math.max(1, Number(config.castsPerMinute) || 15);
  config.activeMinutes = Math.max(0, Number(config.activeMinutes) || 0);
  config.pauseMinutes = Math.max(0, Number(config.pauseMinutes) || 0);

  function persistConfig() {
    bot.storage.set(configStorageKey, { ...config });
  }

  function readStats() {
    const playerState = bot.getPlayerState();

    const hp = playerState
      ? { current: playerState.health ?? 0, max: playerState.maxHealth ?? 0 }
      : null;

    const mana = playerState
      ? { current: playerState.mana ?? 0, max: playerState.maxMana ?? 0 }
      : null;

    const foodText =
      document.querySelector('#skill-window div[skill="food"] .skill')?.textContent?.trim() ||
      null;

    let food = null;
    if (foodText) {
      const match = foodText.match(/^(\d{1,2}):(\d{2})$/);
      food = match
        ? {
            text: foodText,
            seconds: Number(match[1]) * 60 + Number(match[2]),
          }
        : { text: foodText, seconds: null };
    }

    return { hp, mana, food };
  }

  function getCycleStatus(now = Date.now()) {
    const activeMs = Math.round(config.activeMinutes * 60 * 1000);
    const pauseMs = Math.round(config.pauseMinutes * 60 * 1000);
    if (!activeMs || !pauseMs) {
      return { enabled: false, active: true, remainingMs: 0 };
    }

    const startedAt = state.cycleStartedAt || now;
    const elapsedInCycle = Math.max(0, now - startedAt) % (activeMs + pauseMs);
    const active = elapsedInCycle < activeMs;
    return {
      enabled: true,
      active,
      remainingMs: active ? activeMs - elapsedInCycle : activeMs + pauseMs - elapsedInCycle,
    };
  }

  function getGateStatus(now = Date.now()) {
    const { hp, mana, food } = readStats();
    const cycle = getCycleStatus(now);
    if (!hp || !mana) {
      return {
        hasStats: false,
        enoughHp: false,
        enoughMana: false,
        enoughFood: false,
        cooldownReady: false,
        cooldownRemainingMs: config.runeCooldownMs,
        cycle,
        canMakeRune: false,
      };
    }

    const hpPercent = hp.max > 0 ? (hp.current / hp.max) * 100 : 0;
    const enoughHp = hpPercent >= config.minHpPercent;
    const enoughMana = mana.current >= config.runeManaCost;
    const enoughFood = food?.seconds == null || food.seconds >= config.minFoodSeconds;
    const cooldownRemainingMs = Math.max(0, state.nextRuneAt - now);
    const cooldownReady = cooldownRemainingMs === 0;

    return {
      hasStats: true,
      enoughHp,
      enoughMana,
      enoughFood,
      cooldownReady,
      cooldownRemainingMs,
      cycle,
      canMakeRune: enoughHp && enoughMana && enoughFood && cooldownReady && cycle.active,
    };
  }

  function canMakeRune(now = Date.now()) {
    return getGateStatus(now).canMakeRune;
  }

  function tryMakeRune() {
    if (!canMakeRune()) {
      return false;
    }

    const sent = bot.sendChat(config.runeSpellWords);
    if (sent) {
      const now = Date.now();
      const baseIntervalMs = 60000 / config.castsPerMinute;
      // Never schedule faster than the spell's known server cooldown.
      const intervalMs = Math.max(config.runeCooldownMs, Math.round(baseIntervalMs));
      state.lastRuneAt = now;
      state.nextRuneAt = now + intervalMs;
    }

    return sent;
  }

  function scheduleNextTick() {
    if (!state.running) return;

    state.timerId = window.setTimeout(() => {
      tick();
    }, config.tickMs);
  }

  function runImmediateTick() {
    if (!state.running) return;

    if (state.timerId != null) {
      window.clearTimeout(state.timerId);
      state.timerId = null;
    }

    tick();
  }

  function handleResume() {
    if (document.hidden) {
      return;
    }

    runImmediateTick();
  }

  function attachResumeListeners() {
    if (resumeListenersAttached) {
      return;
    }

    document.addEventListener("visibilitychange", handleResume);
    window.addEventListener("focus", handleResume);
    window.addEventListener("pageshow", handleResume);
    resumeListenersAttached = true;
  }

  function detachResumeListeners() {
    if (!resumeListenersAttached) {
      return;
    }

    document.removeEventListener("visibilitychange", handleResume);
    window.removeEventListener("focus", handleResume);
    window.removeEventListener("pageshow", handleResume);
    resumeListenersAttached = false;
  }

  function tick() {
    if (!state.running) return;

    try {
      tryMakeRune();
    } catch (error) {
      bot.log("rune tick failed", error?.message || error);
    } finally {
      scheduleNextTick();
    }
  }

  function start(overrides = {}) {
    Object.assign(config, overrides, { enabled: true });
    config.tickMs = 250;
    config.runeCooldownMs = Math.max(1000, Number(config.runeCooldownMs) || 3500);
    config.castsPerMinute = Math.max(1, Number(config.castsPerMinute) || 15);
    config.activeMinutes = Math.max(0, Number(config.activeMinutes) || 0);
    config.pauseMinutes = Math.max(0, Number(config.pauseMinutes) || 0);
    persistConfig();

    if (state.running) {
      bot.log("rune maker already running");
      return false;
    }

    state.running = true;
    state.cycleStartedAt = Date.now();
    attachResumeListeners();
    bot.log("rune maker started", { ...config });
    tick();
    return true;
  }

  function stop(options = {}) {
    const shouldPersistEnabled = options.persistEnabled !== false;
    state.running = false;

    if (state.timerId != null) {
      window.clearTimeout(state.timerId);
      state.timerId = null;
    }

    detachResumeListeners();

    if (shouldPersistEnabled) {
      config.enabled = false;
      persistConfig();
    }
    bot.log("rune maker stopped");
    return true;
  }

  function status() {
    return {
      running: state.running,
        config: { ...config },
        stats: readStats(),
        gates: getGateStatus(),
        lastRuneAt: state.lastRuneAt,
        nextRuneAt: state.nextRuneAt,
        cycle: getCycleStatus(),
      };
  }

  function updateConfig(nextConfig = {}) {
    Object.assign(config, nextConfig);
    config.tickMs = 250;
    config.runeCooldownMs = Math.max(1000, Number(config.runeCooldownMs) || 3500);
    config.castsPerMinute = Math.max(1, Number(config.castsPerMinute) || 15);
    config.activeMinutes = Math.max(0, Number(config.activeMinutes) || 0);
    config.pauseMinutes = Math.max(0, Number(config.pauseMinutes) || 0);
    persistConfig();
    bot.log("rune config updated", { ...config });
    return { ...config };
  }

  if (config.enabled) {
    start();
  }

  bot.rune = {
    start,
    stop,
    status,
    readStats,
    getGateStatus,
    canMakeRune,
    tryMakeRune,
    config,
    updateConfig,
  };

  bot.startRuneLoop = start;
  bot.stopRuneLoop = stop;
};
