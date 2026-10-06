window.__minibiaBotBundle = window.__minibiaBotBundle || {};

window.__minibiaBotBundle.installAutoSioModule = function installAutoSioModule(bot) {
  const configStorageKey = "minibiaBot.sio.config";
  const state = {
    running: false,
    timerId: null,
    lastCastAt: 0,
  };

  const config = Object.assign(
    {
      tickMs: 250,
      targetName: "",
      spellWords: "exura sio",
      minHpPercent: 50,
      cooldownMs: 1000,
      enabled: false,
    },
    bot.storage.get(configStorageKey, {})
  );
  config.tickMs = 250;
  config.minHpPercent = Math.min(100, Math.max(1, Number(config.minHpPercent) || 50));
  config.cooldownMs = Math.max(0, Number(config.cooldownMs) || 0);

  function persistConfig() {
    bot.storage.set(configStorageKey, { ...config });
  }

  function normalizeName(name) {
    return String(name || "").trim().toLowerCase();
  }

  function getTargetPlayer() {
    const targetName = normalizeName(config.targetName);
    if (!targetName) {
      return null;
    }

    return (bot.xray?.getVisiblePlayers?.({ sameFloorOnly: true }) || []).find(
      (player) => normalizeName(player?.name) === targetName
    ) || null;
  }

  function getHealthPercent(player) {
    const directPercent = Number(player?.getHealthPercentage?.());
    if (Number.isFinite(directPercent)) {
      return Math.min(100, Math.max(0, directPercent));
    }

    const current = Number(player?.state?.health ?? player?.health ?? player?.currentHealth);
    const max = Number(player?.maxHealth ?? player?.state?.maxHealth);
    if (!Number.isFinite(current) || !Number.isFinite(max) || max <= 0) {
      return null;
    }

    return Math.min(100, Math.max(0, (current / max) * 100));
  }

  function getSpellText(player) {
    const targetName = String(player?.name || config.targetName || "").trim();
    const words = String(config.spellWords || "").trim();
    if (!words || !targetName) {
      return null;
    }

    return words.includes("{name}")
      ? words.replaceAll("{name}", targetName)
      : `${words} "${targetName}"`;
  }

  function tryCastSio(now = Date.now()) {
    if (!config.enabled || now - state.lastCastAt < config.cooldownMs) {
      return false;
    }

    const target = getTargetPlayer();
    const healthPercent = getHealthPercent(target);
    if (!target || healthPercent == null || healthPercent > config.minHpPercent) {
      return false;
    }

    const spellText = getSpellText(target);
    if (!spellText || !bot.sendChat(spellText)) {
      return false;
    }

    state.lastCastAt = now;
    bot.log("cast sio", { target: target.name, healthPercent, spellText });
    return true;
  }

  function scheduleNextTick() {
    if (!state.running) return;
    state.timerId = window.setTimeout(tick, config.tickMs);
  }

  function tick() {
    if (!state.running) return;

    try {
      tryCastSio();
    } catch (error) {
      bot.log("auto sio tick failed", error?.message || error);
    } finally {
      scheduleNextTick();
    }
  }

  function start(overrides = {}) {
    Object.assign(config, overrides, { enabled: true });
    config.tickMs = 250;
    persistConfig();

    if (state.running) {
      return false;
    }

    state.running = true;
    bot.log("auto sio started", { ...config });
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
    return true;
  }

  function updateConfig(nextConfig = {}) {
    if (Object.prototype.hasOwnProperty.call(nextConfig, "targetName")) {
      nextConfig.targetName = String(nextConfig.targetName || "").trim();
    }
    if (Object.prototype.hasOwnProperty.call(nextConfig, "spellWords")) {
      nextConfig.spellWords = String(nextConfig.spellWords || "").trim() || config.spellWords;
    }
    if (Object.prototype.hasOwnProperty.call(nextConfig, "minHpPercent")) {
      nextConfig.minHpPercent = Math.min(100, Math.max(1, Number(nextConfig.minHpPercent) || 1));
    }
    if (Object.prototype.hasOwnProperty.call(nextConfig, "cooldownMs")) {
      nextConfig.cooldownMs = Math.max(0, Number(nextConfig.cooldownMs) || 0);
    }

    Object.assign(config, nextConfig);
    config.tickMs = 250;
    persistConfig();
    return { ...config };
  }

  function status() {
    const target = getTargetPlayer();
    return {
      running: state.running,
      config: { ...config },
      target: target ? { name: target.name, healthPercent: getHealthPercent(target) } : null,
      lastCastAt: state.lastCastAt,
    };
  }

  if (config.enabled) {
    start();
  }

  bot.addCleanup(() => stop({ persistEnabled: false }));
  bot.sio = { start, stop, status, updateConfig, tryCastSio, getTargetPlayer, config };
};
