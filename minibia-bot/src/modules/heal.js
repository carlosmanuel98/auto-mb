window.__mageTuntunBundle = window.__mageTuntunBundle || {};

window.__mageTuntunBundle.installHealModule = function installHealModule(bot) {
  const configStorageKey = "mageTuntun.heal.config";
  const MIN_HEAL_COOLDOWN_MS = 1000;
  const state = {
    running: false,
    timerId: null,
    lastHpHealAt: 0,
    lastManaHealAt: 0,
    lastParalyzeHealAt: 0,
    lastHpAttemptAt: 0,
    lastManaAttemptAt: 0,
    pendingHpAttempt: null,
    pendingManaAttempt: null,
  };

  const config = Object.assign(
    {
      tickMs: 50,
      hpHealCooldownMs: 1800,
      manaHealCooldownMs: 1000,
      healRetryMs: 200,
      healConfirmMs: 250,
      minHp: 250,
      minHpPercent: 80,
      hpHotbarSlot: 8,
      minMana: 150,
      minManaPercent: 30,
      manaHotbarSlot: 4,
      paralyzeHotbarSlot: null,
      paralyzeCooldownMs: 1000,
      enabled: false,
    },
    bot.storage.get(configStorageKey, {})
  );
  config.minHpPercent = Math.min(100, Math.max(1, Number(config.minHpPercent) || 80));
  config.minManaPercent = Math.min(100, Math.max(1, Number(config.minManaPercent) || 30));
  config.hpHealCooldownMs = Math.max(MIN_HEAL_COOLDOWN_MS, Number(config.hpHealCooldownMs) || 1800);
  config.manaHealCooldownMs = Math.max(MIN_HEAL_COOLDOWN_MS, Number(config.manaHealCooldownMs) || MIN_HEAL_COOLDOWN_MS);
  config.paralyzeHotbarSlot = normalizeHotbarSlot(config.paralyzeHotbarSlot);
  config.paralyzeCooldownMs = Math.max(MIN_HEAL_COOLDOWN_MS, Number(config.paralyzeCooldownMs) || MIN_HEAL_COOLDOWN_MS);

  function persistConfig() {
    bot.storage.set(configStorageKey, { ...config });
  }

  function readStats() {
    const playerState = bot.getPlayerSnapshot?.();

    return playerState
      ? {
          hp: {
            current: Number(playerState.health ?? 0),
            max: Number(playerState.maxHealth ?? 0),
          },
          mana: {
            current: Number(playerState.mana ?? 0),
            max: Number(playerState.maxMana ?? 0),
          },
        }
      : { hp: null, mana: null };
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

  function hasPendingAttempt() {
    return !!(state.pendingHpAttempt || state.pendingManaAttempt);
  }

  function isParalyzed() {
    const player = window.gameClient?.player;
    const conditionId = window.ConditionManager?.prototype?.PARALYZE ?? 16;
    return !!(
      player?.conditions?.has?.(conditionId) ||
      player?.conditions?.__conditions?.has?.(conditionId) ||
      player?.hasCondition?.(conditionId)
    );
  }

  function canUseParalyzeHeal(now = Date.now()) {
    const slot = normalizeHotbarSlot(config.paralyzeHotbarSlot);
    return !!slot && isParalyzed() && now - state.lastParalyzeHealAt >= config.paralyzeCooldownMs;
  }

  function triggerParalyzeHeal(now = Date.now()) {
    if (!canUseParalyzeHeal(now)) {
      return false;
    }

    const slot = normalizeHotbarSlot(config.paralyzeHotbarSlot);
    const clicked = bot.clickHotbar(slot - 1);
    if (clicked) {
      state.lastParalyzeHealAt = now;
      bot.log("pressed paralyze heal hotkey", { slot });
    }
    return clicked;
  }

  function didHpHealSucceed(stats, attempt) {
    if (!stats?.hp || !attempt) {
      return false;
    }

    return (
      stats.hp.current > attempt.hpBefore ||
      (Number.isFinite(attempt.manaBefore) && Number.isFinite(stats.mana?.current) && stats.mana.current < attempt.manaBefore)
    );
  }

  function didManaHealSucceed(stats, attempt) {
    if (!stats?.mana || !attempt) {
      return false;
    }

    return (
      stats.mana.current > attempt.manaBefore ||
      (Number.isFinite(attempt.hpBefore) && Number.isFinite(stats.hp?.current) && stats.hp.current > attempt.hpBefore)
    );
  }

  function resolvePendingAttempts(stats, now = Date.now()) {
    const hpAttempt = state.pendingHpAttempt;
    if (hpAttempt) {
      if (didHpHealSucceed(stats, hpAttempt)) {
        state.lastHpHealAt = hpAttempt.attemptedAt;
        state.pendingHpAttempt = null;
        bot.log("confirmed hp heal", { slot: hpAttempt.slot });
      } else if (now - hpAttempt.attemptedAt >= Math.max(50, Number(config.healConfirmMs) || 0)) {
        state.pendingHpAttempt = null;
        bot.log("hp heal did not register", { slot: hpAttempt.slot });
      }
    }

    const manaAttempt = state.pendingManaAttempt;
    if (manaAttempt) {
      if (didManaHealSucceed(stats, manaAttempt)) {
        state.lastManaHealAt = manaAttempt.attemptedAt;
        state.pendingManaAttempt = null;
        bot.log("confirmed mana heal", { slot: manaAttempt.slot });
      } else if (now - manaAttempt.attemptedAt >= Math.max(50, Number(config.healConfirmMs) || 0)) {
        state.pendingManaAttempt = null;
        bot.log("mana heal did not register", { slot: manaAttempt.slot });
      }
    }
  }

  function canUseHpHeal(now = Date.now(), stats = readStats()) {
    const { hp } = stats;
    const slot = normalizeHotbarSlot(config.hpHotbarSlot);
    if (!hp || !slot || state.pendingHpAttempt) return false;

    return (
      hp.current > 0 &&
      hp.max > 0 &&
      (hp.current / hp.max) * 100 <= config.minHpPercent &&
      now - Math.max(state.lastHpHealAt, state.lastHpAttemptAt) >= config.hpHealCooldownMs &&
      now - state.lastHpAttemptAt >= Math.max(50, Number(config.healRetryMs) || 0)
    );
  }

  function canUseManaHeal(now = Date.now(), stats = readStats()) {
    const { mana } = stats;
    const slot = normalizeHotbarSlot(config.manaHotbarSlot);
    if (!mana || !slot || state.pendingManaAttempt || state.pendingHpAttempt) return false;

    return (
      mana.max > 0 &&
      (mana.current / mana.max) * 100 <= config.minManaPercent &&
      now - Math.max(state.lastManaHealAt, state.lastManaAttemptAt) >= config.manaHealCooldownMs &&
      now - state.lastManaAttemptAt >= Math.max(50, Number(config.healRetryMs) || 0)
    );
  }

  function triggerHpHeal(now = Date.now(), stats = readStats()) {
    if (!canUseHpHeal(now, stats)) {
      return false;
    }

    const slot = normalizeHotbarSlot(config.hpHotbarSlot);
    const clicked = bot.clickHotbar(slot - 1);
    if (clicked) {
      state.lastHpAttemptAt = now;
      state.pendingHpAttempt = {
        attemptedAt: now,
        slot,
        hpBefore: Number(stats.hp?.current ?? 0),
        manaBefore: Number(stats.mana?.current ?? 0),
      };
      bot.log("pressed hp heal hotkey", { slot, minHpPercent: config.minHpPercent });
    }

    return clicked;
  }

  function triggerManaHeal(now = Date.now(), stats = readStats()) {
    if (!canUseManaHeal(now, stats)) {
      return false;
    }

    const slot = normalizeHotbarSlot(config.manaHotbarSlot);
    const clicked = bot.clickHotbar(slot - 1);
    if (clicked) {
      state.lastManaAttemptAt = now;
      state.pendingManaAttempt = {
        attemptedAt: now,
        slot,
        hpBefore: Number(stats.hp?.current ?? 0),
        manaBefore: Number(stats.mana?.current ?? 0),
      };
      bot.log("pressed mana heal hotkey", { slot, minManaPercent: config.minManaPercent });
    }

    return clicked;
  }

  function tryHeal() {
    if (!config.enabled) {
      return false;
    }

    const now = Date.now();
    const stats = readStats();

    resolvePendingAttempts(stats, now);

    if (triggerParalyzeHeal(now)) {
      return true;
    }

    if (hasPendingAttempt()) {
      return false;
    }

    if (triggerHpHeal(now, stats)) {
      return true;
    }

    return triggerManaHeal(now, stats);
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
      tryHeal();
    } catch (error) {
      bot.log("auto heal tick failed", error?.message || error);
    } finally {
      scheduleNextTick();
    }
  }

  function start(overrides = {}) {
    Object.assign(config, overrides, { enabled: true });
    if (Object.prototype.hasOwnProperty.call(overrides, "healCooldownMs")) {
      const legacyCooldown = Math.max(MIN_HEAL_COOLDOWN_MS, Number(overrides.healCooldownMs) || MIN_HEAL_COOLDOWN_MS);
      config.hpHealCooldownMs = legacyCooldown;
      config.manaHealCooldownMs = legacyCooldown;
    }
    config.hpHealCooldownMs = Math.max(MIN_HEAL_COOLDOWN_MS, Number(config.hpHealCooldownMs) || 1800);
    config.manaHealCooldownMs = Math.max(MIN_HEAL_COOLDOWN_MS, Number(config.manaHealCooldownMs) || MIN_HEAL_COOLDOWN_MS);
    config.paralyzeHotbarSlot = normalizeHotbarSlot(config.paralyzeHotbarSlot);
    config.paralyzeCooldownMs = Math.max(MIN_HEAL_COOLDOWN_MS, Number(config.paralyzeCooldownMs) || MIN_HEAL_COOLDOWN_MS);
    persistConfig();

    if (state.running) {
      bot.log("auto heal already running");
      return false;
    }

    state.running = true;
    bot.log("auto heal started", { ...config });
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
    bot.log("auto heal stopped");
    return true;
  }

  function status() {
    return {
      running: state.running,
      config: { ...config },
      stats: readStats(),
      lastHpHealAt: state.lastHpHealAt,
      lastManaHealAt: state.lastManaHealAt,
      lastParalyzeHealAt: state.lastParalyzeHealAt,
      paralyzed: isParalyzed(),
      lastHpAttemptAt: state.lastHpAttemptAt,
      lastManaAttemptAt: state.lastManaAttemptAt,
      pendingHpAttempt: state.pendingHpAttempt ? { ...state.pendingHpAttempt } : null,
      pendingManaAttempt: state.pendingManaAttempt ? { ...state.pendingManaAttempt } : null,
    };
  }

  function updateConfig(nextConfig = {}) {
    if (Object.prototype.hasOwnProperty.call(nextConfig, "hpHotbarSlot")) {
      nextConfig.hpHotbarSlot = normalizeHotbarSlot(nextConfig.hpHotbarSlot) ?? config.hpHotbarSlot;
    }

    if (Object.prototype.hasOwnProperty.call(nextConfig, "manaHotbarSlot")) {
      nextConfig.manaHotbarSlot = normalizeHotbarSlot(nextConfig.manaHotbarSlot) ?? config.manaHotbarSlot;
    }

    if (Object.prototype.hasOwnProperty.call(nextConfig, "paralyzeHotbarSlot")) {
      nextConfig.paralyzeHotbarSlot = normalizeHotbarSlot(nextConfig.paralyzeHotbarSlot);
    }

    if (Object.prototype.hasOwnProperty.call(nextConfig, "paralyzeCooldownMs")) {
      nextConfig.paralyzeCooldownMs = Math.max(MIN_HEAL_COOLDOWN_MS, Number(nextConfig.paralyzeCooldownMs) || MIN_HEAL_COOLDOWN_MS);
    }

    if (Object.prototype.hasOwnProperty.call(nextConfig, "minHp")) {
      nextConfig.minHp = Math.max(0, Number(nextConfig.minHp) || 0);
    }

    if (Object.prototype.hasOwnProperty.call(nextConfig, "minHpPercent")) {
      nextConfig.minHpPercent = Math.min(100, Math.max(1, Number(nextConfig.minHpPercent) || 1));
    }

    if (Object.prototype.hasOwnProperty.call(nextConfig, "minMana")) {
      nextConfig.minMana = Math.max(0, Number(nextConfig.minMana) || 0);
    }

    if (Object.prototype.hasOwnProperty.call(nextConfig, "minManaPercent")) {
      nextConfig.minManaPercent = Math.min(100, Math.max(1, Number(nextConfig.minManaPercent) || 1));
    }

    if (Object.prototype.hasOwnProperty.call(nextConfig, "healCooldownMs")) {
      const legacyCooldown = Math.max(MIN_HEAL_COOLDOWN_MS, Number(nextConfig.healCooldownMs) || MIN_HEAL_COOLDOWN_MS);
      nextConfig.hpHealCooldownMs = legacyCooldown;
      nextConfig.manaHealCooldownMs = legacyCooldown;
    }

    if (Object.prototype.hasOwnProperty.call(nextConfig, "hpHealCooldownMs")) {
      nextConfig.hpHealCooldownMs = Math.max(MIN_HEAL_COOLDOWN_MS, Number(nextConfig.hpHealCooldownMs) || MIN_HEAL_COOLDOWN_MS);
    }

    if (Object.prototype.hasOwnProperty.call(nextConfig, "manaHealCooldownMs")) {
      nextConfig.manaHealCooldownMs = Math.max(MIN_HEAL_COOLDOWN_MS, Number(nextConfig.manaHealCooldownMs) || MIN_HEAL_COOLDOWN_MS);
    }

    if (Object.prototype.hasOwnProperty.call(nextConfig, "healRetryMs")) {
      nextConfig.healRetryMs = Math.max(50, Number(nextConfig.healRetryMs) || 50);
    }

    if (Object.prototype.hasOwnProperty.call(nextConfig, "healConfirmMs")) {
      nextConfig.healConfirmMs = Math.max(50, Number(nextConfig.healConfirmMs) || 50);
    }

    Object.assign(config, nextConfig);
    config.minHpPercent = Math.min(100, Math.max(1, Number(config.minHpPercent) || 80));
    config.minManaPercent = Math.min(100, Math.max(1, Number(config.minManaPercent) || 30));
    config.hpHealCooldownMs = Math.max(MIN_HEAL_COOLDOWN_MS, Number(config.hpHealCooldownMs) || 1800);
    config.manaHealCooldownMs = Math.max(MIN_HEAL_COOLDOWN_MS, Number(config.manaHealCooldownMs) || MIN_HEAL_COOLDOWN_MS);
    config.paralyzeHotbarSlot = normalizeHotbarSlot(config.paralyzeHotbarSlot);
    config.paralyzeCooldownMs = Math.max(MIN_HEAL_COOLDOWN_MS, Number(config.paralyzeCooldownMs) || MIN_HEAL_COOLDOWN_MS);
    persistConfig();
    bot.log("auto heal config updated", { ...config });
    return { ...config };
  }

  if (config.enabled) {
    start();
  }

  bot.heal = {
    start,
    stop,
    status,
    updateConfig,
    readStats,
    tryHeal,
    canUseHpHeal,
    canUseManaHeal,
    canUseParalyzeHeal,
    triggerHpHeal,
    triggerManaHeal,
    triggerParalyzeHeal,
    isParalyzed,
    normalizeHotbarSlot,
    config,
  };
};
