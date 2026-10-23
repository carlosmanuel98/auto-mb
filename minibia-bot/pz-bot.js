window.__mageTuntunBundle = window.__mageTuntunBundle || {};

// Keep an in-memory fallback until the player name is available. Once known,
// settings are persisted in an isolated profile for that character.
window.__mageTuntunSessionState = window.__mageTuntunSessionState || { storage: new Map() };

window.__mageTuntunBundle.createBot = function createBot() {
  const cleanups = [];
  const defaultAlarmAudioSrc = "https://upload.wikimedia.org/wikipedia/commons/transcoded/3/3f/ACA_Allertor_125_video.ogv/ACA_Allertor_125_video.ogv.480p.vp9.webm";
  const alarmAudioSrcStorageKey = "mageTuntun.audio.alarmSrc";
  const profileIndexStorageKey = "mageTuntun.profiles.v1";
  const selectedProfileStorageKey = "mageTuntun.selectedProfile.v1";
  const profileStoragePrefix = "mageTuntun.profile.v1.";
  const sessionStore = window.__mageTuntunSessionState.storage;
  const recentSentChats = [];
  const reconnectButtonSelectors = [
    "button",
    "[role=\"button\"]",
    "input[type=\"button\"]",
    "input[type=\"submit\"]",
    "a",
    ".button",
    ".btn",
  ];
  let alarmAudio = null;
  let captchaAudioContext = null;
  let captchaAlarmIntervalId = null;
  let reconnectObserver = null;
  let reconnectPollTimerId = null;
  let lastReconnectClickAt = 0;

  function addCleanup(fn) {
    if (typeof fn === "function") {
      cleanups.push(fn);
    }
  }

  function destroyCaptchaAudio() {
    if (captchaAlarmIntervalId != null) {
      window.clearInterval(captchaAlarmIntervalId);
      captchaAlarmIntervalId = null;
    }
    if (captchaAudioContext && captchaAudioContext.state !== "closed") {
      try {
        captchaAudioContext.close();
      } catch (error) {}
      captchaAudioContext = null;
    }
  }

  addCleanup(destroyCaptchaAudio);

  function runCleanups() {
    while (cleanups.length) {
      const fn = cleanups.pop();
      try {
        fn();
      } catch (error) {
        console.error("[mage-tuntun] cleanup failed", error);
      }
    }
  }

  function getStoredAlarmAudioSrc() {
    return sessionStore.has(alarmAudioSrcStorageKey)
      ? sessionStore.get(alarmAudioSrcStorageKey)
      : defaultAlarmAudioSrc;
  }

  function setStoredAlarmAudioSrc(src) {
    sessionStore.set(alarmAudioSrcStorageKey, src);
    return src;
  }

  function cloneSessionValue(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function getProfileName() {
    return String(
      window.gameClient?.player?.state?.name ||
      window.gameClient?.player?.name ||
      ""
    ).trim() || null;
  }

  function getSelectedProfileName() {
    try {
      return String(window.localStorage.getItem(selectedProfileStorageKey) || "").trim() || null;
    } catch (error) {
      return null;
    }
  }

  function resolveActiveProfileName() {
    return getSelectedProfileName() || getProfileName();
  }

  function getProfileStorageKey(name = resolveActiveProfileName()) {
    return name ? `${profileStoragePrefix}${encodeURIComponent(name.toLowerCase())}` : null;
  }

  function readPersistentProfile(name = resolveActiveProfileName()) {
    const key = getProfileStorageKey(name);
    if (!key) return null;

    try {
      const raw = window.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (error) {
      console.warn("[mage-tuntun] could not read character profile", error);
      return null;
    }
  }

  function writePersistentProfile(profile, name = resolveActiveProfileName()) {
    const key = getProfileStorageKey(name);
    if (!key) return false;

    try {
      window.localStorage.setItem(key, JSON.stringify(profile));
      const savedProfiles = readSavedProfiles();
      savedProfiles[name.toLowerCase()] = name;
      window.localStorage.setItem(profileIndexStorageKey, JSON.stringify(savedProfiles));
      return true;
    } catch (error) {
      console.warn("[mage-tuntun] could not save character profile", error);
      return false;
    }
  }

  function readSavedProfiles() {
    try {
      const raw = window.localStorage.getItem(profileIndexStorageKey);
      const value = raw ? JSON.parse(raw) : {};
      return value && typeof value === "object" && !Array.isArray(value) ? value : {};
    } catch (error) {
      return {};
    }
  }

  function getProfileValue(key, fallback = null) {
    const name = resolveActiveProfileName();
    if (!name) {
      return sessionStore.has(key) ? cloneSessionValue(sessionStore.get(key)) : fallback;
    }

    const profile = readPersistentProfile(name) || {};
    if (Object.prototype.hasOwnProperty.call(profile, key)) {
      return cloneSessionValue(profile[key]);
    }

    // Carry over settings recorded earlier in this still-open game tab.
    if (sessionStore.has(key)) {
      const value = cloneSessionValue(sessionStore.get(key));
      profile[key] = value;
      writePersistentProfile(profile, name);
      return value;
    }

    // Import settings from versions published before the Mage Tuntun rename.
    // Preserve the old key as a fallback so a user can still return to it.
    const legacyKey = String(key).replace(/^mageTuntun\./, "minibiaBot.");
    if (legacyKey !== key) {
      try {
        const legacyRaw = window.localStorage.getItem(legacyKey);
        if (legacyRaw != null) {
          const value = JSON.parse(legacyRaw);
          profile[key] = cloneSessionValue(value);
          writePersistentProfile(profile, name);
          return value;
        }
      } catch (error) {
        console.warn("[mage-tuntun] could not migrate legacy setting", { key, error });
      }
    }

    return fallback;
  }

  function setProfileValue(key, value) {
    const name = resolveActiveProfileName();
    const clonedValue = cloneSessionValue(value);
    sessionStore.set(key, clonedValue);

    if (!name) return value;

    const profile = readPersistentProfile(name) || {};
    profile[key] = clonedValue;
    writePersistentProfile(profile, name);
    return value;
  }

  function removeProfileValue(key) {
    sessionStore.delete(key);
    const name = resolveActiveProfileName();
    if (!name) return;

    const profile = readPersistentProfile(name);
    if (!profile || !Object.prototype.hasOwnProperty.call(profile, key)) return;
    delete profile[key];
    writePersistentProfile(profile, name);
  }

  function destroyAlarmAudio() {
    if (!alarmAudio) {
      return;
    }

    try {
      alarmAudio.pause();
      alarmAudio.removeAttribute("src");
      alarmAudio.load();
    } catch (error) {
      console.error("[mage-tuntun] audio cleanup failed", error);
    }

    alarmAudio = null;
  }

  function getAlarmAudio() {
    const src = getStoredAlarmAudioSrc();
    if (!src) {
      return null;
    }

    if (!alarmAudio) {
      alarmAudio = new Audio(src);
      alarmAudio.preload = "auto";
    } else if (alarmAudio.src !== src) {
      alarmAudio.pause();
      alarmAudio = new Audio(src);
      alarmAudio.preload = "auto";
    }

    return alarmAudio;
  }

  function normalizeChatText(text) {
    return String(text || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
  }

  function rememberSentChat(text) {
    const normalized = normalizeChatText(text);
    if (!normalized) {
      return;
    }

    recentSentChats.push({
      text: normalized,
      at: Date.now(),
    });

    const maxEntries = 20;
    if (recentSentChats.length > maxEntries) {
      recentSentChats.splice(0, recentSentChats.length - maxEntries);
    }
  }

  function isRecentSentChat(text, withinMs = 45000) {
    const normalized = normalizeChatText(text);
    if (!normalized) {
      return false;
    }

    const cutoff = Date.now() - withinMs;
    for (let index = recentSentChats.length - 1; index >= 0; index -= 1) {
      const entry = recentSentChats[index];
      if (entry.at < cutoff) {
        continue;
      }

      if (entry.text === normalized) {
        return true;
      }
    }

    return false;
  }

  function normalizeUiText(text) {
    return String(text || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
  }

  function getSkillWindowValue(skillNames = []) {
    for (const skillName of skillNames) {
      const value =
        document.querySelector(`#skill-window div[skill="${skillName}"] .skill`)?.textContent?.trim() ||
        null;
      if (value) {
        return value;
      }
    }

    return null;
  }

  function parseNumberText(value) {
    if (value == null) {
      return null;
    }

    const normalized = String(value).replace(/[^\d.-]/g, "");
    if (!normalized) {
      return null;
    }

    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function isVisibleElement(element) {
    if (!(element instanceof Element)) {
      return false;
    }

    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return false;
    }

    const style = window.getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
  }

  function getElementUiText(element) {
    if (!(element instanceof Element)) {
      return "";
    }

    return normalizeUiText(
      element.textContent ||
      element.innerText ||
      element.getAttribute("value") ||
      element.getAttribute("aria-label") ||
      element.getAttribute("title") ||
      ""
    );
  }

  function findReconnectElement() {
    for (const selector of reconnectButtonSelectors) {
      const candidates = document.querySelectorAll(selector);
      for (const candidate of candidates) {
        if (!isVisibleElement(candidate)) {
          continue;
        }

        if (getElementUiText(candidate) === "reconnect") {
          return candidate;
        }
      }
    }

    return null;
  }

  function tryClickReconnect() {
    const now = Date.now();
    if (now - lastReconnectClickAt < 3000) {
      return false;
    }

    const reconnectElement = findReconnectElement();
    if (!reconnectElement) {
      return false;
    }

    reconnectElement.click();
    lastReconnectClickAt = now;
    console.log("[mage-tuntun] clicked reconnect");
    return true;
  }

  function startReconnectWatcher() {
    if (reconnectObserver || reconnectPollTimerId) {
      return;
    }

    const runCheck = () => {
      try {
        tryClickReconnect();
      } catch (error) {
        console.error("[mage-tuntun] reconnect watcher failed", error);
      }
    };

    reconnectObserver = new MutationObserver(runCheck);
    reconnectObserver.observe(document.documentElement || document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "style", "hidden", "aria-hidden", "value"],
    });

    reconnectPollTimerId = window.setInterval(runCheck, 2000);
    runCheck();
  }

  function stopReconnectWatcher() {
    if (reconnectObserver) {
      reconnectObserver.disconnect();
      reconnectObserver = null;
    }

    if (reconnectPollTimerId) {
      window.clearInterval(reconnectPollTimerId);
      reconnectPollTimerId = null;
    }
  }

  startReconnectWatcher();

  return {
    version: "0.3.0",
    addCleanup,
    destroy() {
      if (this.panic?.stop) {
        this.panic.stop();
      }

      if (this.rune?.stop) {
        this.rune.stop({ persistEnabled: false });
      }

      if (this.heal?.stop) {
        this.heal.stop({ persistEnabled: false });
      }

      if (this.invisible?.stop) {
        this.invisible.stop({ persistEnabled: false });
      }

      if (this.sio?.stop) {
        this.sio.stop({ persistEnabled: false });
      }

      if (this.magicShield?.stop) {
        this.magicShield.stop({ persistEnabled: false });
      }

      if (this.haste?.stop) {
        this.haste.stop({ persistEnabled: false });
      }

      if (this.attack?.stop) {
        this.attack.stop({ persistEnabled: false });
      }

      if (this.cave?.stop) {
        this.cave.stop({ persistEnabled: false });
      }

      if (this.equipRing?.stop) {
        this.equipRing.stop({ persistEnabled: false });
      }

      if (this.eat?.stop) {
        this.eat.stop({ persistEnabled: false });
      }

      if (this.talk?.stop) {
        this.talk.stop({ persistEnabled: false });
      }

      if (this.gm?.stop) {
        this.gm.stop({ persistEnabled: false });
      }

      if (this.ui?.destroy) {
        this.ui.destroy();
      }

      stopReconnectWatcher();
      destroyAlarmAudio();
      runCleanups();
    },
    log(...args) {
      console.log("[mage-tuntun]", ...args);
    },
    lastStopReason: null,
    setStopReason(reason, details = {}) {
      this.lastStopReason = {
        reason: String(reason || "Stopped"),
        details: { ...details },
        at: Date.now(),
      };
      return this.lastStopReason;
    },
    clearStopReason() {
      this.lastStopReason = null;
    },
    storage: {
      get(key, fallback = null) {
        return getProfileValue(key, fallback);
      },
      set(key, value) {
        return setProfileValue(key, value);
      },
      remove(key) {
        removeProfileValue(key);
      },
    },
    getCharacterProfileName() {
      return getProfileName();
    },
    getActiveProfileName() {
      return resolveActiveProfileName();
    },
    getSavedProfileNames() {
      return Object.values(readSavedProfiles()).sort((a, b) => a.localeCompare(b));
    },
    isAutomaticProfile() {
      return !getSelectedProfileName();
    },
    selectProfile(name) {
      const normalizedName = String(name || "").trim();
      if (!normalizedName) return false;
      const savedProfiles = readSavedProfiles();
      const savedName = savedProfiles[normalizedName.toLowerCase()];
      if (!savedName) return false;
      try {
        window.localStorage.setItem(selectedProfileStorageKey, savedName);
        return true;
      } catch (error) {
        return false;
      }
    },
    useCharacterProfile() {
      try {
        window.localStorage.removeItem(selectedProfileStorageKey);
        return true;
      } catch (error) {
        return false;
      }
    },
    createProfile(name) {
      const normalizedName = String(name || "").trim().replace(/\s+/g, " ");
      if (!normalizedName) return false;
      const savedProfiles = readSavedProfiles();
      if (!savedProfiles[normalizedName.toLowerCase()]) {
        if (!writePersistentProfile({}, normalizedName)) return false;
      }
      return this.selectProfile(normalizedName);
    },
    getPlayerPosition() {
      return window.gameClient?.player?.getPosition?.() || null;
    },
    getPlayerState() {
      return window.gameClient?.player?.state || null;
    },
    getPlayerName() {
      return (
        String(
          this.getPlayerState()?.name ||
          window.gameClient?.player?.name ||
          window.gameClient?.player?.state?.name ||
          ""
        ).trim() || null
      );
    },
    getPlayerSnapshot() {
      const playerState = this.getPlayerState() || {};
      const levelText = getSkillWindowValue(["level"]);
      const magicLevelText = getSkillWindowValue(["magic", "magic-level", "mlvl"]);
      const experienceText = getSkillWindowValue(["experience", "exp"]);
      const capacityText = getSkillWindowValue(["capacity", "cap"]);

      return {
        name: this.getPlayerName(),
        level: parseNumberText(playerState.level) ?? parseNumberText(levelText),
        magicLevel: parseNumberText(playerState.magicLevel ?? playerState.magic_level) ?? parseNumberText(magicLevelText),
        health: parseNumberText(playerState.health),
        maxHealth: parseNumberText(playerState.maxHealth),
        mana: parseNumberText(playerState.mana),
        maxMana: parseNumberText(playerState.maxMana),
        experience: parseNumberText(playerState.experience ?? playerState.exp) ?? parseNumberText(experienceText),
        capacity: parseNumberText(playerState.capacity ?? playerState.cap) ?? parseNumberText(capacityText),
        food: getSkillWindowValue(["food"]),
      };
    },
    sendChat(text) {
      const channelManager = window.gameClient?.interface?.channelManager;
      if (!channelManager || !text) {
        return false;
      }

      channelManager.sendMessageText(text);
      rememberSentChat(text);
      this.log("sent chat:", text);
      return true;
    },
    isRecentSentChat(text, withinMs) {
      return isRecentSentChat(text, withinMs);
    },
    clickReconnect() {
      return tryClickReconnect();
    },
    clickHotbar(index) {
      const button = window.gameClient?.interface?.hotbarManager?.slots?.[index]?.canvas?.canvas;
      if (!button) {
        return false;
      }

      button.click();
      return true;
    },
    getAlarmAudioSrc() {
      return getStoredAlarmAudioSrc();
    },
    setAlarmAudioSrc(src) {
      const nextSrc = String(src || "").trim();
      if (!nextSrc) {
        return false;
      }

      setStoredAlarmAudioSrc(nextSrc);
      destroyAlarmAudio();
      this.log("alarm audio updated", nextSrc);
      return true;
    },
    unlockAudio() {
      try {
        const audio = getAlarmAudio();
        if (!audio) {
          return false;
        }

        audio.muted = true;
        const playResult = audio.play();

        if (playResult && typeof playResult.then === "function") {
          playResult
            .then(() => {
              audio.pause();
              audio.currentTime = 0;
              audio.muted = false;
            })
            .catch((error) => {
              audio.muted = false;
              this.log("audio unlock failed", error?.message || error);
            });
        } else {
          audio.pause();
          audio.currentTime = 0;
          audio.muted = false;
        }

        return true;
      } catch (error) {
        console.error("[mage-tuntun] audio unlock failed", error);
        return false;
      }
    },
    playAlarm() {
      try {
        const audio = getAlarmAudio();
        if (!audio) {
          return false;
        }

        audio.pause();
        audio.currentTime = 0;
        audio.muted = false;
        const playResult = audio.play();

        if (playResult && typeof playResult.catch === "function") {
          playResult.catch((error) => {
            this.log("alarm playback failed", error?.message || error);
          });
        }

        return true;
      } catch (error) {
        console.error("[mage-tuntun] alarm failed", error);
        return false;
      }
    },
    playCaptchaAlarm(loop = true) {
      try {
        destroyCaptchaAudio();
        const playTone = () => {
          try {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (!AudioCtx) {
              return false;
            }
            if (!captchaAudioContext || captchaAudioContext.state === "closed") {
              captchaAudioContext = new AudioCtx();
            }
            if (captchaAudioContext.state === "suspended") {
              captchaAudioContext.resume();
            }

            const ctx = captchaAudioContext;
            const now = ctx.currentTime;
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();

            osc.type = "sawtooth";
            osc.frequency.setValueAtTime(880, now);
            osc.frequency.setValueAtTime(1175, now + 0.12);
            osc.frequency.setValueAtTime(880, now + 0.24);
            osc.frequency.setValueAtTime(1175, now + 0.36);

            gain.gain.setValueAtTime(0.35, now);
            gain.gain.setValueAtTime(0.35, now + 0.48);
            gain.gain.linearRampToValueAtTime(0.001, now + 0.55);

            osc.connect(gain);
            gain.connect(ctx.destination);

            osc.start(now);
            osc.stop(now + 0.56);
            return true;
          } catch (error) {
            console.error("[mage-tuntun] captcha tone failed", error);
            return false;
          }
        };

        playTone();
        if (loop) {
          captchaAlarmIntervalId = window.setInterval(playTone, 750);
        }
        return true;
      } catch (error) {
        console.error("[mage-tuntun] playCaptchaAlarm failed", error);
        return false;
      }
    },
    stopCaptchaAlarm() {
      destroyCaptchaAudio();
      return true;
    },
  };
};
window.__mageTuntunBundle = window.__mageTuntunBundle || {};

window.__mageTuntunBundle.installPzModule = function installPzModule(bot) {
  const homeStorageKey = "mageTuntun.pz.home";

  function getLoadedTiles() {
    const chunks = window.gameClient?.world?.chunks || [];
    const tiles = [];

    for (const chunk of chunks) {
      if (!chunk?.tiles) continue;

      for (const tile of chunk.tiles) {
        if (tile?.__position) {
          tiles.push(tile);
        }
      }
    }

    return tiles;
  }

  function hasPzFlag(tile) {
    return !!tile && ((tile.flags || 0) & 1) !== 0;
  }

  function getPzCandidates() {
    const me = bot.getPlayerPosition();
    if (!me) return [];

    return getLoadedTiles()
      .filter((tile) => hasPzFlag(tile) && tile.__position?.z === me.z)
      .map((tile) => {
        const p = tile.__position;
        return {
          tile,
          x: p.x,
          y: p.y,
          z: p.z,
          flags: tile.flags || 0,
          dist: Math.abs(p.x - me.x) + Math.abs(p.y - me.y),
        };
      })
      .sort((a, b) => a.dist - b.dist);
  }

  function goToTile(tile) {
    if (!tile?.__position) return false;

    const from = bot.getPlayerPosition();
    if (!from) return false;

    const p = tile.__position;
    const to = new Position(p.x, p.y, p.z);

    try {
      window.gameClient?.world?.pathfinder?.findPath?.(from, to);
      bot.log("pathing to", { x: p.x, y: p.y, z: p.z, flags: tile.flags });
      return true;
    } catch (error) {
      bot.log("pathing failed", { x: p.x, y: p.y, z: p.z, error: error?.message });
      return false;
    }
  }

  function goToNearestPz(maxAttempts = 20) {
    const candidates = getPzCandidates().slice(0, maxAttempts);

    if (!candidates.length) {
      bot.log("No PZ candidates found");
      return false;
    }

    for (const candidate of candidates) {
      if (goToTile(candidate.tile)) {
        bot.log("selected PZ", {
          x: candidate.x,
          y: candidate.y,
          z: candidate.z,
          flags: candidate.flags,
          dist: candidate.dist,
        });
        return true;
      }
    }

    bot.log("No PZ candidate accepted by pathfinder");
    return false;
  }

  function setHomePz(x, y, z) {
    const home = { x, y, z };
    bot.storage.set(homeStorageKey, home);
    bot.log("home PZ set", home);
    return home;
  }

  function setHomePzCurrentSpot() {
    const pos = bot.getPlayerPosition();
    if (!pos) {
      bot.log("Could not read current position");
      return null;
    }

    return setHomePz(pos.x, pos.y, pos.z);
  }

  function getHomePz() {
    return bot.storage.get(homeStorageKey, null);
  }

  function clearHomePz() {
    bot.storage.remove(homeStorageKey);
    bot.log("home PZ cleared");
  }

  function getNearestPzTo(x, y, z) {
    const candidates = getLoadedTiles()
      .filter((tile) => hasPzFlag(tile) && tile.__position?.z === z)
      .map((tile) => {
        const p = tile.__position;
        return {
          tile,
          x: p.x,
          y: p.y,
          z: p.z,
          flags: tile.flags || 0,
          dist: Math.abs(p.x - x) + Math.abs(p.y - y),
        };
      })
      .sort((a, b) => a.dist - b.dist);

    return candidates[0] || null;
  }

  function goToHomePz() {
    const home = getHomePz();
    if (!home) {
      bot.log("No home PZ set");
      return false;
    }

    const candidate = getNearestPzTo(home.x, home.y, home.z);
    if (!candidate) {
      bot.log("No loaded PZ found near saved home", home);
      return false;
    }

    bot.log("home candidate", {
      x: candidate.x,
      y: candidate.y,
      z: candidate.z,
      flags: candidate.flags,
      distFromHome: candidate.dist,
    });

    return goToTile(candidate.tile);
  }

  function printPzCandidates(limit = 10) {
    const rows = getPzCandidates()
      .slice(0, limit)
      .map((candidate) => ({
        x: candidate.x,
        y: candidate.y,
        z: candidate.z,
        flags: candidate.flags,
        dist: candidate.dist,
      }));

    console.table(rows);
    return rows;
  }

  function isPositionInPz(pos) {
    if (!pos) return false;
    const tile = getLoadedTiles().find(
      (t) => t.__position?.x === pos.x && t.__position?.y === pos.y && t.__position?.z === pos.z
    );
    return hasPzFlag(tile);
  }

  bot.pz = {
    getLoadedTiles,
    getPzCandidates,
    goToTile,
    goToNearestPz,
    setHomePz,
    setHomePzCurrentSpot,
    getHomePz,
    clearHomePz,
    getNearestPzTo,
    goToHomePz,
    printPzCandidates,
    isPositionInPz,
  };

  bot.goToNearestPz = goToNearestPz;
  bot.setHomePz = setHomePz;
  bot.setHomePzCurrentSpot = setHomePzCurrentSpot;
  bot.getHomePz = getHomePz;
  bot.clearHomePz = clearHomePz;
  bot.goToHomePz = goToHomePz;
};
window.__mageTuntunBundle = window.__mageTuntunBundle || {};

window.__mageTuntunBundle.installXrayModule = function installXrayModule(bot) {
  const configStorageKey = "mageTuntun.xray.config";
  const overlayRootId = "mage-tuntun-xray-overlay";
  const overlayStyleId = "mage-tuntun-xray-overlay-style";
  const overlayState = {
    running: false,
    timerId: null,
  };
  const config = Object.assign(
    {
      overlayEnabled: false,
      selectedFloor: null,
    },
    bot.storage.get(configStorageKey, {})
  );

  config.selectedFloor = normalizeSelectedFloor(config.selectedFloor);

  function persistConfig() {
    bot.storage.set(configStorageKey, { ...config });
  }

  function normalizeName(name) {
    return String(name || "").trim().toLowerCase();
  }

  function normalizeSelectedFloor(value) {
    if (value == null || value === "" || value === "all") {
      return null;
    }

    const floor = Number(value);
    if (!Number.isFinite(floor)) {
      return null;
    }

    return Math.trunc(floor);
  }

  function isWithinVisibleRange(me, pos) {
    if (!me || !pos) {
      return false;
    }

    const dx = Math.abs(pos.x - me.x);
    const dy = Math.abs(pos.y - me.y);
    return dx <= 8 && dy <= 6;
  }

  function getTrackedCreatures() {
    const myState = bot.getPlayerState();
    const myId = window.gameClient?.player?.id;
    const myName = normalizeName(myState?.name);

    return Object.values(window.gameClient?.world?.activeCreatures || {}).filter((creature) => {
      if (!creature) return false;
      if (creature.id === myId) return false;

      const name = normalizeName(creature.name);
      if (name && name === myName) return false;

      return true;
    });
  }

  function getVisibleCreatures() {
    const me = bot.getPlayerPosition();
    if (!me) {
      return [];
    }

    // Keep the visible query strict; panic logic relies on this staying screen-limited.
    return getTrackedCreatures().filter((creature) => isWithinVisibleRange(me, creature.__position));
  }

  function getVisiblePlayers(options = {}) {
    const { sameFloorOnly = false } = options;
    const me = bot.getPlayerPosition();
    if (!me) {
      return [];
    }

    return getVisibleCreatures().filter((creature) => {
      if (creature?.type !== 0) {
        return false;
      }

      if (!sameFloorOnly) {
        return true;
      }

      return creature.__position?.z === me.z;
    });
  }

  function getVisibleMonsters(options = {}) {
    const { sameFloorOnly = false } = options;
    const me = bot.getPlayerPosition();
    const npcType = window.CONST?.TYPES?.NPC;
    if (!me) {
      return [];
    }

    return getVisibleCreatures().filter((creature) => {
      if (creature?.type === 0 || (npcType != null && creature?.type === npcType)) {
        return false;
      }

      if (!sameFloorOnly) {
        return true;
      }

      return creature.__position?.z === me.z;
    });
  }

  function readCreatureHealth(creature) {
    if (!creature) {
      return null;
    }

    const current = [
      creature.health,
      creature.hp,
      creature.currentHealth,
      creature.state?.health,
    ].find((value) => Number.isFinite(Number(value)));

    const max = [
      creature.maxHealth,
      creature.maxHp,
      creature.maximumHealth,
      creature.state?.maxHealth,
    ].find((value) => Number.isFinite(Number(value)));

    const percent = [
      creature.healthPercent,
      creature.hpPercent,
      creature.healthpercentage,
      creature.state?.healthPercent,
    ].find((value) => Number.isFinite(Number(value)));

    if (current != null && max != null) {
      return `${Number(current)}/${Number(max)} HP`;
    }

    if (percent != null) {
      return `${Math.round(Number(percent))}% HP`;
    }

    if (current != null) {
      return `${Number(current)} HP`;
    }

    return null;
  }

  function getCreatureLabel(creature) {
    if (creature?.name) {
      return creature.name;
    }

    return creature?.type === 0 ? "Player" : "Mob";
  }

  function getOverlayCreatures() {
    const me = bot.getPlayerPosition();
    if (!me) {
      return [];
    }

    return getTrackedCreatures().filter((creature) => {
      const pos = creature?.__position;
      if (!pos || pos.z == null) {
        return false;
      }

      if (config.selectedFloor != null && pos.z !== config.selectedFloor) {
        return false;
      }

      if (pos.z !== me.z) {
        return isWithinVisibleRange(me, pos);
      }

      return !isWithinVisibleRange(me, pos);
    });
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function getSameFloorOffscreenMarkerText(creature, healthLabel) {
    return healthLabel
      ? `${getCreatureLabel(creature)} ${healthLabel}`
      : `${getCreatureLabel(creature)}`;
  }

  function ensureOverlayStyle() {
    if (document.getElementById(overlayStyleId)) {
      return;
    }

    const style = document.createElement("style");
    style.id = overlayStyleId;
    style.textContent = `
      #${overlayRootId} {
        position: fixed;
        inset: 0;
        pointer-events: none;
        z-index: 999998;
      }

      #${overlayRootId} .mb-xray-marker {
        position: fixed;
        transform: translate(-50%, -50%);
        padding: 2px 6px;
        border: 1px solid rgba(255, 211, 128, 0.85);
        border-radius: 999px;
        background: rgba(65, 24, 12, 0.72);
        box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.35);
        color: #ffe7ae;
        font: 11px/1.2 Verdana, sans-serif;
        white-space: nowrap;
      }

      #${overlayRootId} .mb-xray-marker.mb-xray-marker-offscreen {
        border-color: rgba(123, 235, 178, 0.92);
        background: rgba(11, 61, 43, 0.8);
        color: #d8ffea;
      }
    `;
    document.head.appendChild(style);
  }

  function ensureOverlayRoot() {
    let root = document.getElementById(overlayRootId);
    if (root) {
      return root;
    }

    root = document.createElement("div");
    root.id = overlayRootId;
    document.body.appendChild(root);
    return root;
  }

  function destroyOverlayElements() {
    document.getElementById(overlayRootId)?.remove();
    document.getElementById(overlayStyleId)?.remove();
  }

  function getViewportRect() {
    const canvases = Array.from(document.querySelectorAll("canvas"))
      .map((canvas) => ({ canvas, rect: canvas.getBoundingClientRect() }))
      .filter(({ rect }) => rect.width >= 200 && rect.height >= 150)
      .sort((a, b) => (b.rect.width * b.rect.height) - (a.rect.width * a.rect.height));

    return canvases[0]?.rect || null;
  }

  function renderOverlay() {
    if (!overlayState.running) {
      return;
    }

    const root = ensureOverlayRoot();
    const me = bot.getPlayerPosition();
    const viewportRect = getViewportRect();
    const creatures = getOverlayCreatures();
    root.innerHTML = "";

    if (!me || !viewportRect || !creatures.length) {
      return;
    }

    const tileWidth = viewportRect.width / 17;
    const tileHeight = viewportRect.height / 13;
    const edgePadding = 48;

    creatures.forEach((creature) => {
      const pos = creature?.__position;
      if (!pos) return;

      const dx = pos.x - me.x;
      const dy = pos.y - me.y;
      const healthLabel = readCreatureHealth(creature);
      const marker = document.createElement("div");
      marker.className = "mb-xray-marker";

      if (pos.z === me.z) {
        marker.classList.add("mb-xray-marker-offscreen");
        marker.textContent = getSameFloorOffscreenMarkerText(creature, healthLabel);
        marker.style.left = `${clamp(
          viewportRect.left + ((dx + 8.5) * tileWidth),
          viewportRect.left + edgePadding,
          viewportRect.right - edgePadding
        )}px`;
        marker.style.top = `${clamp(
          viewportRect.top + ((dy + 6.5) * tileHeight),
          viewportRect.top + edgePadding,
          viewportRect.bottom - edgePadding
        )}px`;
      } else {
        const floorOffset = me.z - pos.z;
        const floorLabel = floorOffset === 0 ? "0" : floorOffset > 0 ? `+${floorOffset}` : `${floorOffset}`;
        marker.textContent = healthLabel
          ? `${getCreatureLabel(creature)} (${floorLabel}) ${healthLabel}`
          : `${getCreatureLabel(creature)} (${floorLabel})`;
        marker.style.left = `${viewportRect.left + ((dx + 8.5) * tileWidth)}px`;
        marker.style.top = `${viewportRect.top + ((dy + 6.5) * tileHeight)}px`;
      }

      root.appendChild(marker);
    });
  }

  function startOverlay() {
    config.overlayEnabled = true;
    persistConfig();

    if (overlayState.running) {
      return false;
    }

    overlayState.running = true;
    ensureOverlayStyle();
    renderOverlay();
    overlayState.timerId = window.setInterval(renderOverlay, 250);
    return true;
  }

  function stopOverlay() {
    config.overlayEnabled = false;
    persistConfig();

    if (!overlayState.running && overlayState.timerId == null) {
      return false;
    }

    overlayState.running = false;
    if (overlayState.timerId != null) {
      window.clearInterval(overlayState.timerId);
      overlayState.timerId = null;
    }

    destroyOverlayElements();
    return true;
  }

  function setOverlayEnabled(enabled) {
    const nextEnabled = !!enabled;

    if (nextEnabled) {
      if (overlayState.running) {
        config.overlayEnabled = true;
        persistConfig();
        return true;
      }

      return startOverlay();
    }

    if (!overlayState.running) {
      config.overlayEnabled = false;
      persistConfig();
      destroyOverlayElements();
      return true;
    }

    return stopOverlay();
  }

  function setSelectedFloor(floor) {
    config.selectedFloor = normalizeSelectedFloor(floor);
    persistConfig();

    if (overlayState.running) {
      renderOverlay();
    }

    return config.selectedFloor;
  }

  function status() {
    return {
      visibleCreatures: getVisibleCreatures().map((creature) => ({
        id: creature.id,
        name: creature.name,
        type: creature.type,
        position: creature.__position || null,
      })),
      visiblePlayers: getVisiblePlayers().map((player) => ({
        id: player.id,
        name: player.name,
        position: player.__position || null,
      })),
      visiblePlayersCurrentFloor: getVisiblePlayers({ sameFloorOnly: true }).map((player) => ({
        id: player.id,
        name: player.name,
        position: player.__position || null,
      })),
      visibleMonsters: getVisibleMonsters().map((creature) => ({
        id: creature.id,
        name: creature.name,
        type: creature.type,
        position: creature.__position || null,
      })),
      visibleMonstersCurrentFloor: getVisibleMonsters({ sameFloorOnly: true }).map((creature) => ({
        id: creature.id,
        name: creature.name,
        type: creature.type,
        position: creature.__position || null,
      })),
      overlayCreatures: getOverlayCreatures().map((creature) => ({
        id: creature.id,
        name: creature.name,
        type: creature.type,
        position: creature.__position || null,
      })),
      config: { ...config },
      overlayRunning: overlayState.running,
    };
  }

  bot.xray = {
    getVisibleCreatures,
    getVisiblePlayers,
    getVisibleMonsters,
    getOverlayCreatures,
    startOverlay,
    stopOverlay,
    setOverlayEnabled,
    setSelectedFloor,
    status,
    config,
  };

  if (config.overlayEnabled) {
    startOverlay();
  } else {
    destroyOverlayElements();
  }
  bot.addCleanup(stopOverlay);
};
window.__mageTuntunBundle = window.__mageTuntunBundle || {};

window.__mageTuntunBundle.installPanicModule = function installPanicModule(bot) {
  const configStorageKey = "mageTuntun.panic.config";
  const defaultGameMasterNames = ["God Minibia"];
  const state = {
    running: false,
    timerId: null,
    lastHealth: null,
    lastTriggerAt: 0,
    lastDamageEventKey: null,
    pendingReturnOrigin: null,
    pendingReturnModules: null,
    returnNotBeforeAt: 0,
    lastThreatAt: 0,
    lastReturnAttemptAt: 0,
    visiblePlayerKeys: new Set(),
    visibleNpcKeys: new Set(),
    seenChatKeys: new Set(),
    lastAlertAt: 0,
  };

  const config = Object.assign(
    {
      tickMs: 200,
      triggerCooldownMs: 4000,
      returnToOriginEnabled: false,
      returnDelayMs: 300000,
      returnDelayJitterMs: 30000,
      returnRetryCooldownMs: 2000,
      unknownPlayerEnabled: false,
      healthLossEnabled: false,
      playerAppearAlertEnabled: false,
      npcPauseAutomationEnabled: true,
      playerChatAlertEnabled: false,
      alertCooldownMs: 3000,
      trustedNames: [],
      gameMasterNames: [...defaultGameMasterNames],
    },
    bot.storage.get(configStorageKey, {})
  );
  delete config.npcAppearAlertEnabled;

  function persistConfig() {
    bot.storage.set(configStorageKey, { ...config });
  }

  function normalizeName(name) {
    return String(name || "").trim().toLowerCase();
  }

  function ensureDefaultGameMasterNames(names) {
    const result = Array.isArray(names) ? [...names] : [];
    const normalizedNames = new Set(result.map(normalizeName).filter(Boolean));
    defaultGameMasterNames.forEach((name) => {
      if (!normalizedNames.has(normalizeName(name))) {
        result.push(name);
      }
    });
    return result;
  }

  config.gameMasterNames = ensureDefaultGameMasterNames(config.gameMasterNames);

  function normalizeDelayMs(value, fallback = 0) {
    const next = Math.trunc(Number(value));
    return Number.isFinite(next) ? Math.max(0, next) : fallback;
  }

  function normalizePosition(position) {
    const x = Number(position?.x);
    const y = Number(position?.y);
    const z = Number(position?.z);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      return null;
    }

    return { x, y, z };
  }

  function isSamePosition(left, right) {
    return !!left && !!right && left.x === right.x && left.y === right.y && left.z === right.z;
  }

  function getTrustedNames() {
    return Array.from(
      new Set(
        (config.trustedNames || [])
          .map((name) => normalizeName(name))
          .filter(Boolean)
      )
    );
  }

  function getGameMasterNames() {
    return Array.from(
      new Set(
        (config.gameMasterNames || [])
          .map((name) => normalizeName(name))
          .filter(Boolean)
      )
    );
  }

  function getVisiblePlayers() {
    const me = bot.getPlayerPosition();
    const players = bot.xray?.getVisiblePlayers?.() || [];
    if (!me) {
      return players;
    }

    return players.filter((creature) => {
      const z = Number(creature?.__position?.z);
      return Number.isFinite(z) && Math.abs(z - me.z) <= 1;
    });
  }

  function getScreenVisiblePlayers() {
    const me = bot.getPlayerPosition();
    if (!me) {
      return [];
    }

    return (bot.xray?.getVisiblePlayers?.({ sameFloorOnly: true }) || []).filter((creature) => {
      const z = Number(creature?.__position?.z);
      return Number.isFinite(z) && z === Number(me.z);
    });
  }

  function getScreenVisibleNpcs() {
    const npcType = window.CONST?.TYPES?.NPC;
    const me = bot.getPlayerPosition();
    if (npcType == null || !me) {
      return [];
    }

    return (bot.xray?.getVisibleCreatures?.() || []).filter(
      (creature) => creature?.type === npcType && creature.__position?.z === me.z
    );
  }

  function getUnknownVisiblePlayers() {
    const trusted = new Set(getTrustedNames());

    return getVisiblePlayers().filter((creature) => {
      const name = normalizeName(creature?.name);
      return !!name && !trusted.has(name);
    });
  }

  function getTrustedVisiblePlayers() {
    const trusted = new Set(getTrustedNames());

    return getVisiblePlayers().filter((creature) => {
      const name = normalizeName(creature?.name);
      return !!name && trusted.has(name);
    });
  }

  function getVisibleGameMasters() {
    const gameMasters = new Set(getGameMasterNames());

    return getVisiblePlayers().filter((creature) => {
      const name = normalizeName(creature?.name);
      return !!name && gameMasters.has(name);
    });
  }

  function getRecentChannelMessages() {
    return (window.gameClient?.interface?.channelManager?.channels || []).flatMap((channel) =>
      (channel?.__contents || []).map((entry) => {
        const message = String(entry?.message || "");
        const sender = String(entry?.author || entry?.sender || entry?.name || "").trim() ||
          (message.match(/^([^:]{1,50}):\s/)?.[1]?.trim() || "");
        return {
          channelName: channel?.name || null,
          message,
          time: entry?.__time || null,
          sender,
          senderType: entry?.type ?? entry?.senderType ?? null,
          isPrivate: typeof PrivateChannel === "function" && channel instanceof PrivateChannel,
        };
      })
    );
  }

  function getPlayerKey(player) {
    return String(player?.id ?? normalizeName(player?.name) ?? "");
  }

  function getChatAlertKey(entry) {
    return `${entry.channelName || ""}|${entry.time || ""}|${entry.sender || ""}|${entry.message || ""}`;
  }

  function playAlert(reason, details = {}) {
    const now = Date.now();
    if (now - state.lastAlertAt < normalizeDelayMs(config.alertCooldownMs, 3000)) {
      return false;
    }

    state.lastAlertAt = now;
    bot.playAlarm?.();
    bot.log("player alert", { reason, ...details });
    return true;
  }

  function checkPlayerAppearAlert() {
    const visiblePlayers = getScreenVisiblePlayers();
    const currentKeys = new Set(visiblePlayers.map(getPlayerKey).filter(Boolean));
    const appeared = visiblePlayers.filter((player) => !state.visiblePlayerKeys.has(getPlayerKey(player)));
    state.visiblePlayerKeys = currentKeys;

    if (!config.playerAppearAlertEnabled || !appeared.length) {
      return false;
    }

    return playAlert("player-appeared", { players: appeared.map((player) => player.name) });
  }

  function checkNpcAppearAlert() {
    const visibleNpcs = getScreenVisibleNpcs();
    const currentKeys = new Set(visibleNpcs.map(getPlayerKey).filter(Boolean));
    const appeared = visibleNpcs.filter((npc) => !state.visibleNpcKeys.has(getPlayerKey(npc)));
    state.visibleNpcKeys = currentKeys;

    return appeared;
  }

  function stopAutomationsForNpc(npcs) {
    if (!config.npcPauseAutomationEnabled || !npcs.length) {
      return false;
    }

    playAlert("npc-appeared", { npcs: npcs.map((npc) => npc.name) });
    const reason = `NPC detected: ${npcs.map((npc) => npc.name).filter(Boolean).join(", ") || "unknown"}`;
    bot.setStopReason?.(reason, { npcs: npcs.map((npc) => npc.name) });
    const stoppedCave = !!bot.cave?.stop?.({ reason });
    const stoppedAttack = !!bot.attack?.stop?.();
    bot.log("npc detected: automation stopped", {
      npcs: npcs.map((npc) => npc.name),
      stoppedCave,
      stoppedAttack,
    });
    bot.ui?.refreshAutoAttackStatus?.();
    bot.ui?.refreshCaveStatus?.();
    return stoppedCave || stoppedAttack;
  }

  function checkPlayerChatAlert() {
    const selfName = normalizeName(bot.getPlayerName?.());
    const playerType = window.CONST?.TYPES?.PLAYER;
    const npcType = window.CONST?.TYPES?.NPC;
    const messages = getRecentChannelMessages();
    const newMessages = messages.filter((entry) => {
      const key = getChatAlertKey(entry);
      if (state.seenChatKeys.has(key)) {
        return false;
      }
      state.seenChatKeys.add(key);
      if (!entry.sender || normalizeName(entry.sender) === selfName) {
        return false;
      }

      if (npcType != null && entry.senderType === npcType) {
        return false;
      }

      const senderIsOnScreen = getScreenVisiblePlayers().some(
        (player) => normalizeName(player?.name) === normalizeName(entry.sender)
      );
      if (!entry.isPrivate && !senderIsOnScreen) {
        return false;
      }

      if (playerType != null && entry.senderType != null) {
        return entry.senderType === playerType;
      }

      return entry.isPrivate || senderIsOnScreen;
    });

    if (state.seenChatKeys.size > 200) {
      state.seenChatKeys = new Set(Array.from(state.seenChatKeys).slice(-100));
    }

    if (!config.playerChatAlertEnabled || !newMessages.length) {
      return false;
    }

    return playAlert("player-chat", {
      players: Array.from(new Set(newMessages.map((entry) => entry.sender))),
    });
  }

  function parseDamageMessage(entry) {
    const match = entry.message.match(
      /^You lose\s+(\d+)\s+hitpoints\s+due to an attack by\s+(.+?)\.$/i
    );

    if (!match) {
      return null;
    }

    return {
      amount: Number(match[1]),
      attackerName: match[2].trim(),
      time: entry.time,
      channelName: entry.channelName,
      key: `${entry.time || "no-time"}|${entry.message}`,
      message: entry.message,
    };
  }

  function getLatestDamageEvent() {
    const messages = getRecentChannelMessages()
      .map(parseDamageMessage)
      .filter(Boolean)
      .sort((a, b) => {
        const aTime = a.time ? Date.parse(a.time) : 0;
        const bTime = b.time ? Date.parse(b.time) : 0;
        return bTime - aTime;
      });

    return messages[0] || null;
  }

  function getReturnDelayMs() {
    const baseDelayMs = normalizeDelayMs(config.returnDelayMs, 0);
    const jitterMs = normalizeDelayMs(config.returnDelayJitterMs, 0);
    if (!jitterMs) {
      return baseDelayMs;
    }

    const randomOffset = Math.floor(Math.random() * ((jitterMs * 2) + 1)) - jitterMs;
    return Math.max(0, baseDelayMs + randomOffset);
  }

  function clearPendingReturn() {
    state.pendingReturnOrigin = null;
    state.pendingReturnModules = null;
    state.returnNotBeforeAt = 0;
    state.lastThreatAt = 0;
    state.lastReturnAttemptAt = 0;
  }

  function snapshotInterruptedModules() {
    return {
      caveRunning: !!bot.cave?.status?.().running,
      equipRingRunning: !!bot.equipRing?.status?.().running,
    };
  }

  function armPendingReturn(now = Date.now(), origin = normalizePosition(bot.getPlayerPosition())) {
    if (!config.returnToOriginEnabled) {
      clearPendingReturn();
      return;
    }

    if (!state.pendingReturnOrigin && origin) {
      state.pendingReturnOrigin = origin;
      state.pendingReturnModules = snapshotInterruptedModules();
    }

    if (!state.pendingReturnOrigin) {
      return;
    }

    state.lastThreatAt = now;
    state.returnNotBeforeAt = now + getReturnDelayMs();
  }

  function isReturnCoastClear() {
    return !getVisibleGameMasters().length && !getUnknownVisiblePlayers().length;
  }

  function restoreInterruptedModules() {
    if (state.pendingReturnModules?.caveRunning) {
      bot.cave?.start?.();
    }

    if (state.pendingReturnModules?.equipRingRunning) {
      bot.equipRing?.start?.();
      bot.ui?.refreshEquipRingStatus?.();
    }
  }

  function tryReturnToOrigin(now = Date.now()) {
    if (!config.returnToOriginEnabled || !state.pendingReturnOrigin || !state.returnNotBeforeAt) {
      return false;
    }

    if (now < state.returnNotBeforeAt) {
      return false;
    }

    if (!isReturnCoastClear()) {
      return false;
    }

    if (now - state.lastReturnAttemptAt < normalizeDelayMs(config.returnRetryCooldownMs, 2000)) {
      return false;
    }

    const currentPosition = normalizePosition(bot.getPlayerPosition());
    if (isSamePosition(currentPosition, state.pendingReturnOrigin)) {
      bot.log("panic return completed", {
        origin: state.pendingReturnOrigin,
        threatAgeMs: now - state.lastThreatAt,
      });
      restoreInterruptedModules();
      clearPendingReturn();
      return true;
    }

    state.lastReturnAttemptAt = now;
    const moved =
      !!bot.cave?.goToPosition?.(state.pendingReturnOrigin) ||
      !!bot.pz?.goToTile?.({ __position: state.pendingReturnOrigin });

    if (moved) {
      bot.log("panic returning to origin", {
        origin: state.pendingReturnOrigin,
        threatAgeMs: now - state.lastThreatAt,
      });
      return true;
    }

    bot.log("panic return pathing failed", { origin: state.pendingReturnOrigin });
    return false;
  }

  function triggerPanic(reason, details = {}) {
    const now = Date.now();
    armPendingReturn(now);

    if (now - state.lastTriggerAt < config.triggerCooldownMs) {
      return false;
    }

    state.lastTriggerAt = now;
    bot.playAlarm?.();
    bot.log("panic triggered", { reason, ...details });

    if (bot.cave?.stop) {
      bot.cave.stop({ persistEnabled: false });
    }

    if (bot.equipRing?.stop) {
      bot.equipRing.stop({ persistEnabled: false });
      bot.ui?.refreshEquipRingStatus?.();
    }

    return !!bot.pz?.goToHomePz?.();
  }

  function triggerGameMasterKillSwitch(players) {
    const detectedPlayers = (players || []).map((player) => player?.name).filter(Boolean);
    const reason = `GM detected: ${detectedPlayers.join(", ") || "unknown"}`;
    bot.setStopReason?.(reason, { players: detectedPlayers });

    bot.playAlarm?.();
    bot.log("game master kill switch triggered", { players: detectedPlayers });

    if (bot.rune?.stop) {
      bot.rune.stop();
    }

    if (bot.eat?.stop) {
      bot.eat.stop();
    }

    if (bot.invisible?.stop) {
      bot.invisible.stop();
    }

    if (bot.magicShield?.stop) {
      bot.magicShield.stop();
    }

    if (bot.cave?.stop) {
      bot.cave.stop({ reason });
    }

    if (bot.attack?.stop) {
      bot.attack.stop();
    }

    if (bot.equipRing?.stop) {
      bot.equipRing.stop();
    }

    clearPendingReturn();
    config.unknownPlayerEnabled = false;
    config.healthLossEnabled = false;
    persistConfig();
    stop();

    bot.ui?.refreshPanicStatus?.();
    bot.ui?.refreshRuneStatus?.();
    bot.ui?.refreshAutoEatStatus?.();
    bot.ui?.refreshAutoInvisibleStatus?.();
    bot.ui?.refreshAutoMagicShieldStatus?.();
    bot.ui?.refreshAutoAttackStatus?.();
    bot.ui?.refreshCaveStatus?.();
    bot.ui?.refreshEquipRingStatus?.();
    return true;
  }

  function checkGameMasters() {
    if (!getGameMasterNames().length) {
      return false;
    }

    const visibleGameMasters = getVisibleGameMasters();
    if (!visibleGameMasters.length) {
      return false;
    }

    return triggerGameMasterKillSwitch(visibleGameMasters);
  }

  function checkUnknownPlayers() {
    if (!config.unknownPlayerEnabled) {
      return false;
    }

    const unknownPlayers = getUnknownVisiblePlayers();
    if (!unknownPlayers.length) {
      return false;
    }

    return triggerPanic("unknown-player", {
      players: unknownPlayers.map((player) => player.name),
    });
  }

  function checkHealthLoss() {
    if (!config.healthLossEnabled) {
      return false;
    }

    const playerState = bot.getPlayerState();
    const currentHealth = Number(playerState?.health ?? 0);

    if (state.lastHealth == null) {
      state.lastHealth = currentHealth;
      return false;
    }

    const lostHealth = currentHealth < state.lastHealth;
    state.lastHealth = currentHealth;

    if (!lostHealth) {
      return false;
    }

    const latestDamageEvent = getLatestDamageEvent();
    if (latestDamageEvent && latestDamageEvent.key !== state.lastDamageEventKey) {
      state.lastDamageEventKey = latestDamageEvent.key;

      const trustedNames = new Set(getTrustedNames());
      const attackerName = normalizeName(latestDamageEvent.attackerName);

      if (attackerName && trustedNames.has(attackerName)) {
        bot.log("ignored health-loss panic because attacker is trusted", {
          attacker: latestDamageEvent.attackerName,
          amount: latestDamageEvent.amount,
          currentHealth,
        });
        return false;
      }

      return triggerPanic("health-loss", {
        currentHealth,
        attacker: latestDamageEvent.attackerName,
        amount: latestDamageEvent.amount,
      });
    }

    const unknownPlayers = getUnknownVisiblePlayers();
    if (!unknownPlayers.length) {
      const trustedPlayers = getTrustedVisiblePlayers();
      if (trustedPlayers.length) {
        bot.log("ignored health-loss panic because only trusted players are nearby", {
          players: trustedPlayers.map((player) => player.name),
          currentHealth,
        });
        return false;
      }
    }

    return triggerPanic("health-loss", { currentHealth });
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
      checkPlayerAppearAlert();
      stopAutomationsForNpc(checkNpcAppearAlert());
      checkPlayerChatAlert();
      const triggered = checkGameMasters() || checkUnknownPlayers() || checkHealthLoss();
      if (!triggered) {
        tryReturnToOrigin();
      }
    } finally {
      scheduleNextTick();
    }
  }

  function shouldRun() {
    return !!(
      getGameMasterNames().length ||
      config.unknownPlayerEnabled ||
      config.healthLossEnabled ||
      config.playerAppearAlertEnabled ||
      config.npcPauseAutomationEnabled ||
      config.playerChatAlertEnabled
    );
  }

  function start() {
    if (state.running) {
      return false;
    }

    state.running = true;
    state.lastHealth = Number(bot.getPlayerState()?.health ?? 0);
    state.lastDamageEventKey = getLatestDamageEvent()?.key || null;
    state.visiblePlayerKeys = new Set(getVisiblePlayers().map(getPlayerKey).filter(Boolean));
    state.visibleNpcKeys = new Set(getScreenVisibleNpcs().map(getPlayerKey).filter(Boolean));
    state.seenChatKeys = new Set(getRecentChannelMessages().map(getChatAlertKey));
    bot.log("panic runner started", { ...config });
    tick();
    return true;
  }

  function stop() {
    if (!state.running && state.timerId == null) {
      state.lastHealth = null;
      return false;
    }

    state.running = false;

    if (state.timerId != null) {
      window.clearTimeout(state.timerId);
      state.timerId = null;
    }

    state.lastHealth = null;
    state.lastDamageEventKey = null;
    state.visiblePlayerKeys.clear();
    state.visibleNpcKeys.clear();
    state.seenChatKeys.clear();
    clearPendingReturn();
    bot.log("panic runner stopped");
    return true;
  }

  function syncRunningState() {
    if (shouldRun()) {
      start();
    } else {
      stop();
    }
  }

  function updateConfig(nextConfig = {}) {
    const next = { ...nextConfig };

    if (Array.isArray(next.trustedNames)) {
      next.trustedNames = next.trustedNames
        .map((name) => String(name || "").trim())
        .filter(Boolean);
    }

    if (Array.isArray(next.gameMasterNames)) {
      next.gameMasterNames = ensureDefaultGameMasterNames(next.gameMasterNames
        .map((name) => String(name || "").trim())
        .filter(Boolean));
    }

    if ("triggerCooldownMs" in next) {
      next.triggerCooldownMs = normalizeDelayMs(next.triggerCooldownMs, config.triggerCooldownMs);
    }

    if ("alertCooldownMs" in next) {
      next.alertCooldownMs = normalizeDelayMs(next.alertCooldownMs, config.alertCooldownMs);
    }

    if ("returnDelayMs" in next) {
      next.returnDelayMs = normalizeDelayMs(next.returnDelayMs, config.returnDelayMs);
    }

    if ("returnDelayJitterMs" in next) {
      next.returnDelayJitterMs = normalizeDelayMs(next.returnDelayJitterMs, config.returnDelayJitterMs);
    }

    if ("returnRetryCooldownMs" in next) {
      next.returnRetryCooldownMs = normalizeDelayMs(
        next.returnRetryCooldownMs,
        config.returnRetryCooldownMs
      );
    }

    Object.assign(config, next);
    if (!config.returnToOriginEnabled) {
      clearPendingReturn();
    }
    persistConfig();
    syncRunningState();
    bot.log("panic runner config updated", { ...config });
    return { ...config };
  }

  function status() {
    return {
      running: state.running,
      config: {
        ...config,
        trustedNames: [...config.trustedNames],
        gameMasterNames: [...config.gameMasterNames],
      },
      visiblePlayers: getVisiblePlayers().map((player) => ({
        id: player.id,
        name: player.name,
        position: player.__position || null,
      })),
      visibleNpcs: getScreenVisibleNpcs().map((npc) => ({
        id: npc.id,
        name: npc.name,
        position: npc.__position || null,
      })),
      unknownVisiblePlayers: getUnknownVisiblePlayers().map((player) => ({
        id: player.id,
        name: player.name,
        position: player.__position || null,
      })),
      trustedVisiblePlayers: getTrustedVisiblePlayers().map((player) => ({
        id: player.id,
        name: player.name,
        position: player.__position || null,
      })),
      visibleGameMasters: getVisibleGameMasters().map((player) => ({
        id: player.id,
        name: player.name,
        position: player.__position || null,
      })),
      latestDamageEvent: getLatestDamageEvent(),
      lastTriggerAt: state.lastTriggerAt,
      pendingReturn: state.pendingReturnOrigin
        ? {
            origin: { ...state.pendingReturnOrigin },
            modules: state.pendingReturnModules ? { ...state.pendingReturnModules } : null,
            returnNotBeforeAt: state.returnNotBeforeAt,
            lastThreatAt: state.lastThreatAt,
            lastReturnAttemptAt: state.lastReturnAttemptAt,
            coastClear: isReturnCoastClear(),
          }
        : null,
    };
  }

  if (shouldRun()) {
    start();
  }

  bot.panic = {
    start,
    stop,
    status,
    updateConfig,
    getVisiblePlayers,
    getScreenVisibleNpcs,
    getUnknownVisiblePlayers,
    getTrustedVisiblePlayers,
    getVisibleGameMasters,
    getTrustedNames,
    getGameMasterNames,
    config,
  };
};
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
window.__mageTuntunBundle = window.__mageTuntunBundle || {};

window.__mageTuntunBundle.installAutoSioModule = function installAutoSioModule(bot) {
  const configStorageKey = "mageTuntun.sio.config";
  const MIN_SPELL_COOLDOWN_MS = 1000;
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
      cooldownMs: 2000,
      enabled: false,
    },
    bot.storage.get(configStorageKey, {})
  );
  config.tickMs = 250;
  config.minHpPercent = Math.min(100, Math.max(1, Number(config.minHpPercent) || 50));
  config.cooldownMs = Math.max(MIN_SPELL_COOLDOWN_MS, Number(config.cooldownMs) || MIN_SPELL_COOLDOWN_MS);

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
    config.cooldownMs = Math.max(MIN_SPELL_COOLDOWN_MS, Number(config.cooldownMs) || MIN_SPELL_COOLDOWN_MS);
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
      nextConfig.cooldownMs = Math.max(MIN_SPELL_COOLDOWN_MS, Number(nextConfig.cooldownMs) || MIN_SPELL_COOLDOWN_MS);
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
window.__mageTuntunBundle = window.__mageTuntunBundle || {};

