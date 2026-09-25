/* Board: Pitchers vs Batters best-price lists. */
(function () {
  window.BOARD_FOCUS = localStorage.getItem('ll-board-focus') || 'P';

  ACT.boardFocus = function (d) {
    BOARD_FOCUS = (d && d.focus) || 'P';
    localStorage.setItem('ll-board-focus', BOARD_FOCUS);
    render();
  };

  function lineupReady(sl, playerId) {
    return (sl.sides || []).some(s => (s.lineup || []).includes(playerId));
  }

  function bestBlock() {
    const sl = (S.slates && S.slates[DATE]) || { sides: [], props: [] };
    const focus = BOARD_FOCUS;
    const nP = (sl.props || []).filter(p => p.kind === 'P').length;
    const nB = (sl.props || []).filter(p => p.kind === 'B').length;
    const posted = (sl.sides || []).filter(s => (s.lineup || []).filter(Boolean).length).length;
    let h = '<h2>Best prices</h2>';
    h += '<div class="seg" role="tablist" aria-label="Best prices group" style="margin:8px 0 12px">';
    h += '<button data-act="boardFocus" data-focus="P" aria-pressed="' + (focus === 'P') + '">Pitchers' + (nP ? ' · ' + nP : '') + '</button>';
    h += '<button data-act="boardFocus" data-focus="B" aria-pressed="' + (focus === 'B') + '">Batters' + (nB ? ' · ' + nB : '') + '</button>';
    h += '</div>';
    if (focus === 'B' && !posted) {
      h += '<p class="empty">Batting lineups are not posted yet. Reload from MLB after they drop, import batter lines, then the best batter markets show here.</p>';
      return h;
    }
    const priced = (sl.props || []).map(pr => ({ pr, ev: propEval(pr, sl) }))
      .filter(x => x.ev && x.ev.pc && x.pr.kind === focus)
      .filter(x => focus !== 'B' || lineupReady(sl, x.pr.player))
      .sort((a, b) => b.ev.pc.edge - a.ev.pc.edge);
    if (!priced.length) {
      h += focus === 'B'
        ? '<p class="empty">No batter prices yet. Once lineups confirm, import hits / TB / HR / RBI and they rank here separate from pitchers.</p>'
        : '<p class="empty">No pitcher prices yet. Import strikeouts, hits allowed, walks, ER, or outs.</p>';
      return h;
    }
    h += '<div class="scroll"><table><thead><tr><th>Player / market</th><th>Model</th><th>Book</th><th>Edge</th><th>Stake</th><th></th></tr></thead><tbody>';
    priced.forEach(({ pr, ev }) => {
      const pl = P(pr.player);
      const m = ((pr.kind === 'P' ? PMKT : BMKT)[pr.market] || [pr.market])[0];
      const hrFlag = (pr.market === 'HR' || pr.market === 'TB') && ev.g && ev.g.wxPosted !== 'yes' ? ' <span class="warn">wx?</span>' : '';
      h += '<tr><td class="l"><b>' + esc(pl ? pl.name : '?') + '</b><span class="odds">' + pr.side + ' ' + pr.line + ' ' + esc(m) + hrFlag + '</span></td>';
      h += '<td><span class="big">' + pct(ev.mp) + '</span><span class="odds">' + probToAm(ev.mp) + '</span></td>';
      h += '<td>' + esc(pr.odds) + '<span class="odds">' + pct(ev.pc.fair) + ' fair</span></td>';
      h += '<td><span class="chip ' + (ev.pc.edge > 0 ? 'pos' : 'neg') + '">' + sgn(ev.pc.edge) + '</span></td>';
      h += '<td>' + (ev.pc.edge > 0 ? (ev.pc.kelly * 100).toFixed(1) + '%' : '—') + '</td>';
      h += '<td><button class="small ghost" data-act="takePick" data-id="' + pr.id + '">Log</button> <button class="small ghost" data-act="delProp" data-id="' + pr.id + '" aria-label="Remove line">✕</button></td></tr>';
    });
    h += '</tbody></table></div>';
    h += focus === 'B'
      ? '<p class="sub">Batter board only. Hits, total bases, HR, RBI, runs, walks. Lineup must be posted or the row stays off this list.</p>'
      : '<p class="sub">Pitcher board only. Strikeouts, hits allowed, walks, earned runs, outs. Edge = model minus no-vig book. Stake is quarter-Kelly, capped at 3%.</p>';
    return h;
  }

  if (typeof vBoard === 'function' && !vBoard._split) {
    const _v = vBoard;
    vBoard = function () {
      const html = _v();
      return html.replace(/<h2>Best prices<\/h2>[\s\S]*?<h2>Matchups<\/h2>/, bestBlock() + '<h2>Matchups</h2>');
    };
    vBoard._split = true;
  }
})();
