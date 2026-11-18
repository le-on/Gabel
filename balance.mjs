#!/usr/bin/env node
// Observational benchmark, not a win-rate test. Run both engine versions with
// the same --prefix and --seeds; each policy receives exactly `${prefix}-${i}`.
// These deterministic test players are fixed heuristics, not optimal play or
// a model of real users. Keep their weights/decisions stable across comparisons.
// Examples:
//   node balance.mjs --seeds 200 --prefix economy --json /tmp/balance-after.json
//   node balance.mjs --engine /tmp/gabel-balance-before.js --seeds 200 --prefix economy --json /tmp/balance-before.json
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const DIRECTORY = dirname(fileURLToPath(import.meta.url));
const POLICY_NAMES = ['idle', 'blind', 'smart'];
const WEIGHTS = Object.freeze({ ventilator: 10, headset: 10, discord: 9, gabel: 8, brotdose: 8, serviette: 7, paper: 3, kaffee: 5, beer: 4, snus: 4, luca: 6, desolator: 6, awp: 8, batomon: 8, podcast: 8, umut: 7, walkie: 4, ritalin: 5 });
const STEP_SECONDS = 0.2;
const MAX_BATTLE_STEPS = 1800;
const round = (value, digits = 2) => Number(value.toFixed(digits));
const average = values => values.length ? round(values.reduce((sum, value) => sum + value, 0) / values.length) : null;
const percent = (count, total) => total ? round(100 * count / total, 1) : null;

function usage() {
  return 'Usage: node balance.mjs [--engine path] [--seeds positive-integer] [--prefix text] [--json path]\nDefaults: --engine dist/engine.js (relative to this script), --seeds 100, --prefix balance.\nEngine/json overrides are relative to the current working directory. --json writes summaries and per-seed observations.';
}

