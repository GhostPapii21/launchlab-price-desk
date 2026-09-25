/* LaunchLab Import tab — Excel / CSV file picker. */
(function () {
  const MKT_ALIASES = {
    hits: ['H', 'B'], 'total hits': ['H', 'B'], 'to get a hit': ['H', 'B'], hit: ['H', 'B'],
    'total bases': ['TB', 'B'], tb: ['TB', 'B'], bases: ['TB', 'B'],
    'home runs': ['HR', 'B'], hr: ['HR', 'B'], homers: ['HR', 'B'],
    singles: ['S1', 'B'], doubles: ['S2', 'B'], triples: ['S3', 'B'],
    walks: ['BB', 'B'], bb: ['BB', 'B'],
    runs: ['R', 'B'], rbi: ['RBI', 'B'], rbis: ['RBI', 'B'],
    'hits + runs + rbis': ['HRR', 'B'], hrr: ['HRR', 'B'],
    strikeouts: ['K', 'B'], ks: ['K', 'B'], so: ['K', 'B'],
    'hits allowed': ['PH', 'P'], 'pitcher hits': ['PH', 'P'],
    'earned runs': ['PER', 'P'], er: ['PER', 'P'],
    'strikeouts thrown': ['PK', 'P'], 'pitcher strikeouts': ['PK', 'P'], 'pitcher k': ['PK', 'P'],
    'walks allowed': ['PBB', 'P'], 'pitcher walks': ['PBB', 'P'],
    'outs recorded': ['POUT', 'P'], outs: ['POUT', 'P']
  };
  let LAST = { added: 0, skipped: [], file: '', rows: 0 };

  function loadXlsx() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js';
      s.onload = () => resolve(window.XLSX);
      s.onerror = () => reject(new Error('Could not load the Excel reader. Use CSV or try again.'));
      document.head.appendChild(s);
    });
  }
  function normName(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/\./g, '').replace(/'/g, '').replace(/\s+/g, ' ').trim();
  }
  function lastFirst(s) {
    const parts = normName(s).split(' ');
    return parts[parts.length - 1] || '';
  }
  function parseOdds(s) {
    const t = String(s || '').trim().replace(/−/g, '-').replace(/,/g, '');
    if (!t) return '';
    if (/^[+-]?\d+$/.test(t)) return (t.startsWith('+') || t.startsWith('-')) ? t : (Number(t) >= 100 ? '+' + t : t);
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
  function headerKey(h) { return String(h || '').toLowerCase().replace(/\s+/g, ''); }
  function pickCol(header, names) {
    for (const n of names) {
      const i = header.findIndex(h => headerKey(h) === n);
      if (i >= 0) return i;
    }
    return -1;
  }
  function rowsFromSheet(aoa) {
    if (!aoa || !aoa.length) return [];
    const header = (aoa[0] || []).map(x => String(x == null ? '' : x));
    const hk = header.map(headerKey);
    const looks = hk.some(h => ['player', 'name', 'market', 'line', 'odds', 'side', 'book'].includes(h));
    const out = [];
    for (let r = looks ? 1 : 0; r < aoa.length; r++) {
      const cols = aoa[r] || [];
      if (!looks) {
        if (!cols[0]) continue;
        out.push({ player: cols[0], market: cols[1], line: cols[2], side: cols[3], odds: cols[4], oppOdds: cols[5] || '', book: cols[6] || '' });
        continue;
      }
      const get = (names) => {
        const i = pickCol(header, names);
        return i >= 0 && cols[i] != null ? cols[i] : '';
      };
      out.push({
        player: get(['player', 'name']),
        market: get(['market', 'prop', 'stat']),
        line: get(['line']),
        side: get(['side', 'ou']),
        odds: get(['odds', 'price', 'american', 'overodds']),
        oppOdds: get(['oppodds', 'otherodds', 'juice', 'underodds']),
        book: get(['book', 'sportsbook'])
      });
    }
    return out.filter(r => String(r.player || '').trim());
  }
  function findPlayer(name) {
    const n = normName(name);
    const last = lastFirst(name);
    const all = Object.values(S.players || {});
    let hit = all.find(p => normName(p.name) === n);
    if (hit) return hit;
    const lastHits = all.filter(p => lastFirst(p.name) === last);
    if (lastHits.length === 1) return lastHits[0];
    return all.find(p => normName(p.name).includes(n) || n.includes(normName(p.name))) || null;
  }
  function findSide(pl) {
    const sides = (slate(DATE).sides || []);
    if (pl.type === 'pitcher') return sides.find(x => x.pitcher === pl.id) || null;
    const lined = sides.find(x => (x.lineup || []).includes(pl.id));
    if (lined) return lined;
    return sides.find(x => {
      const t = ((x.label || '') + ' ' + (x.oppLabel || '')).toLowerCase();
      const team = String(pl.team || '').toLowerCase().split(' ').pop();
      return team && t.includes(team);
    }) || null;
  }
  function applyRows(parsed) {
    const sl = slate(DATE);
    sl.props = sl.props || [];
    let added = 0, skipped = [];
    parsed.forEach(row => {
      const pl = findPlayer(row.player);
      if (!pl) { skipped.push(row.player + ' — not on loaded slate'); return; }
      const hint = pl.type === 'pitcher' ? 'P' : 'B';
      const mapped = mapMarket(row.market, hint);
      if (!mapped) { skipped.push(row.player + ' — unknown market'); return; }
      let [market, kind] = mapped;
      if (pl.type === 'pitcher' && kind === 'B' && market === 'K') { market = 'PK'; kind = 'P'; }
      if (pl.type === 'batter' && kind === 'P') { skipped.push(row.player + ' — pitcher market on a batter'); return; }
      const sideObj = findSide(pl);
      if (!sideObj) { skipped.push(row.player + ' — no matchup side'); return; }
      if (kind === 'B' && !(sideObj.lineup || []).includes(pl.id)) {
        skipped.push(row.player + ' — lineup not posted yet');
        return;
      }
      const line = parseFloat(row.line);
      if (!isFinite(line)) { skipped.push(row.player + ' — bad line'); return; }
      let side = String(row.side || 'over').toLowerCase();
      if (side === 'o' || side === 'more') side = 'over';
      if (side === 'u' || side === 'less') side = 'under';
      if (side !== 'over' && side !== 'under') side = 'over';
      const odds = parseOdds(row.odds);
      if (!odds) { skipped.push(row.player + ' — missing odds'); return; }
      const key = [sideObj.id, pl.id, kind, market, line, side].join('|');
      sl.props = sl.props.filter(p => [p.sideId, p.player, p.kind, p.market, p.line, p.side].join('|') !== key);
      sl.props.push({
        id: uid(), kind, sideId: sideObj.id, player: pl.id, market, line, side,
        odds, oppOdds: parseOdds(row.oppOdds), book: String(row.book || '')
      });
      added++;
    });
    persist('slates', DATE);
    LAST = { added, skipped, file: LAST.file, rows: parsed.length };
    render();
    toast(added ? ('Imported ' + added + ' line' + (added === 1 ? '' : 's') + (skipped.length ? '. Skipped ' + skipped.length : '')) : ('None imported. ' + (skipped[0] || 'Reload from MLB first.')));
    return LAST;
  }

  async function ingestFile(file) {
    LAST.file = file.name;
    const name = file.name.toLowerCase();
    if (name.endsWith('.csv') || name.endsWith('.tsv')) {
      const text = await file.text();
      const sep = name.endsWith('.tsv') ? '\t' : ',';
      const lines = text.replace(/\r/g, '').split('\n').filter(l => l.trim());
      const aoa = lines.map(line => {
        if (sep === '\t') return line.split('\t');
        const out = []; let cur = '', q = false;
        for (let i = 0; i < line.length; i++) {
          const c = line[i];
          if (c === '"') q = !q;
          else if (c === ',' && !q) { out.push(cur); cur = ''; }
          else cur += c;
        }
        out.push(cur);
        return out;
      });
      return applyRows(rowsFromSheet(aoa));
    }
    const XLSX = await loadXlsx();
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    let all = [];
    wb.SheetNames.forEach(sn => {
      const aoa = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, raw: false, defval: '' });
      all = all.concat(rowsFromSheet(aoa));
    });
    return applyRows(all);
  }

  function vImport() {
    const sl = slate(DATE);
    const nProp = (sl.props || []).length;
    const nSide = (sl.sides || []).length;
    let h = '<h2>Import</h2>';
    h += '<p class="sub">Drop one Excel or CSV with every player line. The desk reads the whole sheet — you do not enter players one at a time.</p>';
    h += '<div class="card"><h3>Book lines spreadsheet</h3>';
    h += '<p class="sub">Columns: <b>Player, Market, Line, Side, Odds</b>. Optional: OppOdds, Book. Files: .xlsx .xls .csv. Reload from MLB first so names match the slate.</p>';
    h += '<label for="xlFile">Choose spreadsheet</label>';
    h += '<input id="xlFile" type="file" accept=".xlsx,.xls,.csv,.tsv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" data-chg="importFile">';
    h += '<div class="flex" style="margin-top:10px">';
    h += '<button class="primary" data-act="loadTodaySheet">Load today’s posted file</button>';
    h += '<a class="ghost" href="books-today.csv" download style="display:inline-block;padding:8px 14px;border:1.5px solid var(--ink);border-radius:6px;text-decoration:none;font-weight:600">Download today CSV</a>';
    h += '</div></div>';
    h += '<div class="note">Pitcher K / hits allowed / walks attach as soon as the slate is loaded. Batter hits / TB / HR / RBI wait until MLB posts that lineup.</div>';
    h += '<p class="sub">Slate ' + DATE + ': ' + nSide + ' matchup sides · ' + nProp + ' book lines on the board.' + (LAST.file ? ' Last file: ' + esc(LAST.file) + ' (' + LAST.rows + ' rows).' : '') + '</p>';
    if (LAST.skipped && LAST.skipped.length) {
      h += '<details open><summary>Skipped ' + LAST.skipped.length + '</summary><ul>';
      LAST.skipped.slice(0, 40).forEach(s => { h += '<li class="sub">' + esc(s) + '</li>'; });
      if (LAST.skipped.length > 40) h += '<li class="sub">…and ' + (LAST.skipped.length - 40) + ' more</li>';
      h += '</ul></details>';
    }
    return h;
  }

  if (!TABS.some(t => t[0] === 'import')) TABS.push(['import', 'Import']);
  const style = document.createElement('style');
  style.textContent = '.tabs div{grid-template-columns:repeat(6,1fr)!important}.tabs button{font-size:.92rem}';
  document.head.appendChild(style);

  const _render = render;
  render = function () {
    if (TAB === 'import') {
      $('#tabs').innerHTML = TABS.map(([k, l]) => '<button data-tab="' + k + '" ' + (TAB === k ? 'aria-current="page"' : '') + '>' + l + '</button>').join('');
      $('#app').innerHTML = '<header class="mast"><div><h1>LaunchLab</h1><div class="sub">Price desk: model probability vs. the posted line</div></div><div class="date">' + esc(new Date(DATE + 'T12:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })) + '</div></header>' + vImport();
      return;
    }
    _render();
  };

  ACT.importFile = async function (d, el) {
    const f = el.files && el.files[0];
    if (!f) return;
    try { await ingestFile(f); }
    catch (e) { toast(e.message || 'Could not read that spreadsheet.'); }
  };
  ACT.loadTodaySheet = async function () {
    const names = ['books-today.csv', 'books-2026-09-25.csv'];
    for (let i = 0; i < names.length; i++) {
      try {
        const r = await fetch(names[i], { cache: 'no-store' });
        if (!r.ok) continue;
        const blob = await r.blob();
        const file = new File([blob], names[i], { type: 'text/csv' });
        await ingestFile(file);
        return;
      } catch (e) {}
    }
    toast('Today’s file is not on the site. Use Choose spreadsheet.');
  };
})();
