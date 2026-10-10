/* Record: grade open bets from official MLB box scores.
 *
 * Rules
 * - Batter props settle only when the game is Final. Pitcher props settle when the
 *   game is Final or a later pitcher on the same team has already appeared.
 * - Postponed or suspended games stay open (pending). Cancelled games are void.
 * - A player who is in the box score but did not bat (batter prop) or did not pitch
 *   (pitcher prop) is void, as is a player whose team played without him.
 * - Void settles as Push (stake returned) and keeps the reason on the bet.
 * - A market the grader does not know stays open and is flagged as ungraded. It is
 *   never scored as a loss.
 * - Players match by MLB ID first, then by full name (accent-insensitive). When a
 *   name matches more than one player, the team has to match too. There is no
 *   last-name-only match.
 * - Doubleheaders use the bet's game ID when it is known. Otherwise they use the
 *   first game that started after the bet was logged (or the last game of the day
 *   if every game had already started).
 * - A whole-number line that the stat lands on exactly is a push.
 */
(function (root) {
  'use strict';

  function norm(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[.']/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ')
      .replace(/ (jr|sr|ii|iii|iv)$/, '').trim();
  }
  const n0 = v => (v == null || v === '' || !isFinite(+v)) ? 0 : +v;
  function outsFromIP(ip) {
    const s = String(ip == null ? '0' : ip);
    const w = parseInt(s, 10) || 0;
    const f = parseInt(s.split('.')[1] || '0', 10) || 0;
    return w * 3 + f;
  }

  // ---- Markets ------------------------------------------------------------
  // b = batting line, p = pitching line from the MLB boxscore.
  const BAT = {
    H: b => n0(b.hits),
    TB: b => n0(b.totalBases),
    HR: b => n0(b.homeRuns),
    S1: b => n0(b.hits) - n0(b.doubles) - n0(b.triples) - n0(b.homeRuns),
    S2: b => n0(b.doubles),
    S3: b => n0(b.triples),
    BB: b => n0(b.baseOnBalls),
    R: b => n0(b.runs),
    RBI: b => n0(b.rbi),
    HRR: b => n0(b.hits) + n0(b.runs) + n0(b.rbi),
    K: b => n0(b.strikeOuts),
    SB: b => n0(b.stolenBases),
    // PrizePicks hitter fantasy score: 1B 3, 2B 5, 3B 8, HR 10, R 2, RBI 2, BB 2, HBP 2, SB 5.
    HFS: b => {
      const s1 = n0(b.hits) - n0(b.doubles) - n0(b.triples) - n0(b.homeRuns);
      return 3 * s1 + 5 * n0(b.doubles) + 8 * n0(b.triples) + 10 * n0(b.homeRuns) +
        2 * (n0(b.runs) + n0(b.rbi) + n0(b.baseOnBalls) + n0(b.hitByPitch)) + 5 * n0(b.stolenBases);
    }
  };
  const PIT = {
    PK: p => n0(p.strikeOuts),
    PH: p => n0(p.hits),
    PER: p => n0(p.earnedRuns),
    PBB: p => n0(p.baseOnBalls),
    POUT: p => (p.outs != null ? n0(p.outs) : outsFromIP(p.inningsPitched)),
    PHR: p => n0(p.homeRuns),
    PPC: p => n0(p.numberOfPitches != null ? p.numberOfPitches : p.pitchesThrown),
    // PrizePicks pitcher fantasy score: W 6, QS 4, ER -3, K 3, out 1.
    PFS: p => {
      const outs = p.outs != null ? n0(p.outs) : outsFromIP(p.inningsPitched);
      const qs = outs >= 18 && n0(p.earnedRuns) <= 3 ? 1 : 0;
      return 6 * n0(p.wins) + 4 * qs - 3 * n0(p.earnedRuns) + 3 * n0(p.strikeOuts) + outs;
    }
  };
  // Label fallbacks, checked in order. Pitcher-only wording comes first.
  const PIT_LABELS = [
    [/hits allowed|pitcher hits/, 'PH'],
    [/earned runs?/, 'PER'],
    [/walks allowed|pitcher walks|bb allowed/, 'PBB'],
    [/strikeouts thrown|pitcher strikeouts|pitcher ks?\b/, 'PK'],
    [/outs recorded|pitching outs|pitcher outs|^outs$/, 'POUT'],
    [/home runs allowed|hr allowed/, 'PHR'],
    [/pitches thrown|pitch count|^pitches$/, 'PPC'],
    [/pitcher fantasy/, 'PFS']
  ];
  const BAT_LABELS = [
    [/hits runs rbis?|^h r rbis?$|^hrr$/, 'HRR'],
    [/hitter fantasy|fantasy score/, 'HFS'],
    [/total bases|^tb$/, 'TB'],
    [/stolen bases?|^sb$/, 'SB'],
    [/home runs?|^hr$|homers?/, 'HR'],
    [/singles?/, 'S1'],
    [/doubles?/, 'S2'],
    [/triples?/, 'S3'],
    [/hitter strikeouts|batter strikeouts|^strikeouts?$|^ks?$/, 'K'],
    [/^walks?$|batter walks|hitter walks|^bb$/, 'BB'],
    [/^rbis?$/, 'RBI'],
    [/^runs?( scored)?$/, 'R'],
    [/^hits?$|to get a hit|total hits/, 'H']
  ];
  const PIT_ALIAS = { K: 'PK', BB: 'PBB', H: 'PH', HR: 'PHR', ER: 'PER', OUTS: 'POUT' };

  /** Returns { kind: 'B' | 'P', code } or null when the market is unknown. */
  function marketOf(pick) {
    const code = String(pick.market || '').toUpperCase();
    const lab = norm(pick.mlabel || pick.marketLabel || ''); // '+' and punctuation become spaces
    let kind = pick.kind === 'P' || pick.kind === 'B' ? pick.kind : null;
    if (!kind) {
      if (PIT[code] || PIT_LABELS.some(([re]) => re.test(lab)) || /pitcher|allowed|thrown/.test(lab)) kind = 'P';
      else kind = 'B';
    }
    if (kind === 'P') {
      if (PIT[code]) return { kind, code };
      if (PIT_ALIAS[code]) return { kind, code: PIT_ALIAS[code] };
      for (const [re, c] of PIT_LABELS) if (re.test(lab)) return { kind, code: c };
      if (/^strikeouts?$|^ks?$/.test(lab)) return { kind, code: 'PK' };
      if (/^walks?$/.test(lab)) return { kind, code: 'PBB' };
      if (/^hits?$/.test(lab)) return { kind, code: 'PH' };
      return null;
    }
    if (BAT[code]) return { kind, code };
    for (const [re, c] of BAT_LABELS) if (re.test(lab)) return { kind, code: c };
    return null;
  }

  // ---- Games and players --------------------------------------------------
  const DONE_RE = /^(final|game over|completed early)/i;
  function gameState(detailed, abstract) {
    const d = String(detailed || '');
    if (/postponed/i.test(d)) return 'postponed';
    if (/suspended/i.test(d)) return 'suspended';
    if (/cancel/i.test(d)) return 'cancelled';
    if (DONE_RE.test(d)) return 'final';
    if (/^final$/i.test(String(abstract || '')) && !d) return 'final';
    if (/in progress|manager challenge|review|delayed|warmup/i.test(d) || /^live$/i.test(String(abstract || ''))) return 'live';
    return 'pre';
  }

  /** Flattens schedule games plus boxscores into the grader's game shape. */
  function buildGame(schedGame, box) {
    const st = schedGame.status || {};
    const g = {
      gamePk: schedGame.gamePk,
      start: schedGame.gameDate ? Date.parse(schedGame.gameDate) : null,
      gameNumber: schedGame.gameNumber || 1,
      state: gameState(st.detailedState, st.abstractGameState),
      status: st.detailedState || '',
      teams: {}
    };
    for (const side of ['away', 'home']) {
      const t = ((box || {}).teams || {})[side] || {};
      const team = t.team || ((schedGame.teams || {})[side] || {}).team || {};
      const players = {};
      Object.keys(t.players || {}).forEach(k => {
        const pl = t.players[k];
        const id = (pl.person || {}).id;
        if (!id) return;
        players[id] = {
          id, name: (pl.person || {}).fullName || '',
          bat: ((pl.stats || {}).batting) || {},
          pit: ((pl.stats || {}).pitching) || {}
        };
      });
      g.teams[side] = {
        names: [team.name, team.abbreviation, team.teamName, team.clubName, team.shortName, team.locationName]
          .filter(Boolean).map(norm),
        pitchers: (t.pitchers || []).slice(),
        batters: (t.batters || []).slice(),
        players
      };
    }
    return g;
  }

  function teamMatches(teamNames, want) {
    const w = norm(want);
    if (!w) return false;
    return teamNames.some(n => n && (n === w || n.indexOf(w) >= 0 || w.indexOf(n) >= 0));
  }

  /** All appearances of a player on the date: [{ game, side, row }]. */
  function findPlayer(games, ident) {
    const hits = [];
    for (const g of games) {
      for (const side of ['away', 'home']) {
        const t = g.teams[side];
        if (ident.id && t.players[ident.id]) { hits.push({ game: g, side, row: t.players[ident.id] }); continue; }
        if (!ident.id && ident.name) {
          for (const id of Object.keys(t.players)) {
            if (norm(t.players[id].name) === ident.name) hits.push({ game: g, side, row: t.players[id] });
          }
        }
      }
    }
    return hits;
  }

  /** Resolves who the bet is on: MLB ID, else normalized name plus team. */
  function identify(pick, players) {
    const all = Object.values(players || {});
    let rec = pick.pid && players && players[pick.pid] ? players[pick.pid] : null;
    if (!rec && !pick.mlbId) {
      const same = all.filter(p => norm(p.name) === norm(pick.name));
      const ids = Array.from(new Set(same.map(p => p.mlbId).filter(Boolean)));
      if (ids.length === 1) rec = same.find(p => p.mlbId === ids[0]);
      else if (ids.length > 1 && pick.team) rec = same.find(p => p.mlbId && teamMatches([norm(p.team)], pick.team)) || null;
    }
    return {
      id: +(pick.mlbId || (rec && rec.mlbId) || 0) || null,
      name: norm(pick.name),
      team: pick.team || (rec && rec.team) || ''
    };
  }

  function pickGame(hits, pick) {
    if (hits.length <= 1) return hits[0] || null;
    if (pick.gamePk) {
      const h = hits.find(x => String(x.game.gamePk) === String(pick.gamePk));
      if (h) return h;
    }
    const sorted = hits.slice().sort((a, b) => (a.game.start || 0) - (b.game.start || 0) || a.game.gameNumber - b.game.gameNumber);
    const t = +pick.t || 0;
    if (t) {
      const next = sorted.find(x => x.game.start && x.game.start >= t);
      return next || sorted[sorted.length - 1];
    }
    return sorted[0];
  }

  function decide(side, line, actual) {
    line = +line;
    if (!isFinite(line) || actual == null || !isFinite(actual)) return null;
    if (Number.isInteger(line) && actual === line) return 'push';
    const over = actual > line;
    side = String(side || 'over').toLowerCase();
    if (side === 'over') return over ? 'win' : 'loss';
    if (side === 'under') return over ? 'loss' : 'win';
    return null;
  }

  /**
   * Grades one pick against the games of its date.
   * Returns { status: 'graded' | 'void' | 'pending' | 'ungraded', result?, actual?, gamePk?, reason }.
   */
  function gradePick(pick, games, players) {
    const mk = marketOf(pick);
    if (!mk) return { status: 'ungraded', reason: 'unknown market: ' + (pick.mlabel || pick.market || '?') };
    const ident = identify(pick, players);
    let hits = findPlayer(games, ident);
    if (!ident.id && hits.length) {
      const ids = Array.from(new Set(hits.map(h => h.row.id)));
      if (ids.length > 1) {
        hits = ident.team ? hits.filter(h => teamMatches(h.game.teams[h.side].names, ident.team)) : [];
        if (Array.from(new Set(hits.map(h => h.row.id))).length !== 1) {
          return { status: 'ungraded', reason: 'name matches more than one player; team needed' };
        }
      }
    }
    if (!hits.length) {
      if (ident.team) {
        const tg = games.filter(g => ['away', 'home'].some(s => teamMatches(g.teams[s].names, ident.team)));
        if (tg.length && tg.every(g => g.state === 'final')) return { status: 'void', reason: 'not in box score (scratched or inactive)', gamePk: tg[0].gamePk };
        if (tg.some(g => g.state === 'postponed' || g.state === 'suspended')) return { status: 'pending', reason: 'game ' + tg[0].status.toLowerCase() };
        if (tg.length) return { status: 'pending', reason: 'game not final' };
      }
      return { status: 'ungraded', reason: 'player not found on ' + (pick.date || 'that date') };
    }
    const hit = pickGame(hits, pick);
    const g = hit.game, team = g.teams[hit.side], row = hit.row;
    if (g.state === 'cancelled') return { status: 'void', reason: 'game cancelled', gamePk: g.gamePk };
    if (g.state === 'postponed' || g.state === 'suspended') return { status: 'pending', reason: 'game ' + g.status.toLowerCase(), gamePk: g.gamePk };

    if (mk.kind === 'P') {
      const idx = team.pitchers.indexOf(row.id);
      const pitched = idx >= 0 || n0(row.pit.battersFaced) > 0 || outsFromIP(row.pit.inningsPitched) > 0;
      if (!pitched) {
        if (g.state === 'final') return { status: 'void', reason: 'did not pitch', gamePk: g.gamePk };
        return { status: 'pending', reason: 'has not pitched yet', gamePk: g.gamePk };
      }
      const exited = idx >= 0 && idx < team.pitchers.length - 1;
      const actual = PIT[mk.code](row.pit);
      if (g.state !== 'final' && !exited) return { status: 'pending', reason: 'still pitching', live: actual, gamePk: g.gamePk };
      const result = decide(pick.side, pick.line, actual);
      if (!result) return { status: 'ungraded', reason: 'bad line or side', gamePk: g.gamePk };
      return { status: 'graded', result, actual, gamePk: g.gamePk, reason: g.state === 'final' ? 'final' : 'pitcher exited' };
    }

    const actual = BAT[mk.code](row.bat);
    if (g.state !== 'final') return { status: 'pending', reason: 'game not final', live: actual, gamePk: g.gamePk };
    if (!n0(row.bat.plateAppearances)) return { status: 'void', reason: 'no plate appearance', gamePk: g.gamePk };
    const result = decide(pick.side, pick.line, actual);
    if (!result) return { status: 'ungraded', reason: 'bad line or side', gamePk: g.gamePk };
    return { status: 'graded', result, actual, gamePk: g.gamePk, reason: 'final' };
  }

  // ---- MLB feed -----------------------------------------------------------
  const API = 'https://statsapi.mlb.com/api/v1';
  async function loadGames(date, fetchFn) {
    const f = fetchFn || fetch;
    const sch = await f(API + '/schedule?sportId=1&date=' + date).then(r => r.json());
    const sg = [];
    (sch.dates || []).forEach(d => (d.games || []).forEach(g => sg.push(g)));
    return Promise.all(sg.map(async g => {
      let box = null;
      const st = gameState((g.status || {}).detailedState, (g.status || {}).abstractGameState);
      if (st !== 'pre' && st !== 'postponed' && st !== 'cancelled') {
        try { box = await f(API + '/game/' + g.gamePk + '/boxscore').then(r => r.json()); } catch (e) { box = null; }
      }
      return buildGame(g, box);
    }));
  }

  const core = { norm, marketOf, gameState, buildGame, identify, findPlayer, pickGame, decide, gradePick, loadGames, BAT, PIT };
  if (typeof module !== 'undefined' && module.exports) module.exports = core;
  root.LLGrade = core;

  // ---- Desk hookup (browser only) ----------------------------------------
  if (typeof ACT === 'undefined' || typeof S === 'undefined') return;

  // Stamp new bets with the MLB ID, team and game so grading never has to guess.
  if (ACT.takePick && !ACT.takePick._stamp) {
    const _take = ACT.takePick;
    ACT.takePick = function (d) {
      const before = new Set(Object.keys(S.picks || {}));
      const out = _take.apply(this, arguments);
      try {
        const sl = typeof slate === 'function' ? slate(DATE) : null;
        const pr = sl && (sl.props || []).find(p => p.id === d.id);
        const pl = pr && S.players[pr.player];
        Object.keys(S.picks || {}).filter(k => !before.has(k)).forEach(k => {
          const p = S.picks[k];
          if (pl) { p.pid = pl.id; if (pl.mlbId) p.mlbId = pl.mlbId; if (pl.team) p.team = pl.team; }
          const pk = pr && parseInt(String(pr.sideId || '').split('-')[0], 10);
          if (pk) p.gamePk = pk;
          persist('picks', k);
        });
      } catch (e) { /* stamping is best effort */ }
      return out;
    };
    ACT.takePick._stamp = true;
  }

  ACT.gradePicks = async function () {
    const open = Object.values(S.picks || {}).filter(p => !p.result);
    if (!open.length) { toast('No open bets to grade.'); return; }
    toast('Pulling box scores...');
    const dates = Array.from(new Set(open.map(p => p.date || DATE)));
    const byDate = {};
    for (const d of dates) {
      try { byDate[d] = await loadGames(d); } catch (e) { byDate[d] = null; }
    }
    const tally = { graded: 0, void: 0, pending: 0, ungraded: 0 };
    open.forEach(p => {
      const games = byDate[p.date || DATE];
      const r = games ? gradePick(p, games, S.players) : { status: 'pending', reason: 'MLB feed unavailable' };
      tally[r.status]++;
      if (r.gamePk) p.gamePk = r.gamePk;
      if (r.status === 'graded') {
        p.result = r.result; p.actual = r.actual; delete p.gradeNote; delete p.live;
      } else if (r.status === 'void') {
        p.result = 'push'; p.voidReason = r.reason; p.gradeNote = 'Void: ' + r.reason; delete p.live;
      } else {
        p.gradeNote = (r.status === 'ungraded' ? 'Ungraded: ' : 'Pending: ') + r.reason;
        if (r.live != null) p.live = r.live;
      }
      persist('picks', p.id);
    });
    render();
    const parts = [];
    if (tally.graded) parts.push('graded ' + tally.graded);
    if (tally.void) parts.push(tally.void + ' void');
    if (tally.pending) parts.push(tally.pending + ' pending');
    if (tally.ungraded) parts.push(tally.ungraded + ' need a manual check');
    toast(parts.length ? parts.join(', ').replace(/^./, c => c.toUpperCase()) + '.' : 'Nothing to grade yet.');
  };

  const _vRecord = typeof vRecord === 'function' ? vRecord : null;
  if (_vRecord && !vRecord._grade) {
    vRecord = function () {
      let h = _vRecord();
      const notes = Object.values(S.picks || {}).filter(p => p.gradeNote)
        .map(p => '<li><b>' + esc(p.name) + '</b> ' + esc(p.side + ' ' + p.line + ' ' + (p.mlabel || p.market || '')) + ': ' + esc(p.gradeNote) + '</li>').join('');
      const btn = '<div class="flex" style="margin:8px 0 12px"><button class="primary" data-act="gradePicks">Grade finished games</button></div>' +
        (notes ? '<div class="card" data-grade-notes><div class="sub">Grader notes</div><ul class="sub" style="margin:6px 0 0 18px">' + notes + '</ul></div>' : '');
      h = h.replace('<h2>Bets</h2>', btn + '<h2>Bets</h2>');
      return h;
    };
    vRecord._grade = true;
  }
})(typeof window !== 'undefined' ? window : globalThis);
