import test from "node:test";
import assert from "node:assert/strict";
await import("./dist/engine.js");
const C = globalThis.AbendessenCore;

function resolveEncounter(state) {
  const encounter = C.getEncounter(state);
  if (!encounter) return;
  const preferred = { anka: "queue", bluetooth: "disco", yusuf: "focus", update: "offline", walkie: "later" }[encounter.id];
  const choice = encounter.choices.find(option => option.id === preferred && option.affordable) || encounter.choices.find(option => option.affordable);
  assert.ok(choice, "Each encounter must retain an affordable option");
  assert.equal(C.chooseEncounter(state, choice.id), true);
}

function completeBattle(state) {
  resolveEncounter(state);
  assert.equal(C.startBattle(state), true);
  for (let step = 0; state.phase === "battle" && step < 300; step++) C.updateBattle(state, 1);
  assert.notEqual(state.phase, "battle", "Combat must finish without soft-locking");
}

function spendShopBudget(state, policy = "blind") {
  resolveEncounter(state);
  const priority = { ventilator: 8, headset: 7, discord: 8, gabel: 7, brotdose: 6, serviette: 6, paper: 2, kaffee: 2, beer: 2, snus: 3, luca: 5, desolator: 6, awp: 8, batomon: 6, podcast: 7, umut: 6, walkie: 3, ritalin: 4 };
  if (policy === "offense") {
    for (let action = 0; action < 24; action++) {
      const options = [];
      state.slots.forEach((item, index) => {
        const cost = C.getUpgradeCost(state, index);
        if (item && cost !== null && cost <= state.coins) options.push({ type: "upgrade", index, score: priority[item.id] * (item.level === 1 ? 1.25 : 1) });
      });
      state.shop.offers.forEach((offer, index) => {
        if (!offer || offer.price > state.coins) return;
        const duplicate = state.slots.some(item => item?.id === offer.id && item.level === 1);
        if (duplicate || state.slots.some(item => !item)) options.push({ type: "buy", index, score: priority[offer.id] * (duplicate ? 1.25 : 1) });
      });
      options.sort((a, b) => b.score - a.score);
      const choice = options[0];
      if (!choice) break;
      assert.equal(choice.type === "upgrade" ? C.upgradeItem(state, choice.index) : C.buyItem(state, choice.index), true);
    }
    return;
  }
  for (let purchase = 0; purchase < 4; purchase++) {
    const affordable = state.shop.offers.map((offer, index) => offer && offer.price <= state.coins && C.purchasePreview(state, index) ? { offer, index } : null).filter(Boolean);
    if (!affordable.length) break;
    assert.equal(C.buyItem(state, affordable[0].index), true);
  }
}

function simulate(seed, policy = "blind") {
  const state = C.createRun(seed);
  for (let course = 0; course < C.COURSES.length; course++) {
    spendShopBudget(state, policy);
    completeBattle(state);
    if (state.phase === "lost" || state.phase === "won") break;
  }
  return state;
}

function setOffer(state, id, index = 0, price = C.ITEMS[id].price) {
  state.shop.offers[index] = { uid: `fixture-${index}`, id, price, locked: false };
}

function fund(state, amount) {
  state.coins += amount;
  state.stats.coinsEarned += amount;
}

test("a new run has six slots, two free starters, twelve coins, and a guaranteed cheap shop slot", () => {
  const state = C.createRun("test");
  assert.equal(C.VERSION, 2);
  assert.equal(state.phase, "prep");
  assert.equal(state.slots.length, 6);
  assert.equal(state.slots.filter(Boolean).length, 2);
  assert.equal(state.slots[0].id, "serviette");
  assert.equal(state.slots[3].id, "paper");
  assert.ok(state.slots.filter(Boolean).every(item => item.invested === 0));
  assert.equal(state.coins, C.ECONOMY.startingCoins);
  assert.equal(state.shop.offers.length, 4);
  assert.equal(state.shop.offers[3].price, 4);
  assert.equal(state.shop.visit, 0);
  assert.equal(state.lastBattle, null);
  assert.equal(state.rewardChoices, undefined);
  assert.equal(C.chooseReward, undefined);
  assert.equal(state.willpower, state.maxWillpower);
  assert.deepEqual(state, JSON.parse(JSON.stringify(state)));
});

test("orthogonal adjacency activates the advertised synergy", () => {
  const state = C.createRun("adjacent");
  state.slots[2] = { id: "brotdose", level: 1, uid: "test" };
  const base = C.getItemStats(state, 0).power;
  assert.equal(C.getSynergies(state).length, 0);
  assert.equal(C.moveItem(state, 2, 1), true);
  assert.ok(C.getSynergies(state).some(s => s.name === "Unauffällig einpacken"));
  assert.equal(C.getItemStats(state, 0).power, base * 1.35);
  assert.equal(C.moveItem(state, 1, 4), true);
  assert.equal(C.getSynergies(state).length, 0, "Diagonal adjacency must not activate a synergy");
});

test("bench swaps preserve item identity and prohibit combat rearrangement", () => {
  const state = C.createRun("swap");
  state.bench.push({ id: "headset", level: 1, uid: "bench" });
  const starterUid = state.slots[0].uid;
  assert.equal(C.moveItem(state, 6, 0), true);
  assert.equal(state.slots[0].uid, "bench");
  assert.equal(state.bench[0].uid, starterUid);
  C.startBattle(state);
  const before = JSON.stringify(state.slots);
  assert.equal(C.moveItem(state, 0, 2), false);
  assert.equal(JSON.stringify(state.slots), before);
});

test("a cleared course pays once and opens the next shop without free items or healing", () => {
  const state = C.createRun(42);
  state.willpower = 55;
  const originalItems = JSON.stringify(state.slots);
  C.toggleShopLock(state, 2);
  const locked = { ...state.shop.offers[2] };
  completeBattle(state);
  assert.equal(state.phase, "prep");
  assert.equal(state.course, 1);
  assert.equal(state.stats.coursesCleared, 1);
  assert.equal(state.lastBattle.killed + state.lastBattle.escaped, state.lastBattle.total);
  assert.equal(state.lastBattle.course, 0);
  assert.equal(state.lastBattle.income, C.getCourseIncome(state.lastBattle.course));
  assert.equal(state.battle, null);
  assert.equal(state.coins, C.ECONOMY.startingCoins + C.getCourseIncome(0));
  assert.equal(state.stats.coinsEarned, C.ECONOMY.startingCoins + C.getCourseIncome(0));
  assert.equal(state.shop.visit, 1);
  assert.equal(state.shop.healUsed, false);
  assert.equal(state.shop.rerolls, 0);
  assert.deepEqual(state.shop.offers[2], locked);
  assert.equal(JSON.stringify(state.slots), originalItems);
  assert.ok(state.willpower <= 55, "Clearing a course must not heal for free");
  const completed = JSON.stringify(state);
  assert.deepEqual(C.updateBattle(state, 2), []);
  assert.equal(JSON.stringify(state), completed, "A second update must not pay income again");
});

test("an unaffordable or empty offer never mutates coins, inventory, RNG, or IDs", () => {
  const state = C.createRun("unaffordable");
  state.coins = 6;
  setOffer(state, "discord");
  const before = JSON.stringify(state);
  assert.equal(C.buyItem(state, 0), false);
  assert.equal(C.buyItem(state, -1), false);
  assert.equal(C.buyItem(state, "0"), false);
  assert.equal(JSON.stringify(state), before);
  setOffer(state, "headset");
  assert.equal(C.buyItem(state, 0), true);
  assert.equal(state.coins, 0);
  assert.equal(state.shop.offers[0], null);
  assert.equal(state.slots[1].invested, 6);
  const bought = JSON.stringify(state);
  assert.equal(C.buyItem(state, 0), false);
  assert.equal(JSON.stringify(state), bought);
});

test("four base copies cascade into level three and preserve the first item UID and investment", () => {
  const state = C.createRun("four-copies");
  fund(state, 30);
  let uid;
  for (let copy = 0; copy < 4; copy++) {
    setOffer(state, "headset");
    assert.equal(C.buyItem(state, 0), true);
    if (copy === 0) uid = state.slots[1].uid;
    if (copy === 1) assert.equal(state.slots[1].level, 2);
    if (copy === 2) {
      assert.equal(state.slots[1].level, 2, "A third base copy must not create level three");
      assert.ok(state.slots.some(item => item?.id === "headset" && item.level === 1));
    }
  }
  const copies = [...state.slots, ...state.bench].filter(item => item?.id === "headset");
  assert.equal(copies.length, 1);
  assert.equal(copies[0].level, 3);
  assert.equal(copies[0].invested, 24);
  assert.equal(copies[0].uid, uid);
  assert.equal(state.slots[1], copies[0]);
  setOffer(state, "headset");
  C.buyItem(state, 0);
  assert.equal([...state.slots, ...state.bench].filter(item => item?.id === "headset").length, 2, "Level three must remain the cap");
});

test("purchases use reserve when full and merge reserve copies without moving equipped items", () => {
  const state = C.createRun("reserve");
  fund(state, 30);
  state.slots = ["serviette", "paper", "ventilator", "headset", "gabel", "kaffee"].map((id, index) => ({ id, level: 1, uid: `full${index}`, invested: 0 }));
  const before = JSON.stringify(state.slots);
  setOffer(state, "brotdose");
  C.buyItem(state, 0);
  const uid = state.bench[0].uid;
  assert.equal(state.bench[0].level, 1);
  setOffer(state, "brotdose");
  C.buyItem(state, 0);
  assert.equal(state.bench.length, 1);
  assert.equal(state.bench[0].uid, uid);
  assert.equal(state.bench[0].level, 2);
  assert.equal(state.bench[0].invested, 12);
  assert.equal(JSON.stringify(state.slots), before);
});

test("reroll costs rise 1, 2, 3 and cap, while locks preserve offers and the cheap slot", () => {
  const state = C.createRun("reroll");
  fund(state, 10);
  setOffer(state, "discord", 3);
  C.toggleShopLock(state, 3);
  const locked = { ...state.shop.offers[3] };
  for (const cost of [1, 2, 3, 3]) {
    const coins = state.coins;
    assert.equal(C.getRerollCost(state), cost);
    assert.equal(C.rerollShop(state), true);
    assert.equal(state.coins, coins - cost);
    assert.deepEqual(state.shop.offers[3], locked);
    assert.equal(state.shop.offers[2].price, 4, "The last unlocked slot must stay affordable");
  }
  assert.equal(state.shop.rerolls, 4);
  assert.equal(state.stats.rerolls, 4);
  for (let index = 0; index < 3; index++) C.toggleShopLock(state, index);
  const before = JSON.stringify(state);
  assert.equal(C.rerollShop(state), false, "Do not charge when everything is locked");
  assert.equal(JSON.stringify(state), before);
  C.toggleShopLock(state, 0);
  state.coins = 0;
  const emptyWallet = JSON.stringify(state);
  assert.equal(C.rerollShop(state), false);
  assert.equal(JSON.stringify(state), emptyWallet);
});

test("selling refunds half of actual paid investment, including merged copies and free starters", () => {
  const state = C.createRun("sell");
  assert.equal(C.getSellValue(state, 0), 0);
  assert.equal(C.getSellValue(state, 3), 0);
  setOffer(state, "serviette");
  assert.equal(C.buyItem(state, 0), true);
  assert.equal(state.slots[0].level, 2);
  assert.equal(state.slots[0].invested, 4);
  assert.equal(C.getSellValue(state, 0), 2, "The starter portion of a merge must never create free money");
  assert.equal(C.sellItem(state, 0), true);
  assert.equal(state.coins, C.ECONOMY.startingCoins - 2);
  assert.equal(state.slots[0], null);
  assert.equal(C.sellItem(state, 0), false);
  assert.equal(C.sellItem(state, 3), true);
  assert.equal(state.coins, C.ECONOMY.startingCoins - 2, "Selling a free starter must refund zero");
  assert.equal(state.coins, state.stats.coinsEarned - state.stats.coinsSpent);
});

test("healing costs four coins, caps at max health, and is available once per shop", () => {
  const state = C.createRun("heal");
  const before = JSON.stringify(state);
  assert.equal(C.heal(state), false);
  assert.equal(JSON.stringify(state), before);
  state.willpower = 94;
  assert.equal(C.heal(state), true);
  assert.equal(state.willpower, 100);
  assert.equal(state.coins, C.ECONOMY.startingCoins - 4);
  assert.equal(state.shop.healUsed, true);
  state.willpower = 70;
  fund(state, 20);
  assert.equal(C.heal(state), false, "A second heal in the same visit must be rejected");
  completeBattle(state);
  assert.equal(state.shop.healUsed, false);
  resolveEncounter(state);
  assert.equal(C.heal(state), true);
  assert.equal(state.willpower, 85);
});

test("all shop mutations and selling are disabled during combat", () => {
  const state = C.createRun("combat-shop");
  state.willpower = 60;
  C.startBattle(state);
  const before = JSON.stringify(state);
  assert.equal(C.buyItem(state, 3), false);
  assert.equal(C.toggleShopLock(state, 0), false);
  assert.equal(C.rerollShop(state), false);
  assert.equal(C.sellItem(state, 0), false);
  assert.equal(C.heal(state), false);
  assert.equal(JSON.stringify(state), before);
});

test("purchase preview predicts exact fusion stats without changing the real state or requiring money", () => {
  const state = C.createRun("preview");
  setOffer(state, "serviette");
  state.coins = 0;
  const before = JSON.stringify(state);
  const preview = C.purchasePreview(state, 0);
  assert.equal(JSON.stringify(state), before);
  assert.equal(preview.affordable, false);
  assert.equal(preview.item.uid, state.slots[0].uid);
  assert.equal(preview.index, 0);
  assert.equal(preview.item.level, 2);
  assert.equal(preview.merges.length, 1);
  assert.equal(preview.merges[0].fromLevel, 1);
  assert.equal(preview.merges[0].toLevel, 2);
  assert.equal(preview.stats.power, 27, "18 base damage gains the level-two 50% bonus");
  fund(state, 4);
  C.buyItem(state, 0);
  assert.deepEqual(state.slots[0], preview.item);
  assert.deepEqual(C.getItemStats(state, 0), preview.stats);
});

test("saving and restoring mid-battle preserves the deterministic result", () => {
  const original = C.createRun("saved-run");
  C.startBattle(original);
  C.updateBattle(original, 2);
  const restored = JSON.parse(JSON.stringify(original));
  for (let step = 0; original.phase === "battle" && step < 300; step++) {
    assert.deepEqual(C.updateBattle(original, 0.5), C.updateBattle(restored, 0.5));
  }
  assert.deepEqual(original, restored);
});

test("a complete seeded six-course build wins and records its result", () => {
  const state = simulate(3, "offense");
  assert.equal(state.phase, "won");
  assert.equal(state.stats.coursesCleared, 6);
  assert.ok(state.stats.killed > 40);
  assert.ok(state.stats.damageDealt > 1000);
  assert.ok(state.willpower > 0);
  assert.equal(state.course, 5);
  assert.equal(C.startBattle(state), false);
  assert.equal(state.lastBattle.income, C.getCourseIncome(state.lastBattle.course));
  assert.equal(state.stats.coinsEarned, C.ECONOMY.startingCoins + C.ECONOMY.courseIncome.reduce((sum, income) => sum + income, 0));
  assert.equal(state.coins, state.stats.coinsEarned - state.stats.coinsSpent);
});

test("an undefended dessert defeats Gabriel and cannot count as a victory", () => {
  const state = C.createRun("dessert");
  state.course = 5;
  state.slots = [{ id: "paper", level: 1, uid: "paper-only" }, null, null, null, null, null];
  completeBattle(state);
  assert.equal(state.phase, "lost");
  assert.equal(state.willpower, 0);
  assert.equal(state.stats.coursesCleared, 0);
});

test("invalid or paused updates do not advance the simulation", () => {
  const state = C.createRun(2);
  assert.deepEqual(C.updateBattle(state, 1), []);
  C.startBattle(state);
  const before = state.battle.time;
  C.updateBattle(state, -1);
  C.updateBattle(state, Number.NaN);
  assert.equal(state.battle.time, before);
  assert.equal(C.buyItem(state, 0), false);
});

test("seed sweep covers victory and defeat without stalled encounters", () => {
  let won = 0;
  let lost = 0;
  for (let seed = 0; seed < 100; seed++) {
    const state = simulate(seed, seed % 2 ? "offense" : "blind");
    if (state.phase === "won") won++;
    else if (state.phase === "lost") lost++;
    else assert.fail(`Seed ${seed} did not reach an ending`);
    assert.ok(state.willpower >= 0 && state.willpower <= 100);
    assert.equal(state.slots.length, 6);
  }
  assert.ok(won > 0 && lost > 0, `The shop must permit both winning and losing builds; got ${won}% mixed-policy wins`);
  assert.equal(won + lost, 100);
});

function legacyRun(phase = "prep") {
  const state = C.createRun("legacy");
  state.version = 1;
  delete state.encounters;
  state.phase = phase;
  state.slots[1] = { id: "ventilator", level: 2, uid: "old-ventilator" };
  state.slots.forEach(item => { if (item) delete item.invested; });
  delete state.coins;
  delete state.shop;
  delete state.lastBattle;
  delete state.stats.coinsEarned;
  delete state.stats.coinsSpent;
  delete state.stats.rerolls;
  state.rewardChoices = [];
  return state;
}

test("v1 reward migration advances the course but grants no free item or healing", () => {
  const old = legacyRun("reward");
  old.willpower = 47;
  old.stats.coursesCleared = 1;
  old.battle = { killed: 6, total: 7, escaped: 1 };
  old.rewardChoices = [{ id: "headset" }, { id: "paper" }, { id: "kaffee" }];
  const before = JSON.stringify(old);
  const migrated = C.migrateRun(old);
  assert.equal(JSON.stringify(old), before, "Migration must deep-clone the old save");
  assert.equal(migrated.version, 2);
  assert.equal(migrated.phase, "prep");
  assert.equal(migrated.course, 1);
  assert.equal(migrated.willpower, 47);
  assert.equal(migrated.coins, C.ECONOMY.startingCoins);
  assert.equal(migrated.battle, null);
  assert.equal(migrated.slots.filter(Boolean).length, 3);
  assert.ok(migrated.slots.filter(Boolean).every(item => item.invested === 0));
  assert.equal(migrated.slots[1].level, 2);
  assert.equal(migrated.slots[1].uid, "old-ventilator");
  assert.equal(migrated.rewardChoices, undefined);
  assert.deepEqual(migrated.lastBattle, { course: 0, killed: 6, total: 7, escaped: 1, income: 6 });
});

test("v1 migration preserves a running battle and gives finished saves no spending money", () => {
  const old = legacyRun();
  old.version = 2;
  old.coins = 6;
  old.shop = C.createRun("shop-fixture").shop;
  C.startBattle(old);
  C.updateBattle(old, 1);
  old.version = 1;
  const battle = JSON.parse(JSON.stringify(old.battle));
  const migrated = C.migrateRun(old);
  assert.equal(migrated.phase, "battle");
  assert.equal(migrated.coins, C.ECONOMY.startingCoins);
  assert.deepEqual(migrated.battle, battle);
  for (const phase of ["won", "lost"]) {
    const finished = C.migrateRun(legacyRun(phase));
    assert.equal(finished.phase, phase);
    assert.equal(finished.coins, 0);
  }
  const current = C.createRun("current");
  const copy = C.migrateRun(current);
  assert.deepEqual(copy, current);
  assert.notEqual(copy, current);
  assert.equal(C.migrateRun({ version: 99 }), null);
});

