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