window.__mageTuntunBundle.installAutoInvisibleModule = function installAutoInvisibleModule(bot) {
  const configStorageKey = "mageTuntun.invisible.config";
  const INVISIBLE_CONDITION_ID = 4;
  const MIN_SPELL_COOLDOWN_MS = 1000;
  const state = {
    running: false,
    timerId: null,
    lastCastAt: 0,
  };
  let resumeListenersAttached = false;

  const config = Object.assign(
    {
      tickMs: 500,
      spellWords: "utana vid",
      recastCooldownMs: 2000,
      enabled: false,
    },
    bot.storage.get(configStorageKey, {})
  );
  config.tickMs = 500;
  config.recastCooldownMs = Math.max(MIN_SPELL_COOLDOWN_MS, Number(config.recastCooldownMs) || MIN_SPELL_COOLDOWN_MS);

  function persistConfig() {
    bot.storage.set(configStorageKey, { ...config });
  }

  function getInvisibleConditionId() {
    return window.ConditionManager?.prototype?.INVISIBLE ?? INVISIBLE_CONDITION_ID;
  }

  function isInvisibleActive() {
    const player = window.gameClient?.player;
    const conditions = player?.conditions;
    const invisibleConditionId = getInvisibleConditionId();

    if (conditions?.has) {
      return conditions.has(invisibleConditionId);
    }

    if (player?.hasCondition) {
      return player.hasCondition(invisibleConditionId);
    }

    return false;
  }

  function getGateStatus(now = Date.now()) {
    const cooldownRemainingMs = Math.max(0, config.recastCooldownMs - (now - state.lastCastAt));
    const cooldownReady = cooldownRemainingMs === 0;
    const invisibleActive = isInvisibleActive();

    return {
      invisibleActive,
      cooldownReady,
      cooldownRemainingMs,
      canCast: !invisibleActive && cooldownReady,
    };
  }

  function canCastInvisible(now = Date.now()) {
    return getGateStatus(now).canCast;
  }

  function tryCastInvisible(now = Date.now()) {
    if (!config.enabled || !canCastInvisible(now)) {
      return false;
    }

    const sent = bot.sendChat(config.spellWords);
    if (sent) {
      state.lastCastAt = now;
      bot.log("cast invisible spell", { spellWords: config.spellWords });
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
      tryCastInvisible();
    } catch (error) {
      bot.log("auto invisible tick failed", error?.message || error);
    } finally {
      scheduleNextTick();
    }
  }

  function start(overrides = {}) {
    Object.assign(config, overrides, { enabled: true });
    config.tickMs = 500;
    config.recastCooldownMs = Math.max(MIN_SPELL_COOLDOWN_MS, Number(config.recastCooldownMs) || MIN_SPELL_COOLDOWN_MS);
    persistConfig();

    if (state.running) {
      bot.log("auto invisible already running");
      return false;
    }

    state.running = true;
    attachResumeListeners();
    bot.log("auto invisible started", { ...config });
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

    bot.log("auto invisible stopped");
    return true;
  }

  function status() {
    return {
      running: state.running,
      config: { ...config },
      gates: getGateStatus(),
      lastCastAt: state.lastCastAt,
    };
  }

  function updateConfig(nextConfig = {}) {
    if (Object.prototype.hasOwnProperty.call(nextConfig, "spellWords")) {
      nextConfig.spellWords = String(nextConfig.spellWords || "").trim() || config.spellWords;
    }

    if (Object.prototype.hasOwnProperty.call(nextConfig, "recastCooldownMs")) {
      nextConfig.recastCooldownMs = Math.max(MIN_SPELL_COOLDOWN_MS, Number(nextConfig.recastCooldownMs) || MIN_SPELL_COOLDOWN_MS);
    }

    Object.assign(config, nextConfig);
    config.tickMs = 500;
    persistConfig();
    bot.log("auto invisible config updated", { ...config });
    return { ...config };
  }

  if (config.enabled) {
    start();
  }

  bot.invisible = {
    start,
    stop,
    status,
    updateConfig,
    isInvisibleActive,
    canCastInvisible,
    tryCastInvisible,
    config,
  };
};
window.__mageTuntunBundle = window.__mageTuntunBundle || {};

window.__mageTuntunBundle.installAutoMagicShieldModule = function installAutoMagicShieldModule(bot) {
  const configStorageKey = "mageTuntun.magicShield.config";
  const MAGIC_SHIELD_FALLBACK_DURATION_MS = 180000;
  const MIN_SPELL_COOLDOWN_MS = 1000;
  const state = {
    running: false,
    timerId: null,
    lastCastAt: 0,
    assumedActiveUntil: 0,
  };
  let resumeListenersAttached = false;

  const config = Object.assign(
    {
      tickMs: 500,
      spellWords: "utamo vita",
      recastCooldownMs: 2000,
      enabled: false,
    },
    bot.storage.get(configStorageKey, {})
  );
  config.tickMs = 500;
  config.recastCooldownMs = Math.max(MIN_SPELL_COOLDOWN_MS, Number(config.recastCooldownMs) || MIN_SPELL_COOLDOWN_MS);

  function persistConfig() {
    bot.storage.set(configStorageKey, { ...config });
  }

  function getMagicShieldConditionId() {
    const conditionManagerPrototype = window.ConditionManager?.prototype;
    const playerConditions = window.gameClient?.player?.conditions;
    const candidateKeys = [
      "MAGIC_SHIELD",
      "MANA_SHIELD",
      "MAGICSHIELD",
      "MANASHIELD",
      "UTAMO_VITA",
    ];

    for (const key of candidateKeys) {
      const value = conditionManagerPrototype?.[key] ?? playerConditions?.[key];
      if (typeof value === "number" && Number.isFinite(value)) {
        return value;
      }
    }

    return null;
  }

  function isMagicShieldActive(now = Date.now()) {
    const player = window.gameClient?.player;
    const conditions = player?.conditions;
    const magicShieldConditionId = getMagicShieldConditionId();

    if (magicShieldConditionId != null) {
      if (conditions?.has) {
        return conditions.has(magicShieldConditionId);
      }

      if (player?.hasCondition) {
        return player.hasCondition(magicShieldConditionId);
      }
    }

    return now < state.assumedActiveUntil;
  }

  function getGateStatus(now = Date.now()) {
    const cooldownRemainingMs = Math.max(0, config.recastCooldownMs - (now - state.lastCastAt));
    const cooldownReady = cooldownRemainingMs === 0;
    const magicShieldActive = isMagicShieldActive(now);

    return {
      magicShieldActive,
      cooldownReady,
      cooldownRemainingMs,
      canCast: !magicShieldActive && cooldownReady,
    };
  }

  function canCastMagicShield(now = Date.now()) {
    return getGateStatus(now).canCast;
  }

  function tryCastMagicShield(now = Date.now()) {
    if (!config.enabled || !canCastMagicShield(now)) {
      return false;
    }

    const sent = bot.sendChat(config.spellWords);
    if (sent) {
      state.lastCastAt = now;
      state.assumedActiveUntil = now + MAGIC_SHIELD_FALLBACK_DURATION_MS;
      bot.log("cast magic shield spell", { spellWords: config.spellWords });
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
      tryCastMagicShield();
    } catch (error) {
      bot.log("auto magic shield tick failed", error?.message || error);
    } finally {
      scheduleNextTick();
    }
  }

  function start(overrides = {}) {
    Object.assign(config, overrides, { enabled: true });
    config.tickMs = 500;
    config.recastCooldownMs = Math.max(MIN_SPELL_COOLDOWN_MS, Number(config.recastCooldownMs) || MIN_SPELL_COOLDOWN_MS);
    persistConfig();

    if (state.running) {
      bot.log("auto magic shield already running");
      return false;
    }

    state.running = true;
    attachResumeListeners();
    bot.log("auto magic shield started", { ...config });
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

    bot.log("auto magic shield stopped");
    return true;
  }

  function status() {
    return {
      running: state.running,
      config: { ...config },
      gates: getGateStatus(),
      lastCastAt: state.lastCastAt,
      assumedActiveUntil: state.assumedActiveUntil,
    };
  }

  function updateConfig(nextConfig = {}) {
    if (Object.prototype.hasOwnProperty.call(nextConfig, "spellWords")) {
      nextConfig.spellWords = String(nextConfig.spellWords || "").trim() || config.spellWords;
    }

    if (Object.prototype.hasOwnProperty.call(nextConfig, "recastCooldownMs")) {
      nextConfig.recastCooldownMs = Math.max(MIN_SPELL_COOLDOWN_MS, Number(nextConfig.recastCooldownMs) || MIN_SPELL_COOLDOWN_MS);
    }

    Object.assign(config, nextConfig);
    config.tickMs = 500;
    persistConfig();
    bot.log("auto magic shield config updated", { ...config });
    return { ...config };
  }

  if (config.enabled) {
    start();
  }

  bot.magicShield = {
    start,
    stop,
    status,
    updateConfig,
    isMagicShieldActive,
    canCastMagicShield,
    tryCastMagicShield,
    config,
  };
};
window.__mageTuntunBundle = window.__mageTuntunBundle || {};