test("restoring a shop preserves subsequent locks, rerolls, and purchase previews exactly", () => {
  const state = C.createRun("shop-restore");
  fund(state, 20);
  C.toggleShopLock(state, 0);
  const restored = JSON.parse(JSON.stringify(state));
  assert.equal(C.rerollShop(state), C.rerollShop(restored));
  assert.deepEqual(state, restored);
  assert.deepEqual(C.purchasePreview(state, 2), C.purchasePreview(restored, 2));
  assert.equal(C.buyItem(state, 2), C.buyItem(restored, 2));
  assert.deepEqual(state, restored);
});

function itemBattle(itemId, enemies = []) {
  const state = C.createRun("activation-events");
  state.slots = [{ id: itemId, level: 1, uid: "active-item" }, null, null, null, null, null];
  C.startBattle(state);
  state.battle.nextSpawn = 999;
  state.battle.cooldowns[0] = 0;
  state.battle.enemies = enemies.map((enemy, index) => ({
    ...C.ENEMIES[enemy.type || "brokkoli"],
    uid: `target-${index}`, type: "brokkoli", lane: index % 3,
    x: 0.3 + index * 0.2, hp: 100, maxHp: 100, shield: 0,
    speed: 0, slowUntil: 0, ...enemy,
  }));
  return state;
}

test("one area activation describes every affected target before individual attacks", () => {
  const state = itemBattle("ventilator", [{}, {}, {}]);
  const positions = state.battle.enemies.map(enemy => ({ uid: enemy.uid, x: enemy.x, lane: enemy.lane, type: enemy.type }));
  const events = C.updateBattle(state, 0.05);
  const activations = events.filter(event => event.type === "activate");
  assert.equal(activations.length, 1, "An area effect is one item activation, not one activation per victim");
  assert.equal(events[0], activations[0]);
  assert.deepEqual(activations[0].targets, positions);
  assert.equal(activations[0].itemId, "ventilator");
  assert.equal(activations[0].itemUid, "active-item");
  assert.equal(activations[0].effect, "push");
  assert.equal(activations[0].power, C.getItemStats(state, 0).power);
  assert.equal(activations[0].cooldown, C.getItemStats(state, 0).cooldown);
  assert.equal(events.filter(event => event.type === "attack").length, 3);
  assert.ok(state.battle.enemies[0].x > activations[0].targets[0].x, "Push movement must not mutate the event snapshot");
  assert.deepEqual(events.find(event => event.type === "attack").position, { x: positions[0].x, lane: positions[0].lane });
  assert.equal(C.updateBattle(state, 0.05).filter(event => event.type === "activate").length, 0, "A cooling-down item must not retrigger");
});

test("brotdose activation names the small portion actually selected instead of the front enemy", () => {
  const state = itemBattle("brotdose", [
    { uid: "front", x: 0.1, hp: 100 },
    { uid: "small", x: 0.7, hp: 20, type: "erbsen", lane: 2 },
    { uid: "middle", x: 0.4, hp: 90 },
  ]);
  const events = C.updateBattle(state, 0.05);
  const activation = events.find(event => event.type === "activate");
  assert.deepEqual(activation.targets, [{ uid: "small", x: 0.7, lane: 2, type: "erbsen" }]);
  assert.equal(events.find(event => event.type === "attack").enemyUid, "small");
  assert.equal(events.find(event => event.type === "kill").enemyUid, "small");
  assert.equal(state.battle.enemies.find(enemy => enemy.uid === "front").hp, 100);
});

test("fork activation lists only its two nearest targets", () => {
  const state = itemBattle("gabel", [
    { uid: "far", x: 0.8 }, { uid: "near", x: 0.2 }, { uid: "middle", x: 0.5 },
  ]);
  const events = C.updateBattle(state, 0.05);
  const activations = events.filter(event => event.type === "activate");
  assert.equal(activations.length, 1);
  assert.deepEqual(activations[0].targets.map(target => target.uid), ["near", "middle"]);
  assert.equal(events.filter(event => event.type === "attack").length, 2);
  assert.equal(state.battle.enemies.find(enemy => enemy.uid === "far").hp, 100);
});

test("newly spawned and killed enemies retain independent attack and death positions", () => {
  const state = itemBattle("serviette");
  state.slots[0].level = 3;
  state.battle.nextSpawn = 0;
  const events = C.updateBattle(state, 0.05);
  const spawn = events.find(event => event.type === "spawn");
  const activation = events.find(event => event.type === "activate");
  const attack = events.find(event => event.type === "attack");
  const kill = events.find(event => event.type === "kill");
  assert.ok(spawn && activation && attack && kill);
  assert.equal(attack.enemyUid, spawn.enemyUid);
  assert.equal(kill.enemyUid, spawn.enemyUid);
  assert.deepEqual(attack.position, { x: 1.02, lane: 0 });
  assert.deepEqual(kill.position, attack.position);
  assert.equal(state.battle.enemies.length, 0);
  activation.targets[0].x = 0;
  assert.equal(attack.position.x, 1.02);
  attack.position.x = 0;
  assert.equal(kill.position.x, 1.02, "Snapshots must not share mutable coordinate objects");
});

test("a full shield still activates once, while an attack without enemies waits", () => {
  for (const itemId of ["paper", "kaffee"]) {
    const state = itemBattle(itemId);
    state.battle.shield = 35;
    const events = C.updateBattle(state, 0.05);
    const activations = events.filter(event => event.type === "activate");
    assert.equal(activations.length, 1);
    assert.deepEqual(activations[0].targets, []);
    assert.equal(events.find(event => event.type === "shield").amount, 0);
    assert.ok(state.battle.cooldowns[0] > 0);
  }
  const state = itemBattle("serviette");
  assert.equal(C.updateBattle(state, 0.05).filter(event => event.type === "activate").length, 0);
  assert.equal(state.battle.cooldowns[0], 0);
});

test("a dish reaching Gabriel keeps its impact position after removal", () => {
  const state = itemBattle("paper", [{ x: 0.001, speed: 0.1, lane: 2 }]);
  state.battle.cooldowns[0] = 999;
  const target = state.battle.enemies[0];
  const events = C.updateBattle(state, 0.05);
  const hit = events.find(event => event.type === "hit");
  assert.ok(hit);
  assert.equal(hit.enemyUid, target.uid);
  assert.equal(hit.position.lane, 2);
  assert.ok(hit.position.x <= 0);
  assert.equal(hit.position.x, target.x);
  assert.equal(state.battle.enemies.length, 0);
  target.x = 0.5;
  assert.ok(hit.position.x <= 0);
});

test("the expanded shop offers every new base item and never sells an independent beer crate", () => {
  const expected = ["beer", "snus", "luca", "desolator", "awp", "batomon", "podcast", "umut", "walkie", "ritalin"];
  assert.equal(Object.keys(C.ITEMS).length, 18);
  const seen = new Set();
  for (let seed = 0; seed < 300; seed++) {
    const state = C.createRun(`new-offers-${seed}`);
    for (const offer of state.shop.offers) {
      seen.add(offer.id);
      assert.equal(offer.price, C.ITEMS[offer.id].price);
    }
    assert.equal(state.shop.offers[3].price, 4);
  }
  assert.ok(expected.every(id => seen.has(id)), "The real random shop can reach every new item");
  assert.equal(C.ITEMS.beer_crate, undefined);
  assert.equal(C.getItemDefinition("unknown"), null);
});

test("beer fuses through a Sixpack into the beer crate without changing identity, costs or shop family", () => {
  const state = C.createRun("beer-crate");
  fund(state, 20);
  let uid;
  for (let copy = 0; copy < 4; copy++) {
    setOffer(state, "beer");
    if (copy === 1) {
      const preview = C.purchasePreview(state, 0);
      assert.equal(preview.definition.name, "Sixpack");
      assert.equal(preview.definition.iconPath, "assets/items/beer_sixpack.svg");
      assert.equal(state.slots[1].level, 1, "Inspecting the Sixpack preview does not upgrade for free");
    }
    assert.equal(C.buyItem(state, 0), true);
    if (copy === 0) {
      uid = state.slots[1].uid;
      assert.equal(C.getItemDefinition(state.slots[1]).name, "Kühles Bier");
    }
    if (copy >= 1) assert.equal(C.getItemDefinition(state.slots[1]).name, copy === 3 ? "Bierkasten" : "Sixpack");
  }
  assert.equal(state.slots[1].id, "beer");
  assert.equal(state.slots[1].uid, uid);
  assert.equal(state.slots[1].level, 3);
  assert.equal(state.slots[1].invested, 16);
  assert.equal(C.getSellValue(state, 1), 8);
  assert.equal(C.ITEMS.beer.name, "Kühles Bier", "Display variants do not mutate base metadata");
  assert.equal(C.getItemDefinition("beer", 3).name, "Bierkasten");
  assert.equal(C.getItemDefinition(JSON.parse(JSON.stringify(state.slots[1]))).name, "Bierkasten");
});

test("beer creates shield and actually advances only orthogonal neighbors without extra income or health", () => {
  const state = itemBattle("beer");
  state.slots[1] = { id: "serviette", level: 1, uid: "neighbor" };
  state.slots[3] = { id: "paper", level: 1, uid: "neighbor-paper" };
  state.slots[4] = { id: "headset", level: 1, uid: "diagonal" };
  state.battle.cooldowns[1] = state.battle.cooldowns[3] = state.battle.cooldowns[4] = 10;
  const events = C.updateBattle(state, .05);
  const activation = events.find(event => event.type === "activate" && event.slot === 0);
  assert.deepEqual(activation.targets, []);
  assert.deepEqual(activation.rechargedSlots, [1, 3]);
  assert.equal(state.battle.shield, 4);
  assert.ok(Math.abs(state.battle.cooldowns[1] - 9.5) < 1e-9);
  assert.ok(Math.abs(state.battle.cooldowns[3] - 9.5) < 1e-9);
  assert.ok(Math.abs(state.battle.cooldowns[4] - 9.95) < 1e-9);
  assert.equal(state.coins, C.ECONOMY.startingCoins);
  assert.equal(state.willpower, 100);
  assert.equal(C.getItemStats(state, 0).recharge, .45);
  state.slots[0].level = 2;
  assert.equal(C.getItemStats(state, 0).recharge, .5625);
});

test("Snus prepares one nonstacking guard and consumes it on the next unblocked ordinary bite", () => {
  const state = itemBattle("snus", [{ damage: 14 }]);
  C.updateBattle(state, .05);
  assert.equal(state.battle.mouthGuard, 10);
  state.battle.cooldowns[0] = 0;
  C.updateBattle(state, .05);
  assert.equal(state.battle.mouthGuard, 10, "Repeated preparation refreshes one guard instead of stacking");
  state.battle.enemies[0].x = .001;
  state.battle.enemies[0].speed = .1;
  state.battle.shield = 3;
  const events = C.updateBattle(state, .05);
  assert.equal(state.willpower, 99);
  assert.equal(state.battle.mouthGuard, 0);
  assert.equal(state.stats.shielded, 13);
  assert.equal(events.find(event => event.type === "guard_block").amount, 10);
  assert.equal(events.find(event => event.type === "hit").amount, 1);
  assert.equal(events.find(event => event.type === "guard_block").slot, 0);
});

test("Snus covers soup bypass damage, retains its charge behind a complete shield, and never defeats the boss rule", () => {
  const soup = itemBattle("snus", [{ type: "suppe", x: .001, speed: .1, damage: 20 }]);
  soup.battle.mouthGuard = 10;
  soup.battle.mouthGuardSlot = 0;
  soup.battle.shield = 35;
  soup.battle.cooldowns[0] = 999;
  C.updateBattle(soup, .05);
  assert.equal(soup.willpower, 100, "Snus can block the part of soup that bypasses ordinary shields");
  assert.equal(soup.battle.mouthGuard, 0);
  assert.equal(soup.battle.shield, 25);

  const defended = itemBattle("snus", [{ x: .001, speed: .1, damage: 6 }]);
  defended.battle.mouthGuard = 10;
  defended.battle.shield = 10;
  defended.battle.cooldowns[0] = 999;
  C.updateBattle(defended, .05);
  assert.equal(defended.battle.mouthGuard, 10, "There is no bite to block when the normal shield already suffices");

  const boss = itemBattle("snus", [{ type: "dessert", x: .001, speed: .1, damage: 200 }]);
  boss.battle.mouthGuard = 1000;
  boss.battle.cooldowns[0] = 999;
  C.updateBattle(boss, .05);
  assert.equal(boss.phase, "lost", "The dessert must still actually be killed");
  assert.equal(boss.willpower, 0);
  assert.equal(boss.battle.mouthGuard, 1000);
});

test("Luca attacks once and advances only adjacent gaming items", () => {
  const state = itemBattle("luca", [{}]);
  state.slots[1] = { id: "headset", level: 1, uid: "gaming-neighbor" };
  state.slots[3] = { id: "paper", level: 1, uid: "not-gaming" };
  state.slots[4] = { id: "discord", level: 1, uid: "diagonal-gaming" };
  state.battle.cooldowns[1] = state.battle.cooldowns[3] = state.battle.cooldowns[4] = 10;
  const events = C.updateBattle(state, .05);
  const activation = events.find(event => event.type === "activate");
  assert.deepEqual(activation.rechargedSlots, [1]);
  assert.equal(events.filter(event => event.type === "attack").length, 1);
  assert.equal(state.battle.enemies[0].hp, 86);
  assert.ok(Math.abs(state.battle.cooldowns[1] - 8.75) < 1e-9);
  assert.ok(Math.abs(state.battle.cooldowns[3] - 9.95) < 1e-9);
  assert.ok(Math.abs(state.battle.cooldowns[4] - 9.95) < 1e-9);
});

test("Desolator marks after its own hit, amplifies later damage once, and expires", () => {
  const state = itemBattle("desolator", [{ hp: 300, maxHp: 300 }]);
  C.updateBattle(state, .05);
  assert.equal(state.battle.enemies[0].hp, 284);
  assert.equal(state.battle.enemies[0].vulnerableUntil, 3.05);
  state.slots[1] = { id: "awp", level: 1, uid: "sniper" };
  state.battle.cooldowns[1] = 0;
  C.updateBattle(state, .05);
  assert.equal(state.battle.enemies[0].hp, 224, "The marked target takes 48 × 1.25 damage after Desolator's own 16");
  state.battle.cooldowns[0] = state.battle.cooldowns[1] = 999;
  C.updateBattle(state, 2);
  C.updateBattle(state, 1.1);
  state.battle.cooldowns[1] = 0;
  C.updateBattle(state, .05);
  assert.equal(state.battle.enemies[0].hp, 176, "Once the mark expires the next shot deals its normal 48");
});

test("two Desolators refresh one vulnerability and cannot multiply its bonus repeatedly", () => {
  const state = itemBattle("desolator", [{ hp: 300, maxHp: 300 }]);
  state.slots[1] = { id: "desolator", level: 1, uid: "second-desolator" };
  state.battle.cooldowns[1] = 0;
  C.updateBattle(state, .05);
  assert.equal(state.battle.enemies[0].hp, 264, "The first hit deals 16, the marked second hit 16 × 1.25");
  assert.equal(state.battle.enemies[0].vulnerableUntil, 3.05);
  state.slots[2] = { id: "serviette", level: 1, uid: "follow-up" };
  state.battle.cooldowns[2] = 0;
  C.updateBattle(state, .05);
  assert.equal(state.battle.enemies[0].hp, 241.5, "The 18-damage follow-up gets one 25% bonus, not 25% per Desolator");
});

test("AWP sends half its damage past the cheese shield and retains honest damage snapshots", () => {
  const state = itemBattle("awp", [{ type: "lasagne", hp: 200, maxHp: 200, shield: 100 }]);
  const events = C.updateBattle(state, .05);
  const target = state.battle.enemies[0];
  assert.equal(target.hp, 176);
  assert.equal(target.shield, 76);
  assert.equal(events.find(event => event.type === "attack").amount, 48);
  assert.equal(events.find(event => event.type === "activate").targets.length, 1);
});

test("Batomon hits two front enemies and deals exactly double damage to green vegetables", () => {
  const state = itemBattle("batomon", [{ type: "erbsen", x: .1 }, { type: "brokkoli", x: .2 }, { type: "pasta", x: .3 }]);
  const events = C.updateBattle(state, .05);
  assert.equal(state.battle.enemies[0].hp, 74);
  assert.equal(state.battle.enemies[1].hp, 74);
  assert.equal(state.battle.enemies[2].hp, 100);
  assert.equal(events.filter(event => event.type === "attack").length, 2);
  const normal = itemBattle("batomon", [{ type: "pasta" }, { type: "suppe" }]);
  C.updateBattle(normal, .05);
  assert.deepEqual(normal.battle.enemies.map(enemy => enemy.hp), [87, 87]);
});

test("every new pair synergy follows orthogonal placement and advertises its actual stat bonus", () => {
  const pairs = [
    ["beer", "snus", "Bier und Snus", "cooldown", .85],
    ["beer", "luca", "Feierabend im Voice", "power", 1.25],
    ["luca", "discord", "Duo-Queue", "cooldown", .8],
    ["luca", "desolator", "Dota-Abend", "power", 1.25],
    ["awp", "headset", "Sound-Check", "power", 1.3],
    ["batomon", "paper", "Schadensberechnung", "power", 1.3],
    ["snus", "serviette", "Mund bleibt zu", "power", 1.2],
  ];
  for (const [first, second, name, stat, multiplier] of pairs) {
    const state = C.createRun(`pair-${first}-${second}`);
    state.slots = [{ id: first, level: 1, uid: "first" }, { id: second, level: 1, uid: "second" }, null, null, null, null];
    const expected = C.ITEMS[first][stat] * multiplier;
    const precision = stat === "cooldown" ? 100 : 10;
    assert.equal(C.getItemStats(state, 0)[stat], Math.round(expected * precision) / precision);
    assert.ok(C.getSynergies(state).some(synergy => synergy.name === name));
    assert.ok(C.getPotentialSynergies().some(synergy => synergy.name === name));
    C.moveItem(state, 1, 4);
    assert.equal(C.getSynergies(state).length, 0, `${name} must not work diagonally`);
  }
});

test("new guards, vulnerability and recharge effects survive midfight JSON restoration deterministically", () => {
  const state = itemBattle("snus", [{ type: "pasta", x: .8, speed: .04, hp: 1000, maxHp: 1000 }]);
  state.slots[1] = { id: "desolator", level: 1, uid: "desolator" };
  state.slots[3] = { id: "beer", level: 2, uid: "beer-crate" };
  state.slots[4] = { id: "awp", level: 1, uid: "awp" };
  state.battle.cooldowns = [0, 0, 0, 0, 0, 0];
  C.updateBattle(state, .1);
  assert.ok(state.battle.mouthGuard > 0);
  assert.ok(state.battle.enemies[0].vulnerableUntil > state.battle.time);
  const restored = JSON.parse(JSON.stringify(state));
  for (let tick = 0; tick < 100; tick++) assert.deepEqual(C.updateBattle(state, .1), C.updateBattle(restored, .1));
  assert.deepEqual(state, restored);
  assert.equal(C.getItemDefinition(restored.slots[3]).name, "Sixpack");
});

