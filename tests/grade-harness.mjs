#!/usr/bin/env node
/*
 * Grader harness for grade-picks.js. Run it from the repo root:
 *   node tests/grade-harness.mjs                  # synthetic cases, plus books-2026-09-25.csv against live MLB box scores
 *   node tests/grade-harness.mjs --offline        # synthetic cases only
 *   node tests/grade-harness.mjs --json out.json  # also write the 9/25 actuals (with MLB IDs) for cross-checks
 * Exits non-zero if a synthetic case fails.
 */
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const G = require('../grade-picks.js');

const args = process.argv.slice(2);
const offline = args.includes('--offline');
const jsonOut = args.includes('--json') ? args[args.indexOf('--json') + 1] : null;

// ---- Synthetic fixtures -------------------------------------------------
const bat = (o = {}) => Object.assign({ plateAppearances: 4, hits: 0, doubles: 0, triples: 0, homeRuns: 0, totalBases: 0, runs: 0, rbi: 0, baseOnBalls: 0, strikeOuts: 0, stolenBases: 0, hitByPitch: 0 }, o);
const pit = (o = {}) => Object.assign({ inningsPitched: '6.0', outs: 18, battersFaced: 24, strikeOuts: 6, hits: 5, earnedRuns: 2, baseOnBalls: 1, homeRuns: 0, numberOfPitches: 95, wins: 0 }, o);
function game({ pk, start, num = 1, status = 'Final', away, home }) {
  const side = t => ({
    team: { name: t.name, abbreviation: t.abbr },
    pitchers: t.pitchers || [],
    batters: Object.keys(t.players).map(Number),
    players: Object.fromEntries(Object.entries(t.players).map(([id, p]) => ['ID' + id, { person: { id: +id, fullName: p.name }, stats: { batting: p.bat || {}, pitching: p.pit || {} } }]))
  });
  return G.buildGame({ gamePk: pk, gameDate: start, gameNumber: num, status: { detailedState: status } }, { teams: { away: side(away), home: side(home) } });
}
const LAD = { name: 'Los Angeles Dodgers', abbr: 'LAD' }, SD = { name: 'San Diego Padres', abbr: 'SD' };
const ATL = { name: 'Atlanta Braves', abbr: 'ATL' }, PHI = { name: 'Philadelphia Phillies', abbr: 'PHI' };

const g1 = game({ pk: 1, start: '2026-09-25T23:10:00Z', away: { ...LAD, pitchers: [10, 11], players: {
  1: { name: 'Mookie Betts', bat: bat({ baseOnBalls: 1, strikeOuts: 2, hits: 1, runs: 1, rbi: 0, totalBases: 1 }) },
  2: { name: 'Will Smith', bat: bat({ hits: 2, doubles: 1, triples: 0, homeRuns: 1, totalBases: 7, runs: 2, rbi: 3, stolenBases: 1, baseOnBalls: 1 }) },
  3: { name: 'Bench Guy', bat: bat({ plateAppearances: 0 }) },
  10: { name: 'Tyler Glasnow', pit: pit({ strikeOuts: 8 }) },
  11: { name: 'Evan Phillips', pit: pit({ inningsPitched: '1.0', outs: 3, strikeOuts: 2 }) },
  12: { name: 'Unused Arm', pit: {} } } },
  home: { ...SD, pitchers: [20], players: { 20: { name: 'Nick Pivetta', pit: pit({ strikeOuts: 5 }) }, 21: { name: 'Manny Machado', bat: bat({ hits: 2, runs: 0, rbi: 0 }) } } } });
const g2 = game({ pk: 2, start: '2026-09-25T23:20:00Z', away: { ...ATL, pitchers: [30], players: {
  31: { name: 'Will Smith', bat: bat({ hits: 0 }) } } },
  home: { ...PHI, pitchers: [40, 41], players: {
  40: { name: 'Cristopher Sánchez', pit: pit({ strikeOuts: 10 }) },
  41: { name: 'José Alvarado', pit: pit({ inningsPitched: '0.1', outs: 1, strikeOuts: 0, hits: 2 }) } } } });
