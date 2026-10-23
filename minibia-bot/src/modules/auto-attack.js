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