test("version-two combat saves from before the added items remain playable without new fields", () => {
  const state = itemBattle("paper", [{ hp: 100, x: .5, speed: .02 }]);
  delete state.battle.mouthGuard;
  delete state.battle.mouthGuardSlot;
  delete state.battle.enemies[0].vulnerableUntil;
  const originalVersion = state.version;
  assert.doesNotThrow(() => C.updateBattle(state, .5));
  assert.equal(state.version, originalVersion);
  assert.ok(state.willpower > 0);
});

function fixtureItem(id, slot, level = 1, tactic) {
  return { id, uid: `fixture-${id}-${slot}`, level, invested: 0, ...(C.getTactics(id).length ? { tactic: tactic || C.getTactics(id)[0].id } : {}) };
}

function readyFixture(ids, enemies, tactics = {}) {
  const state = C.createRun("strategy-fixture");
  state.slots = Array.from({ length: 6 }, (_, index) => ids[index] ? fixtureItem(ids[index], index) : null);
  for (const [index, tactic] of Object.entries(tactics)) assert.equal(C.setTactic(state, Number(index), tactic), true);
  C.startBattle(state);
  state.battle.nextSpawn = 999;
  state.battle.cooldowns = state.slots.map(item => item ? 999 : 0);
  state.battle.enemies = enemies.map((enemy, index) => ({
    ...C.ENEMIES[enemy.type || "pasta"], uid: `strategy-target-${index}`, type: enemy.type || "pasta", lane: index % 3,
    x: .5 + index * .1, hp: 100, maxHp: 100, shield: 0, speed: 0, slowUntil: 0, vulnerableUntil: 0, ...enemy,
  }));
  return state;
}

function fireSlot(state, slot, dt = .05) {
  state.battle.cooldowns[slot] = 0;
  return C.updateBattle(state, dt);
}

function advance(state, seconds) {
  const events = [];
  for (let left = seconds; left > 1e-8 && state.phase === "battle"; left -= Math.min(2, left)) events.push(...C.updateBattle(state, Math.min(2, left)));
  return events;
}

function budgetedFinale(ids, levels, tactics = {}) {
  const state = C.createRun("budgeted-finale");
  // These are prescribed offers, not a claim about shop odds. Every item and
  // upgrade is paid from the 92 coins earnable before the final battle.
  fund(state, C.ECONOMY.courseIncome.slice(0, 5).reduce((sum, income) => sum + income, 0));
  assert.equal(state.coins, 92);
  const claimed = new Set();
  const roster = ids.map((id, index) => {
    let item = [...state.slots, ...state.bench].find(item => item?.id === id && !claimed.has(item.uid));
    if (!item) {
      setOffer(state, id);
      assert.equal(C.buyItem(state, 0), true);
      item = [...state.slots, ...state.bench].find(item => item?.id === id && !claimed.has(item.uid));
    }
    assert.ok(item);
    claimed.add(item.uid);
    while (item.level < levels[index]) {
      const location = [...state.slots, ...state.bench].findIndex(candidate => candidate?.uid === item.uid);
      assert.equal(C.upgradeItem(state, location), true);
    }
    return item.uid;
  });
  roster.forEach((uid, slot) => {
    const location = [...state.slots, ...state.bench].findIndex(item => item?.uid === uid);
    if (location !== slot) assert.equal(C.moveItem(state, location, slot), true);
  });
  while (state.bench.length) {
    assert.equal(C.getSellValue(state, 6), 0, "Only unused free starters may remain in reserve");
    assert.equal(C.sellItem(state, 6), true);
  }
  for (const [slot, tactic] of Object.entries(tactics)) assert.equal(C.setTactic(state, Number(slot), tactic), true);
  assert.equal(state.coins, state.stats.coinsEarned - state.stats.coinsSpent);
  assert.ok(state.stats.coinsSpent <= 92);
  assert.deepEqual(state.slots.map(item => item.id), ids);
  assert.deepEqual(state.slots.map(item => item.level), levels);
  state.course = 5;
  return state;
}

test("tactics are validated prep choices, survive save/fusion, and metadata stays readonly", () => {
  const state = C.createRun("tactics");
  state.slots[1] = fixtureItem("awp", 1);
  state.bench.push(fixtureItem("luca", 6));
  assert.equal(C.getTactic(state, 1).id, "threat");
  assert.equal(C.setTactic(state, 1, "marked"), true);
  assert.equal(C.setTactic(state, 6, "longest"), true);
  assert.equal(C.setTactic(state, 1, "green"), false);
  assert.equal(C.setTactic(state, -1, "marked"), false);
  assert.equal(C.setTactic(state, 0, "marked"), false);
  const copy = C.getTactics("awp");
  copy[0].label = "mutated";
  assert.notEqual(C.getTactics(state.slots[1])[0].label, "mutated");
  const uid = state.slots[1].uid;
  fund(state, 20);
  setOffer(state, "awp");
  C.buyItem(state, 0);
  assert.equal(state.slots[1].uid, uid);
  assert.equal(state.slots[1].level, 2);
  assert.equal(state.slots[1].tactic, "marked");
  const restored = C.migrateRun(state);
  assert.equal(C.getTactic(restored, 1).id, "marked");
  assert.equal(C.getTactic(restored, 6).id, "longest");
  C.startBattle(state);
  const before = JSON.stringify(state);
  assert.equal(C.setTactic(state, 1, "threat"), false);
  assert.equal(JSON.stringify(state), before);
});

test("AWP threat priorities select boss, healing support, then dangerous dishes; marked mode overrides", () => {
  const enemies = [
    { uid: "front", x: .1, type: "erbsen", damage: 6 },
    { uid: "danger", x: .3, type: "lasagne", damage: 20 },
    { uid: "healer", x: .5, type: "suppe", support: true, nextHeal: 999 },
    { uid: "boss", x: .8, type: "dessert", hp: 500, maxHp: 500 },
  ];
  const threat = readyFixture(["awp"], enemies);
  assert.equal(fireSlot(threat, 0).find(event => event.type === "activate").targets[0].uid, "boss");
  threat.battle.enemies.find(enemy => enemy.uid === "boss").hp = 0;
  assert.equal(fireSlot(threat, 0).find(event => event.type === "activate").targets[0].uid, "healer");
  threat.battle.enemies.find(enemy => enemy.uid === "healer").hp = 0;
  assert.equal(fireSlot(threat, 0).find(event => event.type === "activate").targets[0].uid, "danger");
  const marked = readyFixture(["awp"], enemies.map(enemy => ({ ...enemy, vulnerableUntil: enemy.uid === "front" ? 5 : 0 })), { 0: "marked" });
  assert.equal(fireSlot(marked, 0).find(event => event.type === "activate").targets[0].uid, "front");
  marked.battle.enemies.find(enemy => enemy.uid === "front").vulnerableUntil = 0;
  assert.equal(fireSlot(marked, 0).find(event => event.type === "activate").targets[0].uid, "boss");
});

test("Batomon selects green vegetables or the smallest effective HP, and Desolator can select shield", () => {
  const enemies = [
    { uid: "front", type: "lasagne", x: .1, hp: 10, shield: 50 },
    { uid: "weak", type: "pasta", x: .3, hp: 5 },
    { uid: "green", type: "brokkoli", x: .8, hp: 80 },
    { uid: "peas", type: "erbsen", x: .9, hp: 90 },
  ];
  const green = readyFixture(["batomon"], enemies);
  assert.deepEqual(fireSlot(green, 0).find(event => event.type === "activate").targets.map(target => target.uid), ["green", "peas"]);
  const cleanup = readyFixture(["batomon"], enemies, { 0: "cleanup" });
  assert.deepEqual(fireSlot(cleanup, 0).find(event => event.type === "activate").targets.map(target => target.uid), ["weak", "front"]);
  const front = readyFixture(["desolator"], [{ uid: "front", x: .1 }, { uid: "cheese", x: .8, shield: 60 }]);
  assert.equal(fireSlot(front, 0).find(event => event.type === "mark").enemyUid, "front");
  const armored = readyFixture(["desolator"], [{ uid: "front", x: .1 }, { uid: "cheese", x: .8, shield: 60 }], { 0: "armored" });
  assert.equal(fireSlot(armored, 0).find(event => event.type === "mark").enemyUid, "cheese");
});

test("Luca tactics recharge exactly one cooling gaming neighbor and ignore diagonal/non-gaming items", () => {
  for (const [tactic, expected] of [["strongest", 1], ["longest", 3]]) {
    const state = readyFixture(["luca", "awp", null, "headset", "discord", "paper"], [{ hp: 1000 }], { 0: tactic });
    state.battle.cooldowns[1] = 2;
    state.battle.cooldowns[3] = 8;
    const events = fireSlot(state, 0);
    assert.deepEqual(events.find(event => event.type === "activate").rechargedSlots, [expected]);
    assert.ok(Math.abs(state.battle.report.items.find(item => item.id === "luca").recharge - 1.2) < 1e-9);
    assert.equal(state.battle.cooldowns[4], 998.95);
    assert.equal(state.battle.cooldowns[5], 998.95);
  }
  const ready = readyFixture(["luca", "awp", null, "headset"], [{ hp: 1000 }]);
  ready.battle.cooldowns[1] = 0;
  ready.battle.cooldowns[3] = 8;
  assert.deepEqual(fireSlot(ready, 0).find(event => event.type === "activate" && event.slot === 0).rechargedSlots, [3]);
});

test("formations are seeded, announced without mutation, and independent of the shop RNG", () => {
  const a = C.createRun("formation-preview");
  const b = C.createRun("formation-preview");
  const before = JSON.stringify(a);
  for (let peek = 0; peek < 20; peek++) {
    const plan = C.getBattlePlan(a);
    assert.equal(plan.formation.id, "swarm");
    assert.equal(plan.total, plan.enemyTypes.length);
    assert.equal(typeof plan.rule, "string");
    plan.formation.enemyTypes[0] = "mutated";
    plan.enemyTypes[0] = "mutated";
  }
  assert.equal(JSON.stringify(a), before);
  C.rerollShop(a);
  C.rerollShop(b);
  assert.deepEqual(a.shop, b.shop);
  assert.equal(a.randomState, b.randomState);
  const orders = new Set();
  for (let seed = 0; seed < 30; seed++) {
    const state = C.createRun(seed);
    assert.equal(state.formationPlan[0], "swarm");
    assert.equal(state.formationPlan[5], "finale");
    assert.deepEqual([...state.formationPlan.slice(1, 5)].sort(), ["express", "family", "support", "swarm"]);
    orders.add(state.formationPlan.join(","));
  }
  assert.ok(orders.size > 8, "Seeds should offer varied middle-course orders");
});

test("each announced formation supplies its actual spawn sequence and stat multipliers", () => {
  for (const [id, definition] of Object.entries(C.FORMATIONS)) {
    const state = C.createRun(`formation-${id}`);
    state.course = 2;
    state.formationPlan[2] = id;
    const plan = C.getBattlePlan(state);
    C.startBattle(state);
    assert.equal(state.battle.formationId, id);
    assert.deepEqual(state.battle.enemyTypes, plan.enemyTypes);
    assert.equal(state.battle.spawnEvery, plan.spawnEvery);
    C.updateBattle(state, .35);
    const enemy = state.battle.enemies[0];
    const source = C.ENEMIES[plan.enemyTypes[0]];
    assert.equal(enemy.hp, Math.round(source.hp * C.getCourseBalance(2).hpScale * definition.hpMultiplier));
    assert.ok(Math.abs(enemy.speed - source.speed * C.getCourseBalance(2).speedScale * definition.speedMultiplier) < 1e-9);
  }
});

test("support soup heals only other living damaged dishes every 3.5 seconds", () => {
  const state = readyFixture(["paper"], [
    { uid: "healer", type: "suppe", hp: 15, maxHp: 40, support: true, nextHeal: .05 },
    { uid: "wounded", hp: 50, maxHp: 100 }, { uid: "full", hp: 100, maxHp: 100 }, { uid: "dead", hp: 0, maxHp: 100 },
  ]);
  const events = C.updateBattle(state, .05);
  const heals = events.filter(event => event.type === "enemy_heal");
  assert.equal(heals.length, 1);
  assert.equal(heals[0].enemyUid, "wounded");
  assert.equal(heals[0].sourceUid, "healer");
  assert.equal(heals[0].amount, 6);
  assert.equal(state.battle.enemies.find(enemy => enemy.uid === "healer").hp, 15);
  assert.equal(advance(state, 3.4).filter(event => event.type === "enemy_heal").length, 0);
  assert.equal(advance(state, .15).filter(event => event.type === "enemy_heal").length, 1);
  state.battle.enemies.find(enemy => enemy.uid === "healer").hp = 0;
  assert.equal(advance(state, 4).filter(event => event.type === "enemy_heal").length, 0);
});

test("AWP fires a two-shot one-second burst before its synergy-scaled ten-second reload", () => {
  const state = readyFixture(["awp"], [{ hp: 10000, maxHp: 10000 }]);
  const first = fireSlot(state, 0);
  assert.equal(first.filter(event => event.type === "activate").length, 1);
  assert.equal(state.battle.itemRuntime[0].shotsRemaining, 1);
  assert.equal(state.battle.cooldownMax[0], 1);
  assert.equal(advance(state, .9).filter(event => event.type === "activate").length, 0);
  const second = advance(state, .15);
  assert.equal(second.filter(event => event.type === "activate").length, 1);
  assert.equal(state.battle.itemRuntime[0].shotsRemaining, 0);
  assert.equal(state.battle.cooldownMax[0], 10);
  assert.equal(advance(state, 9.8).filter(event => event.type === "activate").length, 0);
  assert.equal(advance(state, .3).filter(event => event.type === "activate").length, 1);
  assert.equal(state.battle.itemRuntime[0].shotsRemaining, 1);
  const stronger = readyFixture(["awp", "luca", "discord"], [{ hp: 10000 }]);
  stronger.slots[0].level = 3;
  assert.equal(C.getItemStats(stronger, 0).cooldown, 8.4);
  assert.equal(C.getItemStats(stronger, 0).clipSize, 2);
  assert.equal(C.getItemStats(stronger, 0).shotInterval, 1);
});

test("marked AWP finishes advance adjacent Luca at most once per four seconds and only for real recharge", () => {
  const state = readyFixture(["awp", "luca"], [{ hp: 20, maxHp: 20, vulnerableUntil: 20 }]);
  const first = fireSlot(state, 0);
  assert.equal(first.filter(event => event.id === "marked_finish").length, 1);
  assert.equal(first.find(event => event.id === "marked_finish").amount, 1.5);
  assert.deepEqual(first.find(event => event.id === "marked_finish").rechargedSlots, [1]);
  state.battle.enemies.push({ ...C.ENEMIES.erbsen, uid: "second", type: "erbsen", hp: 20, shield: 0, x: .8, speed: 0, vulnerableUntil: 20 });
  assert.equal(fireSlot(state, 0).filter(event => event.id === "marked_finish").length, 0);
  advance(state, 4);
  state.battle.enemies.push({ ...C.ENEMIES.erbsen, uid: "third", type: "erbsen", hp: 20, shield: 0, x: .8, speed: 0, vulnerableUntil: 20 });
  assert.equal(fireSlot(state, 0).filter(event => event.id === "marked_finish").length, 1);
  advance(state, 4);
  state.battle.enemies.push({ ...C.ENEMIES.erbsen, uid: "fourth", type: "erbsen", hp: 20, shield: 0, x: .8, speed: 0, vulnerableUntil: 20 });
  state.battle.cooldowns[1] = 0;
  assert.equal(fireSlot(state, 0).filter(event => event.id === "marked_finish").length, 0);
});

test("Snus block advances beer at most once per four seconds without directly activating it", () => {
  const state = readyFixture(["snus", "beer"], [{ x: .001, speed: .1, damage: 6 }]);
  state.battle.mouthGuard = 10;
  state.battle.mouthGuardSlot = 0;
  state.battle.cooldowns[1] = 8;
  const first = C.updateBattle(state, .05);
  assert.equal(first.filter(event => event.id === "snus_beer").length, 1);
  assert.ok(Math.abs(state.battle.cooldowns[1] - 5.95) < 1e-9);
  assert.equal(first.filter(event => event.type === "activate").length, 0);
  state.battle.enemies.push({ ...C.ENEMIES.erbsen, uid: "bite-two", type: "erbsen", hp: 100, shield: 0, x: .001, speed: .1 });
  state.battle.mouthGuard = 10;
  state.battle.mouthGuardSlot = 0;
  assert.equal(C.updateBattle(state, .05).filter(event => event.id === "snus_beer").length, 0);
  state.battle.cooldowns[1] = 999;
  advance(state, 4);
  state.battle.enemies.push({ ...C.ENEMIES.erbsen, uid: "bite-three", type: "erbsen", hp: 100, shield: 0, x: .001, speed: .1 });
  state.battle.mouthGuard = 10;
  state.battle.mouthGuardSlot = 0;
  assert.equal(C.updateBattle(state, .05).filter(event => event.id === "snus_beer").length, 1);
});

test("beer focus is one nonstacking charge consumed by the next normal gaming attack", () => {
  const state = readyFixture(["beer", "awp", null, "paper", "discord"], [{ hp: 10000 }]);
  assert.equal(fireSlot(state, 0).filter(event => event.id === "beer_focus").length, 1);
  assert.equal(state.battle.itemRuntime[1].focus, 1);
  assert.equal(state.battle.itemRuntime[4].focus, 0, "Diagonal items receive no focus");
  assert.equal(fireSlot(state, 0).filter(event => event.id === "beer_focus").length, 0);
  const focused = fireSlot(state, 1).find(event => event.type === "attack");
  assert.ok(Math.abs(focused.actualAmount - 57.6) < 1e-9);
  assert.equal(state.battle.itemRuntime[1].focus, 0);
  assert.equal(fireSlot(state, 1).find(event => event.type === "attack").actualAmount, 48);
  assert.equal(fireSlot(state, 0).filter(event => event.id === "beer_focus").length, 1);
});

test("Luca grows after normal nearby gaming activations, caps at five, and recharge causes no reaction loop", () => {
  const state = readyFixture(["luca", "headset", null, "discord", "awp"], [{ hp: 100000, maxHp: 100000 }]);
  for (let activation = 0; activation < 15; activation++) {
    const events = fireSlot(state, 1);
    assert.equal(events.filter(event => event.type === "activate").length, 1);
    assert.equal(events.filter(event => event.id === "gaming_rhythm").length, activation % 3 === 2 ? 1 : 0);
  }
  assert.equal(state.battle.itemRuntime[0].momentum, 5);
  assert.equal(C.getItemStats(state, 0).momentum, 5);
  assert.equal(C.getItemStats(state, 0).power, 21, "Five momentum stacks boost Luca's 14 base damage by 50%");
  assert.equal(C.getItemStats(state, 0).recharge, 1.8);
  assert.equal(fireSlot(state, 1).filter(event => event.id === "gaming_rhythm").length, 0);
  const diagonal = readyFixture(["luca", null, null, null, "awp"], [{ hp: 100000 }]);
  for (let activation = 0; activation < 3; activation++) fireSlot(diagonal, 4);
  assert.equal(diagonal.battle.itemRuntime[0].momentum, 0);
  const own = readyFixture(["luca"], [{ hp: 100000 }]);
  for (let activation = 0; activation < 3; activation++) fireSlot(own, 0);
  assert.equal(own.battle.itemRuntime[0].momentum, 1, "Luca's own normal attack contributes to the rhythm");
  const duo = readyFixture(["luca", "luca", "beer"], [{ hp: 100000 }]);
  const events = fireSlot(duo, 0);
  assert.equal(events.filter(event => event.type === "activate").length, 1, "Recharge is not a free activation");
  assert.equal(duo.battle.itemRuntime[1].rhythm, 1, "Only the one real activation contributes");
});

