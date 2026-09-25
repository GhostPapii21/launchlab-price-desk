/* Last-night box history. Load after book-import.js */
(function () {
  const HIST_W = 0.12;
  let HIST = { loaded: false, date: '', nB: 0, nP: 0 };

  function normName(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/\./g, '').replace(/'/g, '').replace(/\s+/g, ' ').trim();
  }
  function lastFirst(s) {
    const parts = normName(s).split(' ');
    return parts[parts.length - 1] || '';
  }
  function findPl(name) {
    const n = normName(name);
    const last = lastFirst(name);
    const all = Object.values((window.S && S.players) || {});
    let hit = all.find(p => normName(p.name) === n);
    if (hit) return hit;
    const lastHits = all.filter(p => lastFirst(p.name) === last);
    if (lastHits.length === 1) return lastHits[0];
    return all.find(p => normName(p.name).includes(n) || n.includes(normName(p.name))) || null;
  }
  function upsertLog(pl, entry) {
    pl.log = pl.log || [];
    const key = entry.date + '|' + (entry.opp || '');
    if (!pl.log.some(g => (g.date + '|' + (g.opp || '')) === key)) pl.log.unshift(entry);
    if (pl.log.length > 30) pl.log = pl.log.slice(0, 30);
  }
  function applyHistoryDoc(doc) {
    const date = doc.date || '2026-09-24';
    let nB = 0, nP = 0;
    (doc.batters || []).forEach(row => {
      let pl = findPl(row.name);
      if (!pl) {
        const id = 'batter-hist-' + slug(row.name);
        pl = S.players[id] = { id, type: 'batter', name: row.name, team: row.team || '', season: {}, log: [], src: 'box' };
      }
      upsertLog(pl, {
        date, opp: row.opp || '', PA: +row.PA || 0, H: +row.H || 0, D: +row.D || 0,
        T: +row.T || 0, HR: +row.HR || 0, BB: +row.BB || 0, SO: +row.SO || 0,
        R: +row.R || 0, RBI: +row.RBI || 0, hist: true
      });
      persist('players', pl.id);
      nB++;
    });
    (doc.pitchers || []).forEach(row => {
      let pl = findPl(row.name);
      if (!pl || pl.type !== 'pitcher') {
        const id = 'pitcher-hist-' + slug(row.name);
        if (!S.players[id]) S.players[id] = { id, type: 'pitcher', name: row.name, team: row.team || '', season: {}, log: [], src: 'box' };
        pl = S.players[id];
      }
      upsertLog(pl, {
        date, opp: row.opp || '', IP: String(row.IP || '0.0'), BF: +row.BF || 0,
        H: +row.H || 0, ER: +row.ER || 0, HR: +row.HR || 0, BB: +row.BB || 0,
        SO: +row.SO || 0, hist: true
      });
      persist('players', pl.id);
      nP++;
    });
    HIST = { loaded: true, date, nB, nP };
    if (typeof simCache !== 'undefined' && simCache.clear) simCache.clear();
    render();
    toast('Built in ' + nB + ' batter lines and ' + nP + ' pitcher lines from ' + date);
  }

  if (typeof batterRates === 'function' && !batterRates._hist) {
    const _br = batterRates;
    batterRates = function (b) {
      const out = _br(b);
      const g = (b.log || []).find(x => x.hist && x.PA);
      if (!g || !out || !out.r) return out;
      const pa = Math.max(1, +g.PA);
      const last = {
        K: (+g.SO || 0) / pa,
        BB: (+g.BB || 0) / pa,
        HR: (+g.HR || 0) / pa,
        S1: Math.max(0, (+g.H || 0) - (+g.D || 0) - (+g.T || 0) - (+g.HR || 0)) / pa,
        S2: (+g.D || 0) / pa,
        S3: (+g.T || 0) / pa
      };
      const r = Object.assign({}, out.r);
      Object.keys(last).forEach(k => { if (r[k] != null) r[k] = r[k] * (1 - HIST_W) + last[k] * HIST_W; });
      return { r, n: out.n };
    };
    batterRates._hist = true;
  }
  if (typeof pitcherRates === 'function' && !pitcherRates._hist) {
    const _pr = pitcherRates;
    pitcherRates = function (p, side) {
      const out = _pr(p, side);
      const g = (p.log || []).find(x => x.hist && (x.BF || x.SO));
      if (!g || !out) return out;
      const bf = Math.max(1, +g.BF || ((+String(g.IP || '0').split('.')[0] || 0) * 4.25));
      const r = Object.assign({}, out);
      if (r.K != null) r.K = r.K * (1 - HIST_W) + ((+g.SO || 0) / bf) * HIST_W;
      if (r.BB != null) r.BB = r.BB * (1 - HIST_W) + ((+g.BB || 0) / bf) * HIST_W;
      if (r.HR != null) r.HR = r.HR * (1 - HIST_W) + ((+g.HR || 0) / bf) * HIST_W;
      return r;
    };
    pitcherRates._hist = true;
  }

  ACT.loadHistory = async function () {
    try {
      const files = ['history-2026-09-24.json', 'history-2026-09-24-batters.json', 'history-2026-09-24-pitchers.json'];
      const doc = { date: '2026-09-24', batters: [], pitchers: [] };
      let any = false;
      for (const f of files) {
        try {
          const r = await fetch(f, { cache: 'no-store' });
          if (!r.ok) continue;
          const j = await r.json();
          if (j.placeholder) continue;
          if (j.date) doc.date = j.date;
          if (j.batters) doc.batters = doc.batters.concat(j.batters);
          if (j.pitchers) doc.pitchers = doc.pitchers.concat(j.pitchers);
          any = true;
        } catch (e) {}
      }
      if (!any || (!doc.batters.length && !doc.pitchers.length)) throw new Error('missing');
      applyHistoryDoc(doc);
    } catch (e) {
      toast('Could not load last night box file.');
    }
  };

  const _render = render;
  render = function () {
    _render();
    if (typeof TAB === 'undefined' || TAB !== 'import') return;
    const app = document.getElementById('app');
    if (!app || app.querySelector('[data-hist-card]')) return;
    const card = document.createElement('div');
    card.className = 'card';
    card.setAttribute('data-hist-card', '1');
    card.innerHTML = '<h3>Last night box scores</h3>'
      + '<p class="sub">9/24 finals from the scoreboard screenshots. Adds those games to each player log and blends 12% of last night into today rates.</p>'
      + '<button class="primary" data-act="loadHistory">Build last night into the model</button>'
      + (HIST.loaded ? ('<p class="sub">Loaded ' + HIST.date + ': ' + HIST.nB + ' batters, ' + HIST.nP + ' pitchers.</p>') : '');
    const h2 = app.querySelector('h2');
    if (h2 && h2.nextSibling) app.insertBefore(card, h2.nextSibling);
    else app.appendChild(card);
  };
})();
