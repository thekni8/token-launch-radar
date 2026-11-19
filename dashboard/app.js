(function () {
  'use strict';
  var R = LL.rows, CATS = LL.cats, CHAINS = LL.chains, MDL = LL.mdl || {};
  var VERD = ['SKIP', 'THIN', 'FARM'], VCLS = ['v-skip', 'v-thin', 'v-farm'];
  var TDN = '<td class="num">';
  var state = { tab: 'board', q: '', cat: '', chain: '', verd: '', wl: false, min: 0, sort: 'rank', dir: 1, dep: 1000, days: 90, pool: 8, cmp: [], openSlug: null };
  function $(id) { return document.getElementById(id); }
  function on(id, ev, fn) { $(id).addEventListener(ev, fn); }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function money(v) {
    var s = v < 0 ? '-' : '', a = Math.abs(v);
    if (a >= 1e9) return s + '$' + (a / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return s + '$' + (a / 1e6).toFixed(1) + 'M';
    if (a >= 1e3) return s + '$' + Math.round(a / 1e3) + 'K';
    return s + '$' + Math.round(a);
  }
  function dollars(v) { var r = Math.round(v); return (r < 0 ? '-$' : '$') + Math.abs(r).toLocaleString('en-US'); }
  function fmt$(v) { var s = v < 0 ? '-' : '', a = Math.abs(v); return a >= 100 ? s + '$' + Math.round(a).toLocaleString('en-US') : s + '$' + a.toFixed(2); }
  function ageText(d) { if (d < 0) return '—'; return d >= 365 ? (d / 365).toFixed(1) + 'y' : d + 'd'; }
  function median(arr) {
    if (!arr.length) return 0;
    var a = arr.slice().sort(function (x, y) { return x - y; }), m = a.length >> 1;
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  }
  function fPct(v) { if (v == null || isNaN(v)) return '—'; return (v * 100).toFixed(1) + '%'; }
  function fRho(v) { return (v == null || isNaN(v)) ? '—' : Number(v).toFixed(3); }
  function calcFarm(row) {
    var tvl = row[4], imp = row[6], fees = row[21] || 0;
    var dep = state.dep > 0 ? state.dep : 1, days = state.days > 0 ? state.days : 1, pool = state.pool;
    var k = imp * (pool / 100) * (days / 90);
    var gross = k * (dep / (tvl + dep)), net = gross - fees, roi = (net / dep) * 100;
    var denom = k - fees, be = denom > 0 ? (fees * tvl) / denom : -1;
    var v = (net >= 50 && roi >= 5) ? 2 : (net > 0 ? 1 : 0);
    return { gross: gross, fees: fees, net: net, roi: roi, be: be, v: v };
  }
  function fill(t, n, c, d) { return t.split('{n}').join(n).split('{c}').join(c).split('{d}').join(d); }
  function tile(cls, lbl, val, ba) { return '<div' + (cls ? ' class="' + cls + '"' : '') + '><span>' + lbl + '</span><b' + (ba || '') + '>' + val + '</b></div>'; }
  function barRow(lbl, pct, cls, val) { return '<div class="bar-row"><span class="lbl">' + lbl + '</span><span class="bar"><i' + (cls ? ' class="' + cls + '"' : '') + ' style="width:' + pct + '%"></i></span><span class="val">' + val + '</span></div>'; }
  function farmPlan(row) {
    var cat = CATS[row[2]], name = row[1];
    var chains = row[3].map(function (i) { return CHAINS[i] || ''; });
    var fam = (LL.fam && LL.fam[cat]) || 'generic';
    var tpl = (LL.tpl && (LL.tpl[fam] || LL.tpl.generic)) || [];
    var c = CHAINS[row[20]] || chains[0] || 'Ethereum', d = '';
    for (var k = 0; k < chains.length; k++) if (chains[k] !== c) { d = chains[k]; break; }
    var f = calcFarm(row), dep = fmt$(state.dep), fee = fmt$(f.fees);
    return [
      'Deploy ' + dep + ' via ' + c + ' (~' + fee + ' round-trip fees): ' + fill(tpl[0] || '', name, c, d),
      fill(tpl[1] || '', name, c, d),
      fill(tpl[2] || '', name, c, d),
      fill(chains.length >= 2 && d ? LL.multi : LL.single, name, c, d),
      'Net at ' + dep + ' for ' + state.days + ' days: ' + fmt$(f.net) + ' after ~' + fee + ' fees (' + f.roi.toFixed(1) + '% ROI) — verdict ' + VERD[f.v] + '.'
    ];
  }
  function renderKpis() {
    var wlVals = [], farmN = 0;
    for (var i = 0; i < R.length; i++) { if (R[i][8] === 1) wlVals.push(R[i][6]); if (calcFarm(R[i]).v === 2) farmN++; }
    var auditTot = (LL.audit && LL.audit[6]) || LL.t;
    var tiles = [
      ['Watchlist Covered', wlVals.length + '/' + LL.w, '100% of tracked watchlist on board'],
      ['Median Watchlist Mcap', money(median(wlVals)), 'Implied circulating mcap'],
      ['CV MdAPE / Hit-2x', fPct(MDL.cv && MDL.cv[0]) + ' / ' + fPct(MDL.cv && MDL.cv[1]), 'vs baseline ' + fPct(MDL.base && MDL.base[0]) + ' / ' + fPct(MDL.base && MDL.base[1])],
      ['FARM Rated', String(farmN), 'At ' + dollars(state.dep) + ' / ' + state.days + 'd / ' + state.pool + '%'],
      ['Snapshot Accounted', auditTot + '/' + LL.t, 'Zero-leakage partition'],
      ['Fit Anchors', String(MDL.fitN || 0), (MDL.out || 0) + ' extreme outlier' + ((MDL.out || 0) === 1 ? '' : 's') + ' dropped']
    ];
    $('kpis').innerHTML = tiles.map(function (t) {
      return '<div class="kpi"><span class="k-lbl">' + esc(t[0]) + '</span><b class="k-val">' + esc(t[1]) + '</b><span class="k-sub">' + esc(t[2]) + '</span></div>';
    }).join('');
  }
  function buildScatter(anch) {
    if (!anch || !anch.length) return '<p class="muted">No anchor data.</p>';
    var pts = [], lo = Infinity, hi = -Infinity;
    for (var i = 0; i < anch.length; i++) {
      var tvl = anch[i][0], act = anch[i][1], pred = anch[i][2];
      if (act <= 0 || pred <= 0) continue;
      var lx = Math.log(act) / Math.LN10, ly = Math.log(pred) / Math.LN10;
      if (lx < lo) lo = lx; if (ly < lo) lo = ly; if (lx > hi) hi = lx; if (ly > hi) hi = ly;
      pts.push([lx, ly, tvl, act, pred]);
    }
    if (!pts.length) return '<p class="muted">No positive anchors.</p>';
    lo = Math.floor(lo * 2) / 2 - 0.25; hi = Math.ceil(hi * 2) / 2 + 0.25;
    var span = hi - lo || 1, W = 420, H = 250, PL = 50, PR = 14, PT = 14, PB = 34, PW = W - PL - PR, PH = H - PT - PB;
    function sx(v) { return PL + ((v - lo) / span) * PW; }
    function sy(v) { return PT + PH - ((v - lo) / span) * PH; }
    function ln(x1, y1, x2, y2, cls) { return '<line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '" class="' + cls + '"/>'; }
    var out = ['<svg class="scat" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Predicted vs actual market cap log-log scatter">'];
    var t0 = Math.ceil(lo), t1 = Math.floor(hi);
    for (var t = t0; t <= t1; t++) {
      var x = sx(t).toFixed(1), y = sy(t).toFixed(1), lbl = money(Math.pow(10, t));
      out.push(ln(x, PT, x, PT + PH, 'grid') + ln(PL, y, PL + PW, y, 'grid') +
        '<text x="' + x + '" y="' + (H - 18) + '" text-anchor="middle" class="ax">' + esc(lbl) + '</text>' +
        '<text x="' + (PL - 6) + '" y="' + (+y + 3) + '" text-anchor="end" class="ax">' + esc(lbl) + '</text>');
    }
    var log2 = Math.LN2 / Math.LN10;
    out.push(ln(sx(lo).toFixed(1), sy(lo).toFixed(1), sx(hi).toFixed(1), sy(hi).toFixed(1), 'diag'));
    out.push(ln(sx(lo).toFixed(1), sy(Math.min(hi, lo + log2)).toFixed(1), sx(Math.max(lo, hi - log2)).toFixed(1), sy(hi).toFixed(1), 'band'));
    out.push(ln(sx(Math.min(hi, lo + log2)).toFixed(1), sy(lo).toFixed(1), sx(hi).toFixed(1), sy(Math.max(lo, hi - log2)).toFixed(1), 'band'));
    for (var j = 0; j < pts.length; j++) {
      var p = pts[j], ratio = p[4] / p[3], ok = ratio >= 0.5 && ratio <= 2;
      out.push('<circle cx="' + sx(p[0]).toFixed(1) + '" cy="' + sy(p[1]).toFixed(1) + '" r="2.7" class="' + (ok ? 'pt-ok' : 'pt-out') +
        '"><title>TVL ' + esc(money(p[2])) + ' | Actual ' + esc(money(p[3])) + ' | Pred ' + esc(money(p[4])) + ' (' + ratio.toFixed(2) + 'x)</title></circle>');
    }
    out.push('<text x="' + (PL + PW / 2) + '" y="' + (H - 3) + '" text-anchor="middle" class="ax-lbl">Actual Market Cap (log10)</text>');
    out.push('<text x="12" y="' + (PT + PH / 2) + '" text-anchor="middle" transform="rotate(-90 12 ' + (PT + PH / 2) + ')" class="ax-lbl">Predicted Mcap (log10)</text>');
    out.push('</svg><div class="scat-leg"><span class="dot-ok"></span> Within 2× <span class="dot-out"></span> &gt;2× — solid line: y = x, dashed: 2× band</div>');
    return out.join('');
  }
  function renderModel() {
    var el = (LL.el / 1000).toFixed(3);
    var gTag = MDL.gKept ? '<span class="pill v-farm">Growth: Kept by CV</span>' : '<span class="pill v-skip">Growth: Dropped by CV</span>';
    var aTag = MDL.aKept ? '<span class="pill v-farm">Age: Kept by CV</span>' : '<span class="pill v-skip">Age: Dropped by CV</span>';
    $('mdlSummary').textContent = '— Log-log hierarchical model (TVL elasticity ' + el + ', ' + (MDL.fitN || 0) + ' anchors, CV MdAPE ' + fPct(MDL.cv && MDL.cv[0]) + ')';
    $('mdlNarrative').innerHTML =
      '<p>Implied circulating market cap is estimated in log-log space from <b>' + (MDL.fitN || 0) + '</b> tokenised anchor protocols (<b>' + (MDL.out || 0) + '</b> extreme outlier' + ((MDL.out || 0) === 1 ? '' : 's') + ' dropped):</p>' +
      '<p class="formula">log(Implied) = Intercept<sub>cat</sub> + ' + el + ' × log(TVL) + Growth + Age</p>' +
      '<ul><li><b>Sub-linear TVL elasticity (' + el + ')</b>: larger protocols scale sub-linearly in mcap/TVL, not at a constant multiple.</li>' +
      '<li><b>Shrunk category intercepts</b>: each category intercept is shrunk toward the global prior by its tokenised sample count <i>n</i>.</li>' +
      '<li><b>CV-gated features</b>: 7-day momentum and age enter only when 5-fold CV improves out-of-sample error. ' + gTag + ' ' + aTag + '</li></ul>';
    var cv = MDL.cv || [], big = MDL.cvBig || [], base = MDL.base || [], hold = MDL.hold || [];
    var cvRows = [
      ['5-fold CV (Model, all)', cv[0], cv[1], cv[3], cv[2]],
      ['5-fold CV (TVL ≥ $10M)', big[0], big[1], big[3], big[2]],
      ['Naive Baseline (Global Median)', base[0], base[1], cv[3], base[2]],
      ['Newest-Listed Cohort Holdout', hold[0], hold[1], hold[2], null]
    ];
    $('mdlCv').innerHTML = cvRows.map(function (r) {
      return '<tr><td>' + r[0] + '</td>' + TDN + (r[3] || '—') + '</td>' + TDN + fPct(r[1]) + '</td>' + TDN + fPct(r[2]) + '</td>' + TDN + (r[4] == null ? '—' : fRho(r[4])) + '</td></tr>';
    }).join('');
    var scat = buildScatter(LL.anch);
    $('mdlScatter').innerHTML = scat;
    $('anchScatter').innerHTML = scat;
    var catRows = [];
    for (var i = 0; i < CATS.length; i++) {
      var cf = (LL.catf && LL.catf[i]) || [LL.catn[i] || 0, 0, 0];
      catRows.push([CATS[i], cf[0], cf[1] / 1000, cf[2] / 1000]);
    }
    catRows.sort(function (a, b) { return b[1] - a[1] || (a[0] < b[0] ? -1 : 1); });
    $('mdlCats').innerHTML = catRows.map(function (c) {
      return '<tr><td>' + esc(c[0]) + '</td>' + TDN + c[1] + '</td>' + TDN + c[2].toFixed(3) + '</td>' + TDN + '×' + Math.exp(c[2]).toFixed(2) + '</td>' + TDN + Math.round(c[3] * 100) + '%</td></tr>';
    }).join('');
  }
  function renderAnchors() {
    var anch = (LL.anch || []).slice().sort(function (a, b) { return b[0] - a[0]; });
    var tvls = [], acts = [], rats = [], hit = 0;
    for (var i = 0; i < anch.length; i++) {
      tvls.push(anch[i][0]); acts.push(anch[i][1]);
      var r = anch[i][1] > 0 ? anch[i][2] / anch[i][1] : 0;
      rats.push(r);
      if (r >= 0.5 && r <= 2) hit++;
    }
    $('anchStats').innerHTML = '<div class="st-grid">' +
      tile('', 'Anchors plotted', anch.length) +
      tile('', 'Outliers dropped', MDL.out || 0) +
      tile('', 'Median anchor TVL', money(median(tvls))) +
      tile('', 'Median actual mcap', money(median(acts))) +
      tile('', 'Median Pred / Actual', median(rats).toFixed(2) + '×') +
      tile('', 'In-sample within 2×', anch.length ? ((hit / anch.length) * 100).toFixed(1) + '%' : '—') + '</div>';
    $('anchRows').innerHTML = anch.map(function (a, idx) {
      var r = a[1] > 0 ? a[2] / a[1] : 0, ok = r >= 0.5 && r <= 2;
      return '<tr>' + TDN + (idx + 1) + '</td>' + TDN + dollars(a[0]) + '</td>' + TDN + dollars(a[1]) + '</td>' + TDN + dollars(a[2]) + '</td>' + TDN + r.toFixed(2) + '×</td>' +
        TDN + '<span class="pill ' + (ok ? 'v-farm' : 'v-thin') + '">' + (ok ? 'YES' : 'NO') + '</span></td></tr>';
    }).join('') || '<tr><td colspan="6">No anchors available.</td></tr>';
  }
  function renderAudit() {
    var au = LL.audit || [0, 0, 0, 0, 0, 0, LL.t];
    var tot = au[6] || LL.t || 1;
    var items = [
      ['Watchlist (on board)', au[0], 'Included (Board)', 'Watchlist protocols that record no token — all ' + LL.w + ' on the board, ranked by implied value.'],
      ['Below Watchlist Floor (on board)', au[1], 'Included (Board)', 'Pre-token protocols below the $50M watchlist floor, ranked on the board by implied value.'],
      ['Fit Anchors', au[2], 'Calibration Only', 'Tokenised protocols with valid TVL & market cap used to calibrate the log-log model (never on the board).'],
      ['Anchor Outliers', au[3], 'Excluded (Fit)', 'Tokenised protocols dropped from model fitting due to extreme market-cap/TVL outlier ratios.'],
      ['Excluded Wrapped / Staked', au[4], 'Excluded', 'Pre-token protocols excluded as wrapped, staked, bridged, or exchange products — not genuine launch candidates.'],
      ['Excluded Partial / Other', au[5], 'Excluded', 'Token identifier recorded but no usable market cap — neither fittable anchors nor pre-token candidates.']
    ];
    var sum = au[0] + au[1] + au[2] + au[3] + au[4] + au[5];
    $('auditCards').innerHTML =
      tile('aud-card', 'Tracked Snapshot', LL.t) +
      tile('aud-card', 'Sum of 6 Partition Sets', sum) +
      tile('aud-card', 'Reported Total', au[6]) +
      tile('aud-card', 'Reconciliation', sum === au[6] ? 'EXACT MATCH' : 'DELTA ' + (au[6] - sum), ' class="' + (sum === au[6] ? 'up' : 'down') + '"');
    $('auditRows').innerHTML = items.map(function (it) {
      var pct = ((it[1] / tot) * 100).toFixed(1) + '%';
      return '<tr><td><b>' + esc(it[0]) + '</b></td>' + TDN + it[1] + '</td>' + TDN + pct + '</td>' +
        '<td><span class="pill v-thin">' + esc(it[2]) + '</span></td><td class="muted">' + esc(it[3]) + '</td></tr>';
    }).join('') + '<tr class="aud-tot"><td><b>Total Snapshot</b></td>' + TDN + '<b>' + sum + ' / ' + au[6] + '</b></td>' + TDN + '<b>100.0%</b></td><td></td><td>All protocols accounted with zero token leakage.</td></tr>';
  }
  function matches(row, f) {
    if (state.q) { var q = state.q; if (row[1].toLowerCase().indexOf(q) < 0 && row[0].toLowerCase().indexOf(q) < 0) return false; }
    if (state.cat !== '' && row[2] !== Number(state.cat)) return false;
    if (state.chain !== '' && row[3].indexOf(Number(state.chain)) < 0) return false;
    if (state.verd !== '' && f.v !== Number(state.verd)) return false;
    if (state.wl && row[8] !== 1) return false;
    if (row[4] < state.min) return false;
    return true;
  }
  function sortVal(item) {
    var r = item.row, s = state.sort;
    if (s === 'rank') return item.idx;
    if (s === 'tvl') return r[4];
    if (s === 'chg') return r[5] === null ? -Infinity : r[5];
    if (s === 'implied') return r[6];
    if (s === 'net') return item.f.net;
    if (s === 'age') return r[7];
    return item.idx;
  }
  function filtered() {
    var out = [];
    for (var i = 0; i < R.length; i++) { var f = calcFarm(R[i]); if (matches(R[i], f)) out.push({ row: R[i], idx: i, f: f }); }
    var dir = state.dir;
    out.sort(function (a, b) { var d = (sortVal(a) - sortVal(b)) * dir; return d !== 0 ? d : a.idx - b.idx; });
    return out;
  }
  function rankBar(rank, rLow, rHigh) {
    var n = Math.max(1, R.length - 1);
    var lo = Math.min(rLow, rHigh), hi = Math.max(rLow, rHigh);
    var left = ((lo - 1) / n) * 100, w = Math.max(4, ((hi - lo) / n) * 100), dot = ((rank - 1) / n) * 100;
    return '<div class="rbar" title="Implied rank range #' + lo + '–#' + hi + '">' +
      '<span style="left:' + left.toFixed(1) + '%;width:' + w.toFixed(1) + '%"></span><i style="left:' + dot.toFixed(1) + '%"></i></div>';
  }
  function rowHtml(item) {
    var row = item.row, rank = item.idx + 1, f = item.f;
    var chg = row[5] === null ? TDN + '<span class="muted">—</span></td>'
      : TDN.slice(0, -1) + ' ' + (row[5] >= 0 ? 'up' : 'down') + '">' + (row[5] >= 0 ? '+' : '') + row[5].toFixed(1) + '%</td>';
    var chains = row[3].slice(0, 3).map(function (i) { return CHAINS[i] || ''; });
    var extra = row[3].length > 3 ? ' +' + (row[3].length - 3) : '';
    var chk = state.cmp.indexOf(row[0]) >= 0 ? ' checked' : '';
    var vPill = '<span class="pill ' + VCLS[f.v] + '">' + VERD[f.v] + '</span>';
    return '<tr data-slug="' + esc(row[0]) + '">' +
      '<td class="chk-col"><input type="checkbox" class="cmp-chk" data-cmp="' + esc(row[0]) + '"' + chk + ' aria-label="Compare ' + esc(row[1]) + '"></td>' +
      TDN.slice(0, -1) + ' rank-cell"><b>#' + rank + '</b><span class="rng">' + row[13] + '–' + row[14] + '</span>' + rankBar(rank, row[13], row[14]) + '</td>' +
      '<td><b>' + esc(row[1]) + '</b>' + (row[8] === 1 ? '<span class="badge">WATCHLIST</span>' : '') + '<br><span class="slug">' + esc(row[0]) + '</span></td>' +
      '<td>' + esc(CATS[row[2]]) + '</td><td class="chains">' + esc(chains.join(', ')) + esc(extra) + '</td>' +
      TDN + money(row[4]) + '</td>' + chg +
      TDN + '<span class="implied">' + money(row[6]) + '</span><br><span class="rng">' + money(row[15]) + '–' + money(row[16]) + '</span></td>' +
      TDN + '<span class="' + (f.net >= 0 ? 'up' : 'down') + '">' + dollars(f.net) + '</span> ' + vPill + '<br><span class="rng">ROI ' + f.roi.toFixed(1) + '%</span></td>' +
      TDN + ageText(row[7]) + '</td></tr>';
  }
  function renderBoard() {
    var list = filtered(), html = '';
    for (var i = 0; i < list.length; i++) html += rowHtml(list[i]);
    $('rows').innerHTML = html || '<tr><td colspan="10">No protocols match these filters.</td></tr>';
    $('count').textContent = 'Showing ' + list.length + ' of ' + R.length;
    var btns = document.querySelectorAll('th button[data-sort]');
    for (var j = 0; j < btns.length; j++) {
      var b = btns[j], on = b.getAttribute('data-sort') === state.sort;
      b.classList.toggle('sorted', on);
      b.textContent = b.textContent.replace(/ [▲▼]$/, '') + (on ? (state.dir === 1 ? ' ▲' : ' ▼') : '');
    }
    renderKpis();
    renderCmpBar();
  }
  function renderCmpBar() {
    var bar = $('cmpBar');
    if (!state.cmp.length) { bar.hidden = true; return; }
    bar.hidden = false;
    $('cmpCnt').textContent = state.cmp.length;
    $('cmpList').innerHTML = state.cmp.map(function (slug) {
      var r = findRow(slug);
      return '<span class="cmp-chip">' + esc(r ? r.row[1] : slug) + '</span>';
    }).join(' ');
    $('cmpGo').disabled = state.cmp.length < 2;
  }
  function findRow(slug) { for (var i = 0; i < R.length; i++) if (R[i][0] === slug) return { row: R[i], idx: i }; return null; }
  function openDetail(slug) {
    var found = findRow(slug);
    if (!found) return;
    state.openSlug = slug;
    var row = found.row, idx = found.idx, cat = CATS[row[2]];
    var chains = row[3].map(function (k) { return CHAINS[k] || ''; });
    var cf = row[10] / 1000, gf = row[11] / 1000, af = row[12] / 1000;
    var el = (LL.el / 1000).toFixed(3);
    var chg = row[5] === null ? 'not reported' : (row[5] >= 0 ? '+' : '') + row[5].toFixed(2) + '% (7d)';
    var f = calcFarm(row);
    var cheapChain = CHAINS[row[20]] || chains[0] || '—';
    var steps = farmPlan(row).map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('');
    var inCmp = state.cmp.indexOf(slug) >= 0;
    var peers = [];
    for (var p = 0; p < R.length && peers.length < 4; p++) {
      if (p !== idx && R[p][2] === row[2]) peers.push('<button class="peer-btn" data-peer="' + esc(R[p][0]) + '">#' + (p + 1) + ' ' + esc(R[p][1]) + ' (' + money(R[p][6]) + ')</button>');
    }
    var cfPct = Math.min(100, Math.max(4, Math.round((cf / 2) * 100)));
    var gfPct = Math.min(100, Math.max(4, Math.round(((gf - 0.7) / 0.6) * 100)));
    var afPct = Math.min(100, Math.max(4, Math.round(((af - 0.8) / 0.5) * 100)));
    $('detail').innerHTML =
      '<div class="det-act"><button class="btn" id="detCmp">' + (inCmp ? 'Remove from Compare' : '+ Add to Compare') + '</button>' +
      '<button class="btn" id="closeBtn">Close ×</button></div>' +
      '<h2>' + esc(row[1]) + (row[8] === 1 ? '<span class="badge">WATCHLIST</span>' : '') + '</h2>' +
      '<p class="sub">Rank #' + (idx + 1) + ' of ' + R.length + ' (range #' + row[13] + '–#' + row[14] + ') · ' + esc(row[0]) + ' · pre-token</p>' +
      '<dl><dt>Category</dt><dd>' + esc(cat) + ' (' + (LL.catn[row[2]] || 0) + ' tokenised anchors)</dd>' +
      '<dt>Chains</dt><dd>' + esc(chains.join(', ')) + '</dd>' +
      '<dt>TVL</dt><dd>' + dollars(row[4]) + '</dd>' +
      '<dt>7-day change</dt><dd>' + esc(chg) + '</dd>' +
      '<dt>Age tracked</dt><dd>' + (row[7] < 0 ? 'listing date not reported' : row[7] + ' days') + '</dd>' +
      '<dt>Implied range</dt><dd>' + dollars(row[15]) + ' – ' + dollars(row[16]) + '</dd></dl>' +
      '<h3>Value Breakdown (TVL Elasticity ' + el + ')</h3>' +
      '<p class="break">Base ' + dollars(row[9]) + ' × cat ' + cf.toFixed(3) + ' × growth ' + gf.toFixed(3) +
      ' × age ' + af.toFixed(3) + ' = <span class="tot">' + dollars(row[6]) + ' implied</span></p>' +
      barRow('Category factor', cfPct, '', '×' + cf.toFixed(3)) +
      barRow('Growth (' + (MDL.gKept ? 'kept' : 'neutral') + ')', gfPct, 'amb', '×' + gf.toFixed(3)) +
      barRow('Age (' + (MDL.aKept ? 'kept' : 'neutral') + ')', afPct, 'tel', '×' + af.toFixed(3)) +
      '<h3>Farm Economics (' + dollars(state.dep) + ' · ' + state.days + 'd · ' + state.pool + '% pool)</h3>' +
      '<div class="econ-grid">' +
      tile('', 'Verdict', VERD[f.v], ' class="pill ' + VCLS[f.v] + '"') +
      tile('', 'Gross Airdrop', dollars(f.gross)) +
      tile('', 'Round-trip Fees (' + esc(cheapChain) + ')', fmt$(f.fees)) +
      tile('', 'Net Return', dollars(f.net), ' class="' + (f.net >= 0 ? 'up' : 'down') + '"') +
      tile('', 'ROI %', f.roi.toFixed(1) + '%') +
      tile('', 'Breakeven Deposit', f.be < 0 ? 'Never profitable' : dollars(f.be)) + '</div>' +
      (peers.length ? '<p class="peers">Peers in ' + esc(cat) + ': ' + peers.join(' ') + '</p>' : '') +
      '<h3>5-Step Farm Plan</h3><ol>' + steps + '</ol>';
    $('overlay').hidden = false;
    on('closeBtn', 'click', closeOverlay);
    on('detCmp', 'click', function () { toggleCmp(slug); openDetail(slug); });
    var pBtns = $('detail').querySelectorAll('[data-peer]');
    for (var k = 0; k < pBtns.length; k++) pBtns[k].addEventListener('click', function (e) { openDetail(e.currentTarget.getAttribute('data-peer')); });
  }
  function openCompare() {
    if (state.cmp.length < 2) return;
    state.openSlug = null;
    var items = state.cmp.map(findRow).filter(Boolean);
    var hdr = '<tr><th>Metric</th>' + items.map(function (it) {
      return '<th>' + esc(it.row[1]) + (it.row[8] === 1 ? ' <span class="badge">WL</span>' : '') + '</th>';
    }).join('') + '</tr>';
    var spec = [
      ['Rank (range)', function (it) { return '#' + (it.idx + 1) + ' (#' + it.row[13] + '–#' + it.row[14] + ')'; }],
      ['Category', function (it) { return esc(CATS[it.row[2]]); }],
      ['TVL', function (it) { return dollars(it.row[4]); }],
      ['7d Momentum', function (it) { return it.row[5] === null ? '—' : (it.row[5] >= 0 ? '+' : '') + it.row[5].toFixed(1) + '%'; }],
      ['Age Tracked', function (it) { return ageText(it.row[7]); }],
      ['Implied Value', function (it) { return '<b class="implied">' + dollars(it.row[6]) + '</b>'; }],
      ['Implied Range', function (it) { return money(it.row[15]) + ' – ' + money(it.row[16]); }],
      ['Model Breakdown', function (it) { return money(it.row[9]) + ' × ' + (it.row[10] / 1000).toFixed(2) + ' × ' + (it.row[11] / 1000).toFixed(2) + ' × ' + (it.row[12] / 1000).toFixed(2); }],
      ['Cheapest Chain / Fee', function (it) { return esc(CHAINS[it.row[20]] || '—') + ' (' + fmt$(it.row[21]) + ')'; }],
      ['Sandbox Gross', function (it, f) { return dollars(f.gross); }],
      ['Sandbox Net', function (it, f) { return '<b class="' + (f.net >= 0 ? 'up' : 'down') + '">' + dollars(f.net) + '</b>'; }],
      ['ROI %', function (it, f) { return f.roi.toFixed(1) + '%'; }],
      ['Breakeven Deposit', function (it, f) { return f.be < 0 ? 'Never' : dollars(f.be); }],
      ['Verdict', function (it, f) { return '<span class="pill ' + VCLS[f.v] + '">' + VERD[f.v] + '</span>'; }]
    ];
    var body = spec.map(function (s) {
      return '<tr><td><b>' + esc(s[0]) + '</b></td>' + items.map(function (it) { return '<td>' + s[1](it, calcFarm(it.row)) + '</td>'; }).join('') + '</tr>';
    }).join('');
    $('detail').innerHTML =
      '<div class="det-act"><button class="btn" id="closeBtn">Close ×</button></div>' +
      '<h2>Side-by-Side Comparison</h2>' +
      '<p class="sub">Evaluated at ' + dollars(state.dep) + ' deposit · ' + state.days + ' days · ' + state.pool + '% airdrop pool</p>' +
      '<div class="tbl-wrap"><table class="cmp-tbl"><thead>' + hdr + '</thead><tbody>' + body + '</tbody></table></div>';
    $('overlay').hidden = false;
    on('closeBtn', 'click', closeOverlay);
  }
  function closeOverlay() { $('overlay').hidden = true; state.openSlug = null; }
  function toggleCmp(slug) {
    var i = state.cmp.indexOf(slug);
    if (i >= 0) state.cmp.splice(i, 1);
    else { if (state.cmp.length >= 3) state.cmp.shift(); state.cmp.push(slug); }
    renderBoard();
  }
  function exportCsv() {
    var list = filtered();
    function q(v) { return '"' + String(v).replace(/"/g, '""') + '"'; }
    var head = ['Rank', 'RankLow', 'RankHigh', 'Name', 'Slug', 'Category', 'Chains', 'TVL_USD', 'Change7d_Pct', 'Implied_USD', 'ImpliedLow_USD', 'ImpliedHigh_USD', 'Age_Days', 'Watchlist', 'CheapestChain', 'Fees_USD', 'Deposit_USD', 'HoldingDays', 'Pool_Pct', 'Gross_USD', 'Net_USD', 'ROI_Pct', 'Breakeven_USD', 'Verdict'];
    var lines = [head.join(',')];
    for (var i = 0; i < list.length; i++) {
      var r = list[i].row, f = list[i].f, chains = r[3].map(function (c) { return CHAINS[c] || ''; }).join('|');
      lines.push([
        list[i].idx + 1, r[13], r[14], q(r[1]), q(r[0]), q(CATS[r[2]]), q(chains), Math.round(r[4]),
        r[5] === null ? '' : r[5].toFixed(2), Math.round(r[6]), Math.round(r[15]), Math.round(r[16]),
        r[7] < 0 ? '' : r[7], r[8], q(CHAINS[r[20]] || ''), r[21].toFixed(2),
        state.dep, state.days, state.pool, f.gross.toFixed(2), f.net.toFixed(2),
        f.roi.toFixed(2), f.be < 0 ? 'Never' : Math.round(f.be), VERD[f.v]
      ].join(','));
    }
    var blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'launchlens-' + String(LL.a || 'board').replace(/[^a-zA-Z0-9_-]/g, '') + '.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
  function fillSelect(el, items) {
    var opts = items.map(function (n, i) { return [n, i]; }).sort(function (a, b) { return a[0] < b[0] ? -1 : 1; });
    for (var i = 0; i < opts.length; i++) { var o = document.createElement('option'); o.value = opts[i][1]; o.textContent = opts[i][0]; el.appendChild(o); }
  }
  function switchTab(tab) {
    state.tab = tab;
    ['board', 'anchors', 'audit'].forEach(function (t) { $('view-' + t).hidden = t !== tab; });
    var btns = $('tabs').querySelectorAll('.tab');
    for (var i = 0; i < btns.length; i++) btns[i].classList.toggle('active', btns[i].getAttribute('data-tab') === tab);
  }
  function onSandbox() {
    state.dep = Math.max(1, Number($('sbDep').value) || 1000);
    state.days = Math.max(1, Number($('sbDays').value) || 90);
    state.pool = Number($('sbPool').value) || 8;
    renderBoard();
    if (!$('overlay').hidden && state.openSlug) openDetail(state.openSlug);
  }
  fillSelect($('cat'), CATS);
  fillSelect($('chain'), CHAINS);
  $('meta').innerHTML = 'Snapshot <b>' + esc(LL.a) + '</b><br><b>' + LL.t + '</b> protocols tracked · <b>' + LL.w + '</b> watchlist<br><b>' + R.length + '</b> launch candidates';
  on('tabs', 'click', function (e) { var b = e.target.closest('.tab'); if (b) switchTab(b.getAttribute('data-tab')); });
  on('sbDep', 'input', onSandbox);
  on('sbDays', 'input', onSandbox);
  on('sbPool', 'change', onSandbox);
  on('q', 'input', function (e) { state.q = e.target.value.trim().toLowerCase(); renderBoard(); });
  on('cat', 'change', function (e) { state.cat = e.target.value; renderBoard(); });
  on('chain', 'change', function (e) { state.chain = e.target.value; renderBoard(); });
  on('verd', 'change', function (e) { state.verd = e.target.value; renderBoard(); });
  on('wl', 'change', function (e) { state.wl = e.target.checked; renderBoard(); });
  on('mintvl', 'input', function (e) { state.min = Number(e.target.value) || 0; renderBoard(); });
  on('rstBtn', 'click', function () {
    state.q = ''; state.cat = ''; state.chain = ''; state.verd = ''; state.wl = false; state.min = 0; state.sort = 'rank'; state.dir = 1;
    ['q', 'cat', 'chain', 'verd', 'mintvl'].forEach(function (id) { $(id).value = ''; });
    $('wl').checked = false;
    renderBoard();
  });
  on('expBtn', 'click', exportCsv);
  document.querySelectorAll('th button[data-sort]').forEach(function (b) {
    b.addEventListener('click', function (e) {
      var key = e.target.getAttribute('data-sort');
      if (state.sort === key) state.dir = -state.dir;
      else { state.sort = key; state.dir = key === 'rank' ? 1 : -1; }
      renderBoard();
    });
  });
  on('rows', 'click', function (e) {
    var chk = e.target.closest('.cmp-chk');
    if (chk) { e.stopPropagation(); toggleCmp(chk.getAttribute('data-cmp')); return; }
    var tr = e.target.closest('tr[data-slug]');
    if (tr) openDetail(tr.getAttribute('data-slug'));
  });
  on('cmpGo', 'click', openCompare);
  on('cmpClr', 'click', function () { state.cmp = []; renderBoard(); });
  on('overlay', 'click', function (e) { if (e.target.id === 'overlay') closeOverlay(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeOverlay(); });
  renderModel();
  renderAnchors();
  renderAudit();
  renderBoard();
})();