test("target choice counters a mixed encounter instead of merely changing labels", () => {
  function result(tactic) {
    const state = readyFixture(["batomon"], [
      { uid: "near", type: "pasta", hp: 5, maxHp: 5, x: .001, speed: .1, damage: 25 },
      { uid: "green-a", type: "erbsen", hp: 25, maxHp: 25, x: .8 },
      { uid: "green-b", type: "brokkoli", hp: 25, maxHp: 25, x: .9 },
    ], { 0: tactic });
    const events = fireSlot(state, 0);
    return { willpower: state.willpower, killed: state.battle.killed, events };
  }
  const green = result("green");
  const cleanup = result("cleanup");
  assert.equal(green.killed, 2, "Type advantage removes the distant green wave efficiently");
  assert.equal(green.willpower, 75, "The weak front dish still lands its bite");
  assert.equal(cleanup.willpower, 100, "Cleanup prevents the imminent bite using the same item and timing");
});

test("finished reports sum real damage, overkill, shield blocks, leaks and retain immutable item snapshots", () => {
  const state = readyFixture(["awp", "paper", "snus"], [
    { uid: "small", type: "pasta", hp: 5, maxHp: 5, shield: 10, damage: 0 },
  ], { 0: "marked" });
  fireSlot(state, 0);
  const entry = state.battle.report.items.find(item => item.id === "awp");
  assert.equal(entry.damage, 15);
  assert.equal(entry.overkill, 33);
  assert.equal(entry.kills, 1);
  assert.equal(entry.activations, 1);
  fireSlot(state, 1);
  fireSlot(state, 2);
  state.battle.enemies.push({ ...C.ENEMIES.pasta, uid: "leak", type: "pasta", x: .001, speed: .1, hp: 100, shield: 0, damage: 20 });
  state.battle.cooldowns.fill(999);
  C.updateBattle(state, .05);
  state.battle.spawned = state.battle.total;
  C.updateBattle(state, .05);
  assert.equal(state.phase, "prep");
  const report = C.getBattleReport(state);
  assert.equal(report.items.reduce((sum, item) => sum + item.damage, 0), state.stats.damageDealt);
  assert.equal(report.damageTaken, report.willpowerStart - report.willpowerEnd);
  assert.equal(report.leaks.reduce((sum, leak) => sum + leak.damage, 0), report.damageTaken);
  assert.equal(report.items.reduce((sum, item) => sum + item.blocked, 0), state.stats.shielded);
  assert.equal(report.items.find(item => item.id === "paper").shield, 6);
  assert.equal(report.items.find(item => item.id === "snus").blocked, 10);
  assert.equal(report.items.find(item => item.id === "awp").tactic, "marked");
  assert.equal(report.items.find(item => item.id === "awp").tacticLabel, "Markierte Ziele");
  const snapshot = JSON.stringify(state.lastBattle.report);
  C.setTactic(state, 0, "threat");
  state.slots[0].level = 3;
  report.items[0].damage = -1;
  assert.equal(JSON.stringify(state.lastBattle.report), snapshot);
});

test("report activation, chain, recharge and idle totals come from actual events and survive resume", () => {
  const state = readyFixture(["beer", "luca", "awp"], [{ hp: 10000, maxHp: 10000 }]);
  state.battle.cooldowns = [0, 0, 0, 0, 0, 0];
  const events = advance(state, 8);
  const report = state.battle.report;
  assert.equal(report.items.reduce((sum, item) => sum + item.activations, 0), events.filter(event => event.type === "activate").length);
  assert.equal(report.chains.reduce((sum, chain) => sum + chain.count, 0), events.filter(event => event.type === "chain").length);
  assert.equal(report.items.reduce((sum, item) => sum + item.chains, 0), report.chains.reduce((sum, chain) => sum + chain.count, 0));
  assert.ok(report.items.find(item => item.id === "luca").recharge > 0);
  const restored = C.migrateRun(state);
  for (let tick = 0; tick < 80; tick++) assert.deepEqual(C.updateBattle(state, .1), C.updateBattle(restored, .1));
  assert.deepEqual(state, restored);
  const waiting = readyFixture(["awp"], []);
  fireSlot(waiting, 0);
  advance(waiting, .95);
  assert.ok(Math.abs(waiting.battle.report.items[0].idleTime - 1) < 1e-9);
  assert.equal(waiting.battle.report.items[0].activations, 0);
});

test("old v2 saves migrate additively without rerolling offers or replacing their in-flight wave", () => {
  const current = C.createRun("legacy-strategy");
  current.slots[1] = fixtureItem("awp", 1);
  C.startBattle(current);
  C.updateBattle(current, .7);
  const old = JSON.parse(JSON.stringify(current));
  delete old.formationPlan;
  delete old.slots[1].tactic;
  for (const key of ["formationId", "enemyTypes", "spawnEvery", "hpMultiplier", "speedMultiplier", "cooldownMax", "itemRuntime", "chainReady", "shieldSources", "report", "balance"]) delete old.battle[key];
  old.battle.total = C.COURSES[0].total;
  const before = JSON.stringify(old);
  const restored = C.migrateRun(old);
  assert.equal(JSON.stringify(old), before);
  assert.deepEqual(restored.shop, old.shop);
  assert.equal(restored.randomState, old.randomState);
  assert.equal(restored.battle.formationId, undefined);
  assert.equal(C.getBattlePlan(restored).formation.id, "legacy");
  assert.equal(restored.battle.report.partial, true);
  restored.battle.nextSpawn = restored.battle.time;
  restored.battle.cooldowns.fill(999);
  const spawned = restored.battle.spawned;
  C.updateBattle(restored, .05);
  assert.equal(restored.battle.enemies.at(-1).type, C.COURSES[0].enemyTypes[spawned]);
  assert.equal(restored.battle.nextSpawn, old.battle.time + C.COURSES[0].spawnEvery);
  const resumed = C.migrateRun(restored);
  for (let tick = 0; restored.phase === "battle" && tick < 200; tick++) assert.deepEqual(C.updateBattle(restored, .5), C.updateBattle(resumed, .5));
  assert.deepEqual(restored, resumed);
});

test("all formations resolve for distinct burst, control and scaling builds across seeds", () => {
  const builds = [
    ["desolator", "awp", "luca", "paper", "beer", "snus"],
    ["ventilator", "gabel", "headset", "kaffee", "discord", "paper"],
    ["luca", "discord", "headset", "beer", "snus", "batomon"],
  ];
  let resolved = 0;
  for (let seed = 0; seed < 8; seed++) for (const ids of builds) {
    const state = C.createRun(`build-${seed}`);
    state.slots = ids.map((id, index) => fixtureItem(id, index, 2));
    for (let course = 0; course < 6; course++) {
      completeBattle(state);
      const report = C.getBattleReport(state);
      assert.ok(report && report.duration > 0 && report.duration < 180);
      assert.ok(Math.abs(report.damageTaken - report.leaks.reduce((sum, leak) => sum + leak.damage, 0)) < 1e-9);
      if (["won", "lost"].includes(state.phase)) { resolved++; break; }
    }
  }
  assert.equal(resolved, 24);
});


test("the same upgraded finale roster can win or lose through targeting", () => {
  function finale(awp, desolator) {
    const state = C.createRun("tactics-compare");
    // The stronger finale requires upgrades; this roster costs 88 of the 92 coins
    // available before course six, rather than granting arbitrary item levels.
    fund(state, C.ECONOMY.courseIncome.slice(0, 5).reduce((sum, income) => sum + income, 0));
    for (const id of ["desolator", "awp", "luca", "headset"]) { setOffer(state, id); assert.equal(C.buyItem(state, 0), true); }
    const byId = new Map(state.slots.filter(Boolean).map(item => [item.id, item]));
    state.slots = ["desolator", "awp", "luca", "serviette", "paper", "headset"].map(id => byId.get(id));
    const desiredLevels = [3, 2, 3, 2, 3, 1];
    desiredLevels.forEach((level, index) => { while (state.slots[index].level < level) assert.equal(C.upgradeItem(state, index), true); });
    assert.equal(state.stats.coinsSpent, 88);
    assert.equal(state.coins, state.stats.coinsEarned - state.stats.coinsSpent);
    state.course = 5;
    assert.equal(C.setTactic(state, 0, desolator), true);
    assert.equal(C.setTactic(state, 1, awp), true);
    assert.equal(C.setTactic(state, 2, "strongest"), true);
    C.startBattle(state);
    for (let tick = 0; state.phase === "battle" && tick < 2000; tick++) C.updateBattle(state, .1);
    return state;
  }
  const supportAndBoss = finale("threat", "front");
  const mismatchedMark = finale("marked", "front");
  assert.equal(supportAndBoss.phase, "won");
  assert.equal(mismatchedMark.phase, "lost", "Front marks divert the AWP while the dessert advances");
  assert.ok(supportAndBoss.willpower > 0);
  assert.equal(mismatchedMark.willpower, 0);
});

test("distinct paid damage builds can beat the finale within the real 92-coin budget", () => {
  const builds = [
    { name: "area control", ids: ["discord", "headset", "podcast", "ventilator", "gabel", "kaffee"], levels: [2, 3, 2, 2, 2, 2], spent: 92 },
    { name: "physical disposal", ids: ["serviette", "brotdose", "kaffee", "paper", "ventilator", "gabel"], levels: [3, 2, 3, 2, 2, 3], spent: 92 },
    { name: "voice crew", ids: ["discord", "luca", "umut", "headset", "beer", "walkie"], levels: [3, 2, 2, 2, 2, 2], spent: 88 },
    { name: "damage without slowing or pushing", ids: ["serviette", "brotdose", "awp", "gabel", "desolator", "batomon"], levels: [2, 3, 2, 2, 2, 2], spent: 88 },
    { name: "marked sniper", ids: ["luca", "awp", "headset", "desolator", "paper", "serviette"], levels: [3, 3, 2, 2, 2, 2], spent: 92, tactics: { 1: "threat", 3: "armored" } },
  ];
  for (const build of builds) {
    const state = budgetedFinale(build.ids, build.levels, build.tactics);
    assert.equal(state.stats.coinsSpent, build.spent, build.name);
    assert.equal(C.startBattle(state), true);
    let bossUid;
    let bossKilled = false;
    for (let tick = 0; state.phase === "battle" && tick < 1800; tick++) {
      bossUid ||= state.battle.enemies.find(enemy => enemy.boss)?.uid;
      const events = C.updateBattle(state, .1);
      bossKilled ||= events.some(event => event.type === "kill" && event.enemyUid === bossUid);
    }
    assert.equal(state.phase, "won", build.name);
    assert.equal(bossKilled, true, `${build.name} must actually kill the dessert`);
    assert.ok(state.willpower > 0 && state.willpower <= 100, build.name);
    const report = C.getBattleReport(state);
    assert.equal(report.killed + report.escaped, state.lastBattle.total, build.name);
    assert.ok(report.duration < 120, build.name);
    assert.equal(state.coins, state.stats.coinsEarned - state.stats.coinsSpent, build.name);
  }
});

test("three paid level-three heaters cannot lock the boss behind support and slowing", () => {
  const state = budgetedFinale(
    ["ventilator", "headset", "ventilator", "ritalin", "ventilator", "kaffee"],
    [3, 1, 3, 1, 3, 1],
  );
  assert.equal(state.stats.coinsSpent, 88);
  assert.equal(C.startBattle(state), true);
  let bossUid;
  let bossEscaped = false;
  for (let tick = 0; state.phase === "battle" && tick < 1800; tick++) {
    bossUid ||= state.battle.enemies.find(enemy => enemy.boss)?.uid;
    const events = C.updateBattle(state, .1);
    bossEscaped ||= events.some(event => event.type === "hit" && event.enemyUid === bossUid);
  }
  assert.equal(state.phase, "lost", "Knockback must not turn a low-damage heater board into an automatic win or stall");
  assert.equal(bossEscaped, true, "The dessert must keep advancing through repeated push and slow effects");
  assert.equal(state.willpower, 0);
  assert.ok(C.getBattleReport(state).duration < 120);
});

test("headset pulses slow actual movement for two to 2.4 seconds and then expire", () => {
  for (const [level, duration, cooldown] of [[1, 2, 5.4], [2, 2.2, 4.97], [3, 2.4, 4.54]]) {
    const state = readyFixture(["headset"], [{ hp: 1000, maxHp: 1000, x: .8, speed: .1 }]);
    state.slots[0].level = level;
    fireSlot(state, 0);
    const enemy = state.battle.enemies[0];
    assert.ok(Math.abs(enemy.slowUntil - (.05 + duration)) < 1e-9);
    assert.ok(Math.abs(enemy.x - (.8 - .1 * .42 * .05)) < 1e-9, "The slow changes movement, not just status metadata");
    assert.equal(state.battle.cooldowns[0], cooldown);
    state.battle.cooldowns[0] = 999;
    advance(state, duration + .1);
    const previousX = enemy.x;
    C.updateBattle(state, .05);
    assert.ok(Math.abs(enemy.x - (previousX - .005)) < 1e-9, "Normal movement resumes after expiry");
  }
});

test("heater knockback moves normal dishes 0.045 and the boss only 0.008", () => {
  const state = readyFixture(["ventilator"], [
    { uid: "normal", x: .5 },
    { uid: "dessert", type: "dessert", boss: true, x: .5, hp: 1000, maxHp: 1000 },
  ]);
  fireSlot(state, 0);
  assert.ok(Math.abs(state.battle.enemies.find(enemy => enemy.uid === "normal").x - .545) < 1e-9);
  assert.ok(Math.abs(state.battle.enemies.find(enemy => enemy.uid === "dessert").x - .508) < 1e-9);
  assert.deepEqual(state.battle.enemies.map(enemy => enemy.hp), [92, 992]);
});

test("podcast, Umut, radios and Snus use ordinary shop costs, paid fusion and exact purchase previews", () => {
  for (const id of ["podcast", "umut", "walkie", "snus"]) {
    const state = C.createRun(`new-item-fusion-${id}`);
    fund(state, 40);
    setOffer(state, id);
    assert.equal(C.buyItem(state, 0), true);
    const first = state.slots.find(item => item?.id === id);
    assert.equal(first.level, 1);
    assert.equal(first.invested, C.ITEMS[id].price);
    if (id === "snus") {
      assert.equal(C.getItemDefinition(first).name, "Snus");
      assert.equal(C.getItemDefinition(first).iconPath, "assets/items/snus_pouch.svg");
    }
    setOffer(state, id);
    const before = JSON.stringify(state);
    const preview = C.purchasePreview(state, 0);
    assert.equal(JSON.stringify(state), before);
    assert.equal(preview.item.uid, first.uid);
    assert.equal(preview.item.level, 2);
    assert.equal(preview.item.invested, C.ITEMS[id].price * 2);
    assert.equal(C.buyItem(state, 0), true);
    const index = state.slots.findIndex(item => item?.id === id);
    assert.deepEqual(state.slots[index], preview.item);
    assert.deepEqual(C.getItemStats(state, index), preview.stats);
    assert.equal(C.getSellValue(state, index), C.ITEMS[id].price);
    assert.equal(C.getItemDefinition(state.slots[index]).iconPath, `assets/items/${id}.svg`);
    if (id === "snus") {
      assert.equal(C.getItemDefinition(state.slots[index]).name, "Päckchen Snus");
      assert.equal(C.getItemDefinition("snus", 3).name, "10er-Pack Snus");
      assert.equal(C.getItemDefinition("snus", 3).iconPath, "assets/items/snus_pack.svg");
    }
  }
  assert.equal(C.ITEMS.podcast.price, 6);
  assert.equal(C.ITEMS.umut.price, 6);
  assert.equal(C.ITEMS.walkie.price, 4);
  assert.deepEqual(C.ITEMS.umut.tags, ["voice", "crew"]);
});

test("Lanz & Precht slows and damages two front targets, then all on its actual third activation", () => {
  const state = readyFixture(["podcast"], [
    { uid: "far", x: .9, hp: 1000, maxHp: 1000, speed: .1 },
    { uid: "front", x: .2, hp: 1000, maxHp: 1000, speed: .1 },
    { uid: "middle", x: .5, hp: 1000, maxHp: 1000, speed: .1 },
    { uid: "back", x: 1, hp: 1000, maxHp: 1000, speed: .1 },
  ]);
  const first = fireSlot(state, 0);
  const firstActivation = first.find(event => event.type === "activate");
  assert.deepEqual(firstActivation.targets.map(target => target.uid), ["front", "middle"]);
  assert.equal(firstActivation.episode, 1);
  assert.equal(firstActivation.finale, false);
  assert.equal(state.battle.itemRuntime[0].episode, 1);
  assert.equal(state.battle.enemies.find(enemy => enemy.uid === "front").hp, 991);
  assert.ok(Math.abs(state.battle.enemies.find(enemy => enemy.uid === "front").x - (.2 - .1 * .42 * .05)) < 1e-9);
  assert.ok(Math.abs(state.battle.enemies.find(enemy => enemy.uid === "far").x - (.9 - .1 * .05)) < 1e-9);
  assert.ok(Math.abs(state.battle.enemies.find(enemy => enemy.uid === "front").slowUntil - 2.25) < 1e-9);
  assert.equal(first.filter(event => event.type === "attack").length, 2);
  const second = fireSlot(state, 0);
  assert.equal(second.find(event => event.type === "activate").episode, 2);
  assert.equal(second.filter(event => event.type === "attack").length, 2);
  const third = fireSlot(state, 0);
  const thirdActivation = third.find(event => event.type === "activate");
  assert.equal(thirdActivation.episode, 3);
  assert.equal(thirdActivation.finale, true);
  assert.deepEqual(thirdActivation.targets.map(target => target.uid), ["front", "middle", "far", "back"]);
  assert.equal(third.filter(event => event.type === "attack").length, 4);
  assert.equal(state.battle.itemRuntime[0].episode, 0);
  assert.ok(state.battle.enemies.every(enemy => Math.abs(enemy.slowUntil - (state.battle.time + 3.2)) < 1e-9));
  assert.equal(third.filter(event => event.id === "podcast_finale").length, 1);
  assert.equal(third.find(event => event.id === "podcast_finale").name, "Noch ein letzter Gedanke");
  assert.equal(state.battle.report.items[0].damage, 72);
  assert.equal(state.battle.report.items[0].activations, 3);
  assert.equal(state.battle.report.chains.find(chain => chain.id === "podcast_finale").count, 1);
});

