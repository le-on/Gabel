/* Gabel gegen Gänge — deterministic, serializable game rules. */
(() => {
  "use strict";

  const VERSION = 2;
  const MAX_LEVEL = 3;
  const MAX_BENCH_SIZE = 3;
  const ECONOMY = Object.freeze({ startingCoins: 12, courseIncome: Object.freeze([12, 14, 16, 18, 20, 22]) });
  const CONTROL = Object.freeze({ slowFactor: 0.42, pushDistance: 0.045, bossPushDistance: 0.008 });

  function getCourseIncome(courseIndex) {
    return Number.isInteger(courseIndex) ? ECONOMY.courseIncome[courseIndex] || 0 : 0;
  }

  function getCourseBalance(courseIndex) {
    if (!Number.isInteger(courseIndex) || courseIndex < 0 || courseIndex >= ECONOMY.courseIncome.length) return null;
    return { hpScale: 1 + 0.8 * courseIndex + 0.08 * courseIndex * courseIndex, speedScale: 1 + 0.17 * courseIndex, damageScale: 1 + 0.12 * courseIndex, bossHpScale: 2, bossShieldScale: 2, bossSpeedScale: 0.85 };
  }
  const ENCOUNTERS = {
    anka: {
      title: "Anka ruft an", icon: "📞", description: "Lucas Freundin Anka ruft beim Zocken an. Gabriel sieht sofort einen schweren Team-Debuff.", quote: "„Aha. Für Anka hast du also Zeit.“",
      choices: [
        { id: "queue", label: "Noch eine Runde, dann Anka.", effectText: "Gaming-Items haben im nächsten Gang 20 % mehr Stärke.", buff: { label: "Noch eine Runde", description: "Gaming-Items haben in diesem Gang 20 % mehr Stärke.", gamingPowerMultiplier: 1.2 } },
        { id: "call", label: "Luca telefonieren lassen.", effectText: "+4 Pfand, −8 Willenskraft.", coins: 4, willpower: -8 },
        { id: "together", label: "Alle in denselben Call.", effectText: "Der nächste Gang startet mit 8 Schild.", buff: { label: "Gemeinsamer Call", description: "Dieser Gang startet mit 8 Ausreden-Schild.", startingShield: 8 } },
      ],
    },
    bluetooth: {
      title: "Die Bluetooth-Lampe", icon: "💡", description: "Die Nachbarin hat sich mit Gabriels Bluetooth-Lampe verbunden. Jetzt bestimmt sie die Stimmung am Esstisch.", quote: "„Wer ist hier schon wieder verbunden?“",
      choices: [
        { id: "reclaim", label: "Bluetooth zurückerobern.", effectText: "−3 Pfand. Im nächsten Gang sind alle Abklingzeiten 10 % kürzer.", coins: -3, buff: { label: "Bluetooth zurückerobert", description: "Alle Tisch-Items haben 10 % kürzere Abklingzeiten.", cooldownMultiplier: .9 } },
        { id: "disco", label: "Discolicht als Ablenkung.", effectText: "Nächster Gang: 10 Start-Schild, aber 5 % weniger Stärke.", buff: { label: "Disco-Ablenkung", description: "10 Start-Schild; alle Tisch-Items haben 5 % weniger Stärke.", startingShield: 10, powerMultiplier: .95 } },
        { id: "off", label: "Lampe aus. Ruhe.", effectText: "+8 Willenskraft, bis zum Maximum.", willpower: 8 },
      ],
    },
    yusuf: {
      title: "Yusuf meldet sich", icon: "🗣️", description: "Gabriels Sprachassistent auf dem Raspberry Pi hat ungefragt etwas beizutragen. Natürlich genau jetzt.", quote: "„Ich habe ‚kein Hunger‘ verstanden. Aktiviere Essensabwehr.“",
      choices: [
        { id: "focus", label: "Yusuf, Fokusmodus!", effectText: "−2 Pfand. Alle Items haben im nächsten Gang 12 % mehr Stärke.", coins: -2, buff: { label: "Yusufs Fokusmodus", description: "Alle Tisch-Items haben 12 % mehr Stärke.", powerMultiplier: 1.12 } },
        { id: "deposit", label: "Yusuf, wo ist mein Pfand?", effectText: "+3 Pfand. Abklingzeiten im nächsten Gang sind 5 % länger.", coins: 3, buff: { label: "Pfandsuche", description: "Alle Tisch-Items haben 5 % längere Abklingzeiten.", cooldownMultiplier: 1.05 } },
        { id: "quiet", label: "Yusuf, beruhig dich.", effectText: "+7 Willenskraft, bis zum Maximum.", willpower: 7 },
      ],
    },
    update: {
      title: "Update vor der Runde", icon: "🔄", description: "Der Rechner möchte ausgerechnet jetzt neu starten. Leonie stellt schon die Teller bereit.", quote: "„Noch ungefähr eine Minute. Oder siebenundzwanzig.“",
      choices: [
        { id: "skip", label: "Update überspringen.", effectText: "−5 Willenskraft. Alle Items haben im nächsten Gang 10 % mehr Stärke.", willpower: -5, buff: { label: "Update übersprungen", description: "Alle Tisch-Items haben 10 % mehr Stärke.", powerMultiplier: 1.1 } },
        { id: "patch", label: "Kurz patchen lassen.", effectText: "−2 Pfand. Im nächsten Gang sind Abklingzeiten 10 % kürzer.", coins: -2, buff: { label: "Frisch gepatcht", description: "Alle Tisch-Items haben 10 % kürzere Abklingzeiten.", cooldownMultiplier: .9 } },
        { id: "offline", label: "Offline weiterspielen.", effectText: "Der nächste Gang startet mit 8 Schild.", buff: { label: "Offline-Modus", description: "Dieser Gang startet mit 8 Ausreden-Schild.", startingShield: 8 } },
      ],
    },
    walkie: {
      title: "Leonie funkt durch", icon: "📻", description: "Das Walkie-Talkie knistert. Aus der Küche kommt die wichtigste Frage des Abends.", quote: "„Essen ist fertig. Wo bleibt Gabriel?“",
      choices: [
        { id: "later", label: "Komme später. Over!", effectText: "Der nächste Gang startet mit 10 Schild.", buff: { label: "Komme später. Over!", description: "Dieser Gang startet mit 10 Ausreden-Schild.", startingShield: 10 } },
        { id: "round", label: "Nur noch diese Runde.", effectText: "+2 Pfand. Gaming-Items haben im nächsten Gang 15 % mehr Stärke.", coins: 2, buff: { label: "Nur noch diese Runde", description: "Gaming-Items haben 15 % mehr Stärke.", gamingPowerMultiplier: 1.15 } },
        { id: "prepare", label: "Tisch vorbereiten.", effectText: "−3 Pfand. Alle Items haben im nächsten Gang 12 % mehr Stärke.", coins: -3, buff: { label: "Tisch vorbereitet", description: "Alle Tisch-Items haben 12 % mehr Stärke.", powerMultiplier: 1.12 } },
      ],
    },
  };

  const ENCOUNTER_COURSES = [2, 4];

  function currentEncounter(state) {
    const pending = state.encounters?.pending;
    return state.phase === "prep" && ENCOUNTER_COURSES.includes(state.course) && pending?.course === state.course ? pending : null;
  }

  function canPrepare(state) {
    return state.phase === "prep" && !currentEncounter(state);
  }

  function makeEncounterDeck(seed) {
    const deck = Object.keys(ENCOUNTERS);
    const rng = { randomState: hashSeed(`${seed}:encounters`) };
    for (let index = deck.length - 1; index > 0; index--) {
      const other = Math.floor(random(rng) * (index + 1));
      [deck[index], deck[other]] = [deck[other], deck[index]];
    }
    return deck;
  }

  function encounterChoiceStatus(state, choice) {
    if (state.coins + (choice.coins || 0) < 0) return { affordable: false, disabledReason: `Du brauchst ${-choice.coins} Pfand.` };
    if (state.willpower + (choice.willpower || 0) <= 0) return { affordable: false, disabledReason: `Du brauchst mehr als ${-choice.willpower} Willenskraft.` };
    return { affordable: true, disabledReason: "" };
  }

  function getEncounter(state) {
    const pending = currentEncounter(state);
    const definition = pending && Object.hasOwn(ENCOUNTERS, pending.id) ? ENCOUNTERS[pending.id] : null;
    if (state.phase !== "prep" || !definition) return null;
    return {
      id: pending.id, title: definition.title, icon: definition.icon, description: definition.description, quote: definition.quote, course: pending.course,
      choices: definition.choices.map(choice => ({ id: choice.id, label: choice.label, effectText: choice.effectText, ...encounterChoiceStatus(state, choice) })),
      progress: ENCOUNTER_COURSES.indexOf(pending.course) + 1, total: ENCOUNTER_COURSES.length,
    };
  }

  function chooseEncounter(state, choiceId) {
    const pending = currentEncounter(state);
    const definition = pending && Object.hasOwn(ENCOUNTERS, pending.id) ? ENCOUNTERS[pending.id] : null;
    const choice = definition?.choices.find(option => option.id === choiceId);
    if (state.phase !== "prep" || !choice || !encounterChoiceStatus(state, choice).affordable) return false;
    const coins = choice.coins || 0;
    const beforeWillpower = state.willpower;
    state.coins += coins;
    if (coins > 0) state.stats.coinsEarned += coins;
    else state.stats.coinsSpent -= coins;
    state.willpower = Math.min(state.maxWillpower, state.willpower + (choice.willpower || 0));
    state.encounters.nextBuff = choice.buff ? { ...choice.buff } : null;
    state.encounters.history.push({ id: pending.id, choiceId: choice.id, course: pending.course, message: `${definition.title}: ${choice.effectText}`, coinsDelta: coins, willpowerDelta: state.willpower - beforeWillpower });
    state.encounters.pending = null;
    return true;
  }

  function activeEventBuff(state) {
    return state.phase === "battle" ? state.battle?.eventBuff || null : state.phase === "prep" ? state.encounters?.nextBuff || null : null;
  }

  function getEventBuff(state) {
    const buff = activeEventBuff(state);
    return buff ? { ...buff } : null;
  }

  function validEventBuff(buff) {
    if (buff === null) return true;
    if (!buff || typeof buff !== "object" || Array.isArray(buff) || typeof buff.label !== "string" || !buff.label || typeof buff.description !== "string" || !buff.description) return false;
    for (const field of ["powerMultiplier", "gamingPowerMultiplier", "cooldownMultiplier"]) {
      if (field in buff && (!Number.isFinite(buff[field]) || buff[field] <= 0)) return false;
    }
    return !("startingShield" in buff) || (Number.isFinite(buff.startingShield) && buff.startingShield >= 0);
  }

  function validEncounters(encounters) {
    if (!encounters || typeof encounters !== "object" || Array.isArray(encounters)) return false;
    const known = id => typeof id === "string" && Object.hasOwn(ENCOUNTERS, id);
    const validCourse = course => Number.isInteger(course) && course >= 1 && course <= 5;
    if (!Array.isArray(encounters.deck) || encounters.deck.length !== 5 || new Set(encounters.deck).size !== 5 || !encounters.deck.every(known)) return false;
    if (!Array.isArray(encounters.history) || !encounters.history.every(entry => entry && known(entry.id) && validCourse(entry.course) && ENCOUNTERS[entry.id].choices.some(choice => choice.id === entry.choiceId) && typeof entry.message === "string" && (!Object.hasOwn(entry, "coinsDelta") || Number.isFinite(entry.coinsDelta)) && (!Object.hasOwn(entry, "willpowerDelta") || Number.isFinite(entry.willpowerDelta)))) return false;
    const pending = encounters.pending;
    if (pending !== null && (!pending || typeof pending !== "object" || Array.isArray(pending) || !known(pending.id) || !validCourse(pending.course))) return false;
    return validEventBuff(encounters.nextBuff);
  }

  function queueEncounter(state) {
    const encounters = state.encounters;
    if (!encounters || !ENCOUNTER_COURSES.includes(state.course) || encounters.history.some(entry => entry.course === state.course)) return;
    const used = new Set(encounters.history.map(entry => entry.id));
    const id = encounters.deck.find(candidate => !used.has(candidate));
    if (id && Object.hasOwn(ENCOUNTERS, id)) encounters.pending = { id, course: state.course };
  }

  const ITEMS = {
    serviette: { id: "serviette", name: "Die Serviette", icon: "◻️", iconPath: "assets/items/napkin.svg", category: "Entsorgen", description: "Lässt alle 2,8 Sekunden eine kleine Portion verschwinden.", cooldown: 2.8, power: 18, effect: "attack", color: "#e5c879", price: 4, rarity: "common" },
    ventilator: { id: "ventilator", name: "Heizlüfter", icon: "♨️", iconPath: "assets/items/heater.svg", category: "Heißluft", description: "Trifft alle Gerichte mit heißer Luft und schiebt sie ein Stück zurück. Das Dessert ist besonders standfest.", cooldown: 5, power: 8, effect: "push", color: "#e8a364", price: 6, rarity: "uncommon" },
    paper: { id: "paper", name: "Unfertiges Paper", icon: "📄", category: "Schützen", description: "„Muss noch fertig werden!“ Gibt regelmäßig 6 Ausreden-Schild.", cooldown: 4.2, power: 6, effect: "shield", color: "#c3bbd9", price: 4, rarity: "common" },
    headset: { id: "headset", name: "Gaming-Headset", icon: "🎧", category: "Verzögern", description: "„Bin gerade im Call!“ Verlangsamt alle Gerichte für 2 Sekunden und verursacht 6 Schaden.", cooldown: 5.4, power: 6, slowDuration: 2, effect: "slow", color: "#90b6c4", price: 6, rarity: "uncommon", tags: ["gaming"] },
    brotdose: { id: "brotdose", name: "Für morgen", icon: "🍱", category: "Entsorgen", description: "Packt 32 Portionen ein. Kleine Gerichte werden komplett eingepackt.", cooldown: 4.4, power: 32, effect: "store", color: "#b3c18a", price: 6, rarity: "uncommon" },
    discord: { id: "discord", name: "Discord", icon: "💬", category: "Unterstützen", description: "Ein dringender Voice-Call: 14 Schaden an allen Gerichten.", cooldown: 5.5, power: 14, effect: "pulse", color: "#a9a9d0", price: 9, rarity: "rare", tags: ["gaming"] },
    gabel: { id: "gabel", name: "Gabel-Katapult", icon: "🍴", category: "Entsorgen", description: "Katapultiert die zwei vordersten Portionen zurück in die Küche.", cooldown: 3.5, power: 18, effect: "fork", color: "#dca783", price: 9, rarity: "rare" },
    kaffee: { id: "kaffee", name: "Noch ein Kaffee", icon: "☕", category: "Unterstützen", description: "Nachbar-Items werden 20 % stärker. Gibt zusätzlich 7 Ausreden-Schild.", cooldown: 5.8, power: 7, effect: "coffee", color: "#c5a68d", price: 4, rarity: "common" },
    beer: { id: "beer", name: "Kühles Bier", icon: "🍺", iconPath: "assets/items/beer.svg", category: "Trinkpause", description: "Gibt 4 Ausreden-Schild und lädt direkte Nachbarn 0,45 Sekunden früher auf. Gaming-Nachbarn erhalten einmalig +20 % Schaden für ihren nächsten Angriff. Stufe 2: Sixpack. Stufe 3: Bierkasten.", cooldown: 6.2, power: 4, recharge: 0.45, effect: "refresh", color: "#dfb452", price: 4, rarity: "common", tags: ["drink"] },
    snus: { id: "snus", name: "Snus", icon: "🥫", iconPath: "assets/items/snus_pouch.svg", category: "Mund besetzt", description: "Hält 10 Schaden des nächsten normalen Bissens ab, auch bei Suppe. Ein Puffer, nicht stapelbar. Beim Block lädt benachbartes Bier 2 Sekunden früher auf, höchstens alle 4 Sekunden. Das Dessert lässt sich damit nicht aufhalten.", cooldown: 7.8, power: 10, effect: "mouth_guard", color: "#7f9e78", price: 4, rarity: "common", tags: ["snus"] },
    luca: { id: "luca", name: "Luca", icon: "🧑‍💻", iconPath: "assets/items/luca.svg", category: "Duo-Partner", description: "14 Schaden am vordersten Gericht. Lädt einen benachbarten Gaming-Gegenstand 1,2 Sekunden früher auf. Je 3 Gaming-Aktivierungen im Nahbereich wächst sein Momentum: +10 % Stärke und Aufladung, bis +50 %.", cooldown: 5.2, power: 14, recharge: 1.2, effect: "assist", color: "#ac8cc1", price: 6, rarity: "uncommon", tags: ["gaming", "crew"] },
    desolator: { id: "desolator", name: "Dota 2 · Desolator", icon: "🗡️", iconPath: "assets/items/desolator.svg", category: "Rüstungsbruch", description: "16 Schaden am vordersten Gericht. Markiert es danach 3 Sekunden lang: folgende Treffer verursachen 25 % mehr Schaden.", cooldown: 4.6, power: 16, effect: "mark", color: "#c65a63", price: 6, rarity: "uncommon", tags: ["gaming", "dota"] },
    awp: { id: "awp", name: "CS2 · AWP", icon: "🎯", iconPath: "assets/items/awp.svg", category: "Präzisionsschuss", description: "Zwei Präzisionsschüsse mit je 48 Schaden im Abstand von 1 Sekunde, danach 10 Sekunden nachladen. Die Hälfte ignoriert Käse-Schild. Zielpriorität wählbar.", cooldown: 10, power: 48, effect: "snipe", color: "#799c68", price: 9, rarity: "rare", tags: ["gaming", "cs2"] },
    batomon: { id: "batomon", name: "Batomon Showdown", icon: "🐉", iconPath: "assets/items/batomon.svg", category: "Typenvorteil", description: "13 Schaden an bis zu zwei Gerichten, bevorzugt grünes Gemüse. Gegen Erbsen und Brokkoli sehr effektiv: doppelter Schaden. Alternativ schwache Ziele aufräumen.", cooldown: 4.8, power: 13, effect: "type_attack", color: "#d99558", price: 6, rarity: "uncommon", tags: ["gaming", "batomon"] },
    podcast: { id: "podcast", name: "Lanz & Precht", icon: "🎙️", iconPath: "assets/items/podcast.svg", category: "Ausdiskutieren", description: "9 Schaden und 2,2 Sekunden Verlangsamung für die zwei vordersten Gerichte. Jede dritte Aktivierung trifft alle Gerichte und verlangsamt sie 3,2 Sekunden: noch ein letzter Gedanke.", cooldown: 5.6, power: 9, slowDuration: 2.2, finaleDuration: 3.2, effect: "podcast", color: "#b89cc8", price: 6, rarity: "uncommon", tags: ["audio"] },
    umut: { id: "umut", name: "Umut", icon: "🎨", iconPath: "assets/items/umut.svg", category: "Frisch gestrichen", description: "14 Schaden am Gericht mit dem meisten Käse-Schild. Entfernt davor bis zu 12 Schild und streicht das Ziel 3 Sekunden lang: Farbe verhindert Suppen-Heilung.", cooldown: 5, power: 14, strip: 12, effect: "paint", color: "#62b8b1", price: 6, rarity: "uncommon", tags: ["voice", "crew"] },
    walkie: { id: "walkie", name: "Walkie-Talkies", icon: "📻", iconPath: "assets/items/walkie.svg", category: "Über den Tisch", description: "Gibt 5 Ausreden-Schild und lädt genau den Gegenstand gegenüber am Tisch 1,2 Sekunden früher auf: Plätze 1 ↔ 6, 2 ↔ 5 und 3 ↔ 4.", cooldown: 6, power: 5, recharge: 1.2, effect: "radio", color: "#ddad66", price: 4, rarity: "common", tags: ["radio"] },
    ritalin: { id: "ritalin", name: "Ritalin", icon: "💊", iconPath: "assets/items/ritalin.svg", category: "Aufladen", description: "Lädt direkt angrenzende Items alle 6 Sekunden 1,2 Sekunden früher auf.", cooldown: 6, power: 0, recharge: 1.2, effect: "haste", color: "#77bca8", price: 6, rarity: "uncommon" },
  };

  const ENEMIES = {
    erbsen: { name: "Erbsen-Schwarm", icon: "🫛", hp: 18, speed: 0.078, damage: 6, color: "#8ea66b" },
    brokkoli: { name: "Brokkoli", icon: "🥦", hp: 33, speed: 0.057, damage: 10, color: "#739b6b" },
    pasta: { name: "Pasta-Berg", icon: "🍝", hp: 45, speed: 0.048, damage: 13, color: "#db9c6c" },
    suppe: { name: "Suppe", icon: "🍲", hp: 29, speed: 0.068, damage: 11, color: "#d5b163", bypass: 0.5 },
    lasagne: { name: "Schicht-Lasagne", icon: "🥘", hp: 58, shield: 16, speed: 0.038, damage: 18, color: "#cb8562" },
    dessert: { name: "Leonies Finale", icon: "🍰", hp: 360, shield: 22, speed: 0.032, damage: 200, color: "#d798a8", boss: true },
  };

  const COURSES = [
    { name: "Nur eine Vorspeise", subtitle: "Ein harmloser Anfang. Angeblich.", quote: "„Du musst ja nur mal probieren.“", rule: "Erbsen und Brokkoli. Zeit, deine Ausreden zu testen.", enemyTypes: ["erbsen", "brokkoli", "erbsen", "erbsen", "brokkoli", "erbsen", "brokkoli"], total: 7, spawnEvery: 2.7 },
    { name: "Da ist noch Suppe", subtitle: "Flüssig zählt doch gar nicht.", quote: "„Die wärmt dich von innen!“", rule: "Suppe umgeht die Hälfte deines Schilds.", enemyTypes: ["suppe", "erbsen", "brokkoli", "suppe", "erbsen", "suppe", "brokkoli", "erbsen", "suppe"], total: 9, spawnEvery: 2.45 },
    { name: "Pasta la vista", subtitle: "Nur eine winzige Portion Nudeln.", quote: "„Ich hab extra deine Lieblingsnudeln gemacht.“", rule: "Pasta hat viele Portionen. Flächenschaden hilft gegen die Beilagen.", enemyTypes: ["pasta", "erbsen", "suppe", "pasta", "brokkoli", "erbsen", "pasta", "suppe", "pasta", "erbsen"], total: 10, spawnEvery: 2.35 },
    { name: "Noch eine Schicht", subtitle: "Diese Lasagne meint es ernst.", quote: "„Die obere Schicht ist doch nur Käse!“", rule: "Lasagne besitzt zusätzlich einen Käse-Schild.", enemyTypes: ["lasagne", "erbsen", "pasta", "brokkoli", "lasagne", "suppe", "erbsen", "lasagne", "pasta", "suppe", "lasagne"], total: 11, spawnEvery: 2.25 },
    { name: "Nachschlag!", subtitle: "Leonie hat noch einen ganzen Topf.", quote: "„Das bisschen lassen wir jetzt nicht übrig.“", rule: "Ein schneller Mix aller Gerichte. Rüste deine besten Kombinationen aus.", enemyTypes: ["erbsen", "suppe", "pasta", "lasagne", "erbsen", "brokkoli", "suppe", "pasta", "erbsen", "lasagne", "suppe", "pasta", "brokkoli"], total: 13, spawnEvery: 1.95 },
    { name: "Platz für Nachtisch", subtitle: "Das große Dessert-Finale.", quote: "„Dafür hat man einen zweiten Magen!“", rule: "Boss: Das Dessert muss verschwinden, bevor es Gabriel erreicht.", enemyTypes: ["erbsen", "suppe", "dessert", "pasta", "erbsen", "lasagne", "brokkoli", "suppe", "erbsen", "pasta", "lasagne", "suppe"], total: 12, spawnEvery: 2.15 },
  ];

  // Formations use their own seeded stream: scouting never changes the shop.
  const FORMATIONS = {
    swarm: { id: "swarm", name: "Grüne Flut", icon: "🫛", description: "Viele weiche Gemüseportionen kommen dicht hintereinander.", tip: "Batomon gegen Grün, Flächenschaden und gleichmäßige Angriffe halten die Flut auf.", quote: "„Ist doch fast nur Gemüse!“", enemyTypes: ["erbsen", "erbsen", "brokkoli", "erbsen", "brokkoli", "erbsen", "erbsen", "brokkoli", "erbsen"], spawnEvery: 1.3, hpMultiplier: 0.75, speedMultiplier: 1 },
    support: { id: "support", name: "Suppen-Support", icon: "🍲", description: "Suppen heilen alle 3,5 Sekunden andere Gerichte um 6 % ihrer maximalen Portionen und umgehen 50 % Schild.", tip: "AWP auf Bedrohungen nimmt Suppen ins Visier. Rüstungsbruch hilft gegen die Lasagne davor.", quote: "„Die Suppe hält alles schön warm.“", enemyTypes: ["lasagne", "suppe", "pasta", "suppe", "lasagne", "pasta", "suppe", "lasagne"], spawnEvery: 2.35, hpMultiplier: 1, speedMultiplier: 1 },
    express: { id: "express", name: "Express-Service", icon: "⚡", description: "Leichte Portionen bewegen sich 45 % schneller. Wenig Zeit für lange Nachladephasen.", tip: "Verlangsamung, Rückstoß und kurze Abklingzeiten fangen schnelle Bissen ab.", quote: "„Schnell essen, sonst wird es kalt!“", enemyTypes: ["suppe", "erbsen", "pasta", "erbsen", "brokkoli", "suppe", "erbsen", "pasta", "suppe", "brokkoli"], spawnEvery: 1.6, hpMultiplier: 0.8, speedMultiplier: 1.45 },
    family: { id: "family", name: "Familienportion", icon: "🥘", description: "Wenige große Portionen: 20 % mehr Lebenspunkte und Käse-Schild, dafür 15 % langsamer.", tip: "Desolator auf Käse-Schild und markierte AWP-Schüsse knacken die dicken Portionen.", quote: "„Ich habe die Reste gleich mitgebracht.“", enemyTypes: ["lasagne", "pasta", "lasagne", "pasta", "lasagne", "lasagne"], spawnEvery: 2.8, hpMultiplier: 1.2, speedMultiplier: 0.85 },
    finale: { id: "finale", name: "Dessert mit Begleitung", icon: "🍰", description: "Leonies Dessert wird von heilenden Suppen und Beilagen begleitet. Das Dessert muss besiegt werden.", tip: "Wähle bewusst zwischen Boss-Fokus und Support-Jagd. Plane Schaden auch nach langen Nachladephasen ein.", quote: "„Für Nachtisch hat man einen zweiten Magen!“", enemyTypes: ["lasagne", "suppe", "dessert", "erbsen", "suppe", "pasta", "brokkoli", "lasagne", "suppe", "erbsen", "pasta", "lasagne"], spawnEvery: 2.15, hpMultiplier: 1, speedMultiplier: 1 },
  };

  const TACTICS = {
    awp: [
      { id: "threat", label: "Bedrohungen", description: "Boss zuerst, dann heilende Suppen, dann Gerichte mit hohem Biss-Schaden. Bei Gleichstand das vorderste Ziel." },
      { id: "marked", label: "Markierte Ziele", description: "Schießt zuerst auf markierte Gerichte. Ohne Markierung gilt die Bedrohungs-Priorität." },
    ],
    batomon: [
      { id: "green", label: "Typenvorteil", description: "Trifft zuerst bis zu zwei grüne Gemüseportionen. Freie Plätze gehen an die vordersten anderen Gerichte." },
      { id: "cleanup", label: "Aufräumen", description: "Trifft die zwei Gerichte mit den wenigsten verbleibenden Lebenspunkten inklusive Käse-Schild." },
    ],
    desolator: [
      { id: "front", label: "Vorderstes Ziel", description: "Markiert das Gericht, das Gabriel am nächsten ist." },
      { id: "armored", label: "Käse knacken", description: "Markiert zuerst das Gericht mit dem meisten verbleibenden Käse-Schild. Bei Gleichstand das vorderste Ziel." },
    ],
    luca: [
      { id: "strongest", label: "Stärksten unterstützen", description: "Lädt genau einen benachbarten, gerade aufladenden Gaming-Gegenstand mit der höchsten Stärke früher auf." },
      { id: "longest", label: "Längste Wartezeit", description: "Lädt genau den benachbarten Gaming-Gegenstand mit der längsten verbleibenden Aufladezeit früher auf." },
    ],
  };
  const CHAIN_NAMES = { marked_finish: "Präziser Abschluss", snus_beer: "Mund besetzt, Bier bereit", beer_focus: "Feierabend-Fokus", gaming_rhythm: "Duo im Rhythmus", podcast_finale: "Noch ein letzter Gedanke" };

  const SYNERGIES = [
    { ids: ["podcast", "headset"], name: "Noch ein Gedanke", description: "Lanz & Precht und Headset laden 15 % schneller auf.", cooldown: 0.85 },
    { ids: ["podcast", "paper"], name: "Erst mal ausdiskutieren", description: "Lanz & Precht verursacht 25 % mehr Schaden; Paper gibt 25 % mehr Schild.", power: 1.25 },
    { ids: ["umut", "discord"], name: "Frisch gestrichen im Voice", description: "Umut und Discord laden 15 % schneller auf.", cooldown: 0.85 },
    { ids: ["umut", "luca"], name: "Abend mit den Jungs", description: "Umut und Luca verursachen 25 % mehr Schaden; Umut entfernt entsprechend mehr Käse-Schild.", power: 1.25 },
    { ids: ["walkie", "podcast"], name: "Sendepause", description: "Walkie-Talkies und Lanz & Precht laden 15 % schneller auf.", cooldown: 0.85 },
    { ids: ["walkie", "snus"], name: "Mund besetzt, Funk bereit", description: "Walkie-Talkies und Snus laden 15 % schneller auf.", cooldown: 0.85 },
    { ids: ["serviette", "brotdose"], name: "Unauffällig einpacken", description: "Serviette und Brotdose verursachen 35 % mehr Schaden.", power: 1.35 },
    { ids: ["headset", "discord"], name: "Nur noch diese Runde", description: "Headset und Discord laden 25 % schneller auf.", cooldown: 0.75 },
    { ids: ["paper", "kaffee"], name: "Deadline um Mitternacht", description: "Paper und Kaffee geben 50 % mehr Schild.", power: 1.5 },
    { ids: ["ventilator", "gabel"], name: "Zurück in die Küche", description: "Heizlüfter und Gabel verursachen 35 % mehr Schaden.", power: 1.35 },
    { ids: ["beer", "snus"], name: "Bier und Snus", description: "Bier und Snus laden 15 % schneller auf.", cooldown: 0.85 },
    { ids: ["beer", "luca"], name: "Feierabend im Voice", description: "Bier gibt 25 % mehr Schild; Luca verursacht 25 % mehr Schaden.", power: 1.25 },
    { ids: ["luca", "discord"], name: "Duo-Queue", description: "Luca und Discord laden 20 % schneller auf.", cooldown: 0.8 },
    { ids: ["luca", "desolator"], name: "Dota-Abend", description: "Luca und Desolator verursachen 25 % mehr Schaden.", power: 1.25 },
    { ids: ["awp", "headset"], name: "Sound-Check", description: "AWP und Headset verursachen 30 % mehr Schaden.", power: 1.3 },
    { ids: ["batomon", "paper"], name: "Schadensberechnung", description: "Batomon verursacht 30 % mehr Schaden; Paper gibt 30 % mehr Schild.", power: 1.3 },
    { ids: ["snus", "serviette"], name: "Mund bleibt zu", description: "Snus blockt 20 % mehr Schaden; die Serviette verursacht 20 % mehr Schaden.", power: 1.2 },
  ];

  function random(state) {
    let n = state.randomState += 0x6D2B79F5;
    n = Math.imul(n ^ n >>> 15, n | 1);
    n ^= n + Math.imul(n ^ n >>> 7, n | 61);
    state.randomState >>>= 0;
    return ((n ^ n >>> 14) >>> 0) / 4294967296;
  }

  function hashSeed(seed) {
    const str = String(seed);
    let n = 2166136261;
    for (let i = 0; i < str.length; i++) n = Math.imul(n ^ str.charCodeAt(i), 16777619);
    return n >>> 0;
  }

  function makeItem(state, id, level = 1, invested = 0) {
    const item = { id, level, uid: `i${state.nextUid++}`, invested };
    if (TACTICS[id]) item.tactic = TACTICS[id][0].id;
    return item;
  }

  function getTactics(itemOrId) {
    return (TACTICS[typeof itemOrId === "string" ? itemOrId : itemOrId?.id] || []).map(tactic => ({ ...tactic }));
  }

  function getTactic(state, index) {
    const item = index < 6 ? state.slots[index] : state.bench[index - 6];
    const tactics = getTactics(item);
    return tactics.find(tactic => tactic.id === item?.tactic) || tactics[0] || null;
  }

  function setTactic(state, index, id) {
    if (!canPrepare(state) || !Number.isInteger(index) || index < 0) return false;
    const item = index < 6 ? state.slots[index] : state.bench[index - 6];
    if (!item || !getTactics(item).some(tactic => tactic.id === id)) return false;
    item.tactic = id;
    return true;
  }

  function makeFormationPlan(seed) {
    const rng = { randomState: hashSeed(`${seed}:formation`) };
    const middle = ["swarm", "support", "express", "family"];
    for (let i = middle.length - 1; i > 0; i--) {
      const other = Math.floor(random(rng) * (i + 1));
      [middle[i], middle[other]] = [middle[other], middle[i]];
    }
    return ["swarm", ...middle, "finale"];
  }

  function getBattlePlan(state) {
    const b = state.phase === "battle" ? state.battle : null;
    const course = COURSES[state.course];
    if (!course) return null;
    // A pre-strategy save keeps precisely the wave it was already fighting.
    if (b && !b.formationId) {
      const formation = { id: "legacy", name: course.name, icon: "🍽️", description: course.rule, tip: course.rule, quote: course.quote, enemyTypes: [...course.enemyTypes], spawnEvery: course.spawnEvery, hpMultiplier: 1, speedMultiplier: 1 };
      return { formation, enemyTypes: [...course.enemyTypes], total: b.total, spawnEvery: course.spawnEvery, rule: course.rule };
    }
    const plan = state.formationPlan || makeFormationPlan(state.seed);
    const definition = FORMATIONS[b?.formationId || plan[state.course]] || FORMATIONS.swarm;
    const enemyTypes = [...(b?.enemyTypes || definition.enemyTypes)];
    const formation = { ...definition, enemyTypes: [...definition.enemyTypes] };
    return { formation, enemyTypes, total: enemyTypes.length, spawnEvery: b?.spawnEvery || definition.spawnEvery, rule: definition.description };
  }

  function getItemDefinition(instanceOrId, level = 1) {
    const id = typeof instanceOrId === "string" ? instanceOrId : instanceOrId?.id;
    const definition = ITEMS[id];
    if (!definition) return null;
    const currentLevel = typeof instanceOrId === "string" ? level : instanceOrId.level;
    if (id === "beer" && currentLevel >= 3) return { ...definition, name: "Bierkasten", icon: "🧺", iconPath: "assets/items/beer_crate.svg" };
    if (id === "beer" && currentLevel === 2) return { ...definition, name: "Sixpack", icon: "🍻", iconPath: "assets/items/beer_sixpack.svg" };
    if (id === "snus" && currentLevel >= 3) return { ...definition, name: "10er-Pack Snus", icon: "📦", iconPath: "assets/items/snus_pack.svg" };
    if (id === "snus" && currentLevel === 2) return { ...definition, name: "Päckchen Snus", icon: "🥫", iconPath: "assets/items/snus.svg" };
    return { ...definition };
  }

  function makeOffer(state, cheap = false) {
    const pool = Object.values(ITEMS).filter(item => !cheap || item.price === 4);
    const weight = item => ({ common: 5, uncommon: 3, rare: 2 }[item.rarity]);
    let roll = random(state) * pool.reduce((sum, item) => sum + weight(item), 0);
    let chosen = pool[pool.length - 1];
    for (const item of pool) {
      roll -= weight(item);
      if (roll < 0) { chosen = item; break; }
    }
    return { uid: `o${state.nextUid++}`, id: chosen.id, price: chosen.price, locked: false };
  }

  function refreshOffers(state) {
    const offers = state.shop.offers;
    let lastOpen = -1;
    for (let index = 0; index < 4; index++) if (!offers[index]?.locked) lastOpen = index;
    for (let index = 0; index < 4; index++) {
      if (!offers[index]?.locked) offers[index] = makeOffer(state, index === lastOpen);
    }
  }

  function openShop(state, visit = 0) {
    const oldOffers = state.shop?.offers || [];
    state.shop = {
      offers: Array.from({ length: 4 }, (_, index) => oldOffers[index]?.locked ? { ...oldOffers[index] } : null),
      rerolls: 0, healUsed: false, visit,
    };
    refreshOffers(state);
  }

  function createRun(seed = Date.now()) {
    const state = {
      version: VERSION, seed: String(seed), randomState: hashSeed(seed), nextUid: 1,
      phase: "prep", course: 0, willpower: 100, maxWillpower: 100, coins: ECONOMY.startingCoins,
      slots: Array(6).fill(null), bench: [], battle: null, lastBattle: null, formationPlan: makeFormationPlan(seed), encounters: { deck: makeEncounterDeck(seed), pending: null, history: [], nextBuff: null },
      stats: { killed: 0, damageDealt: 0, damageTaken: 0, shielded: 0, coursesCleared: 0, synergiesUsed: 0, coinsEarned: ECONOMY.startingCoins, coinsSpent: 0, rerolls: 0 },
    };
    state.slots[0] = makeItem(state, "serviette");
    state.slots[3] = makeItem(state, "paper");
    openShop(state);
    return state;
  }

  function adjacent(a, b) {
    return Math.abs(Math.floor(a / 3) - Math.floor(b / 3)) + Math.abs(a % 3 - b % 3) === 1;
  }

  function getSynergies(state) {
    const result = [];
    for (const synergy of SYNERGIES) {
      for (let a = 0; a < 6; a++) {
        if (state.slots[a]?.id !== synergy.ids[0]) continue;
        for (let b = 0; b < 6; b++) {
          if (state.slots[b]?.id === synergy.ids[1] && adjacent(a, b)) {
            result.push({ name: synergy.name, description: synergy.description, slots: [a, b], power: synergy.power || 1, cooldown: synergy.cooldown || 1 });
          }
        }
      }
    }
    for (let a = 0; a < 6; a++) {
      if (state.slots[a]?.id !== "kaffee") continue;
      const neighbors = state.slots.map((item, b) => item && adjacent(a, b) ? b : -1).filter(b => b >= 0);
      if (neighbors.length) result.push({ name: "Kaffeepause", description: "Items neben Kaffee sind 20 % stärker.", slots: [a, ...neighbors], coffee: true, source: a, power: 1.2, cooldown: 1 });
    }
    return result;
  }

  function getItemStats(state, slotIndex) {
    const instance = slotIndex < 6 ? state.slots[slotIndex] : state.bench[slotIndex - 6];
    if (!instance || !ITEMS[instance.id]) return null;
    const item = ITEMS[instance.id];
    let power = item.power * (1 + 0.5 * (instance.level - 1));
    let cooldown = item.cooldown * (1 - 0.08 * (instance.level - 1));
    if (slotIndex < 6) {
      for (const synergy of getSynergies(state)) {
        if (!synergy.slots.includes(slotIndex)) continue;
        if (synergy.coffee && synergy.source === slotIndex) continue;
        power *= synergy.power;
        cooldown *= synergy.cooldown;
      }
    }
    const eventBuff = slotIndex < 6 ? activeEventBuff(state) : null;
    if (eventBuff) {
      power *= eventBuff.powerMultiplier || 1;
      if (item.tags?.includes("gaming")) power *= eventBuff.gamingPowerMultiplier || 1;
      cooldown *= eventBuff.cooldownMultiplier || 1;
    }
    const momentum = item.id === "luca" && slotIndex < 6 ? state.battle?.itemRuntime?.[slotIndex]?.momentum || 0 : 0;
    power *= 1 + momentum * 0.1;
    const result = { power: Math.round(power * 10) / 10, cooldown: Math.round(cooldown * 100) / 100, effect: item.effect, level: instance.level };
    if (item.recharge) result.recharge = Math.round(item.recharge * (1 + 0.25 * (instance.level - 1)) * (1 + momentum * 0.1) * 10000) / 10000;
    const tactic = getTactic(state, slotIndex);
    if (tactic) { result.tactic = tactic.label; result.tacticId = tactic.id; }
    if (item.id === "luca") result.momentum = momentum;
    if (item.id === "awp") { result.clipSize = 2; result.shotInterval = 1; }
    if (["slow", "podcast"].includes(item.effect)) {
      result.slowDuration = item.slowDuration + 0.2 * (instance.level - 1);
      result.slowFactor = CONTROL.slowFactor;
    }
    if (item.id === "podcast") {
      result.episode = slotIndex < 6 ? state.battle?.itemRuntime?.[slotIndex]?.episode || 0 : 0;
      result.episodeLength = 3;
      result.finaleDuration = item.finaleDuration + 0.2 * (instance.level - 1);
    }
    if (item.id === "umut") { result.strip = Math.round(item.strip * result.power / item.power); result.paintDuration = 3 + 0.25 * (instance.level - 1); }
    if (item.id === "walkie") result.remoteSlot = slotIndex < 6 ? 5 - slotIndex : null;
    return result;
  }

  function moveItem(state, fromIndex, toIndex) {
    if (!canPrepare(state)) return false;
    if (!Number.isInteger(fromIndex) || !Number.isInteger(toIndex) || fromIndex === toIndex) return false;
    const all = [...state.slots, ...state.bench];
    if (fromIndex < 0 || fromIndex >= all.length || toIndex < 0 || toIndex > all.length || !all[fromIndex]) return false;
    if (toIndex === all.length && toIndex < 6) return false;
    [all[fromIndex], all[toIndex]] = [all[toIndex] || null, all[fromIndex]];
    const bench = all.slice(6).filter(Boolean);
    // Older saves may be over capacity; rearranging or reducing that reserve is safe.
    if (bench.length > MAX_BENCH_SIZE && bench.length > state.bench.length) return false;
    state.slots = all.slice(0, 6);
    state.bench = bench;
    return true;
  }

  function mergeItems(state, id) {
    const all = [...state.slots, ...state.bench];
    let pair;
    do {
      pair = null;
      for (let first = 0; first < all.length && !pair; first++) {
        if (all[first]?.id !== id || all[first].level >= MAX_LEVEL) continue;
        for (let second = first + 1; second < all.length; second++) {
          if (all[second]?.id === id && all[second].level === all[first].level) {
            pair = [first, second];
            break;
          }
        }
      }
      if (pair) {
        const [first, second] = pair;
        all[first].level++;
        all[first].invested = (all[first].invested || 0) + (all[second].invested || 0);
        all[second] = null;
      }
    } while (pair);
    state.slots = all.slice(0, 6);
    state.bench = all.slice(6).filter(Boolean);
  }

  function buyItem(state, offerIndex) {
    if (!canPrepare(state) || !Number.isInteger(offerIndex)) return false;
    const offer = state.shop?.offers[offerIndex];
    if (!offer || !ITEMS[offer.id] || !Number.isInteger(offer.price) || offer.price <= 0 || state.coins < offer.price) return false;
    // Resolve the inventory transaction in isolation before charging or reserving a UID.
    const draft = { ...state, slots: state.slots.map(item => item ? { ...item } : null), bench: state.bench.map(item => ({ ...item })) };
    const item = makeItem(draft, offer.id, 1, offer.price);
    draft.bench.push(item);
    mergeItems(draft, offer.id);
    const freeIndex = draft.slots.indexOf(null);
    const newIndex = draft.bench.findIndex(owned => owned.uid === item.uid);
    if (freeIndex >= 0 && newIndex >= 0) draft.slots[freeIndex] = draft.bench.splice(newIndex, 1)[0];
    if (draft.bench.length > MAX_BENCH_SIZE) return false;
    state.coins -= offer.price;
    state.stats.coinsSpent += offer.price;
    state.nextUid = draft.nextUid;
    state.slots = draft.slots;
    state.bench = draft.bench;
    state.shop.offers[offerIndex] = null;
    return true;
  }

  function getUpgradeCost(state, index) {
    if (!Number.isInteger(index) || index < 0) return null;
    const item = index < 6 ? state.slots[index] : state.bench[index - 6];
    if (!item || !ITEMS[item.id] || !Number.isInteger(item.level) || item.level < 1 || item.level >= MAX_LEVEL) return null;
    return ITEMS[item.id].price * (item.level === 2 ? 2 : 1);
  }

  function upgradeItem(state, index) {
    if (!canPrepare(state)) return false;
    const cost = getUpgradeCost(state, index);
    if (cost === null || state.coins < cost) return false;
    const item = index < 6 ? state.slots[index] : state.bench[index - 6];
    state.coins -= cost;
    state.stats.coinsSpent += cost;
    item.invested = (item.invested || 0) + cost;
    item.level++;
    mergeItems(state, item.id);
    return true;
  }

  function upgradePreview(state, index) {
    if (!canPrepare(state)) return null;
    const cost = getUpgradeCost(state, index);
    if (cost === null) return null;
    const source = index < 6 ? state.slots[index] : state.bench[index - 6];
    const before = new Map([...state.slots, ...state.bench].filter(Boolean).map(item => [item.uid, item.level]));
    const clone = JSON.parse(JSON.stringify(state));
    const affordable = state.coins >= cost;
    clone.coins = Math.max(clone.coins, cost);
    if (!upgradeItem(clone, index)) return null;
    const all = [...clone.slots, ...clone.bench];
    const merges = all.flatMap((item, resultIndex) => item && before.has(item.uid) && item.level > before.get(item.uid) && (item.uid !== source.uid || item.level > source.level + 1)
      ? [{ uid: item.uid, id: item.id, fromLevel: before.get(item.uid), toLevel: item.level, invested: item.invested, index: resultIndex }] : []);
    const survivingIndex = all.findIndex(item => item?.uid === source.uid);
    const resultIndex = survivingIndex >= 0 ? survivingIndex : merges.find(merge => merge.id === source.id)?.index;
    if (resultIndex === undefined) return null;
    return { state: clone, item: all[resultIndex], index: resultIndex, cost, fromLevel: source.level, stats: getItemStats(clone, resultIndex), synergies: getSynergies(clone), merges, affordable };
  }

  function getRerollCost(state) {
    return Math.min(3, (state.shop?.rerolls || 0) + 1);
  }

  function rerollShop(state) {
    if (!canPrepare(state) || !state.shop || state.shop.offers.every(offer => offer?.locked)) return false;
    const cost = getRerollCost(state);
    if (state.coins < cost) return false;
    state.coins -= cost;
    state.stats.coinsSpent += cost;
    state.stats.rerolls++;
    state.shop.rerolls++;
    refreshOffers(state);
    return true;
  }

  function toggleShopLock(state, offerIndex) {
    if (!canPrepare(state) || !Number.isInteger(offerIndex)) return false;
    const offer = state.shop?.offers[offerIndex];
    if (!offer) return false;
    offer.locked = !offer.locked;
    return true;
  }

  function getSellValue(state, itemIndex) {
    if (!Number.isInteger(itemIndex) || itemIndex < 0) return 0;
    const item = itemIndex < 6 ? state.slots[itemIndex] : state.bench[itemIndex - 6];
    return item ? Math.floor(Math.max(0, item.invested || 0) / 2) : 0;
  }

  function sellItem(state, itemIndex) {
    if (!canPrepare(state) || !Number.isInteger(itemIndex) || itemIndex < 0) return false;
    const item = itemIndex < 6 ? state.slots[itemIndex] : state.bench[itemIndex - 6];
    if (!item) return false;
    const refund = getSellValue(state, itemIndex);
    state.coins += refund;
    state.stats.coinsEarned += refund;
    if (itemIndex < 6) state.slots[itemIndex] = null;
    else state.bench.splice(itemIndex - 6, 1);
    return true;
  }

  function heal(state) {
    if (!canPrepare(state) || !state.shop || state.shop.healUsed || state.coins < 4 || state.willpower >= state.maxWillpower) return false;
    state.coins -= 4;
    state.stats.coinsSpent += 4;
    state.willpower = Math.min(state.maxWillpower, state.willpower + 15);
    state.shop.healUsed = true;
    return true;
  }

  function purchasePreview(state, offerIndex) {
    if (!canPrepare(state) || !Number.isInteger(offerIndex) || !state.shop?.offers[offerIndex]) return null;
    const offer = state.shop.offers[offerIndex];
    const before = new Map([...state.slots, ...state.bench].filter(Boolean).map(item => [item.uid, item.level]));
    const clone = JSON.parse(JSON.stringify(state));
    const affordable = state.coins >= offer.price;
    clone.coins = Math.max(clone.coins, offer.price);
    const newUid = `i${clone.nextUid}`;
    if (!buyItem(clone, offerIndex)) return null;
    const all = [...clone.slots, ...clone.bench];
    const merges = all.flatMap((item, index) => item && before.has(item.uid) && item.level > before.get(item.uid)
      ? [{ uid: item.uid, id: item.id, fromLevel: before.get(item.uid), toLevel: item.level, invested: item.invested, index }] : []);
    const index = all.findIndex(item => item?.uid === newUid);
    const resultIndex = index >= 0 ? index : merges.find(merge => merge.id === offer.id)?.index;
    if (resultIndex === undefined) return null;
    return { state: clone, item: all[resultIndex], definition: getItemDefinition(all[resultIndex]), index: resultIndex, stats: getItemStats(clone, resultIndex), synergies: getSynergies(clone), merges, affordable };
  }

  function migrateRun(value) {
    if (!value || ![1, VERSION].includes(value.version)) return null;
    let state;
    try { state = JSON.parse(JSON.stringify(value)); } catch { return null; }
    if (state.version === VERSION) {
      if (!Array.isArray(state.slots) || state.slots.length !== 6 || !Array.isArray(state.bench) || !COURSES[state.course]) return null;
      addStrategyFields(state);
      return state;
    }
    if (!Array.isArray(state.slots) || state.slots.length !== 6 || !Array.isArray(state.bench) || !Number.isInteger(state.course) || !COURSES[state.course]) return null;
    if (!["prep", "battle", "reward", "won", "lost"].includes(state.phase) || (state.phase === "reward" && state.course === COURSES.length - 1)) return null;
    const validItem = item => item && ITEMS[item.id] && Number.isInteger(item.level) && item.level >= 1 && item.level <= MAX_LEVEL && typeof item.uid === "string";
    state.slots = state.slots.map(item => validItem(item) ? { ...item, invested: 0 } : null);
    state.bench = state.bench.filter(validItem).map(item => ({ ...item, invested: 0 }));
    state.version = VERSION;
    state.coins = ["won", "lost"].includes(state.phase) ? 0 : ECONOMY.startingCoins;
    state.lastBattle = null;
    state.stats = {
      killed: 0, damageDealt: 0, damageTaken: 0, shielded: 0, coursesCleared: 0, synergiesUsed: 0,
      ...state.stats, coinsEarned: state.coins, coinsSpent: 0, rerolls: 0,
    };
    if (!Number.isFinite(state.randomState)) state.randomState = hashSeed(state.seed || "migrated-run");
    if (!Number.isInteger(state.nextUid) || state.nextUid < 1) state.nextUid = 1;
    delete state.shop;
    if (state.phase === "reward") {
      state.lastBattle = { course: state.course, killed: state.battle?.killed || 0, total: state.battle?.total || COURSES[state.course].total, escaped: state.battle?.escaped || 0, income: 6 };
      state.course++;
      state.phase = "prep";
      state.battle = null;
    } else if (state.phase === "prep") state.battle = null;
    delete state.rewardChoices;
    openShop(state, state.course);
    addStrategyFields(state);
    return state;
  }

  function addStrategyFields(state) {
    // An incomplete event save must not strand an otherwise valid run behind a modal.
    if (Object.hasOwn(state, "encounters") && !validEncounters(state.encounters)) delete state.encounters;
    else if (state.encounters?.pending && !ENCOUNTER_COURSES.includes(state.encounters.pending.course)) state.encounters.pending = null;
    if (state.battle && Object.hasOwn(state.battle, "eventBuff") && !validEventBuff(state.battle.eventBuff)) {
      delete state.battle.eventBuff;
      delete state.battle.eventBuffAnnounced;
    }
    if (!Array.isArray(state.formationPlan) || state.formationPlan.length !== 6 || state.formationPlan.some(id => !FORMATIONS[id])) state.formationPlan = makeFormationPlan(state.seed);
    for (const item of [...state.slots, ...state.bench].filter(Boolean)) {
      if (TACTICS[item.id] && !TACTICS[item.id].some(tactic => tactic.id === item.tactic)) item.tactic = TACTICS[item.id][0].id;
    }
    // Do not add formationId to an existing battle: absence is the legacy-wave marker.
    if (state.battle && state.phase === "battle") ensureBattleFields(state);
  }

  function makeReport(state) {
    const b = state.battle;
    const definition = FORMATIONS[b.formationId];
    return {
      formationId: b.formationId || "legacy", formationName: definition?.name || COURSES[state.course].name,
      course: state.course, duration: 0, willpowerStart: state.willpower, willpowerEnd: state.willpower,
      killed: 0, escaped: 0, damageTaken: 0,
      items: state.slots.flatMap((item, index) => item ? [{ uid: item.uid, id: item.id, name: getItemDefinition(item).name, level: item.level, tactic: getTactic(state, index)?.id || null, tacticLabel: getTactic(state, index)?.label || "", damage: 0, overkill: 0, activations: 0, kills: 0, shield: 0, blocked: 0, recharge: 0, chains: 0, idleTime: 0, healingPrevented: 0 }] : []),
      leaks: [], chains: [], insights: b.eventBuff ? [`Begegnung: ${b.eventBuff.label}. ${b.eventBuff.description}`] : [],
    };
  }

  function ensureBattleFields(state) {
    const b = state.battle;
    b.cooldownMax ||= [...b.cooldowns];
    b.itemRuntime ||= state.slots.map(item => ({ shotsRemaining: item?.id === "awp" ? 2 : 0, momentum: 0, rhythm: 0, focus: 0, episode: 0 }));
    for (let index = 0; index < 6; index++) b.itemRuntime[index] ||= { shotsRemaining: state.slots[index]?.id === "awp" ? 2 : 0, momentum: 0, rhythm: 0, focus: 0, episode: 0 };
    for (const runtime of b.itemRuntime) runtime.episode ??= 0;
    b.chainReady ||= {};
    b.shieldSources ||= [];
    if (!b.report) {
      b.report = makeReport(state);
      if (b.time > 0) {
        b.report.partial = true;
        b.report.insights.push("Alter Spielstand: Detailwerte werden erst seit dem Laden aufgezeichnet.");
      }
    }
    for (const entry of b.report.items) entry.healingPrevented ??= 0;
    // Fixtures and old saves can introduce items without replacing the runtime snapshot.
    for (let index = 0; index < 6; index++) {
      const item = state.slots[index];
      if (item && !b.report.items.some(entry => entry.uid === item.uid)) {
        const tactic = getTactic(state, index);
        b.report.items.push({ uid: item.uid, id: item.id, name: getItemDefinition(item).name, level: item.level, tactic: tactic?.id || null, tacticLabel: tactic?.label || "", damage: 0, overkill: 0, activations: 0, kills: 0, shield: 0, blocked: 0, recharge: 0, chains: 0, idleTime: 0, healingPrevented: 0 });
      }
    }
  }

  function reportItem(state, slot) {
    const item = state.slots[slot];
    return item && state.battle.report.items.find(entry => entry.uid === item.uid);
  }

  function startBattle(state) {
    if (!canPrepare(state) || state.bench.length > MAX_BENCH_SIZE || !state.slots.some(Boolean) || !COURSES[state.course]) return false;
    const plan = getBattlePlan(state);
    const eventBuff = getEventBuff(state);
    state.phase = "battle";
    state.battle = {
      time: 0, enemies: [], cooldowns: state.slots.map((item, i) => item ? 0.6 + i * 0.14 : 0),
      spawned: 0, total: plan.total, killed: 0, escaped: 0, shield: Math.min(35, Math.max(0, eventBuff?.startingShield || 0)), eventBuff, eventBuffAnnounced: false,
      nextSpawn: 0.3, duration: 0, lastEvents: [], mouthGuard: 0, mouthGuardSlot: -1,
      formationId: plan.formation.id, enemyTypes: [...plan.enemyTypes], spawnEvery: plan.spawnEvery,
      hpMultiplier: plan.formation.hpMultiplier, speedMultiplier: plan.formation.speedMultiplier, balance: getCourseBalance(state.course),
    };
    ensureBattleFields(state);
    if (state.encounters) state.encounters.nextBuff = null;
    state.stats.synergiesUsed += getSynergies(state).length;
    return true;
  }

  function spawnEnemy(state, events) {
    const b = state.battle;
    const type = (b.formationId ? b.enemyTypes : COURSES[state.course].enemyTypes)[b.spawned];
    const definition = ENEMIES[type];
    // Missing balance marks an already-running save: preserve its original scaling.
    const balance = b.balance;
    const scale = balance
      ? (definition.boss ? balance.bossHpScale : balance.hpScale) * (b.hpMultiplier || 1)
      : definition.boss ? 1 : (1 + state.course * 0.38) * (b.hpMultiplier || 1);
    const shieldScale = balance && definition.boss ? balance.bossShieldScale * (b.hpMultiplier || 1) : scale;
    const speedScale = balance
      ? (definition.boss ? balance.bossSpeedScale : balance.speedScale) * (b.speedMultiplier || 1)
      : definition.boss ? 1 : (1 + state.course * 0.14) * (b.speedMultiplier || 1);
    const damageScale = balance ? balance.damageScale : 1 + state.course * 0.08;
    const hp = Math.round(definition.hp * scale);
    const support = type === "suppe" && ["support", "finale"].includes(b.formationId);
    const enemy = {
      ...definition, type, uid: `e${state.nextUid++}`, lane: b.spawned % 3,
      x: 1.02, hp, maxHp: hp, shield: Math.round((definition.shield || 0) * shieldScale),
      maxShield: Math.round((definition.shield || 0) * shieldScale),
      speed: definition.speed * speedScale,
      damage: Math.round(definition.damage * damageScale), slowUntil: 0, vulnerableUntil: 0,
      support, nextHeal: support ? b.time + 3.5 : 0,
    };
    b.enemies.push(enemy);
    b.spawned++;
    events.push({ type: "spawn", enemyUid: enemy.uid, message: enemy.boss ? "Leonie serviert das Dessert-Finale!" : `${enemy.name} wird serviert.` });
  }

  function emitChain(state, id, slot, sourceSlot, events, details = {}) {
    const b = state.battle;
    let entry = b.report.chains.find(chain => chain.id === id);
    if (!entry) b.report.chains.push(entry = { id, name: CHAIN_NAMES[id], count: 0 });
    entry.count++;
    const owner = reportItem(state, sourceSlot);
    if (owner) owner.chains++;
    events.push({ type: "chain", id, name: CHAIN_NAMES[id], slot, sourceSlot, message: CHAIN_NAMES[id], ...details });
  }

  function rechargeSlots(state, sourceSlot, indices, seconds) {
    const b = state.battle;
    const changed = [];
    let amount = 0;
    for (const index of indices) {
      if (!state.slots[index]) continue;
      const before = b.cooldowns[index] || 0;
      b.cooldowns[index] = Math.max(0, before - seconds);
      const gain = before - b.cooldowns[index];
      if (gain > 0) { changed.push(index); amount += gain; }
    }
    const owner = reportItem(state, sourceSlot);
    if (owner) owner.recharge += amount;
    return { slots: changed, amount };
  }

  function triggerRechargeChain(state, id, sourceSlot, neighborId, seconds, events) {
    const b = state.battle;
    const key = `${id}:${sourceSlot}`;
    if ((b.chainReady[key] || 0) > b.time) return;
    const indices = state.slots.flatMap((item, index) => item?.id === neighborId && adjacent(sourceSlot, index) ? [index] : []);
    const result = rechargeSlots(state, sourceSlot, indices, seconds);
    if (!result.slots.length) return;
    b.chainReady[key] = b.time + 4;
    emitChain(state, id, result.slots[0], sourceSlot, events, { rechargedSlots: result.slots, amount: result.amount });
  }

  function dealDamage(state, enemy, amount, slot, events, shieldPierce = 0, strip = 0) {
    if (!enemy || enemy.hp <= 0) return;
    const b = state.battle;
    const wasMarked = (enemy.vulnerableUntil || 0) > b.time;
    if (wasMarked) amount *= 1.25;
    const stripped = Math.min(enemy.shield || 0, Math.max(0, strip));
    enemy.shield = (enemy.shield || 0) - stripped;
    const absorbed = Math.min(enemy.shield || 0, amount * (1 - shieldPierce));
    enemy.shield = (enemy.shield || 0) - absorbed;
    const hpBefore = enemy.hp;
    const hpDamage = Math.min(hpBefore, Math.max(0, amount - absorbed));
    enemy.hp -= hpDamage;
    const actual = hpDamage + absorbed + stripped;
    const overkill = Math.max(0, amount - absorbed - hpBefore);
    state.stats.damageDealt += actual;
    const owner = reportItem(state, slot);
    if (owner) { owner.damage += actual; owner.overkill += overkill; }
    events.push({ type: "attack", slot, enemyUid: enemy.uid, position: { x: enemy.x, lane: enemy.lane }, amount: Math.round(actual), actualAmount: actual, overkill });
    if (enemy.hp <= 0) {
      b.killed++;
      state.stats.killed++;
      if (owner) owner.kills++;
      events.push({ type: "kill", slot, enemyUid: enemy.uid, position: { x: enemy.x, lane: enemy.lane }, message: enemy.boss ? "Das Dessert ist vom Tisch!" : `${enemy.name} abgewehrt.` });
      if (wasMarked && state.slots[slot]?.id === "awp") triggerRechargeChain(state, "marked_finish", slot, "luca", 1.5, events);
    }
  }

  function rechargeNeighbors(state, index, seconds) {
    const indices = state.slots.flatMap((item, other) => item && adjacent(index, other) ? [other] : []);
    return rechargeSlots(state, index, indices, seconds).slots;
  }

  function threatOrder(a, b) {
    return Number(Boolean(b.boss)) - Number(Boolean(a.boss)) || Number(Boolean(b.support)) - Number(Boolean(a.support)) || b.damage - a.damage || a.x - b.x;
  }

  function chooseTargets(state, index, targets, stats) {
    const tactic = getTactic(state, index)?.id;
    if (["shield", "coffee", "refresh", "mouth_guard", "radio", "haste"].includes(stats.effect)) return [];
    if (stats.effect === "snipe") return [...targets].sort((a, b) => (tactic === "marked" ? Number((b.vulnerableUntil || 0) > state.battle.time) - Number((a.vulnerableUntil || 0) > state.battle.time) : 0) || threatOrder(a, b)).slice(0, 1);
    if (stats.effect === "mark") return [...targets].sort((a, b) => (tactic === "armored" ? (b.shield || 0) - (a.shield || 0) : 0) || a.x - b.x).slice(0, 1);
    if (stats.effect === "paint") return [...targets].sort((a, b) => (b.shield || 0) - (a.shield || 0) || a.x - b.x).slice(0, 1);
    if (stats.effect === "podcast") return stats.episode === 2 ? targets : targets.slice(0, 2);
    if (stats.effect === "type_attack") return [...targets].sort((a, b) => tactic === "cleanup" ? a.hp + (a.shield || 0) - b.hp - (b.shield || 0) || a.x - b.x : Number(["erbsen", "brokkoli"].includes(b.type)) - Number(["erbsen", "brokkoli"].includes(a.type)) || a.x - b.x).slice(0, 2);
    if (["attack", "assist"].includes(stats.effect)) return targets.slice(0, 1);
    if (stats.effect === "fork") return targets.slice(0, 2);
    if (stats.effect === "store") return [targets.find(enemy => !enemy.boss && enemy.hp + enemy.shield <= stats.power * 1.3) || targets[0]];
    return targets;
  }

  function growMomentum(state, activatedSlot, events) {
    const b = state.battle;
    if (!ITEMS[state.slots[activatedSlot].id].tags?.includes("gaming")) return;
    for (let index = 0; index < 6; index++) {
      if (state.slots[index]?.id !== "luca" || (index !== activatedSlot && !adjacent(index, activatedSlot))) continue;
      const runtime = b.itemRuntime[index];
      if (runtime.momentum >= 5) continue;
      runtime.rhythm++;
      if (runtime.rhythm < 3) continue;
      runtime.rhythm = 0;
      runtime.momentum++;
      emitChain(state, "gaming_rhythm", index, index, events, { amount: runtime.momentum, activatedSlot, message: `Duo im Rhythmus: Momentum ${runtime.momentum}/5 (+${runtime.momentum * 10} %).` });
    }
  }

  function activateItem(state, index, events) {
    const item = state.slots[index];
    const stats = getItemStats(state, index);
    const b = state.battle;
    const targets = b.enemies.filter(enemy => enemy.hp > 0).sort((a, c) => a.x - c.x);
    if (!targets.length && !["shield", "coffee", "refresh", "mouth_guard", "radio", "haste"].includes(stats.effect)) return false;
    const affectedTargets = chooseTargets(state, index, targets, stats);
    const front = affectedTargets[0];
    const runtime = b.itemRuntime[index];
    let power = stats.power;
    if (affectedTargets.length && runtime.focus) { power *= 1.2; runtime.focus = 0; }
    const activation = {
      type: "activate", slot: index, itemId: item.id, itemUid: item.uid, level: item.level,
      effect: stats.effect, power, cooldown: stats.cooldown, tactic: getTactic(state, index)?.id || null,
      targets: affectedTargets.map(enemy => ({ uid: enemy.uid, x: enemy.x, lane: enemy.lane, type: enemy.type })),
    };
    if (stats.effect === "podcast") { activation.episode = stats.episode + 1; activation.finale = activation.episode === stats.episodeLength; }
    events.push(activation);
    reportItem(state, index).activations++;
    switch (stats.effect) {
      case "attack": dealDamage(state, front, power, index, events); break;
      case "store":
        dealDamage(state, front, !front.boss && front.hp + front.shield <= power * 1.3 ? front.hp + front.shield : power, index, events);
        break;
      case "fork":
        affectedTargets.forEach(enemy => dealDamage(state, enemy, power, index, events));
        break;
      case "pulse":
        targets.forEach(enemy => dealDamage(state, enemy, power, index, events));
        break;
      case "push":
        targets.forEach(enemy => {
          dealDamage(state, enemy, power, index, events);
          enemy.x = Math.min(1.04, enemy.x + (enemy.boss ? CONTROL.bossPushDistance : CONTROL.pushDistance));
        });
        break;
      case "slow":
        targets.forEach(enemy => {
          enemy.slowUntil = Math.max(enemy.slowUntil, b.time + stats.slowDuration);
          dealDamage(state, enemy, power, index, events);
        });
        events.push({ type: "slow", slot: index, amount: targets.length, message: "„Bin im Call!“ – Gerichte verlangsamt." });
        break;
      case "shield":
      case "coffee":
      case "radio":
      case "refresh": {
        const gain = Math.max(0, Math.min(35 - b.shield, power));
        b.shield += gain;
        reportItem(state, index).shield += gain;
        if (gain > 0) b.shieldSources.push({ uid: item.uid, amount: gain });
        events.push({ type: "shield", slot: index, amount: Math.round(gain), message: `+${Math.round(gain)} Ausreden-Schild` });
        if (stats.effect === "refresh") {
          activation.rechargedSlots = rechargeNeighbors(state, index, stats.recharge);
          const focused = state.slots.flatMap((neighbor, other) => neighbor && adjacent(index, other) && ITEMS[neighbor.id].tags?.includes("gaming") && !b.itemRuntime[other].focus ? [other] : []);
          for (const other of focused) b.itemRuntime[other].focus = 1;
          if (focused.length) emitChain(state, "beer_focus", focused[0], index, events, { rechargedSlots: focused, amount: 20 });
        } else if (stats.effect === "radio") activation.rechargedSlots = rechargeSlots(state, index, [stats.remoteSlot], stats.recharge).slots;
        break;
      }
      case "haste":
        activation.recharge = stats.recharge;
        activation.rechargedSlots = rechargeNeighbors(state, index, stats.recharge);
        break;
      case "mouth_guard": {
        const current = b.mouthGuard || 0;
        if (power >= current) { b.mouthGuard = power; b.mouthGuardSlot = index; }
        events.push({ type: "guard", slot: index, amount: Math.round(b.mouthGuard), message: "Snus drin. Der nächste normale Bissen wird abgeblockt." });
        break;
      }
      case "assist": {
        dealDamage(state, front, power, index, events);
        const candidates = state.slots.flatMap((neighbor, other) => neighbor && adjacent(index, other) && ITEMS[neighbor.id].tags?.includes("gaming") && b.cooldowns[other] > 0 ? [other] : []);
        const longest = getTactic(state, index).id === "longest";
        candidates.sort((a, c) => (longest ? b.cooldowns[c] - b.cooldowns[a] : getItemStats(state, c).power - getItemStats(state, a).power) || a - c);
        activation.rechargedSlots = rechargeSlots(state, index, candidates.slice(0, 1), stats.recharge).slots;
        break;
      }
      case "mark":
        dealDamage(state, front, power, index, events);
        if (front.hp > 0) {
          front.vulnerableUntil = Math.max(front.vulnerableUntil || 0, b.time + 3);
          events.push({ type: "mark", slot: index, enemyUid: front.uid, position: { x: front.x, lane: front.lane }, duration: 3, message: "Desolator: Rüstung runter! Folgende Treffer verursachen +25 % Schaden." });
        }
        break;
      case "podcast": {
        const duration = activation.finale ? stats.finaleDuration : stats.slowDuration;
        affectedTargets.forEach(enemy => {
          enemy.slowUntil = Math.max(enemy.slowUntil || 0, b.time + duration);
          dealDamage(state, enemy, power, index, events);
        });
        events.push({ type: "slow", slot: index, amount: affectedTargets.length, duration, message: activation.finale ? "Noch ein letzter Gedanke: alle Gerichte verlangsamt." : "Lanz & Precht: zwei Gerichte hören noch zu." });
        runtime.episode = activation.episode % stats.episodeLength;
        if (activation.finale) emitChain(state, "podcast_finale", index, index, events, { amount: affectedTargets.length });
        break;
      }
      case "paint": {
        const stripped = Math.min(front.shield || 0, stats.strip);
        const until = b.time + stats.paintDuration;
        if (until >= (front.paintUntil || 0)) { front.paintUntil = until; front.paintSourceUid = item.uid; }
        events.push({ type: "paint", slot: index, enemyUid: front.uid, position: { x: front.x, lane: front.lane }, amount: stripped, duration: front.paintUntil - b.time, message: `Frisch gestrichen: ${stripped} Käse-Schild entfernt, Heilung blockiert.` });
        dealDamage(state, front, power, index, events, 0, stats.strip);
        break;
      }
      case "snipe": dealDamage(state, front, power, index, events, 0.5); break;
      case "type_attack":
        affectedTargets.forEach(enemy => dealDamage(state, enemy, power * (["erbsen", "brokkoli"].includes(enemy.type) ? 2 : 1), index, events));
        break;
    }
    growMomentum(state, index, events);
    return true;
  }

  function finishReport(state) {
    const b = state.battle;
    const report = b.report;
    report.duration = b.time;
    report.willpowerEnd = state.willpower;
    report.killed = b.killed;
    report.escaped = b.escaped;
    const damaging = [...report.items].sort((a, c) => c.damage - a.damage)[0];
    if (damaging?.damage > 0) report.insights.push(`${damaging.name} verursachte den meisten Schaden (${Math.round(damaging.damage)}).`);
    const missed = [...report.items].sort((a, c) => c.overkill - a.overkill)[0];
    if (missed?.overkill >= 30) report.insights.push(`${missed.name}: ${Math.round(missed.overkill)} überschüssiger Schaden. Eine andere Zielpriorität kann Treffer besser verteilen.`);
    for (const owner of report.items.filter(item => item.healingPrevented > 0)) report.insights.push(`${owner.name} verhinderte ${Math.round(owner.healingPrevented)} Portionen Suppen-Heilung.`);
    const worst = [...report.leaks].sort((a, c) => c.damage - a.damage)[0];
    if (worst?.damage > 0) report.insights.push(`${ENEMIES[worst.type].name} kostete ${Math.round(worst.damage)} Willenskraft (${worst.count} durchgelassen).`);
    if (report.formationId === "support" || report.formationId === "finale") report.insights.push("Heilende Suppen verlängern den Kampf. AWP-Bedrohungsfokus entfernt sie nach dem Boss zuerst.");
    if (!report.chains.length) report.insights.push("Keine Ereigniskette ausgelöst. Bier neben Gaming, Snus neben Bier oder Desolator → AWP → Luca verbindet deine Gegenstände.");
    return JSON.parse(JSON.stringify(report));
  }

  function getBattleReport(state) {
    return state.lastBattle?.report ? JSON.parse(JSON.stringify(state.lastBattle.report)) : null;
  }

  function finishBattle(state, events) {
    const b = state.battle;
    b.duration = b.time;
    const report = finishReport(state);
    if (state.willpower <= 0) {
      state.phase = "lost";
      state.lastBattle = { course: state.course, killed: b.killed, total: b.total, escaped: b.escaped, income: 0, report };
      events.push({ type: "defeat", message: "„Na gut. Einen Bissen.“" });
      return;
    }
    state.stats.coursesCleared++;
    const income = getCourseIncome(state.course);
    state.coins += income;
    state.stats.coinsEarned += income;
    state.lastBattle = { course: state.course, killed: b.killed, total: b.total, escaped: b.escaped, income, report };
    if (state.course === COURSES.length - 1) {
      state.phase = "won";
      events.push({ type: "victory", income, message: "Sechs Gänge überstanden. Gabriel ist frei!" });
    } else {
      state.course++;
      state.phase = "prep";
      state.battle = null;
      openShop(state, state.shop.visit + 1);
      queueEncounter(state);
      events.push({ type: "victory", income, message: `Gang abgewehrt! +${income} Münzen für neue Ausreden.` });
    }
  }

  function recordShieldBlock(state, amount) {
    const b = state.battle;
    let remaining = amount;
    for (const source of b.shieldSources) {
      const consumed = Math.min(source.amount, remaining);
      source.amount -= consumed;
      remaining -= consumed;
      const item = b.report.items.find(entry => entry.uid === source.uid);
      if (item) item.blocked += consumed;
      if (remaining <= 0) break;
    }
    b.shieldSources = b.shieldSources.filter(source => source.amount > 0);
  }

  function stepBattle(state, dt, events) {
    const b = state.battle;
    b.time += dt;
    const spawnEvery = b.formationId ? b.spawnEvery : COURSES[state.course].spawnEvery;
    if (b.spawned < b.total && b.time >= b.nextSpawn) {
      spawnEnemy(state, events);
      b.nextSpawn += spawnEvery;
    }
    for (let i = 0; i < 6; i++) {
      const item = state.slots[i];
      if (!item) continue;
      b.cooldowns[i] = Math.max(0, (b.cooldowns[i] || 0) - dt);
      if (b.cooldowns[i] > 0) continue;
      if (item.id === "awp" && b.itemRuntime[i].shotsRemaining === 0) b.itemRuntime[i].shotsRemaining = 2;
      if (activateItem(state, i, events)) {
        const stats = getItemStats(state, i);
        let cooldown = stats.cooldown;
        if (item.id === "awp") {
          const runtime = b.itemRuntime[i];
          runtime.shotsRemaining = (runtime.shotsRemaining ?? 2) - 1;
          if (runtime.shotsRemaining > 0) cooldown = stats.shotInterval;

        }
        b.cooldowns[i] = b.cooldownMax[i] = cooldown;
      } else reportItem(state, i).idleTime += dt;
    }
    for (const enemy of b.enemies) {
      if (enemy.hp <= 0) continue;
      if (enemy.support && b.time >= enemy.nextHeal) {
        enemy.nextHeal += 3.5;
        for (const target of b.enemies) {
          if (target === enemy || target.hp <= 0 || target.hp >= target.maxHp) continue;
          const amount = Math.min(target.maxHp - target.hp, target.maxHp * 0.06);
          if ((target.paintUntil || 0) > b.time) {
            const owner = b.report.items.find(item => item.uid === target.paintSourceUid);
            if (owner) owner.healingPrevented = (owner.healingPrevented || 0) + amount;
            const sourceSlot = state.slots.findIndex(item => item?.uid === target.paintSourceUid);
            events.push({ type: "enemy_heal_blocked", enemyUid: target.uid, healerUid: enemy.uid, position: { x: target.x, lane: target.lane }, amount, ...(sourceSlot >= 0 ? { sourceSlot } : {}), message: `Frische Farbe verhindert ${Math.round(amount)} Portionen Heilung.` });
            continue;
          }
          target.hp += amount;
          events.push({ type: "enemy_heal", enemyUid: target.uid, sourceUid: enemy.uid, amount, position: { x: target.x, lane: target.lane }, message: `Suppen-Support: +${Math.round(amount)} Portionen` });
        }
      }
      const slowFactor = enemy.slowUntil > b.time ? CONTROL.slowFactor : 1;
      enemy.x -= enemy.speed * slowFactor * dt;
      if (enemy.x > 0) continue;
      const blockable = enemy.damage * (1 - (enemy.bypass || 0));
      const blocked = Math.min(b.shield, blockable);
      b.shield -= blocked;
      recordShieldBlock(state, blocked);
      let damage = Math.max(0, enemy.damage - blocked);
      let guardBlocked = 0;
      if (!enemy.boss && damage > 0 && (b.mouthGuard || 0) > 0) {
        guardBlocked = Math.min(damage, b.mouthGuard);
        b.mouthGuard = 0;
        damage -= guardBlocked;
        const guardSlot = b.mouthGuardSlot ?? -1;
        const owner = reportItem(state, guardSlot);
        if (owner) owner.blocked += guardBlocked;
        events.push({ type: "guard_block", slot: guardSlot, enemyUid: enemy.uid, position: { x: enemy.x, lane: enemy.lane }, amount: Math.round(guardBlocked), message: `Snus im Mund: ${Math.round(guardBlocked)} Schaden abgeblockt.` });
        if (guardSlot >= 0) triggerRechargeChain(state, "snus_beer", guardSlot, "beer", 2, events);
        b.mouthGuardSlot = -1;
      }
      const actualDamage = enemy.boss ? state.willpower : Math.min(state.willpower, damage);
      state.willpower -= actualDamage;
      state.stats.damageTaken += actualDamage;
      b.report.damageTaken += actualDamage;
      let leak = b.report.leaks.find(entry => entry.type === enemy.type);
      if (!leak) b.report.leaks.push(leak = { type: enemy.type, count: 0, damage: 0 });
      leak.count++;
      leak.damage += actualDamage;
      state.stats.shielded += blocked + guardBlocked;
      b.escaped++;
      enemy.hp = 0;
      events.push({ type: "hit", enemyUid: enemy.uid, position: { x: enemy.x, lane: enemy.lane }, amount: Math.round(actualDamage), actualAmount: actualDamage, message: actualDamage > 0 ? `${enemy.name}: −${Math.round(actualDamage)} Willenskraft` : guardBlocked > 0 ? "Snus im Mund. Der Bissen bleibt draußen!" : "Ausrede akzeptiert. Schild hält!" });
    }
    b.enemies = b.enemies.filter(enemy => enemy.hp > 0);
    if (state.willpower <= 0 || (b.spawned === b.total && b.enemies.length === 0)) finishBattle(state, events);
  }

  function updateBattle(state, dtSeconds) {
    if (state.phase !== "battle" || !state.battle) return [];
    const battle = state.battle;
    let remaining = Math.min(2, Math.max(0, Number(dtSeconds) || 0));
    if (remaining <= 0) return [];
    ensureBattleFields(state);
    const events = [];
    if (battle.eventBuff && !battle.eventBuffAnnounced) {
      events.push({ type: "event_buff", label: battle.eventBuff.label, description: battle.eventBuff.description, message: `${battle.eventBuff.label}: ${battle.eventBuff.description}` });
      battle.eventBuffAnnounced = true;
    }
    while (remaining > 0.00001 && state.phase === "battle") {
      const dt = Math.min(remaining, 0.05);
      stepBattle(state, dt, events);
      remaining -= dt;
    }
    battle.lastEvents = events.slice(-8);
    return events;
  }

  function getPotentialSynergies() {
    return SYNERGIES.map(synergy => ({ ids: [...synergy.ids], name: synergy.name, description: synergy.description }));
  }

  globalThis.AbendessenCore = {
    VERSION, MAX_LEVEL, MAX_BENCH_SIZE, ECONOMY, CONTROL, ITEMS, ENEMIES, COURSES, FORMATIONS, getCourseIncome, getCourseBalance, createRun, startBattle, updateBattle,
    buyItem, rerollShop, getRerollCost, toggleShopLock, sellItem, getSellValue, heal,
    purchasePreview, getUpgradeCost, upgradeItem, upgradePreview, migrateRun, moveItem, getSynergies, getItemStats, getItemDefinition, getPotentialSynergies,
    getTactics, getTactic, setTactic, getBattlePlan, getBattleReport, getEncounter, chooseEncounter, getEventBuff,
  };
})();
