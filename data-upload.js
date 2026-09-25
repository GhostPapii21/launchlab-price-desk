/* Data tab: spreadsheet upload next to Import CSV. Load after book-import.js */
(function () {
  const AL = {
    name: 'name', player: 'name', playername: 'name', team: 'team', tm: 'team',
    bats: 'hand', throws: 'hand', hand: 'hand', pa: 'PA', h: 'H', '2b': 'D', '3b': 'T',
    hr: 'HR', bb: 'BB', so: 'SO', k: 'SO', r: 'R', rbi: 'RBI', g: 'G', gs: 'GS',
    ip: 'IP', tbf: 'BF', bf: 'BF', er: 'ER'
  };
  function key(h) { return String(h || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }
  function loadXlsx() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js';
      s.onload = () => resolve(window.XLSX);
      s.onerror = () => reject(new Error('Could not load the Excel reader.'));
      document.head.appendChild(s);
    });
  }
  function aoaToCsv(aoa) {
    return aoa.map(row => row.map(c => {
      const s = String(c == null ? '' : c);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(',')).join('\n');
  }
  function applyForm(type, header, rows) {
    const hk = header.map(key);
    const nameI = hk.findIndex(h => AL[h] === 'name');
    if (nameI < 0) return 0;
    let n = 0;
    rows.forEach(r => {
      const name = String(r[nameI] || '').replace(/[*#+]+$/, '').trim();
      if (!name) return;
      const id = slug(type + '-' + name);
      const p = S.players[id];
      if (!p) return;
      const grab = (prefix) => {
        const o = {};
        header.forEach((h, i) => {
          const k = key(h);
          if (!k.startsWith(prefix)) return;
          const rest = k.slice(prefix.length);
          const mapped = AL[rest];
          if (mapped && r[i] !== '' && r[i] != null) o[mapped] = r[i];
        });
        return o;
      };
      const l5 = grab('l5');
      const l10 = grab('l10');
      if (Object.keys(l5).length || Object.keys(l10).length) {
        p.form = { l5, l10 };
        persist('players', p.id);
        n++;
      }
    });
    return n;
  }
  if (typeof battingCounts === 'function' && !battingCounts._form) {
    const _bc = battingCounts;
    battingCounts = function (b) {
      const c = _bc(b);
      const f = b.form || {};
      function add(src, w) {
        if (!src) return;
        const pa = +src.PA || 0;
        if (!pa) return;
        c.PA += pa * w; c.H += (+src.H || 0) * w; c.D += (+src.D || 0) * w;
        c.T += (+src.T || 0) * w; c.HR += (+src.HR || 0) * w;
        c.BB += (+src.BB || 0) * w; c.SO += (+src.SO || 0) * w;
      }
      add(f.l10, 0.35); add(f.l5, 0.20);
      return c;
    };
    battingCounts._form = true;
  }
  if (typeof pitcherCounts === 'function' && !pitcherCounts._form) {
    const _pc = pitcherCounts;
    pitcherCounts = function (p, side) {
      const c = _pc(p, side);
      if (side) return c;
      const f = p.form || {};
      function add(src, w) {
        if (!src) return;
        const bf = +src.BF || 0;
        if (!bf) return;
        c.BF += bf * w; c.H += (+src.H || 0) * w; c.HR += (+src.HR || 0) * w;
        c.BB += (+src.BB || 0) * w; c.SO += (+src.SO || 0) * w;
      }
      add(f.l10, 0.35); add(f.l5, 0.20);
      return c;
    };
    pitcherCounts._form = true;
  }

  async function ingest(file) {
    const name = file.name.toLowerCase();
    let aoa = [];
    if (name.endsWith('.csv') || name.endsWith('.tsv')) {
      const text = await file.text();
      aoa = parseCSV(text);
    } else {
      const XLSX = await loadXlsx();
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const prefer = (document.getElementById('impType') || {}).value === 'pitcher'
        ? ['Import-Pitchers', 'Pitchers'] : ['Import-Batters', 'Batters'];
      let sheet = prefer.find(s => wb.SheetNames.includes(s)) || wb.SheetNames[0];
      aoa = XLSX.utils.sheet_to_json(wb.Sheets[sheet], { header: 1, raw: false, defval: '' });
    }
    if (!aoa.length) { toast('That sheet is empty.'); return; }
    const header = (aoa[0] || []).map(x => String(x || ''));
    const box = document.getElementById('impText');
    if (box) box.value = aoaToCsv(aoa);
    if (typeof ACT.importCsv === 'function') ACT.importCsv();
    const type = (document.getElementById('impType') || {}).value || 'batter';
    const nForm = applyForm(type, header, aoa.slice(1));
    if (nForm) toast('Also stored last-5 / last-10 form for ' + nForm + ' players.');
  }

  ACT.importDataFile = async function (d, el) {
    const f = el.files && el.files[0];
    if (!f) return;
    try { await ingest(f); }
    catch (e) { toast(e.message || 'Could not read that spreadsheet.'); }
  };

  const _render = render;
  render = function () {
    _render();
    if (typeof TAB === 'undefined' || TAB !== 'data') return;
    if (document.getElementById('impFile')) return;
    const btn = document.querySelector('[data-act="importCsv"]');
    if (!btn || !btn.parentNode) return;
    const lab = document.createElement('label');
    lab.style.cssText = 'display:inline-block;padding:8px 14px;border-radius:6px;background:var(--ink);color:var(--paper);font-weight:600;cursor:pointer;border:1.5px solid var(--ink)';
    lab.textContent = 'Upload spreadsheet';
    const inp = document.createElement('input');
    inp.id = 'impFile';
    inp.type = 'file';
    inp.accept = '.xlsx,.xls,.csv,.tsv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    inp.setAttribute('data-chg', 'importDataFile');
    inp.style.display = 'none';
    lab.appendChild(inp);
    btn.parentNode.insertBefore(lab, btn.nextSibling);
  };
})();