test("podcast episode progress waits for enemies and only advances once per real activation", () => {
  const state = readyFixture(["podcast"], []);
  state.battle.itemRuntime[0].episode = 2;
  assert.equal(fireSlot(state, 0).filter(event => event.type === "activate").length, 0);
  assert.equal(advance(state, 1).filter(event => event.type === "chain").length, 0);
  assert.equal(C.getItemStats(state, 0).episode, 2);
  assert.equal(state.battle.report.items[0].activations, 0);
  state.battle.enemies.push({ ...C.ENEMIES.pasta, uid: "listener", type: "pasta", hp: 1000, maxHp: 1000, shield: 0, speed: 0, x: .8 });
  const events = C.updateBattle(state, .05);
  assert.equal(events.find(event => event.type === "activate").episode, 3);
  assert.equal(state.battle.itemRuntime[0].episode, 0);
  assert.equal(C.updateBattle(state, .05).filter(event => event.type === "activate").length, 0);
  state.slots[0].level = 3;
  const stats = C.getItemStats(state, 0);
  assert.equal(stats.episodeLength, 3);
  assert.ok(Math.abs(stats.slowDuration - 2.6) < 1e-9);
  assert.ok(Math.abs(stats.finaleDuration - 3.6) < 1e-9);
});

test("Umut strips the most armored dish before damage and reports one honest combined attack", () => {
  const state = readyFixture(["umut"], [
    { uid: "front", x: .1, hp: 100, shield: 0 },
    { uid: "cheese", x: .8, hp: 100, shield: 30 },
  ]);
  const events = fireSlot(state, 0);
  assert.equal(events.find(event => event.type === "activate").targets[0].uid, "cheese");
  assert.equal(events.filter(event => event.type === "attack").length, 1);
  assert.equal(events.find(event => event.type === "attack").actualAmount, 26);
  assert.equal(events.find(event => event.type === "paint").amount, 12);
  assert.equal(events.find(event => event.type === "paint").duration, 3);
  assert.equal(state.battle.enemies.find(enemy => enemy.uid === "cheese").shield, 4);
  assert.equal(state.battle.enemies.find(enemy => enemy.uid === "cheese").hp, 100);
  assert.equal(state.battle.enemies.find(enemy => enemy.uid === "front").hp, 100);
  assert.equal(state.battle.report.items[0].damage, 26);
  assert.equal(state.stats.damageDealt, 26);
  assert.equal(state.battle.enemies.find(enemy => enemy.uid === "cheese").paintSourceUid, state.slots[0].uid);
  const small = readyFixture(["umut"], [{ hp: 5, maxHp: 5, shield: 3 }]);
  const smallEvents = fireSlot(small, 0);
  assert.equal(smallEvents.find(event => event.type === "paint").amount, 3);
  assert.equal(smallEvents.find(event => event.type === "attack").actualAmount, 8);
  assert.equal(smallEvents.find(event => event.type === "attack").overkill, 9);
  assert.equal(small.battle.report.items[0].damage, 8);
  assert.equal(small.battle.report.items[0].overkill, 9);
});

test("Umut remains useful without cheese and scales strip with actual level and power synergies", () => {
  const normal = readyFixture(["umut"], [{ uid: "back", x: .8 }, { uid: "front", x: .1 }]);
  const events = fireSlot(normal, 0);
  assert.equal(events.find(event => event.type === "attack").enemyUid, "front");
  assert.equal(events.find(event => event.type === "attack").actualAmount, 14);
  assert.equal(events.find(event => event.type === "paint").amount, 0);
  const marked = readyFixture(["umut"], [{ hp: 100, shield: 3, vulnerableUntil: 10 }]);
  assert.equal(fireSlot(marked, 0).find(event => event.type === "attack").actualAmount, 20.5, "Only the normal 14 damage gets the 25% bonus; the 3 stripped shield does not");
  const supported = readyFixture(["umut", "luca"], [{ hp: 1000, shield: 1000 }]);
  supported.slots[0].level = 2;
  const stats = C.getItemStats(supported, 0);
  assert.equal(stats.power, 26.3, "14 base damage gains the level-two and adjacent Luca multipliers");
  assert.equal(stats.strip, 23, "12 base strip gains those same multipliers independently of base damage");
  assert.equal(stats.paintDuration, 3.25);
  const supportedEvents = fireSlot(supported, 0);
  assert.equal(supportedEvents.find(event => event.type === "paint").amount, stats.strip);
  assert.ok(Math.abs(supportedEvents.find(event => event.type === "attack").actualAmount - (stats.strip + stats.power)) < 1e-9);
});

test("paint prevents only real healing opportunities, attributes the amount, then allows healing after expiry", () => {
  const state = readyFixture(["umut"], [
    { uid: "coated", hp: 50, maxHp: 100, shield: 12 },
    { uid: "healer", type: "suppe", hp: 10, maxHp: 40, support: true, nextHeal: .05 },
  ]);
  const events = fireSlot(state, 0);
  const block = events.find(event => event.type === "enemy_heal_blocked");
  assert.ok(block);
  assert.equal(block.enemyUid, "coated");
  assert.equal(block.sourceSlot, 0);
  assert.equal(block.amount, 6);
  assert.equal(events.filter(event => event.type === "enemy_heal").length, 0);
  assert.equal(state.battle.enemies.find(enemy => enemy.uid === "coated").hp, 36);
  assert.equal(state.battle.report.items[0].healingPrevented, 6);
  state.battle.cooldowns[0] = 999;
  const afterExpiry = advance(state, 3.55);
  assert.equal(afterExpiry.filter(event => event.type === "enemy_heal").length, 1);
  assert.equal(afterExpiry.filter(event => event.type === "enemy_heal_blocked").length, 0);
  assert.equal(state.battle.enemies.find(enemy => enemy.uid === "coated").hp, 42);
  assert.equal(state.battle.report.items[0].healingPrevented, 6);
  for (const enemy of state.battle.enemies) enemy.hp = 0;
  state.battle.spawned = state.battle.total;
  C.updateBattle(state, .05);
  const report = C.getBattleReport(state);
  assert.equal(report.items[0].healingPrevented, 6);
  assert.ok(report.insights.some(insight => insight.includes("Umut") && insight.includes("6 Portionen Suppen-Heilung")));
});

test("paint refreshes one duration, records partial missing HP and ignores full or dead targets", () => {
  const state = readyFixture(["umut", "umut"], [
    { uid: "coated", hp: 100, maxHp: 100, shield: 100 },
    { uid: "healer", type: "suppe", hp: 10, maxHp: 40, support: true, nextHeal: 999 },
    { uid: "full", hp: 100, maxHp: 100, paintUntil: 10 },
    { uid: "dead", hp: 0, maxHp: 100, paintUntil: 10 },
  ]);
  fireSlot(state, 0);
  fireSlot(state, 1);
  const target = state.battle.enemies.find(enemy => enemy.uid === "coated");
  assert.ok(Math.abs(target.paintUntil - (state.battle.time + 3)) < 1e-9, "Second coat refreshes to now + duration, never sums durations");
  assert.equal(target.paintSourceUid, state.slots[1].uid);
  target.hp = 98;
  state.battle.enemies.find(enemy => enemy.uid === "healer").nextHeal = state.battle.time;
  state.battle.cooldowns.fill(999);
  const blocked = C.updateBattle(state, .05).filter(event => event.type === "enemy_heal_blocked");
  assert.equal(blocked.length, 1);
  assert.equal(blocked[0].amount, 2);
  assert.equal(state.battle.report.items.find(item => item.uid === state.slots[0].uid).healingPrevented, 0);
  assert.equal(state.battle.report.items.find(item => item.uid === state.slots[1].uid).healingPrevented, 2);
});

test("Walkie-Talkies recharge only the exact opposite occupied slot for all six positions", () => {
  for (let source = 0; source < 6; source++) {
    const ids = Array(6).fill("paper");
    ids[source] = "walkie";
    const state = readyFixture(ids, []);
    state.battle.cooldowns.fill(10);
    const remote = 5 - source;
    assert.equal(C.getItemStats(state, source).remoteSlot, remote);
    const events = fireSlot(state, source);
    const activation = events.find(event => event.type === "activate");
    assert.deepEqual(activation.rechargedSlots, [remote]);
    assert.equal(events.filter(event => event.type === "activate").length, 1);
    assert.equal(state.battle.shield, 5);
    assert.ok(Math.abs(state.battle.cooldowns[remote] - 8.75) < 1e-9);
    for (let index = 0; index < 6; index++) if (index !== source && index !== remote) assert.ok(Math.abs(state.battle.cooldowns[index] - 9.95) < 1e-9);
    assert.ok(Math.abs(state.battle.report.items.find(item => item.id === "walkie").recharge - 1.2) < 1e-9);
    assert.equal(state.coins, C.ECONOMY.startingCoins);
    assert.equal(state.willpower, 100);
  }
});

test("radio recharge clamps at zero, ignores empty/ready opposite slots and never invents remote activation", () => {
  const empty = readyFixture(["walkie"], []);
  assert.deepEqual(fireSlot(empty, 0).find(event => event.type === "activate").rechargedSlots, []);
  assert.equal(empty.battle.report.items[0].recharge, 0);
  const ready = readyFixture(["serviette", null, null, null, null, "walkie"], []);
  ready.battle.cooldowns[0] = 0;
  assert.deepEqual(fireSlot(ready, 5).find(event => event.type === "activate").rechargedSlots, []);
  assert.equal(ready.battle.report.items.find(item => item.id === "walkie").recharge, 0);
  const nearlyReady = readyFixture(["walkie", null, null, null, null, "serviette"], []);
  nearlyReady.battle.cooldowns[5] = .2;
  nearlyReady.battle.shield = 35;
  const events = fireSlot(nearlyReady, 0);
  assert.equal(nearlyReady.battle.cooldowns[5], 0);
  assert.ok(Math.abs(nearlyReady.battle.report.items.find(item => item.id === "walkie").recharge - .2) < 1e-9);
  assert.equal(events.find(event => event.type === "shield").amount, 0);
  assert.equal(events.filter(event => event.type === "activate").length, 1, "The empty attacking slot waits; recharge does not make a free attack");
  const pair = readyFixture(["walkie", null, null, null, null, "walkie"], []);
  pair.battle.cooldowns[5] = 8;
  assert.equal(fireSlot(pair, 0).filter(event => event.type === "activate").length, 1);
  assert.equal(pair.battle.report.items.reduce((sum, item) => sum + item.activations, 0), 1);
  const bench = C.createRun("radio-reserve");
  bench.bench.push(fixtureItem("walkie", 6, 3));
  assert.equal(C.getItemStats(bench, 6).remoteSlot, null);
  assert.equal(C.getItemStats(bench, 6).recharge, 1.8);
});

test("the six new synergies are orthogonal and advertise their actual cooldown or power effects", () => {
  const pairs = [
    ["podcast", "headset", "Noch ein Gedanke", "cooldown", .85],
    ["podcast", "paper", "Erst mal ausdiskutieren", "power", 1.25],
    ["umut", "discord", "Frisch gestrichen im Voice", "cooldown", .85],
    ["umut", "luca", "Abend mit den Jungs", "power", 1.25],
    ["walkie", "podcast", "Sendepause", "cooldown", .85],
    ["walkie", "snus", "Mund besetzt, Funk bereit", "cooldown", .85],
  ];
  for (const [first, second, name, stat, multiplier] of pairs) {
    const state = C.createRun(`new-synergy-${first}-${second}`);
    state.slots = [fixtureItem(first, 0), fixtureItem(second, 1), null, null, null, null];
    const precision = stat === "power" ? 10 : 100;
    for (const index of [0, 1]) assert.equal(C.getItemStats(state, index)[stat], Math.round(C.ITEMS[state.slots[index].id][stat] * multiplier * precision) / precision);
    assert.ok(C.getSynergies(state).some(synergy => synergy.name === name));
    assert.ok(C.getPotentialSynergies().some(synergy => synergy.name === name));
    C.moveItem(state, 1, 4);
    assert.equal(C.getSynergies(state).length, 0, `${name} does not apply diagonally`);
  }
});

test("the new voice/audio items do not impersonate gaming activations or stack beer focus", () => {
  const state = readyFixture(["luca", "umut", "beer", "podcast", "walkie"], [{ hp: 10000, maxHp: 10000 }]);
  fireSlot(state, 1);
  fireSlot(state, 3);
  fireSlot(state, 4);
  assert.equal(state.battle.itemRuntime[0].rhythm, 0);
  assert.equal(state.battle.itemRuntime[0].momentum, 0);
  fireSlot(state, 2);
  assert.equal(state.battle.itemRuntime[1].focus, 0, "Umut keeps voice/crew identity rather than inheriting gaming-only buffs");
});

test("episode, coating, blocked-healing totals and remote cooldown survive mid-fight save restoration", () => {
  const state = readyFixture(["podcast", "umut", "walkie", "luca", "paper", "headset"], [
    { uid: "painted", hp: 1000, maxHp: 1000, shield: 100 },
    { uid: "healer", type: "suppe", support: true, nextHeal: .05, hp: 1000, maxHp: 1000 },
  ]);
  fireSlot(state, 0);
  fireSlot(state, 0);
  fireSlot(state, 1);
  fireSlot(state, 2);
  assert.equal(state.battle.itemRuntime[0].episode, 2);
  assert.ok(state.battle.enemies.find(enemy => enemy.uid === "painted").paintUntil > state.battle.time);
  const restored = C.migrateRun(state);
  for (let tick = 0; tick < 100; tick++) assert.deepEqual(C.updateBattle(state, .1), C.updateBattle(restored, .1));
  assert.deepEqual(state, restored);
});

test("old version-two shops and runtimes gain optional fields without consuming RNG or rerolling", () => {
  const current = readyFixture(["paper", "serviette"], [{ hp: 1000, maxHp: 1000 }]);
  const old = JSON.parse(JSON.stringify(current));
  for (const runtime of old.battle.itemRuntime) delete runtime.episode;
  for (const item of old.battle.report.items) delete item.healingPrevented;
  const before = JSON.stringify(old);
  const migrated = C.migrateRun(old);
  assert.equal(JSON.stringify(old), before);
  assert.equal(migrated.version, 2);
  assert.equal(migrated.randomState, old.randomState);
  assert.deepEqual(migrated.shop, old.shop);
  assert.ok(migrated.battle.itemRuntime.every(runtime => runtime.episode === 0));
  assert.ok(migrated.battle.report.items.every(item => item.healingPrevented === 0));
  const expected = JSON.parse(JSON.stringify(migrated));
  for (let tick = 0; tick < 20; tick++) assert.deepEqual(C.updateBattle(migrated, .1), C.updateBattle(expected, .1));
  assert.deepEqual(migrated, expected);
});

test("new item builds finish across seeded formations with honest reports and no combat stalls", () => {
  const builds = [
    ["podcast", "paper", "walkie", "umut", "luca", "discord"],
    ["umut", "discord", "headset", "paper", "snus", "walkie"],
    ["podcast", "headset", "walkie", "snus", "batomon", "paper"],
  ];
  let finished = 0;
  let prevented = 0;
  let finales = 0;
  for (let seed = 0; seed < 12; seed++) for (const ids of builds) {
    const state = C.createRun(`new-build-${seed}`);
    state.slots = ids.map((id, index) => fixtureItem(id, index, 2));
    for (let course = 0; course < 6; course++) {
      completeBattle(state);
      const report = C.getBattleReport(state);
      assert.ok(report.duration > 0 && report.duration < 180);
      assert.ok(report.items.every(item => Number.isFinite(item.damage) && item.healingPrevented >= 0));
      assert.ok(Math.abs(report.damageTaken - report.leaks.reduce((sum, leak) => sum + leak.damage, 0)) < 1e-9);
      prevented += report.items.reduce((sum, item) => sum + item.healingPrevented, 0);
      finales += report.chains.find(chain => chain.id === "podcast_finale")?.count || 0;
      if (["won", "lost"].includes(state.phase)) { finished++; break; }
    }
  }
  assert.equal(finished, 36);
  assert.ok(prevented > 0, "Real support formations encounter the coating/healing interaction");
  assert.ok(finales > 0, "Real waves last long enough for the third-episode time profile");
});

test("the economy exposes twelve starting coins and six increasing deterministic course payouts", () => {
  assert.equal(C.ECONOMY.startingCoins, 12);
  assert.deepEqual(C.ECONOMY.courseIncome, [12, 14, 16, 18, 20, 22]);
  const state = C.createRun("income-readonly");
  const before = JSON.stringify(state);
  for (let course = 0; course < 6; course++) assert.equal(C.getCourseIncome(course), C.ECONOMY.courseIncome[course]);
  for (const invalid of [-1, 6, 1.5, "1", null, undefined]) assert.equal(C.getCourseIncome(invalid), 0);
  assert.equal(JSON.stringify(state), before);
  assert.equal(state.stats.coinsEarned, 12);
  assert.equal(state.coins, state.stats.coinsEarned - state.stats.coinsSpent);
});

test("every course pays its advertised income exactly once, including the final victory; defeat pays zero", () => {
  for (let course = 0; course < 6; course++) {
    const state = C.createRun(`income-${course}`);
    state.course = course;
    C.startBattle(state);
    state.battle.total = 0;
    state.battle.enemyTypes = [];
    const events = C.updateBattle(state, .05);
    const income = C.getCourseIncome(course);
    assert.equal(state.lastBattle.income, income);
    assert.equal(events.find(event => event.type === "victory").income, income);
    assert.equal(state.coins, C.ECONOMY.startingCoins + income);
    assert.equal(state.stats.coinsEarned, C.ECONOMY.startingCoins + income);
    assert.equal(state.stats.coursesCleared, 1);
    const before = JSON.stringify(state);
    assert.deepEqual(C.updateBattle(state, 1), []);
    assert.equal(JSON.stringify(state), before);
    assert.equal(state.phase, course === 5 ? "won" : "prep");
  }
  const lost = readyFixture(["paper"], [{ type: "dessert", x: .001, speed: .1 }]);
  const before = lost.coins;
  C.updateBattle(lost, .05);
  assert.equal(lost.phase, "lost");
  assert.equal(lost.lastBattle.income, 0);
  assert.equal(lost.coins, before);
});

test("paid upgrades have rarity-priced steps, a hard cap and atomic invalid or unaffordable rejection", () => {
  for (const id of ["serviette", "umut", "awp"]) {
    const state = C.createRun(`upgrade-${id}`);
    state.slots = [fixtureItem(id, 0), null, null, null, null, null];
    const base = C.ITEMS[id].price;
    fund(state, 40);
    assert.equal(C.getUpgradeCost(state, 0), base);
    const beforeCoins = state.coins;
    assert.equal(C.upgradeItem(state, 0), true);
    assert.equal(state.slots[0].level, 2);
    assert.equal(state.slots[0].invested, base);
    assert.equal(state.coins, beforeCoins - base);
    assert.equal(C.getUpgradeCost(state, 0), base * 2);
    assert.equal(C.upgradeItem(state, 0), true);
    assert.equal(state.slots[0].level, 3);
    assert.equal(state.slots[0].invested, base * 3);
    assert.equal(state.stats.coinsSpent, base * 3);
    assert.equal(state.coins, beforeCoins - base * 3);
    assert.equal(C.getUpgradeCost(state, 0), null);
    const capped = JSON.stringify(state);
    assert.equal(C.upgradeItem(state, 0), false);
    for (const invalid of [-1, 1, 6, .5, "0", null, undefined]) {
      assert.equal(C.getUpgradeCost(state, invalid), null);
      assert.equal(C.upgradeItem(state, invalid), false);
      assert.equal(C.upgradePreview(state, invalid), null);
    }
    assert.equal(JSON.stringify(state), capped);
  }
  const poor = C.createRun("upgrade-too-poor");
  poor.coins = 3;
  const before = JSON.stringify(poor);
  assert.equal(C.upgradeItem(poor, 0), false);
  assert.equal(JSON.stringify(poor), before, "A rejected upgrade changes no coins, IDs, inventory, RNG or stats");
});

