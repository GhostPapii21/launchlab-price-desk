/* LaunchLab book-line importer. Loaded after the desk. */
(function () {
  const MKT_ALIASES = {
    hits: ['H', 'B'], 'total hits': ['H', 'B'], 'to get a hit': ['H', 'B'], hit: ['H', 'B'],
    'total bases': ['TB', 'B'], tb: ['TB', 'B'], bases: ['TB', 'B'],
    'home runs': ['HR', 'B'], hr: ['HR', 'B'], homers: ['HR', 'B'], 'hr yes': ['HR', 'B'],
    singles: ['S1', 'B'], doubles: ['S2', 'B'], triples: ['S3', 'B'],
    walks: ['BB', 'B'], bb: ['BB', 'B'],
    runs: ['R', 'B'], rbi: ['RBI', 'B'], rbis: ['RBI', 'B'],
    'hits + runs + rbis': ['HRR', 'B'], hrr: ['HRR', 'B'], 'hits runs rbis': ['HRR', 'B'],
    strikeouts: ['K', 'B'], ks: ['K', 'B'], so: ['K', 'B'],
    'hits allowed': ['PH', 'P'], 'pitcher hits': ['PH', 'P'],
    'earned runs': ['PER', 'P'], er: ['PER', 'P'],
    'strikeouts thrown': ['PK', 'P'], 'pitcher strikeouts': ['PK', 'P'], 'pitcher k': ['PK', 'P'], 'k thrown': ['PK', 'P'],
    'walks allowed': ['PBB', 'P'], 'pitcher walks': ['PBB', 'P'],
    'outs recorded': ['POUT', 'P'], outs: ['POUT', 'P']
  };

  function normName(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/\./g, '').replace(/'/g, '').replace(/\s+/g, ' ').trim();
  }
  function lastFirst(s) {
    const n = normName(s);
    const parts = n.split(' ');
    return parts.length ? parts[parts.length - 1] : n;
  }
  function parseOdds(s) {
    const t = String(s || '').trim().replace(/−/g, '-');
    if (!t) return '';
    if (/^[+-]?\d+$/.test(t)) return t.startsWith('+') || t.startsWith('-') ? t : (Number(t) >= 100 ? '+' + t : t);
    return t;
  }
  function mapMarket(raw, hintKind) {
    const k = String(raw || '').toLowerCase().replace(/_/g, ' ').trim();
    if (MKT_ALIASES[k]) return MKT_ALIASES[k];
    if (hintKind === 'P' || /allowed|thrown|recorded/.test(k)) {
      if (/hit/.test(k)) return ['PH', 'P'];
      if (/walk|bb/.test(k)) return ['PBB', 'P'];
      if (/strike|k\b/.test(k)) return ['PK', 'P'];
      if (/earn|er\b/.test(k)) return ['PER', 'P'];
      if (/out/.test(k)) return ['POUT', 'P'];
    }
    if (/total base/.test(k)) return ['TB', 'B'];
    if (/home run|\bhr\b/.test(k)) return ['HR', 'B'];
    if (/\bhit/.test(k)) return ['H', 'B'];
    if (/strike|k\b/.test(k)) return hintKind === 'P' ? ['PK', 'P'] : ['K', 'B'];
    if (/\brbi/.test(k)) return ['RBI', 'B'];
    if (/\brun/.test(k)) return ['R', 'B'];
    if (/\bwalk|\bbb\b/.test(k)) return ['BB', 'B'];
    return null;
  }
  function parseRows(text) {
    const lines = String(text || '').replace(/\r/g, '').split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
    if (!lines.length) throw new Error('Nothing to import.');
    const split = (line) => {
      const out = []; let cur = '', q = false;
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === '"') q = !q;
        else if (c === ',' && !q) { out.push(cur.trim()); cur = ''; }
        else cur += c;
      }
      out.push(cur.trim());
      return out;
    };
    let header = split(lines[0]).map(h => h.toLowerCase().replace(/\s+/g, ''));
    const hasHeader = header.some(h => ['player', 'name', 'market', 'line', 'odds', 'side', 'book'].includes(h));
    const rows = [];
    const start = hasHeader ? 1 : 0;
    const idx = (names) => {
      for (const n of names) { const i = header.indexOf(n); if (i >= 0) return i; }
      return -1;
    };
    for (let i = start; i < lines.length; i++) {
      const cols = split(lines[i]);
      if (!hasHeader) {
        rows.push({ player: cols[0], market: cols[1], line: cols[2], side: cols[3], odds: cols[4], oppOdds: cols[5] || '', book: cols[6] || '' });
        continue;
      }
      const get = (names) => { const j = idx(names); return j >= 0 ? cols[j] : ''; };
      rows.push({
        player: get(['player', 'name']),
        market: get(['market', 'prop', 'stat']),
        line: get(['line']),
        side: get(['side', 'ou']),
        odds: get(['odds', 'price', 'american']),
        oppOdds: get(['oppodds', 'otherodds', 'juice']),
        book: get(['book', 'sportsbook'])
      });
    }
    return rows;
  }
  function findPlayer(name) {
    const n = normName(name);
    const last = lastFirst(name);
    const all = Object.values(S.players || {});
    let hit = all.find(p => normName(p.name) === n);
    if (hit) return hit;
    const lastHits = all.filter(p => lastFirst(p.name) === last);
    if (lastHits.length === 1) return lastHits[0];
    hit = all.find(p => normName(p.name).includes(n) || n.includes(normName(p.name)));
    return hit || null;
  }
  function findSide(pl) {
    const sl = slate(DATE);
    const sides = sl.sides || [];
    if (pl.type === 'pitcher') return sides.find(x => x.pitcher === pl.id) || null;
    const s = sides.find(x => (x.lineup || []).includes(pl.id));
    if (s) return s;
    return sides.find(x => {
      const t = (x.label || '') + ' ' + (x.oppLabel || '');
      return pl.team && t.toLowerCase().includes(String(pl.team).toLowerCase().split(' ').pop());
    }) || null;
  }
  function importText(text) {
    const parsed = parseRows(text);
    const sl = slate(DATE);
    sl.props = sl.props || [];
    let added = 0, skipped = [];
    parsed.forEach(row => {
      const pl = findPlayer(row.player);
      if (!pl) { skipped.push(row.player + ' (not on slate)'); return; }
      const hint = pl.type === 'pitcher' ? 'P' : 'B';
      const mapped = mapMarket(row.market, hint);
      if (!mapped) { skipped.push(row.player + ' (market)'); return; }
      let [market, kind] = mapped;
      if (pl.type === 'pitcher' && kind === 'B' && market === 'K') { market = 'PK'; kind = 'P'; }
      if (pl.type === 'batter' && kind === 'P') { skipped.push(row.player + ' (pitcher market on batter)'); return; }
      const sideObj = findSide(pl);
      if (!sideObj) { skipped.push(row.player + ' (no matchup side)'); return; }
      if (kind === 'B' && !(sideObj.lineup || []).includes(pl.id)) {
        skipped.push(row.player + ' (lineup not posted — batter props wait)');
        return;
      }
      const line = parseFloat(row.line);
      if (!isFinite(line)) { skipped.push(row.player + ' (line)'); return; }
      let side = String(row.side || 'over').toLowerCase();
      if (side === 'o' || side === 'more') side = 'over';
      if (side === 'u' || side === 'less') side = 'under';
      if (side !== 'over' && side !== 'under') side = 'over';
      const odds = parseOdds(row.odds);
      if (!odds) { skipped.push(row.player + ' (odds)'); return; }
      const key = [sideObj.id, pl.id, kind, market, line, side].join('|');
      sl.props = sl.props.filter(p => [p.sideId, p.player, p.kind, p.market, p.line, p.side].join('|') !== key);
      sl.props.push({ id: uid(), kind, sideId: sideObj.id, player: pl.id, market, line, side, odds, oppOdds: parseOdds(row.oppOdds), book: row.book || '' });
      added++;
    });
    persist('slates', DATE);
    render();
    toast(added ? ('Added ' + added + ' book line' + (added === 1 ? '' : 's') + (skipped.length ? '. Skipped ' + skipped.length : '')) : ('None added. ' + (skipped[0] || 'Check names vs the loaded slate.')));
    return { added, skipped };
  }

  const origBoard = vBoard;
  vBoard = function () {
    const box = '<div class="card"><h3>Import book lines</h3><p class="sub">Paste CSV (Player,Market,Line,Side,Odds,OppOdds,Book). Pitcher Ks attach now. Batter props wait for posted lineups. Reload from MLB first.</p><label for="bookText">Book CSV</label><textarea id="bookText" placeholder="Player,Market,Line,Side,Odds,OppOdds,Book"></textarea><div class="flex" style="margin-top:8px"><button class="primary" data-act="importBooks">Import book lines</button><button class="ghost" data-act="loadBookFile">Load today\u2019s file</button></div></div>';
    return origBoard() + box;
  };

  ACT.importBooks = () => {
    const el = $('#bookText');
    try { importText(el && el.value); }
    catch (e) { toast(e.message || 'Could not parse that paste.'); }
  };
  ACT.loadBookFile = async () => {
    const names = ['books-today.csv', 'books-2026-09-25.csv'];
    for (const n of names) {
      try {
        const r = await fetch(n, { cache: 'no-store' });
        if (!r.ok) continue;
        const t = await r.text();
        const el = $('#bookText'); if (el) el.value = t;
        importText(t);
        return;
      } catch (e) {}
    }
    toast('No books-today.csv on this site yet. Paste the CSV instead.');
  };
})();