// Doubleheader: player 50 plays both games.
const dh1 = game({ pk: 101, start: '2026-09-25T17:05:00Z', num: 1, away: { name: 'Chicago White Sox', abbr: 'CWS', pitchers: [], players: { 50: { name: 'Andrew Benintendi', bat: bat({ hits: 0 }) } } }, home: { name: 'Kansas City Royals', abbr: 'KC', pitchers: [], players: {} } });
const dh2 = game({ pk: 102, start: '2026-09-25T23:05:00Z', num: 2, away: { name: 'Chicago White Sox', abbr: 'CWS', pitchers: [], players: { 50: { name: 'Andrew Benintendi', bat: bat({ hits: 2 }) } } }, home: { name: 'Kansas City Royals', abbr: 'KC', pitchers: [], players: {} } });
// Live game, top of the 6th: Skubal still pitching for DET; for CLE, Williams has been pulled.
const live = game({ pk: 200, start: '2026-09-25T22:40:00Z', status: 'In Progress', away: { name: 'Detroit Tigers', abbr: 'DET', pitchers: [60], players: {
  60: { name: 'Tarik Skubal', pit: pit({ inningsPitched: '5.0', outs: 15, strikeOuts: 9 }) }, 61: { name: 'Riley Greene', bat: bat({ plateAppearances: 3, hits: 2 }) } } },
  home: { name: 'Cleveland Guardians', abbr: 'CLE', pitchers: [70, 71], players: {
  70: { name: 'Gavin Williams', pit: pit({ inningsPitched: '3.1', outs: 10, strikeOuts: 4, baseOnBalls: 4 }) }, 71: { name: 'Cade Smith', pit: pit({ inningsPitched: '0.2', outs: 2 }) } } } });
const ppd = game({ pk: 300, start: '2026-09-25T23:05:00Z', status: 'Postponed', away: { name: 'New York Mets', abbr: 'NYM', pitchers: [], players: {} }, home: { name: 'Miami Marlins', abbr: 'MIA', pitchers: [], players: {} } });
const cxl = game({ pk: 301, start: '2026-09-25T23:05:00Z', status: 'Cancelled', away: { name: 'Boston Red Sox', abbr: 'BOS', pitchers: [], players: { 80: { name: 'Jarren Duran', bat: {} } } }, home: { name: 'Toronto Blue Jays', abbr: 'TOR', pitchers: [], players: {} } });

