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
