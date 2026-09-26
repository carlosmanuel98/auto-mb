window.__minibiaBotBundle = window.__minibiaBotBundle || {};

window.__minibiaBotBundle.installAutoHasteModule = function installAutoHasteModule(bot) {
  const configStorageKey = "minibiaBot.haste.config";
  const state = {
    running: false,
    timerId: null,
    lastCastAt: 0,
  };

  const config = Object.assign(
    {
      tickMs: 500,
      spellWords: "utani hur",
      recastCooldownMs: 2000,
      enabled: false,
    },
    bot.storage.get(configStorageKey, {})
  );
  config.tickMs = 500;

  function persistConfig() {
    bot.storage.set(configStorageKey, { ...config });
  }

  function getHasteConditionIds() {
    const conditionManagerPrototype = window.ConditionManager?.prototype;
    const playerConditions = window.gameClient?.player?.conditions;
    const keys = ["HASTE", "STRONG_HASTE", "HASTED", "SPEED"];
    const ids = new Set();

    keys.forEach((key) => {
      const id = conditionManagerPrototype?.[key] ?? playerConditions?.[key];
      if (typeof id === "number" && Number.isFinite(id)) {
        ids.add(id);
      }
    });

    return Array.from(ids);
  }

  function isHasteActive() {
    const player = window.gameClient?.player;
    const conditions = player?.conditions;
    const conditionIds = getHasteConditionIds();

    if (!conditionIds.length) {
      return false;
    }

    return conditionIds.some((conditionId) => {
      if (typeof conditions?.has === "function") {
        return conditions.has(conditionId);
      }

      if (conditions?.__conditions instanceof Set) {
        return conditions.__conditions.has(conditionId);
      }

      if (typeof player?.hasCondition === "function") {
        return player.hasCondition(conditionId);
      }

      return false;
    });
  }

  function getGateStatus(now = Date.now()) {
    const cooldownRemainingMs = Math.max(0, config.recastCooldownMs - (now - state.lastCastAt));
    const hasteActive = isHasteActive();

    return {
      hasteActive,
      cooldownReady: cooldownRemainingMs === 0,
      cooldownRemainingMs,
      canCast: !hasteActive && cooldownRemainingMs === 0,
    };
  }

  function tryCastHaste(now = Date.now()) {
    if (!config.enabled || !getGateStatus(now).canCast) {
      return false;
    }

    const sent = bot.sendChat(config.spellWords);
    if (sent) {
      state.lastCastAt = now;
      bot.log("cast haste spell", { spellWords: config.spellWords });
    }

    return sent;
  }

  function scheduleNextTick() {
    if (!state.running) return;
    state.timerId = window.setTimeout(tick, config.tickMs);
  }

  function tick() {
    if (!state.running) return;

    try {
      tryCastHaste();
    } catch (error) {
      bot.log("auto haste tick failed", error?.message || error);
    } finally {
      scheduleNextTick();
    }
  }

  function start(overrides = {}) {
    Object.assign(config, overrides, { enabled: true });
    config.tickMs = 500;
    persistConfig();

    if (state.running) {
      bot.log("auto haste already running");
      return false;
    }

    state.running = true;
    bot.log("auto haste started", { ...config });
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

    if (shouldPersistEnabled) {
      config.enabled = false;
      persistConfig();
    }

    bot.log("auto haste stopped");
    return true;
  }

  function status() {
    return {
      running: state.running,
      config: { ...config },
      gates: getGateStatus(),
      lastCastAt: state.lastCastAt,
      hasteConditionIds: getHasteConditionIds(),
    };
  }

  function updateConfig(nextConfig = {}) {
    if (Object.prototype.hasOwnProperty.call(nextConfig, "spellWords")) {
      nextConfig.spellWords = String(nextConfig.spellWords || "").trim() || config.spellWords;
    }

    if (Object.prototype.hasOwnProperty.call(nextConfig, "recastCooldownMs")) {
      nextConfig.recastCooldownMs = Math.max(0, Number(nextConfig.recastCooldownMs) || 0);
    }

    Object.assign(config, nextConfig);
    config.tickMs = 500;
    persistConfig();
    bot.log("auto haste config updated", { ...config });
    return { ...config };
  }

  if (config.enabled) {
    start();
  }

  bot.addCleanup(() => stop({ persistEnabled: false }));

  bot.haste = {
    start,
    stop,
    status,
    updateConfig,
    isHasteActive,
    tryCastHaste,
    config,
  };
};