const games = [g1, g2, dh1, dh2, live, ppd, cxl];
const T = s => Date.parse(s);
const cases = [
  ['batter walks over 0.5 (label "Walks")', { name: 'Mookie Betts', kind: 'B', market: 'BB', mlabel: 'Walks', line: 0.5, side: 'over' }, 'win', 1],
  ['batter strikeouts under 1.5 (label "Strikeouts")', { name: 'Mookie Betts', kind: 'B', market: 'K', mlabel: 'Strikeouts', line: 1.5, side: 'under' }, 'loss', 2],
  ['H+R+RBI over 1.5', { name: 'Mookie Betts', kind: 'B', market: 'HRR', mlabel: 'Hits + runs + RBIs', line: 1.5, side: 'over' }, 'win', 2],
  ['H+R+RBI by label only (PrizePicks wording)', { name: 'Mookie Betts', mlabel: 'Hits+Runs+RBIs', line: 2.5, side: 'under' }, 'win', 2],
  ['singles over 0.5 (0 singles)', { name: 'Will Smith', mlbId: 2, kind: 'B', market: 'S1', mlabel: 'Singles', line: 0.5, side: 'over' }, 'loss', 0],
  ['doubles over 0.5', { name: 'Will Smith', mlbId: 2, kind: 'B', market: 'S2', mlabel: 'Doubles', line: 0.5, side: 'over' }, 'win', 1],
  ['triples under 0.5', { name: 'Will Smith', mlbId: 2, kind: 'B', market: 'S3', mlabel: 'Triples', line: 0.5, side: 'under' }, 'win', 0],
  ['stolen bases by label', { name: 'Will Smith', mlbId: 2, mlabel: 'Stolen Bases', line: 0.5, side: 'over' }, 'win', 1],
  ['hitter fantasy score (PrizePicks)', { name: 'Will Smith', mlbId: 2, mlabel: 'Hitter Fantasy Score', line: 30.5, side: 'over' }, 'win', 3 * 0 + 5 + 10 + 2 * (2 + 3 + 1 + 0) + 5],
  ['total bases push on whole line', { name: 'Will Smith', mlbId: 2, mlabel: 'Total Bases', line: 7, side: 'over' }, 'push', 7],
  ['pitcher strikeouts by code', { name: 'Tyler Glasnow', kind: 'P', market: 'PK', mlabel: 'Strikeouts', line: 7.5, side: 'over' }, 'win', 8],
  ['pitcher strikeouts by book label', { name: 'Tyler Glasnow', mlabel: 'Strikeouts thrown', line: 7.5, side: 'under' }, 'loss', 8],
  ['pitcher outs', { name: 'Nick Pivetta', mlabel: 'Pitcher Outs', line: 17.5, side: 'over' }, 'win', 18],
  ['earned runs allowed', { name: 'Nick Pivetta', mlabel: 'Earned Runs Allowed', line: 2.5, side: 'under' }, 'win', 2],
  ['hits allowed', { name: 'Nick Pivetta', mlabel: 'Hits Allowed', line: 4.5, side: 'over' }, 'win', 5],
  ['walks allowed', { name: 'Nick Pivetta', mlabel: 'Walks Allowed', line: 1.5, side: 'under' }, 'win', 1],
  ['accent-insensitive pitcher (Sanchez)', { name: 'Cristopher Sanchez', mlabel: 'Strikeouts thrown', line: 5.5, side: 'over' }, 'win', 10],
  ['accent-insensitive reliever (Jose Alvarado)', { name: 'Jose Alvarado', mlabel: 'Hits Allowed', line: 0.5, side: 'over' }, 'win', 2],
  ['ambiguous name with no team stays open', { name: 'Will Smith', mlabel: 'Hits', line: 0.5, side: 'over' }, 'ungraded'],
  ['ambiguous name with team picks the right player', { name: 'Will Smith', team: 'Atlanta Braves', mlabel: 'Hits', line: 0.5, side: 'over' }, 'loss', 0],
  ['last name alone no longer matches', { name: 'Smith', mlabel: 'Hits', line: 0.5, side: 'over' }, 'ungraded'],
  ['doubleheader by gamePk (game 2)', { name: 'Andrew Benintendi', gamePk: 102, mlabel: 'Hits', line: 0.5, side: 'over' }, 'win', 2],
  ['doubleheader logged between games -> game 2', { name: 'Andrew Benintendi', t: T('2026-09-25T20:00:00Z'), mlabel: 'Hits', line: 0.5, side: 'over' }, 'win', 2],
  ['doubleheader logged before game 1 -> game 1', { name: 'Andrew Benintendi', t: T('2026-09-25T15:00:00Z'), mlabel: 'Hits', line: 0.5, side: 'over' }, 'loss', 0],
  ['mid-game: starter still pitching stays pending', { name: 'Tarik Skubal', mlabel: 'Strikeouts thrown', line: 7.5, side: 'under' }, 'pending'],
  ['mid-game: starter pulled settles', { name: 'Gavin Williams', mlabel: 'Walks Allowed', line: 1.5, side: 'over' }, 'win', 4],
  ['mid-game: batter prop waits for final', { name: 'Riley Greene', mlabel: 'Hits', line: 1.5, side: 'over' }, 'pending'],
  ['postponed game stays pending', { name: 'Francisco Lindor', team: 'New York Mets', mlabel: 'Hits', line: 0.5, side: 'over' }, 'pending'],
  ['cancelled game is void', { name: 'Jarren Duran', mlabel: 'Hits', line: 0.5, side: 'over' }, 'void'],
  ['batter with 0 PA is void', { name: 'Bench Guy', mlabel: 'Hits', line: 0.5, side: 'over' }, 'void'],
  ['pitcher who did not pitch is void', { name: 'Unused Arm', mlabel: 'Strikeouts thrown', line: 3.5, side: 'over' }, 'void'],
  ['team played, player absent -> void', { name: 'Fernando Tatis Jr.', team: 'San Diego Padres', mlabel: 'Hits', line: 0.5, side: 'over' }, 'void'],
  ['unknown market is ungraded, not a loss', { name: 'Tyler Glasnow', mlabel: 'Pickoffs', line: 0.5, side: 'over' }, 'ungraded']
];
let fail = 0;
console.log('Synthetic cases');
for (const [label, pick, want, wantActual] of cases) {
  const r = G.gradePick(Object.assign({ date: '2026-09-25' }, pick), games, {});
  const got = r.status === 'graded' ? r.result : r.status;
  const ok = got === want && (wantActual == null || r.actual === wantActual);
  if (!ok) fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}: ${got}${r.actual != null ? ' (actual ' + r.actual + ')' : ''}${r.status !== 'graded' ? ' - ' + r.reason : ''}`);
}
console.log(`  ${cases.length - fail}/${cases.length} passed`);

// ---- Real slip: books-2026-09-25.csv against official box scores -----
if (!offline) {
  const csv = readFileSync(new URL('../books-2026-09-25.csv', import.meta.url), 'utf8').trim().split(/\r?\n/);
  const head = csv.shift().split(',');
  const rows = csv.map(l => Object.fromEntries(l.split(',').map((v, i) => [head[i], v])));
  const real = await G.loadGames('2026-09-25');
  console.log(`\nbooks-2026-09-25.csv vs MLB box scores (${real.length} games)`);
  const out = []; const tally = {};
  for (const r of rows) {
    const pick = { date: '2026-09-25', name: r.Player, mlabel: r.Market, line: +r.Line, side: r.Side, odds: r.Odds };
    const g = G.gradePick(pick, real, {});
    const key = g.status === 'graded' ? g.result : g.status;
    tally[key] = (tally[key] || 0) + 1;
    const hit = G.findPlayer(real, { name: G.norm(r.Player) })[0];
    out.push({ player: r.Player, market: r.Market, line: +r.Line, side: r.Side, odds: r.Odds, book: r.Book, oneSided: !r.OppOdds, mlbId: hit ? hit.row.id : null, gamePk: g.gamePk, status: g.status, result: g.result || null, actual: g.actual == null ? null : g.actual, reason: g.reason });
    console.log(`  ${(r.Player + ' ' + r.Side + ' ' + r.Line + ' ' + r.Market).padEnd(46)} ${String(r.Odds).padStart(5)}  ${key}${g.actual != null ? ' (' + g.actual + ')' : ''}`);
  }
  const slip = out.filter(o => o.oneSided && o.result);
  const units = slip.reduce((a, o) => { const n = +o.odds; return a + (o.result === 'win' ? (n > 0 ? n / 100 : 100 / -n) : o.result === 'loss' ? -1 : 0); }, 0);
  console.log('  totals:', JSON.stringify(tally));
  console.log(`  one-sided rows (the slip): ${slip.filter(o => o.result === 'win').length}-${slip.filter(o => o.result === 'loss').length}, ${units >= 0 ? '+' : ''}${units.toFixed(2)}u flat`);
  if (jsonOut) { writeFileSync(jsonOut, JSON.stringify(out, null, 1)); console.log('  wrote', jsonOut); }
}
process.exit(fail ? 1 : 0);