window.__mageTuntunBundle.installAutoHasteModule = function installAutoHasteModule(bot) {
  const configStorageKey = "mageTuntun.haste.config";
  const MIN_SPELL_COOLDOWN_MS = 1000;
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
  config.recastCooldownMs = Math.max(MIN_SPELL_COOLDOWN_MS, Number(config.recastCooldownMs) || MIN_SPELL_COOLDOWN_MS);

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
    config.recastCooldownMs = Math.max(MIN_SPELL_COOLDOWN_MS, Number(config.recastCooldownMs) || MIN_SPELL_COOLDOWN_MS);
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
      nextConfig.recastCooldownMs = Math.max(MIN_SPELL_COOLDOWN_MS, Number(nextConfig.recastCooldownMs) || MIN_SPELL_COOLDOWN_MS);
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
window.__mageTuntunBundle = window.__mageTuntunBundle || {};

window.__mageTuntunBundle.installAutoAttackModule = function installAutoAttackModule(bot) {
  const configStorageKey = "mageTuntun.attack.config";
  const state = {
    running: false,
    timerId: null,
    lastTargetHotkeyAt: 0,
    lastRuneHotkeyAt: 0,
    engagedTargetId: null,
    combatStartedAt: 0,
    lastChaseAt: 0,
    lastChaseDestinationKey: null,
    lastFollowTargetId: null,
    lastFollowDistance: Number.POSITIVE_INFINITY,
    lastFollowProgressAt: 0,
    lastFollowStallAt: 0,
    lastKiteMoveAt: 0,
    lastKiteDestinationKey: null,
    lastEngagedTargetPosition: null,
    lootReturnPosition: null,
    lootReturnStartedAt: 0,
    lootReturnDestinationKey: null,
    skippedTargetIds: new Map(),
  };

  const storedConfig = bot.storage.get(configStorageKey, {}) || {};
  const config = Object.assign(
    {
      tickMs: 250,
      targetHotbarSlot: 3,
      runeHotbarSlot: null,
      targetCooldownMs: 600,
      runeCooldownMs: 2000,
      maxTargetDistance: 8,
      meleeMode: true,
      combatMovement: "auto",
      kiteMinDistance: 3,
      kiteMaxDistance: 5,
      kiteMoveCooldownMs: 350,
      ignoredMonsterNames: [],
      priorityMonsterNames: [],
      ignoreSummons: true,
      kiteRetreatToRoute: true,
      enabled: false,
    },
    storedConfig
  );
  if (config.targetHotbarSlot == null && storedConfig.hotbarSlot != null) {
    config.targetHotbarSlot = storedConfig.hotbarSlot;
  }
  config.combatMovement = config.combatMovement === "kite" ? "kite" : "auto";
  config.kiteMinDistance = Math.max(1, Math.trunc(Number(config.kiteMinDistance) || 3));
  config.kiteMaxDistance = Math.max(config.kiteMinDistance, Math.trunc(Number(config.kiteMaxDistance) || 5));
  config.kiteMoveCooldownMs = Math.max(250, Number(config.kiteMoveCooldownMs) || 350);
  config.targetCooldownMs = Math.max(300, Number(config.targetCooldownMs) || 600);
  config.runeCooldownMs = Math.max(1000, Number(config.runeCooldownMs) || 2000);
  config.ignoredMonsterNames = normalizeMonsterNames(config.ignoredMonsterNames);
  config.priorityMonsterNames = normalizeMonsterNames(config.priorityMonsterNames);
  config.ignoreSummons = config.ignoreSummons !== false;
  config.kiteRetreatToRoute = config.kiteRetreatToRoute !== false;

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

  function normalizeMonsterNames(value) {
    const names = Array.isArray(value) ? value : String(value || "").split(",");
    const deduped = new Map();
    names.forEach((name) => {
      const displayName = String(name || "").trim().replace(/\s+/g, " ");
      if (displayName) deduped.set(displayName.toLowerCase(), displayName);
    });
    return Array.from(deduped.values());
  }

  function isIgnoredMonster(monster) {
    const name = String(monster?.name || "").trim().toLowerCase();
    return !!name && config.ignoredMonsterNames.some((ignoredName) => ignoredName.toLowerCase() === name);
  }

  function isSummon(monster) {
    return Number(monster?.masterId) > 0;
  }

  function getMonsterPriority(monster) {
    const name = String(monster?.name || "").trim().toLowerCase();
    const priorityIndex = config.priorityMonsterNames.findIndex(
      (priorityName) => priorityName.toLowerCase() === name
    );
    return priorityIndex === -1 ? Number.POSITIVE_INFINITY : priorityIndex;
  }

  function getCombatMovement() {
    if (config.combatMovement === "kite") {
      return "kite";
    }

    return config.meleeMode === false ? "hold" : "follow";
  }

  function getNearbyMonsters() {
    return bot.xray?.getVisibleMonsters?.({ sameFloorOnly: true }) || [];
  }

  function normalizePosition(value) {
    if (!value) {
      return null;
    }

    const x = Number(value.x);
    const y = Number(value.y);
    const z = Number(value.z);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      return null;
    }

    return {
      x: Math.trunc(x),
      y: Math.trunc(y),
      z: Math.trunc(z),
    };
  }

  function getPositionKey(position) {
    return position ? `${position.x},${position.y},${position.z}` : null;
  }

  function isAdjacentTile(from, to) {
    if (!from || !to || Number(from.z) !== Number(to.z)) {
      return false;
    }

    const dx = Math.abs(Number(from.x) - Number(to.x));
    const dy = Math.abs(Number(from.y) - Number(to.y));
    return (dx !== 0 || dy !== 0) && dx <= 1 && dy <= 1;
  }

  function getTileDistance(from, to) {
    if (!from || !to || Number(from.z) !== Number(to.z)) {
      return Number.POSITIVE_INFINITY;
    }

    return Math.max(
      Math.abs(Number(from.x) - Number(to.x)),
      Math.abs(Number(from.y) - Number(to.y))
    );
  }

  function getKiteRetreatWaypoint(playerPosition) {
    if (!config.kiteRetreatToRoute) {
      return null;
    }

    const caveStatus = bot.cave?.status?.();
    if (!caveStatus?.running || !Array.isArray(caveStatus.route) || caveStatus.route.length < 2) {
      return null;
    }

    const currentIndex = Math.trunc(Number(caveStatus.currentIndex));
    const direction = Math.sign(Number(caveStatus.direction));
    const previousIndex = currentIndex - direction;
    if (!Number.isInteger(currentIndex) || !direction || previousIndex < 0 || previousIndex >= caveStatus.route.length) {
      return null;
    }

    const waypoint = normalizePosition(caveStatus.route[previousIndex]);
    return waypoint?.z === playerPosition?.z ? waypoint : null;
  }

  function isSameCreature(left, right) {
    if (!left || !right) {
      return false;
    }

    return left === right || left.id === right.id;
  }

  function findNearbyMonster(creature) {
    if (!creature) {
      return null;
    }

    const nearbyMonsters = getNearbyMonsters();
    return nearbyMonsters.find((monster) => isSameCreature(monster, creature)) || null;
  }

  function findNearbyMonsterById(id) {
    if (id == null) {
      return null;
    }

    return getNearbyMonsters().find((monster) => monster?.id === id) || null;
  }

  function getCurrentTarget() {
    return window.gameClient?.player?.__target || null;
  }

  function getCurrentFollowTarget() {
    return window.gameClient?.player?.__followTarget || null;
  }

  function pruneSkippedTargets(now = Date.now()) {
    for (const [id, expiresAt] of state.skippedTargetIds.entries()) {
      if (expiresAt <= now) {
        state.skippedTargetIds.delete(id);
      }
    }
  }

  function resetFollowProgress() {
    state.lastFollowTargetId = null;
    state.lastFollowDistance = Number.POSITIVE_INFINITY;
    state.lastFollowProgressAt = 0;
    state.lastFollowStallAt = 0;
  }

  function clearEngagedTarget() {
    state.engagedTargetId = null;
    state.combatStartedAt = 0;
    state.lastChaseDestinationKey = null;
    resetFollowProgress();
    state.lastKiteDestinationKey = null;
  }

  function rememberEngagedTargetPosition(target) {
    const position = normalizePosition(target?.getPosition?.() || target?.__position);
    if (position) {
      state.lastEngagedTargetPosition = position;
    }
  }

  function queueLastTargetApproach() {
    const playerPosition = normalizePosition(bot.getPlayerPosition());
    const targetPosition = state.lastEngagedTargetPosition;
    if (!playerPosition || !targetPosition || playerPosition.z !== targetPosition.z ||
      getTileDistance(playerPosition, targetPosition) === 0) {
      return false;
    }

    state.lootReturnPosition = { ...targetPosition };
    state.lootReturnStartedAt = Date.now();
    state.lootReturnDestinationKey = null;
    bot.log("approaching last target position", { destination: state.lootReturnPosition });
    return true;
  }

  function clearCurrentFollowTarget() {
    if (!window.gameClient?.player || typeof window.gameClient.send !== "function") {
      return false;
    }

    if (typeof FollowPacket !== "function") {
      return false;
    }

    if (!getCurrentFollowTarget()) {
      return false;
    }

    window.gameClient.player.setFollowTarget(null);
    window.gameClient.send(new FollowPacket(0));
    return true;
  }

  function clearCurrentTarget() {
    if (!window.gameClient?.player || typeof window.gameClient.send !== "function") {
      return false;
    }

    if (typeof TargetPacket !== "function") {
      return false;
    }

    if (!getCurrentTarget()) {
      return false;
    }

    window.gameClient.player.setTarget(null);
    window.gameClient.send(new TargetPacket(0));
    return true;
  }

  function markCombatActive(now = Date.now()) {
    if (!state.combatStartedAt) {
      state.combatStartedAt = now;
    }
  }

  function getCombatTargetCount() {
    return getEngagedTarget() ? 1 : 0;
  }

  function isCombatActive() {
    if (!config.enabled || !state.running) {
      return false;
    }

    return !!getEngagedTarget() || !!state.lootReturnPosition || getMonsterCandidates().length > 0;
  }

  function syncCombatState(now = Date.now()) {
    if (isCombatActive()) {
      markCombatActive(now);
      return true;
    }

    state.combatStartedAt = 0;
    return false;
  }

  function getEngagedTarget() {
    const currentTarget = getCurrentTarget();
    if (state.engagedTargetId != null) {
      if (isSameCreature(currentTarget, { id: state.engagedTargetId })) {
        rememberEngagedTargetPosition(currentTarget);
        return currentTarget;
      }

      const lockedTarget = findNearbyMonsterById(state.engagedTargetId);
      if (lockedTarget) {
        rememberEngagedTargetPosition(lockedTarget);
        return lockedTarget;
      }

      const followTarget = getCurrentFollowTarget();
      if (followTarget && followTarget.id === state.engagedTargetId) {
        const visibleFollowTarget = findNearbyMonster(followTarget) || followTarget;
        rememberEngagedTargetPosition(visibleFollowTarget);
        return visibleFollowTarget;
      }

      queueLastTargetApproach();
      clearEngagedTarget();
    }

    if (currentTarget) {
      state.engagedTargetId = currentTarget.id;
      rememberEngagedTargetPosition(currentTarget);
      return currentTarget;
    }

    const followTarget = getCurrentFollowTarget();
    if (followTarget) {
      state.engagedTargetId = followTarget.id;
      const visibleFollowTarget = findNearbyMonster(followTarget) || followTarget;
      rememberEngagedTargetPosition(visibleFollowTarget);
      return visibleFollowTarget;
    }

    return null;
  }

  function syncLockedTarget() {
    const engagedTarget = getEngagedTarget();
    if (!engagedTarget || isSameCreature(getCurrentTarget(), engagedTarget)) {
      return false;
    }

    return setCurrentTarget(engagedTarget);
  }

  function syncPriorityTarget(now = Date.now()) {
    const engagedTarget = getEngagedTarget();
    if (!engagedTarget) {
      return false;
    }

    const currentPriority = getMonsterPriority(engagedTarget);
    const preferredTarget = getMonsterCandidates(now)[0];
    if (!preferredTarget || isSameCreature(preferredTarget, engagedTarget)) {
      return false;
    }

    const preferredPriority = getMonsterPriority(preferredTarget);
    if (!(preferredPriority < currentPriority)) {
      return false;
    }

    const previousTarget = engagedTarget;
    clearCurrentFollowTarget();
    resetFollowProgress();
    state.lastKiteDestinationKey = null;
    const switched = setCurrentTarget(preferredTarget);
    if (switched) {
      bot.log("switched auto attack target for priority", {
        from: { id: previousTarget.id, name: previousTarget.name || "Mob", priority: currentPriority },
        to: { id: preferredTarget.id, name: preferredTarget.name || "Mob", priority: preferredPriority },
      });
    }
    return switched;
  }

  function setCurrentTarget(target) {
    if (!target || !window.gameClient?.player || typeof window.gameClient.send !== "function") {
      return false;
    }

    if (typeof TargetPacket !== "function") {
      return false;
    }

    window.gameClient.player.setTarget(target);
    window.gameClient.send(new TargetPacket(target.id));
    state.engagedTargetId = target.id;
    state.lootReturnPosition = null;
    state.lootReturnStartedAt = 0;
    state.lootReturnDestinationKey = null;
    rememberEngagedTargetPosition(target);
    return true;
  }

  function setCurrentFollowTarget(target) {
    if (!target || !window.gameClient?.player || typeof window.gameClient.send !== "function") {
      return false;
    }

    if (typeof FollowPacket !== "function") {
      return false;
    }

    if (isSameCreature(getCurrentFollowTarget(), target)) {
      return true;
    }

    window.gameClient.player.setFollowTarget(target);
    window.gameClient.send(new FollowPacket(target.id));
    return true;
  }

  function skipTarget(target, reason, now = Date.now(), skipMs = 4000) {
    if (!target?.id) {
      return false;
    }

    const until = now + Math.max(500, Number(skipMs) || 0);
    state.skippedTargetIds.set(target.id, until);

    const clearedTarget = isSameCreature(getCurrentTarget(), target) ? clearCurrentTarget() : false;
    const clearedFollow = isSameCreature(getCurrentFollowTarget(), target) ? clearCurrentFollowTarget() : false;

    if (state.engagedTargetId === target.id) {
      clearEngagedTarget();
    } else if (state.lastFollowTargetId === target.id) {
      resetFollowProgress();
    }

    bot.log("skipping auto attack target", {
      id: target.id,
      name: target.name || "Mob",
      reason,
      skippedForMs: Math.max(500, Number(skipMs) || 0),
      clearedTarget,
      clearedFollow,
    });
    return true;
  }

  function isTargetSkipped(target, now = Date.now()) {
    pruneSkippedTargets(now);
    return !!target?.id && (state.skippedTargetIds.get(target.id) || 0) > now;
  }

  function getMonsterCandidates(now = Date.now()) {
    pruneSkippedTargets(now);

    const playerPosition = normalizePosition(bot.getPlayerPosition());
    return getNearbyMonsters()
      .filter((monster) => (
        !isIgnoredMonster(monster) &&
        (!config.ignoreSummons || !isSummon(monster)) &&
        !isTargetSkipped(monster, now)
      ))
      .filter((monster) => {
        const invalidReason = getTargetInvalidReason(monster, playerPosition);
        if (!invalidReason) {
          return true;
        }

        // Avoid repeating a path search every tick for a monster visible
        // through a wall or from another, disconnected spawn.
        if (invalidReason === "no reachable combat tile" && monster?.id != null) {
          state.skippedTargetIds.set(monster.id, now + 4000);
        }
        return false;
      })
      .sort((left, right) => {
        const priorityDifference = getMonsterPriority(left) - getMonsterPriority(right);
        if (priorityDifference) {
          return priorityDifference;
        }
        const leftDistance = getTileDistance(playerPosition, normalizePosition(left?.getPosition?.() || left?.__position));
        const rightDistance = getTileDistance(playerPosition, normalizePosition(right?.getPosition?.() || right?.__position));
        return leftDistance - rightDistance || Number(left?.id || 0) - Number(right?.id || 0);
      });
  }

  function isReachableCombatTarget(target, playerPosition = normalizePosition(bot.getPlayerPosition())) {
    const targetPosition = normalizePosition(target?.getPosition?.() || target?.__position);
    if (!playerPosition || !targetPosition || playerPosition.z !== targetPosition.z) {
      return false;
    }

    if (getTileDistance(playerPosition, targetPosition) <= 1) {
      return true;
    }

    const pathfinder = window.gameClient?.world?.pathfinder;
    const startTile = getTileFromPosition(playerPosition);
    // Preserve distance-only selection while the world/pathfinder is loading.
    if (!pathfinder || !startTile || typeof pathfinder.search !== "function") {
      return true;
    }

    return !!findReachableAdjacentPosition(targetPosition, playerPosition);
  }

  function getTargetInvalidReason(target, playerPosition = normalizePosition(bot.getPlayerPosition())) {
    if (isIgnoredMonster(target) || (config.ignoreSummons && isSummon(target))) {
      return "ignored target";
    }

    // A selected target can outlive its creature update for a short time.
    // Never keep attacking an id after its monster is no longer on screen.
    if (target?.id != null && !findNearbyMonster(target)) {
      return "target not visible";
    }

    const maxTargetDistance = Math.max(1, Number(config.maxTargetDistance) || 8);
    const targetPosition = normalizePosition(target?.getPosition?.() || target?.__position);
    if (!playerPosition || !targetPosition) {
      return null;
    }

    if (getTileDistance(playerPosition, targetPosition) > maxTargetDistance) {
      return "target too far";
    }

    return isReachableCombatTarget(target, playerPosition) ? null : "no reachable combat tile";
  }

  function shouldGiveUpTarget(target) {
    return !!getTargetInvalidReason(target);
  }

  function resetTargetIfTooFar() {
    const currentTarget = getCurrentTarget();
    const currentTargetReason = getTargetInvalidReason(currentTarget);
    if (currentTarget && currentTargetReason) {
      if (currentTargetReason === "target not visible") {
        queueLastTargetApproach();
      }
      skipTarget(currentTarget, currentTargetReason, Date.now(), 2500);
      bot.log("gave up unreachable auto attack target", {
        id: currentTarget.id,
        name: currentTarget.name || "Mob",
        reason: currentTargetReason,
        position: normalizePosition(currentTarget.getPosition?.() || currentTarget.__position),
        maxTargetDistance: Math.max(1, Number(config.maxTargetDistance) || 8),
      });
      return true;
    }

    const engagedTarget = getEngagedTarget();
    const engagedTargetReason = getTargetInvalidReason(engagedTarget);
    if (engagedTarget && engagedTargetReason) {
      skipTarget(engagedTarget, engagedTargetReason, Date.now(), 2500);
      bot.log("gave up unreachable auto attack target", {
        id: engagedTarget.id,
        name: engagedTarget.name || "Mob",
        reason: engagedTargetReason,
        position: normalizePosition(engagedTarget.getPosition?.() || engagedTarget.__position),
        maxTargetDistance: Math.max(1, Number(config.maxTargetDistance) || 8),
      });
      return true;
    }

    return false;
  }

  function getTileFromPosition(position) {
    if (!position || typeof Position !== "function") {
      return null;
    }

    return window.gameClient?.world?.getTileFromWorldPosition?.(
      new Position(position.x, position.y, position.z)
    ) || null;
  }

  function findReachableAdjacentPosition(targetPosition, playerPosition) {
    if (!targetPosition || !playerPosition) {
      return null;
    }

    const offsets = [
      { x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 },
      { x: -1, y: -1 }, { x: 1, y: -1 }, { x: -1, y: 1 }, { x: 1, y: 1 },
    ];

    offsets.sort((a, b) => {
      const da = Math.abs(targetPosition.x + a.x - playerPosition.x) +
        Math.abs(targetPosition.y + a.y - playerPosition.y);
      const db = Math.abs(targetPosition.x + b.x - playerPosition.x) +
        Math.abs(targetPosition.y + b.y - playerPosition.y);
      return da - db;
    });

    const pathfinder = window.gameClient?.world?.pathfinder;
    const startTile = getTileFromPosition(playerPosition);
    if (!pathfinder || !startTile || typeof pathfinder.search !== "function") {
      return null;
    }

    for (const offset of offsets) {
      const candidatePosition = {
        x: targetPosition.x + offset.x,
        y: targetPosition.y + offset.y,
        z: targetPosition.z,
      };
      const tile = getTileFromPosition(candidatePosition);
      if (!tile?.isWalkable?.()) {
        continue;
      }

      if (candidatePosition.x === playerPosition.x && candidatePosition.y === playerPosition.y) {
        return candidatePosition;
      }

      try {
        const path = pathfinder.search(startTile, tile);
        if (Array.isArray(path) && path.length > 0) {
          return candidatePosition;
        }
      } catch (error) {
        bot.log("auto attack reachability check failed", {
          ...candidatePosition,
          error: error?.message || error,
        });
        return null;
      }
    }

    return null;
  }

  function syncMeleeChase(now = Date.now()) {
    if (getCombatMovement() !== "follow") {
      return false;
    }

    const target = getEngagedTarget();
    if (!target) {
      clearEngagedTarget();
      return false;
    }

    const playerPosition = normalizePosition(bot.getPlayerPosition());
    const targetPosition = normalizePosition(target.getPosition?.() || target.__position);
    if (!playerPosition || !targetPosition || playerPosition.z !== targetPosition.z) {
      return false;
    }

    const giveUpDelayMs = Math.max(5000, (Number(config.tickMs) || 0) * 10);

    if (isAdjacentTile(playerPosition, targetPosition)) {
      state.lastChaseDestinationKey = null;
      clearCurrentFollowTarget();
      resetFollowProgress();
      return false;
    }

    const adjacentPosition = findReachableAdjacentPosition(targetPosition, playerPosition);
    if (!adjacentPosition) {
      if (!state.lastFollowStallAt) {
        state.lastFollowStallAt = now;
        return false;
      }

      if (now - state.lastFollowStallAt > giveUpDelayMs) {
        return skipTarget(target, "no reachable adjacent tile", now);
      }

      return false;
    }

    const currentDistance = getTileDistance(playerPosition, targetPosition);
    if (state.lastFollowTargetId !== target.id) {
      state.lastFollowTargetId = target.id;
      state.lastFollowDistance = currentDistance;
      state.lastFollowProgressAt = now;
      state.lastFollowStallAt = 0;
    } else if (currentDistance < state.lastFollowDistance) {
      state.lastFollowDistance = currentDistance;
      state.lastFollowProgressAt = now;
      state.lastFollowStallAt = 0;
    }

    const wasAlreadyFollowing = isSameCreature(getCurrentFollowTarget(), target);
    const followed = setCurrentFollowTarget(target);
    if (followed) {
      state.lastChaseAt = now;
      state.lastChaseDestinationKey = getPositionKey(adjacentPosition);
      if (!wasAlreadyFollowing) {
        bot.log("following auto attack target", {
          id: target.id,
          name: target.name || "Mob",
          followTargetId: target.id,
        });
      }
    }

    if (state.lastFollowDistance <= currentDistance) {
      if (!state.lastFollowStallAt) {
        state.lastFollowStallAt = now;
      } else if (now - state.lastFollowStallAt > giveUpDelayMs) {
        return skipTarget(target, "follow made no progress", now);
      }
    }

    return followed;
  }

  function findReachableKitePosition(targetPosition, playerPosition, currentDistance) {
    const minDistance = Math.max(1, Math.trunc(Number(config.kiteMinDistance) || 3));
    const maxDistance = Math.max(minDistance, Math.trunc(Number(config.kiteMaxDistance) || 5));
    // Build a buffer when the monster gets too close. Moving only from 1 to 2
    // lets an equally-fast monster remain adjacent forever; target the upper
    // edge instead, while still stopping anywhere inside the configured band.
    const desiredDistance = maxDistance;
    const retreatWaypoint = currentDistance < minDistance
      ? getKiteRetreatWaypoint(playerPosition)
      : null;
    const pathfinder = window.gameClient?.world?.pathfinder;
    const startTile = getTileFromPosition(playerPosition);
    if (!pathfinder || !startTile || typeof pathfinder.search !== "function") {
      return null;
    }

    const candidates = [];
    for (let xOffset = -desiredDistance; xOffset <= desiredDistance; xOffset += 1) {
      for (let yOffset = -desiredDistance; yOffset <= desiredDistance; yOffset += 1) {
        if (Math.max(Math.abs(xOffset), Math.abs(yOffset)) !== desiredDistance) {
          continue;
        }
        candidates.push({
          x: targetPosition.x + xOffset,
          y: targetPosition.y + yOffset,
          z: targetPosition.z,
        });
      }
    }

    candidates.sort((left, right) => {
      if (retreatWaypoint) {
        const leftProgress = getTileDistance(playerPosition, retreatWaypoint) - getTileDistance(left, retreatWaypoint);
        const rightProgress = getTileDistance(playerPosition, retreatWaypoint) - getTileDistance(right, retreatWaypoint);
        const leftMovesTowardRoute = leftProgress > 0;
        const rightMovesTowardRoute = rightProgress > 0;
        if (leftMovesTowardRoute !== rightMovesTowardRoute) {
          return leftMovesTowardRoute ? -1 : 1;
        }
      }
      const leftDistance = getTileDistance(playerPosition, left);
      const rightDistance = getTileDistance(playerPosition, right);
      // The nearest reachable point on the desired ring makes the smallest
      // possible correction (e.g. 3 -> 4, rather than 3 -> 7).
      return leftDistance - rightDistance;
    });

    for (const candidate of candidates) {
      const tile = getTileFromPosition(candidate);
      if (!tile?.isWalkable?.()) {
        continue;
      }

      try {
        const path = pathfinder.search(startTile, tile);
        if (Array.isArray(path) && path.length > 0) {
          return candidate;
        }
      } catch (error) {
        bot.log("auto attack kite reachability check failed", error?.message || error);
        return null;
      }
    }

    return null;
  }

  function syncKiteMovement(now = Date.now()) {
    if (getCombatMovement() !== "kite") {
      return false;
    }

    const target = getEngagedTarget();
    const playerPosition = normalizePosition(bot.getPlayerPosition());
    const targetPosition = normalizePosition(target?.getPosition?.() || target?.__position);
    if (!target || !playerPosition || !targetPosition || playerPosition.z !== targetPosition.z) {
      return false;
    }

    const currentDistance = getTileDistance(playerPosition, targetPosition);
    const minDistance = Math.max(1, Math.trunc(Number(config.kiteMinDistance) || 3));
    const maxDistance = Math.max(minDistance, Math.trunc(Number(config.kiteMaxDistance) || 5));
    // The configured endpoints are valid combat positions too. Moving again at
    // exactly min/max made the character bounce around the boundary.
    if (currentDistance >= minDistance && currentDistance <= maxDistance) {
      state.lastKiteDestinationKey = null;
      clearCurrentFollowTarget();
      return false;
    }

    if (now - state.lastKiteMoveAt < Math.max(100, Number(config.kiteMoveCooldownMs) || 350)) {
      return false;
    }

    const destination = findReachableKitePosition(targetPosition, playerPosition, currentDistance);
    if (!destination || typeof Position !== "function") {
      return false;
    }

    const destinationKey = getPositionKey(destination);
    // findPath starts a walk asynchronously. Do not restart it every tick when
    // the best tile has not changed; that made the player repeatedly run toward
    // the same SQM instead of completing the current walk.
    if (state.lastKiteDestinationKey === destinationKey) {
      return false;
    }

    try {
      clearCurrentFollowTarget();
      window.gameClient?.world?.pathfinder?.findPath?.(
        bot.getPlayerPosition(),
        new Position(destination.x, destination.y, destination.z)
      );
      state.lastKiteMoveAt = now;
      state.lastKiteDestinationKey = destinationKey;
      bot.log("repositioning auto attack target", {
        id: target.id,
        name: target.name || "Mob",
        distance: currentDistance,
        destination,
      });
      return true;
    } catch (error) {
      bot.log("auto attack kite movement failed", error?.message || error);
      return false;
    }
  }

  function syncLastTargetApproach(now = Date.now()) {
    const destination = state.lootReturnPosition;
    if (!destination) {
      return false;
    }

    const playerPosition = normalizePosition(bot.getPlayerPosition());
    if (!playerPosition || playerPosition.z !== destination.z || getTileDistance(playerPosition, destination) === 0) {
      state.lootReturnPosition = null;
      state.lootReturnStartedAt = 0;
      state.lootReturnDestinationKey = null;
      state.lastEngagedTargetPosition = null;
      return false;
    }

    if (now - state.lootReturnStartedAt > 5000 || typeof Position !== "function") {
      state.lootReturnPosition = null;
      state.lootReturnStartedAt = 0;
      state.lootReturnDestinationKey = null;
      return false;
    }

    const destinationKey = getPositionKey(destination);
    if (state.lootReturnDestinationKey === destinationKey) {
      return true;
    }

    try {
      window.gameClient?.world?.pathfinder?.findPath?.(
        bot.getPlayerPosition(),
        new Position(destination.x, destination.y, destination.z)
      );
      state.lootReturnDestinationKey = destinationKey;
      return true;
    } catch (error) {
      bot.log("last target approach failed", error?.message || error);
      state.lootReturnPosition = null;
      return false;
    }
  }

  function canAttack(now = Date.now()) {
    const slot = normalizeHotbarSlot(config.targetHotbarSlot);
    if (!slot) {
      return false;
    }

    if (now - state.lastTargetHotkeyAt < Math.max(0, Number(config.targetCooldownMs) || 0)) {
      return false;
    }

    if (getCombatMovement() !== "hold") {
      return getMonsterCandidates(now).length > 0 && !getCurrentTarget();
    }

    return getNearbyMonsters().length > 0;
  }

  function triggerAttack(now = Date.now()) {
    if (!canAttack(now)) {
      return false;
    }

    const engagedTarget = getEngagedTarget();
    const preferredTarget = engagedTarget && !isTargetSkipped(engagedTarget, now)
      ? engagedTarget
      : (getMonsterCandidates(now)[0] || null);
    if (preferredTarget && setCurrentTarget(preferredTarget)) {
      markCombatActive(now);
      bot.log("selected auto attack target", {
        id: preferredTarget.id,
        name: preferredTarget.name || "Mob",
        reason: isSameCreature(preferredTarget, engagedTarget) ? "engaged target" : "nearest candidate",
      });
      return true;
    }

    if (getCombatMovement() !== "hold") {
      return false;
    }

    return triggerTargetHotkey(now);
  }

  function triggerTargetHotkey(now = Date.now()) {
    const slot = normalizeHotbarSlot(config.targetHotbarSlot);
    if (!slot || now - state.lastTargetHotkeyAt < Math.max(0, Number(config.targetCooldownMs) || 0)) {
      return false;
    }

    const clicked = bot.clickHotbar(slot - 1);
    if (!clicked) {
      return false;
    }

    state.lastTargetHotkeyAt = now;
    markCombatActive(now);
    bot.log("used auto attack target hotkey", {
      slot,
      target: getCurrentTarget()?.name || null,
      nearbyMonsters: getNearbyMonsters().map((creature) => creature.name || "Mob"),
    });
    return true;
  }

  function canUseRune(now = Date.now()) {
    const slot = normalizeHotbarSlot(config.runeHotbarSlot);
    if (!slot || !getCurrentTarget()) {
      return false;
    }

    if (now - state.lastRuneHotkeyAt < Math.max(0, Number(config.runeCooldownMs) || 0)) {
      return false;
    }

    return true;
  }

  function triggerRune(now = Date.now()) {
    if (!canUseRune(now)) {
      return false;
    }

    const slot = normalizeHotbarSlot(config.runeHotbarSlot);
    const clicked = bot.clickHotbar(slot - 1);
    if (clicked) {
      state.lastRuneHotkeyAt = now;
      markCombatActive(now);
      bot.log("used auto attack rune hotkey", {
        slot,
        target: getCurrentTarget()?.name || "Mob",
      });
    }

    return clicked;
  }

  function tryAttack() {
    if (!config.enabled) {
      return false;
    }

    const now = Date.now();
    if (resetTargetIfTooFar()) {
      return true;
    }

    const switchedForPriority = syncPriorityTarget(now);
    syncLockedTarget();
    const approachingLastTarget = syncLastTargetApproach(now);
    syncCombatState(now);

    if (getCombatMovement() === "kite") {
      const repositioned = syncKiteMovement(now);
      if (getCurrentTarget()) {
      return triggerRune(now) || repositioned || switchedForPriority || approachingLastTarget;
      }

      return triggerAttack(now) || repositioned;
    }

    if (getCombatMovement() === "follow") {
      const chased = syncMeleeChase(now);
      if (getCurrentTarget()) {
        return triggerRune(now) || chased || switchedForPriority || approachingLastTarget;
      }

      if (chased) {
        return triggerAttack(now) || true;
      }
    }

    if (getCurrentTarget()) {
      return triggerRune(now) || switchedForPriority || approachingLastTarget;
    }

    return triggerAttack(now) || switchedForPriority || approachingLastTarget;
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
      tryAttack();
    } catch (error) {
      bot.log("auto attack tick failed", error?.message || error);
    } finally {
      scheduleNextTick();
    }
  }

  function start(overrides = {}) {
    Object.assign(config, overrides, { enabled: true });
    config.targetCooldownMs = Math.max(300, Number(config.targetCooldownMs) || 300);
    config.runeCooldownMs = Math.max(1000, Number(config.runeCooldownMs) || 1000);
    config.kiteMoveCooldownMs = Math.max(250, Number(config.kiteMoveCooldownMs) || 250);
    persistConfig();

    if (state.running) {
      bot.log("auto attack already running");
      return false;
    }

    state.running = true;
    bot.log("auto attack started", { ...config });
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

    clearEngagedTarget();
    state.lastChaseAt = 0;
    clearCurrentFollowTarget();
    state.skippedTargetIds.clear();

    bot.log("auto attack stopped");
    return true;
  }

  function status() {
    const combatActive = syncCombatState(Date.now());
    return {
      running: state.running,
      config: { ...config },
      lastTargetHotkeyAt: state.lastTargetHotkeyAt,
      lastRuneHotkeyAt: state.lastRuneHotkeyAt,
      engagedTargetId: state.engagedTargetId,
      combatActive,
      combatStartedAt: state.combatStartedAt || 0,
      combatDurationMs: state.combatStartedAt ? Math.max(0, Date.now() - state.combatStartedAt) : 0,
      targetCount: getCombatTargetCount(),
      lastChaseAt: state.lastChaseAt,
      currentTarget: getCurrentTarget()
        ? {
            id: getCurrentTarget().id,
            name: getCurrentTarget().name,
            type: getCurrentTarget().type,
            position: getCurrentTarget().__position || null,
          }
        : null,
      nearbyMonsters: getNearbyMonsters().map((creature) => ({
        id: creature.id,
        name: creature.name,
        type: creature.type,
        position: creature.__position || null,
      })),
    };
  }

  function updateConfig(nextConfig = {}) {
    if (Object.prototype.hasOwnProperty.call(nextConfig, "tickMs")) {
      nextConfig.tickMs = Math.max(100, Math.trunc(Number(nextConfig.tickMs) || config.tickMs));
    }

    if (Object.prototype.hasOwnProperty.call(nextConfig, "targetCooldownMs")) {
      nextConfig.targetCooldownMs = Math.max(300, Number(nextConfig.targetCooldownMs) || 300);
    }

    if (Object.prototype.hasOwnProperty.call(nextConfig, "runeCooldownMs")) {
      nextConfig.runeCooldownMs = Math.max(1000, Number(nextConfig.runeCooldownMs) || 1000);
    }

    if (Object.prototype.hasOwnProperty.call(nextConfig, "combatMovement")) {
      nextConfig.combatMovement = nextConfig.combatMovement === "kite" ? "kite" : "auto";
    }

    if (Object.prototype.hasOwnProperty.call(nextConfig, "kiteMinDistance")) {
      nextConfig.kiteMinDistance = Math.max(1, Math.trunc(Number(nextConfig.kiteMinDistance) || config.kiteMinDistance));
    }

    if (Object.prototype.hasOwnProperty.call(nextConfig, "kiteMaxDistance")) {
      nextConfig.kiteMaxDistance = Math.max(1, Math.trunc(Number(nextConfig.kiteMaxDistance) || config.kiteMaxDistance));
    }

    if (Object.prototype.hasOwnProperty.call(nextConfig, "kiteMoveCooldownMs")) {
      nextConfig.kiteMoveCooldownMs = Math.max(250, Number(nextConfig.kiteMoveCooldownMs) || 250);
    }

    if (Object.prototype.hasOwnProperty.call(nextConfig, "targetHotbarSlot")) {
      nextConfig.targetHotbarSlot = normalizeHotbarSlot(nextConfig.targetHotbarSlot) ?? config.targetHotbarSlot;
    }

    if (Object.prototype.hasOwnProperty.call(nextConfig, "runeHotbarSlot")) {
      nextConfig.runeHotbarSlot = normalizeHotbarSlot(nextConfig.runeHotbarSlot);
    }

    if (Object.prototype.hasOwnProperty.call(nextConfig, "maxTargetDistance")) {
      nextConfig.maxTargetDistance = Math.max(1, Math.trunc(Number(nextConfig.maxTargetDistance) || config.maxTargetDistance || 8));
    }

    if (Object.prototype.hasOwnProperty.call(nextConfig, "ignoredMonsterNames")) {
      nextConfig.ignoredMonsterNames = normalizeMonsterNames(nextConfig.ignoredMonsterNames);
    }

    if (Object.prototype.hasOwnProperty.call(nextConfig, "priorityMonsterNames")) {
      nextConfig.priorityMonsterNames = normalizeMonsterNames(nextConfig.priorityMonsterNames);
    }

    if (Object.prototype.hasOwnProperty.call(nextConfig, "ignoreSummons")) {
      nextConfig.ignoreSummons = nextConfig.ignoreSummons !== false;
    }

    if (Object.prototype.hasOwnProperty.call(nextConfig, "kiteRetreatToRoute")) {
      nextConfig.kiteRetreatToRoute = nextConfig.kiteRetreatToRoute !== false;
    }

    Object.assign(config, nextConfig);
    config.combatMovement = config.combatMovement === "kite" ? "kite" : "auto";
    config.kiteMinDistance = Math.max(1, Math.trunc(Number(config.kiteMinDistance) || 3));
    config.kiteMaxDistance = Math.max(config.kiteMinDistance, Math.trunc(Number(config.kiteMaxDistance) || 5));
    config.ignoredMonsterNames = normalizeMonsterNames(config.ignoredMonsterNames);
    config.priorityMonsterNames = normalizeMonsterNames(config.priorityMonsterNames);
    config.ignoreSummons = config.ignoreSummons !== false;
    config.kiteRetreatToRoute = config.kiteRetreatToRoute !== false;
    persistConfig();
    bot.log("auto attack config updated", { ...config });
    return { ...config };
  }

  if (config.enabled) {
    start();
  }

  bot.addCleanup(() => {
    stop({ persistEnabled: false });
  });

  bot.attack = {
    start,
    stop,
    status,
    updateConfig,
    tryAttack,
    canAttack,
    triggerAttack,
    triggerTargetHotkey,
    canUseRune,
    triggerRune,
    getNearbyMonsters,
    getCurrentTarget,
    getCurrentFollowTarget,
    syncLockedTarget,
    syncPriorityTarget,
    isCombatActive,
    syncMeleeChase,
    syncKiteMovement,
    syncLastTargetApproach,
    getCombatMovement,
    normalizeHotbarSlot,
    config,
  };
};
window.__mageTuntunBundle = window.__mageTuntunBundle || {};

