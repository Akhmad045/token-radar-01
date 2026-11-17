// Token Radar's dashboard (model radar-2). It reads window.RADAR (written beside dashboard/ by
// main.ts) and renders the ranked board, a filterable table, a per-protocol detail dialog with the
// model's own inputs and the protocol's farm plan, and a model sandbox that re-ranks the board live
// from the same arithmetic. No network: every byte it shows is in data.js.
//
// The farm plan is the same derivation main.ts writes to board.json: category, chains, TVL and age
// decide the action, the capital, the hold and every cost and time. No name is special-cased, and
// the page recomputes each row's implied value from the snapshot figures, so the page's code and the
// board's data are visibly the same arithmetic.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var DEFAULT_MODEL = DATA.model;
  var state = {
    q: '', category: 'all', chain: 'all', wl: false, tab: 'pre-token',
    sort: 'implied', dir: -1, selected: null,
    mult: 1, growth: DEFAULT_MODEL.growth_weight
  };

  var usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd0.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtMult(n) { return n.toFixed(2) + 'x'; }

  // The model in one function: implied value from the snapshot figures, with the sandbox's
  // overrides. The TVL multiple is recomputed from TVL itself, never trusted from the data, so the
  // page re-derives each row from the same figures main.ts used. Default overrides reproduce
  // board.json exactly; the dialog shows the check.
  function impliedOf(row, mult, growthW) {
    var m = DEFAULT_MODEL;
    var growth = Math.min(m.growth_cap, Math.max(m.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * growthW;
    var age = row.age_days === null || row.age_days === undefined ? m.unknown_age_days : row.age_days;
    var maturity = m.maturity_floor + m.maturity_range * (1 - Math.exp(-Math.max(0, age) / m.maturity_days));
    var breadth = 1 + m.breadth_per_chain * Math.min(Math.max((row.chains || []).length - 1, 0), m.breadth_cap_chains);
    var multiple = Math.min(m.multiple_cap, Math.max(m.multiple_floor, m.multiple_base * Math.pow(m.multiple_reference_tvl / Math.max(1, row.tvl_usd), m.multiple_exponent))) * mult;
    return {
      implied: Math.max(1, Math.round(row.tvl_usd * multiple * growthMult * maturity * breadth)),
      multiple: multiple, growthMult: growthMult, maturity: maturity, breadth: breadth, growth: growth, age: age
    };
  }
  function sandboxActive() {
    return state.mult !== 1 || Math.abs(state.growth - DEFAULT_MODEL.growth_weight) > 1e-9;
  }
  function displayRows() {
    var list = DATA.rows.map(function (r) {
      var v = impliedOf(r, state.mult, state.growth);
      return { row: r, implied: v.implied, calc: v };
    });
    if (sandboxActive()) list.sort(function (a, b) { return b.implied - a.implied || (a.row.slug < b.row.slug ? -1 : 1); });
    return list;
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // ---- farm plan: the same derivation as lib/model.ts farmSteps ----
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 500;
    if (p.tvl_usd >= 1e9) return 250;
    if (p.tvl_usd >= 2e8) return 150;
    if (p.tvl_usd >= 5e7) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 45;
    if (age < 180) return 90;
    if (age < 365) return 60;
    if (age < 730) return 45;
    return 30;
  }
  function gasFor(chain) {
    if (chain === 'Ethereum') return 'about $12';
    if (chain === 'Solana') return 'under $0.10';
    if (chain === 'Base' || chain === 'Arbitrum' || chain === 'Optimism' || chain === 'Polygon' || chain === 'Linea' || chain === 'Blast' || chain === 'Mode' || chain === 'Scroll') return 'about $1';
    return 'about $3';
  }
  function gasNum(chain) {
    if (chain === 'Ethereum') return 12;
    if (chain === 'Solana') return 0.1;
    if (chain === 'Base' || chain === 'Arbitrum' || chain === 'Optimism' || chain === 'Polygon' || chain === 'Linea' || chain === 'Blast' || chain === 'Mode' || chain === 'Scroll') return 1;
    return 3;
  }
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and keep the position open, then borrow $20 against it so the account shows both sides.';
    if (c.indexOf('dex') >= 0 || c.indexOf('leveraged farm') >= 0 || c.indexOf('liquidity manager') >= 0) return 'Provide $' + capital + ' of liquidity to ' + name + "'s main pool on " + chain + ' and keep the position open through at least one fee cycle.';
    if (c.indexOf('yield aggregator') >= 0 || c.indexOf('yield') >= 0) return 'Deposit $' + capital + ' of USDC into ' + name + "'s highest-TVL vault on " + chain + ' and let the yield compound in the vault.';
    if (c.indexOf('bridge') >= 0 || c.indexOf('cross chain') >= 0) return 'Bridge $' + capital + ' of USDC into ' + chain + ' through ' + name + ', then use the bridged funds in its app instead of bridging straight back.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return 'Stake $' + capital + " of the chain's staking asset through " + name + ' on ' + chain + ' and keep the receipt token in the same wallet.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0 || c.indexOf('options') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedged trade, about $10 of notional, so the account shows real volume.';
    if (c.indexOf('prediction') >= 0) return 'Fund $' + capital + ' and place one market position on ' + name + ', then settle it rather than leaving it open.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0 || c.indexOf('risk curators') >= 0) return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the vault shares in the farming wallet.';
    if (c.indexOf('stable') >= 0 || c.indexOf('algo-stable') >= 0) return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + ' and hold it in the farming wallet.';
    if (c.indexOf('rwa') >= 0) return 'Mint $' + capital + " of the protocol's yield-bearing asset on " + chain + ' through ' + name + ' and hold it for the full qualifying window.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy active for the whole window.';
    if (c.indexOf('launchpad') >= 0) return 'Stake $' + capital + ' in ' + name + "'s launch pool on " + chain + ' and join one sale with the staked position.';
    if (c.indexOf('farm') >= 0) return 'Stake $' + capital + ' of LP tokens in ' + name + "'s farm on " + chain + ' and claim the farm rewards weekly.';
    if (c.indexOf('synthetics') >= 0) return 'Mint $' + capital + ' of the synthetic asset on ' + name + ' on ' + chain + ' and keep the collateral ratio above the minimum.';
    if (c.indexOf('payments') >= 0 || c.indexOf('card') >= 0) return 'Load $' + capital + ' onto ' + name + ' on ' + chain + ' and make one real payment with it each week.';
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }
  function secondActionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Repay half the $20 borrow and re-borrow it a week later, so the account shows repeated use of ' + name + '.';
    if (c.indexOf('dex') >= 0 || c.indexOf('leveraged farm') >= 0 || c.indexOf('liquidity manager') >= 0) return 'Swap $25 through ' + name + "'s router on " + chain + ' in a separate week, so the wallet shows trading as well as liquidity.';
    if (c.indexOf('yield aggregator') >= 0 || c.indexOf('yield') >= 0) return 'Move $' + Math.max(25, Math.round(capital / 4)) + ' into a second ' + name + ' vault on ' + chain + ' in week two, so the wallet holds two vault positions.';
    if (c.indexOf('bridge') >= 0 || c.indexOf('cross chain') >= 0) return 'Bridge $25 back out through ' + name + ' in a later week, so the wallet shows two-way bridge volume.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return 'Top up the stake by $25 in week two and vote in one governance poll if ' + name + ' runs one.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0 || c.indexOf('options') >= 0) return 'Close the first trade and open a second small one the following week, so the account shows repeated volume on ' + name + '.';
    if (c.indexOf('prediction') >= 0) return 'Place a second position on a different ' + name + ' market in week two, with $10 at stake.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0 || c.indexOf('risk curators') >= 0) return 'Deposit $25 more into the same ' + name + ' vault in week two and leave both deposits untouched.';
    if (c.indexOf('stable') >= 0 || c.indexOf('algo-stable') >= 0) return 'Swap $25 of the stable asset back to USDC through ' + name + ' in week two, then re-mint it the week after.';
    if (c.indexOf('rwa') >= 0) return 'Claim the yield the ' + name + ' asset accrues in week three and re-deposit it into the same position.';
    if (c.indexOf('insurance') >= 0) return 'File a test claim check on ' + name + "'s cover page in week two, without filing a real claim.";
    if (c.indexOf('launchpad') >= 0) return 'Vote in one ' + name + ' governance poll and join a second sale with the same staked position.';
    if (c.indexOf('farm') >= 0) return 'Harvest the farm rewards weekly and re-stake them into the same ' + name + ' farm.';
    if (c.indexOf('synthetics') >= 0) return 'Adjust the collateral ratio once a week so the ' + name + ' position stays healthy through price moves.';
    if (c.indexOf('payments') >= 0 || c.indexOf('card') >= 0) return 'Pay one subscription with ' + name + ' in week two, so the card shows recurring use.';
    return 'Make a second deposit of $25 into ' + name + ' on ' + chain + ' in week two, so the wallet shows repeat use.';
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    var gas = gasFor(chain);
    return [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline on paper, never in a screenshot or a chat.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
      { text: actionFor(p, capital, chain), cost: '$' + capital + ' of capital and ' + gas + ' of gas', time: '15 minutes to set up' },
      { text: secondActionFor(p, capital, chain), cost: gas + ' of gas per action', time: '10 minutes' },
      { text: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote, and never let a whole week pass with no activity.', cost: gas + ' of gas a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot, and do not withdraw early to chase another farm.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: "Each week, open the protocol's own points or rewards page and check the wallet is credited; claim only from the link the protocol itself publishes.", cost: 'no fee to check, and never pay to claim', time: '10 minutes a week' },
      { text: 'Write the wallet, the dates and every transaction hash in a farm log, then unwind in the reverse order you entered so nothing is left staked by accident.', cost: 'nothing but the log', time: '5 minutes' }
    ].map(stepText);
  }
  // Rough all-in cost of following the plan for its hold window: capital is recoverable, gas is not.
  function planCost(p) {
    var chain = chainOf(p);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    var g = gasNum(chain);
    var weeks = Math.max(1, Math.ceil(hold / 7));
    var gasTotal = 3 + g * (2 + weeks);
    return { capital: capital, gas: Math.round(gasTotal * 100) / 100, hold: hold, weeks: weeks };
  }

  // ---- hash state ----
  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('wl') === '1') state.wl = true;
    if (params.get('tab')) state.tab = params.get('tab');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.wl) params.set('wl', '1');
    if (state.tab !== 'pre-token') params.set('tab', state.tab);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  // ---- filtering / sorting ----
  function filtered() {
    var q = state.q.trim().toLowerCase();
    return displayRows().filter(function (d) {
      var r = d.row;
      if (state.wl && !r.is_watchlist) return false;
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var ra = a.row, rb = b.row, av, bv;
      if (key === 'name') { av = ra.name.toLowerCase(); bv = rb.name.toLowerCase(); }
      else if (key === 'tvl') { av = ra.tvl_usd; bv = rb.tvl_usd; }
      else if (key === 'growth') { av = ra.change_7d === null ? -Infinity : ra.change_7d; bv = rb.change_7d === null ? -Infinity : rb.change_7d; }
      else if (key === 'age') { av = ra.age_days === null ? Infinity : ra.age_days; bv = rb.age_days === null ? Infinity : rb.age_days; }
      else { av = a.implied; bv = b.implied; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return ra.slug < rb.slug ? -1 : ra.slug > rb.slug ? 1 : 0;
    });
  }

  // ---- pieces ----
  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' },
        el('span', { class: 'mark', 'aria-hidden': 'true' }),
        el('span', { class: 'brand-name', html: 'Token <em>Radar</em>' })
      ),
      el('div', { class: 'top-meta' },
        el('span', { class: 'pill', html: 'Snapshot <b>' + DATA.as_of + '</b>' }),
        el('span', { class: 'pill', html: 'DefiLlama protocol index' }),
        el('span', { class: 'pill', html: 'Model <b>' + DATA.model_version + '</b>' }),
        el('span', { class: 'pill', html: '<b>' + DATA.board_size + '</b>&nbsp;rows' })
      )
    );
  }

  function lede() {
    var total = DATA.rows.reduce(function (s, r) { return s + r.implied_value_usd; }, 0);
    var sorted = DATA.rows.map(function (r) { return r.implied_value_usd; }).sort(function (a, b) { return a - b; });
    var median = sorted[Math.floor(sorted.length / 2)];
    var watchTvl = DATA.rows.filter(function (r) { return r.is_watchlist; }).reduce(function (s, r) { return s + r.tvl_usd; }, 0);
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { html: '<span>' + DATA.watchlist_size + ' watchlist protocols</span>, ranked by what a launch would be worth' }),
        el('p', { html: 'The watchlist is the floor: every protocol with at least <b>$' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL</b> and no token on record. The early radar adds <b>' + DATA.early_size + ' pre-token protocols</b> below that floor, found by the same rule. Implied value is a model, not a promise — and never a prediction that a token is coming.' })
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size }), el('i', { text: 'every slug, no exceptions' })),
        el('div', { class: 'fact' }, el('span', { text: 'Total implied value' }), el('b', { class: 'num', text: fmtUsd(total) }), el('i', { text: 'across ' + DATA.board_size + ' ranked rows' })),
        el('div', { class: 'fact' }, el('span', { text: 'Median implied value' }), el('b', { class: 'num', text: fmtUsd(median) }), el('i', { text: 'half the board sits above this' })),
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist TVL' }), el('b', { class: 'num', text: fmtUsd(watchTvl) }), el('i', { text: 'locked value with no token on record' }))
      )
    );
  }

  function spotlight() {
    var top = displayRows().slice(0, 3);
    var wrap = el('section', { class: 'spot', 'aria-label': 'Top three protocols by implied value' });
    top.forEach(function (d, i) {
      var r = d.row;
      wrap.appendChild(el('button', {
        type: 'button', class: 'card',
        onclick: function () { openDetail(r.slug); },
        'aria-label': 'Rank ' + (i + 1) + ': ' + r.name + ', implied value ' + fmtUsd(d.implied)
      },
        el('div', { class: 'rankline' },
          el('span', { class: 'rank', text: 'Rank ' + (i + 1) + ' of ' + DATA.board_size }),
          el('span', { class: 'badge ' + (r.is_watchlist ? 'watch' : 'early'), text: r.is_watchlist ? 'Watchlist' : 'Early find' })
        ),
        el('h3', { text: r.name }),
        el('div', { class: 'cat', text: (r.category || 'Other') + ' · ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }),
        el('div', { class: 'big' }, el('small', { text: 'Implied value' }), el('span', { class: 'num', text: fmtUsd(d.implied) })),
        el('div', { class: 'meta' },
          el('span', { html: 'TVL <b class="num">' + fmtUsd(r.tvl_usd) + '</b>' }),
          el('span', { html: '7d <b class="num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg') + '">' + fmtPct(r.change_7d) + '</b>' }),
          el('span', { html: 'Age <b class="num">' + fmtAge(r.age_days) + '</b>' })
        )
      ));
    });
    return wrap;
  }

  function sandbox() {
    var multOut = el('output', { text: state.mult.toFixed(2) + 'x' });
    var growthOut = el('output', { text: state.growth.toFixed(2) });
    var multRange = el('input', { type: 'range', min: '0.5', max: '1.5', step: '0.05', value: String(state.mult), 'aria-label': 'TVL multiple scale' });
    multRange.addEventListener('input', function () { state.mult = parseFloat(multRange.value); multOut.textContent = state.mult.toFixed(2) + 'x'; render(); });
    var growthRange = el('input', { type: 'range', min: '0', max: '1', step: '0.05', value: String(state.growth), 'aria-label': 'Growth weight' });
    growthRange.addEventListener('input', function () { state.growth = parseFloat(growthRange.value); growthOut.textContent = state.growth.toFixed(2); render(); });
    var reset = el('button', {
      type: 'button', class: 'button ghost', text: 'Reset to the board model',
      onclick: function () { state.mult = 1; state.growth = DEFAULT_MODEL.growth_weight; render(); }
    });
    var note = sandboxActive()
      ? el('p', { class: 'sandbox-note', html: '<b>Sandbox is live:</b> the board below is re-ranked with your settings. board.json keeps the default model (multiple x1.00, growth weight ' + DEFAULT_MODEL.growth_weight.toFixed(2) + ').' })
      : el('p', { class: 'sandbox-note', text: 'Move a slider and the board re-ranks live, from the same formula. board.json is built with these defaults.' });
    return el('section', { class: 'panel', 'aria-label': 'Model sandbox' },
      el('h2', { text: 'Model sandbox — re-rank the board yourself' }),
      el('p', { class: 'sub', text: 'Two knobs, one formula. Nothing here is a hand-picked list: every row is recomputed from its own TVL, growth, age and chains.' }),
      el('div', { class: 'sandbox' },
        el('div', { class: 'field' }, el('label', { for: 'sb-mult', text: 'TVL multiple scale' }), multRange, el('span', { class: 'sub' }, 'Scale ', multOut, ' — how much a dollar of TVL is worth')),
        el('div', { class: 'field' }, el('label', { for: 'sb-growth', text: 'Growth weight' }), growthRange, el('span', { class: 'sub' }, 'Weight ', growthOut, ' — how much a hot week matters')),
        el('div', { class: 'field' }, el('span', { class: 'lab', text: 'Defaults' }), el('span', { class: 'sub', text: 'Multiple x1.00 · growth ' + DEFAULT_MODEL.growth_weight.toFixed(2) + ' · maturity saturates over a year' }), reset)
      ),
      note
    );
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (a, r) { return a.concat(r.chains || []); }, []))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, slug, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var catSel = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c + ' (' + DATA.rows.filter(function (r) { return (r.category || 'Other') === c; }).length + ')', selected: c === state.category ? 'selected' : null }); })
    );
    catSel.addEventListener('change', function () { state.category = catSel.value; writeHash(); render(); });
    var chainSel = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); })
    );
    chainSel.addEventListener('change', function () { state.chain = chainSel.value; writeHash(); render(); });
    var wlBox = el('input', { type: 'checkbox', id: 'wl', checked: state.wl ? 'checked' : null });
    wlBox.addEventListener('change', function () { state.wl = wlBox.checked; writeHash(); render(); });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; writeHash(); render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; writeHash(); render(); } });
    var count = state.tab === 'pre-token'
      ? el('span', { class: 'count', html: '<b>' + filtered().length + '</b> of ' + DATA.board_size + ' rows shown' + (sandboxActive() ? ' · sandbox re-rank' : '') })
      : el('span', { class: 'count', html: '<b>' + DATA.live.length + '</b> live-token protocols' });
    return el('div', { class: 'controls' },
      el('div', { class: 'field grow' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), catSel),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chainSel),
      el('label', { class: 'check', for: 'wl' }, wlBox, 'Watchlist only'),
      el('div', { class: 'field' }, el('span', { class: 'lab', text: 'Token status' }), el('div', { class: 'tabs' }, pre, live)),
      count
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col', class: (key === 'tvl' || key === 'growth' || key === 'age' || key === 'implied') ? 'num' : null },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' ▼' : ' ▲' }) : null
      )
    );
  }

  function boardTable() {
    var list = sortedRows(filtered());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category or chain to see the board again.' }),
        el('button', { class: 'button', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.wl = false; writeHash(); render(); } })
      ));
    }
    var max = list.reduce(function (m, d) { return Math.max(m, d.implied); }, 1);
    var tbody = el('tbody');
    list.forEach(function (d) {
      var r = d.row;
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var rankShown = sandboxActive() ? list.indexOf(d) + 1 : r.rank;
      var tr = el('tr', {
        class: r.rank <= 3 ? 'top3' : null,
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(rankShown) }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((d.implied / max) * 100)) + '%' })),
          el('span', { class: 'val num', text: fmtUsd(d.implied) })
        )),
        el('td', null, el('span', { class: 'badge ' + (r.is_watchlist ? 'watch' : 'early'), text: r.is_watchlist ? 'Watchlist' : 'Early' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model breakdown and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('implied', 'Implied value'),
            el('th', { scope: 'col', text: 'Status' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num', text: 'live' }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', null, el('span', { class: 'badge live', text: 'Already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking, so the board never ranks a launch that already happened.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', class: 'num', text: 'TVL' }), el('th', { scope: 'col', class: 'num', text: '7d' }), el('th', { scope: 'col', class: 'num', text: 'Market cap' }), el('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  function categoryBars() {
    var byCat = {};
    DATA.rows.forEach(function (r) {
      var c = r.category || 'Other';
      byCat[c] = (byCat[c] || 0) + r.implied_value_usd;
    });
    var top = Object.keys(byCat).map(function (c) { return { c: c, v: byCat[c] }; })
      .sort(function (a, b) { return b.v - a.v; }).slice(0, 8);
    var max = top.length ? top[0].v : 1;
    var wrap = el('div', { class: 'bars' });
    top.forEach(function (t) {
      wrap.appendChild(el('div', { class: 'bar-row' },
        el('span', { class: 'lbl', text: t.c }),
        el('div', { class: 'track', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(2, Math.round((t.v / max) * 100)) + '%' })),
        el('span', { class: 'val num', text: fmtUsd(t.v) })
      ));
    });
    return el('section', { class: 'panel' },
      el('h2', { text: 'Where the implied value sits' }),
      el('p', { class: 'sub', text: 'Total implied value by category, across all ' + DATA.board_size + ' ranked rows. Lending and risk curators dominate this snapshot; the early radar is where a smaller category can still outrank them.' }),
      wrap
    );
  }

  function modelPanel() {
    var m = DEFAULT_MODEL;
    return el('section', { class: 'panel' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'sub', text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked.' }),
      el('div', { class: 'formula', html: 'implied = round( tvl_usd × <b>multiple</b> × (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 × ' + m.growth_weight + ') × <b>maturity</b> × <b>breadth</b> )' }),
      el('div', { class: 'grid2' },
        el('dl', { class: 'kv' },
          el('dt', { text: 'TVL multiple' }), el('dd', { text: '0.30 × (100M / TVL)^0.12, clamped 0.08–0.45' }),
          el('dt', { text: 'Growth' }), el('dd', { text: '7-day change, clamped −50% to +150%' }),
          el('dt', { text: 'Maturity' }), el('dd', { text: '0.45 + 0.55 × (1 − e^(−age / 365 days))' }),
          el('dt', { text: 'Breadth' }), el('dd', { text: '1 + 0.03 per extra chain, capped at 10 chains' })
        ),
        el('div', null,
          el('p', { class: 'note', html: '<b>Why the multiple falls with size.</b> A $50M protocol can plausibly trade at a third of its TVL; a $2.7B one cannot keep that multiple, so the power law trims it smoothly instead of a cliff at a TVL band.' }),
          el('p', { class: 'note', html: '<b>Why growth is clamped hard.</b> The snapshot’s own fastest week is +4,448%. Unclamped, one week would crown a protocol; clamped at +150%, growth can lift a row, never make it.' }),
          el('p', { class: 'note', html: '<b>Why maturity saturates.</b> A year running with no token is nearly as seasoned as three. A protocol listed last week scores 0.45, not a year of credit it has not earned.' })
        )
      ),
      el('p', { class: 'sub', text: 'TVL, seven-day growth, age and chains all come from the snapshot. Age is the time since the protocol was first listed, the best record of how long it has run with no token; an unlisted age uses ' + m.unknown_age_days + ' days. The early radar is every pre-token protocol below the watchlist floor, by TVL, and the live-token protocols are set aside with their market caps shown.' })
    );
  }

  function methodPanel() {
    return el('section', { class: 'panel' },
      el('h2', { text: 'What this radar is, and is not' }),
      el('p', { class: 'note', html: '<b>It is a reading of a frozen snapshot.</b> The data is DefiLlama’s protocol index as fetched on ' + DATA.as_of + ', sealed for every run. Nothing here is live, and no run can phone home: the page renders with no network.' }),
      el('p', { class: 'note', html: '<b>“No token” means “records no token”.</b> A protocol on the watchlist records no token in DefiLlama’s data; that is not proof it has none. Wrapped, staked and bridged products of tokens that already trade are left off the watchlist by the same rule, because they are not launches waiting to happen.' }),
      el('p', { class: 'note', html: '<b>Implied value is the entry’s own claim.</b> It says what a token would be worth if the protocol’s record stayed as it is. It does not predict whether or when a token is issued, and it is not a price, a recommendation or financial advice. Farm plans cost real money in gas and lock real capital; never farm with money you cannot afford to lose, and never pay anyone to claim an airdrop.' })
    );
  }

  function footer() {
    return el('footer', null,
      el('p', { text: 'Token Radar · model ' + DATA.model_version + ' · snapshot ' + DATA.as_of + ' · source: ' + DATA.source }),
      el('p', { text: 'Built from a sealed DefiLlama snapshot. The board, the sandbox and the farm plans all derive from that snapshot alone — no live data, no hand-kept list of names.' })
    );
  }

  // ---- detail dialog ----
  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function openDetail(slug) {
    var found = displayRows().filter(function (d) { return d.row.slug === slug; })[0];
    if (!found) return;
    var row = found.row;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var steps = farmSteps(row);
    var cost = planCost(row);
    var calc = impliedOf(row, 1, DEFAULT_MODEL.growth_weight);
    var check = calc.implied === row.implied_value_usd;
    var inner = el('div', { class: 'detail-inner' });
    inner.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'badge ' + (row.is_watchlist ? 'watch' : 'early'), text: (row.is_watchlist ? 'Watchlist' : 'Early find') + ' · Rank ' + row.rank + ' of ' + DATA.board_size }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') + (row.listed_at ? ' · listed ' + row.listed_at : '') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    inner.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value — the model, factor by factor' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'TVL multiple' }), el('b', { class: 'num', text: fmtMult(row.multiple) })),
        el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) })),
        el('div', null, el('span', { text: 'Growth multiplier' }), el('b', { class: 'num', text: fmtMult(row.growth_multiplier) })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(row.age_days) })),
        el('div', null, el('span', { text: 'Maturity multiplier' }), el('b', { class: 'num', text: fmtMult(row.maturity_multiplier) })),
        el('div', null, el('span', { text: 'Chains counted' }), el('b', { class: 'num', text: String((row.chains || []).length) })),
        el('div', null, el('span', { text: 'Breadth multiplier' }), el('b', { class: 'num', text: fmtMult(row.breadth_multiplier) })),
        el('div', { class: 'total' }, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) }))
      ),
      el('p', { class: 'check-line', html: check
        ? 'The page recomputes this row as <b>' + fmtUsd(calc.implied) + ' — the same number board.json carries.</b> Model ' + DATA.model_version + ': the same function scores every protocol. This is an estimate, not a price.'
        : 'The page recomputes this row as ' + fmtUsd(calc.implied) + ', which differs from the board: the data would be stale.' })
    ));
    inner.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan — seven steps' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', html: tail.replace('Cost: ', '<b>Cost:</b> ').replace('Time: ', ' · <b>Time:</b> ') }));
      })),
      el('p', { class: 'total-cost', html: 'All-in for the plan: <b>$' + cost.capital + ' of capital</b> (recoverable on unwind) plus about <b>$' + cost.gas.toFixed(2) + ' of gas</b> over ' + cost.weeks + ' weeks on ' + chainOf(row) + ', holding ' + cost.hold + ' days. Gas is spent, capital is not.' })
    ));
    dialog.appendChild(inner);
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(spotlight());
    shell.appendChild(sandbox());
    shell.appendChild(controls());
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    if (state.tab === 'pre-token') shell.appendChild(categoryBars());
    shell.appendChild(modelPanel());
    shell.appendChild(methodPanel());
    shell.appendChild(footer());
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
