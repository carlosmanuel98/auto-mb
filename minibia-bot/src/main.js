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