test("ordinary upgrades preserve slot, UID, tactic and RNG, including reserve items", () => {
  const state = C.createRun("upgrade-identity");
  state.slots[1] = fixtureItem("awp", 1, 1, "marked");
  state.bench.push(fixtureItem("luca", 6, 1, "longest"));
  fund(state, 30);
  const rng = state.randomState;
  const nextUid = state.nextUid;
  const offers = JSON.stringify(state.shop.offers);
  const boardUid = state.slots[1].uid;
  const benchUid = state.bench[0].uid;
  const board = C.upgradePreview(state, 1);
  assert.equal(board.merges.length, 0);
  assert.equal(C.upgradeItem(state, 1), true);
  assert.deepEqual(state.slots[1], board.item);
  assert.equal(state.slots[1].uid, boardUid);
  assert.equal(state.slots[1].tactic, "marked");
  const bench = C.upgradePreview(state, 6);
  assert.equal(bench.index, 6);
  assert.equal(C.upgradeItem(state, 6), true);
  assert.deepEqual(state.bench[0], bench.item);
  assert.equal(state.bench[0].uid, benchUid);
  assert.equal(state.bench[0].tactic, "longest");
  assert.equal(state.bench.length, 1);
  assert.equal(state.slots.filter(Boolean).length, 3);
  assert.equal(state.randomState, rng);
  assert.equal(state.nextUid, nextUid);
  assert.equal(JSON.stringify(state.shop.offers), offers);
});

test("upgrade previews are pure, usable without funds and predict exact item, stats and synergies", () => {
  const state = C.createRun("upgrade-preview");
  state.slots[1] = fixtureItem("brotdose", 1);
  state.coins = 0;
  const before = JSON.stringify(state);
  const preview = C.upgradePreview(state, 0);
  assert.equal(JSON.stringify(state), before);
  assert.equal(preview.affordable, false);
  assert.equal(preview.cost, 4);
  assert.equal(preview.fromLevel, 1);
  assert.equal(preview.item.level, 2);
  assert.equal(preview.item.uid, state.slots[0].uid);
  assert.equal(preview.merges.length, 0);
  assert.equal(preview.stats.power, 36.5, "18 × 1.5 × 1.35 is rounded to one decimal with the adjacent brotdose synergy");
  fund(state, preview.cost);
  assert.equal(C.upgradeItem(state, 0), true);
  assert.deepEqual(state.slots[0], preview.item);
  assert.deepEqual(C.getItemStats(state, 0), preview.stats);
  assert.deepEqual(C.getSynergies(state), preview.synergies);
  assert.equal(C.getSellValue(state, 0), 2);
});

test("upgrading a later copy can fuse into the earlier level-two UID and preview finds the consumed source", () => {
  const state = C.createRun("upgrade-cascade-consumed");
  state.slots = [fixtureItem("luca", 0, 2, "longest"), null, null, null, null, null];
  state.slots[0].invested = 12;
  state.bench.push({ ...fixtureItem("luca", 6, 1, "strongest"), invested: 6 });
  fund(state, 20);
  const before = JSON.stringify(state);
  const sourceUid = state.bench[0].uid;
  const survivorUid = state.slots[0].uid;
  const preview = C.upgradePreview(state, 6);
  assert.equal(JSON.stringify(state), before);
  assert.equal(preview.cost, 6);
  assert.equal(preview.fromLevel, 1);
  assert.equal(preview.item.level, 3);
  assert.equal(preview.index, 0);
  assert.equal(preview.item.uid, survivorUid);
  assert.equal(preview.item.tactic, "longest", "Fusion keeps the surviving item's tactic");
  assert.deepEqual(preview.merges.map(merge => [merge.uid, merge.fromLevel, merge.toLevel]), [[survivorUid, 2, 3]]);
  const coins = state.coins;
  assert.equal(C.upgradeItem(state, 6), true);
  assert.equal(state.coins, coins - 6, "A fusion cascade only charges the requested upgrade step");
  assert.deepEqual(state.slots[0], preview.item);
  assert.equal(state.slots[0].invested, 24);
  assert.equal(C.getSellValue(state, 0), 12);
  assert.equal(state.bench.length, 0);
  assert.ok(![...state.slots, ...state.bench].some(item => item?.uid === sourceUid));
  assert.deepEqual(C.getItemStats(state, 0), preview.stats);
});

test("upgrading an earlier copy keeps its UID through a level-one to level-three cascade", () => {
  const state = C.createRun("upgrade-cascade-survivor");
  state.slots = [{ ...fixtureItem("awp", 0, 1, "marked"), invested: 9 }, null, null, null, null, null];
  state.bench.push({ ...fixtureItem("awp", 6, 2, "threat"), invested: 18 });
  const uid = state.slots[0].uid;
  const preview = C.upgradePreview(state, 0);
  assert.equal(preview.item.level, 3);
  assert.equal(preview.fromLevel, 1);
  assert.equal(preview.item.uid, uid);
  assert.equal(preview.merges.length, 1);
  assert.equal(C.upgradeItem(state, 0), true);
  assert.equal(state.slots[0].uid, uid);
  assert.equal(state.slots[0].tactic, "marked");
  assert.equal(state.slots[0].invested, 36);
  assert.equal(state.bench.length, 0);
  assert.equal(C.getUpgradeCost(state, 0), null);
});

test("upgraded free starters and paid copies never generate a sell/refund profit", () => {
  for (const paid of [false, true]) {
    const state = C.createRun(`upgrade-refund-${paid}`);
    if (paid) { setOffer(state, "beer"); C.buyItem(state, 0); }
    const index = paid ? 1 : 0;
    const original = state.stats.coinsEarned;
    fund(state, 30);
    const costOne = C.getUpgradeCost(state, index);
    const costTwo = costOne * 2;
    const paidBase = paid ? C.ITEMS.beer.price : 0;
    assert.equal(C.upgradeItem(state, index), true);
    assert.equal(C.upgradeItem(state, index), true);
    const invested = paidBase + costOne + costTwo;
    assert.equal(state.slots[index].invested, invested);
    assert.equal(C.getSellValue(state, index), Math.floor(invested / 2));
    assert.equal(C.sellItem(state, index), true);
    assert.equal(state.coins, state.stats.coinsEarned - state.stats.coinsSpent);
    assert.ok(state.coins <= original + 30, "Half-investment refunds cannot create money from upgrades");
  }
});

test("upgrades and upgrade previews are disabled outside preparation without mutation", () => {
  for (const phase of ["battle", "won", "lost"]) {
    const state = C.createRun(`upgrade-phase-${phase}`);
    if (phase === "battle") C.startBattle(state);
    else state.phase = phase;
    const before = JSON.stringify(state);
    assert.equal(C.getUpgradeCost(state, 0), 4, "The cost remains readable for disabled controls");
    assert.equal(C.upgradeItem(state, 0), false);
    assert.equal(C.upgradePreview(state, 0), null);
    assert.equal(JSON.stringify(state), before);
  }
});

test("new balance curves are readonly, grow across courses and snapshot separately for each battle", () => {
  const state = C.createRun("balance-readonly");
  const before = JSON.stringify(state);
  const base = C.getCourseBalance(0);
  assert.deepEqual(base, { hpScale: 1, speedScale: 1, damageScale: 1, bossHpScale: 2, bossShieldScale: 2, bossSpeedScale: .85 });
  let prior = base;
  for (let course = 1; course < 6; course++) {
    const balance = C.getCourseBalance(course);
    assert.ok(balance.hpScale > prior.hpScale && balance.speedScale > prior.speedScale && balance.damageScale > prior.damageScale);
    assert.equal(balance.hpScale, 1 + .8 * course + .08 * course * course);
    assert.equal(balance.speedScale, 1 + .17 * course);
    assert.equal(balance.damageScale, 1 + .12 * course);
    prior = balance;
  }
  for (const invalid of [-1, 6, .5, "0", undefined]) assert.equal(C.getCourseBalance(invalid), null);
  assert.equal(JSON.stringify(state), before);
  base.hpScale = 999;
  assert.equal(C.getCourseBalance(0).hpScale, 1);
  state.course = 3;
  C.startBattle(state);
  assert.deepEqual(state.battle.balance, C.getCourseBalance(3));
  const copy = C.getCourseBalance(3);
  copy.hpScale = 999;
  assert.notEqual(state.battle.balance.hpScale, 999);
});

test("new enemy HP, shield, speed and damage use the saved balance plus formation multipliers", () => {
  const state = C.createRun("balance-normal");
  state.course = 4;
  state.formationPlan[4] = "family";
  C.startBattle(state);
  state.battle.cooldowns.fill(999);
  C.updateBattle(state, .35);
  const enemy = state.battle.enemies[0];
  const balance = state.battle.balance;
  assert.equal(enemy.type, "lasagne");
  assert.equal(enemy.maxHp, Math.round(C.ENEMIES.lasagne.hp * balance.hpScale * C.FORMATIONS.family.hpMultiplier));
  assert.equal(enemy.maxShield, Math.round(C.ENEMIES.lasagne.shield * balance.hpScale * C.FORMATIONS.family.hpMultiplier));
  assert.equal(enemy.damage, Math.round(C.ENEMIES.lasagne.damage * balance.damageScale));
  assert.ok(Math.abs(enemy.speed - C.ENEMIES.lasagne.speed * balance.speedScale * C.FORMATIONS.family.speedMultiplier) < 1e-9);
  assert.deepEqual(C.ENEMIES.lasagne, { name: "Schicht-Lasagne", icon: "🥘", hp: 58, shield: 16, speed: .038, damage: 18, color: "#cb8562" });
  const original = JSON.parse(JSON.stringify(state));
  const resumed = C.migrateRun(state);
  assert.deepEqual(resumed.battle.balance, balance);
  for (let tick = 0; tick < 40; tick++) assert.deepEqual(C.updateBattle(original, .1), C.updateBattle(resumed, .1));
  assert.deepEqual(original, resumed);
});

test("the dessert has 720 HP and a longer approach while running saves without balance keep the old boss", () => {
  function spawnBoss(legacy) {
    const state = C.createRun(`balance-boss-${legacy}`);
    state.course = 5;
    state.slots = [fixtureItem("paper", 0), null, null, null, null, null];
    C.startBattle(state);
    state.battle.enemyTypes = ["dessert"];
    state.battle.total = 1;
    state.battle.cooldowns.fill(999);
    if (legacy) delete state.battle.balance;
    const restored = C.migrateRun(state);
    if (legacy) assert.equal(restored.battle.balance, undefined);
    C.updateBattle(restored, .35);
    return restored.battle.enemies[0];
  }
  const boss = spawnBoss(false);
  assert.equal(boss.maxHp, 720);
  assert.equal(boss.maxShield, 44);
  assert.ok(Math.abs(boss.speed - .032 * .85) < 1e-9);
  assert.equal(boss.damage, 320);
  const old = spawnBoss(true);
  assert.equal(old.maxHp, 360);
  assert.equal(old.maxShield, 22);
  assert.equal(old.speed, .032);
  assert.equal(old.damage, 280);
  assert.equal(C.ENEMIES.dessert.hp, 360, "Base definitions remain unchanged for legacy battles");
});

test("a pre-balance in-flight normal wave retains old scaling and earns the new future payout", () => {
  const state = C.createRun("balance-legacy-normal");
  state.course = 3;
  state.formationPlan[3] = "family";
  C.startBattle(state);
  delete state.battle.balance;
  state.battle.cooldowns.fill(999);
  const before = JSON.stringify(state);
  const restored = C.migrateRun(state);
  assert.equal(JSON.stringify(state), before);
  assert.equal(restored.battle.balance, undefined);
  C.updateBattle(restored, .35);
  const enemy = restored.battle.enemies[0];
  assert.equal(enemy.maxHp, Math.round(58 * (1 + 3 * .38) * 1.2));
  assert.equal(enemy.maxShield, Math.round(16 * (1 + 3 * .38) * 1.2));
  assert.equal(enemy.damage, Math.round(18 * (1 + 3 * .08)));
  assert.ok(Math.abs(enemy.speed - .038 * (1 + 3 * .14) * .85) < 1e-9);
  restored.battle.enemies = [];
  restored.battle.spawned = restored.battle.total;
  C.updateBattle(restored, .05);
  assert.equal(restored.lastBattle.income, C.getCourseIncome(3));
  assert.equal(restored.coins, C.ECONOMY.startingCoins + C.getCourseIncome(3));
});

test("version-two economic saves keep real coins, offers, investments and history unchanged", () => {
  const old = C.createRun("old-real-economy");
  old.coins = 3;
  old.stats.coinsEarned = 10;
  old.stats.coinsSpent = 7;
  old.slots[0].level = 2;
  old.slots[0].invested = 4;
  old.shop.rerolls = 2;
  old.shop.offers[0].locked = true;
  old.lastBattle = { course: 0, killed: 7, escaped: 0, total: 7, income: 6 };
  const before = JSON.stringify(old);
  const restored = C.migrateRun(old);
  assert.equal(JSON.stringify(old), before);
  assert.deepEqual(restored, old);
  assert.notEqual(restored, old);
  assert.equal(restored.coins, 3);
  assert.equal(restored.slots[0].invested, 4);
  assert.equal(restored.lastBattle.income, 6);
});

test("Ritalin levels improve recharge support and shorten the pulse interval", () => {
  const state = C.createRun("ritalin-levels");
  state.slots = [fixtureItem("ritalin", 0), null, null, null, null, null];
  for (const [level, recharge, cooldown] of [[1, 1.2, 6], [2, 1.5, 5.52], [3, 1.8, 5.04]]) {
    state.slots[0].level = level;
    const stats = C.getItemStats(state, 0);
    assert.equal(stats.power, 0);
    assert.equal(stats.effect, "haste");
    assert.equal(stats.recharge, recharge);
    assert.equal(stats.cooldown, cooldown);
  }
  assert.deepEqual(C.getTactics("ritalin"), []);
  assert.ok(C.getPotentialSynergies().every(synergy => !synergy.ids.includes("ritalin")));
});

test("Ritalin pulses affect exact orthogonal neighbors from every slot, without attacks, shield or self-recharge", () => {
  const neighborMap = [[1, 3], [0, 2, 4], [1, 5], [0, 4], [1, 3, 5], [2, 4]];
  for (let source = 0; source < 6; source++) {
    const ids = Array(6).fill("serviette");
    ids[source] = "ritalin";
    const state = readyFixture(ids, [{ hp: 1000, maxHp: 1000 }]);
    state.battle.cooldowns.fill(10);
    state.battle.shield = 13;
    const coins = state.coins;
    const events = fireSlot(state, source);
    const activation = events.find(event => event.type === "activate");
    assert.equal(events.filter(event => event.type === "activate").length, 1);
    assert.equal(activation.effect, "haste");
    assert.equal(activation.power, 0);
    assert.equal(activation.recharge, 1.2);
    assert.deepEqual(activation.targets, []);
    assert.deepEqual(activation.rechargedSlots, neighborMap[source]);
    assert.equal(state.battle.cooldowns[source], 6);
    for (let index = 0; index < 6; index++) if (index !== source) {
      const expected = 9.95 - (neighborMap[source].includes(index) ? 1.2 : 0);
      assert.ok(Math.abs(state.battle.cooldowns[index] - expected) < 1e-9);
    }
    assert.equal(state.battle.enemies[0].hp, 1000);
    assert.equal(state.battle.shield, 13);
    assert.equal(state.willpower, 100);
    assert.equal(state.coins, coins);
    assert.ok(events.every(event => !["attack", "shield", "guard", "kill", "slow", "chain"].includes(event.type)));
    const report = state.battle.report.items.find(item => item.id === "ritalin");
    assert.equal(report.damage, 0);
    assert.equal(report.shield, 0);
    assert.equal(report.activations, 1);
    assert.ok(Math.abs(report.recharge - neighborMap[source].length * 1.2) < 1e-9);
  }
});

test("the active pulse works without enemies, clamps cooldowns and ignores empty, ready and reserve items", () => {
  const state = readyFixture(["ritalin", "serviette", null, "serviette"], []);
  state.battle.cooldowns[1] = 0;
  state.battle.cooldowns[3] = .2;
  state.bench.push(fixtureItem("ritalin", 6, 3), fixtureItem("awp", 7));
  const reserve = JSON.stringify(state.bench);
  const events = fireSlot(state, 0);
  const activation = events.find(event => event.type === "activate");
  assert.deepEqual(activation.rechargedSlots, [3]);
  assert.equal(state.battle.cooldowns[1], 0);
  assert.equal(state.battle.cooldowns[3], 0);
  assert.equal(state.battle.cooldowns.length, 6);
  assert.equal(events.filter(event => event.type === "activate").length, 1);
  assert.ok(Math.abs(state.battle.report.items[0].recharge - .2) < 1e-9);
  assert.equal(JSON.stringify(state.bench), reserve);
  state.battle.cooldowns[3] = 10;
  const quiet = advance(state, 1);
  assert.equal(quiet.filter(event => event.type === "activate").length, 0, "An active pulse does not create a passive recharge aura");
  assert.ok(Math.abs(state.battle.cooldowns[3] - 9) < 1e-9);
  assert.ok(Math.abs(state.battle.report.items[0].recharge - .2) < 1e-9);
});

test("Ritalin purchases, duplicate fusion, upgrades, previews and selling use the normal paid rules", () => {
  const state = C.createRun("ritalin-fusion");
  setOffer(state, "ritalin");
  assert.equal(C.buyItem(state, 0), true);
  const uid = state.slots[1].uid;
  assert.equal(state.slots[1].invested, 6);
  setOffer(state, "ritalin");
  const before = JSON.stringify(state);
  const preview = C.purchasePreview(state, 0);
  assert.equal(JSON.stringify(state), before);
  assert.equal(preview.item.level, 2);
  assert.equal(preview.item.uid, uid);
  assert.equal(preview.stats.recharge, 1.5);
  assert.equal(C.buyItem(state, 0), true);
  assert.deepEqual(state.slots[1], preview.item);
  assert.equal(state.slots[1].invested, 12);
  fund(state, 12);
  const upgrade = C.upgradePreview(state, 1);
  assert.equal(upgrade.cost, 12);
  assert.equal(upgrade.item.level, 3);
  assert.equal(upgrade.stats.recharge, 1.8);
  assert.equal(C.upgradeItem(state, 1), true);
  assert.equal(state.slots[1].uid, uid);
  assert.equal(state.slots[1].invested, 24);
  assert.equal(C.getSellValue(state, 1), 12);
  assert.equal(C.sellItem(state, 1), true);
  assert.equal(state.coins, state.stats.coinsEarned - state.stats.coinsSpent);
});

