// Token Launch Radar — dashboard. Reads window.RADAR (written beside dashboard/ by main.ts) and
// renders the ranked board, filters, an already-trading view, and a per-protocol detail drawer.
// No network: every byte on screen comes from data.js, which main.ts builds from the same board
// it writes to board.json — the farm steps shown here are the board's own strings, verbatim.
(function () {
  'use strict';
  var D = window.RADAR;
  if (!D) return;
  var app = document.getElementById('board');
  var S = { q: '', cat: 'all', min: 0, wl: false, tab: 'board', sort: 'rank', dir: 1, sel: null };

  var usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd0.format(n);
  }
  function fmtPct(n) { return n === null || n === undefined ? 'n/a' : (n > 0 ? '+' : '') + n.toFixed(2) + '%'; }
  function fmtAge(d) {
    if (d === null || d === undefined) return 'unknown';
    if (d >= 730) return (d / 365).toFixed(1) + ' yrs';
    if (d >= 365) return '1.0 yrs';
    if (d >= 30) return Math.round(d / 30.4) + ' mo';
    return d + ' d';
  }
  // Radar score: the board's implied values on a log scale, 0-100. Display only — rank is the order.
  var logs = D.rows.map(function (r) { return Math.log(r.implied_value_usd); });
  var loLog = Math.min.apply(null, logs), hiLog = Math.max.apply(null, logs);
  function scoreOf(r) { return Math.round(((Math.log(r.implied_value_usd) - loLog) / (hiLog - loLog)) * 100); }

  // The plan summary recomputed in the page with the same tiers main.ts uses, so the drawer can
  // state a plan's size and hold without restating the board's step strings.
  function capitalFor(tvl) { return tvl >= 5e9 ? 250 : tvl >= 1e9 ? 150 : tvl >= 1e8 ? 100 : 50; }
  function holdFor(age) { return age === null || age === undefined ? 45 : age < 180 ? 60 : age < 365 ? 45 : 30; }

  function el(tag, attrs) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'class') n.className = attrs[k];
      else if (k === 'text') n.textContent = attrs[k];
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== null && attrs[k] !== undefined) n.setAttribute(k, attrs[k]);
    });
    for (var i = 2; i < arguments.length; i++) {
      var c = arguments[i];
      if (c === null || c === undefined) continue;
      if (Array.isArray(c)) c.forEach(function (x) { if (x) n.appendChild(x); });
      else n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return n;
  }

  function readHash() {
    var p = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    if (p.get('q')) S.q = p.get('q');
    if (p.get('cat')) S.cat = p.get('cat');
    if (p.get('min')) S.min = Number(p.get('min')) || 0;
    if (p.get('wl') === '1') S.wl = true;
    if (p.get('tab') === 'live') S.tab = 'live';
    if (p.get('p')) S.sel = p.get('p');
  }
  function writeHash() {
    var p = new URLSearchParams();
    if (S.q) p.set('q', S.q);
    if (S.cat !== 'all') p.set('cat', S.cat);
    if (S.min) p.set('min', String(S.min));
    if (S.wl) p.set('wl', '1');
    if (S.tab === 'live') p.set('tab', 'live');
    if (S.sel) p.set('p', S.sel);
    var s = p.toString();
    window.history.replaceState(null, '', s ? '#' + s : window.location.pathname + window.location.search);
  }

  function filtered() {
    var q = S.q.trim().toLowerCase();
    return D.rows.filter(function (r) {
      if (S.wl && !r.watchlist) return false;
      if (S.cat !== 'all' && (r.category || 'Uncategorised') !== S.cat) return false;
      if (r.tvl_usd < S.min) return false;
      if (!q) return true;
      return [r.name, r.slug, r.category || '', (r.chains || []).join(' ')].join(' ').toLowerCase().indexOf(q) >= 0;
    });
  }
  function sorted(list) {
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (S.sort === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (S.sort === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (S.sort === 'growth') { av = a.change_7d === null ? -1e9 : a.change_7d; bv = b.change_7d === null ? -1e9 : b.change_7d; }
      else if (S.sort === 'age') { av = a.age_days === null ? -1 : a.age_days; bv = b.age_days === null ? -1 : b.age_days; }
      else if (S.sort === 'score') { av = scoreOf(a); bv = scoreOf(b); }
      else if (S.sort === 'implied') { av = a.implied_value_usd; bv = b.implied_value_usd; }
      else { av = a.rank; bv = b.rank; }
      if (av < bv) return -S.dir;
      if (av > bv) return S.dir;
      return a.slug < b.slug ? -1 : 1;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'radar-dot' }),
        el('div', null, el('b', { text: 'Token Launch Radar' }), el('span', { text: 'pre-token intelligence · ' + D.model_version }))),
      el('div', { class: 'top-meta' },
        el('span', { class: 'chip' }, 'Snapshot ', el('b', { text: D.as_of })),
        el('span', { class: 'chip' }, 'Source ', el('b', { text: 'DefiLlama' })),
        el('span', { class: 'chip' }, 'Watchlist floor ', el('b', { text: fmtUsd(D.floor_usd) }))));
  }
  function hero() {
    var total = D.rows.reduce(function (n, r) { return n + r.implied_value_usd; }, 0);
    var gainers = D.rows.filter(function (r) { return r.change_7d !== null && r.change_7d > 0; }).length;
    function kpi(v, l) { return el('div', { class: 'kpi' }, el('b', { text: v }), el('span', { text: l })); }
    return el('section', { class: 'hero' },
      el('div', null,
        el('h1', { text: 'Which pre-token protocol is worth farming next?' }),
        el('p', null, 'Every protocol here ', el('b', { text: 'records no token' }), ' in its DefiLlama record. The radar prices what a launch would be worth from the snapshot itself: TVL valued at the multiple the market already pays for trading peers in the same category, adjusted for 7-day momentum, time tracked with no token recorded, and chain reach. The watchlist is the floor, never the ceiling — ',
          el('b', { text: D.early_size + ' early protocols' }), ' below the ' + fmtUsd(D.floor_usd) + ' floor are ranked beside it. Select any row for its score breakdown and farm plan.')),
      el('div', { class: 'kpis' },
        kpi(String(D.board_size), 'protocols ranked'),
        kpi(D.watchlist_size + ' / ' + D.watchlist_size, 'watchlist covered'),
        kpi(fmtUsd(total), 'combined implied value'),
        kpi(gainers + ' of ' + D.board_size, 'gaining TVL this week')));
  }
  function controls() {
    var cats = Array.from(new Set(D.rows.map(function (r) { return r.category || 'Uncategorised'; }))).sort();
    var search = el('input', { type: 'search', placeholder: 'Search name, category or chain', value: S.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { S.q = search.value; writeHash(); renderTable(); });
    var catSel = el('select', { 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      cats.map(function (c) { return el('option', { value: c, text: c, selected: c === S.cat ? 'selected' : null }); }));
    catSel.addEventListener('change', function () { S.cat = catSel.value; writeHash(); render(); });
    var mins = [[0, 'Any TVL'], [1e7, '$10M +'], [2.5e7, '$25M +'], [5e7, '$50M +'], [1e8, '$100M +'], [5e8, '$500M +']];
    var minSel = el('select', { 'aria-label': 'Minimum TVL' },
      mins.map(function (m) { return el('option', { value: String(m[0]), text: m[1], selected: S.min === m[0] ? 'selected' : null }); }));
    minSel.addEventListener('change', function () { S.min = Number(minSel.value); writeHash(); render(); });
    var wlBtn = el('button', { class: 'toggle', type: 'button', 'aria-pressed': S.wl ? 'true' : 'false', text: 'Watchlist only',
      onclick: function () { S.wl = !S.wl; writeHash(); render(); } });
    var t1 = el('button', { type: 'button', 'aria-pressed': S.tab === 'board' ? 'true' : 'false', text: 'Pre-token board',
      onclick: function () { S.tab = 'board'; writeHash(); render(); } });
    var t2 = el('button', { type: 'button', 'aria-pressed': S.tab === 'live' ? 'true' : 'false', text: 'Already trading',
      onclick: function () { S.tab = 'live'; writeHash(); render(); } });
    var isFiltered = S.q || S.cat !== 'all' || S.min > 0 || S.wl;
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { text: 'Category' }), catSel),
      el('div', { class: 'field' }, el('label', { text: 'Min TVL' }), minSel),
      el('div', { class: 'field' }, el('label', { text: 'Coverage' }), wlBtn),
      el('div', { class: 'field' }, el('label', { text: 'Token status' }), el('div', { class: 'tabs' }, t1, t2)),
      el('span', { class: 'count' },
        S.tab === 'live' ? D.live.length + ' trading protocols, set aside' : filtered().length + ' of ' + D.board_size + ' shown',
        isFiltered && S.tab === 'board' ? el('button', { type: 'button', text: ' · Reset filters', onclick: function () {
          S.q = ''; S.cat = 'all'; S.min = 0; S.wl = false; writeHash(); render(); } }) : null));
  }
  function sortTh(key, label) {
    return el('th', { scope: 'col' }, el('button', { type: 'button', onclick: function () {
      if (S.sort === key) S.dir = -S.dir; else { S.sort = key; S.dir = key === 'rank' || key === 'name' ? 1 : -1; }
      renderTable();
    } }, label + (S.sort === key ? (S.dir < 0 ? ' ↓' : ' ↑') : '')));
  }
  var tableHost = el('div');
  function renderTable() {
    tableHost.textContent = '';
    tableHost.appendChild(S.tab === 'live' ? liveTable() : boardTable());
    var c = document.querySelector('.count');
    if (c && S.tab === 'board') c.firstChild.textContent = filtered().length + ' of ' + D.board_size + ' shown';
  }
  function boardTable() {
    var list = sorted(filtered());
    if (!list.length) return el('div', { class: 'panel' }, el('div', { class: 'empty' },
      el('h2', { text: 'No protocol matches those filters' }),
      el('p', { text: 'Loosen the search, the category or the minimum TVL to see the board again.' })));
    var max = D.rows[0].implied_value_usd || 1;
    var tb = el('tbody');
    list.forEach(function (r) {
      var pillCls = r.change_7d === null ? 'flat' : r.change_7d > 0.05 ? 'pos' : r.change_7d < -0.05 ? 'neg' : 'flat';
      tb.appendChild(el('tr', { 'data-selected': S.sel === r.slug ? 'true' : 'false', tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } } },
        el('td', { class: 'rank', text: '#' + r.rank }),
        el('td', null, el('div', { class: 'pname' },
          el('div', null, el('b', { text: r.name }),
            el('span', { class: 'badge ' + (r.watchlist ? 'wl' : 'early'), text: r.watchlist ? 'WATCHLIST' : 'EARLY' })),
          el('span', { text: (r.category || 'Uncategorised') + ' · ' + (r.chains.length ? r.chains.slice(0, 3).join(', ') + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') : 'chain n/a') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', null, el('span', { class: 'pill ' + pillCls, text: fmtPct(r.change_7d) })),
        el('td', { class: 'num mut', text: fmtAge(r.age_days) }),
        el('td', null, el('span', { class: 'score', text: String(scoreOf(r)) }), ' ',
          el('span', { class: 'bar' + (r.watchlist ? ' amber' : ''), 'aria-hidden': 'true' },
            el('i', { style: 'width:' + Math.max(4, scoreOf(r)) + '%' }))),
        el('td', null, el('div', { class: 'val' },
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) }),
          el('span', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })))),
        el('td', { class: 'num mut', text: r.model.peer_multiple.toFixed(2) + '×' })));
    });
    return el('div', { class: 'panel' }, el('div', { class: 'table-wrap' }, el('table', null,
      el('caption', { text: 'Ranked by implied value — what a token launch would be worth if the record stayed as it is. Select a row for the full breakdown and farm plan.' }),
      el('thead', null, el('tr', null,
        sortTh('rank', 'Rank'), sortTh('name', 'Protocol'), sortTh('tvl', 'TVL'), sortTh('growth', '7d trend'),
        sortTh('age', 'Age'), sortTh('score', 'Score'), sortTh('implied', 'Implied value'), el('th', { scope: 'col', text: 'Peer ×' }))),
      tb)));
  }
  function liveTable() {
    var tb = el('tbody');
    D.live.forEach(function (r) {
      tb.appendChild(el('tr', null,
        el('td', { class: 'rank', text: 'live' }),
        el('td', null, el('div', { class: 'pname' }, el('b', { text: r.name + (r.symbol ? ' · ' + r.symbol : '') }),
          el('span', { text: (r.category || 'Uncategorised') + ' · ' + (r.chains.slice(0, 3).join(', ') || 'chain n/a') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', null, el('span', { class: 'pill ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) })),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', { class: 'mut small', text: 'already trades — market value, not a model' })));
    });
    return el('div', { class: 'panel' }, el('div', { class: 'table-wrap' }, el('table', null,
      el('caption', { text: 'Already trading: these protocols have a token, so the board shows the market\u2019s own cap and keeps them out of the pre-token ranking. Their caps are also the peers the model learns category multiples from.' }),
      el('thead', null, el('tr', null,
        el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }),
        el('th', { scope: 'col', text: '7d trend' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Note' }))),
      tb)));
  }
  function modelPanel() {
    function f(b, p) { return el('div', { class: 'factor' }, el('b', { text: b }), el('p', { text: p })); }
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed — model ' + D.model_version }),
      el('div', { class: 'formula', text: 'implied = TVL × peer multiple (category) × momentum (7d) × maturity (age) × breadth (chains)' }),
      el('div', { class: 'factors' },
        f('Peer multiple', 'The median market-cap ÷ TVL of the category\u2019s already-trading protocols in this snapshot, shrunk toward the global median (' + D.global_peer_multiple.toFixed(2) + '×) and clamped to 0.08–1.20×. The market prices the base, not a guess.'),
        f('Momentum ×0.75–1.33', '1 + 0.55 × the 7-day TVL change, clamped to −45%…+60%. Growing protocols are gaining the users a launch would be priced on.'),
        f('Maturity ×0.78–1.22', 'Grows with days tracked since listing, up to four years. A protocol that built TVL for years with no token recorded has earned the premium. Unknown listing dates score a neutral 540 days.'),
        f('Breadth ×1.00–1.12', '1 + 0.05 × ln(chains). Multi-chain reach is distribution a new token inherits on day one.')),
      el('p', { class: 'small mut', text: 'One function scores every row — no protocol name is special-cased and nothing is hand-picked. Implied value is this entry\u2019s own model claim about a hypothetical launch, not a prediction that a token will be issued. A protocol listed here records no token in its DefiLlama record; the record is not proof that none exists.' }));
  }

  var dialog = el('dialog', { class: 'detail', 'aria-labelledby': 'd-title' });
  dialog.addEventListener('close', function () { S.sel = null; writeHash(); renderTable(); });
  function factorRow(label, mult, maxV, note) {
    return el('div', null,
      el('div', { class: 'frow' }, el('span', { class: 'mut', text: label }),
        el('span', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.min(100, Math.round((mult / maxV) * 100)) + '%' })),
        el('span', { class: 'num', text: '×' + mult.toFixed(2) })),
      el('p', { class: 'small mut', text: note }));
  }
  function openDetail(slug) {
    var r = D.rows.filter(function (x) { return x.slug === slug; })[0];
    if (!r) return;
    S.sel = slug; writeHash();
    var m = r.model;
    var why = 'Rank #' + r.rank + ' of ' + D.board_size + ' because ' + fmtUsd(r.tvl_usd) + ' of TVL is priced at ' +
      m.peer_multiple.toFixed(2) + '× — the multiple the market pays for trading ' + (r.category || 'Uncategorised') +
      ' peers (' + m.peer_count + ' in this snapshot) — then adjusted ×' + m.momentum_multiplier.toFixed(2) + ' for its ' +
      fmtPct(r.change_7d) + ' week, ×' + m.maturity_multiplier.toFixed(2) + ' for ' + fmtAge(r.age_days) +
      ' tracked with no token recorded, and ×' + m.breadth_multiplier.toFixed(2) + ' for reach across ' +
      r.chains.length + (r.chains.length === 1 ? ' chain' : ' chains') + '.';
    dialog.textContent = '';
    dialog.appendChild(el('div', { class: 'd-head' },
      el('div', null,
        el('span', { class: 'chip' }, 'Rank ', el('b', { text: '#' + r.rank + ' of ' + D.board_size }), ' · Score ', el('b', { text: String(scoreOf(r)) })),
        el('h2', { id: 'd-title', text: r.name }),
        el('p', { class: 'mut small', text: (r.category || 'Uncategorised') + ' · ' + (r.chains.join(', ') || 'chain n/a') + ' · listed ' + (r.listed_at || 'date n/a') })),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: '✕', onclick: function () { dialog.close(); } })));
    dialog.appendChild(el('div', { class: 'd-status' },
      el('span', { class: 'badge ' + (r.watchlist ? 'wl' : 'early'), text: r.watchlist ? 'ON THE WATCHLIST' : 'EARLY — BELOW THE $50M FLOOR' }),
      el('span', { class: 'chip', text: 'Records no token (DefiLlama record)' })));
    function kpi(v, l) { return el('div', { class: 'kpi' }, el('b', { text: v }), el('span', { text: l })); }
    dialog.appendChild(el('div', { class: 'd-grid' },
      kpi(fmtUsd(r.implied_value_usd), 'Implied value'), kpi(fmtUsd(r.tvl_usd), 'TVL'),
      kpi(m.peer_multiple.toFixed(2) + '×', 'Peer multiple'),
      kpi(fmtPct(r.change_7d), '7-day TVL change'), kpi(fmtAge(r.age_days), 'Age, no token recorded'),
      kpi(String(r.chains.length), 'Chains')));
    dialog.appendChild(el('section', { class: 'd-sec' },
      el('h3', { text: 'Why it ranks here' }),
      el('p', { class: 'why', text: why }),
      factorRow('Peer multiple', m.peer_multiple, 1.2, 'What the market pays per $1 of TVL for trading ' + (r.category || 'Uncategorised') + ' protocols.'),
      factorRow('Momentum', m.momentum_multiplier, 1.33, '7-day TVL change of ' + fmtPct(r.change_7d) + ', clamped and weighted at 0.55.'),
      factorRow('Maturity', m.maturity_multiplier, 1.22, fmtAge(r.age_days) + ' since DefiLlama first tracked it, still with no token recorded.'),
      factorRow('Breadth', m.breadth_multiplier, 1.12, 'Live on ' + r.chains.length + (r.chains.length === 1 ? ' chain.' : ' chains.'))));
    dialog.appendChild(el('section', { class: 'd-sec' },
      el('h3', { text: 'Farm plan' }),
      el('div', { class: 'plan-chips' },
        el('span', { class: 'chip' }, 'Position ', el('b', { text: '$' + capitalFor(r.tvl_usd) })),
        el('span', { class: 'chip' }, 'Hold ', el('b', { text: holdFor(r.age_days) + ' days' })),
        el('span', { class: 'chip' }, 'Cadence ', el('b', { text: 'weekly' })),
        el('span', { class: 'chip' }, 'Chain ', el('b', { text: r.chains[0] || 'n/a' }))),
      el('ol', { class: 'steps' }, r.farm_steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var head = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: head }), tail ? el('span', { class: 'cost', text: tail }) : null);
      })),
      el('p', { class: 'small mut', text: 'Farming is a bet on a launch that may never happen. Size positions so a total loss is acceptable, and re-check the protocol\u2019s own pages before every step.' })));
    if (typeof dialog.showModal === 'function') { if (!dialog.open) dialog.showModal(); }
    else dialog.setAttribute('open', '');
    renderTable();
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(hero());
    shell.appendChild(controls());
    tableHost.textContent = '';
    tableHost.appendChild(S.tab === 'live' ? liveTable() : boardTable());
    shell.appendChild(tableHost);
    if (S.tab === 'board') shell.appendChild(modelPanel());
    app.appendChild(shell);
    if (!dialog.isConnected) app.appendChild(dialog);
    app.setAttribute('aria-busy', 'false');
    if (S.sel) openDetail(S.sel);
  }
  readHash();
  render();
})();
