// LaunchLens page: renders the board from data.js (LL), filters and sorts it,
// and opens a detail view per protocol with its value breakdown and farm plan.
// Row layout: 0 slug, 1 name, 2 category index, 3 chain indices, 4 tvl_usd,
// 5 change_7d, 6 implied_value_usd, 7 age in days (-1 unknown), 8 watchlist,
// 9 base_usd, 10 momentum x1000, 11 age factor x1000. Rank is the row's
// position + 1: rows arrive sorted by implied value descending.
(function () {
  'use strict';
  var R = LL.rows, CATS = LL.cats, CHAINS = LL.chains;
  var state = { q: '', cat: '', chain: '', wl: false, min: 0, sort: 'rank', dir: 1 };

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function money(v) {
    if (v >= 1e9) return '$' + (v / 1e9).toFixed(1) + 'B';
    if (v >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M';
    if (v >= 1e3) return '$' + Math.round(v / 1e3) + 'K';
    return '$' + v;
  }
  function dollars(v) { return '$' + v.toLocaleString('en-US'); }
  function ageText(days) {
    if (days < 0) return '—';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return days + 'd';
  }
  function fill(t, name, c, d) {
    return t.split('{n}').join(name).split('{c}').join(c).split('{d}').join(d);
  }
  // The farm plan for a row: the same templates board.json carries, filled
  // with the protocol's own name and chains.
  function farmPlan(row) {
    var cat = CATS[row[2]], name = row[1];
    var chains = row[3].map(function (i) { return CHAINS[i]; });
    var fam = LL.fam[cat] || 'generic';
    var tpl = LL.tpl[fam] || LL.tpl.generic;
    var c = chains[0] || 'Ethereum', d = chains[1] || '';
    var steps = tpl.map(function (t) { return fill(t, name, c, d); });
    steps.push(fill(chains.length >= 2 ? LL.multi : LL.single, name, c, d));
    return steps;
  }

  function matches(row) {
    if (state.q) {
      var q = state.q;
      if (row[1].toLowerCase().indexOf(q) < 0 && row[0].toLowerCase().indexOf(q) < 0) return false;
    }
    if (state.cat !== '' && row[2] !== Number(state.cat)) return false;
    if (state.chain !== '' && row[3].indexOf(Number(state.chain)) < 0) return false;
    if (state.wl && row[8] !== 1) return false;
    if (row[4] < state.min) return false;
    return true;
  }
  function sortVal(row, i) {
    if (state.sort === 'rank') return i;
    if (state.sort === 'tvl') return row[4];
    if (state.sort === 'chg') return row[5] === null ? -Infinity : row[5];
    if (state.sort === 'implied') return row[6];
    if (state.sort === 'age') return row[7];
    return i;
  }
  function filtered() {
    var out = [];
    for (var i = 0; i < R.length; i++) if (matches(R[i])) out.push([R[i], i]);
    var dir = state.dir;
    out.sort(function (a, b) {
      var d = (sortVal(a[0], a[1]) - sortVal(b[0], b[1])) * dir;
      return d !== 0 ? d : a[1] - b[1];
    });
    return out;
  }

  function rowHtml(pair) {
    var row = pair[0], rank = pair[1] + 1;
    var chg = row[5] === null ? '<td class="num">—</td>'
      : '<td class="num ' + (row[5] >= 0 ? 'up' : 'down') + '">' + (row[5] >= 0 ? '+' : '') + row[5].toFixed(1) + '%</td>';
    var chains = row[3].slice(0, 3).map(function (i) { return CHAINS[i]; });
    var extra = row[3].length > 3 ? ' +' + (row[3].length - 3) : '';
    var mult = row[9] / row[4];
    return '<tr data-slug="' + esc(row[0]) + '"><td class="num">' + rank + '</td>' +
      '<td><b>' + esc(row[1]) + '</b>' + (row[8] === 1 ? '<span class="badge">WATCHLIST</span>' : '') +
      '<br><span class="slug">' + esc(row[0]) + '</span></td>' +
      '<td>' + esc(CATS[row[2]]) + '</td>' +
      '<td class="chains">' + esc(chains.join(', ')) + esc(extra) + '</td>' +
      '<td class="num">' + money(row[4]) + '</td>' +
      '<td class="num">&times;' + mult.toFixed(3) + '</td>' + chg +
      '<td class="num implied">' + money(row[6]) + '</td>' +
      '<td class="num">' + ageText(row[7]) + '</td></tr>';
  }

  function render() {
    var list = filtered();
    var html = '';
    for (var i = 0; i < list.length; i++) html += rowHtml(list[i]);
    document.getElementById('rows').innerHTML = html || '<tr><td colspan="9">No protocols match these filters.</td></tr>';
    document.getElementById('count').textContent = 'Showing ' + list.length + ' of ' + R.length;
    var btns = document.querySelectorAll('th button');
    for (var j = 0; j < btns.length; j++) {
      var b = btns[j], on = b.getAttribute('data-sort') === state.sort;
      b.classList.toggle('sorted', on);
      b.textContent = b.textContent.replace(/ [▲▼]$/, '') + (on ? (state.dir === 1 ? ' ▲' : ' ▼') : '');
    }
  }

  function openDetail(slug) {
    var idx = -1;
    for (var i = 0; i < R.length; i++) if (R[i][0] === slug) { idx = i; break; }
    if (idx < 0) return;
    var row = R[idx];
    var cat = CATS[row[2]];
    var chains = row[3].map(function (k) { return CHAINS[k]; });
    var mult = row[9] / row[4];
    var mom = row[10] / 1000, age = row[11] / 1000;
    var chg = row[5] === null ? 'not reported' : (row[5] >= 0 ? '+' : '') + row[5].toFixed(2) + '% over 7 days';
    var steps = farmPlan(row).map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('');
    var momPct = Math.round(((mom - 0.7) / 0.6) * 100);
    var agePct = Math.round(((age - 1) / 0.3) * 100);
    var multPct = Math.min(100, Math.round(mult * 100));
    var n = LL.catn[row[2]];
    var calNote = n >= 3
      ? 'The &times;' + mult.toFixed(3) + ' multiple is the median market-cap/TVL of the ' + n + ' tokenised ' + esc(cat) + ' protocols in this snapshot.'
      : 'Fewer than three tokenised ' + esc(cat) + ' protocols exist in this snapshot, so the &times;' + mult.toFixed(3) + ' multiple falls back to the global median across all tokenised protocols.';
    var peers = [];
    for (var p = 0; p < R.length && peers.length < 3; p++) {
      if (p !== idx && R[p][2] === row[2]) peers.push('#' + (p + 1) + ' ' + esc(R[p][1]) + ' (' + money(R[p][6]) + ')');
    }
    document.getElementById('detail').innerHTML =
      '<button class="close" id="closeBtn">Close ✕</button>' +
      '<h2>' + esc(row[1]) + (row[8] === 1 ? '<span class="badge">WATCHLIST</span>' : '') + '</h2>' +
      '<p class="sub">Rank ' + (idx + 1) + ' of ' + R.length + ' &middot; ' + esc(row[0]) + ' &middot; records no token</p>' +
      '<dl><dt>Category</dt><dd>' + esc(cat) + '</dd>' +
      '<dt>Chains</dt><dd>' + esc(chains.join(', ')) + '</dd>' +
      '<dt>TVL</dt><dd>' + dollars(row[4]) + '</dd>' +
      '<dt>7-day change</dt><dd>' + esc(chg) + '</dd>' +
      '<dt>Age tracked</dt><dd>' + (row[7] < 0 ? 'listing date not reported' : row[7] + ' days') + '</dd></dl>' +
      '<h3>Value breakdown</h3>' +
      '<p class="break">Base ' + dollars(row[9]) + ' (TVL &times; ' + mult.toFixed(3) + ' ' + esc(cat) +
      ' multiple) &times; momentum ' + mom.toFixed(2) + ' &times; age ' + age.toFixed(2) +
      ' = <span class="tot">' + dollars(row[6]) + ' implied value</span></p>' +
      '<div class="bar-row"><span class="lbl">Category multiple</span><span class="bar"><i style="width:' + multPct + '%"></i></span><span class="val">&times;' + mult.toFixed(3) + '</span></div>' +
      '<div class="bar-row"><span class="lbl">Momentum (7d)</span><span class="bar"><i class="amb" style="width:' + momPct + '%"></i></span><span class="val">' + mom.toFixed(2) + '&times;</span></div>' +
      '<div class="bar-row"><span class="lbl">Age factor</span><span class="bar"><i class="tel" style="width:' + agePct + '%"></i></span><span class="val">' + age.toFixed(2) + '&times;</span></div>' +
      '<p class="calnote">' + calNote + '</p>' +
      (peers.length ? '<p class="peers">Peers in ' + esc(cat) + ': ' + peers.join(' · ') + '</p>' : '') +
      '<h3>Farm plan</h3><ol>' + steps + '</ol>';
    document.getElementById('overlay').hidden = false;
    document.getElementById('closeBtn').addEventListener('click', closeDetail);
  }
  function closeDetail() { document.getElementById('overlay').hidden = true; }

  function fillSelect(el, items) {
    var opts = items.map(function (name, i) { return [name, i]; });
    opts.sort(function (a, b) { return a[0] < b[0] ? -1 : 1; });
    for (var i = 0; i < opts.length; i++) {
      var o = document.createElement('option');
      o.value = opts[i][1]; o.textContent = opts[i][0];
      el.appendChild(o);
    }
  }
  fillSelect(document.getElementById('cat'), CATS);
  fillSelect(document.getElementById('chain'), CHAINS);

  document.getElementById('meta').innerHTML =
    'Snapshot <b>' + esc(LL.a) + '</b><br><b>' + LL.t + '</b> protocols tracked &middot; <b>' + LL.w +
    '</b> watchlist<br><b>' + R.length + '</b> launch candidates on the board';

  document.getElementById('q').addEventListener('input', function (e) {
    state.q = e.target.value.trim().toLowerCase(); render();
  });
  document.getElementById('cat').addEventListener('change', function (e) { state.cat = e.target.value; render(); });
  document.getElementById('chain').addEventListener('change', function (e) { state.chain = e.target.value; render(); });
  document.getElementById('wl').addEventListener('change', function (e) { state.wl = e.target.checked; render(); });
  document.getElementById('mintvl').addEventListener('input', function (e) {
    state.min = Number(e.target.value) || 0; render();
  });
  var sortBtns = document.querySelectorAll('th button');
  for (var k = 0; k < sortBtns.length; k++) {
    sortBtns[k].addEventListener('click', function (e) {
      var key = e.target.getAttribute('data-sort');
      if (state.sort === key) state.dir = -state.dir;
      else { state.sort = key; state.dir = key === 'rank' ? 1 : -1; }
      render();
    });
  }
  document.getElementById('rows').addEventListener('click', function (e) {
    var tr = e.target.closest('tr[data-slug]');
    if (tr) openDetail(tr.getAttribute('data-slug'));
  });
  document.getElementById('overlay').addEventListener('click', function (e) {
    if (e.target.id === 'overlay') closeDetail();
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeDetail(); });

  render();
})();