test("recharge pulses and their report totals resume deterministically beside gaming items", () => {
  const state = readyFixture(["ritalin", "luca", "awp", "paper", "ritalin", "headset"], [{ hp: 10000, maxHp: 10000 }]);
  state.battle.cooldowns = [0, 2, 3, 4, 5, 6];
  C.updateBattle(state, .5);
  const restored = C.migrateRun(state);
  for (let tick = 0; tick < 120; tick++) assert.deepEqual(C.updateBattle(state, .1), C.updateBattle(restored, .1));
  assert.deepEqual(state, restored);
  const pulses = state.battle.report.items.filter(item => item.id === "ritalin");
  assert.ok(pulses.every(item => item.activations > 0 && item.recharge > 0 && item.damage === 0 && item.shield === 0));
});

test("mutually recharging level-three pulse items finish a real wave without recursive activations", () => {
  const state = C.createRun("mutual-pulses");
  state.slots = Array.from({ length: 6 }, (_, index) => fixtureItem("ritalin", index, 3));
  C.startBattle(state);
  const restored = C.migrateRun(state);
  for (let tick = 0; state.phase === "battle" && tick < 300; tick++) {
    const events = C.updateBattle(state, .5);
    assert.deepEqual(events, C.updateBattle(restored, .5));
    assert.ok(events.filter(event => event.type === "activate").length <= 60, "Each item has at most one scheduled activation per 50ms step");
    assert.equal(events.filter(event => event.type === "attack" || event.type === "shield").length, 0);
  }
  assert.deepEqual(state, restored);
  assert.notEqual(state.phase, "battle");
  const report = C.getBattleReport(state);
  assert.equal(report.killed, 0);
  assert.equal(report.escaped, C.FORMATIONS.swarm.enemyTypes.length);
  assert.ok(report.items.every(item => item.damage === 0 && item.shield === 0 && item.activations > 0));
  assert.ok(report.items.reduce((sum, item) => sum + item.recharge, 0) > 0);
});

function reserveFixture(seed = "reserve-capacity") {
  const state = C.createRun(seed);
  fund(state, 80);
  state.slots = ["serviette", "paper", "headset", "ventilator", "gabel", "kaffee"].map((id, index) => fixtureItem(id, index));
  state.bench = ["beer", "snus", "luca"].map((id, index) => fixtureItem(id, index + 6));
  return state;
}

test("the bank holds at most three newly purchased items and rejects a fourth atomically", () => {
  assert.equal(C.MAX_BENCH_SIZE, 3);
  const state = reserveFixture("reserve-fill");
  state.bench = [];
  for (const id of ["awp", "umut", "podcast"]) {
    setOffer(state, id);
    assert.ok(C.purchasePreview(state, 0));
    assert.equal(C.buyItem(state, 0), true);
  }
  assert.equal(state.bench.length, 3);
  setOffer(state, "ritalin");
  state.shop.offers[0].locked = true;
  const before = JSON.stringify(state);
  const uid = state.nextUid;
  assert.equal(C.purchasePreview(state, 0), null);
  assert.equal(C.buyItem(state, 0), false);
  assert.equal(JSON.stringify(state), before, "Coins, RNG, next UID, offer locks, stats and inventory all remain unchanged");
  assert.equal(state.nextUid, uid);
  assert.equal(state.shop.offers[0].id, "ritalin");
  assert.equal(state.shop.offers[0].locked, true);
});

test("a full bank allows a new purchase directly onto an empty table slot, even in an unaffordable preview", () => {
  const state = reserveFixture("reserve-free-table");
  state.slots[2] = null;
  state.coins = 0;
  setOffer(state, "ritalin");
  const before = JSON.stringify(state);
  const preview = C.purchasePreview(state, 0);
  assert.ok(preview);
  assert.equal(preview.affordable, false);
  assert.equal(preview.index, 2);
  assert.equal(preview.item.id, "ritalin");
  assert.equal(preview.state.bench.length, 3);
  assert.equal(JSON.stringify(state), before);
  assert.equal(C.buyItem(state, 0), false, "A legal inventory preview does not bypass payment");
  assert.equal(JSON.stringify(state), before);
  fund(state, C.ITEMS.ritalin.price);
  assert.equal(C.buyItem(state, 0), true);
  assert.deepEqual(state.slots[2], preview.item);
  assert.equal(state.bench.length, 3);
});

test("a full bank still allows real fusion on the table or bank and retains the survivor UID and tactic", () => {
  const table = reserveFixture("reserve-table-fusion");
  const tableUid = table.slots[0].uid;
  const bankIds = table.bench.map(item => item.uid);
  setOffer(table, "serviette");
  assert.ok(C.purchasePreview(table, 0));
  assert.equal(C.buyItem(table, 0), true);
  assert.equal(table.slots[0].uid, tableUid);
  assert.equal(table.slots[0].level, 2);
  assert.equal(table.bench.length, 3);
  assert.deepEqual(table.bench.map(item => item.uid), bankIds);
  const bank = reserveFixture("reserve-bank-fusion");
  bank.bench[2].tactic = "longest";
  bank.bench[2].invested = 6;
  const uid = bank.bench[2].uid;
  setOffer(bank, "luca");
  const preview = C.purchasePreview(bank, 0);
  assert.equal(preview.index, 8);
  assert.equal(preview.item.uid, uid);
  assert.equal(preview.item.level, 2);
  assert.equal(C.buyItem(bank, 0), true);
  assert.deepEqual(bank.bench[2], preview.item);
  assert.equal(bank.bench[2].invested, 12);
  assert.equal(bank.bench[2].tactic, "longest");
  assert.equal(bank.bench.length, 3);
});

test("full-bank cascade purchases free reserve space while max-level or mismatched copies do not", () => {
  const cascade = reserveFixture("reserve-cascade");
  cascade.bench = [
    { ...fixtureItem("awp", 6, 1, "marked"), invested: 9 },
    { ...fixtureItem("awp", 7, 2, "threat"), invested: 18 },
    fixtureItem("snus", 8),
  ];
  const uid = cascade.bench[0].uid;
  setOffer(cascade, "awp");
  const preview = C.purchasePreview(cascade, 0);
  assert.equal(preview.item.uid, uid);
  assert.equal(preview.item.level, 3);
  assert.equal(preview.state.bench.length, 2);
  assert.equal(C.buyItem(cascade, 0), true);
  assert.deepEqual(cascade.bench[0], preview.item);
  assert.equal(cascade.bench[0].invested, 36);
  assert.equal(cascade.bench[0].tactic, "marked");
  assert.equal(cascade.bench.length, 2);
  for (const level of [2, 3]) {
    const blocked = reserveFixture(`reserve-no-fusion-${level}`);
    blocked.bench[2] = fixtureItem("awp", 8, level);
    setOffer(blocked, "awp");
    const before = JSON.stringify(blocked);
    assert.equal(C.purchasePreview(blocked, 0), null, "Owning the ID alone does not create a fusion");
    assert.equal(C.buyItem(blocked, 0), false);
    assert.equal(JSON.stringify(blocked), before);
  }
});

test("full-bank capacity rejection stays separate from affordability and leaves previews pure", () => {
  const state = reserveFixture("reserve-preview-blocked");
  setOffer(state, "awp");
  for (const coins of [0, 100]) {
    state.coins = coins;
    const before = JSON.stringify(state);
    assert.equal(C.purchasePreview(state, 0), null);
    assert.equal(C.buyItem(state, 0), false);
    assert.equal(JSON.stringify(state), before);
  }
});

test("three bank items permit swaps, sorting and equipping but block new reserve space from the table", () => {
  const state = reserveFixture("reserve-moves");
  const allUids = [...state.slots, ...state.bench].map(item => item.uid).sort();
  const before = JSON.stringify(state);
  assert.equal(C.moveItem(state, 0, 9), false);
  assert.equal(JSON.stringify(state), before);
  const firstBench = state.bench[0].uid;
  assert.equal(C.moveItem(state, 6, 0), true);
  assert.equal(state.slots[0].uid, firstBench);
  assert.equal(state.bench.length, 3);
  assert.equal(C.moveItem(state, 6, 8), true);
  const toEnd = state.bench[0].uid;
  assert.equal(C.moveItem(state, 6, 9), true, "Appending an existing reserve item only sorts it");
  assert.equal(state.bench[2].uid, toEnd);
  assert.equal(state.bench.length, 3);
  assert.deepEqual([...state.slots, ...state.bench].map(item => item.uid).sort(), allUids);
  assert.equal(C.sellItem(state, 2), true);
  assert.equal(C.moveItem(state, 6, 2), true);
  assert.equal(state.bench.length, 2);
  assert.equal(C.moveItem(state, 0, 8), true);
  assert.equal(state.bench.length, 3);
  assert.equal(state.slots[0], null);
  assert.equal(C.startBattle(state), true);
});

test("legacy overflowing inventories survive migration and can shrink or rearrange before battle", () => {
  for (const version of [1, 2]) {
    const old = reserveFixture(`legacy-reserve-${version}`);
    old.version = version;
    old.bench.push(fixtureItem("ritalin", 9), fixtureItem("awp", 10));
    const before = JSON.stringify(old);
    const oldUids = [...old.slots, ...old.bench].map(item => item.uid).sort();
    const state = C.migrateRun(old);
    assert.equal(JSON.stringify(old), before);
    assert.equal(state.bench.length, 5);
    assert.deepEqual([...state.slots, ...state.bench].map(item => item.uid).sort(), oldUids);
    const saved = JSON.stringify(state);
    assert.equal(C.startBattle(state), false);
    assert.equal(C.moveItem(state, 0, 11), false);
    assert.equal(JSON.stringify(state), saved);
    assert.equal(C.moveItem(state, 6, 10), true, "Legacy reserve sorting is neutral and allowed");
    assert.equal(state.bench.length, 5);
    assert.equal(C.moveItem(state, 6, 0), true, "Swapping with an occupied table slot is neutral and allowed");
    assert.equal(state.bench.length, 5);
    assert.equal(C.upgradeItem(state, 6), true, "Neutral paid upgrades remain usable during legacy cleanup");
    assert.equal(state.bench.length, 5);
    assert.equal(C.sellItem(state, 1), true);
    assert.equal(C.moveItem(state, 6, 1), true);
    assert.equal(state.bench.length, 4);
    assert.equal(C.startBattle(state), false);
    assert.equal(C.sellItem(state, 2), true);
    assert.equal(C.moveItem(state, 6, 2), true);
    assert.equal(state.bench.length, 3);
    assert.equal(C.startBattle(state), true);
  }
});

test("existing running saves with an overflowing bank continue deterministically without losing inventory", () => {
  const state = reserveFixture("legacy-reserve-battle");
  assert.equal(C.startBattle(state), true);
  state.bench.push(fixtureItem("ritalin", 9), fixtureItem("awp", 10));
  const before = JSON.stringify(state.bench);
  const restored = C.migrateRun(state);
  assert.equal(restored.bench.length, 5);
  assert.equal(JSON.stringify(restored.bench), before);
  for (let tick = 0; state.phase === "battle" && tick < 100; tick++) assert.deepEqual(C.updateBattle(state, .2), C.updateBattle(restored, .2));
  assert.deepEqual(state, restored);
  assert.equal(JSON.stringify(state.bench), before);
});

function encounterFixture(id, { coins = 10, willpower = 50, course = 2 } = {}) {
  const state = C.createRun(`encounter-${id}`);
  state.course = course;
  state.coins = coins;
  state.stats.coinsEarned = coins;
  state.stats.coinsSpent = 0;
  state.willpower = willpower;
  state.encounters.pending = { id, course };
  return state;
}

function clearEmptyCourse(state) {
  assert.equal(C.startBattle(state), true);
  state.battle.total = 0;
  state.battle.enemyTypes = [];
  return C.updateBattle(state, .05);
}

test("new runs have a separate seeded five-encounter deck without consuming shop RNG or UIDs", () => {
  function hash(seed) { let value = 2166136261; for (const char of String(seed)) value = Math.imul(value ^ char.charCodeAt(0), 16777619); return value >>> 0; }
  const orders = new Set();
  for (let seed = 0; seed < 40; seed++) {
    const state = C.createRun(seed);
    const again = C.createRun(seed);
    assert.deepEqual(state.encounters.deck, again.encounters.deck);
    assert.deepEqual([...state.encounters.deck].sort(), ["anka", "bluetooth", "update", "walkie", "yusuf"]);
    assert.equal(state.encounters.pending, null);
    assert.deepEqual(state.encounters.history, []);
    assert.equal(state.encounters.nextBuff, null);
    assert.equal(C.getEncounter(state), null);
    assert.equal(C.getEventBuff(state), null);
    assert.equal(state.nextUid, 7, "Only two starter and four offer UIDs were reserved");
    assert.equal(state.randomState, (hash(seed) + Math.imul(4, 0x6D2B79F5)) >>> 0, "Only the four shop rolls consumed the shop RNG");
    assert.deepEqual(state.formationPlan, again.formationPlan);
    assert.deepEqual(state.shop, again.shop);
    orders.add(state.encounters.deck.join(","));
  }
  assert.ok(orders.size > 10);
});

test("a full six-course run offers exactly two distinct encounters after rounds two and four", () => {
  const state = C.createRun("full-encounter-deck");
  const seen = [];
  for (let course = 0; course < 6; course++) {
    assert.equal(C.getEncounter(state), null);
    clearEmptyCourse(state);
    const nextCourse = course + 1;
    if (![2, 4].includes(nextCourse)) {
      assert.equal(C.getEncounter(state), null);
      assert.equal(state.encounters.pending, null);
      assert.equal(state.phase, course === 5 ? "won" : "prep");
      if (state.phase === "prep") {
        assert.equal(C.rerollShop(state), true, "Other course breaks go directly to the shop");
      }
      continue;
    }
    assert.equal(state.phase, "prep");
    const before = JSON.stringify(state);
    const encounter = C.getEncounter(state);
    assert.equal(encounter.id, state.encounters.deck[seen.length]);
    assert.equal(encounter.course, nextCourse);
    assert.equal(encounter.progress, seen.length + 1);
    assert.equal(encounter.total, 2);
    assert.equal(encounter.choices.length, 3);
    assert.ok(encounter.choices.some(choice => choice.affordable));
    for (const field of ["title", "icon", "description", "quote"]) assert.ok(encounter[field]);
    for (const choice of encounter.choices) assert.ok(choice.id && choice.label && choice.effectText);
    encounter.choices[0].label = "edited outside the engine";
    assert.notEqual(C.getEncounter(state).choices[0].label, encounter.choices[0].label);
    assert.equal(JSON.stringify(state), before);
    seen.push(encounter.id);
    resolveEncounter(state);
  }
  assert.deepEqual(seen, state.encounters.deck.slice(0, 2));
  assert.equal(new Set(seen).size, 2);
  assert.equal(state.encounters.history.length, 2);
  assert.deepEqual(state.encounters.history.map(entry => entry.course), [2, 4]);
  assert.equal(state.encounters.nextBuff, null);
});

test("all fifteen encounter choices apply the specified immediate costs and one-course buff", () => {
  const cases = [
    ["anka", "queue", 0, 0, { gamingPowerMultiplier: 1.2 }],
    ["anka", "call", 4, -8, null],
    ["anka", "together", 0, 0, { startingShield: 8 }],
    ["bluetooth", "reclaim", -3, 0, { cooldownMultiplier: .9 }],
    ["bluetooth", "disco", 0, 0, { startingShield: 10, powerMultiplier: .95 }],
    ["bluetooth", "off", 0, 8, null],
    ["yusuf", "focus", -2, 0, { powerMultiplier: 1.12 }],
    ["yusuf", "deposit", 3, 0, { cooldownMultiplier: 1.05 }],
    ["yusuf", "quiet", 0, 7, null],
    ["update", "skip", 0, -5, { powerMultiplier: 1.1 }],
    ["update", "patch", -2, 0, { cooldownMultiplier: .9 }],
    ["update", "offline", 0, 0, { startingShield: 8 }],
    ["walkie", "later", 0, 0, { startingShield: 10 }],
    ["walkie", "round", 2, 0, { gamingPowerMultiplier: 1.15 }],
    ["walkie", "prepare", -3, 0, { powerMultiplier: 1.12 }],
  ];
  for (const [id, choiceId, coins, hp, buff] of cases) {
    const state = encounterFixture(id);
    const untouched = { uid: state.nextUid, rng: state.randomState, offers: JSON.stringify(state.shop), formation: JSON.stringify(state.formationPlan), slots: JSON.stringify(state.slots) };
    assert.equal(C.getEncounter(state).choices.find(choice => choice.id === choiceId).affordable, true);
    assert.equal(C.chooseEncounter(state, choiceId), true);
    assert.equal(state.coins, 10 + coins);
    assert.equal(state.willpower, 50 + hp);
    assert.equal(state.stats.coinsEarned, 10 + Math.max(0, coins));
    assert.equal(state.stats.coinsSpent, Math.max(0, -coins));
    assert.equal(state.coins, state.stats.coinsEarned - state.stats.coinsSpent);
    assert.equal(state.stats.damageTaken, 0, "An encounter health cost is not fabricated dish damage");
    const actual = C.getEventBuff(state);
    if (buff) {
      assert.ok(actual.label && actual.description);
      const { label, description, ...numbers } = actual;
      assert.deepEqual(numbers, buff);
    } else assert.equal(actual, null);
    assert.equal(C.getEncounter(state), null);
    assert.equal(state.encounters.history.length, 1);
    assert.equal(state.encounters.history[0].id, id);
    assert.equal(state.encounters.history[0].choiceId, choiceId);
    assert.equal(state.encounters.history[0].coinsDelta, coins);
    assert.equal(state.encounters.history[0].willpowerDelta, hp);
    assert.ok(state.encounters.history[0].message);
    assert.deepEqual({ uid: state.nextUid, rng: state.randomState, offers: JSON.stringify(state.shop), formation: JSON.stringify(state.formationPlan), slots: JSON.stringify(state.slots) }, untouched);
    const completed = JSON.stringify(state);
    assert.equal(C.chooseEncounter(state, choiceId), false);
    assert.equal(JSON.stringify(state), completed, "The same encounter cannot pay or buff twice");
  }
});

test("encounter costs reject atomically when unaffordable or lethal while retaining a free safe choice", () => {
  for (const [id, choice, coins] of [["bluetooth", "reclaim", 2], ["yusuf", "focus", 1], ["update", "patch", 1], ["walkie", "prepare", 2]]) {
    const state = encounterFixture(id, { coins, willpower: 1 });
    const before = JSON.stringify(state);
    const option = C.getEncounter(state).choices.find(candidate => candidate.id === choice);
    assert.equal(option.affordable, false);
    assert.ok(option.disabledReason);
    assert.ok(C.getEncounter(state).choices.some(candidate => candidate.affordable));
    assert.equal(C.chooseEncounter(state, choice), false);
    assert.equal(C.chooseEncounter(state, "not-a-choice"), false);
    assert.equal(JSON.stringify(state), before);
  }
  for (const [id, choice, loss] of [["anka", "call", 8], ["update", "skip", 5]]) {
    const state = encounterFixture(id, { willpower: loss });
    const before = JSON.stringify(state);
    assert.equal(C.getEncounter(state).choices.find(candidate => candidate.id === choice).affordable, false);
    assert.equal(C.chooseEncounter(state, choice), false);
    assert.equal(JSON.stringify(state), before, "A rejected Anka call cannot credit money before checking HP");
    state.willpower = loss + 1;
    assert.equal(C.chooseEncounter(state, choice), true);
    assert.equal(state.willpower, 1);
  }
  const noEncounter = C.createRun("no-pending-choice");
  const before = JSON.stringify(noEncounter);
  assert.equal(C.chooseEncounter(noEncounter, "queue"), false);
  assert.equal(JSON.stringify(noEncounter), before);
});