function parseArguments(args) {
  const options = { engine: resolve(DIRECTORY, 'dist/engine.js'), seeds: 100, prefix: 'balance', json: null };
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === '--help' || argument === '-h') return { help: true };
    const separator = argument.indexOf('=');
    const flag = separator < 0 ? argument : argument.slice(0, separator);
    if (!['--engine', '--seeds', '--prefix', '--json'].includes(flag)) throw new Error(`Unknown argument: ${argument}`);
    const value = separator < 0 ? args[++index] : argument.slice(separator + 1);
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}`);
    if (flag === '--engine') options.engine = resolve(value);
    if (flag === '--seeds') options.seeds = Number(value);
    if (flag === '--prefix') options.prefix = value;
    if (flag === '--json') options.json = resolve(value);
  }
  if (!Number.isSafeInteger(options.seeds) || options.seeds < 1) throw new Error('--seeds must be a positive safe integer.');
  return options;
}

function describe(values) {
  if (!values.length) return { n: 0, mean: null, min: null, p25: null, median: null, p75: null, max: null };
  const sorted = [...values].sort((a, b) => a - b);
  const quantile = fraction => {
    const position = fraction * (sorted.length - 1), lower = Math.floor(position);
    return round(sorted[lower] + (sorted[Math.ceil(position)] - sorted[lower]) * (position - lower));
  };
  return { n: values.length, mean: average(values), min: round(sorted[0]), p25: quantile(0.25), median: quantile(0.5), p75: quantile(0.75), max: round(sorted.at(-1)) };
}

function makeTestPlayers(C) {
  for (const id of Object.keys(C.ITEMS)) if (!Number.isFinite(WEIGHTS[id])) throw new Error(`No fixed heuristic weight for item ${id}; update the benchmark explicitly before comparing engines.`);
  const allItems = state => [...state.slots, ...state.bench].filter(Boolean);
  const itemValue = item => WEIGHTS[item.id] * (1 + 0.5 * (item.level - 1)) / (1 - 0.08 * (item.level - 1));
  const rosterValue = state => allItems(state).map(itemValue).sort((a, b) => b - a).slice(0, 6).reduce((sum, value) => sum + value, 0);

  function equipBest(state) {
    for (let repeat = 0; repeat < 12; repeat++) {
      const bench = state.bench.map((item, index) => ({ item, index: index + 6 })).sort((a, b) => itemValue(b.item) - itemValue(a.item));
      const slots = state.slots.map((item, index) => ({ item, index })).sort((a, b) => (a.item ? itemValue(a.item) : 0) - (b.item ? itemValue(b.item) : 0));
      if (!bench.length || itemValue(bench[0].item) <= (slots[0].item ? itemValue(slots[0].item) : 0)) break;
      C.moveItem(state, bench[0].index, slots[0].index);
    }
  }

  function layoutValue(state) {
    let value = 0;
    for (let index = 0; index < 6; index++) {
      const item = state.slots[index];
      if (!item) continue;
      const stats = C.getItemStats(state, index), base = C.ITEMS[item.id];
      // Ritalin has power=0: retain the audit's level-based fallback, avoiding NaN.
      value += WEIGHTS[item.id] * (base.power ? stats.power / base.power : 1 + 0.5 * (item.level - 1)) * (base.cooldown / stats.cooldown);
      if (item.id === 'walkie' && state.slots[5 - index]) value += itemValue(state.slots[5 - index]) * (stats.recharge || 1) / stats.cooldown;
    }
    return value;
  }

  function arrange(state) {
    let value = layoutValue(state);
    for (let roundIndex = 0; roundIndex < 2; roundIndex++) {
      let improved = false;
      for (let a = 0; a < 6; a++) for (let b = a + 1; b < 6; b++) {
        if (!state.slots[a]) continue;
        C.moveItem(state, a, b);
        const next = layoutValue(state);
        if (next > value + 1e-7) { value = next; improved = true; }
        else C.moveItem(state, b, a);
      }
      if (!improved) break;
    }
  }

  // Keep decisions stable across balance revisions. Instrumentation counts only
  // successful operations and does not alter the sequence of policy decisions.
  function shop(state, kind, actions) {
    if (kind === 'idle') return;
    if (kind === 'blind') {
      for (let index = 0; index < 4; index++) if (state.shop.offers[index] && state.shop.offers[index].price <= state.coins) {
        if (C.buyItem(state, index)) actions.buys++;
      }
      if (C.upgradeItem && state.slots.filter(Boolean).length >= 5) {
        for (let index = 0; index < 6; index++) if (C.upgradeItem(state, index)) actions.upgrades++;
      }
      for (let index = state.bench.length - 1; index >= 0; index--) if (C.sellItem(state, index + 6)) actions.sells++;
      return;
    }
    equipBest(state);
    if (state.willpower < 40 && state.coins >= 4 && C.heal(state)) actions.heals++;
    for (let action = 0; action < 18; action++) {
      const before = rosterValue(state), choices = [];
      for (let index = 0; index < 4; index++) {
        const offer = state.shop.offers[index];
        if (!offer || offer.price > state.coins) continue;
        const preview = C.purchasePreview(state, index);
        if (!preview) continue;
        const improvement = rosterValue(preview.state) - before;
        if (improvement > 0.1) choices.push({ kind: 'buy', index, roi: improvement / offer.price, improvement });
      }
      if (C.upgradePreview) for (let index = 0; index < 6; index++) {
        const cost = C.getUpgradeCost(state, index);
        if (!cost || cost > state.coins) continue;
        const preview = C.upgradePreview(state, index);
        if (!preview) continue;
        const improvement = rosterValue(preview.state) - before;
        if (improvement > 0.1) choices.push({ kind: 'upgrade', index, roi: improvement / cost, improvement });
      }
      choices.sort((a, b) => b.roi - a.roi || b.improvement - a.improvement);
      if (choices.length) {
        const chosen = choices[0];
        if (chosen.kind === 'buy') { if (C.buyItem(state, chosen.index)) actions.buys++; }
        else if (C.upgradeItem(state, chosen.index)) actions.upgrades++;
        equipBest(state);
        continue;
      }
      // Sell only unused reserves, respecting actual spending/refund rules.
      if (state.bench.length) {
        for (let index = state.bench.length - 1; index >= 0; index--) if (C.sellItem(state, index + 6)) actions.sells++;
        continue;
      }
      const cost = C.getRerollCost(state);
      if (state.shop.rerolls < 2 && state.coins >= cost + 4 && C.rerollShop(state)) { actions.rerolls++; continue; }
      break;
    }
    equipBest(state);
    arrange(state);
  }
  return { allItems, shop };
}

function simulate(C, players, seed, policy) {
  const state = C.createRun(seed);
  const actions = { buys: 0, upgrades: 0, rerolls: 0, sells: 0, heals: 0 };
  const hpBeforeCourses = Array(C.COURSES.length).fill(null);
  const hpBeforeShops = Array(C.COURSES.length).fill(null);
  let maxLevel = 1, bossBuild = null, bossCoins = null;
  for (let course = 0; course < C.COURSES.length; course++) {
    if (state.phase !== 'prep') throw new Error(`${policy}/${seed}: unexpected phase before shopping: ${state.phase}`);
    hpBeforeShops[state.course] = state.willpower;
    const encounter = C.getEncounter?.(state);
    if (encounter) {
      const choice = encounter.choices.find(option => option.affordable);
      if (!choice || !C.chooseEncounter(state, choice.id)) throw new Error(`${policy}/${seed}: encounter could not be resolved`);
    }
    players.shop(state, policy, actions);
    maxLevel = Math.max(maxLevel, ...players.allItems(state).map(item => item.level));
    hpBeforeCourses[state.course] = state.willpower;
    if (state.course === C.COURSES.length - 1) {
      bossBuild = state.slots.filter(Boolean).map(({ id, level }) => ({ id, level }));
      bossCoins = state.coins;
    }
    if (!C.startBattle(state)) throw new Error(`${policy}/${seed}: battle could not start`);
    let steps = 0;
    while (state.phase === 'battle' && steps++ < MAX_BATTLE_STEPS) C.updateBattle(state, STEP_SECONDS);
    if (state.phase === 'battle') throw new Error(`${policy}/${seed}: battle stalled after ${MAX_BATTLE_STEPS * STEP_SECONDS}s`);
    if (state.phase === 'lost' || state.phase === 'won') break;
  }
  if (!['won', 'lost'].includes(state.phase)) throw new Error(`${policy}/${seed}: run did not reach a terminal phase`);
  return {
    seed, policy, won: state.phase === 'won', cleared: state.stats.coursesCleared,
    reached: hpBeforeCourses.filter(value => value !== null).length,
    failedCourse: state.phase === 'lost' ? state.course + 1 : null,
    hpBeforeCourses, hpBeforeShops, finalHP: state.willpower, actions, maxLevel,
    spent: state.stats.coinsSpent || 0, earned: state.stats.coinsEarned || 0, coinsLeft: state.coins,
    finalItems: state.slots.filter(Boolean).map(({ id, level }) => ({ id, level })), bossBuild, bossCoins,
  };
}

// Presence at the last attempted battle is associated with winning, not a
// causal effect: purchases, survival, synergies and policy selection confound it.
// Boss-only associations compare entrants to the same final course, still observational.
function itemAssociations(C, runs, buildKey) {
  const ids = [...new Set(runs.flatMap(run => run[buildKey].map(item => item.id)))];
  return ids.map(id => {
    const withItem = runs.filter(run => run[buildKey].some(item => item.id === id));
    const withoutItem = runs.filter(run => !run[buildKey].some(item => item.id === id));
    const winsWith = withItem.filter(run => run.won).length, lossesWith = withItem.length - winsWith;
    const winsWithout = withoutItem.filter(run => run.won).length, lossesWithout = withoutItem.length - winsWithout;
    const denominator = Math.sqrt(withItem.length * withoutItem.length * (winsWith + winsWithout) * (lossesWith + lossesWithout));
    const winPctWith = percent(winsWith, withItem.length), winPctWithout = percent(winsWithout, withoutItem.length);
    const copies = withItem.flatMap(run => run[buildKey].filter(item => item.id === id));
    return { id, name: C.ITEMS[id].name, runsWith: withItem.length, runPct: percent(withItem.length, runs.length), copies: copies.length, averageLevel: average(copies.map(item => item.level)), winPctWith, winPctWithout, winDeltaPp: winPctWithout === null ? null : round(winPctWith - winPctWithout, 1), phi: denominator ? round((winsWith * lossesWithout - lossesWith * winsWithout) / denominator, 3) : null };
  }).sort((a, b) => b.runsWith - a.runsWith || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

function summarize(C, policy, runs) {
  const bossRuns = runs.filter(run => run.bossBuild !== null);
  const actions = Object.fromEntries(['buys', 'upgrades', 'rerolls', 'sells', 'heals'].map(key => [key, { total: runs.reduce((sum, run) => sum + run.actions[key], 0), perRun: average(runs.map(run => run.actions[key])) }]));
  const courses = C.COURSES.map((course, index) => {
    const entrants = runs.filter(run => run.hpBeforeCourses[index] !== null);
    const failed = runs.filter(run => run.failedCourse === index + 1).length;
    return { course: index + 1, reached: entrants.length, reachedPct: percent(entrants.length, runs.length), hpBefore: describe(entrants.map(run => run.hpBeforeCourses[index])), hpBeforeShop: describe(entrants.map(run => run.hpBeforeShops[index])), failed, failPctOfEntrants: percent(failed, entrants.length) };
  });
  return {
    policy, seeds: runs.length, wins: runs.filter(run => run.won).length, winPct: percent(runs.filter(run => run.won).length, runs.length),
    clearedAvg: average(runs.map(run => run.cleared)), reachedAvg: average(runs.map(run => run.reached)), finalHP: describe(runs.map(run => run.finalHP)),
    courses, failuresByCourse: courses.map(course => course.failed), shopActions: actions,
    economy: { spentAvg: average(runs.map(run => run.spent)), earnedAvg: average(runs.map(run => run.earned)), leftAvg: average(runs.map(run => run.coinsLeft)) },
    reachedAnyL3Pct: percent(runs.filter(run => run.maxLevel === 3).length, runs.length),
    bossEntry: { runs: bossRuns.length, pct: percent(bossRuns.length, runs.length), hp: describe(bossRuns.map(run => run.hpBeforeCourses.at(-1))), coinsAvg: average(bossRuns.map(run => run.bossCoins)), level2ItemsAvg: average(bossRuns.map(run => run.bossBuild.filter(item => item.level === 2).length)), level3ItemsAvg: average(bossRuns.map(run => run.bossBuild.filter(item => item.level === 3).length)) },
    finalItemAssociations: itemAssociations(C, runs, 'finalItems'), bossItemAssociations: itemAssociations(C, bossRuns, 'bossBuild'),
  };
}

function printResults(result) {
  console.log(`Deterministic benchmark · ${result.config.seeds} seeds/policy · prefix=${JSON.stringify(result.config.prefix)} · engine SHA256 ${result.engine.sha256.slice(0, 12)}`);
  console.log('Fixed test-player heuristics; item associations are correlations, not causal effects. HP is measured after shopping, immediately before each battle.');
  console.table(result.policies.map(policy => ({ policy: policy.policy, winPct: policy.winPct, clearedAvg: policy.clearedAvg, reachedAvg: policy.reachedAvg, bossEntryPct: policy.bossEntry.pct, bossHPavg: policy.bossEntry.hp.mean, finalHPavg: policy.finalHP.mean, spentAvg: policy.economy.spentAvg, coinsLeftAvg: policy.economy.leftAvg })));
  for (const policy of result.policies) {
    console.log(`\n${policy.policy}: HP before courses and failures`);
    console.table(policy.courses.map(course => ({ course: course.course, reached: course.reached, hpAvg: course.hpBefore.mean, hpMedian: course.hpBefore.median, hpMin: course.hpBefore.min, hpP25: course.hpBefore.p25, hpP75: course.hpBefore.p75, failed: course.failed, failedPct: course.failPctOfEntrants })));
    console.log('Shop actions per run:', JSON.stringify(Object.fromEntries(Object.entries(policy.shopActions).map(([key, value]) => [key, value.perRun]))));
    console.log('Most frequent final items · all end builds · correlation only');
    console.table(policy.finalItemAssociations.slice(0, 6).map(item => ({ item: item.id, runs: item.runsWith, runPct: item.runPct, winWithPct: item.winPctWith, winWithoutPct: item.winPctWithout, deltaPp: item.winDeltaPp, phi: item.phi })));
  }
}

try {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) console.log(usage());
  else {
    const code = readFileSync(options.engine, 'utf8'), context = {};
    runInNewContext(code, context, { filename: options.engine, timeout: 2000 });
    const C = context.AbendessenCore;
    if (!C?.createRun || !C?.updateBattle || !Array.isArray(C.COURSES)) throw new Error('Engine does not expose AbendessenCore with the expected API.');
    const players = makeTestPlayers(C), runs = [];
    const policies = POLICY_NAMES.map(policy => {
      const observations = Array.from({ length: options.seeds }, (_, index) => simulate(C, players, `${options.prefix}-${index}`, policy));
      runs.push(...observations);
      return summarize(C, policy, observations);
    });
    const result = {
      benchmarkVersion: 2,
      engine: { path: options.engine, version: C.VERSION, sha256: createHash('sha256').update(code).digest('hex') },
      config: { seeds: options.seeds, prefix: options.prefix, seedPattern: '${prefix}-${index}', policies: POLICY_NAMES, stepSeconds: STEP_SECONDS, maxBattleSteps: MAX_BATTLE_STEPS },
      heuristics: { provenance: 'Fixed benchmark-version-1 policies, held stable for before/after comparisons.', weights: WEIGHTS, itemLevelPowerFactor: 0.5, itemLevelCooldownFactor: 0.08, zeroPowerGuard: 'Power=0 uses 1 + 0.5*(level-1), including Ritalin.', tacticSelection: 'Engine defaults; test players do not choose tactics.', encounterSelection: 'First affordable answer in displayed order, before shopping (benchmark version 2).', descriptions: { idle: 'No shop actions or rearrangement.', blind: 'Buys affordable offers in offer order, optionally upgrades when five slots are occupied, sells reserves.', smart: 'Fixed weighted roster ROI, optional heal below 40 HP, up to 18 decisions, at most 2 rerolls, then local adjacency optimization.' } },
      notes: ['Observational measurement only; no automatic win-rate thresholds.', 'All policies and engine versions use the same explicit seed list when prefix/count match.', 'HP before a course is conditional on reaching it and includes any shop healing.', 'Final item associations concern equipped end builds, not reserves. Selection/survival confound these correlations; they do not establish causation.', 'Boss item associations are additionally restricted to runs entering the final course.', 'Absent comparison groups or constant win outcomes produce null correlations, not zero.'],
      policies, runs,
    };
    printResults(result);
    if (options.json) { writeFileSync(options.json, `${JSON.stringify(result, null, 2)}\n`); console.log(`\nJSON: ${options.json}`); }
  }
} catch (error) {
  console.error(`Benchmark failed: ${error.message}\n${usage()}`);
  process.exitCode = 1;
}