window.__mageTuntunBundle.installCaveModule = function installCaveModule(bot) {
  const configStorageKey = "mageTuntun.cave.config";
  const routeStorageKey = "mageTuntun.cave.route";
  const transitionStorageKey = "mageTuntun.cave.transitions";
  const presetStorageKey = "mageTuntun.cave.presets";
  const defaultPresetName = "Default";
  const minimapOverlayRootId = "mage-tuntun-cave-minimap-overlay";
  const minimapOverlayStyleId = "mage-tuntun-cave-minimap-overlay-style";
  const ladderItemIds = new Set([1948, 1968]);
  const ropeNamePattern = /\brope\b/i;
  const shovelNamePattern = /\bshovel\b/i;
  const shovelTargetNamePatterns = [
    /\bstone pile\b/i,
    /\bloose stone pile\b/i,
    /\bgravel pile\b/i,
    /\bdirt pile\b/i,
  ];
  const defaultRareItemNames = [
    "Fire Sword",
    "Magic Sword",
    "Giant Sword",
    "Stonecutter Axe",
    "Thunder Hammer",
    "Dragon Scale Mail",
    "Golden Armor",
    "Demon Armor",
    "Crown Armor",
    "Knight Armor",
    "Royal Helmet",
    "Warrior Helmet",
    "Guardian Halberd",
    "Dragon Lance",
    "Dragon Shield",
    "Vampire Shield",
    "Crown Legs",
    "Demon Shield",
    "Tower Shield",
    "Mastermind Shield",
  ];
  const state = {
    running: false,
    timerId: null,
    observerTimerId: null,
    currentIndex: 0,
    direction: 1,
    lastPathAt: 0,
    lastPositionKey: null,
    lastProgressAt: 0,
    lastStairsUseAt: 0,
    lastObservedPosition: null,
    lastCavePosition: null,
    pendingTransitionSource: null,
    pausedForCombat: false,
    alertedRareItemKeys: new Set(),
  };
  const minimapOverlayState = {
    timerId: null,
  };

  const config = Object.assign(
    {
      tickMs: 500,
      repathMs: 1500,
      waypointTolerance: 0,
      stopOnUnexpectedRelocation: true,
      unexpectedRelocationDistance: 10,
      enabled: false,
      unexpectedMonsterAlertEnabled: true,
      rareItemNames: defaultRareItemNames,
      rareItemDetectByRarity: true,
      rareItemAlertEnabled: true,
      rareItemPauseCavebot: true,
      activePresetName: defaultPresetName,
    },
    bot.storage.get(configStorageKey, {})
  );
  config.tickMs = 500;
  config.rareItemNames = normalizeMonsterNames(config.rareItemNames);
  config.rareItemDetectByRarity = config.rareItemDetectByRarity !== false;
  config.rareItemAlertEnabled = config.rareItemAlertEnabled !== false;
  config.rareItemPauseCavebot = config.rareItemPauseCavebot !== false;

  function normalizePresetName(value) {
    const normalized = String(value || "").trim().replace(/\s+/g, " ");
    return normalized || null;
  }

  function normalizeMonsterNames(value) {
    const names = Array.isArray(value) ? value : String(value || "").split(",");
    const deduped = new Map();

    names.forEach((name) => {
      const displayName = String(name || "").trim().replace(/\s+/g, " ");
      if (displayName) {
        deduped.set(displayName.toLowerCase(), displayName);
      }
    });

    return Array.from(deduped.values());
  }

  function cloneValue(value) {
    return value ? JSON.parse(JSON.stringify(value)) : null;
  }

  function normalizePreset(value) {
    if (!value) {
      return null;
    }

    const name = normalizePresetName(value.name);
    if (!name) {
      return null;
    }

    return {
      name,
      route: normalizeRoute(value.route),
      transitions: normalizeTransitions(value.transitions),
      allowedMonsters: normalizeMonsterNames(value.allowedMonsters),
    };
  }

  function normalizePresets(value) {
    const entries = Array.isArray(value) ? value : [];
    const deduped = new Map();

    entries.map(normalizePreset).filter(Boolean).forEach((preset) => {
      deduped.set(preset.name.toLowerCase(), preset);
    });

    return Array.from(deduped.values());
  }

  let route = normalizeRoute(bot.storage.get(routeStorageKey, []));
  let transitions = normalizeTransitions(bot.storage.get(transitionStorageKey, []));
  let allowedMonsters = [];
  let presets = normalizePresets(bot.storage.get(presetStorageKey, []));

  if (!presets.length && (route.length || transitions.length)) {
    presets = [{
      name: defaultPresetName,
      route: route.map((waypoint) => cloneValue(waypoint)),
      transitions: transitions.map((transition) => cloneValue(transition)),
      allowedMonsters: [],
    }];
  }

  function getPresetNames() {
    return presets.map((preset) => preset.name);
  }

  function getPresetByName(name) {
    const normalizedName = normalizePresetName(name);
    if (!normalizedName) {
      return null;
    }

    return presets.find((preset) => preset.name.toLowerCase() === normalizedName.toLowerCase()) || null;
  }

  function getActivePresetName() {
    const configuredName = normalizePresetName(config.activePresetName);
    if (configuredName && getPresetByName(configuredName)) {
      return getPresetByName(configuredName).name;
    }

    if (presets.length) {
      return presets[0].name;
    }

    return configuredName || defaultPresetName;
  }

  function persistPresets() {
    bot.storage.set(
      presetStorageKey,
      presets.map((preset) => ({
        name: preset.name,
        route: preset.route.map((waypoint) => ({ ...waypoint })),
        transitions: preset.transitions.map((transition) => cloneValue(transition)),
        allowedMonsters: [...preset.allowedMonsters],
      }))
    );
  }

  function persistLegacyActivePreset() {
    bot.storage.set(routeStorageKey, route.map((waypoint) => ({ ...waypoint })));
    bot.storage.set(transitionStorageKey, transitions.map((transition) => cloneValue(transition)));
  }

  function setActivePresetName(name) {
    config.activePresetName = normalizePresetName(name) || defaultPresetName;
    persistConfig();
    return config.activePresetName;
  }

  function upsertPreset(name, nextRoute = route, nextTransitions = transitions, nextAllowedMonsters = allowedMonsters) {
    const normalizedName = normalizePresetName(name);
    if (!normalizedName) {
      return null;
    }

    const preset = {
      name: normalizedName,
      route: normalizeRoute(nextRoute).map((waypoint) => cloneValue(waypoint)),
      transitions: normalizeTransitions(nextTransitions).map((transition) => cloneValue(transition)),
      allowedMonsters: normalizeMonsterNames(nextAllowedMonsters),
    };
    const existingIndex = presets.findIndex((entry) => entry.name.toLowerCase() === normalizedName.toLowerCase());

    if (existingIndex >= 0) {
      presets[existingIndex] = preset;
    } else {
      presets.push(preset);
    }

    persistPresets();
    return preset;
  }

  function persistActivePreset() {
    upsertPreset(getActivePresetName(), route, transitions, allowedMonsters);
    persistLegacyActivePreset();
  }

  function loadPresetState(name) {
    const preset = getPresetByName(name);
    if (!preset) {
      return null;
    }

    route = normalizeRoute(preset.route);
    transitions = normalizeTransitions(preset.transitions);
    allowedMonsters = normalizeMonsterNames(preset.allowedMonsters);
    state.currentIndex = 0;
    state.direction = 1;
    state.pendingTransitionSource = null;
    setActivePresetName(preset.name);
    persistLegacyActivePreset();
    return preset;
  }

  const initialActivePreset = getActivePresetName();
  if (loadPresetState(initialActivePreset)) {
    config.activePresetName = initialActivePreset;
  } else {
    setActivePresetName(initialActivePreset);
  }

  function persistConfig() {
    bot.storage.set(configStorageKey, { ...config });
  }

  function persistRoute() {
    persistActivePreset();
  }

  function normalizePosition(value) {
    if (!value) {
      return null;
    }

    const x = Number(value.x);
    const y = Number(value.y);
    const z = Number(value.z);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      return null;
    }

    return {
      x: Math.trunc(x),
      y: Math.trunc(y),
      z: Math.trunc(z),
    };
  }

  function normalizeWaypoint(waypoint) {
    return normalizePosition(waypoint);
  }

  function normalizeRoute(value) {
    if (!Array.isArray(value)) {
      return [];
    }

    return value.map(normalizeWaypoint).filter(Boolean);
  }

  function normalizeTransition(transition) {
    if (!transition) {
      return null;
    }

    const from = normalizePosition(transition.from || transition);
    const to = normalizePosition(transition.to || {
      x: transition.targetX,
      y: transition.targetY,
      z: transition.targetZ,
    });

    if (!from || !to || from.z === to.z) {
      return null;
    }

    const count = Math.max(1, Math.trunc(Number(transition.count) || 1));
    const lastSeenAt = Math.max(0, Math.trunc(Number(transition.lastSeenAt) || Date.now()));

    return { from, to, count, lastSeenAt };
  }

  function normalizeTransitions(value) {
    if (!Array.isArray(value)) {
      return [];
    }

    const deduped = new Map();
    value.map(normalizeTransition).filter(Boolean).forEach((transition) => {
      deduped.set(getPositionKey(transition.from), transition);
    });
    return Array.from(deduped.values());
  }

  function getRoute() {
    return route.map((waypoint) => cloneValue(waypoint));
  }

  function getTransitions() {
    return transitions.map((transition) => cloneValue(transition));
  }

  function getAllowedMonsters() {
    return [...allowedMonsters];
  }

  function setAllowedMonsters(nextAllowedMonsters) {
    allowedMonsters = normalizeMonsterNames(nextAllowedMonsters);
    persistActivePreset();
    bot.log("cave allowed monsters updated", {
      preset: getActivePresetName(),
      allowedMonsters: [...allowedMonsters],
    });
    return getAllowedMonsters();
  }

  function persistTransitions() {
    persistActivePreset();
  }

  function savePreset(name, options = {}) {
    const preset = upsertPreset(name, route, transitions, allowedMonsters);
    if (!preset) {
      bot.log("cave preset name is required");
      return null;
    }

    if (options.activate !== false) {
      setActivePresetName(preset.name);
      persistLegacyActivePreset();
    }

    bot.log("cave preset saved", {
      name: preset.name,
      waypoints: preset.route.length,
      transitions: preset.transitions.length,
    });
    return {
      name: preset.name,
      route: preset.route.map((waypoint) => cloneValue(waypoint)),
      transitions: preset.transitions.map((transition) => cloneValue(transition)),
      allowedMonsters: [...preset.allowedMonsters],
    };
  }

  function createPreset(name) {
    const normalizedName = normalizePresetName(name);
    if (!normalizedName) {
      bot.log("cave preset name is required");
      return null;
    }

    if (getPresetByName(normalizedName)) {
      bot.log("cave preset already exists", { name: normalizedName });
      return null;
    }

    if (state.running) {
      stop();
    }

    const preset = upsertPreset(normalizedName, [], [], []);
    if (!preset) {
      return null;
    }

    loadPresetState(preset.name);
    bot.log("cave preset created", { name: preset.name });
    return {
      name: preset.name,
      route: [],
      transitions: [],
      allowedMonsters: [],
    };
  }

  function loadPreset(name) {
    const preset = getPresetByName(name);
    if (!preset) {
      bot.log("cave preset not found", { name });
      return null;
    }

    if (state.running) {
      stop();
    }

    loadPresetState(preset.name);
    bot.log("cave preset loaded", {
      name: preset.name,
      waypoints: route.length,
      transitions: transitions.length,
    });
    return {
      name: preset.name,
      route: getRoute(),
      transitions: getTransitions(),
      allowedMonsters: getAllowedMonsters(),
    };
  }

  function deletePreset(name) {
    const preset = getPresetByName(name);
    if (!preset) {
      bot.log("cave preset not found", { name });
      return false;
    }

    presets = presets.filter((entry) => entry.name.toLowerCase() !== preset.name.toLowerCase());
    persistPresets();

    if (preset.name.toLowerCase() === getActivePresetName().toLowerCase()) {
      const fallbackPreset = presets[0] || null;
      if (state.running) {
        stop();
      }

      if (fallbackPreset) {
        loadPresetState(fallbackPreset.name);
      } else {
        route = [];
        transitions = [];
        state.currentIndex = 0;
        state.direction = 1;
        state.pendingTransitionSource = null;
        setActivePresetName(defaultPresetName);
        persistLegacyActivePreset();
      }
    }

    bot.log("cave preset deleted", { name: preset.name });
    return true;
  }

  function getCurrentWaypoint() {
    if (!route.length) {
      return null;
    }

    if (state.currentIndex < 0 || state.currentIndex >= route.length) {
      state.currentIndex = 0;
    }

    return route[state.currentIndex] || null;
  }

  function getPositionKey(position) {
    return position ? `${position.x},${position.y},${position.z}` : null;
  }

  function getDistance(from, to) {
    if (!from || !to || Number(from.z) !== Number(to.z)) {
      return Number.POSITIVE_INFINITY;
    }

    return Math.abs(Number(from.x) - Number(to.x)) + Math.abs(Number(from.y) - Number(to.y));
  }

  function isBesideOrSameTile(from, to) {
    if (!from || !to || Number(from.z) !== Number(to.z)) {
      return false;
    }

    return Math.abs(Number(from.x) - Number(to.x)) <= 1 &&
      Math.abs(Number(from.y) - Number(to.y)) <= 1;
  }

  function isAdjacentTile(from, to) {
    if (!from || !to || Number(from.z) !== Number(to.z)) {
      return false;
    }

    const dx = Math.abs(Number(from.x) - Number(to.x));
    const dy = Math.abs(Number(from.y) - Number(to.y));
    return (dx !== 0 || dy !== 0) && dx <= 1 && dy <= 1;
  }

  function getDistanceToWaypoint(position, waypoint) {
    if (!position || !waypoint) {
      return null;
    }

    return getDistance(position, waypoint);
  }

  function isSameTile(a, b) {
    if (!a || !b) {
      return false;
    }

    return Number(a.x) === Number(b.x) &&
      Number(a.y) === Number(b.y) &&
      Number(a.z) === Number(b.z);
  }

  function findClosestWaypointIndex(position) {
    if (!position || !route.length) {
      return 0;
    }

    let bestIndex = 0;
    let bestDistance = Number.POSITIVE_INFINITY;

    route.forEach((waypoint, index) => {
      const distance = getDistanceToWaypoint(position, waypoint);
      if (!Number.isFinite(distance)) {
        return;
      }

      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    });

    return bestIndex;
  }

  function getTileAt(position) {
    if (!position) {
      return null;
    }

    return window.gameClient?.world?.getTileFromWorldPosition?.(
      new Position(position.x, position.y, position.z)
    ) || null;
  }

  function getTilePosition(tile) {
    return normalizePosition(tile?.__position);
  }

  function getThingDefinition(itemId) {
    if (!itemId) {
      return null;
    }

    return (
      window.gameClient?.itemDefinitionsByCid?.[itemId] ||
      window.gameClient?.itemDefinitionsBySid?.[itemId] ||
      window.gameClient?.itemDefinitions?.[itemId] ||
      null
    );
  }

  function getThingName(thing) {
    const definition = getThingDefinition(thing?.id);
    return String(definition?.properties?.name || thing?.name || "").trim().toLowerCase();
  }

  function getThingRarity(thing) {
    const definition = getThingDefinition(thing?.id);
    const rarity = Number(thing?.getDataObject?.()?.properties?.rarity ?? definition?.properties?.rarity);
    return Number.isFinite(rarity) ? rarity : 0;
  }

  function isLadderThing(thing) {
    if (!thing?.id) {
      return false;
    }

    if (ladderItemIds.has(Number(thing.id))) {
      return true;
    }

    return getThingName(thing).includes("ladder");
  }

  function isFloorChangeThing(thing) {
    const definition = getThingDefinition(thing?.id);
    return !!definition?.properties?.floorchange || isLadderThing(thing);
  }

  function isFloorChangeTile(tile) {
    const tilePosition = getTilePosition(tile);
    if (!tilePosition) {
      return false;
    }

    if (isFloorChangeThing(tile)) {
      return true;
    }

    return Array.isArray(tile.items) && tile.items.some((item) => isFloorChangeThing(item));
  }

  function getTileThings(tile) {
    if (!tile) {
      return [];
    }

    const things = [];
    if (tile.id) {
      things.push(tile);
    }
    if (Array.isArray(tile.items)) {
      tile.items.forEach((item) => {
        if (item) {
          things.push(item);
        }
      });
    }
    return things;
  }

  function tileHasNamedThing(tile, needle) {
    const value = String(needle || "").trim().toLowerCase();
    if (!value) {
      return false;
    }

    return getTileThings(tile).some((thing) => getThingName(thing).includes(value));
  }

  function isLadderTile(tile) {
    return getTileThings(tile).some((thing) => isLadderThing(thing));
  }

  function isStairsTile(tile) {
    return tileHasNamedThing(tile, "stairs");
  }

  function isHoleTile(tile) {
    return tileHasNamedThing(tile, "hole");
  }

  function isRopeSpotTile(tile) {
    return tileHasNamedThing(tile, "rope spot");
  }

  function isRopeTargetTile(tile) {
    return isHoleTile(tile) || isRopeSpotTile(tile);
  }

  function isShovelTargetThing(thing) {
    const name = getThingName(thing);
    if (!name) {
      return false;
    }

    return shovelTargetNamePatterns.some((pattern) => pattern.test(name));
  }

  function isShovelTargetTile(tile) {
    return getTileThings(tile).some((thing) => isShovelTargetThing(thing));
  }

  function isTransitionCandidateTile(tile, waypoint, position) {
    if (!tile) {
      return false;
    }

    if (isFloorChangeTile(tile)) {
      return true;
    }

    const hasWaypointDelta =
      waypoint &&
      position &&
      Number.isFinite(waypoint.z) &&
      Number.isFinite(position.z);

    if (!hasWaypointDelta) {
      return false;
    }

    if (waypoint.z > position.z) {
      return isShovelTargetTile(tile);
    }

    if (waypoint.z < position.z) {
      return isRopeTargetTile(tile);
    }

    return false;
  }

  function getFloorChangeTileBias(tile, position, waypoint) {
    if (!tile || !position || !waypoint || position.z === waypoint.z) {
      return 0;
    }

    const goingDown = waypoint.z > position.z;
    const goingUp = waypoint.z < position.z;

    if (goingDown) {
      if (isLadderTile(tile)) return -30;
      if (isHoleTile(tile)) return -20;
      if (isStairsTile(tile)) return 25;
    }

    if (goingUp) {
      if (isStairsTile(tile)) return -20;
      if (isHoleTile(tile)) return 20;
    }

    return 0;
  }

  function getLoadedTiles() {
    const chunks = window.gameClient?.world?.chunks || [];
    const tiles = [];

    for (const chunk of chunks) {
      if (!chunk?.tiles) continue;

      for (const tile of chunk.tiles) {
        if (tile?.__position) {
          tiles.push(tile);
        }
      }
    }

    return tiles;
  }

  function ensureMinimapOverlayStyle() {
    if (document.getElementById(minimapOverlayStyleId)) {
      return;
    }

    const style = document.createElement("style");
    style.id = minimapOverlayStyleId;
    style.textContent = `
      #${minimapOverlayRootId} {
        position: fixed;
        inset: 0;
        pointer-events: none;
        z-index: 999997;
      }

      #${minimapOverlayRootId} canvas {
        position: fixed;
        pointer-events: none;
      }
    `;
    document.head.appendChild(style);
  }

  function ensureMinimapOverlayRoot() {
    let root = document.getElementById(minimapOverlayRootId);
    if (root) {
      return root;
    }

    root = document.createElement("div");
    root.id = minimapOverlayRootId;
    root.innerHTML = '<canvas></canvas>';
    document.body.appendChild(root);
    return root;
  }

  function destroyMinimapOverlayElements() {
    document.getElementById(minimapOverlayRootId)?.remove();
    document.getElementById(minimapOverlayStyleId)?.remove();
  }

  function getMinimapCanvas() {
    return window.gameClient?.renderer?.minimap?.minimap?.canvas || document.getElementById("minimap") || null;
  }

  function getMinimapViewport() {
    const canvas = getMinimapCanvas();
    if (!(canvas instanceof HTMLCanvasElement)) {
      return null;
    }

    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return null;
    }

    return { canvas, rect };
  }

  function getWaypointCanvasPoint(waypoint, viewport, playerPosition, minimap) {
    if (!waypoint || !viewport || !playerPosition || !minimap) {
      return null;
    }

    if (waypoint.z !== minimap.__renderLayer) {
      return null;
    }

    const zoomScale = 1 << (Number(minimap.__zoomLevel) || 0);
    const center = minimap.center || { x: 0, y: 0 };
    const internalWidth = Number(viewport.canvas.width) || 160;
    const internalHeight = Number(viewport.canvas.height) || 160;
    const internalX = (internalWidth / 2) + (waypoint.x - playerPosition.x - Number(center.x || 0)) * zoomScale;
    const internalY = (internalHeight / 2) + (waypoint.y - playerPosition.y - Number(center.y || 0)) * zoomScale;

    return {
      x: internalX * (viewport.rect.width / internalWidth),
      y: internalY * (viewport.rect.height / internalHeight),
    };
  }

  function renderMinimapOverlay() {
    const viewport = getMinimapViewport();
    const minimap = window.gameClient?.renderer?.minimap;
    const playerPosition = normalizePosition(bot.getPlayerPosition());
    const root = ensureMinimapOverlayRoot();
    const canvas = root.querySelector("canvas");

    if (!(canvas instanceof HTMLCanvasElement)) {
      return;
    }

    if (!viewport || !minimap || !playerPosition || !route.length) {
      canvas.width = 0;
      canvas.height = 0;
      return;
    }

    const rect = viewport.rect;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    const pixelWidth = Math.round(width * dpr);
    const pixelHeight = Math.round(height * dpr);

    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }

    canvas.style.left = `${Math.round(rect.left)}px`;
    canvas.style.top = `${Math.round(rect.top)}px`;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }

    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, width, height);

    const visibleWaypoints = route
      .map((waypoint, index) => ({
        waypoint,
        index,
        point: getWaypointCanvasPoint(waypoint, viewport, playerPosition, minimap),
      }))
      .filter((entry) => entry.point);

    if (!visibleWaypoints.length) {
      return;
    }

    context.save();
    context.lineCap = "round";
    context.lineJoin = "round";

    for (let index = 1; index < visibleWaypoints.length; index += 1) {
      const previous = visibleWaypoints[index - 1];
      const current = visibleWaypoints[index];
      if (current.index !== previous.index + 1) {
        continue;
      }

      context.strokeStyle = "rgba(92, 228, 196, 0.7)";
      context.lineWidth = 2;
      context.beginPath();
      context.moveTo(previous.point.x, previous.point.y);
      context.lineTo(current.point.x, current.point.y);
      context.stroke();
    }

    visibleWaypoints.forEach(({ point, index }) => {
      const isCurrent = state.running && index === state.currentIndex;
      const radius = isCurrent ? 7 : 5;

      context.fillStyle = isCurrent ? "#ffcf5a" : "#2bd1c4";
      context.strokeStyle = isCurrent ? "#6a2400" : "#083f49";
      context.lineWidth = 2;
      context.beginPath();
      context.arc(point.x, point.y, radius, 0, Math.PI * 2);
      context.fill();
      context.stroke();

      context.fillStyle = "#ffffff";
      context.font = "bold 11px Verdana, sans-serif";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(String(index + 1), point.x, point.y);
    });

    context.restore();
  }

  function startMinimapOverlay() {
    if (minimapOverlayState.timerId != null) {
      return;
    }

    ensureMinimapOverlayStyle();
    renderMinimapOverlay();
    minimapOverlayState.timerId = window.setInterval(renderMinimapOverlay, 250);
  }

  function stopMinimapOverlay() {
    if (minimapOverlayState.timerId != null) {
      window.clearInterval(minimapOverlayState.timerId);
      minimapOverlayState.timerId = null;
    }

    destroyMinimapOverlayElements();
  }

  function getNearbyTransitionTiles(position, waypoint, radius = 8) {
    if (!position) {
      return [];
    }

    return getLoadedTiles()
      .map((tile) => ({ tile, position: getTilePosition(tile) }))
      .filter((entry) =>
        entry.position &&
        entry.position.z === position.z &&
        Math.abs(entry.position.x - position.x) <= radius &&
        Math.abs(entry.position.y - position.y) <= radius &&
        isTransitionCandidateTile(entry.tile, waypoint, position)
      );
  }

  function findTransitionTileNearPosition(position, waypoint, radius = 1) {
    if (!position) {
      return null;
    }

    let best = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    getNearbyTransitionTiles(position, waypoint, radius).forEach((entry) => {
      const distance = getDistance(position, entry.position);
      if (!Number.isFinite(distance)) {
        return;
      }

      if (distance < bestDistance) {
        bestDistance = distance;
        best = entry;
      }
    });

    return best;
  }

  function findBestKnownTransition(position, waypoint) {
    if (!position || !waypoint) {
      return null;
    }

    let best = null;
    let bestScore = Number.POSITIVE_INFINITY;

    transitions.forEach((transition) => {
      if (transition.from.z !== position.z || transition.to.z !== waypoint.z) {
        return;
      }

      const playerDistance = getDistance(position, transition.from);
      const landingDistance = getDistance(transition.to, waypoint);
      if (!Number.isFinite(playerDistance) || !Number.isFinite(landingDistance)) {
        return;
      }

      const score = playerDistance * 10 + landingDistance;
      if (score < bestScore) {
        bestScore = score;
        best = transition;
      }
    });

    return best;
  }

  function findNearbyTransitionTile(position, waypoint) {
    if (!position || !waypoint) {
      return null;
    }

    const waypointDistance = Math.abs(position.x - waypoint.x) + Math.abs(position.y - waypoint.y);
    const radius = Math.max(4, Math.min(20, waypointDistance + 2));
    let best = null;
    let bestScore = Number.POSITIVE_INFINITY;

    getNearbyTransitionTiles(position, waypoint, radius).forEach((entry) => {
      const playerDistance = getDistance(position, entry.position);
      const tileToWaypointDistance =
        Math.abs(entry.position.x - waypoint.x) + Math.abs(entry.position.y - waypoint.y);
      const score =
        playerDistance * 10 +
        tileToWaypointDistance +
        getFloorChangeTileBias(entry.tile, position, waypoint);

      if (score < bestScore) {
        bestScore = score;
        best = {
          tile: entry.tile,
          position: entry.position,
          playerDistance,
          waypointDistance: tileToWaypointDistance,
        };
      }
    });

    return best;
  }

  function isAtWaypoint(position, waypoint) {
    const distance = getDistanceToWaypoint(position, waypoint);
    if (!Number.isFinite(distance)) {
      return false;
    }

    return distance <= Math.max(0, Number(config.waypointTolerance) || 0);
  }

  function goToWaypoint(waypoint) {
    const from = bot.getPlayerPosition();
    if (!from || !waypoint) {
      return false;
    }

    const to = new Position(waypoint.x, waypoint.y, waypoint.z);

    try {
      window.gameClient?.world?.pathfinder?.findPath?.(from, to);
      state.lastPathAt = Date.now();
      bot.log("cave pathing to waypoint", {
        ...waypoint,
        index: state.currentIndex + 1,
        total: route.length,
      });
      return true;
    } catch (error) {
      bot.log("cave pathing failed", { ...waypoint, error: error?.message || error });
      return false;
    }
  }

  function goToPosition(position) {
    if (!position) {
      return false;
    }

    return goToWaypoint(position);
  }

  function markPendingTransitionSource(source) {
    const normalized = normalizePosition(source);
    if (!normalized) {
      return;
    }

    state.pendingTransitionSource = {
      ...normalized,
      at: Date.now(),
    };
  }

  function upsertTransition(from, to) {
    const normalizedFrom = normalizePosition(from);
    const normalizedTo = normalizePosition(to);
    if (!normalizedFrom || !normalizedTo || normalizedFrom.z === normalizedTo.z) {
      return null;
    }

    const key = getPositionKey(normalizedFrom);
    const index = transitions.findIndex((transition) => getPositionKey(transition.from) === key);
    const next = {
      from: normalizedFrom,
      to: normalizedTo,
      count: index >= 0 ? transitions[index].count + 1 : 1,
      lastSeenAt: Date.now(),
    };

    if (index >= 0) {
      transitions[index] = next;
    } else {
      transitions.push(next);
    }

    persistTransitions();
    bot.log("cave learned floor transition", next);
    return cloneValue(next);
  }

  function resolveObservedTransitionSource(previousPosition) {
    const pending = normalizePosition(state.pendingTransitionSource);
    if (pending && pending.z === previousPosition.z) {
      return pending;
    }

    const currentTile = getTileAt(previousPosition);
    if (currentTile && isFloorChangeTile(currentTile)) {
      return previousPosition;
    }

    const nearby = findTransitionTileNearPosition(previousPosition, null, 1);
    if (nearby?.position) {
      return nearby.position;
    }

    return null;
  }

  function getUnexpectedRelocationReason(previous, current) {
    if (!config.stopOnUnexpectedRelocation || !previous || !current) {
      return null;
    }

    const expectedFloorChange =
      !!state.pendingTransitionSource && Date.now() - state.lastStairsUseAt <= 4000;
    const distance = Math.abs(previous.x - current.x) + Math.abs(previous.y - current.y);
    if (previous.z !== current.z && !expectedFloorChange) {
      return "Unexpected floor change";
    }
    if (distance > Math.max(3, Number(config.unexpectedRelocationDistance) || 10) && !expectedFloorChange) {
      return "Unexpected relocation";
    }
    return null;
  }

  function stopForUnsafeState(position) {
    const playerState = bot.getPlayerState?.();
    const health = Number(playerState?.health);
    const maxHealth = Number(playerState?.maxHealth);
    if (Number.isFinite(health) && Number.isFinite(maxHealth) && maxHealth > 0 && health <= 0) {
      stop({ reason: "Character died" });
      bot.log("cave stopped: character death detected");
      bot.ui?.refreshCaveStatus?.();
      return true;
    }

    const reason = getUnexpectedRelocationReason(state.lastCavePosition, position);
    if (reason) {
      stop({ reason });
      bot.log("cave stopped: unsafe relocation detected", {
        reason,
        from: state.lastCavePosition,
        to: position,
      });
      bot.ui?.refreshCaveStatus?.();
      return true;
    }

    state.lastCavePosition = position;
    return false;
  }

  function observePosition() {
    const current = normalizePosition(bot.getPlayerPosition());
    if (!current) {
      return;
    }

    const previous = state.lastObservedPosition;
    const relocationReason = state.running && getUnexpectedRelocationReason(previous, current);
    if (relocationReason) {
      state.lastObservedPosition = current;
      stop({ reason: relocationReason });
      bot.log("cave stopped by position observer", { reason: relocationReason, from: previous, to: current });
      bot.ui?.refreshCaveStatus?.();
      return;
    }
    if (previous && !isSameTile(previous, current) && previous.z !== current.z) {
      const source = resolveObservedTransitionSource(previous);
      if (source) {
        upsertTransition(source, current);
      }
      state.pendingTransitionSource = null;
    }

    state.lastObservedPosition = current;
  }

  function getEquipment() {
    return window.gameClient?.player?.equipment || null;
  }

  function getOpenContainers() {
    return Array.from(window.gameClient?.player?.__openedContainers || []);
  }

  function findAdjacentWalkablePosition(targetPosition, playerPosition) {
    if (!targetPosition || !playerPosition) {
      return null;
    }

    const offsets = [
      { x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 },
      { x: -1, y: -1 }, { x: 1, y: -1 }, { x: -1, y: 1 }, { x: 1, y: 1 },
    ];

    offsets.sort((a, b) => {
      const da = Math.abs(targetPosition.x + a.x - playerPosition.x) +
        Math.abs(targetPosition.y + a.y - playerPosition.y);
      const db = Math.abs(targetPosition.x + b.x - playerPosition.x) +
        Math.abs(targetPosition.y + b.y - playerPosition.y);
      return da - db;
    });

    for (const offset of offsets) {
      const position = new Position(
        targetPosition.x + offset.x,
        targetPosition.y + offset.y,
        targetPosition.z
      );
      const tile = window.gameClient?.world?.getTileFromWorldPosition?.(position);
      if (tile?.isWalkable?.()) {
        return normalizePosition(position);
      }
    }

    return null;
  }

  function isRopeItem(item) {
    const name = getThingName(item);
    return !!name && ropeNamePattern.test(name);
  }

  function isShovelItem(item) {
    const name = getThingName(item);
    return !!name && shovelNamePattern.test(name);
  }

  function findToolSource(predicate) {
    const equipment = getEquipment();

    if (equipment?.slots) {
      for (let slotIndex = 0; slotIndex < equipment.slots.length; slotIndex += 1) {
        const item = equipment.getSlotItem?.(slotIndex);
        if (predicate(item)) {
          return { which: equipment, index: slotIndex, item, location: "equipment" };
        }
      }
    }

    for (const container of getOpenContainers()) {
      const slots = container?.slots || [];
      for (let slotIndex = 0; slotIndex < slots.length; slotIndex += 1) {
        const item = container.getSlotItem?.(slotIndex);
        if (predicate(item)) {
          return { which: container, index: slotIndex, item, location: "container" };
        }
      }
    }

    return null;
  }

  function findRopeSource() {
    return findToolSource(isRopeItem);
  }

  function findShovelSource() {
    return findToolSource(isShovelItem);
  }

  function useToolOnTile(tool, targetTile, targetPosition, actionLabel, now = Date.now()) {
    if (!tool || !targetTile || !targetPosition) {
      return false;
    }

    const playerPosition = normalizePosition(bot.getPlayerPosition());
    if (!playerPosition) {
      return false;
    }

    if (!isAdjacentTile(playerPosition, targetPosition)) {
      const adjacentPosition = findAdjacentWalkablePosition(targetPosition, playerPosition);
      if (adjacentPosition) {
        return goToPosition(adjacentPosition);
      }
    }

    window.gameClient?.mouse?.__handleItemUseWith?.(
      { which: tool.which, index: tool.index },
      { which: targetTile, index: 0xFF }
    );
    state.lastStairsUseAt = now;
    state.lastPathAt = now;
    markPendingTransitionSource(targetPosition);
    bot.log(actionLabel, {
      source: targetPosition,
      toolLocation: tool.location,
      toolSlot: tool.index,
      toolName: getThingName(tool.item),
    });
    return true;
  }

  function useRopeOnTile(targetTile, targetPosition, now = Date.now()) {
    return useToolOnTile(
      findRopeSource(),
      targetTile,
      targetPosition,
      "cave roped transition tile",
      now
    );
  }

  function useShovelOnTile(targetTile, targetPosition, now = Date.now()) {
    return useToolOnTile(
      findShovelSource(),
      targetTile,
      targetPosition,
      "cave shoveled transition tile",
      now
    );
  }

  function useFloorChangeTile(target, waypoint, now = Date.now()) {
    const position = normalizePosition(bot.getPlayerPosition());
    const targetPosition = normalizePosition(target?.position);
    const targetTile = target?.tile || (targetPosition ? getTileAt(targetPosition) : null);
    if (!position || !targetPosition || !targetTile) {
      return false;
    }

    if (now - state.lastStairsUseAt < 1200) {
      return true;
    }

    if (waypoint?.z < position.z && isRopeTargetTile(targetTile)) {
      return useRopeOnTile(targetTile, targetPosition, now);
    }

    if (!isFloorChangeTile(targetTile)) {
      if (waypoint?.z > position.z && isShovelTargetTile(targetTile)) {
        return useShovelOnTile(targetTile, targetPosition, now);
      }
      return false;
    }

    if (isLadderTile(targetTile)) {
      window.gameClient?.mouse?.use?.({ which: targetTile, index: 0xFF });
      state.lastStairsUseAt = now;
      state.lastPathAt = now;
      markPendingTransitionSource(targetPosition);
      bot.log("cave used ladder tile", {
        source: targetPosition,
        targetZ: waypoint?.z ?? null,
      });
      return true;
    }

    if (!isSameTile(position, targetPosition)) {
      return goToPosition(targetPosition);
    }

    const currentTile = getTileAt(position);
    if (!currentTile || !isFloorChangeTile(currentTile)) {
      return false;
    }

    window.gameClient?.mouse?.use?.({ which: currentTile, index: 0xFF });
    state.lastStairsUseAt = now;
    state.lastPathAt = now;
    markPendingTransitionSource(position);
    bot.log("cave used floor-change tile", {
      source: position,
      targetZ: waypoint?.z ?? null,
    });
    return true;
  }

  function handleFloorChange(waypoint, now = Date.now()) {
    const position = normalizePosition(bot.getPlayerPosition());
    if (!position || !waypoint || position.z === waypoint.z) {
      return false;
    }

    const visibleCandidate = findNearbyTransitionTile(position, waypoint);
    if (visibleCandidate) {
      const moved = useFloorChangeTile(visibleCandidate, waypoint, now);
      if (moved) {
        bot.log("cave probing visible floor-change tile", {
          tileX: visibleCandidate.position.x,
          tileY: visibleCandidate.position.y,
          tileZ: visibleCandidate.position.z,
          targetZ: waypoint.z,
        });
        return true;
      }
    }

    const knownTransition = findBestKnownTransition(position, waypoint);
    if (knownTransition) {
      const target = {
        tile: getTileAt(knownTransition.from),
        position: knownTransition.from,
      };
      const moved = useFloorChangeTile(target, waypoint, now);
      if (moved) {
        bot.log("cave using learned floor transition", {
          from: knownTransition.from,
          to: knownTransition.to,
          waypoint,
        });
        return true;
      }

      bot.log("cave learned transition unavailable, falling back to live scan", {
        from: knownTransition.from,
        to: knownTransition.to,
        waypoint,
      });
    }
    return false;
  }

  function advanceWaypoint() {
    if (!route.length) {
      return null;
    }

    if (route.length === 1) {
      return route[0];
    }

    let nextIndex = state.currentIndex + state.direction;

    if (nextIndex >= route.length) {
      state.direction = -1;
      nextIndex = route.length - 2;
    } else if (nextIndex < 0) {
      state.direction = 1;
      nextIndex = 1;
    }

    state.currentIndex = Math.max(0, Math.min(route.length - 1, nextIndex));

    const nextWaypoint = getCurrentWaypoint();
    bot.log("cave advanced waypoint", {
      index: state.currentIndex + 1,
      total: route.length,
      direction: state.direction,
      waypoint: nextWaypoint,
    });
    return nextWaypoint;
  }

  function scheduleNextTick() {
    if (!state.running) return;

    state.timerId = window.setTimeout(() => {
      tick();
    }, config.tickMs);
  }

  function getUnexpectedVisibleMonsters() {
    if (!config.unexpectedMonsterAlertEnabled || !allowedMonsters.length) {
      return [];
    }

    const allowedNames = new Set(allowedMonsters.map((name) => name.toLowerCase()));
    return (bot.xray?.getVisibleMonsters?.({ sameFloorOnly: true }) || []).filter(
      (monster) => !allowedNames.has(String(monster?.name || "").trim().toLowerCase())
    );
  }

  function getVisibleRareItems(position) {
    if (!config.rareItemNames.length || !position) {
      return [];
    }

    const rareNames = new Set(config.rareItemNames.map((name) => name.toLowerCase()));
    return getLoadedTiles().flatMap((tile) => {
      const tilePosition = getTilePosition(tile);
      if (!tilePosition || tilePosition.z !== position.z ||
        Math.abs(tilePosition.x - position.x) > 8 || Math.abs(tilePosition.y - position.y) > 6) {
        return [];
      }

      return getTileThings(tile)
        .map((thing) => ({
          name: getThingName(thing),
          rarity: getThingRarity(thing),
          position: tilePosition,
        }))
        .filter((item) => rareNames.has(item.name) || (config.rareItemDetectByRarity && item.rarity >= 2));
    });
  }

  function stopForRareItems(items) {
    if (!items.length) {
      return false;
    }

    const newItems = items.filter((item) => {
      const key = `${item.name}@${item.position.x},${item.position.y},${item.position.z}`;
      if (state.alertedRareItemKeys.has(key)) {
        return false;
      }
      state.alertedRareItemKeys.add(key);
      return true;
    });
    if (!newItems.length) {
      return false;
    }

    const names = Array.from(new Set(newItems.map((item) => item.name)));
    if (config.rareItemAlertEnabled) {
      bot.playAlarm?.();
    }
    bot.log("rare item detected", { items: newItems });

    if (!config.rareItemPauseCavebot) {
      return true;
    }

    const reason = `Rare item detected: ${names.join(", ")}`;
    bot.setStopReason?.(reason, { items: newItems });
    stop({ reason });
    bot.ui?.refreshCaveStatus?.();
    return true;
  }

  function stopForUnexpectedMonsters(monsters) {
    if (!monsters.length) {
      return false;
    }

    const names = Array.from(new Set(monsters.map((monster) => monster.name).filter(Boolean)));
    bot.playAlarm?.();
    bot.setStopReason?.("Unexpected monster", { monsters: names, preset: getActivePresetName() });
    bot.log("unexpected monster detected: cave and attack stopped", {
      preset: getActivePresetName(),
      monsters: names,
      allowedMonsters: [...allowedMonsters],
    });
    bot.attack?.stop?.();
    stop({ reason: `Unexpected monster: ${names.join(", ") || "unknown"}` });
    bot.ui?.refreshAutoAttackStatus?.();
    bot.ui?.refreshCaveStatus?.();
    return true;
  }

  function tick() {
    if (!state.running) return;

    try {
      if (!route.length) {
        stop();
        return;
      }

      const position = normalizePosition(bot.getPlayerPosition());
      if (stopForUnsafeState(position)) {
        return;
      }
      observePosition();

      if (stopForRareItems(getVisibleRareItems(position))) {
        return;
      }

      if (stopForUnexpectedMonsters(getUnexpectedVisibleMonsters())) {
        return;
      }

      const positionKey = getPositionKey(position);
      const now = Date.now();
      const attackStatus = bot.attack?.status?.() || null;
      const shouldPauseForCombat = !!attackStatus?.combatActive;

      if (shouldPauseForCombat) {
        if (!state.pausedForCombat) {
          state.pausedForCombat = true;
          bot.log("cave paused for auto attack", {
            combatDurationMs: Number(attackStatus?.combatDurationMs || 0),
            targetCount: Number(attackStatus?.targetCount || 0),
          });
        }
        return;
      }

      if (state.pausedForCombat) {
        state.pausedForCombat = false;
        bot.log("cave resumed after auto attack", {
          combatDurationMs: Number(attackStatus?.combatDurationMs || 0),
          targetCount: Number(attackStatus?.targetCount || 0),
        });
      }

      if (positionKey && positionKey !== state.lastPositionKey) {
        state.lastPositionKey = positionKey;
        state.lastProgressAt = now;
      }

      let waypoint = getCurrentWaypoint();
      if (!waypoint) {
        stop();
        return;
      }

      if (isAtWaypoint(position, waypoint)) {
        waypoint = advanceWaypoint();
      }

      if (!waypoint) {
        return;
      }

      if (position && waypoint.z !== position.z) {
        handleFloorChange(waypoint, now);
        return;
      }

      const shouldRepath =
        now - state.lastPathAt >= config.repathMs ||
        !state.lastProgressAt ||
        now - state.lastProgressAt >= config.repathMs;

      if (shouldRepath) {
        goToWaypoint(waypoint);
      }
    } catch (error) {
      bot.log("cave tick failed", error?.message || error);
    } finally {
      scheduleNextTick();
    }
  }

  function startObserver() {
    if (state.observerTimerId != null) {
      return;
    }

    state.observerTimerId = window.setInterval(() => {
      try {
        observePosition();
      } catch (error) {
        bot.log("cave observer failed", error?.message || error);
      }
    }, 200);
  }

  function stopObserver() {
    if (state.observerTimerId == null) {
      return;
    }

    window.clearInterval(state.observerTimerId);
    state.observerTimerId = null;
  }

  function start(overrides = {}) {
    Object.assign(config, overrides, { enabled: true });
    config.tickMs = 500;
    persistConfig();

    if (!route.length) {
      bot.log("cave bot cannot start without waypoints");
      return false;
    }

    if (state.running) {
      bot.log("cave bot already running");
      return false;
    }

    const position = normalizePosition(bot.getPlayerPosition());
    state.running = true;
    bot.clearStopReason?.();
    state.currentIndex = findClosestWaypointIndex(position);
    state.direction = state.currentIndex >= route.length - 1 ? -1 : 1;
    if (route.length <= 1) {
      state.direction = 1;
    }
    state.lastPathAt = 0;
    state.lastPositionKey = getPositionKey(position);
    state.lastObservedPosition = position;
    state.lastCavePosition = position;
    state.lastProgressAt = Date.now();
    state.pausedForCombat = false;
    state.alertedRareItemKeys.clear();
    bot.log("cave bot started", {
      waypoints: route.length,
      currentIndex: state.currentIndex + 1,
      direction: state.direction,
      waypoint: getCurrentWaypoint(),
    });
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
    state.pausedForCombat = false;
    bot.setStopReason?.(options.reason || "Cavebot stopped");
    bot.log("cave bot stopped");
    return true;
  }

  function addWaypoint(waypoint) {
    const normalized = normalizeWaypoint(waypoint);
    if (!normalized) {
      return null;
    }

    route.push(normalized);
    persistRoute();
    bot.log("cave waypoint added", { ...normalized, total: route.length });
    return cloneValue(normalized);
  }

  function addWaypointCurrentSpot() {
    const position = normalizePosition(bot.getPlayerPosition());
    if (!position) {
      bot.log("could not read current position for cave waypoint");
      return null;
    }

    return addWaypoint(position);
  }

  function clearWaypoints() {
    route = [];
    state.currentIndex = 0;
    state.direction = 1;
    persistRoute();
    bot.log("cave route cleared");

    if (state.running) {
      stop();
    }

    return [];
  }

  function clearTransitions() {
    transitions = [];
    state.pendingTransitionSource = null;
    persistTransitions();
    bot.log("cave learned transitions cleared");
    return [];
  }

  function removeLastWaypoint() {
    if (!route.length) {
      return null;
    }

    const removed = route.pop();
    if (state.currentIndex >= route.length) {
      state.currentIndex = Math.max(0, route.length - 1);
    }
    if (route.length <= 1) {
      state.direction = 1;
    }
    persistRoute();
    bot.log("cave waypoint removed", removed);

    if (!route.length && state.running) {
      stop();
    }

    return removed;
  }

  function removeWaypoint(index) {
    const normalizedIndex = Math.trunc(Number(index));
    if (!Number.isInteger(normalizedIndex) || normalizedIndex < 0 || normalizedIndex >= route.length) {
      return null;
    }

    const [removed] = route.splice(normalizedIndex, 1);
    if (normalizedIndex < state.currentIndex) {
      state.currentIndex -= 1;
    }
    if (state.currentIndex >= route.length) {
      state.currentIndex = Math.max(0, route.length - 1);
    }
    if (route.length <= 1) {
      state.direction = 1;
    }
    persistRoute();
    bot.log("cave waypoint removed", { ...removed, index: normalizedIndex + 1, total: route.length });

    if (!route.length && state.running) {
      stop();
    }

    return cloneValue(removed);
  }

  function setCurrentIndex(index) {
    if (!route.length) {
      state.currentIndex = 0;
      state.direction = 1;
      return 0;
    }

    const nextIndex = Math.max(0, Math.min(route.length - 1, Math.trunc(Number(index) || 0)));
    state.currentIndex = nextIndex;
    state.direction = nextIndex >= route.length - 1 ? -1 : 1;
    if (route.length <= 1) {
      state.direction = 1;
    }
    return state.currentIndex;
  }

  function status() {
    const position = normalizePosition(bot.getPlayerPosition());
    const waypoint = getCurrentWaypoint();

    return {
      running: state.running,
      config: { ...config },
      route: getRoute(),
      transitions: getTransitions(),
      allowedMonsters: getAllowedMonsters(),
      presetNames: getPresetNames(),
      activePresetName: getActivePresetName(),
      currentIndex: state.currentIndex,
      direction: state.direction,
      currentWaypoint: cloneValue(waypoint),
      distanceToWaypoint: getDistanceToWaypoint(position, waypoint),
      lastPathAt: state.lastPathAt,
      lastProgressAt: state.lastProgressAt,
      pendingTransitionSource: cloneValue(state.pendingTransitionSource),
      pausedForCombat: state.pausedForCombat,
    };
  }

  function updateConfig(nextConfig = {}) {
    if (Object.prototype.hasOwnProperty.call(nextConfig, "rareItemNames")) {
      nextConfig.rareItemNames = normalizeMonsterNames(nextConfig.rareItemNames);
    }
    if (Object.prototype.hasOwnProperty.call(nextConfig, "rareItemAlertEnabled")) {
      nextConfig.rareItemAlertEnabled = nextConfig.rareItemAlertEnabled !== false;
    }
    if (Object.prototype.hasOwnProperty.call(nextConfig, "rareItemDetectByRarity")) {
      nextConfig.rareItemDetectByRarity = nextConfig.rareItemDetectByRarity !== false;
    }
    if (Object.prototype.hasOwnProperty.call(nextConfig, "rareItemPauseCavebot")) {
      nextConfig.rareItemPauseCavebot = nextConfig.rareItemPauseCavebot !== false;
    }
    Object.assign(config, nextConfig);
    config.tickMs = 500;
    config.rareItemNames = normalizeMonsterNames(config.rareItemNames);
    config.rareItemDetectByRarity = config.rareItemDetectByRarity !== false;
    config.rareItemAlertEnabled = config.rareItemAlertEnabled !== false;
    config.rareItemPauseCavebot = config.rareItemPauseCavebot !== false;
    persistConfig();
    bot.log("cave config updated", { ...config });
    return { ...config };
  }

  startObserver();
  bot.addCleanup(stopObserver);
  startMinimapOverlay();
  bot.addCleanup(stopMinimapOverlay);

  if (config.enabled && route.length) {
    start();
  }

  bot.cave = {
    start,
    stop,
    status,
    updateConfig,
    config,
    getRoute,
    getTransitions,
    getAllowedMonsters,
    setAllowedMonsters,
    getPresetNames,
    getActivePresetName,
    getCurrentWaypoint,
    getVisibleRareItems,
    createPreset,
    savePreset,
    loadPreset,
    deletePreset,
    addWaypoint,
    addWaypointCurrentSpot,
    clearWaypoints,
    clearTransitions,
    removeLastWaypoint,
    removeWaypoint,
    setCurrentIndex,
    goToWaypoint,
    goToPosition,
    handleFloorChange,
    findClosestWaypointIndex,
    findRopeSource,
    findShovelSource,
    inspectNearbyTiles: (radius = 1) => {
      const position = normalizePosition(bot.getPlayerPosition());
      if (!position) {
        return [];
      }

      return getLoadedTiles()
        .map((tile) => ({ tile, position: getTilePosition(tile) }))
        .filter((entry) =>
          entry.position &&
          entry.position.z === position.z &&
          Math.abs(entry.position.x - position.x) <= radius &&
          Math.abs(entry.position.y - position.y) <= radius
        )
        .map((entry) => ({
          position: entry.position,
          isFloorChange: isFloorChangeTile(entry.tile),
          isHole: isHoleTile(entry.tile),
          isRopeTarget: isRopeTargetTile(entry.tile),
          isShovelTarget: isShovelTargetTile(entry.tile),
          names: getTileThings(entry.tile).map((thing) => getThingName(thing)).filter(Boolean),
        }));
    },
    isAtWaypoint,
  };
};
window.__mageTuntunBundle = window.__mageTuntunBundle || {};

