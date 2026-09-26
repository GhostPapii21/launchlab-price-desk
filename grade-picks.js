/* Record: grade open bets from MLB box scores. */
(function () {
  function norm(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/\./g, '').replace(/'/g, '').replace(/\s+/g, ' ').trim();
  }
  function last(s) { const p = norm(s).split(' '); return p[p.length - 1] || ''; }
  function actualFor(pick, line) {
    const m = pick.market || '';
    const lab = String(pick.mlabel || '').toLowerCase();
    if (m === 'PK' || lab === 'strikeouts') return +line.SO;
    if (m === 'PH' || lab.indexOf('hits allowed') >= 0) return +line.H;
    if (m === 'PER' || lab.indexOf('earned') >= 0) return +line.ER;
    if (m === 'PBB' || lab.indexOf('walk') >= 0) return +line.BB;
    if (m === 'POUT' || lab.indexOf('out') >= 0) {
      const ip = String(line.IP || '0');
      const w = parseInt(ip, 10) || 0;
      const f = parseInt((ip.split('.')[1] || '0'), 10) || 0;
      return w * 3 + f;
    }
    if (m === 'H' || lab === 'hits') return +line.bH;
    if (m === 'HR') return +line.bHR;
    if (m === 'R') return +line.bR;
    if (m === 'RBI') return +line.bRBI;
    if (m === 'BB') return +line.bBB;
    if (m === 'K') return +line.bSO;
    if (m === 'TB') return +line.bTB;
    return null;
  }
  function decide(pick, actual) {
    if (actual == null || !isFinite(actual)) return null;
    const line = +pick.line;
    const side = String(pick.side || 'over').toLowerCase();
    if (Number.isInteger(line) && actual === line) return 'push';
    const over = actual > line;
    if (side === 'over') return over ? 'win' : 'loss';
    if (side === 'under') return over ? 'loss' : 'win';
    return null;
  }
  function pitcherDone(game, pl) {
    const st = game.status || '';
    if (/final|game over|completed/i.test(st)) return true;
    if (/warmup|pre-game|scheduled|preview/i.test(st)) return false;
    const ip = parseFloat(String(pl.IP || '0')) || 0;
    if (ip <= 0) return false;
    const inn = +game.inning || 0;
    if (inn && ip + 0.8 < inn) return true;
    if (game.relieversAfter && game.relieversAfter[pl.team]) return true;
    return false;
  }

  async function loadLines(date) {
    const sch = await fetch('https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=' + date).then(r => r.json());
    const games = ((sch.dates || [])[0] || {}).games || [];
    const out = [];
    for (const g of games) {
      const gid = g.gamePk;
      const status = (g.status || {}).detailedState || '';
      let live = {};
      try {
        live = await fetch('https://statsapi.mlb.com/api/v1.1/game/' + gid + '/feed/live').then(r => r.json());
      } catch (e) { continue; }
      const ls = (live.liveData || {}).linescore || {};
      const box = (live.liveData || {}).boxscore || {};
      const inn = ls.currentInning || 0;
      const game = { status, inning: inn, relieversAfter: {} };
      const teamPitchers = { away: [], home: [] };
      for (const side of ['away', 'home']) {
        const team = (box.teams || {})[side] || {};
        const ab = (team.team || {}).abbreviation || side;
        const players = team.players || {};
        for (const pid of Object.keys(players)) {
          const pl = players[pid];
          const name = ((pl.person || {}).fullName) || '';
          const pit = ((pl.stats || {}).pitching) || {};
          const hit = ((pl.stats || {}).batting) || {};
          const row = {
            name, team: ab, game: gid, status, inning: inn,
            IP: pit.inningsPitched || '',
            H: +(pit.hits || 0), SO: +(pit.strikeOuts || 0),
            ER: +(pit.earnedRuns || 0), BB: +(pit.baseOnBalls || 0),
            bH: +(hit.hits || 0), bHR: +(hit.homeRuns || 0),
            bR: +(hit.runs || 0), bRBI: +(hit.rbi || 0),
            bBB: +(hit.baseOnBalls || 0), bSO: +(hit.strikeOuts || 0),
            bTB: +(hit.totalBases || 0)
          };
          if (pit.inningsPitched || pit.strikeOuts || pit.hits) teamPitchers[side].push(row);
          out.push(row);
        }
        const withIP = teamPitchers[side].filter(p => parseFloat(p.IP || 0) > 0);
        if (withIP.length >= 2) game.relieversAfter[ab] = true;
      }
      out.forEach(r => { if (r.game === gid) { r._game = game; } });
    }
    return out;
  }

  function matchLine(pick, lines) {
    const n = norm(pick.name);
    const lname = last(pick.name);
    const hits = lines.filter(x => norm(x.name) === n);
    if (hits.length) return hits[0];
    const lastHits = lines.filter(x => last(x.name) === lname);
    if (lastHits.length === 1) return lastHits[0];
    return lastHits.find(x => norm(x.name).indexOf(n.split(' ')[0]) >= 0) || null;
  }

  ACT.gradePicks = async function () {
    const open = Object.values(S.picks || {}).filter(p => !p.result);
    if (!open.length) { toast('No open bets to grade.'); return; }
    toast('Pulling box scores...');
    const dates = Array.from(new Set(open.map(p => p.date).filter(Boolean)));
    if (!dates.length) dates.push(DATE);
    let lines = [];
    for (const d of dates) {
      try { lines = lines.concat(await loadLines(d)); }
      catch (e) {}
    }
    let n = 0, held = 0;
    open.forEach(p => {
      const row = matchLine(p, lines);
      if (!row) return;
      const game = row._game || { status: row.status, inning: row.inning };
      const done = pitcherDone(game, row) || /final|game over|completed/i.test(row.status);
      const actual = actualFor(p, row);
      if (actual == null) return;
      if (!done && (p.kind === 'P' || /strikeout|hits allowed|earned|walks allowed|outs/i.test(p.mlabel || ''))) {
        p.live = actual; persist('picks', p.id); held++; return;
      }
      const res = decide(p, actual);
      if (!res) return;
      p.result = res;
      p.actual = actual;
      persist('picks', p.id);
      n++;
    });
    render();
    toast(n ? ('Graded ' + n + ' bet' + (n === 1 ? '' : 's') + (held ? '. ' + held + ' still live.' : '.')) : (held ? held + ' still in progress.' : 'No matching box lines yet.'));
  };

  const _vRecord = typeof vRecord === 'function' ? vRecord : null;
  if (_vRecord && !vRecord._grade) {
    vRecord = function () {
      let h = _vRecord();
      const btn = '<div class="flex" style="margin:8px 0 12px"><button class="primary" data-act="gradePicks">Grade finished games</button></div>';
      h = h.replace('<h2>Bets</h2>', btn + '<h2>Bets</h2>');
      return h;
    };
    vRecord._grade = true;
  }
})();
