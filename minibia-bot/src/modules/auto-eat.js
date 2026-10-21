window.__mageTuntunBundle = window.__mageTuntunBundle || {};

window.__mageTuntunBundle.installAutoEatModule = function installAutoEatModule(bot) {
  const configStorageKey = "mageTuntun.eat.config";
  const MIN_EAT_COOLDOWN_MS = 1000;
  const state = {
    running: false,
    timerId: null,
    lastFoodAt: 0,
    currentJitterMs: 0,
  };

  const config = Object.assign(
    {
      tickMs: 1000,
      eatCooldownMs: 60000,
      eatHotbarSlot: 10,
      eatMode: "whenHungry",
      enabled: false,
    },
    bot.storage.get(configStorageKey, {})
  );
  config.tickMs = 1000;
  config.eatMode = config.eatMode === "interval" ? "interval" : "whenHungry";
  config.eatCooldownMs = Math.max(MIN_EAT_COOLDOWN_MS, Number(config.eatCooldownMs) || MIN_EAT_COOLDOWN_MS);

  function persistConfig() {
    bot.storage.set(configStorageKey, { ...config });
  }

  function normalizeHotbarSlot(slot) {
    const value = Number(slot);
    if (!Number.isFinite(value)) {
      return null;
    }

    const normalized = Math.trunc(value);
    if (normalized < 1 || normalized > 12) {
      return null;
    }

    return normalized;
  }

  function getRandomJitterMs() {
    return Math.floor(Math.random() * 5000) + 2000;
  }

  function readFoodTimer() {
    try {
      const foodText =
        document.querySelector('#skill-window div[skill="food"] .skill')?.textContent?.trim() ||
        null;

      if (!foodText) return null;

      const match = foodText.match(/^(\d{1,2}):(\d{2})$/);
      return match
        ? {
            text: foodText,
            seconds: Number(match[1]) * 60 + Number(match[2]),
          }
        : { text: foodText, seconds: null };
    } catch (error) {
      return null;
    }
  }

  function normalizeEatMode(mode) {
    return mode === "interval" ? "interval" : "whenHungry";
  }

  function isSated() {
    const player = window.gameClient?.player;
    const conditions = player?.conditions;

    const satedConditionId = conditions?.SATED;
    if (typeof satedConditionId === "number") {
      if (typeof conditions?.has === "function") {
        return conditions.has(satedConditionId);
      }

      if (conditions?.__conditions instanceof Set) {
        return conditions.__conditions.has(satedConditionId);
      }

      if (typeof player?.hasCondition === "function") {
        return player.hasCondition(satedConditionId);
      }
    }

    const food = readFoodTimer();
    if (food?.seconds != null) {
      return food.seconds > 0;
    }

    return null;
  }

  function tryEat() {
    if (!config.enabled) {
      return false;
    }

    if (config.eatMode === "whenHungry" && isSated() === true) {
      return false;
    }

    const targetCooldown = config.eatCooldownMs + (state.currentJitterMs || 0);
    if (Date.now() - state.lastFoodAt < targetCooldown) {
      return false;
    }

    const slot = normalizeHotbarSlot(config.eatHotbarSlot);
    if (!slot) {
      return false;
    }

    const slotIndex = slot - 1;
    const clicked = bot.clickHotbar(slotIndex);

    if (clicked) {
      state.lastFoodAt = Date.now();
      state.currentJitterMs = getRandomJitterMs();
      bot.log("used eat hotkey", { slot, eatMode: config.eatMode, nextJitterMs: state.currentJitterMs });
    }

    return clicked;
  }

  function scheduleNextTick() {
    if (!state.running) return;

    state.timerId = window.setTimeout(() => {
      tick();
    }, config.tickMs);
  }

  function tick() {
    if (!state.running) return;

    try {
      tryEat();
    } catch (error) {
      bot.log("auto eat tick failed", error?.message || error);
    } finally {
      scheduleNextTick();
    }
  }

  function start(overrides = {}) {
    Object.assign(config, overrides, { enabled: true });
    config.tickMs = 1000;
    config.eatCooldownMs = Math.max(MIN_EAT_COOLDOWN_MS, Number(config.eatCooldownMs) || MIN_EAT_COOLDOWN_MS);
    persistConfig();

    if (state.running) {
      bot.log("auto eat already running");
      return false;
    }

    state.running = true;
    bot.log("auto eat started", { eatCooldownMs: config.eatCooldownMs, eatHotbarSlot: config.eatHotbarSlot, eatMode: config.eatMode });
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
    bot.log("auto eat stopped");
    return true;
  }

  function status() {
    return {
      running: state.running,
      config: { ...config },
      lastFoodAt: state.lastFoodAt,
      isSated: isSated(),
    };
  }

  function updateConfig(nextConfig = {}) {
    if (Object.prototype.hasOwnProperty.call(nextConfig, "eatMode")) {
      nextConfig.eatMode = normalizeEatMode(nextConfig.eatMode);
    }

    if (Object.prototype.hasOwnProperty.call(nextConfig, "eatHotbarSlot")) {
      nextConfig.eatHotbarSlot = normalizeHotbarSlot(nextConfig.eatHotbarSlot) ?? config.eatHotbarSlot;
    }

    if (Object.prototype.hasOwnProperty.call(nextConfig, "eatCooldownMs")) {
      nextConfig.eatCooldownMs = Math.max(MIN_EAT_COOLDOWN_MS, Number(nextConfig.eatCooldownMs) || MIN_EAT_COOLDOWN_MS);
    }

    Object.assign(config, nextConfig);
    config.eatMode = normalizeEatMode(config.eatMode);
    config.tickMs = 1000;
    persistConfig();
    bot.log("auto eat config updated", { ...config });
    return { ...config };
  }

  if (config.enabled) {
    start();
  }

  bot.eat = {
    start,
    stop,
    status,
    updateConfig,
    isSated,
    tryEat,
    normalizeHotbarSlot,
    config,
  };

  bot.startAutoEat = start;
  bot.stopAutoEat = stop;

  if (bot.rune) {
    bot.rune.startAutoEat = start;
    bot.rune.stopAutoEat = stop;
    bot.rune.tryEat = tryEat;
    bot.rune.isSated = isSated;
  }
};