window.__mageTuntunBundle.installEquipRingModule = function installEquipRingModule(bot) {
  const configStorageKey = "mageTuntun.equipRing.config";
  const RING_SLOT = 8;
  const state = {
    running: false,
    timerId: null,
    lastEquipAt: 0,
  };
  let resumeListenersAttached = false;

  const config = Object.assign(
    {
      tickMs: 1000,
      equipCooldownMs: 1500,
      enabled: false,
    },
    bot.storage.get(configStorageKey, {})
  );
  config.tickMs = 1000;

  function persistConfig() {
    bot.storage.set(configStorageKey, { ...config });
  }

  function getEquipment() {
    return window.gameClient?.player?.equipment || null;
  }

  function getOpenContainers() {
    return Array.from(window.gameClient?.player?.__openedContainers || []);
  }

  function getItemDefinition(item) {
    if (!item) return null;

    return (
      window.gameClient?.itemDefinitionsBySid?.[item.sid] ||
      window.gameClient?.itemDefinitions?.[item.id] ||
      null
    );
  }

  function getItemName(item) {
    const definition = getItemDefinition(item);
    return definition?.properties?.name || item?.name || "";
  }

  function isRingItem(item) {
    if (!item) {
      return false;
    }

    const definition = getItemDefinition(item);
    const slotType = String(
      definition?.properties?.slotType ||
      definition?.properties?.slot ||
      ""
    ).trim().toLowerCase();

    if (slotType === "ring") {
      return true;
    }

    return /\bring\b/i.test(getItemName(item));
  }

  function getEquippedRing() {
    const equipment = getEquipment();
    return equipment?.getSlotItem?.(RING_SLOT) || null;
  }

  function hasEquippedRing() {
    return !!getEquippedRing();
  }

  function findBestRingSource() {
    const equipment = getEquipment();
    if (!equipment) {
      return null;
    }

    let best = null;
    let bestCount = -1;

    const consider = (container, slotIndex, item) => {
      if (!isRingItem(item)) {
        return;
      }

      const count = (typeof item.getCount === "function" ? item.getCount() : item.count) || 1;
      if (count > bestCount) {
        bestCount = count;
        best = { container, slotIndex, item, count, name: getItemName(item) };
      }
    };

    for (let slotIndex = 0; slotIndex < equipment.slots.length; slotIndex += 1) {
      if (slotIndex === RING_SLOT) continue;
      consider(equipment, slotIndex, equipment.getSlotItem(slotIndex));
    }

    getOpenContainers().forEach((container) => {
      (container?.slots || []).forEach((slot, slotIndex) => {
        consider(container, slotIndex, container.getSlotItem(slotIndex));
      });
    });

    return best;
  }

  function getGateStatus(now = Date.now()) {
    const equipment = getEquipment();
    const source = findBestRingSource();
    const cooldownRemainingMs = Math.max(0, config.equipCooldownMs - (now - state.lastEquipAt));

    return {
      hasEquipment: !!equipment,
      hasRingEquipped: hasEquippedRing(),
      hasRingAvailable: !!source,
      cooldownReady: cooldownRemainingMs === 0,
      cooldownRemainingMs,
      source,
      canEquip: !!equipment && !hasEquippedRing() && !!source && cooldownRemainingMs === 0,
    };
  }

  function canEquipRing(now = Date.now()) {
    return getGateStatus(now).canEquip;
  }

  function tryEquipRing(now = Date.now()) {
    if (!config.enabled || !canEquipRing(now)) {
      return false;
    }

    const equipment = getEquipment();
    const source = findBestRingSource();
    if (!equipment || !source) {
      return false;
    }

    const from = {
      which: source.container,
      index: source.slotIndex,
    };
    const to = {
      which: equipment,
      index: RING_SLOT,
    };
    const count = source.count || 1;

    window.gameClient.send(new ItemMovePacket(from, to, count));
    state.lastEquipAt = now;
    bot.log("equipped ring", {
      name: source.name,
      fromContainerId: source.container?.__containerId ?? null,
      fromSlot: source.slotIndex,
    });
    return true;
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
      tryEquipRing();
    } catch (error) {
      bot.log("equip ring tick failed", error?.message || error);
    } finally {
      scheduleNextTick();
    }
  }

  function start(overrides = {}) {
    Object.assign(config, overrides, { enabled: true });
    config.tickMs = 1000;
    persistConfig();

    if (state.running) {
      bot.log("equip ring already running");
      return false;
    }

    state.running = true;
    attachResumeListeners();
    bot.log("equip ring started", { ...config });
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
    bot.log("equip ring stopped");
    return true;
  }

  function status() {
    return {
      running: state.running,
      config: { ...config },
      gates: getGateStatus(),
      equippedRing: getEquippedRing(),
      lastEquipAt: state.lastEquipAt,
    };
  }

  function updateConfig(nextConfig = {}) {
    Object.assign(config, nextConfig);
    config.tickMs = 1000;
    persistConfig();
    bot.log("equip ring config updated", { ...config });
    return { ...config };
  }

  if (config.enabled) {
    start();
  }

  bot.equipRing = {
    start,
    stop,
    status,
    updateConfig,
    config,
    getEquippedRing,
    hasEquippedRing,
    findBestRingSource,
    getGateStatus,
    canEquipRing,
    tryEquipRing,
  };
};
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
window.__mageTuntunBundle = window.__mageTuntunBundle || {};