test("healing encounter choices cap at maximum HP and keep a truthful applied delta", () => {
  for (const [id, choice] of [["bluetooth", "off"], ["yusuf", "quiet"]]) {
    const state = encounterFixture(id, { willpower: 97 });
    assert.equal(C.chooseEncounter(state, choice), true);
    assert.equal(state.willpower, 100);
    assert.equal(state.encounters.history[0].willpowerDelta, 3);
    assert.equal(C.getEventBuff(state), null);
  }
});

test("pending encounters lock shop, upgrades, table moves, tactics and battle starts without mutation", () => {
  const state = encounterFixture("anka", { coins: 40 });
  state.slots[1] = fixtureItem("awp", 1);
  state.bench.push(fixtureItem("luca", 6));
  setOffer(state, "ritalin");
  const before = JSON.stringify(state);
  assert.equal(C.buyItem(state, 0), false);
  assert.equal(C.rerollShop(state), false);
  assert.equal(C.toggleShopLock(state, 0), false);
  assert.equal(C.sellItem(state, 0), false);
  assert.equal(C.sellItem(state, 6), false);
  assert.equal(C.heal(state), false);
  assert.equal(C.upgradeItem(state, 0), false);
  assert.equal(C.moveItem(state, 1, 2), false);
  assert.equal(C.setTactic(state, 1, "marked"), false);
  assert.equal(C.setTactic(state, 6, "longest"), false);
  assert.equal(C.purchasePreview(state, 0), null);
  assert.equal(C.upgradePreview(state, 0), null);
  assert.equal(C.startBattle(state), false);
  assert.equal(JSON.stringify(state), before);
  assert.equal(C.chooseEncounter(state, "queue"), true);
  assert.equal(C.buyItem(state, 0), true);
  assert.equal(C.setTactic(state, 1, "marked"), true);
});

test("gaming encounter strength affects only equipped gaming items and lasts exactly one fight", () => {
  const state = encounterFixture("anka");
  state.slots = [fixtureItem("headset", 0), fixtureItem("serviette", 1), null, fixtureItem("paper", 3), fixtureItem("ritalin", 4), null];
  state.bench.push(fixtureItem("awp", 6));
  const base = [0, 1, 3, 4, 6].map(index => C.getItemStats(state, index));
  assert.equal(C.chooseEncounter(state, "queue"), true);
  assert.equal(C.getItemStats(state, 0).power, Math.round(base[0].power * 1.2 * 10) / 10);
  for (const [position, index] of [[1, 1], [2, 3], [3, 4], [4, 6]]) assert.deepEqual(C.getItemStats(state, index), base[position]);
  const snapshot = C.getEventBuff(state);
  snapshot.gamingPowerMultiplier = 999;
  assert.equal(C.getEventBuff(state).gamingPowerMultiplier, 1.2);
  const buffed = C.getItemStats(state, 0);
  assert.equal(C.startBattle(state), true);
  assert.equal(state.encounters.nextBuff, null);
  assert.equal(state.battle.eventBuff.gamingPowerMultiplier, 1.2);
  assert.deepEqual(C.getItemStats(state, 0), buffed);
  state.battle.total = 0;
  state.battle.enemyTypes = [];
  const events = C.updateBattle(state, .05);
  assert.equal(events.filter(event => event.type === "event_buff").length, 1);
  assert.ok(C.getBattleReport(state).insights.some(insight => insight.includes("Noch eine Runde") && insight.includes("20 %")));
  assert.equal(C.getEventBuff(state), null);
  assert.deepEqual(C.getItemStats(state, 0), base[0]);
  assert.equal(state.course, 3);
  assert.equal(C.getEncounter(state), null, "The next break has no encounter");
  assert.equal(C.startBattle(state), true);
  assert.deepEqual(C.getItemStats(state, 0), base[0], "The previous gaming multiplier cannot leak into a later fight");
});

test("global strength and cooldown encounter modifiers apply to all table items, never the bank", () => {
  for (const [id, choice, power, cooldown] of [["yusuf", "focus", 1.12, 1], ["update", "skip", 1.1, 1], ["bluetooth", "disco", .95, 1], ["bluetooth", "reclaim", 1, .9], ["yusuf", "deposit", 1, 1.05], ["update", "patch", 1, .9]]) {
    const state = encounterFixture(id);
    state.slots = [fixtureItem("headset", 0, 2), fixtureItem("serviette", 1, 2), null, fixtureItem("paper", 3, 2), fixtureItem("ritalin", 4, 2), null];
    state.bench.push(fixtureItem("awp", 6, 2));
    const indices = [0, 1, 3, 4];
    const before = indices.map(index => C.getItemStats(state, index));
    const reserve = C.getItemStats(state, 6);
    assert.equal(C.chooseEncounter(state, choice), true);
    for (let i = 0; i < indices.length; i++) {
      const stats = C.getItemStats(state, indices[i]);
      assert.equal(stats.power, Math.round(before[i].power * power * 10) / 10);
      assert.equal(stats.cooldown, Math.round(C.ITEMS[state.slots[indices[i]].id].cooldown * (1 - .08 * (state.slots[indices[i]].level - 1)) * cooldown * 100) / 100);
      if (stats.recharge) assert.equal(stats.recharge, before[i].recharge, "Strength changes do not invent extra recharge seconds");
    }
    assert.deepEqual(C.getItemStats(state, 6), reserve);
  }
});

test("encounter start shields are bounded, block real damage and announce only once", () => {
  const state = encounterFixture("bluetooth");
  assert.equal(C.chooseEncounter(state, "disco"), true);
  assert.equal(C.startBattle(state), true);
  assert.equal(state.battle.shield, 10);
  assert.equal(state.encounters.nextBuff, null);
  state.battle.nextSpawn = 999;
  state.battle.cooldowns.fill(999);
  state.battle.enemies = [{ ...C.ENEMIES.erbsen, type: "erbsen", uid: "buff-bite", x: .001, speed: .1, hp: 100, maxHp: 100, shield: 0 }];
  const first = C.updateBattle(state, .05);
  assert.equal(first.filter(event => event.type === "event_buff").length, 1);
  assert.equal(first.find(event => event.type === "hit").amount, 0);
  assert.equal(state.battle.shield, 4);
  assert.equal(state.willpower, 50);
  assert.equal(state.stats.shielded, 6);
  assert.equal(C.updateBattle(state, .05).filter(event => event.type === "event_buff").length, 0);
  const capped = encounterFixture("walkie");
  C.chooseEncounter(capped, "later");
  capped.encounters.nextBuff.startingShield = 100;
  assert.equal(C.startBattle(capped), true);
  assert.equal(capped.battle.shield, 35);
});

test("an unsuccessful battle start does not consume the selected encounter buff", () => {
  const state = encounterFixture("walkie");
  C.chooseEncounter(state, "later");
  state.bench = ["beer", "snus", "luca", "awp"].map((id, index) => fixtureItem(id, index + 6));
  const before = JSON.stringify(state);
  assert.equal(C.startBattle(state), false);
  assert.equal(JSON.stringify(state), before);
  assert.equal(C.getEventBuff(state).startingShield, 10);
  C.sellItem(state, 6);
  assert.equal(C.startBattle(state), true);
  assert.equal(state.encounters.nextBuff, null);
  assert.equal(state.battle.shield, 10);
});

test("pending encounters, resolved history and active buffs survive save restoration deterministically", () => {
  const state = encounterFixture("walkie", { willpower: 100 });
  const pending = C.migrateRun(state);
  assert.deepEqual(pending, state);
  assert.deepEqual(C.getEncounter(pending), C.getEncounter(state));
  assert.equal(C.chooseEncounter(state, "round"), true);
  assert.equal(C.chooseEncounter(pending, "round"), true);
  assert.deepEqual(state, pending);
  for (const run of [state, pending]) {
    assert.equal(C.upgradeItem(run, 0), true);
    assert.equal(C.upgradeItem(run, 0), true);
  }
  const ready = C.migrateRun(state);
  assert.deepEqual(ready.encounters.nextBuff, state.encounters.nextBuff);
  C.startBattle(state);
  C.startBattle(ready);
  assert.deepEqual(C.updateBattle(state, .4), C.updateBattle(ready, .4));
  const midfight = C.migrateRun(state);
  for (let tick = 0; state.phase === "battle" && tick < 300; tick++) assert.deepEqual(C.updateBattle(state, .2), C.updateBattle(midfight, .2));
  assert.deepEqual(state, midfight);
  assert.equal(state.encounters.history.length, 1);
  assert.equal(state.encounters.nextBuff, null);
  assert.equal(state.course, 3);
  assert.equal(C.getEncounter(state), null);
});

test("old saves without encounters stay opted out for all remaining courses", () => {
  for (const version of [1, 2]) {
    const old = C.createRun(`legacy-no-encounters-${version}`);
    old.version = version;
    delete old.encounters;
    const before = JSON.stringify(old);
    const state = C.migrateRun(old);
    assert.equal(JSON.stringify(old), before);
    assert.equal(Object.hasOwn(state, "encounters"), false);
    for (let course = 0; course < 6; course++) {
      assert.equal(C.getEncounter(state), null);
      assert.equal(C.getEventBuff(state), null);
      clearEmptyCourse(state);
      assert.equal(Object.hasOwn(state, "encounters"), false);
    }
    assert.equal(state.phase, "won");
  }
});

test("encounter text identifies Yusuf as the Raspberry Pi assistant and the Bluetooth neighbor", () => {
  const yusuf = C.getEncounter(encounterFixture("yusuf"));
  assert.ok(yusuf.description.includes("Sprachassistent") && yusuf.description.includes("Raspberry Pi"));
  assert.ok(C.getEncounter(encounterFixture("bluetooth")).description.includes("Nachbarin"));
  const anka = C.getEncounter(encounterFixture("anka"));
  assert.ok(anka.description.includes("Lucas Freundin Anka") && anka.description.includes("Gabriel"));
});

test("migration safely opts out corrupt encounter saves instead of trapping preparation", () => {
  const corruptions = [
    state => { state.encounters.pending = { id: "unknown", course: 1 }; },
    state => { state.encounters.pending = { id: "constructor", course: 1 }; },
    state => { state.encounters.pending = { id: "anka", course: "1" }; },
    state => { state.encounters.pending = {}; },
    state => { state.encounters.deck.pop(); },
    state => { state.encounters.deck[1] = state.encounters.deck[0]; },
    state => { state.encounters.deck[1] = "unknown"; },
    state => { state.encounters.history = {}; },
    state => { state.encounters.history.push({ id: "anka", choiceId: "unknown", course: 1, message: "bad history" }); },
    state => { state.encounters.nextBuff = { label: "bad", description: "bad", cooldownMultiplier: 0 }; },
    state => { state.encounters.nextBuff = { label: "bad", description: "bad", powerMultiplier: -1 }; },
    state => { state.encounters.nextBuff = { label: "bad", description: "bad", gamingPowerMultiplier: Infinity }; },
    state => { state.encounters.nextBuff = { label: "bad", description: "bad", startingShield: -8 }; },
    state => { state.encounters = null; },
  ];
  for (const corrupt of corruptions) {
    const state = encounterFixture("anka");
    corrupt(state);
    const before = JSON.stringify(state);
    const migrated = C.migrateRun(state);
    assert.equal(JSON.stringify(state), before);
    assert.equal(Object.hasOwn(migrated, "encounters"), false);
    assert.equal(C.getEncounter(migrated), null);
    assert.equal(C.getEventBuff(migrated), null);
    assert.deepEqual(migrated.shop, state.shop);
    assert.deepEqual(migrated.slots, state.slots);
    assert.equal(migrated.coins, state.coins);
    assert.equal(C.startBattle(migrated), true);
  }
  const valid = encounterFixture("anka", { course: 4 });
  assert.deepEqual(C.migrateRun(valid), valid, "An empty history is valid; validation does not invent strict journey requirements");
});

test("invalid stored combat buffs are removed while their running battle remains playable", () => {
  const state = C.createRun("corrupt-combat-event-buff");
  C.startBattle(state);
  state.battle.eventBuff = { label: "broken", description: "broken", cooldownMultiplier: null };
  const migrated = C.migrateRun(state);
  assert.equal(migrated.phase, "battle");
  assert.equal(C.getEventBuff(migrated), null);
  assert.doesNotThrow(() => C.updateBattle(migrated, .2));
  assert.ok(migrated.battle.time > 0);
});

function historicalEncounter(id, course) {
  return { id, course, choiceId: { anka: "queue", bluetooth: "off", yusuf: "quiet", update: "offline", walkie: "later" }[id], message: "Früher gewählte Begegnung", coinsDelta: 0, willpowerDelta: 0 };
}

test("both encounter dates draw without replacement and all five pool candidates remain reachable across seeds", () => {
  const reached = new Set();
  for (let seed = 0; seed < 40; seed++) {
    const state = C.createRun(`two-encounter-pool-${seed}`);
    const drawn = [];
    for (let round = 1; round <= 6; round++) {
      clearEmptyCourse(state);
      const encounter = C.getEncounter(state);
      if ([2, 4].includes(round)) {
        assert.ok(encounter);
        assert.equal(encounter.course, round);
        assert.equal(encounter.progress, round / 2);
        assert.equal(encounter.total, 2);
        drawn.push(encounter.id);
        reached.add(encounter.id);
        resolveEncounter(state);
      } else assert.equal(encounter, null);
    }
    assert.equal(state.phase, "won");
    assert.deepEqual(drawn, state.encounters.deck.slice(0, 2));
    assert.equal(new Set(drawn).size, 2);
    assert.deepEqual(state.encounters.history.map(entry => entry.course), [2, 4]);
  }
  assert.deepEqual([...reached].sort(), ["anka", "bluetooth", "update", "walkie", "yusuf"]);
});

test("migration removes obsolete pending dates but preserves prior choices, effects, inventory, HP and money", () => {
  for (const course of [1, 3, 5]) {
    const old = encounterFixture("anka", { course });
    old.encounters.history = [historicalEncounter("bluetooth", 1), historicalEncounter("yusuf", 3), historicalEncounter("update", 5)];
    old.encounters.nextBuff = { label: "Bereits gewählte Wirkung", description: "Bleibt für den nächsten Gang erhalten.", powerMultiplier: 1.1 };
    const before = JSON.stringify(old);
    assert.equal(C.getEncounter(old), null);
    assert.equal(C.chooseEncounter(old, "queue"), false);
    assert.equal(JSON.stringify(old), before);
    const state = C.migrateRun(old);
    assert.equal(JSON.stringify(old), before);
    assert.ok(state.encounters, "A former timing date is not a corrupt encounter structure");
    assert.equal(state.encounters.pending, null);
    assert.deepEqual(state.encounters.deck, old.encounters.deck);
    assert.deepEqual(state.encounters.history, old.encounters.history);
    assert.deepEqual(state.encounters.nextBuff, old.encounters.nextBuff);
    assert.deepEqual(state.slots, old.slots);
    assert.deepEqual(state.bench, old.bench);
    assert.deepEqual(state.shop, old.shop);
    assert.deepEqual(state.stats, old.stats);
    assert.equal(state.willpower, old.willpower);
    assert.equal(state.coins, old.coins);
    assert.equal(C.getEventBuff(state).powerMultiplier, 1.1);
    assert.equal(C.getEncounter(state), null);
    assert.equal(C.startBattle(state), true, "Obsolete pending dates cannot keep the shop locked");
    assert.equal(state.battle.eventBuff.powerMultiplier, 1.1);
  }
});

test("valid pending dates two and four stay stable after restoration with historical entries intact", () => {
  for (const course of [2, 4]) {
    const old = encounterFixture("anka", { course });
    old.encounters.history = [historicalEncounter("bluetooth", 1)];
    const restored = C.migrateRun(old);
    assert.deepEqual(restored, old);
    const encounter = C.getEncounter(restored);
    assert.equal(encounter.id, "anka");
    assert.equal(encounter.progress, course / 2);
    assert.equal(encounter.total, 2);
    assert.equal(C.chooseEncounter(restored, "queue"), true);
    assert.deepEqual(restored.encounters.history[0], old.encounters.history[0]);
    assert.equal(restored.encounters.history[1].id, "anka");
    assert.equal(restored.encounters.history[1].course, course);
  }
});

test("new draws skip every previously chosen ID from the older five-encounter schedule", () => {
  const old = C.createRun("old-event-history-skip");
  old.course = 1;
  old.encounters.history = [historicalEncounter(old.encounters.deck[0], 1)];
  old.encounters.nextBuff = { label: "Alte Auswahl", description: "Wurde bereits bezahlt und gewählt.", powerMultiplier: 1.1 };
  const state = C.migrateRun(old);
  clearEmptyCourse(state);
  assert.equal(state.course, 2);
  assert.equal(C.getEncounter(state).id, state.encounters.deck[1]);
  resolveEncounter(state);
  clearEmptyCourse(state);
  assert.equal(state.course, 3);
  assert.equal(C.getEncounter(state), null);
  clearEmptyCourse(state);
  assert.equal(state.course, 4);
  assert.equal(C.getEncounter(state).id, state.encounters.deck[2]);
  assert.equal(C.getEncounter(state).progress, 2);
  resolveEncounter(state);
  assert.equal(new Set(state.encounters.history.map(entry => entry.id)).size, 3);
});

test("an unchosen obsolete pending event stays eligible in the first later scheduled draw", () => {
  const old = C.createRun("old-event-unchosen");
  old.course = 1;
  old.encounters.pending = { id: old.encounters.deck[0], course: 1 };
  const state = C.migrateRun(old);
  assert.equal(state.encounters.pending, null);
  assert.deepEqual(state.encounters.history, []);
  clearEmptyCourse(state);
  assert.equal(C.getEncounter(state).id, old.encounters.deck[0]);
  assert.equal(C.getEncounter(state).progress, 1);
});

test("out-of-date or mismatched live pending dates cannot be displayed, selected or lock preparation", () => {
  for (const [course, pendingCourse] of [[1, 1], [3, 3], [5, 5], [3, 2]]) {
    const state = encounterFixture("anka", { course });
    state.encounters.pending.course = pendingCourse;
    const before = JSON.stringify(state);
    assert.equal(C.getEncounter(state), null);
    assert.equal(C.chooseEncounter(state, "queue"), false);
    assert.equal(JSON.stringify(state), before);
    assert.equal(C.rerollShop(state), true);
    assert.equal(C.startBattle(state), true);
  }
});

test("historical choices from all five old dates remain valid and exhausted pools never repeat", () => {
  const old = C.createRun("old-event-exhausted");
  old.course = 3;
  old.encounters.history = old.encounters.deck.map((id, index) => historicalEncounter(id, index + 1));
  const state = C.migrateRun(old);
  assert.deepEqual(state.encounters.history, old.encounters.history);
  clearEmptyCourse(state);
  assert.equal(state.course, 4);
  assert.equal(C.getEncounter(state), null);
  assert.equal(state.encounters.pending, null);
  assert.equal(C.rerollShop(state), true);
});