window.__mageTuntunBundle.installPanel = function installPanel(bot) {
  const panelPositionKey = "mageTuntun.ui.panelPosition";
  const panelCollapsedKey = "mageTuntun.ui.panelCollapsed";

  function destroy() {
    document.getElementById("mage-tuntun-panel")?.remove();
    document.getElementById("mage-tuntun-style")?.remove();
  }

  function savePanelPosition(position, key = panelPositionKey) {
    bot.storage.set(key, position);
  }

  function getSavedPanelPosition(key = panelPositionKey) {
    return bot.storage.get(key, null);
  }

  function savePanelCollapsed(collapsed) {
    bot.storage.set(panelCollapsedKey, !!collapsed);
  }

  function getSavedPanelCollapsed() {
    return !!bot.storage.get(panelCollapsedKey, false);
  }

  function refreshHomeLabel() {
    const homeLabel = document.getElementById("mage-tuntun-home");
    if (!homeLabel) return;

    const home = bot.pz?.getHomePz?.();
    homeLabel.textContent = home
      ? `Panic Runner Home: ${home.x}, ${home.y}, ${home.z}`
      : "Panic Runner Home: not set";
  }

  function refreshProfileLabel() {
    const profileLabel = document.getElementById("mage-tuntun-profile");
    const activeProfile = bot.getActiveProfileName?.();
    const savedProfiles = bot.getSavedProfileNames?.() || [];
    const automatic = !!bot.isAutomaticProfile?.();
    if (profileLabel) {
      profileLabel.textContent = activeProfile
      ? `Profile: ${automatic ? "Character — " : ""}${activeProfile}${savedProfiles.length > 1 ? ` (${savedProfiles.length} saved)` : ""}`
      : "Profile: waiting for character";
    }

    const select = document.getElementById("mage-tuntun-profile-select");
    if (!select || document.activeElement === select) return;
    const characterName = bot.getCharacterProfileName?.();
    select.innerHTML = "";
    const automaticOption = document.createElement("option");
    automaticOption.value = "__character__";
    automaticOption.textContent = characterName ? `Character: ${characterName}` : "Character (loading...)";
    select.appendChild(automaticOption);
    savedProfiles.forEach((name) => {
      const option = document.createElement("option");
      option.value = name;
      option.textContent = name;
      select.appendChild(option);
    });
    select.value = automatic ? "__character__" : (activeProfile || "__character__");
  }

  function refreshPanicStatus() {
    const unknownToggle = document.getElementById("mage-tuntun-panic-unknown");
    const healthToggle = document.getElementById("mage-tuntun-panic-health");
    const returnToggle = document.getElementById("mage-tuntun-panic-return");
    const status = bot.panic?.status?.();

    if (unknownToggle) {
      unknownToggle.checked = !!status?.config?.unknownPlayerEnabled;
    }

    if (healthToggle) {
      healthToggle.checked = !!status?.config?.healthLossEnabled;
    }

    if (returnToggle) {
      returnToggle.checked = !!status?.config?.returnToOriginEnabled;
    }
  }

  function refreshXrayStatus() {
    const status = bot.xray?.status?.();
    const me = bot.getPlayerPosition?.();
    const overlayButton = document.getElementById("mage-tuntun-xray-overlay-toggle");
    const overlayLabel = document.getElementById("mage-tuntun-xray-overlay-status");
    const floorSelect = document.getElementById("mage-tuntun-xray-floor-select");
    const formatFloorOffset = (floor) => {
      if (!me || floor == null) {
        return null;
      }

      const offset = me.z - floor;
      return offset === 0 ? "0" : offset > 0 ? `+${offset}` : `${offset}`;
    };

    if (overlayButton) {
      overlayButton.textContent = status?.config?.overlayEnabled ? "Disable Overlay" : "Enable Overlay";
    }

    if (overlayLabel) {
      const floorLabel = status?.config?.selectedFloor == null
        ? "all floors"
        : `${formatFloorOffset(status.config.selectedFloor) ?? "?"}`;
      overlayLabel.textContent = `${status?.config?.overlayEnabled ? "Overlay: on" : "Overlay: off"} • ${floorLabel}`;
    }

    if (floorSelect) {
      const floors = Array.from(
        new Set(
          (status?.visibleCreatures || [])
            .map((creature) => creature?.position?.z)
            .filter((floor) => floor != null)
        )
      ).sort((a, b) => a - b);
      const selectedFloor = status?.config?.selectedFloor;

      if (selectedFloor != null && !floors.includes(selectedFloor)) {
        floors.push(selectedFloor);
        floors.sort((a, b) => a - b);
      }

      floorSelect.innerHTML = "";

      const allOption = document.createElement("option");
      allOption.value = "all";
      allOption.textContent = "All floors";
      floorSelect.appendChild(allOption);

      floors.forEach((floor) => {
        const option = document.createElement("option");
        option.value = String(floor);
        const offsetLabel = formatFloorOffset(floor);
        option.textContent = offsetLabel == null
          ? String(floor)
          : offsetLabel;
        floorSelect.appendChild(option);
      });

      floorSelect.value = selectedFloor == null ? "all" : String(selectedFloor);
    }
  }

  function renderTrustedNames() {
    const list = document.getElementById("mage-tuntun-panic-trusted-list");
    if (!list) return;

    const trustedNames = bot.panic?.config?.trustedNames || [];
    list.innerHTML = "";

    if (!trustedNames.length) {
      const empty = document.createElement("div");
      empty.className = "mb-small-note";
      empty.textContent = "No trusted names saved.";
      list.appendChild(empty);
      return;
    }

    trustedNames.forEach((name, index) => {
      const row = document.createElement("div");
      row.className = "mb-list-row";

      const label = document.createElement("span");
      label.textContent = name;

      const removeButton = document.createElement("button");
      removeButton.type = "button";
      removeButton.className = "mb-small-button";
      removeButton.textContent = "Remove";
      removeButton.addEventListener("click", () => {
        const nextNames = trustedNames.filter((_, currentIndex) => currentIndex !== index);
        bot.panic.updateConfig({ trustedNames: nextNames });
        renderTrustedNames();
      });

      row.appendChild(label);
      row.appendChild(removeButton);
      list.appendChild(row);
    });
  }

  function renderChips(containerId, items, onRemove) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = "";

    if (!items || !items.length) {
      const empty = document.createElement("span");
      empty.className = "mb-small-note";
      empty.textContent = "(none)";
      container.appendChild(empty);
      return;
    }

    items.forEach((item, index) => {
      const chip = document.createElement("span");
      chip.className = "mb-chip";

      const label = document.createElement("span");
      label.textContent = item;

      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "mb-chip-remove";
      removeBtn.textContent = "×";
      removeBtn.title = "Remove";
      removeBtn.addEventListener("click", () => onRemove(index));

      chip.appendChild(label);
      chip.appendChild(removeBtn);
      container.appendChild(chip);
    });
  }

  function renderGmStaffNames() {
    const staffNames = bot.gm?.config?.staffNames || [];
    renderChips("mage-tuntun-gm-name-chips", staffNames, (index) => {
      const nextNames = staffNames.filter((_, i) => i !== index);
      bot.gm?.updateConfig({ staffNames: nextNames });
      renderGmStaffNames();
    });
  }

  function renderGmFirstReplies() {
    const firstReplies = bot.gm?.config?.firstReplies || [];
    renderChips("mage-tuntun-gm-first-reply-chips", firstReplies, (index) => {
      const nextReplies = firstReplies.filter((_, i) => i !== index);
      bot.gm?.updateConfig({ firstReplies: nextReplies });
      renderGmFirstReplies();
    });
  }

  function renderGmSecondReplies() {
    const secondReplies = bot.gm?.config?.secondReplies || [];
    renderChips("mage-tuntun-gm-second-reply-chips", secondReplies, (index) => {
      const nextReplies = secondReplies.filter((_, i) => i !== index);
      bot.gm?.updateConfig({ secondReplies: nextReplies });
      renderGmSecondReplies();
    });
  }

  function refreshGmStatus() {
    const status = bot.gm?.status?.();
    const gmToggle = document.getElementById("mage-tuntun-gm-enabled");
    const statusLabel = document.getElementById("mage-tuntun-gm-status");
    const pauseToggle = document.getElementById("mage-tuntun-gm-pause-hunting");
    const ignorePzToggle = document.getElementById("mage-tuntun-gm-ignore-pz");
    const reactNameToggle = document.getElementById("mage-tuntun-gm-react-name");
    const reactGmChatToggle = document.getElementById("mage-tuntun-gm-react-chat");
    const autoRepliesToggle = document.getElementById("mage-tuntun-gm-auto-replies");
    const soundToggle = document.getElementById("mage-tuntun-gm-sound");
    const captchaToggle = document.getElementById("mage-tuntun-captcha-enabled");
    const captchaSoundToggle = document.getElementById("mage-tuntun-captcha-sound");
    const captchaAutoSolveToggle = document.getElementById("mage-tuntun-captcha-auto-solve");
    const cooldownInput = document.getElementById("mage-tuntun-gm-cooldown-min");

    if (gmToggle) gmToggle.checked = !!status?.running;
    if (pauseToggle) pauseToggle.checked = !!status?.config?.pauseHuntingOnGm;
    if (ignorePzToggle) ignorePzToggle.checked = !!status?.config?.ignoreGmInPz;
    if (reactNameToggle) reactNameToggle.checked = !!status?.config?.reactOnNameMention;
    if (reactGmChatToggle) reactGmChatToggle.checked = !!status?.config?.reactOnGmChat;
    if (autoRepliesToggle) autoRepliesToggle.checked = !!status?.config?.autoRepliesEnabled;
    if (soundToggle) soundToggle.checked = !!status?.config?.soundOnGm;
    if (captchaToggle) captchaToggle.checked = !!status?.config?.captchaWatcherEnabled;
    if (captchaSoundToggle) captchaSoundToggle.checked = !!status?.config?.soundOnCaptcha;
    if (captchaAutoSolveToggle) captchaAutoSolveToggle.checked = !!status?.config?.captchaAutoSolveEnabled;
    if (cooldownInput && document.activeElement !== cooldownInput) {
      cooldownInput.value = Math.round((status?.config?.dontReactAgainMs || 600000) / 60000);
    }

    if (statusLabel) {
      if (status?.captchaActive) {
        statusLabel.textContent = "ANTI-BOT ACTIVE!";
        statusLabel.style.color = "#ff4d4d";
        statusLabel.style.fontWeight = "bold";
      } else if (status?.isGmCurrentlyVisible) {
        statusLabel.textContent = "GM ON SCREEN!";
        statusLabel.style.color = "#f2994a";
        statusLabel.style.fontWeight = "bold";
      } else if (status?.running) {
        statusLabel.textContent = "Watching";
        statusLabel.style.color = "#82ca9d";
        statusLabel.style.fontWeight = "normal";
      } else {
        statusLabel.textContent = "Idle";
        statusLabel.style.color = "#b7a67d";
        statusLabel.style.fontWeight = "normal";
      }
    }
  }

  function renderGameMasterNames() {
    renderGmStaffNames();
  }

  function refreshRuneStatus() {
    const runeToggle = document.getElementById("mage-tuntun-rune-enabled");
    const running = !!bot.rune?.status?.().running;

    if (runeToggle) {
      runeToggle.checked = running;
    }
  }

  function refreshAutoEatStatus() {
    const autoEatToggle = document.getElementById("mage-tuntun-auto-eat-enabled");
    if (!autoEatToggle) return;

    autoEatToggle.checked = !!bot.eat?.status?.().running;
  }

  function refreshAutoHealStatus() {
    const autoHealToggle = document.getElementById("mage-tuntun-auto-heal-enabled");
    if (!autoHealToggle) return;

    autoHealToggle.checked = !!bot.heal?.status?.().running;
  }

  function refreshAutoInvisibleStatus() {
    const autoInvisibleToggle = document.getElementById("mage-tuntun-auto-invisible-enabled");
    if (!autoInvisibleToggle) return;

    autoInvisibleToggle.checked = !!bot.invisible?.status?.().running;
  }

  function refreshAutoMagicShieldStatus() {
    const autoMagicShieldToggle = document.getElementById("mage-tuntun-auto-magic-shield-enabled");
    if (!autoMagicShieldToggle) return;

    autoMagicShieldToggle.checked = !!bot.magicShield?.status?.().running;
  }

  function refreshAutoHasteStatus() {
    const autoHasteToggle = document.getElementById("mage-tuntun-auto-haste-enabled");
    if (!autoHasteToggle) return;

    autoHasteToggle.checked = !!bot.haste?.status?.().running;
  }

  function refreshAutoAttackStatus() {
    const autoAttackToggle = document.getElementById("mage-tuntun-auto-attack-enabled");
    if (!autoAttackToggle) return;

    autoAttackToggle.checked = !!bot.attack?.status?.().running;
  }

  function refreshCaveStatus() {
    const statusLabel = document.getElementById("mage-tuntun-cave-status");
    const startButton = document.getElementById("mage-tuntun-cave-start");
    const stopButton = document.getElementById("mage-tuntun-cave-stop");
    const route = bot.cave?.getRoute?.() || [];
    const status = bot.cave?.status?.();

    if (statusLabel) {
      if (!route.length) {
        statusLabel.textContent = "Status: no waypoints";
      } else if (status?.running) {
        const waypointNumber = (status.currentIndex ?? 0) + 1;
        const distanceLabel =
          Number.isFinite(status?.distanceToWaypoint) && status.distanceToWaypoint >= 0
            ? `, dist ${status.distanceToWaypoint}`
            : "";
        statusLabel.textContent = `Status: running (${waypointNumber}/${route.length}${distanceLabel})`;
      } else {
        statusLabel.textContent = `Status: idle (${route.length} waypoint${route.length === 1 ? "" : "s"})`;
      }
    }

    if (startButton) {
      startButton.disabled = !route.length || !!status?.running;
    }

    if (stopButton) {
      stopButton.disabled = !status?.running;
    }

    refreshCaveWaypointList(route, status);
  }

  function refreshCaveWaypointList(route = bot.cave?.getRoute?.() || [], status = bot.cave?.status?.()) {
    const list = document.getElementById("mage-tuntun-cave-waypoint-list");
    if (!list) return;

    list.innerHTML = "";
    if (!route.length) {
      const empty = document.createElement("div");
      empty.className = "mb-small-note";
      empty.textContent = "No waypoints recorded.";
      list.appendChild(empty);
      return;
    }

    route.forEach((waypoint, index) => {
      const row = document.createElement("div");
      row.className = "mb-list-row";

      const label = document.createElement("span");
      const isCurrent = !!status?.running && index === status.currentIndex;
      label.textContent = `${isCurrent ? "▶ " : ""}${index + 1}. ${waypoint.x}, ${waypoint.y}, ${waypoint.z}`;

      const removeButton = document.createElement("button");
      removeButton.type = "button";
      removeButton.className = "mb-small-button";
      removeButton.textContent = "Remove";
      removeButton.addEventListener("click", () => {
        bot.cave?.removeWaypoint?.(index);
        refreshCaveStatus();
        refreshCaveClosestStatus();
        refreshCaveTransitionStatus();
      });

      row.appendChild(label);
      row.appendChild(removeButton);
      list.appendChild(row);
    });
  }

  function refreshCavePresetControls() {
    const select = document.getElementById("mage-tuntun-cave-preset-select");
    const label = document.getElementById("mage-tuntun-cave-preset-status");
    const deleteButton = document.getElementById("mage-tuntun-cave-preset-delete");
    const status = bot.cave?.status?.();
    const presetNames = status?.presetNames || bot.cave?.getPresetNames?.() || [];
    const activePresetName = status?.activePresetName || bot.cave?.getActivePresetName?.() || "Default";

    if (select) {
      const previousValue = select.value;
      select.innerHTML = "";

      if (!presetNames.length) {
        const option = document.createElement("option");
        option.value = "";
        option.textContent = "No saved presets";
        select.appendChild(option);
        select.disabled = true;
      } else {
        presetNames.forEach((name) => {
          const option = document.createElement("option");
          option.value = name;
          option.textContent = name;
          select.appendChild(option);
        });
        select.disabled = false;
        const nextValue = presetNames.includes(activePresetName) ? activePresetName : previousValue;
        if (nextValue) {
          select.value = nextValue;
        }
      }
    }

    if (label) {
      label.textContent = presetNames.length
        ? `Preset: ${activePresetName} (${presetNames.length} saved)`
        : `Preset: ${activePresetName}`;
    }

    if (deleteButton) {
      deleteButton.disabled = !presetNames.length || !select?.value;
    }

    const allowedMonstersInput = document.getElementById("mage-tuntun-cave-allowed-monsters");
    if (allowedMonstersInput && document.activeElement !== allowedMonstersInput) {
      allowedMonstersInput.value = (status?.allowedMonsters || bot.cave?.getAllowedMonsters?.() || []).join(", ");
    }
  }

  function refreshCaveClosestStatus() {
    const label = document.getElementById("mage-tuntun-cave-closest");
    if (!label) return;

    const position = bot.getPlayerPosition?.();
    const route = bot.cave?.getRoute?.() || [];

    if (!position) {
      label.textContent = "Closest start: current position unavailable";
      return;
    }

    if (!route.length) {
      label.textContent = "Closest start: no waypoints";
      return;
    }

    const closestIndex = bot.cave?.findClosestWaypointIndex?.(position) ?? 0;
    const waypoint = route[closestIndex];

    if (!waypoint) {
      label.textContent = "Closest start: unavailable";
      return;
    }

    label.textContent = `Closest start: ${closestIndex + 1}. ${waypoint.x}, ${waypoint.y}, ${waypoint.z}`;
  }

  function refreshCaveTransitionStatus() {
    const label = document.getElementById("mage-tuntun-cave-transition-status");
    if (!label) return;

    const transitions = bot.cave?.getTransitions?.() || [];
    if (!transitions.length) {
      label.textContent = "Transitions learned: none";
      return;
    }

    const latest = transitions
      .slice()
      .sort((a, b) => Number(b?.lastSeenAt || 0) - Number(a?.lastSeenAt || 0))[0];

    if (!latest?.from || !latest?.to) {
      label.textContent = `Transitions learned: ${transitions.length}`;
      return;
    }

    const extra = transitions.length > 1 ? ` (+${transitions.length - 1} more)` : "";
    label.textContent =
      `Transitions learned: ${latest.from.x}, ${latest.from.y}, ${latest.from.z} -> ` +
      `${latest.to.x}, ${latest.to.y}, ${latest.to.z}${extra}`;
  }

  function refreshEquipRingStatus() {
    const equipRingToggle = document.getElementById("mage-tuntun-equip-ring-enabled");
    if (!equipRingToggle) return;

    equipRingToggle.checked = !!bot.equipRing?.status?.().running;
  }

  function refreshTalkStatus() {
    const talkToggle = document.getElementById("mage-tuntun-talk-enabled");
    const statusLabel = document.getElementById("mage-tuntun-talk-status");
    const status = bot.talk?.status?.();

    if (talkToggle) {
      talkToggle.checked = !!status?.running;
    }

    if (statusLabel) {
      if (status?.pending) {
        statusLabel.textContent = "Estado: respondiendo...";
      } else if (status?.running) {
        statusLabel.textContent = status?.config?.apiKey
          ? "Estado: activo (IA Gemini)"
          : "Estado: activo (respuestas de jugador)";
      } else {
        statusLabel.textContent = "Estado: inactivo";
      }
    }
  }

  function refreshVisibleCreatures() {
    const list = document.getElementById("mage-tuntun-visible-creatures-list");
    if (!list) return;

    const me = bot.getPlayerPosition?.();
    const status = bot.xray?.status?.();
    const creatures = status?.visibleCreatures || [];
    const selectedFloor = status?.config?.selectedFloor;
    list.innerHTML = "";

    if (!me) {
      const empty = document.createElement("div");
      empty.className = "mb-small-note";
      empty.textContent = "Current position unavailable.";
      list.appendChild(empty);
      return;
    }

    const getFloorOffset = (creature) => (creature.position?.z || 0) - me.z;
    const getFloorDistance = (creature) => Math.abs(getFloorOffset(creature));

    const visibleCreatures = creatures
      .filter((creature) => {
        const floor = creature?.position?.z;
        if (floor == null) {
          return false;
        }

        if (selectedFloor != null) {
          return floor === selectedFloor;
        }

        return floor !== me.z;
      })
      .sort((a, b) => {
      const floorDistanceDiff = getFloorDistance(a) - getFloorDistance(b);
      if (floorDistanceDiff !== 0) return floorDistanceDiff;

      const floorOffsetDiff = getFloorOffset(a) - getFloorOffset(b);
      if (floorOffsetDiff !== 0) return floorOffsetDiff;

      const aDist = Math.abs((a.position?.x || 0) - me.x) + Math.abs((a.position?.y || 0) - me.y);
      const bDist = Math.abs((b.position?.x || 0) - me.x) + Math.abs((b.position?.y || 0) - me.y);
      return aDist - bDist;
    });

    if (!visibleCreatures.length) {
      const empty = document.createElement("div");
      empty.className = "mb-small-note";
      empty.textContent = selectedFloor == null
        ? "No off-floor creatures."
        : `No creatures on floor ${selectedFloor}.`;
      list.appendChild(empty);
      return;
    }

    let currentFloor = null;

    visibleCreatures.forEach((creature) => {
      const floor = creature.position?.z;
      if (floor !== currentFloor) {
        currentFloor = floor;
        const floorOffset = me.z - floor;
        const floorOffsetLabel =
          floorOffset === 0 ? "0" : floorOffset > 0 ? `+${floorOffset}` : `${floorOffset}`;

        const floorLabel = document.createElement("div");
        floorLabel.className = "mb-floor-label";
        floorLabel.textContent = floorOffsetLabel;
        list.appendChild(floorLabel);
      }

      const row = document.createElement("div");
      row.className = "mb-creature-row";

      const name = document.createElement("div");
      name.className = "mb-creature-name";
      name.textContent = creature.name || (creature.type === 0 ? "Player" : "Mob");

      const meta = document.createElement("div");
      meta.className = "mb-small-note";
      meta.textContent = `${creature.type === 0 ? "Player" : "Mob"} at ${creature.position.x}, ${creature.position.y}, ${creature.position.z}`;

      row.appendChild(name);
      row.appendChild(meta);
      list.appendChild(row);
    });
  }

  function setPanelCollapsed(panel, collapsed) {
    if (!panel) return;

    const body = panel.querySelector(".mb-body");
    const toggle = panel.querySelector("#mage-tuntun-collapse");
    const nextCollapsed = !!collapsed;

    panel.dataset.collapsed = nextCollapsed ? "true" : "false";

    if (body) {
      body.hidden = nextCollapsed;
    }

    if (toggle) {
      toggle.textContent = nextCollapsed ? "+" : "−";
      toggle.setAttribute("aria-label", nextCollapsed ? "Maximize panel" : "Minimize panel");
      toggle.setAttribute("title", nextCollapsed ? "Maximize" : "Minimize");
    }

    savePanelCollapsed(nextCollapsed);
  }

  function applySavedPanelPosition(panel, key = panelPositionKey) {
    const position = getSavedPanelPosition(key);
    if (!position) return;

    if (typeof position.top === "number") {
      panel.style.top = `${position.top}px`;
    }

    if (typeof position.left === "number") {
      panel.style.left = `${position.left}px`;
      panel.style.right = "auto";
    }
  }

  function clampPanelPosition(panel, left, top) {
    const maxLeft = Math.max(0, window.innerWidth - panel.offsetWidth);
    const maxTop = Math.max(0, window.innerHeight - panel.offsetHeight);

    return {
      left: Math.min(Math.max(0, left), maxLeft),
      top: Math.min(Math.max(0, top), maxTop),
    };
  }

  function enableDrag(panel, key = panelPositionKey) {
    const handle = panel.querySelector(".mb-title");
    if (!handle) return;

    let dragState = null;

    const onPointerMove = (event) => {
      if (!dragState) return;

      const next = clampPanelPosition(
        panel,
        event.clientX - dragState.offsetX,
        event.clientY - dragState.offsetY
      );

      panel.style.left = `${next.left}px`;
      panel.style.top = `${next.top}px`;
      panel.style.right = "auto";
    };

    const onPointerUp = () => {
      if (!dragState) return;

      dragState = null;
      const rect = panel.getBoundingClientRect();
      savePanelPosition({ left: rect.left, top: rect.top }, key);
    };

    handle.addEventListener("pointerdown", (event) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;

      const rect = panel.getBoundingClientRect();
      dragState = {
        offsetX: event.clientX - rect.left,
        offsetY: event.clientY - rect.top,
      };

      handle.setPointerCapture?.(event.pointerId);
      event.preventDefault();
    });

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);

    bot.addCleanup(() => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    });
  }

  function inject() {
    destroy();

    const style = document.createElement("style");
    style.id = "mage-tuntun-style";
    style.textContent = `
      #mage-tuntun-panel {
        position: fixed;
        z-index: 999999;
        max-width: calc(100vw - 32px);
        padding: 12px;
        border: 1px solid rgba(224, 200, 148, 0.45);
        border-radius: 10px;
        background: linear-gradient(180deg, rgba(30, 23, 15, 0.95), rgba(15, 11, 8, 0.97));
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
        color: #f1e2b8;
        font: 12px/1.35 Verdana, sans-serif;
        user-select: none;
        max-height: calc(100vh - 32px);
        display: flex;
        flex-direction: column;
      }

      #mage-tuntun-panel {
        top: 16px;
        right: 16px;
        width: 960px;
      }

      #mage-tuntun-panel[data-collapsed="true"] {
        width: 220px;
      }

      #mage-tuntun-panel .mb-title {
        margin: 0;
        font-weight: 700;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        cursor: move;
        touch-action: none;
      }

      #mage-tuntun-panel .mb-titlebar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        margin: 0 0 8px;
      }

      #mage-tuntun-panel .mb-icon-button {
        width: 24px;
        min-width: 24px;
        padding: 2px 0;
        border-radius: 6px;
        font-weight: 700;
        line-height: 1;
      }

      #mage-tuntun-panel[data-collapsed="true"] .mb-titlebar {
        margin-bottom: 0;
      }

      #mage-tuntun-panel .mb-body {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 280px 240px;
        gap: 12px;
        align-items: start;
        min-height: 0;
        flex: 1 1 auto;
        overflow-y: auto;
        overscroll-behavior: contain;
        padding-right: 4px;
      }

      #mage-tuntun-panel .mb-body[hidden] {
        display: none !important;
      }

      #mage-tuntun-panel .mb-side-column,
      #mage-tuntun-panel .mb-main-column,
      #mage-tuntun-panel .mb-cave-column {
        display: grid;
        gap: 10px;
      }

      #mage-tuntun-panel .mb-section {
        padding-top: 10px;
        border-top: 1px solid rgba(224, 200, 148, 0.16);
      }

      #mage-tuntun-panel .mb-column-section:first-child {
        padding-top: 0;
        border-top: 0;
      }

      #mage-tuntun-panel .mb-label {
        margin: 0 0 8px;
        color: #d3c49d;
        word-break: break-word;
      }

      #mage-tuntun-panel .mb-actions {
        display: grid;
        gap: 6px;
      }

      #mage-tuntun-panel .mb-actions-inline-three {
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }

      #mage-tuntun-panel .mb-actions-inline-two {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      #mage-tuntun-panel button {
        width: 100%;
        padding: 8px 10px;
        border: 1px solid rgba(224, 200, 148, 0.35);
        border-radius: 8px;
        background: linear-gradient(180deg, #635133, #3f321f);
        color: #f7eccf;
        font: inherit;
        cursor: pointer;
      }

      #mage-tuntun-panel button:hover {
        background: linear-gradient(180deg, #755f3d, #4f4028);
      }

      #mage-tuntun-panel input,
      #mage-tuntun-panel textarea {
        width: 100%;
        box-sizing: border-box;
        padding: 8px 10px;
        border: 1px solid rgba(224, 200, 148, 0.35);
        border-radius: 8px;
        background: rgba(16, 12, 8, 0.88);
        color: #f7eccf;
        font: inherit;
      }

      #mage-tuntun-panel textarea {
        min-height: 72px;
        resize: vertical;
      }

      #mage-tuntun-panel .mb-toggle {
        display: flex;
        align-items: center;
        gap: 8px;
        color: #d3c49d;
      }

      #mage-tuntun-panel .mb-toggle input[type="checkbox"] {
        width: auto;
        margin: 0;
      }

      #mage-tuntun-panel .mb-row {
        display: grid;
        grid-template-columns: auto 1fr;
        align-items: center;
        gap: 8px;
      }

      #mage-tuntun-panel .mb-row-compact {
        grid-template-columns: auto auto;
        justify-content: start;
      }

      #mage-tuntun-panel .mb-row .mb-toggle {
        white-space: nowrap;
      }

      #mage-tuntun-panel .mb-row input[type="text"] {
        min-width: 0;
      }

      #mage-tuntun-panel .mb-row-three {
        display: grid;
        grid-template-columns: auto minmax(120px, 1fr) 72px;
        align-items: center;
        gap: 8px;
      }

      #mage-tuntun-panel .mb-row-three input[type="text"],
      #mage-tuntun-panel .mb-row-three input[type="number"] {
        min-width: 0;
      }

      #mage-tuntun-panel .mb-row-five {
        display: grid;
        grid-template-columns: auto 82px 72px 82px 72px;
        align-items: center;
        gap: 8px;
      }

      #mage-tuntun-panel .mb-row-five input[type="number"] {
        min-width: 0;
      }

      #mage-tuntun-panel .mb-field-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 8px;
      }

      #mage-tuntun-panel .mb-field {
        display: grid;
        gap: 4px;
      }

      #mage-tuntun-panel .mb-field-compact {
        width: 96px;
        justify-self: end;
      }

      #mage-tuntun-panel .mb-field-label {
        color: #d3c49d;
        font-size: 11px;
      }

      #mage-tuntun-panel .mb-stack {
        display: grid;
        gap: 8px;
      }

      #mage-tuntun-panel .mb-inline {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 6px;
        align-items: center;
      }

      #mage-tuntun-panel .mb-list {
        display: grid;
        gap: 6px;
      }

      #mage-tuntun-panel .mb-list-row {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 6px;
        align-items: center;
        color: #d3c49d;
      }

      #mage-tuntun-panel .mb-creature-row {
        padding: 6px 8px;
        border: 1px solid rgba(224, 200, 148, 0.14);
        border-radius: 8px;
        background: rgba(255, 244, 212, 0.04);
      }

      #mage-tuntun-panel .mb-creature-name {
        color: #f7eccf;
        word-break: break-word;
      }

      #mage-tuntun-panel .mb-floor-label {
        margin-top: 4px;
        color: #e2cf9c;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.04em;
        text-transform: uppercase;
      }

      #mage-tuntun-panel #mage-tuntun-visible-creatures-list {
        max-height: 150px;
        overflow-y: auto;
        padding-right: 2px;
      }

      #mage-tuntun-panel #mage-tuntun-panic-trusted-list {
        max-height: 140px;
        overflow-y: auto;
        padding-right: 2px;
      }

      #mage-tuntun-panel #mage-tuntun-cave-waypoint-list {
        max-height: 150px;
        overflow-y: auto;
        padding: 2px 4px 2px 0;
        scrollbar-width: thin;
        scrollbar-color: #7a623f #201a14;
      }

      #mage-tuntun-panel #mage-tuntun-cave-waypoint-list::-webkit-scrollbar {
        width: 7px;
      }

      #mage-tuntun-panel #mage-tuntun-cave-waypoint-list::-webkit-scrollbar-track {
        background: #201a14;
        border-radius: 4px;
      }

      #mage-tuntun-panel #mage-tuntun-cave-waypoint-list::-webkit-scrollbar-thumb {
        background: #7a623f;
        border-radius: 4px;
      }

      #mage-tuntun-panel .mb-tag-wrap {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
        margin-top: 4px;
        max-height: 85px;
        overflow-y: auto;
      }

      #mage-tuntun-panel .mb-chip {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        background: #25201b;
        border: 1px solid #4a3e2d;
        border-radius: 4px;
        padding: 2px 6px;
        font-size: 11px;
        color: #f7eccf;
      }

      #mage-tuntun-panel .mb-chip-remove {
        cursor: pointer;
        color: #e27a7a;
        font-weight: bold;
        background: none;
        border: none;
        padding: 0 2px;
        font-size: 12px;
        line-height: 1;
      }

      #mage-tuntun-panel .mb-chip-remove:hover {
        color: #ff4d4d;
      }

      #mage-tuntun-panel .mb-small-button {
        width: auto;
        padding: 4px 8px;
        border-radius: 6px;
      }

      #mage-tuntun-panel .mb-small-note {
        color: #b7a67d;
        font-size: 11px;
      }

      #mage-tuntun-panel .mb-note {
        margin-top: 8px;
        color: #b7a67d;
        font-size: 11px;
      }

      @media (max-width: 760px) {
        #mage-tuntun-panel {
          width: min(720px, calc(100vw - 32px));
        }

        #mage-tuntun-panel .mb-body {
          grid-template-columns: 1fr;
        }

        #mage-tuntun-panel .mb-field-grid {
          grid-template-columns: 1fr;
        }
      }
    `;
    document.head.appendChild(style);

    const panel = document.createElement("div");
    panel.id = "mage-tuntun-panel";
    panel.innerHTML = `
        <div class="mb-titlebar">
        <div>
          <div class="mb-title">Mage Tuntun</div>
          <div class="mb-small-note" id="mage-tuntun-profile">Profile: waiting for character</div>
        </div>
        <button type="button" class="mb-icon-button" id="mage-tuntun-collapse" aria-label="Minimize panel" title="Minimize">−</button>
      </div>
      <div class="mb-body">
        <div class="mb-main-column">
          <div class="mb-actions mb-column-section">
            <label class="mb-field" for="mage-tuntun-profile-select">
              <span class="mb-field-label">Configuration profile</span>
              <select id="mage-tuntun-profile-select"></select>
            </label>
            <div class="mb-actions mb-actions-inline-two">
              <button type="button" class="mb-small-button" id="mage-tuntun-profile-new">New profile</button>
              <button type="button" class="mb-small-button" id="mage-tuntun-profile-character">Use character</button>
            </div>
            <button type="button" id="mage-tuntun-reload">Reload Bot</button>
          </div>
          <div class="mb-section mb-column-section">
            <div class="mb-label" id="mage-tuntun-home">Panic Runner Home: not set</div>
            <div class="mb-stack">
              <button type="button" id="mage-tuntun-set-home">Set Home</button>
              <label class="mb-toggle">
                <input type="checkbox" id="mage-tuntun-panic-unknown" />
                <span>Unknown Player</span>
              </label>
              <label class="mb-toggle">
                <input type="checkbox" id="mage-tuntun-panic-health" />
                <span>Lose Health</span>
              </label>
              <label class="mb-toggle">
                <input type="checkbox" id="mage-tuntun-panic-return" />
                <span>Auto Return</span>
              </label>
              <label class="mb-toggle">
                <input type="checkbox" id="mage-tuntun-player-appear-alert" />
                <span>Sound: player appears</span>
              </label>
              <label class="mb-toggle">
                <input type="checkbox" id="mage-tuntun-npc-pause-automation" />
                <span>Sound & stop Cavebot/Attack: NPC appears</span>
              </label>
              <label class="mb-toggle">
                <input type="checkbox" id="mage-tuntun-player-chat-alert" />
                <span>Sound: player chat</span>
              </label>
              <div class="mb-inline">
                <input type="text" id="mage-tuntun-panic-trusted-input" placeholder="Trusted name" />
                <button type="button" class="mb-small-button" id="mage-tuntun-panic-trusted-add">Add</button>
              </div>
              <div class="mb-list" id="mage-tuntun-panic-trusted-list"></div>
            </div>
          </div>
          <div class="mb-section mb-column-section">
            <div class="mb-label" style="display:flex; justify-content:space-between; align-items:center;">
              <span>GM & Anti-Bot Detector</span>
              <span id="mage-tuntun-gm-status" class="mb-small-note">Idle</span>
            </div>
            <div class="mb-stack">
              <label class="mb-toggle">
                <input type="checkbox" id="mage-tuntun-gm-enabled" />
                <span>GM Detector Enabled</span>
              </label>
              <label class="mb-toggle">
                <input type="checkbox" id="mage-tuntun-gm-pause-hunting" />
                <span>Stay paused while GM is on screen</span>
              </label>
              <label class="mb-toggle">
                <input type="checkbox" id="mage-tuntun-gm-ignore-pz" />
                <span>Mute GM alarms in PZ (still pauses)</span>
              </label>
              <label class="mb-toggle">
                <input type="checkbox" id="mage-tuntun-gm-react-name" />
                <span>React if player/spawn creature says my name</span>
              </label>
              <label class="mb-toggle">
                <input type="checkbox" id="mage-tuntun-gm-react-chat" />
                <span>React to messages from configured staff</span>
              </label>
              <label class="mb-toggle">
                <input type="checkbox" id="mage-tuntun-gm-auto-replies" />
                <span>Send automatic replies when staff is detected</span>
              </label>
              <label class="mb-toggle">
                <input type="checkbox" id="mage-tuntun-gm-sound" />
                <span>Sound alarm when GM appears</span>
              </label>

              <div style="border-top: 1px solid #3d3122; padding-top: 6px; margin-top: 4px;">
                <label class="mb-toggle">
                  <input type="checkbox" id="mage-tuntun-captcha-enabled" />
                  <span>Anti-Bot Watcher</span>
                </label>
                <div class="mb-inline" style="margin-top: 4px;">
                  <label class="mb-toggle" style="flex: 1;">
                    <input type="checkbox" id="mage-tuntun-captcha-sound" />
                    <span>Anti-Bot Siren (Dual-Tone)</span>
                  </label>
                  <button type="button" class="mb-small-button" id="mage-tuntun-captcha-test-sound">Test Sound</button>
                </div>
                <label class="mb-toggle" style="margin-top: 4px;">
                  <input type="checkbox" id="mage-tuntun-captcha-auto-solve" />
                  <span>Auto-Solve (click yellow, 1 attempt)</span>
                </label>
                <div class="mb-small-note" style="margin-top: 2px;">Tries to click the yellow-highlighted answer once. If it fails, the alarm sounds for manual resolution.</div>
              </div>

              <div style="border-top: 1px solid #3d3122; padding-top: 6px; margin-top: 4px;">
                <div class="mb-small-note" style="margin-bottom: 2px;">Staff Names:</div>
                <div class="mb-inline">
                  <input type="text" id="mage-tuntun-gm-name-input" placeholder="Staff name..." />
                  <button type="button" class="mb-small-button" id="mage-tuntun-gm-name-add">Add</button>
                </div>
                <div class="mb-tag-wrap" id="mage-tuntun-gm-name-chips"></div>
              </div>

              <div style="border-top: 1px solid #3d3122; padding-top: 6px; margin-top: 4px;">
                <div class="mb-small-note" style="margin-bottom: 2px;">Primera respuesta (reacción inmediata):</div>
                <div class="mb-inline">
                  <input type="text" id="mage-tuntun-gm-first-reply-input" placeholder="Mensaje..." />
                  <button type="button" class="mb-small-button" id="mage-tuntun-gm-first-reply-add">Agregar</button>
                </div>
                <div class="mb-tag-wrap" id="mage-tuntun-gm-first-reply-chips"></div>
              </div>

              <div style="border-top: 1px solid #3d3122; padding-top: 6px; margin-top: 4px;">
                <div class="mb-small-note" style="margin-bottom: 2px;">Segunda respuesta (seguimiento):</div>
                <div class="mb-inline">
                  <input type="text" id="mage-tuntun-gm-second-reply-input" placeholder="Mensaje..." />
                  <button type="button" class="mb-small-button" id="mage-tuntun-gm-second-reply-add">Agregar</button>
                </div>
                <div class="mb-tag-wrap" id="mage-tuntun-gm-second-reply-chips"></div>
              </div>

              <div class="mb-inline" style="border-top: 1px solid #3d3122; padding-top: 6px; margin-top: 4px;">
                <label class="mb-field mb-field-compact" for="mage-tuntun-gm-cooldown-min">
                  <span class="mb-field-label">Don't react again (min)</span>
                  <input type="number" id="mage-tuntun-gm-cooldown-min" min="1" max="120" placeholder="10" />
                </label>
              </div>
            </div>
          </div>
          <div class="mb-section mb-column-section">
            <div class="mb-actions">
              <div class="mb-row-three">
                <label class="mb-toggle">
                  <input type="checkbox" id="mage-tuntun-rune-enabled" />
                  <span>Magic Level Trainer</span>
                </label>
                <input type="text" id="mage-tuntun-rune-spell" placeholder="Spell words" />
                <input type="number" id="mage-tuntun-rune-mana" min="0" placeholder="Mana" />
              </div>
              <div class="mb-row mb-row-compact">
                <label class="mb-field mb-field-compact" for="mage-tuntun-rune-casts-per-minute">
                  <span class="mb-field-label">Casts per minute</span>
                  <input type="number" id="mage-tuntun-rune-casts-per-minute" min="1" placeholder="15" />
                </label>
                <div class="mb-small-note">Casts are evenly spaced while training is active.</div>
              </div>
              <div class="mb-row mb-row-compact">
                <label class="mb-field mb-field-compact" for="mage-tuntun-rune-active-minutes">
                  <span class="mb-field-label">Train (min)</span>
                  <input type="number" id="mage-tuntun-rune-active-minutes" min="0" step="0.1" placeholder="0" />
                </label>
                <label class="mb-field mb-field-compact" for="mage-tuntun-rune-pause-minutes">
                  <span class="mb-field-label">Pause (min)</span>
                  <input type="number" id="mage-tuntun-rune-pause-minutes" min="0" step="0.1" placeholder="0" />
                </label>
                <div class="mb-small-note">Set both above 0 to repeat training and pause cycles.</div>
              </div>
              <div class="mb-row mb-row-compact">
                <label class="mb-toggle">
                  <input type="checkbox" id="mage-tuntun-auto-eat-enabled" />
                  <span>Auto Eat</span>
                </label>
                <label class="mb-field mb-field-compact" for="mage-tuntun-auto-eat-hotkey">
                  <span class="mb-field-label">Eat Hotkey (1-12)</span>
                  <input type="number" id="mage-tuntun-auto-eat-hotkey" min="1" max="12" placeholder="10" />
                </label>
                <label class="mb-field mb-field-compact" for="mage-tuntun-auto-eat-mode">
                  <span class="mb-field-label">Mode</span>
                  <select id="mage-tuntun-auto-eat-mode">
                    <option value="whenHungry">When hungry</option>
                    <option value="interval">Interval</option>
                  </select>
                </label>
                <label class="mb-field mb-field-compact" for="mage-tuntun-auto-eat-cooldown">
                  <span class="mb-field-label">Cooldown (ms)</span>
                  <input type="number" id="mage-tuntun-auto-eat-cooldown" min="1000" placeholder="60000" />
                </label>
              </div>
              <div class="mb-row">
                <label class="mb-toggle">
                  <input type="checkbox" id="mage-tuntun-auto-invisible-enabled" />
                  <span>Auto Invisible</span>
                </label>
                <div class="mb-small-note">Casts utana vid whenever invisibility is not active.</div>
              </div>
              <div class="mb-row">
                <label class="mb-toggle">
                  <input type="checkbox" id="mage-tuntun-auto-haste-enabled" />
                  <span>Auto Haste</span>
                </label>
                <label class="mb-field mb-field-compact" for="mage-tuntun-auto-haste-spell">
                  <span class="mb-field-label">Spell</span>
                  <input type="text" id="mage-tuntun-auto-haste-spell" placeholder="utani hur" />
                </label>
                <label class="mb-field mb-field-compact" for="mage-tuntun-auto-haste-cooldown">
                  <span class="mb-field-label">Recast cooldown (ms)</span>
                  <input type="number" id="mage-tuntun-auto-haste-cooldown" min="1000" placeholder="2000" />
                </label>
              </div>
              <div class="mb-row">
                <label class="mb-toggle">
                  <input type="checkbox" id="mage-tuntun-auto-magic-shield-enabled" />
                  <span>Auto Utamo Vita</span>
                </label>
                <div class="mb-small-note">Casts utamo vita whenever magic shield is not active.</div>
              </div>
              <div class="mb-row">
                <label class="mb-toggle">
                  <input type="checkbox" id="mage-tuntun-equip-ring-enabled" />
                  <span>Equip Ring</span>
                </label>
                <div></div>
              </div>
            </div>
          </div>
          <div class="mb-section mb-column-section">
            <div class="mb-note">Loaded routines: Panic Runner, magic level trainer, auto eat, auto haste, auto invisible, auto utamo vita, equip ring, auto heal, and auto attack.</div>
          </div>
        </div>
        <div class="mb-side-column">
          <div class="mb-section mb-column-section">
            <div class="mb-label">Xray</div>
            <button type="button" class="mb-small-button" id="mage-tuntun-xray-overlay-toggle">Disable Overlay</button>
            <div class="mb-small-note" id="mage-tuntun-xray-overlay-status">Overlay: on</div>
            <label class="mb-field" for="mage-tuntun-xray-floor-select">
              <span class="mb-field-label">Floor Filter</span>
              <select id="mage-tuntun-xray-floor-select">
                <option value="all">All floors</option>
              </select>
            </label>
            <div class="mb-list" id="mage-tuntun-visible-creatures-list"></div>
          </div>
          <div class="mb-section mb-column-section">
            <div class="mb-label">Auto Heal</div>
            <div class="mb-stack">
              <label class="mb-toggle">
                <input type="checkbox" id="mage-tuntun-auto-heal-enabled" />
                <span>Enable Auto Heal</span>
              </label>
              <div class="mb-field-grid">
                <label class="mb-field" for="mage-tuntun-auto-heal-min-hp-percent">
                  <span class="mb-field-label">Heal HP below (%)</span>
                  <input type="number" id="mage-tuntun-auto-heal-min-hp-percent" min="1" max="100" placeholder="80" />
                </label>
                <label class="mb-field" for="mage-tuntun-auto-heal-hp-hotkey">
                  <span class="mb-field-label">HP Hotkey (1-12)</span>
                  <input type="number" id="mage-tuntun-auto-heal-hp-hotkey" min="1" max="12" placeholder="8" />
                </label>
                <label class="mb-field" for="mage-tuntun-auto-heal-min-mana-percent">
                  <span class="mb-field-label">Heal mana below (%)</span>
                  <input type="number" id="mage-tuntun-auto-heal-min-mana-percent" min="1" max="100" placeholder="30" />
                </label>
                <label class="mb-field" for="mage-tuntun-auto-heal-mana-hotkey">
                  <span class="mb-field-label">Mana Hotkey (1-12)</span>
                  <input type="number" id="mage-tuntun-auto-heal-mana-hotkey" min="1" max="12" placeholder="4" />
                </label>
              </div>
              <div class="mb-field-grid">
                <label class="mb-field" for="mage-tuntun-auto-heal-hp-cooldown">
                  <span class="mb-field-label">HP spell cooldown (ms)</span>
                  <input type="number" id="mage-tuntun-auto-heal-hp-cooldown" min="1000" placeholder="1800" />
                </label>
                <label class="mb-field" for="mage-tuntun-auto-heal-mana-cooldown">
                  <span class="mb-field-label">Mana spell cooldown (ms)</span>
                  <input type="number" id="mage-tuntun-auto-heal-mana-cooldown" min="1000" placeholder="1000" />
                </label>
              </div>
              <div class="mb-row">
                <label class="mb-toggle">
                  <input type="checkbox" id="mage-tuntun-auto-heal-paralyze-enabled" />
                  <span>Remove Paralyze</span>
                </label>
                <label class="mb-field mb-field-compact" for="mage-tuntun-auto-heal-paralyze-hotkey">
                  <span class="mb-field-label">Paralyze Hotkey (1-12)</span>
                  <input type="number" id="mage-tuntun-auto-heal-paralyze-hotkey" min="1" max="12" placeholder="" />
                </label>
              </div>
              <div class="mb-small-note">Checks about twenty times per second. HP is used before mana; each hotkey has its own spell cooldown.</div>
            </div>
          </div>
          <div class="mb-section mb-column-section">
            <div class="mb-label">Auto Sio</div>
            <div class="mb-stack">
              <label class="mb-toggle">
                <input type="checkbox" id="mage-tuntun-auto-sio-enabled" />
                <span>Enable Auto Sio</span>
              </label>
              <input type="text" id="mage-tuntun-auto-sio-target" placeholder="Player name" />
              <div class="mb-field-grid">
                <label class="mb-field" for="mage-tuntun-auto-sio-hp-percent">
                  <span class="mb-field-label">Heal below (%)</span>
                  <input type="number" id="mage-tuntun-auto-sio-hp-percent" min="1" max="100" placeholder="50" />
                </label>
                <label class="mb-field" for="mage-tuntun-auto-sio-cooldown">
                  <span class="mb-field-label">Cooldown (ms)</span>
                  <input type="number" id="mage-tuntun-auto-sio-cooldown" min="1000" placeholder="2000" />
                </label>
              </div>
              <input type="text" id="mage-tuntun-auto-sio-spell" placeholder="exura sio" />
              <div class="mb-small-note">Casts only while the named player is visible on the same floor.</div>
            </div>
          </div>
        </div>
        <div class="mb-cave-column">
          <div class="mb-section mb-column-section">
            <div class="mb-label">Cave Bot</div>
            <div class="mb-stack">
              <div class="mb-field-grid">
                <label class="mb-field" for="mage-tuntun-cave-preset-select">
                  <select id="mage-tuntun-cave-preset-select"></select>
                </label>
              </div>
              <div class="mb-actions mb-actions-inline-two">
                <button type="button" class="mb-small-button" id="mage-tuntun-cave-preset-new">New</button>
                <button type="button" class="mb-small-button" id="mage-tuntun-cave-preset-delete">Delete</button>
              </div>
              <label class="mb-toggle">
                <input type="checkbox" id="mage-tuntun-cave-unexpected-monster-alert" />
                <span>Stop on unexpected monster</span>
              </label>
              <label class="mb-field" for="mage-tuntun-cave-allowed-monsters">
                <span class="mb-field-label">Allowed monsters (comma separated)</span>
                <input type="text" id="mage-tuntun-cave-allowed-monsters" placeholder="Cyclops, Cyclops Drone" />
              </label>
              <label class="mb-field" for="mage-tuntun-cave-rare-items">
                <span class="mb-field-label">Rare item alert (comma separated)</span>
                <input type="text" id="mage-tuntun-cave-rare-items" placeholder="Fire Sword, Dragon Scale Mail, Golden Armor" />
              </label>
              <div class="mb-row">
                <label class="mb-toggle">
                  <input type="checkbox" id="mage-tuntun-cave-rare-item-rarity" />
                  <span>Detect rare+ automatically</span>
                </label>
                <label class="mb-toggle">
                  <input type="checkbox" id="mage-tuntun-cave-rare-item-sound" />
                  <span>Sound on rare item</span>
                </label>
                <label class="mb-toggle">
                  <input type="checkbox" id="mage-tuntun-cave-rare-item-pause" />
                  <span>Pause Cavebot</span>
                </label>
              </div>
              <div class="mb-small-note">This list belongs to the selected preset. An unlisted monster stops Cavebot and Auto Attack.</div>
              <div class="mb-actions mb-actions-inline-two">
                <button type="button" class="mb-small-button" id="mage-tuntun-cave-record">Record Spot</button>
                <button type="button" class="mb-small-button" id="mage-tuntun-cave-remove-last">Remove Last</button>
              </div>
              <div class="mb-small-note" style="margin-top: 4px;">Waypoints</div>
              <div class="mb-list" id="mage-tuntun-cave-waypoint-list"></div>
              <div class="mb-small-note" id="mage-tuntun-cave-closest">Closest start: no waypoints</div>
              <div class="mb-small-note" id="mage-tuntun-cave-transition-status">Transitions learned: none</div>
              <div class="mb-actions mb-actions-inline-two">
                <button type="button" class="mb-small-button" id="mage-tuntun-cave-start">Start</button>
                <button type="button" class="mb-small-button" id="mage-tuntun-cave-stop">Stop</button>
              </div>
              <div class="mb-small-note" id="mage-tuntun-cave-status">Status: no waypoints</div>
            </div>
          </div>
          <div class="mb-section mb-column-section">
            <div class="mb-label">Auto Attack</div>
            <div class="mb-stack">
              <label class="mb-toggle">
                <input type="checkbox" id="mage-tuntun-auto-attack-enabled" />
                <span>Enable Auto Attack</span>
              </label>
              <label class="mb-toggle">
                <input type="checkbox" id="mage-tuntun-auto-attack-melee" />
                <span>Melee Mode</span>
              </label>
              <label class="mb-toggle">
                <input type="checkbox" id="mage-tuntun-auto-attack-movement" />
                <span>Kite (keep distance)</span>
              </label>
              <label class="mb-toggle">
                <input type="checkbox" id="mage-tuntun-auto-attack-kite-retreat-route" />
                <span>Kite toward previous route waypoint</span>
              </label>
              <div class="mb-field-grid">
                <label class="mb-field" for="mage-tuntun-auto-attack-kite-min-distance">
                  <span class="mb-field-label">Kite min distance (included)</span>
                  <input type="number" id="mage-tuntun-auto-attack-kite-min-distance" min="1" placeholder="3" />
                </label>
                <label class="mb-field" for="mage-tuntun-auto-attack-kite-max-distance">
                  <span class="mb-field-label">Kite max distance (included)</span>
                  <input type="number" id="mage-tuntun-auto-attack-kite-max-distance" min="1" placeholder="5" />
                </label>
              </div>
              <label class="mb-toggle">
                <input type="checkbox" id="mage-tuntun-auto-attack-ignore-summons" />
                <span>Ignore summons</span>
              </label>
              <label class="mb-field" for="mage-tuntun-auto-attack-priority-monsters">
                <span class="mb-field-label">Monster priority (comma separated)</span>
                <input type="text" id="mage-tuntun-auto-attack-priority-monsters" placeholder="Dragon, Necromancer" />
              </label>
              <label class="mb-field" for="mage-tuntun-auto-attack-ignore-monsters">
                <span class="mb-field-label">Ignore monsters (comma separated)</span>
                <input type="text" id="mage-tuntun-auto-attack-ignore-monsters" placeholder="Rat, Deer" />
              </label>
              <label class="mb-field" for="mage-tuntun-auto-attack-hotkey">
                <span class="mb-field-label">Target Hotkey (1-12)</span>
                <input type="number" id="mage-tuntun-auto-attack-hotkey" min="1" max="12" placeholder="3" />
              </label>
              <label class="mb-field" for="mage-tuntun-auto-attack-rune-hotkey">
                <span class="mb-field-label">Action Hotkey (1-12)</span>
                <input type="number" id="mage-tuntun-auto-attack-rune-hotkey" min="1" max="12" placeholder="4" />
              </label>
              <label class="mb-field" for="mage-tuntun-auto-attack-rune-cooldown">
                <span class="mb-field-label">Action cooldown (ms)</span>
                <input type="number" id="mage-tuntun-auto-attack-rune-cooldown" min="1000" placeholder="2000" />
              </label>
              <div class="mb-small-note">Melee follows adjacent; kite keeps the configured range. The action hotkey is used on the current target at its configured cooldown.</div>
            </div>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(panel);

    const unlockAudio = () => {
      bot.unlockAudio?.();
    };

    panel.addEventListener("pointerdown", unlockAudio, { passive: true });
    panel.addEventListener("keydown", unlockAudio);

    bot.addCleanup(() => {
      panel.removeEventListener("pointerdown", unlockAudio);
      panel.removeEventListener("keydown", unlockAudio);
    });

    applySavedPanelPosition(panel);
    enableDrag(panel);
    setPanelCollapsed(panel, getSavedPanelCollapsed());

    const spellInput = panel.querySelector("#mage-tuntun-rune-spell");
    const profileSelect = panel.querySelector("#mage-tuntun-profile-select");
    const newProfileButton = panel.querySelector("#mage-tuntun-profile-new");
    const characterProfileButton = panel.querySelector("#mage-tuntun-profile-character");
    const manaInput = panel.querySelector("#mage-tuntun-rune-mana");
    const runeEnabledInput = panel.querySelector("#mage-tuntun-rune-enabled");
    const runeCastsPerMinuteInput = panel.querySelector("#mage-tuntun-rune-casts-per-minute");
    const runeActiveMinutesInput = panel.querySelector("#mage-tuntun-rune-active-minutes");
    const runePauseMinutesInput = panel.querySelector("#mage-tuntun-rune-pause-minutes");
    const autoEatEnabledInput = panel.querySelector("#mage-tuntun-auto-eat-enabled");
    const autoEatHotkeyInput = panel.querySelector("#mage-tuntun-auto-eat-hotkey");
    const autoEatModeInput = panel.querySelector("#mage-tuntun-auto-eat-mode");
    const autoEatCooldownInput = panel.querySelector("#mage-tuntun-auto-eat-cooldown");
    const autoInvisibleEnabledInput = panel.querySelector("#mage-tuntun-auto-invisible-enabled");
    const autoMagicShieldEnabledInput = panel.querySelector("#mage-tuntun-auto-magic-shield-enabled");
    const autoHasteEnabledInput = panel.querySelector("#mage-tuntun-auto-haste-enabled");
    const autoHasteSpellInput = panel.querySelector("#mage-tuntun-auto-haste-spell");
    const autoHasteCooldownInput = panel.querySelector("#mage-tuntun-auto-haste-cooldown");
    const equipRingEnabledInput = panel.querySelector("#mage-tuntun-equip-ring-enabled");
    const autoHealEnabledInput = panel.querySelector("#mage-tuntun-auto-heal-enabled");
    const autoHealMinHpPercentInput = panel.querySelector("#mage-tuntun-auto-heal-min-hp-percent");
    const autoHealHpHotkeyInput = panel.querySelector("#mage-tuntun-auto-heal-hp-hotkey");
    const autoHealMinManaPercentInput = panel.querySelector("#mage-tuntun-auto-heal-min-mana-percent");
    const autoHealManaHotkeyInput = panel.querySelector("#mage-tuntun-auto-heal-mana-hotkey");
    const autoHealHpCooldownInput = panel.querySelector("#mage-tuntun-auto-heal-hp-cooldown");
    const autoHealManaCooldownInput = panel.querySelector("#mage-tuntun-auto-heal-mana-cooldown");
    const autoHealParalyzeEnabledInput = panel.querySelector("#mage-tuntun-auto-heal-paralyze-enabled");
    const autoHealParalyzeHotkeyInput = panel.querySelector("#mage-tuntun-auto-heal-paralyze-hotkey");
    const autoSioEnabledInput = panel.querySelector("#mage-tuntun-auto-sio-enabled");
    const autoSioTargetInput = panel.querySelector("#mage-tuntun-auto-sio-target");
    const autoSioHpPercentInput = panel.querySelector("#mage-tuntun-auto-sio-hp-percent");
    const autoSioCooldownInput = panel.querySelector("#mage-tuntun-auto-sio-cooldown");
    const autoSioSpellInput = panel.querySelector("#mage-tuntun-auto-sio-spell");
    const autoAttackEnabledInput = panel.querySelector("#mage-tuntun-auto-attack-enabled");
    const autoAttackMeleeInput = panel.querySelector("#mage-tuntun-auto-attack-melee");
    const autoAttackMovementInput = panel.querySelector("#mage-tuntun-auto-attack-movement");
    const autoAttackKiteRetreatRouteInput = panel.querySelector("#mage-tuntun-auto-attack-kite-retreat-route");
    const autoAttackKiteMinDistanceInput = panel.querySelector("#mage-tuntun-auto-attack-kite-min-distance");
    const autoAttackKiteMaxDistanceInput = panel.querySelector("#mage-tuntun-auto-attack-kite-max-distance");
    const autoAttackIgnoreSummonsInput = panel.querySelector("#mage-tuntun-auto-attack-ignore-summons");
    const autoAttackPriorityMonstersInput = panel.querySelector("#mage-tuntun-auto-attack-priority-monsters");
    const autoAttackIgnoreMonstersInput = panel.querySelector("#mage-tuntun-auto-attack-ignore-monsters");
    const autoAttackHotkeyInput = panel.querySelector("#mage-tuntun-auto-attack-hotkey");
    const autoAttackRuneHotkeyInput = panel.querySelector("#mage-tuntun-auto-attack-rune-hotkey");
    const autoAttackRuneCooldownInput = panel.querySelector("#mage-tuntun-auto-attack-rune-cooldown");
    const talkEnabledInput = panel.querySelector("#mage-tuntun-talk-enabled");
    const talkApiKeyInput = panel.querySelector("#mage-tuntun-talk-api-key");
    const talkPromptInput = panel.querySelector("#mage-tuntun-talk-prompt");
    const gmEnabledInput = panel.querySelector("#mage-tuntun-gm-enabled");
    const gmPauseHuntingInput = panel.querySelector("#mage-tuntun-gm-pause-hunting");
    const gmIgnorePzInput = panel.querySelector("#mage-tuntun-gm-ignore-pz");
    const gmReactNameInput = panel.querySelector("#mage-tuntun-gm-react-name");
    const gmReactChatInput = panel.querySelector("#mage-tuntun-gm-react-chat");
    const gmAutoRepliesInput = panel.querySelector("#mage-tuntun-gm-auto-replies");
    const gmSoundInput = panel.querySelector("#mage-tuntun-gm-sound");
    const captchaEnabledInput = panel.querySelector("#mage-tuntun-captcha-enabled");
    const captchaSoundInput = panel.querySelector("#mage-tuntun-captcha-sound");
    const captchaAutoSolveInput = panel.querySelector("#mage-tuntun-captcha-auto-solve");
    const captchaTestSoundButton = panel.querySelector("#mage-tuntun-captcha-test-sound");
    const gmNameInput = panel.querySelector("#mage-tuntun-gm-name-input");
    const gmNameAddButton = panel.querySelector("#mage-tuntun-gm-name-add");
    const gmFirstReplyInput = panel.querySelector("#mage-tuntun-gm-first-reply-input");
    const gmFirstReplyAddButton = panel.querySelector("#mage-tuntun-gm-first-reply-add");
    const gmSecondReplyInput = panel.querySelector("#mage-tuntun-gm-second-reply-input");
    const gmSecondReplyAddButton = panel.querySelector("#mage-tuntun-gm-second-reply-add");
    const gmCooldownInput = panel.querySelector("#mage-tuntun-gm-cooldown-min");
    const panicUnknownInput = panel.querySelector("#mage-tuntun-panic-unknown");
    const panicHealthInput = panel.querySelector("#mage-tuntun-panic-health");
    const panicReturnInput = panel.querySelector("#mage-tuntun-panic-return");
    const playerAppearAlertInput = panel.querySelector("#mage-tuntun-player-appear-alert");
    const npcPauseAutomationInput = panel.querySelector("#mage-tuntun-npc-pause-automation");
    const playerChatAlertInput = panel.querySelector("#mage-tuntun-player-chat-alert");
    const panicTrustedInput = panel.querySelector("#mage-tuntun-panic-trusted-input");
    const panicTrustedAddButton = panel.querySelector("#mage-tuntun-panic-trusted-add");
    const xrayOverlayButton = panel.querySelector("#mage-tuntun-xray-overlay-toggle");
    const xrayFloorSelect = panel.querySelector("#mage-tuntun-xray-floor-select");
    const collapseButton = panel.querySelector("#mage-tuntun-collapse");
    const reloadButton = panel.querySelector("#mage-tuntun-reload");
    const caveRecordButton = panel.querySelector("#mage-tuntun-cave-record");
    const caveRemoveLastButton = panel.querySelector("#mage-tuntun-cave-remove-last");
    const caveStartButton = panel.querySelector("#mage-tuntun-cave-start");
    const caveStopButton = panel.querySelector("#mage-tuntun-cave-stop");
    const cavePresetSelect = panel.querySelector("#mage-tuntun-cave-preset-select");
    const cavePresetNewButton = panel.querySelector("#mage-tuntun-cave-preset-new");
    const cavePresetDeleteButton = panel.querySelector("#mage-tuntun-cave-preset-delete");
    const caveUnexpectedMonsterAlertInput = panel.querySelector("#mage-tuntun-cave-unexpected-monster-alert");
    const caveAllowedMonstersInput = panel.querySelector("#mage-tuntun-cave-allowed-monsters");
    const caveRareItemsInput = panel.querySelector("#mage-tuntun-cave-rare-items");
    const caveRareItemRarityInput = panel.querySelector("#mage-tuntun-cave-rare-item-rarity");
    const caveRareItemSoundInput = panel.querySelector("#mage-tuntun-cave-rare-item-sound");
    const caveRareItemPauseInput = panel.querySelector("#mage-tuntun-cave-rare-item-pause");

    if (collapseButton) {
      collapseButton.addEventListener("click", () => {
        const isCollapsed = panel.dataset.collapsed === "true";
        setPanelCollapsed(panel, !isCollapsed);
      });
    }

    if (reloadButton) {
      reloadButton.addEventListener("click", () => {
        window.mageTuntunReload?.();
      });
    }

    function rebootWithProfile(changeProfile) {
      // Stop and persist the currently active profile before changing the
      // storage target; otherwise module shutdown could write into the new one.
      bot.destroy?.();
      window.mageTuntun = null;
      if (changeProfile?.() === false) {
        window.mageTuntunReload?.();
        return;
      }
      window.mageTuntunReload?.();
    }

    if (profileSelect) {
      profileSelect.addEventListener("change", () => {
        const selected = profileSelect.value;
        rebootWithProfile(() => selected === "__character__"
          ? bot.useCharacterProfile?.()
          : bot.selectProfile?.(selected));
      });
    }

    if (newProfileButton) {
      newProfileButton.addEventListener("click", () => {
        const name = window.prompt("Profile name (for example Mage or Paladin):");
        if (!name?.trim()) return;
        rebootWithProfile(() => bot.createProfile?.(name));
      });
    }

    if (characterProfileButton) {
      characterProfileButton.addEventListener("click", () => {
        rebootWithProfile(() => bot.useCharacterProfile?.());
      });
    }

    function addTrustedName() {
      const rawName = panicTrustedInput?.value?.trim() || "";
      if (!rawName) {
        return;
      }

      const currentNames = bot.panic?.config?.trustedNames || [];
      const exists = currentNames.some(
        (name) => String(name).trim().toLowerCase() === rawName.toLowerCase()
      );

      if (!exists) {
        bot.panic.updateConfig({ trustedNames: [...currentNames, rawName] });
      }

      if (panicTrustedInput) {
        panicTrustedInput.value = "";
      }

      renderTrustedNames();
    }

    function addGmStaffName() {
      const rawName = gmNameInput?.value?.trim() || "";
      if (!rawName) return;
      const current = bot.gm?.config?.staffNames || [];
      if (!current.some((n) => n.toLowerCase() === rawName.toLowerCase())) {
        bot.gm?.updateConfig({ staffNames: [...current, rawName] });
        renderGmStaffNames();
      }
      if (gmNameInput) gmNameInput.value = "";
    }

    function addGmFirstReply() {
      const rawMsg = gmFirstReplyInput?.value?.trim() || "";
      if (!rawMsg) return;
      const current = bot.gm?.config?.firstReplies || [];
      bot.gm?.updateConfig({ firstReplies: [...current, rawMsg] });
      renderGmFirstReplies();
      if (gmFirstReplyInput) gmFirstReplyInput.value = "";
    }

    function addGmSecondReply() {
      const rawMsg = gmSecondReplyInput?.value?.trim() || "";
      if (!rawMsg) return;
      const current = bot.gm?.config?.secondReplies || [];
      bot.gm?.updateConfig({ secondReplies: [...current, rawMsg] });
      renderGmSecondReplies();
      if (gmSecondReplyInput) gmSecondReplyInput.value = "";
    }

    if (gmNameAddButton) gmNameAddButton.addEventListener("click", addGmStaffName);
    if (gmNameInput) {
      gmNameInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          addGmStaffName();
        }
      });
    }

    if (gmFirstReplyAddButton) gmFirstReplyAddButton.addEventListener("click", addGmFirstReply);
    if (gmFirstReplyInput) {
      gmFirstReplyInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          addGmFirstReply();
        }
      });
    }

    if (gmSecondReplyAddButton) gmSecondReplyAddButton.addEventListener("click", addGmSecondReply);
    if (gmSecondReplyInput) {
      gmSecondReplyInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          addGmSecondReply();
        }
      });
    }

    if (gmEnabledInput) {
      gmEnabledInput.addEventListener("change", () => {
        if (gmEnabledInput.checked) {
          bot.gm?.start();
        } else {
          bot.gm?.stop();
        }
        refreshGmStatus();
      });
    }

    if (gmPauseHuntingInput) {
      gmPauseHuntingInput.addEventListener("change", () => {
        bot.gm?.updateConfig({ pauseHuntingOnGm: gmPauseHuntingInput.checked });
      });
    }

    if (gmIgnorePzInput) {
      gmIgnorePzInput.addEventListener("change", () => {
        bot.gm?.updateConfig({ ignoreGmInPz: gmIgnorePzInput.checked });
      });
    }

    if (gmReactNameInput) {
      gmReactNameInput.addEventListener("change", () => {
        bot.gm?.updateConfig({ reactOnNameMention: gmReactNameInput.checked });
      });
    }

    if (gmReactChatInput) {
      gmReactChatInput.addEventListener("change", () => {
        bot.gm?.updateConfig({ reactOnGmChat: gmReactChatInput.checked });
      });
    }

    if (gmAutoRepliesInput) {
      gmAutoRepliesInput.addEventListener("change", () => {
        bot.gm?.updateConfig({ autoRepliesEnabled: gmAutoRepliesInput.checked });
      });
    }

    if (gmSoundInput) {
      gmSoundInput.addEventListener("change", () => {
        bot.gm?.updateConfig({ soundOnGm: gmSoundInput.checked });
      });
    }

    if (captchaEnabledInput) {
      captchaEnabledInput.addEventListener("change", () => {
        bot.gm?.updateConfig({ captchaWatcherEnabled: captchaEnabledInput.checked });
      });
    }

    if (captchaSoundInput) {
      captchaSoundInput.addEventListener("change", () => {
        bot.gm?.updateConfig({ soundOnCaptcha: captchaSoundInput.checked });
      });
    }

    if (captchaTestSoundButton) {
      captchaTestSoundButton.addEventListener("click", () => {
        bot.playCaptchaAlarm?.(false);
      });
    }

    if (captchaAutoSolveInput) {
      captchaAutoSolveInput.addEventListener("change", () => {
        bot.gm?.updateConfig({ captchaAutoSolveEnabled: captchaAutoSolveInput.checked });
      });
    }

    if (gmCooldownInput) {
      gmCooldownInput.addEventListener("change", () => {
        const val = Math.max(1, Number(gmCooldownInput.value) || 10);
        bot.gm?.updateConfig({ dontReactAgainMs: val * 60 * 1000 });
      });
    }

    if (panicTrustedAddButton) {
      panicTrustedAddButton.addEventListener("click", addTrustedName);
    }

    if (panicTrustedInput) {
      panicTrustedInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          addTrustedName();
        }
      });
    }

    if (spellInput) {
      spellInput.value = bot.rune?.config?.runeSpellWords || "";
      spellInput.addEventListener("change", () => {
        bot.rune.updateConfig({ runeSpellWords: spellInput.value.trim() });
      });
    }

    if (manaInput) {
      manaInput.value = String(bot.rune?.config?.runeManaCost ?? 0);
      manaInput.addEventListener("change", () => {
        const runeManaCost = Math.max(0, Number(manaInput.value) || 0);
        manaInput.value = String(runeManaCost);
        bot.rune.updateConfig({ runeManaCost });
      });
    }

    if (runeCastsPerMinuteInput) {
      runeCastsPerMinuteInput.value = String(bot.rune?.config?.castsPerMinute ?? 15);
      runeCastsPerMinuteInput.addEventListener("change", () => {
        const castsPerMinute = Math.max(1, Number(runeCastsPerMinuteInput.value) || 1);
        runeCastsPerMinuteInput.value = String(castsPerMinute);
        bot.rune.updateConfig({ castsPerMinute });
      });
    }

    if (runeActiveMinutesInput) {
      runeActiveMinutesInput.value = String(bot.rune?.config?.activeMinutes ?? 0);
      runeActiveMinutesInput.addEventListener("change", () => {
        const activeMinutes = Math.max(0, Number(runeActiveMinutesInput.value) || 0);
        runeActiveMinutesInput.value = String(activeMinutes);
        bot.rune.updateConfig({ activeMinutes });
      });
    }

    if (runePauseMinutesInput) {
      runePauseMinutesInput.value = String(bot.rune?.config?.pauseMinutes ?? 0);
      runePauseMinutesInput.addEventListener("change", () => {
        const pauseMinutes = Math.max(0, Number(runePauseMinutesInput.value) || 0);
        runePauseMinutesInput.value = String(pauseMinutes);
        bot.rune.updateConfig({ pauseMinutes });
      });
    }

    if (runeEnabledInput) {
      runeEnabledInput.checked = !!bot.rune?.status?.().running;
      runeEnabledInput.addEventListener("change", () => {
        const runeSpellWords = spellInput?.value?.trim() || bot.rune.config.runeSpellWords;
        const runeManaCost = Math.max(0, Number(manaInput?.value) || bot.rune.config.runeManaCost || 0);
        const castsPerMinute = Math.max(1, Number(runeCastsPerMinuteInput?.value) || bot.rune.config.castsPerMinute || 15);
        const activeMinutes = Math.max(0, Number(runeActiveMinutesInput?.value) || bot.rune.config.activeMinutes || 0);
        const pauseMinutes = Math.max(0, Number(runePauseMinutesInput?.value) || bot.rune.config.pauseMinutes || 0);

        if (runeEnabledInput.checked) {
          bot.rune.start({ runeSpellWords, runeManaCost, castsPerMinute, activeMinutes, pauseMinutes });
        } else {
          bot.rune.stop();
        }

        refreshRuneStatus();
      });
    }

    if (autoEatHotkeyInput) {
      autoEatHotkeyInput.value = String(bot.eat?.config?.eatHotbarSlot ?? 10);
      autoEatHotkeyInput.addEventListener("change", () => {
        const eatHotbarSlot = Math.min(12, Math.max(1, Number(autoEatHotkeyInput.value) || 1));
        autoEatHotkeyInput.value = String(eatHotbarSlot);
        bot.eat.updateConfig({ eatHotbarSlot });
      });
    }

    if (autoEatModeInput) {
      autoEatModeInput.value = bot.eat?.config?.eatMode === "interval" ? "interval" : "whenHungry";
      autoEatModeInput.addEventListener("change", () => {
        bot.eat.updateConfig({ eatMode: autoEatModeInput.value });
      });
    }

    if (autoEatCooldownInput) {
      autoEatCooldownInput.value = String(bot.eat?.config?.eatCooldownMs ?? 60000);
      autoEatCooldownInput.addEventListener("change", () => {
        const eatCooldownMs = Math.max(1000, Number(autoEatCooldownInput.value) || 1000);
        autoEatCooldownInput.value = String(eatCooldownMs);
        bot.eat.updateConfig({ eatCooldownMs });
      });
    }

    if (autoEatEnabledInput) {
      autoEatEnabledInput.checked = !!bot.eat?.status?.().running;
      autoEatEnabledInput.addEventListener("change", () => {
        const eatHotbarSlot = Math.min(
          12,
          Math.max(1, Number(autoEatHotkeyInput?.value) || bot.eat.config.eatHotbarSlot || 1)
        );

        if (autoEatEnabledInput.checked) {
          bot.eat.start({ eatHotbarSlot });
        } else {
          bot.eat.stop();
        }

        refreshAutoEatStatus();
      });
    }

    if (autoHasteSpellInput) {
      autoHasteSpellInput.value = bot.haste?.config?.spellWords || "utani hur";
      autoHasteSpellInput.addEventListener("change", () => {
        bot.haste.updateConfig({ spellWords: autoHasteSpellInput.value.trim() });
      });
    }

    if (autoHasteCooldownInput) {
      autoHasteCooldownInput.value = String(bot.haste?.config?.recastCooldownMs ?? 2000);
      autoHasteCooldownInput.addEventListener("change", () => {
        const recastCooldownMs = Math.max(1000, Number(autoHasteCooldownInput.value) || 1000);
        autoHasteCooldownInput.value = String(recastCooldownMs);
        bot.haste.updateConfig({ recastCooldownMs });
      });
    }

    if (autoHasteEnabledInput) {
      autoHasteEnabledInput.checked = !!bot.haste?.status?.().running;
      autoHasteEnabledInput.addEventListener("change", () => {
        if (autoHasteEnabledInput.checked) {
          bot.haste.start({
            spellWords: autoHasteSpellInput?.value?.trim() || bot.haste.config.spellWords,
            recastCooldownMs: Math.max(1000, Number(autoHasteCooldownInput?.value) || bot.haste.config.recastCooldownMs || 1000),
          });
        } else {
          bot.haste.stop();
        }

        refreshAutoHasteStatus();
      });
    }

    if (autoInvisibleEnabledInput) {
      autoInvisibleEnabledInput.checked = !!bot.invisible?.status?.().running;
      autoInvisibleEnabledInput.addEventListener("change", () => {
        if (autoInvisibleEnabledInput.checked) {
          bot.invisible.start();
        } else {
          bot.invisible.stop();
        }

        refreshAutoInvisibleStatus();
      });
    }

    if (autoMagicShieldEnabledInput) {
      autoMagicShieldEnabledInput.checked = !!bot.magicShield?.status?.().running;
      autoMagicShieldEnabledInput.addEventListener("change", () => {
        if (autoMagicShieldEnabledInput.checked) {
          bot.magicShield.start();
        } else {
          bot.magicShield.stop();
        }

        refreshAutoMagicShieldStatus();
      });
    }

    if (equipRingEnabledInput) {
      equipRingEnabledInput.checked = !!bot.equipRing?.status?.().running;
      equipRingEnabledInput.addEventListener("change", () => {
        if (equipRingEnabledInput.checked) {
          bot.equipRing.start();
        } else {
          bot.equipRing.stop();
        }

        refreshEquipRingStatus();
      });
    }

    if (caveUnexpectedMonsterAlertInput) {
      caveUnexpectedMonsterAlertInput.checked = bot.cave?.config?.unexpectedMonsterAlertEnabled !== false;
      caveUnexpectedMonsterAlertInput.addEventListener("change", () => {
        bot.cave.updateConfig({
          unexpectedMonsterAlertEnabled: caveUnexpectedMonsterAlertInput.checked,
        });
      });
    }

    if (caveAllowedMonstersInput) {
      caveAllowedMonstersInput.value = (bot.cave?.getAllowedMonsters?.() || []).join(", ");
      caveAllowedMonstersInput.addEventListener("change", () => {
        bot.cave.setAllowedMonsters(caveAllowedMonstersInput.value);
        caveAllowedMonstersInput.value = (bot.cave?.getAllowedMonsters?.() || []).join(", ");
      });
    }

    if (caveRareItemsInput) {
      caveRareItemsInput.value = (bot.cave?.config?.rareItemNames || []).join(", ");
      caveRareItemsInput.addEventListener("change", () => {
        bot.cave.updateConfig({ rareItemNames: caveRareItemsInput.value });
        caveRareItemsInput.value = (bot.cave?.config?.rareItemNames || []).join(", ");
      });
    }

    if (caveRareItemRarityInput) {
      caveRareItemRarityInput.checked = bot.cave?.config?.rareItemDetectByRarity !== false;
      caveRareItemRarityInput.addEventListener("change", () => {
        bot.cave.updateConfig({ rareItemDetectByRarity: caveRareItemRarityInput.checked });
      });
    }

    if (caveRareItemSoundInput) {
      caveRareItemSoundInput.checked = bot.cave?.config?.rareItemAlertEnabled !== false;
      caveRareItemSoundInput.addEventListener("change", () => {
        bot.cave.updateConfig({ rareItemAlertEnabled: caveRareItemSoundInput.checked });
      });
    }

    if (caveRareItemPauseInput) {
      caveRareItemPauseInput.checked = bot.cave?.config?.rareItemPauseCavebot !== false;
      caveRareItemPauseInput.addEventListener("change", () => {
        bot.cave.updateConfig({ rareItemPauseCavebot: caveRareItemPauseInput.checked });
      });
    }

    if (caveRecordButton) {
      caveRecordButton.addEventListener("click", () => {
        bot.cave.addWaypointCurrentSpot();
        refreshCavePresetControls();
        refreshCaveClosestStatus();
        refreshCaveTransitionStatus();
      });
    }

    if (caveRemoveLastButton) {
      caveRemoveLastButton.addEventListener("click", () => {
        bot.cave.removeLastWaypoint();
        refreshCavePresetControls();
        refreshCaveStatus();
        refreshCaveClosestStatus();
        refreshCaveTransitionStatus();
      });
    }

    if (caveStartButton) {
      caveStartButton.addEventListener("click", () => {
        bot.cave.start();
        refreshCavePresetControls();
        refreshCaveStatus();
        refreshCaveClosestStatus();
        refreshCaveTransitionStatus();
      });
    }

    if (caveStopButton) {
      caveStopButton.addEventListener("click", () => {
        bot.cave.stop();
        refreshCavePresetControls();
        refreshCaveStatus();
        refreshCaveClosestStatus();
        refreshCaveTransitionStatus();
      });
    }

    if (cavePresetSelect) {
      cavePresetSelect.addEventListener("change", () => {
        const name = cavePresetSelect.value || "";
        const activePresetName = bot.cave?.getActivePresetName?.() || "";
        if (!name || name === activePresetName) {
          refreshCavePresetControls();
          return;
        }

        const loadedPreset = bot.cave.loadPreset(name);
        refreshCavePresetControls();
        refreshCaveStatus();
        refreshCaveClosestStatus();
        refreshCaveTransitionStatus();
      });
    }

    if (cavePresetNewButton) {
      cavePresetNewButton.addEventListener("click", () => {
        const name = window.prompt("Name the new cave preset:");
        if (name == null) {
          return;
        }

        const createdPreset = bot.cave.createPreset(name);
        if (!createdPreset) {
          return;
        }

        refreshCavePresetControls();
        refreshCaveStatus();
        refreshCaveClosestStatus();
        refreshCaveTransitionStatus();
      });
    }

    if (cavePresetDeleteButton) {
      cavePresetDeleteButton.addEventListener("click", () => {
        const name = cavePresetSelect?.value || "";
        if (!name) {
          return;
        }

        const deleted = bot.cave.deletePreset(name);
        if (!deleted) {
          return;
        }

        refreshCavePresetControls();
        refreshCaveStatus();
        refreshCaveClosestStatus();
        refreshCaveTransitionStatus();
      });
    }

    if (autoHealMinHpPercentInput) {
      autoHealMinHpPercentInput.value = String(bot.heal?.config?.minHpPercent ?? 80);
      autoHealMinHpPercentInput.addEventListener("change", () => {
        const minHpPercent = Math.min(100, Math.max(1, Number(autoHealMinHpPercentInput.value) || 1));
        autoHealMinHpPercentInput.value = String(minHpPercent);
        bot.heal.updateConfig({ minHpPercent });
      });
    }

    if (autoHealHpHotkeyInput) {
      autoHealHpHotkeyInput.value = String(bot.heal?.config?.hpHotbarSlot ?? 8);
      autoHealHpHotkeyInput.addEventListener("change", () => {
        const hpHotbarSlot = Math.min(12, Math.max(1, Number(autoHealHpHotkeyInput.value) || 1));
        autoHealHpHotkeyInput.value = String(hpHotbarSlot);
        bot.heal.updateConfig({ hpHotbarSlot });
      });
    }

    if (autoHealMinManaPercentInput) {
      autoHealMinManaPercentInput.value = String(bot.heal?.config?.minManaPercent ?? 30);
      autoHealMinManaPercentInput.addEventListener("change", () => {
        const minManaPercent = Math.min(100, Math.max(1, Number(autoHealMinManaPercentInput.value) || 1));
        autoHealMinManaPercentInput.value = String(minManaPercent);
        bot.heal.updateConfig({ minManaPercent });
      });
    }

    if (autoHealManaHotkeyInput) {
      autoHealManaHotkeyInput.value = String(bot.heal?.config?.manaHotbarSlot ?? 4);
      autoHealManaHotkeyInput.addEventListener("change", () => {
        const manaHotbarSlot = Math.min(12, Math.max(1, Number(autoHealManaHotkeyInput.value) || 1));
        autoHealManaHotkeyInput.value = String(manaHotbarSlot);
        bot.heal.updateConfig({ manaHotbarSlot });
      });
    }

    if (autoHealHpCooldownInput) {
      autoHealHpCooldownInput.value = String(bot.heal?.config?.hpHealCooldownMs ?? 1800);
      autoHealHpCooldownInput.addEventListener("change", () => {
        const hpHealCooldownMs = Math.max(1000, Number(autoHealHpCooldownInput.value) || 1000);
        autoHealHpCooldownInput.value = String(hpHealCooldownMs);
        bot.heal.updateConfig({ hpHealCooldownMs });
      });
    }

    if (autoHealManaCooldownInput) {
      autoHealManaCooldownInput.value = String(bot.heal?.config?.manaHealCooldownMs ?? 1000);
      autoHealManaCooldownInput.addEventListener("change", () => {
        const manaHealCooldownMs = Math.max(1000, Number(autoHealManaCooldownInput.value) || 1000);
        autoHealManaCooldownInput.value = String(manaHealCooldownMs);
        bot.heal.updateConfig({ manaHealCooldownMs });
      });
    }

    if (autoHealParalyzeHotkeyInput) {
      autoHealParalyzeHotkeyInput.value = bot.heal?.config?.paralyzeHotbarSlot
        ? String(bot.heal.config.paralyzeHotbarSlot)
        : "";
      autoHealParalyzeHotkeyInput.addEventListener("change", () => {
        const slot = Number(autoHealParalyzeHotkeyInput.value);
        const paralyzeHotbarSlot = Number.isFinite(slot) && slot >= 1 && slot <= 12
          ? Math.trunc(slot)
          : null;
        autoHealParalyzeHotkeyInput.value = paralyzeHotbarSlot ? String(paralyzeHotbarSlot) : "";
        bot.heal.updateConfig({ paralyzeHotbarSlot });
        if (autoHealParalyzeEnabledInput) {
          autoHealParalyzeEnabledInput.checked = !!paralyzeHotbarSlot;
        }
      });
    }

    if (autoHealParalyzeEnabledInput) {
      autoHealParalyzeEnabledInput.checked = !!bot.heal?.config?.paralyzeHotbarSlot;
      autoHealParalyzeEnabledInput.addEventListener("change", () => {
        const slot = Number(autoHealParalyzeHotkeyInput?.value);
        const paralyzeHotbarSlot = autoHealParalyzeEnabledInput.checked && Number.isFinite(slot) && slot >= 1 && slot <= 12
          ? Math.trunc(slot)
          : null;
        bot.heal.updateConfig({ paralyzeHotbarSlot });
        if (!paralyzeHotbarSlot) {
          autoHealParalyzeEnabledInput.checked = false;
        }
      });
    }

    if (autoHealEnabledInput) {
      autoHealEnabledInput.checked = !!bot.heal?.status?.().running;
      autoHealEnabledInput.addEventListener("change", () => {
        const minHpPercent = Math.min(100, Math.max(1, Number(autoHealMinHpPercentInput?.value) || bot.heal.config.minHpPercent || 80));
        const hpHotbarSlot = Math.min(
          12,
          Math.max(1, Number(autoHealHpHotkeyInput?.value) || bot.heal.config.hpHotbarSlot || 8)
        );
        const minManaPercent = Math.min(100, Math.max(1, Number(autoHealMinManaPercentInput?.value) || bot.heal.config.minManaPercent || 30));
        const hpHealCooldownMs = Math.max(1000, Number(autoHealHpCooldownInput?.value) || bot.heal.config.hpHealCooldownMs || 1800);
        const manaHealCooldownMs = Math.max(1000, Number(autoHealManaCooldownInput?.value) || bot.heal.config.manaHealCooldownMs || 1000);
        const manaHotbarSlot = Math.min(
          12,
          Math.max(1, Number(autoHealManaHotkeyInput?.value) || bot.heal.config.manaHotbarSlot || 4)
        );
        const configuredParalyzeSlot = Number(autoHealParalyzeHotkeyInput?.value);
        const paralyzeHotbarSlot = autoHealParalyzeEnabledInput?.checked && Number.isFinite(configuredParalyzeSlot) && configuredParalyzeSlot >= 1 && configuredParalyzeSlot <= 12
          ? Math.trunc(configuredParalyzeSlot)
          : null;

        if (autoHealEnabledInput.checked) {
          bot.heal.start({ minHpPercent, hpHotbarSlot, minManaPercent, manaHotbarSlot, hpHealCooldownMs, manaHealCooldownMs, paralyzeHotbarSlot });
        } else {
          bot.heal.stop();
        }

        refreshAutoHealStatus();
      });
    }

    if (autoSioTargetInput) {
      autoSioTargetInput.value = bot.sio?.config?.targetName || "";
      autoSioTargetInput.addEventListener("change", () => bot.sio.updateConfig({ targetName: autoSioTargetInput.value }));
    }
    if (autoSioHpPercentInput) {
      autoSioHpPercentInput.value = String(bot.sio?.config?.minHpPercent ?? 50);
      autoSioHpPercentInput.addEventListener("change", () => {
        const minHpPercent = Math.min(100, Math.max(1, Number(autoSioHpPercentInput.value) || 1));
        autoSioHpPercentInput.value = String(minHpPercent);
        bot.sio.updateConfig({ minHpPercent });
      });
    }
    if (autoSioCooldownInput) {
      autoSioCooldownInput.value = String(bot.sio?.config?.cooldownMs ?? 2000);
      autoSioCooldownInput.addEventListener("change", () => {
        const cooldownMs = Math.max(1000, Number(autoSioCooldownInput.value) || 1000);
        autoSioCooldownInput.value = String(cooldownMs);
        bot.sio.updateConfig({ cooldownMs });
      });
    }
    if (autoSioSpellInput) {
      autoSioSpellInput.value = bot.sio?.config?.spellWords || "exura sio";
      autoSioSpellInput.addEventListener("change", () => bot.sio.updateConfig({ spellWords: autoSioSpellInput.value }));
    }
    if (autoSioEnabledInput) {
      autoSioEnabledInput.checked = !!bot.sio?.status?.().running;
      autoSioEnabledInput.addEventListener("change", () => {
        if (autoSioEnabledInput.checked) {
          bot.sio.start({
            targetName: autoSioTargetInput?.value || "",
            minHpPercent: Math.min(100, Math.max(1, Number(autoSioHpPercentInput?.value) || 50)),
            cooldownMs: Math.max(1000, Number(autoSioCooldownInput?.value) || bot.sio.config.cooldownMs || 1000),
            spellWords: autoSioSpellInput?.value || "exura sio",
          });
        } else {
          bot.sio.stop();
        }
      });
    }

    if (autoAttackHotkeyInput) {
      autoAttackHotkeyInput.value = String(bot.attack?.config?.targetHotbarSlot ?? 3);
      autoAttackHotkeyInput.addEventListener("change", () => {
        const targetHotbarSlot = Math.min(12, Math.max(1, Number(autoAttackHotkeyInput.value) || 1));
        autoAttackHotkeyInput.value = String(targetHotbarSlot);
        bot.attack.updateConfig({ targetHotbarSlot });
      });
    }

    if (autoAttackRuneHotkeyInput) {
      autoAttackRuneHotkeyInput.value = bot.attack?.config?.runeHotbarSlot
        ? String(bot.attack.config.runeHotbarSlot)
        : "";
      autoAttackRuneHotkeyInput.addEventListener("change", () => {
        const rawValue = Number(autoAttackRuneHotkeyInput.value);
        const runeHotbarSlot = Number.isFinite(rawValue) && rawValue >= 1 && rawValue <= 12
          ? Math.trunc(rawValue)
          : null;
        autoAttackRuneHotkeyInput.value = runeHotbarSlot ? String(runeHotbarSlot) : "";
        bot.attack.updateConfig({ runeHotbarSlot });
      });
    }

    if (autoAttackRuneCooldownInput) {
      autoAttackRuneCooldownInput.value = String(bot.attack?.config?.runeCooldownMs ?? 2000);
      autoAttackRuneCooldownInput.addEventListener("change", () => {
        const runeCooldownMs = Math.max(1000, Number(autoAttackRuneCooldownInput.value) || 1000);
        autoAttackRuneCooldownInput.value = String(runeCooldownMs);
        bot.attack.updateConfig({ runeCooldownMs });
      });
    }

    if (autoAttackMeleeInput) {
      autoAttackMeleeInput.checked = bot.attack?.config?.meleeMode !== false;
      autoAttackMeleeInput.addEventListener("change", () => {
        bot.attack.updateConfig({ meleeMode: autoAttackMeleeInput.checked });
      });
    }

    if (autoAttackMovementInput) {
      autoAttackMovementInput.checked = bot.attack?.config?.combatMovement === "kite";
      autoAttackMovementInput.addEventListener("change", () => {
        bot.attack.updateConfig({ combatMovement: autoAttackMovementInput.checked ? "kite" : "auto" });
      });
    }

    if (autoAttackKiteRetreatRouteInput) {
      autoAttackKiteRetreatRouteInput.checked = bot.attack?.config?.kiteRetreatToRoute !== false;
      autoAttackKiteRetreatRouteInput.addEventListener("change", () => {
        bot.attack.updateConfig({ kiteRetreatToRoute: autoAttackKiteRetreatRouteInput.checked });
      });
    }

    if (autoAttackIgnoreSummonsInput) {
      autoAttackIgnoreSummonsInput.checked = bot.attack?.config?.ignoreSummons !== false;
      autoAttackIgnoreSummonsInput.addEventListener("change", () => {
        bot.attack.updateConfig({ ignoreSummons: autoAttackIgnoreSummonsInput.checked });
      });
    }

    if (autoAttackPriorityMonstersInput) {
      autoAttackPriorityMonstersInput.value = (bot.attack?.config?.priorityMonsterNames || []).join(", ");
      autoAttackPriorityMonstersInput.addEventListener("change", () => {
        bot.attack.updateConfig({ priorityMonsterNames: autoAttackPriorityMonstersInput.value });
        autoAttackPriorityMonstersInput.value = (bot.attack?.config?.priorityMonsterNames || []).join(", ");
      });
    }

    if (autoAttackIgnoreMonstersInput) {
      autoAttackIgnoreMonstersInput.value = (bot.attack?.config?.ignoredMonsterNames || []).join(", ");
      autoAttackIgnoreMonstersInput.addEventListener("change", () => {
        bot.attack.updateConfig({ ignoredMonsterNames: autoAttackIgnoreMonstersInput.value });
        autoAttackIgnoreMonstersInput.value = (bot.attack?.config?.ignoredMonsterNames || []).join(", ");
      });
    }

    function updateKiteDistance() {
      const kiteMinDistance = Math.max(1, Number(autoAttackKiteMinDistanceInput?.value) || bot.attack.config.kiteMinDistance || 3);
      const kiteMaxDistance = Math.max(kiteMinDistance, Number(autoAttackKiteMaxDistanceInput?.value) || bot.attack.config.kiteMaxDistance || 5);
      if (autoAttackKiteMinDistanceInput) autoAttackKiteMinDistanceInput.value = String(kiteMinDistance);
      if (autoAttackKiteMaxDistanceInput) autoAttackKiteMaxDistanceInput.value = String(kiteMaxDistance);
      bot.attack.updateConfig({ kiteMinDistance, kiteMaxDistance });
    }

    if (autoAttackKiteMinDistanceInput) {
      autoAttackKiteMinDistanceInput.value = String(bot.attack?.config?.kiteMinDistance ?? 3);
      autoAttackKiteMinDistanceInput.addEventListener("change", updateKiteDistance);
    }

    if (autoAttackKiteMaxDistanceInput) {
      autoAttackKiteMaxDistanceInput.value = String(bot.attack?.config?.kiteMaxDistance ?? 5);
      autoAttackKiteMaxDistanceInput.addEventListener("change", updateKiteDistance);
    }

    if (autoAttackEnabledInput) {
      autoAttackEnabledInput.checked = !!bot.attack?.status?.().running;
      autoAttackEnabledInput.addEventListener("change", () => {
        const targetHotbarSlot = Math.min(
          12,
          Math.max(1, Number(autoAttackHotkeyInput?.value) || bot.attack.config.targetHotbarSlot || 1)
        );
        const runeHotbarSlot = (() => {
          const rawValue = Number(autoAttackRuneHotkeyInput?.value);
          if (Number.isFinite(rawValue) && rawValue >= 1 && rawValue <= 12) {
            return Math.trunc(rawValue);
          }

          return bot.attack.config.runeHotbarSlot ?? null;
        })();
        const meleeMode = !!autoAttackMeleeInput?.checked;
        const combatMovement = autoAttackMovementInput?.checked ? "kite" : "auto";
        const runeCooldownMs = Math.max(
          1000,
          Number(autoAttackRuneCooldownInput?.value) || bot.attack.config.runeCooldownMs || 2000
        );

        if (autoAttackEnabledInput.checked) {
          bot.attack.start({ targetHotbarSlot, runeHotbarSlot, meleeMode, combatMovement, runeCooldownMs });
        } else {
          bot.attack.stop();
        }

        refreshAutoAttackStatus();
      });
    }

    if (talkApiKeyInput) {
      talkApiKeyInput.value = bot.talk?.config?.apiKey || "";
      talkApiKeyInput.addEventListener("change", () => {
        bot.talk.updateConfig({ apiKey: talkApiKeyInput.value.trim() });
        refreshTalkStatus();
      });
    }

    if (talkPromptInput) {
      talkPromptInput.value = bot.talk?.config?.systemPrompt || "";
      talkPromptInput.addEventListener("change", () => {
        bot.talk.updateConfig({ systemPrompt: talkPromptInput.value.trim() });
      });
    }

    if (talkEnabledInput) {
      talkEnabledInput.checked = !!bot.talk?.status?.().running;
      talkEnabledInput.addEventListener("change", () => {
        if (talkEnabledInput.checked) {
          bot.talk.updateConfig({
            apiKey: talkApiKeyInput?.value?.trim() || "",
            systemPrompt: talkPromptInput?.value?.trim() || bot.talk.config.systemPrompt || "",
          });
          const started = bot.talk.start();
          if (!started) {
            talkEnabledInput.checked = false;
          }
        } else {
          bot.talk.stop();
        }

        refreshTalkStatus();
      });
    }

    if (panicUnknownInput) {
      panicUnknownInput.checked = !!bot.panic?.status?.().config?.unknownPlayerEnabled;
      panicUnknownInput.addEventListener("change", () => {
        bot.panic.updateConfig({ unknownPlayerEnabled: panicUnknownInput.checked });
        refreshPanicStatus();
      });
    }

    if (panicHealthInput) {
      panicHealthInput.checked = !!bot.panic?.status?.().config?.healthLossEnabled;
      panicHealthInput.addEventListener("change", () => {
        bot.panic.updateConfig({ healthLossEnabled: panicHealthInput.checked });
        refreshPanicStatus();
      });
    }

    if (panicReturnInput) {
      panicReturnInput.checked = !!bot.panic?.status?.().config?.returnToOriginEnabled;
      panicReturnInput.addEventListener("change", () => {
        bot.panic.updateConfig({ returnToOriginEnabled: panicReturnInput.checked });
        refreshPanicStatus();
      });
    }

    if (playerAppearAlertInput) {
      playerAppearAlertInput.checked = !!bot.panic?.status?.().config?.playerAppearAlertEnabled;
      playerAppearAlertInput.addEventListener("change", () => {
        bot.panic.updateConfig({ playerAppearAlertEnabled: playerAppearAlertInput.checked });
        refreshPanicStatus();
      });
    }

    if (npcPauseAutomationInput) {
      npcPauseAutomationInput.checked = !!bot.panic?.status?.().config?.npcPauseAutomationEnabled;
      npcPauseAutomationInput.addEventListener("change", () => {
        bot.panic.updateConfig({ npcPauseAutomationEnabled: npcPauseAutomationInput.checked });
        refreshPanicStatus();
      });
    }

    if (playerChatAlertInput) {
      playerChatAlertInput.checked = !!bot.panic?.status?.().config?.playerChatAlertEnabled;
      playerChatAlertInput.addEventListener("change", () => {
        bot.panic.updateConfig({ playerChatAlertEnabled: playerChatAlertInput.checked });
        refreshPanicStatus();
      });
    }

    if (xrayOverlayButton) {
      xrayOverlayButton.addEventListener("click", () => {
        const enabled = !!bot.xray?.status?.().config?.overlayEnabled;
        bot.xray?.setOverlayEnabled?.(!enabled);
        refreshXrayStatus();
      });
    }

    if (xrayFloorSelect) {
      xrayFloorSelect.addEventListener("change", () => {
        const rawValue = xrayFloorSelect.value;
        bot.xray?.setSelectedFloor?.(rawValue === "all" ? null : Number(rawValue));
        refreshXrayStatus();
        refreshVisibleCreatures();
      });
    }

    panel.querySelector("#mage-tuntun-set-home")?.addEventListener("click", () => {
      bot.pz.setHomePzCurrentSpot();
      refreshHomeLabel();
    });

    refreshHomeLabel();
    refreshProfileLabel();
    refreshPanicStatus();
    refreshXrayStatus();
    renderGmStaffNames();
    renderGmFirstReplies();
    renderGmSecondReplies();
    refreshGmStatus();
    renderTrustedNames();
    refreshRuneStatus();
    refreshAutoHealStatus();
    refreshAutoInvisibleStatus();
    refreshAutoMagicShieldStatus();
    refreshAutoHasteStatus();
    refreshAutoAttackStatus();
    refreshAutoEatStatus();
    refreshCaveStatus();
    refreshEquipRingStatus();
    refreshTalkStatus();
    refreshVisibleCreatures();
    refreshCavePresetControls();
    refreshCaveClosestStatus();
    refreshCaveTransitionStatus();

    const gmStatusTimerId = window.setInterval(refreshGmStatus, 1000);
    bot.addCleanup(() => {
      window.clearInterval(gmStatusTimerId);
    });

    const profileTimerId = window.setInterval(refreshProfileLabel, 1000);
    bot.addCleanup(() => {
      window.clearInterval(profileTimerId);
    });

    const visibleCreaturesTimerId = window.setInterval(refreshVisibleCreatures, 1000);
    bot.addCleanup(() => {
      window.clearInterval(visibleCreaturesTimerId);
    });

    const talkStatusTimerId = window.setInterval(refreshTalkStatus, 1000);
    bot.addCleanup(() => {
      window.clearInterval(talkStatusTimerId);
    });

    const caveStatusTimerId = window.setInterval(() => {
      refreshCaveStatus();
      refreshCavePresetControls();
      refreshCaveClosestStatus();
      refreshCaveTransitionStatus();
    }, 1000);
    bot.addCleanup(() => {
      window.clearInterval(caveStatusTimerId);
    });

  }

  bot.ui = {
    inject,
    destroy,
    refreshHomeLabel,
    refreshProfileLabel,
    refreshPanicStatus,
    refreshXrayStatus,
    refreshGmStatus,
    renderGmStaffNames,
    renderGmFirstReplies,
    renderGmSecondReplies,
    refreshRuneStatus,
    refreshAutoHealStatus,
    refreshAutoInvisibleStatus,
    refreshAutoMagicShieldStatus,
    refreshAutoHasteStatus,
    refreshAutoAttackStatus,
    refreshAutoEatStatus,
    refreshCaveStatus,
    refreshCavePresetControls,
    refreshEquipRingStatus,
    refreshTalkStatus,
    refreshVisibleCreatures,
    refreshCaveClosestStatus,
    refreshCaveTransitionStatus,
    getSavedPanelPosition,
    getSavedPanelCollapsed,
    setPanelCollapsed: (collapsed) => {
      const panel = document.getElementById("mage-tuntun-panel");
      setPanelCollapsed(panel, collapsed);
    },
  };
};
(() => {
  const bundle = window.__mageTuntunBundle || window.__mageTuntunReloadBundle || {};

  function boot(currentBundle = bundle) {
    const previousBot = window.mageTuntun || window.minibiaBot;
    if (previousBot?.destroy) {
      previousBot.destroy();
    }

    const bot = currentBundle.createBot();

    currentBundle.installPzModule(bot);
    currentBundle.installXrayModule(bot);
    currentBundle.installPanicModule(bot);
    currentBundle.installRuneModule(bot);
    currentBundle.installHealModule(bot);
    currentBundle.installAutoSioModule(bot);
    currentBundle.installAutoInvisibleModule(bot);
    currentBundle.installAutoMagicShieldModule(bot);
    currentBundle.installAutoHasteModule(bot);
    currentBundle.installAutoAttackModule(bot);
    currentBundle.installCaveModule(bot);
    currentBundle.installEquipRingModule(bot);
    currentBundle.installAutoEatModule(bot);
    currentBundle.installTalkModule(bot);
    currentBundle.installGmModule(bot);
    currentBundle.installPanel(bot);

    bot.ui.inject();

    bot.start = (...args) => bot.rune.start(...args);
    bot.stop = (...args) => bot.rune.stop(...args);
    bot.reload = () => window.mageTuntunReload?.();
    bot.status = () => ({
      version: bot.version,
      pz: {
        home: bot.pz.getHomePz(),
      },
      xray: bot.xray.status(),
      panic: bot.panic.status(),
      rune: bot.rune.status(),
      heal: bot.heal.status(),
      sio: bot.sio.status(),
      invisible: bot.invisible.status(),
      magicShield: bot.magicShield.status(),
      haste: bot.haste.status(),
      attack: bot.attack.status(),
      cave: bot.cave.status(),
      equipRing: bot.equipRing.status(),
      eat: bot.eat.status(),
      talk: bot.talk.status(),
      gm: bot.gm.status(),
    });

    window.mageTuntun = bot;
    // Keep the pre-rename console API working for existing users and snippets.
    window.minibiaBot = bot;
    window.pzBot = bot.pz;

    // The game can finish loading the character after the bundle is injected.
    // Reboot once then, so every module reads that character's saved profile.
    if (!bot.getActiveProfileName?.()) {
      const profileWaitTimerId = window.setInterval(() => {
        if (!bot.getActiveProfileName?.()) return;
        window.clearInterval(profileWaitTimerId);
        window.mageTuntunReload?.();
      }, 500);
      bot.addCleanup(() => window.clearInterval(profileWaitTimerId));
    }

    console.log("[mage-tuntun] ready", {
      version: bot.version,
      modules: ["pz", "xray", "panic", "rune", "heal", "sio", "invisible", "magicShield", "haste", "attack", "cave", "equipRing", "eat", "talk", "gm", "ui"],
    });
    console.log("mageTuntun.reload()");
    console.log("mageTuntun.xray.status()");
    console.log("mageTuntun.panic.status()");
    console.log("mageTuntun.pz.goToNearestPz()");
    console.log("mageTuntun.pz.setHomePzCurrentSpot()");
    console.log("mageTuntun.pz.goToHomePz()");
    console.log("mageTuntun.rune.start()");
    console.log("mageTuntun.rune.stop()");
    console.log("mageTuntun.heal.start()");
    console.log("mageTuntun.heal.stop()");
    console.log("mageTuntun.invisible.start()");
    console.log("mageTuntun.invisible.stop()");
    console.log("mageTuntun.magicShield.start()");
    console.log("mageTuntun.magicShield.stop()");
    console.log("mageTuntun.attack.start()");
    console.log("mageTuntun.attack.stop()");
    console.log("mageTuntun.cave.addWaypointCurrentSpot()");
    console.log("mageTuntun.cave.start()");
    console.log("mageTuntun.cave.stop()");
    console.log("mageTuntun.equipRing.start()");
    console.log("mageTuntun.equipRing.stop()");
    console.log("mageTuntun.eat.start()");
    console.log("mageTuntun.eat.stop()");
    console.log("mageTuntun.talk.updateConfig({ apiKey: \"...\" })");
    console.log("mageTuntun.talk.start()");
    console.log("mageTuntun.talk.stop()");
    return bot;
  }

  window.__mageTuntunReloadBundle = bundle;
  window.mageTuntunReload = () => boot(window.__mageTuntunReloadBundle || bundle);
  window.minibiaBotReload = window.mageTuntunReload;
  delete window.__mageTuntunBundle;
  boot(bundle);
})();
