(function () {
  'use strict';
  var ROWS = LL.rows, CAT_NAMES = LL.cats, CHAIN_NAMES = LL.chains, MODEL = LL.mdl || {};
  var FARM_CFG = LL.farmCfg || { defDep: 1000, defDays: 90, minDep: 100, maxDep: 50000, tvlShare: 0.0005 };
  var DEPOSIT_GRID = LL.grid || [100, 200, 350, 500, 750, 1000, 1500, 2500, 4000, 6000, 10000, 15000, 25000, 35000, 50000];
  var VERDICT_NAMES = ['SKIP', 'THIN', 'FARM'], VERDICT_CLASSES = ['v-skip', 'v-thin', 'v-farm'];
  var TD_NUM = '<td class="num">';
  var ui = { tab: 'board', query: '', catFilter: '', chainFilter: '', verdFilter: '', watchlistOnly: false, minTvl: 0, sortKey: 'rank', sortDir: 1, autoSize: true, deposit: FARM_CFG.defDep, holdDays: FARM_CFG.defDays, poolPct: 8, compare: [], openSlug: null };
  function el(id) { return document.getElementById(id); }
  function bind(id, ev, fn) { el(id).addEventListener(ev, fn); }
  function escapeHtml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function fmtMoney(v) {
    var sign = v < 0 ? '-' : '', mag = Math.abs(v);
    if (mag >= 1e9) return sign + '$' + (mag / 1e9).toFixed(2) + 'B';
    if (mag >= 1e6) return sign + '$' + (mag / 1e6).toFixed(1) + 'M';
    if (mag >= 1e3) return sign + '$' + Math.round(mag / 1e3) + 'K';
    return sign + '$' + Math.round(mag);
  }
  function fmtDollars(v) { var whole = Math.round(v); return (whole < 0 ? '-$' : '$') + Math.abs(whole).toLocaleString('en-US'); }
  function fmtUsd(v) { var sign = v < 0 ? '-' : '', mag = Math.abs(v); return mag >= 100 ? sign + '$' + Math.round(mag).toLocaleString('en-US') : sign + '$' + mag.toFixed(2); }
  function fmtPerHour(v) {
    if (!isFinite(v)) return '$0.00/h';
    var sign = v >= 0 ? '+' : '-', mag = Math.abs(v);
    return sign + '$' + mag.toFixed(mag > 0 && mag < 0.01 ? 3 : 2) + '/h';
  }
  function fmtAge(d) { if (d < 0) return '—'; return d >= 365 ? (d / 365).toFixed(1) + 'y' : d + 'd'; }
  function medianOf(arr) {
    if (!arr.length) return 0;
    var sorted = arr.slice().sort(function (x, y) { return x - y; }), mid = sorted.length >> 1;
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }
  function fmtPct(v) { return (v == null || isNaN(v)) ? '—' : (v * 100).toFixed(1) + '%'; }
  function fmtRho(v) { return (v == null || isNaN(v)) ? '—' : Number(v).toFixed(3); }
  function fmtMiss(v) { return (v == null || isNaN(v)) ? '—' : Number(v).toFixed(2) + '×'; }
  function farmAt(tvl, imp, fees, dep, days, pool, cap) {
    var k = imp * (pool / 100) * (days / 90);
    var gross = imp > 0 ? k * (dep / (tvl + dep)) : 0;
    var net = gross - fees, roi = (net / dep) * 100, hr = net / (days * 24);
    var denom = k - fees, be = (imp > 0 && denom > 0) ? (fees * tvl) / denom : -1;
    var pays = be > 0 && be <= cap;
    var beLbl = pays ? 'pays from ' + fmtUsd(be) : 'no ticket pays';
    var v = imp <= 0 ? 0 : ((net >= 50 && roi >= 5) ? 2 : (net > 0 ? 1 : 0));
    return { dep: dep, gross: gross, fees: fees, net: net, roi: roi, hr: hr, hrLbl: fmtPerHour(hr), be: be, beLbl: beLbl, pays: pays, cap: cap, v: v };
  }
  function farmForRow(row) {
    var tvl = row[4], imp = row[6], fees = row[21] || 0;
    var days = ui.holdDays > 0 ? ui.holdDays : 1, pool = ui.poolPct;
    var cap = Math.max(FARM_CFG.minDep, Math.min(FARM_CFG.maxDep, tvl * FARM_CFG.tvlShare));
    if (!ui.autoSize) return farmAt(tvl, imp, fees, ui.deposit > 0 ? ui.deposit : 1, days, pool, cap);
    // At the default sandbox settings, use the exact precomputed plan
    // economics serialised in the row. Recomputing from the sig4-rounded
    // implied value drifts the net by a cent vs board.json (e.g. $80.48 vs $80.49).
    if (days === FARM_CFG.defDays && pool === 8 && row[31] > 0) {
      var dep0 = row[31], net0 = row[18], hr0 = row[32];
      return { dep: dep0, gross: net0 + fees, fees: fees, net: net0, roi: (net0 / dep0) * 100, hr: hr0, hrLbl: fmtPerHour(hr0), be: row[19] > 0 ? row[19] : -1, beLbl: row[33] || '', pays: row[19] > 0 && row[19] <= cap, cap: cap, v: row[17] };
    }
    var best = null, cands = [];
    for (var i = 0; i < DEPOSIT_GRID.length; i++) if (DEPOSIT_GRID[i] >= FARM_CFG.minDep && DEPOSIT_GRID[i] <= cap) cands.push(DEPOSIT_GRID[i]);
    var rCap = Math.round(cap);
    if (rCap >= FARM_CFG.minDep && (!cands.length || cands[cands.length - 1] < rCap)) cands.push(rCap);
    for (var j = 0; j < cands.length; j++) {
      var e = farmAt(tvl, imp, fees, cands[j], days, pool, cap);
      if (e.net > 0 && (!best || e.net > best.net)) best = e;
    }
    if (best) return best;
    var fb = Math.round(Math.max(FARM_CFG.minDep, Math.min(cap, ui.deposit > 0 ? ui.deposit : FARM_CFG.defDep)));
    return farmAt(tvl, imp, fees, fb, days, pool, cap);
  }
  function substitute(t, n, c, d) { return t.split('{n}').join(n).split('{c}').join(c).split('{d}').join(d); }
  function statTile(cls, lbl, val, ba) { return '<div' + (cls ? ' class="' + cls + '"' : '') + '><span>' + lbl + '</span><b' + (ba || '') + '>' + val + '</b></div>'; }
  function meterRow(lbl, pct, cls, val) { return '<div class="bar-row"><span class="lbl">' + lbl + '</span><span class="bar"><i' + (cls ? ' class="' + cls + '"' : '') + ' style="width:' + pct + '%"></i></span><span class="val">' + val + '</span></div>'; }
  function planSteps(row, f) {
    var cat = CAT_NAMES[row[2]], name = row[1];
    var chains = row[3].map(function (i) { return CHAIN_NAMES[i] || ''; });
    var fam = (LL.fam && LL.fam[cat]) || 'generic';
    var tpl = (LL.tpl && (LL.tpl[fam] || LL.tpl.generic)) || [];
    var c = CHAIN_NAMES[row[20]] || chains[0] || 'Ethereum', d = '';
    for (var k = 0; k < chains.length; k++) if (chains[k] !== c) { d = chains[k]; break; }
    var dep = fmtUsd(f.dep), fee = fmtUsd(f.fees);
    return [
      'Deploy ' + dep + ' via ' + c + ' (~' + fee + ' round-trip fees): ' + substitute(tpl[0] || '', name, c, d),
      substitute(tpl[1] || '', name, c, d),
      substitute(tpl[2] || '', name, c, d),
      substitute(chains.length >= 2 && d ? LL.multi : LL.single, name, c, d),
      'Plan at ' + dep + ' for ' + ui.holdDays + 'd: ' + fmtUsd(f.net) + ' net (' + f.hrLbl + ', ' + f.roi.toFixed(1) + '% ROI) after ~' + fee + ' fees; ' + f.beLbl + ' — verdict ' + VERDICT_NAMES[f.v] + '.'
    ];
  }
  function drawKpis() {
    var wlEv = [], farmN = 0;
    for (var i = 0; i < ROWS.length; i++) { if (ROWS[i][8] === 1) wlEv.push(ROWS[i][6]); if (farmForRow(ROWS[i]).v === 2) farmN++; }
    var lo = MODEL.lo || {}, loo = MODEL.loo || [], cal = MODEL.cal || [], conf = MODEL.conf || [];
    var hasConf = conf.length > 0;
    var auditTot = (LL.audit && LL.audit[6]) || LL.t;
    var tiles = [
      ['Watchlist Covered', wlEv.length + '/' + LL.w, 'Median EV ' + fmtMoney(medianOf(wlEv))],
      ['Launch Odds LOO', fmtPct(lo.looAcc), (lo.looOk || 0) + '/' + (lo.n || LL.t) + ' right vs ' + fmtPct(lo.baseAcc) + ' base'],
      ['Value LOO Miss', fmtMiss(loo[1]), fmtPct(loo[2]) + ' ≤2× · ' + fmtPct(loo[3]) + ' ≤3× (' + (loo[5] || MODEL.fitN || 0) + ' refits)'],
      ['Range Holds', fmtPct(hasConf ? conf[11] : cal[2]) + ' / ' + fmtPct(hasConf ? conf[12] : cal[4]), hasConf ? 'Conformal P25-75 (50% id.) · P10-90 (80% id.) · nested' : 'P25–75 (50% id.) · P10–90 (80% id.)'],
      ['FARM Rated', String(farmN), (ui.autoSize ? 'Auto-sized' : fmtDollars(ui.deposit)) + ' · ' + ui.holdDays + 'd · ' + ui.poolPct + '%'],
      ['Snapshot Accounted', auditTot + '/' + LL.t, (LL.kinN || 0) + ' board rows flagged kin']
    ];
    el('kpis').innerHTML = tiles.map(function (t) {
      return '<div class="kpi"><span class="k-lbl">' + escapeHtml(t[0]) + '</span><b class="k-val">' + escapeHtml(t[1]) + '</b><span class="k-sub">' + escapeHtml(t[2]) + '</span></div>';
    }).join('');
  }
  function scatterSvg(anch) {
    if (!anch || !anch.length) return '<p class="muted">No anchor data.</p>';
    var pts = [], lo = Infinity, hi = -Infinity;
    for (var i = 0; i < anch.length; i++) {
      var tvl = anch[i][0], act = anch[i][1], pred = anch[i][3] || anch[i][2];
      if (act <= 0 || pred <= 0) continue;
      var lx = Math.log(act) / Math.LN10, ly = Math.log(pred) / Math.LN10;
      if (lx < lo) lo = lx; if (ly < lo) lo = ly; if (lx > hi) hi = lx; if (ly > hi) hi = ly;
      pts.push([lx, ly, tvl, act, pred]);
    }
    if (!pts.length) return '<p class="muted">No positive anchors.</p>';
    lo = Math.floor(lo * 2) / 2 - 0.25; hi = Math.ceil(hi * 2) / 2 + 0.25;
    var span = hi - lo || 1, W = 420, H = 240, PL = 50, PR = 14, PT = 14, PB = 34, PW = W - PL - PR, PH = H - PT - PB;
    function sx(v) { return PL + ((v - lo) / span) * PW; }
    function sy(v) { return PT + PH - ((v - lo) / span) * PH; }
    function line(x1, y1, x2, y2, cls) { return '<line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '" class="' + cls + '"/>'; }
    var out = ['<svg class="scat" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="LOO predicted vs actual market cap log-log scatter">'];
    for (var t = Math.ceil(lo); t <= Math.floor(hi); t++) {
      var x = sx(t).toFixed(1), y = sy(t).toFixed(1), lbl = fmtMoney(Math.pow(10, t));
      out.push(line(x, PT, x, PT + PH, 'grid') + line(PL, y, PL + PW, y, 'grid') +
        '<text x="' + x + '" y="' + (H - 18) + '" text-anchor="middle" class="ax">' + escapeHtml(lbl) + '</text>' +
        '<text x="' + (PL - 6) + '" y="' + (+y + 3) + '" text-anchor="end" class="ax">' + escapeHtml(lbl) + '</text>');
    }
    var log2 = Math.LN2 / Math.LN10;
    out.push(line(sx(lo).toFixed(1), sy(lo).toFixed(1), sx(hi).toFixed(1), sy(hi).toFixed(1), 'diag'));
    out.push(line(sx(lo).toFixed(1), sy(Math.min(hi, lo + log2)).toFixed(1), sx(Math.max(lo, hi - log2)).toFixed(1), sy(hi).toFixed(1), 'band'));
    out.push(line(sx(Math.min(hi, lo + log2)).toFixed(1), sy(lo).toFixed(1), sx(hi).toFixed(1), sy(Math.max(lo, hi - log2)).toFixed(1), 'band'));
    for (var j = 0; j < pts.length; j++) {
      var p = pts[j], ratio = p[4] / p[3], ok = ratio >= 0.5 && ratio <= 2;
      out.push('<circle cx="' + sx(p[0]).toFixed(1) + '" cy="' + sy(p[1]).toFixed(1) + '" r="2.7" class="' + (ok ? 'pt-ok' : 'pt-out') +
        '"><title>TVL ' + escapeHtml(fmtMoney(p[2])) + ' | Actual ' + escapeHtml(fmtMoney(p[3])) + ' | LOO Pred ' + escapeHtml(fmtMoney(p[4])) + ' (' + ratio.toFixed(2) + '×)</title></circle>');
    }
    out.push('<text x="' + (PL + PW / 2) + '" y="' + (H - 3) + '" text-anchor="middle" class="ax-lbl">Actual Market Cap (log10)</text>');
    out.push('<text x="12" y="' + (PT + PH / 2) + '" text-anchor="middle" transform="rotate(-90 12 ' + (PT + PH / 2) + ')" class="ax-lbl">LOO Predicted (log10)</text>');
    out.push('</svg><div class="scat-leg"><span class="dot-ok"></span> Within 2× <span class="dot-out"></span> &gt;2× — solid: y = x, dashed: 2× band (LOO predictions)</div>');
    return out.join('');
  }
  function drawModel() {
    var elastic = (MODEL.el != null ? MODEL.el : (LL.el / 1000)).toFixed(3);
    var int10 = MODEL.int != null ? (MODEL.int / Math.LN10).toFixed(2) : '—';
    var loo = MODEL.loo || [], cal = MODEL.cal || [], conf = MODEL.conf || [], lo = MODEL.lo || {};
    var confOn = conf.length > 0;
    var holdIn = confOn ? conf[11] : cal[2], holdOut = confOn ? conf[12] : cal[4];
    var catMults = (LL.catf || []).filter(function (c) { return c[0] > 0; }).map(function (c) { return Math.exp(c[1] / 1000); });
    var catMin = catMults.length ? Math.min.apply(null, catMults).toFixed(2) : '1.00';
    var catMax = catMults.length ? Math.max.apply(null, catMults).toFixed(2) : '1.00';
    var gText = MODEL.gKept && MODEL.gCoef != null ? 'exp(' + MODEL.gCoef.toFixed(3) + '·asinh(chg7d/100))' : '1.00 (dropped by CV)';
    var aText = MODEL.aKept && MODEL.aCoef != null ? 'exp(' + MODEL.aCoef.toFixed(3) + '·ln(1+age/365))' : '1.00 (dropped by CV)';
    el('mdlSummary').textContent = '— EV = 10^' + int10 + ' × TVL^' + elastic + ' × cat × P(launch) · LOO ' + fmtMiss(loo[1]) + ' · Range holds ' + fmtPct(holdIn) + '/' + fmtPct(holdOut);
    el('mdlNarrative').innerHTML =
      '<p>Every board row is ranked by <b>Expected Value = Value-if-Launches × Launch Odds</b>, calibrated from <b>' + (MODEL.fitN || 0) + '</b> tokenised anchors (' + (MODEL.out || 0) + ' outliers dropped) and all <b>' + (lo.n || LL.t) + '</b> snapshot protocols:</p>' +
      '<p class="formula">implied = 10<sup>' + int10 + '</sup> &times; TVL<sup>' + elastic + '</sup> &times; category &times; growth &times; age &times; launch odds</p>' +
      '<ul class="terms">' +
      '<li><b>10<sup>' + int10 + '</sup></b>: global circulating-mcap intercept (natural-log ' + (MODEL.int != null ? MODEL.int.toFixed(3) : '—') + ').</li>' +
      '<li><b>TVL<sup>' + elastic + '</sup></b>: sub-linear size elasticity (&lt;1 prevents linear-multiple overvaluation of huge TVL).</li>' +
      '<li><b>category</b>: empirical-Bayes shrunk offset (×' + catMin + '–×' + catMax + ', weight <i>n</i>/(<i>n</i>+8)).</li>' +
      '<li><b>growth</b>: ' + gText + ' · <b>age</b>: ' + aText + '.</li>' +
      '<li><b>launch odds</b>: cohort tokenisation share (age band + category), shrunk to ' + fmtPct(lo.base) + ' base rate (<i>k</i>=' + (lo.k || 10) + ').</li></ul>';
    var cv = MODEL.cv || [], big = MODEL.cvBig || [], base = MODEL.base || [], hold = MODEL.hold || [];
    var cvRows = [
      ['LOO (' + (loo[5] || MODEL.fitN || 0) + ' refits, selected)', loo[5], loo[1], loo[0], loo[2], loo[3], loo[4]],
      ['5-fold CV (Model, all)', cv[3], null, cv[0], cv[1], null, cv[2]],
      ['5-fold CV (TVL ≥ $10M)', big[3], null, big[0], big[1], null, big[2]],
      ['Baseline (Global Median)', cv[3], null, base[0], base[1], null, base[2]],
      ['Newest-Listed Holdout', hold[2], null, hold[0], hold[1], null, null]
    ];
    el('mdlCv').innerHTML = cvRows.map(function (r) {
      return '<tr><td>' + r[0] + '</td>' + TD_NUM + (r[1] || '—') + '</td>' + TD_NUM + fmtMiss(r[2]) + '</td>' + TD_NUM + fmtPct(r[3]) + '</td>' + TD_NUM + fmtPct(r[4]) + '</td>' + TD_NUM + fmtPct(r[5]) + '</td>' + TD_NUM + fmtRho(r[6]) + '</td></tr>';
    }).join('');
    // Conformal tile when the model ships conf[] (round 5+); otherwise the
    // round-4 OOB tile. conf layout: [n, mean, sd, q10, q25, q75, q90,
    // f10, f25, f75, f90, nested P25-75, nested P10-90].
    var calHtml;
    if (confOn) {
      var innerHits = Math.round(conf[11] * conf[0]), outerHits = Math.round(conf[12] * conf[0]);
      calHtml = '<div class="cal-grid">' +
        statTile('', 'P25–P75 RANGE HOLDS', fmtPct(conf[11]) + ' (' + innerHits + '/' + conf[0] + ') — 50% if exact') +
        statTile('', 'P10–P90 RANGE HOLDS', fmtPct(conf[12]) + ' (' + outerHits + '/' + conf[0] + ') — 80% if exact') +
        '</div><p class="sm">Bands span x' + conf[8].toFixed(2) + '–x' + conf[9].toFixed(2) + ' (P25–75) and x' + conf[7].toFixed(2) + '–x' + conf[10].toFixed(2) + ' (P10–90) of the point value.</p>' +
        '<p class="muted sm">Parameter-only bootstrap bands held ' + fmtPct(cal[2]) + ' / ' + fmtPct(cal[4]) + ' — conformal bands use the LOO residual spread instead.</p>';
    } else {
      calHtml = '<div class="cal-grid">' +
        statTile('', 'P25–P75 RANGE HOLDS', fmtPct(cal[2]) + ' (' + (cal[1] || 0) + '/' + (cal[0] || 0) + ') — 50% if exact') +
        statTile('', 'P10–P90 RANGE HOLDS', fmtPct(cal[4]) + ' (' + (cal[3] || 0) + '/' + (cal[0] || 0) + ') — 80% if exact') +
        '</div><p class="muted sm">Checked on out-of-bag held-out anchors across 250 seeded bootstrap refits (parameter-uncertainty bands; honest coverage reported even when narrow).</p>';
    }
    el('mdlCal').innerHTML = calHtml;
    el('mdlAbl').innerHTML = (MODEL.abl || []).map(function (s) {
      var stCls = s[8] === 'selected' ? 'v-farm' : (s[8] === 'dropped' ? 'v-skip' : 'v-thin');
      return '<tr' + (s[7] ? ' class="sel-row"' : '') + '><td>' + escapeHtml(s[1]) + '</td>' + TD_NUM + fmtMiss(s[4]) + '</td>' + TD_NUM + fmtPct(s[3]) + '</td>' +
        TD_NUM + fmtPct(s[5]) + '</td>' + TD_NUM + fmtPct(s[6]) + '</td><td><span class="pill ' + stCls + '">' + escapeHtml(String(s[8]).toUpperCase()) + '</span></td></tr>';
    }).join('') || '<tr><td colspan="6">No ablation data.</td></tr>';
    el('mdlLoMeta').innerHTML =
      'Base rate: <b>' + (lo.tok || 0) + '/' + (lo.n || LL.t) + ' (' + fmtPct(lo.base) + ')</b> &middot; ' +
      'LOO called right: <b>' + (lo.looOk || 0) + '/' + (lo.n || LL.t) + ' (' + fmtPct(lo.looAcc) + ')</b> vs base-rate alone <b>' + fmtPct(lo.baseAcc) + '</b> (shrinkage k=' + (lo.k || 10) + ', undated k=' + (lo.uk || 20) + ').';
    el('mdlLoBands').innerHTML = (lo.bands || []).map(function (b) {
      return '<tr><td>' + escapeHtml(b[0]) + '</td>' + TD_NUM + b[1] + '</td>' + TD_NUM + b[2] + '</td>' + TD_NUM + fmtPct(b[3]) + '</td></tr>';
    }).join('');
    el('mdlLoCaveat').textContent = 'Launch odds = share of similar protocols (same age band + category) that already record a token, shrunk to the ' + fmtPct(lo.base) + ' base rate. It predicts no launch: a protocol here records no token, which is not proof it has none, and any protocol may launch tomorrow — these odds are a cohort base rate, not a forecast of a single protocol.';
    var scat = scatterSvg(LL.anch);
    el('mdlScatter').innerHTML = scat;
    el('anchScatter').innerHTML = scat;
    var catRows = [];
    for (var i = 0; i < CAT_NAMES.length; i++) {
      var cf = (LL.catf && LL.catf[i]) || [LL.catn[i] || 0, 0, 0];
      catRows.push([CAT_NAMES[i], cf[0], cf[1] / 1000, cf[2] / 1000]);
    }
    catRows.sort(function (a, b) { return b[1] - a[1] || (a[0] < b[0] ? -1 : 1); });
    el('mdlCats').innerHTML = catRows.map(function (c) {
      return '<tr><td>' + escapeHtml(c[0]) + '</td>' + TD_NUM + c[1] + '</td>' + TD_NUM + c[2].toFixed(3) + '</td>' + TD_NUM + '×' + Math.exp(c[2]).toFixed(2) + '</td>' + TD_NUM + Math.round(c[3] * 100) + '%</td></tr>';
    }).join('');
  }
  function drawAnchors() {
    var anch = (LL.anch || []).slice().sort(function (a, b) { return b[0] - a[0]; });
    var tvls = [], acts = [], rats = [], hit = 0;
    for (var i = 0; i < anch.length; i++) {
      tvls.push(anch[i][0]); acts.push(anch[i][1]);
      var lp = anch[i][3] || anch[i][2], r = anch[i][1] > 0 ? lp / anch[i][1] : 0;
      rats.push(r);
      if (r >= 0.5 && r <= 2) hit++;
    }
    var loo = MODEL.loo || [];
    el('anchStats').innerHTML = '<div class="st-grid">' +
      statTile('', 'Fit anchors (plotted)', (MODEL.fitN || 0) + ' (' + anch.length + ')') +
      statTile('', 'Outliers dropped', MODEL.out || 0) +
      statTile('', 'LOO median miss', fmtMiss(loo[1])) +
      statTile('', 'LOO within 2× / 3×', fmtPct(loo[2]) + ' / ' + fmtPct(loo[3])) +
      statTile('', 'Median anchor TVL', fmtMoney(medianOf(tvls))) +
      statTile('', 'Sample LOO ≤2×', anch.length ? ((hit / anch.length) * 100).toFixed(1) + '%' : '—') + '</div>';
    el('anchRows').innerHTML = anch.map(function (a, idx) {
      var lp2 = a[3] || a[2], r2 = a[1] > 0 ? lp2 / a[1] : 0, ok = r2 >= 0.5 && r2 <= 2;
      return '<tr>' + TD_NUM + (idx + 1) + '</td>' + TD_NUM + fmtDollars(a[0]) + '</td>' + TD_NUM + fmtDollars(a[1]) + '</td>' + TD_NUM + fmtDollars(a[2]) + '</td>' + TD_NUM + fmtDollars(lp2) + '</td>' + TD_NUM + r2.toFixed(2) + '×</td>' +
        TD_NUM + '<span class="pill ' + (ok ? 'v-farm' : 'v-thin') + '">' + (ok ? 'YES' : 'NO') + '</span></td></tr>';
    }).join('') || '<tr><td colspan="7">No anchors available.</td></tr>';
  }
  function drawAudit() {
    var part = LL.part || [];
    var sum = 0;
    for (var i = 0; i < part.length; i++) sum += part[i][3];
    var tot = LL.t || sum || 1;
    el('auditCards').innerHTML =
      statTile('aud-card', 'Tracked Snapshot', LL.t) +
      statTile('aud-card', 'Sum of ' + part.length + ' Buckets', sum) +
      statTile('aud-card', 'Reconciliation', sum === LL.t ? 'EXACT MATCH' : 'DELTA ' + (LL.t - sum), ' class="' + (sum === LL.t ? 'up' : 'down') + '"') +
      statTile('aud-card', 'Kin of a Token (Board)', (LL.kinN || 0) + ' flagged (info only)');
    el('auditRows').innerHTML = part.map(function (b) {
      var pct = ((b[3] / tot) * 100).toFixed(1) + '%';
      var gCls = b[2] === 'board' ? 'v-farm' : (b[2] === 'anchors' ? 'v-thin' : 'v-skip');
      var slugs = b[4] || [];
      var slugHtml = slugs.length
        ? '<details class="slug-det"><summary>' + slugs.length + ' slugs</summary><div class="slug-list">' + slugs.map(escapeHtml).join(', ') + '</div></details>'
        : '<span class="muted">none</span>';
      return '<tr><td><b>' + escapeHtml(b[1]) + '</b></td>' + TD_NUM + b[3] + '</td>' + TD_NUM + pct + '</td>' +
        '<td><span class="pill ' + gCls + '">' + escapeHtml(String(b[2]).toUpperCase()) + '</span></td><td>' + slugHtml + '</td></tr>';
    }).join('') + '<tr class="aud-tot"><td><b>Total Snapshot</b></td>' + TD_NUM + '<b>' + sum + ' / ' + LL.t + '</b></td>' + TD_NUM + '<b>100.0%</b></td><td></td><td>100% mutually exclusive partition; board rows record no token.</td></tr>';
  }
  function rowMatches(row, f) {
    if (ui.query) { var q = ui.query; if (row[1].toLowerCase().indexOf(q) < 0 && row[0].toLowerCase().indexOf(q) < 0) return false; }
    if (ui.catFilter !== '' && row[2] !== Number(ui.catFilter)) return false;
    if (ui.chainFilter !== '' && row[3].indexOf(Number(ui.chainFilter)) < 0) return false;
    if (ui.verdFilter !== '' && f.v !== Number(ui.verdFilter)) return false;
    if (ui.watchlistOnly && row[8] !== 1) return false;
    if (row[4] < ui.minTvl) return false;
    return true;
  }
  function sortKeyOf(item) {
    var r = item.row, s = ui.sortKey;
    if (s === 'rank') return item.idx;
    if (s === 'tvl') return r[4];
    if (s === 'val') return r[22];
    if (s === 'odds') return r[23];
    if (s === 'implied') return r[6];
    if (s === 'net') return item.f.net;
    if (s === 'age') return r[7];
    return item.idx;
  }
  function visibleRows() {
    var out = [];
    for (var i = 0; i < ROWS.length; i++) { var f = farmForRow(ROWS[i]); if (rowMatches(ROWS[i], f)) out.push({ row: ROWS[i], idx: i, f: f }); }
    var dir = ui.sortDir;
    out.sort(function (a, b) { var d = (sortKeyOf(a) - sortKeyOf(b)) * dir; return d !== 0 ? d : a.idx - b.idx; });
    return out;
  }
  function rankRangeBar(rank, rLow, rHigh) {
    var n = Math.max(1, ROWS.length - 1);
    var lo = Math.min(rLow, rHigh), hi = Math.max(rLow, rHigh);
    var left = ((lo - 1) / n) * 100, w = Math.max(4, ((hi - lo) / n) * 100), dot = ((rank - 1) / n) * 100;
    return '<div class="rbar" title="Expected-value rank range #' + lo + '–#' + hi + '">' +
      '<span style="left:' + left.toFixed(1) + '%;width:' + w.toFixed(1) + '%"></span><i style="left:' + dot.toFixed(1) + '%"></i></div>';
  }
  function boardRowHtml(item) {
    var row = item.row, rank = item.idx + 1, f = item.f;
    var chains = row[3].slice(0, 2).map(function (i) { return CHAIN_NAMES[i] || ''; });
    var extra = row[3].length > 2 ? ' +' + (row[3].length - 2) : '';
    var chk = ui.compare.indexOf(row[0]) >= 0 ? ' checked' : '';
    var vPill = '<span class="pill ' + VERDICT_CLASSES[f.v] + '">' + VERDICT_NAMES[f.v] + '</span>';
    var oddsPct = (row[23] / 10).toFixed(0) + '%';
    var coh = row[24] || ['—', 0, 0, 0];
    var kinB = row[34] === 1 ? '<span class="badge kin" title="Kin of token: ' + escapeHtml((row[35] || []).join(', ')) + '">KIN</span>' : '';
    return '<tr data-slug="' + escapeHtml(row[0]) + '">' +
      '<td class="chk-col"><input type="checkbox" class="cmp-chk" data-cmp="' + escapeHtml(row[0]) + '"' + chk + ' aria-label="Compare ' + escapeHtml(row[1]) + '"></td>' +
      '<td class="num rank-cell"><b>#' + rank + '</b><span class="rng">' + row[13] + '–' + row[14] + '</span>' + rankRangeBar(rank, row[13], row[14]) + '</td>' +
      '<td><b>' + escapeHtml(row[1]) + '</b>' + (row[8] === 1 ? '<span class="badge">WL</span>' : '') + kinB + '<br><span class="slug">' + escapeHtml(row[0]) + '</span></td>' +
      '<td>' + escapeHtml(CAT_NAMES[row[2]]) + '</td><td class="chains">' + escapeHtml(chains.join(', ')) + escapeHtml(extra) + '</td>' +
      TD_NUM + fmtMoney(row[4]) + '</td>' +
      TD_NUM + '<span>' + fmtMoney(row[22]) + '</span><span class="rng">P25–75 ' + fmtMoney(row[28]) + '–' + fmtMoney(row[29]) + '</span></td>' +
      TD_NUM + '<b class="odds">' + oddsPct + '</b><span class="rng">' + escapeHtml(coh[0]) + ' (' + coh[2] + '/' + coh[1] + ')</span></td>' +
      TD_NUM + '<span class="implied">' + fmtMoney(row[6]) + '</span><span class="rng">P25–75 ' + fmtMoney(row[25]) + '–' + fmtMoney(row[26]) + '</span></td>' +
      TD_NUM + '<span class="' + (f.net >= 0 ? 'up' : 'down') + '">' + fmtDollars(f.net) + '</span> ' + vPill + '<span class="rng">' + fmtMoney(f.dep) + ' · ' + f.hrLbl + ' · ' + escapeHtml(f.beLbl) + '</span></td>' +
      TD_NUM + fmtAge(row[7]) + '</td></tr>';
  }
  function drawBoard() {
    var list = visibleRows(), html = '';
    for (var i = 0; i < list.length; i++) html += boardRowHtml(list[i]);
    el('rows').innerHTML = html || '<tr><td colspan="11">No protocols match these filters.</td></tr>';
    el('count').textContent = 'Showing ' + list.length + ' of ' + ROWS.length;
    var btns = document.querySelectorAll('th button[data-sort]');
    for (var j = 0; j < btns.length; j++) {
      var b = btns[j], on = b.getAttribute('data-sort') === ui.sortKey;
      b.classList.toggle('sorted', on);
      b.textContent = b.textContent.replace(/ [▲▼]$/, '') + (on ? (ui.sortDir === 1 ? ' ▲' : ' ▼') : '');
    }
    drawKpis();
    drawCmpBar();
  }
  function drawCmpBar() {
    var bar = el('cmpBar');
    if (!ui.compare.length) { bar.hidden = true; return; }
    bar.hidden = false;
    el('cmpCnt').textContent = ui.compare.length;
    el('cmpList').innerHTML = ui.compare.map(function (slug) {
      var r = lookupRow(slug);
      return '<span class="cmp-chip">' + escapeHtml(r ? r.row[1] : slug) + '</span>';
    }).join(' ');
    el('cmpGo').disabled = ui.compare.length < 2;
  }
  function lookupRow(slug) { for (var i = 0; i < ROWS.length; i++) if (ROWS[i][0] === slug) return { row: ROWS[i], idx: i }; return null; }
  function showDetail(slug) {
    var found = lookupRow(slug);
    if (!found) return;
    ui.openSlug = slug;
    var row = found.row, idx = found.idx, cat = CAT_NAMES[row[2]];
    var chains = row[3].map(function (k) { return CHAIN_NAMES[k] || ''; });
    var cf = row[10] / 1000, gf = row[11] / 1000, af = row[12] / 1000, loProb = row[23] / 1000;
    var coh = row[24] || ['—', 0, 0, 0];
    var elastic = (LL.el / 1000).toFixed(3);
    var chg = row[5] === null ? 'not reported' : (row[5] >= 0 ? '+' : '') + row[5].toFixed(2) + '% (7d)';
    var f = farmForRow(row);
    var cheapChain = CHAIN_NAMES[row[20]] || chains[0] || '—';
    var steps = planSteps(row, f).map(function (s) { return '<li>' + escapeHtml(s) + '</li>'; }).join('');
    var inCmp = ui.compare.indexOf(slug) >= 0;
    var peers = [];
    for (var p = 0; p < ROWS.length && peers.length < 4; p++) {
      if (p !== idx && ROWS[p][2] === row[2]) peers.push('<button class="peer-btn" data-peer="' + escapeHtml(ROWS[p][0]) + '">#' + (p + 1) + ' ' + escapeHtml(ROWS[p][1]) + ' (' + fmtMoney(ROWS[p][6]) + ')</button>');
    }
    var cfPct = Math.min(100, Math.max(4, Math.round((cf / 2) * 100)));
    var loPct = Math.min(100, Math.max(4, Math.round(loProb * 100)));
    var kinHtml = row[34] === 1
      ? '<dt>Kin of a token</dt><dd><span class="badge kin">KIN</span> Matches tokenised stem: ' + escapeHtml((row[35] || []).join(', ')) + ' (informational only)</dd>'
      : '';
    el('detail').innerHTML =
      '<div class="det-act"><button class="btn" id="detCmp">' + (inCmp ? 'Remove from Compare' : '+ Add to Compare') + '</button>' +
      '<button class="btn" id="closeBtn">Close ×</button></div>' +
      '<h2>' + escapeHtml(row[1]) + (row[8] === 1 ? '<span class="badge">WATCHLIST</span>' : '') + (row[34] === 1 ? '<span class="badge kin">KIN</span>' : '') + '</h2>' +
      '<p class="sub">Rank #' + (idx + 1) + ' of ' + ROWS.length + ' (range #' + row[13] + '–#' + row[14] + ') · ' + escapeHtml(row[0]) + ' · records no token</p>' +
      '<dl><dt>Category</dt><dd>' + escapeHtml(cat) + ' (' + (LL.catn[row[2]] || 0) + ' tokenised anchors)</dd>' +
      '<dt>Chains</dt><dd>' + escapeHtml(chains.join(', ')) + '</dd>' +
      '<dt>TVL / 7d</dt><dd>' + fmtDollars(row[4]) + ' (' + escapeHtml(chg) + ')</dd>' +
      '<dt>Tenure &amp; Cohort</dt><dd>' + (row[7] < 0 ? 'Undated' : row[7] + ' days') + ' · Band <b>' + escapeHtml(coh[0]) + '</b> · ' + coh[2] + '/' + coh[1] + ' tokenised (weight ' + Math.round(coh[3] / 10) + '%)</dd>' +
      '<dt>Value if Launches</dt><dd><b>' + fmtDollars(row[22]) + '</b> · P25–75 (conformal): ' + fmtMoney(row[28]) + '–' + fmtMoney(row[29]) + ' · P10–90 (conformal): ' + fmtMoney(row[27]) + '–' + fmtMoney(row[30]) + '</dd>' +
      '<dt>Expected Value</dt><dd><b class="implied">' + fmtDollars(row[6]) + '</b> · P25–75 (conformal): ' + fmtMoney(row[25]) + '–' + fmtMoney(row[26]) + ' · P10–90 (conformal): ' + fmtMoney(row[15]) + '–' + fmtMoney(row[16]) + '</dd>' +
      kinHtml + '</dl>' +
      '<h3>Expected-Value Decomposition (TVL Elasticity ' + elastic + ')</h3>' +
      '<p class="break">Base ' + fmtDollars(row[9]) + ' × cat ' + cf.toFixed(3) + ' × growth ' + gf.toFixed(3) +
      ' × age ' + af.toFixed(3) + ' = ' + fmtDollars(row[22]) + ' × launch odds ' + (loProb * 100).toFixed(1) + '% = <span class="tot">' + fmtDollars(row[6]) + ' EV</span></p>' +
      meterRow('Category factor', cfPct, '', '×' + cf.toFixed(3)) +
      meterRow('Launch odds (' + escapeHtml(coh[0]) + ')', loPct, 'tel', (loProb * 100).toFixed(1) + '%') +
      '<h3>Deposit-Sized Farm Plan (' + (ui.autoSize ? 'Auto-sized' : 'Fixed') + ' ' + fmtDollars(f.dep) + ' · ' + ui.holdDays + 'd · ' + ui.poolPct + '% pool)</h3>' +
      '<div class="econ-grid">' +
      statTile('', 'Verdict', VERDICT_NAMES[f.v], ' class="pill ' + VERDICT_CLASSES[f.v] + '"') +
      statTile('', 'Plan Deposit', fmtDollars(f.dep) + ' (cap ' + fmtMoney(f.cap) + ')') +
      statTile('', 'Net Return', fmtDollars(f.net), ' class="' + (f.net >= 0 ? 'up' : 'down') + '"') +
      statTile('', 'Net / Hour', f.hrLbl, ' class="' + (f.hr >= 0 ? 'up' : 'down') + '"') +
      statTile('', 'Breakeven', f.beLbl) +
      statTile('', 'Fees (' + escapeHtml(cheapChain) + ') / ROI', fmtUsd(f.fees) + ' · ' + f.roi.toFixed(1) + '%') + '</div>' +
      (peers.length ? '<p class="peers">Peers in ' + escapeHtml(cat) + ': ' + peers.join(' ') + '</p>' : '') +
      '<h3>5-Step Farm Plan</h3><ol>' + steps + '</ol>';
    el('overlay').hidden = false;
    bind('closeBtn', 'click', hideOverlay);
    bind('detCmp', 'click', function () { toggleCompare(slug); showDetail(slug); });
    var pBtns = el('detail').querySelectorAll('[data-peer]');
    for (var k = 0; k < pBtns.length; k++) pBtns[k].addEventListener('click', function (e) { showDetail(e.currentTarget.getAttribute('data-peer')); });
  }
  function showCompare() {
    if (ui.compare.length < 2) return;
    ui.openSlug = null;
    var items = ui.compare.map(lookupRow).filter(Boolean);
    var hdr = '<tr><th>Metric</th>' + items.map(function (it) {
      return '<th>' + escapeHtml(it.row[1]) + (it.row[8] === 1 ? ' <span class="badge">WL</span>' : '') + '</th>';
    }).join('') + '</tr>';
    var spec = [
      ['Rank (range)', function (it) { return '#' + (it.idx + 1) + ' (#' + it.row[13] + '–#' + it.row[14] + ')'; }],
      ['Category / Tenure', function (it) { return escapeHtml(CAT_NAMES[it.row[2]]) + ' · ' + fmtAge(it.row[7]); }],
      ['TVL', function (it) { return fmtDollars(it.row[4]); }],
      ['Value if Launches', function (it) { return fmtDollars(it.row[22]) + ' (P25–75 ' + fmtMoney(it.row[28]) + '–' + fmtMoney(it.row[29]) + ')'; }],
      ['Launch Odds (cohort)', function (it) { var c = it.row[24] || ['—', 0, 0]; return (it.row[23] / 10).toFixed(1) + '% (' + escapeHtml(c[0]) + ' ' + c[2] + '/' + c[1] + ')'; }],
      ['Expected Value', function (it) { return '<b class="implied">' + fmtDollars(it.row[6]) + '</b>'; }],
      ['EV P25–P75 / P10–P90', function (it) { return fmtMoney(it.row[25]) + '–' + fmtMoney(it.row[26]) + ' / ' + fmtMoney(it.row[15]) + '–' + fmtMoney(it.row[16]); }],
      ['Plan Deposit / Chain', function (it, f) { return fmtDollars(f.dep) + ' on ' + escapeHtml(CHAIN_NAMES[it.row[20]] || '—') + ' (' + fmtUsd(f.fees) + ')'; }],
      ['Net / Net-per-Hour', function (it, f) { return '<b class="' + (f.net >= 0 ? 'up' : 'down') + '">' + fmtDollars(f.net) + '</b> (' + f.hrLbl + ')'; }],
      ['Breakeven / ROI', function (it, f) { return escapeHtml(f.beLbl) + ' · ' + f.roi.toFixed(1) + '%'; }],
      ['Verdict', function (it, f) { return '<span class="pill ' + VERDICT_CLASSES[f.v] + '">' + VERDICT_NAMES[f.v] + '</span>'; }]
    ];
    var body = spec.map(function (s) {
      return '<tr><td><b>' + escapeHtml(s[0]) + '</b></td>' + items.map(function (it) { return '<td>' + s[1](it, farmForRow(it.row)) + '</td>'; }).join('') + '</tr>';
    }).join('');
    el('detail').innerHTML =
      '<div class="det-act"><button class="btn" id="closeBtn">Close ×</button></div>' +
      '<h2>Side-by-Side Comparison</h2>' +
      '<p class="sub">' + (ui.autoSize ? 'Auto-sized deposit per protocol' : fmtDollars(ui.deposit) + ' fixed deposit') + ' · ' + ui.holdDays + ' days · ' + ui.poolPct + '% airdrop pool</p>' +
      '<div class="tbl-wrap"><table class="cmp-tbl"><thead>' + hdr + '</thead><tbody>' + body + '</tbody></table></div>';
    el('overlay').hidden = false;
    bind('closeBtn', 'click', hideOverlay);
  }
  function hideOverlay() { el('overlay').hidden = true; ui.openSlug = null; }
  function toggleCompare(slug) {
    var i = ui.compare.indexOf(slug);
    if (i >= 0) ui.compare.splice(i, 1);
    else { if (ui.compare.length >= 3) ui.compare.shift(); ui.compare.push(slug); }
    drawBoard();
  }
  function downloadCsv() {
    var list = visibleRows();
    function quote(v) { return '"' + String(v).replace(/"/g, '""') + '"'; }
    var head = ['Rank', 'RankLow', 'RankHigh', 'Name', 'Slug', 'Category', 'Chains', 'TVL_USD', 'ValueIfLaunch_USD', 'LaunchOdds_Pct', 'ExpectedValue_USD', 'EV_P25_USD', 'EV_P75_USD', 'EV_P10_USD', 'EV_P90_USD', 'Age_Days', 'Watchlist', 'KinFlag', 'CheapestChain', 'Fees_USD', 'PlanDeposit_USD', 'HoldingDays', 'Pool_Pct', 'Net_USD', 'NetPerHour_USD', 'ROI_Pct', 'Breakeven', 'Verdict'];
    var lines = [head.join(',')];
    for (var i = 0; i < list.length; i++) {
      var r = list[i].row, f = list[i].f, chains = r[3].map(function (c) { return CHAIN_NAMES[c] || ''; }).join('|');
      lines.push([
        list[i].idx + 1, r[13], r[14], quote(r[1]), quote(r[0]), quote(CAT_NAMES[r[2]]), quote(chains), Math.round(r[4]),
        Math.round(r[22]), (r[23] / 10).toFixed(1), Math.round(r[6]), Math.round(r[25]), Math.round(r[26]),
        Math.round(r[15]), Math.round(r[16]), r[7] < 0 ? '' : r[7], r[8], r[34], quote(CHAIN_NAMES[r[20]] || ''),
        r[21].toFixed(2), Math.round(f.dep), ui.holdDays, ui.poolPct, f.net.toFixed(2), f.hr.toFixed(4),
        f.roi.toFixed(2), quote(f.beLbl), VERDICT_NAMES[f.v]
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
  function populateSelect(elm, items) {
    var opts = items.map(function (n, i) { return [n, i]; }).sort(function (a, b) { return a[0] < b[0] ? -1 : 1; });
    for (var i = 0; i < opts.length; i++) { var o = document.createElement('option'); o.value = opts[i][1]; o.textContent = opts[i][0]; elm.appendChild(o); }
  }
  function selectTab(tab) {
    ui.tab = tab;
    ['board', 'anchors', 'audit'].forEach(function (t) { el('view-' + t).hidden = t !== tab; });
    var btns = el('tabs').querySelectorAll('.tab');
    for (var i = 0; i < btns.length; i++) btns[i].classList.toggle('active', btns[i].getAttribute('data-tab') === tab);
  }
  function sandboxChanged() {
    ui.autoSize = el('sbAuto').checked;
    ui.deposit = Math.max(1, Number(el('sbDep').value) || FARM_CFG.defDep);
    ui.holdDays = Math.max(1, Number(el('sbDays').value) || FARM_CFG.defDays);
    ui.poolPct = Number(el('sbPool').value) || 8;
    drawBoard();
    if (!el('overlay').hidden && ui.openSlug) showDetail(ui.openSlug);
  }
  populateSelect(el('cat'), CAT_NAMES);
  populateSelect(el('chain'), CHAIN_NAMES);
  el('meta').innerHTML = 'Snapshot <b>' + escapeHtml(LL.a) + '</b><br><b>' + LL.t + '</b> protocols tracked · <b>' + LL.w + '</b> watchlist<br><b>' + ROWS.length + '</b> launch candidates';
  bind('tabs', 'click', function (e) { var b = e.target.closest('.tab'); if (b) selectTab(b.getAttribute('data-tab')); });
  bind('sbAuto', 'change', sandboxChanged);
  bind('sbDep', 'input', sandboxChanged);
  bind('sbDays', 'input', sandboxChanged);
  bind('sbPool', 'change', sandboxChanged);
  bind('q', 'input', function (e) { ui.query = e.target.value.trim().toLowerCase(); drawBoard(); });
  bind('cat', 'change', function (e) { ui.catFilter = e.target.value; drawBoard(); });
  bind('chain', 'change', function (e) { ui.chainFilter = e.target.value; drawBoard(); });
  bind('verd', 'change', function (e) { ui.verdFilter = e.target.value; drawBoard(); });
  bind('wl', 'change', function (e) { ui.watchlistOnly = e.target.checked; drawBoard(); });
  bind('mintvl', 'input', function (e) { ui.minTvl = Number(e.target.value) || 0; drawBoard(); });
  bind('rstBtn', 'click', function () {
    ui.query = ''; ui.catFilter = ''; ui.chainFilter = ''; ui.verdFilter = ''; ui.watchlistOnly = false; ui.minTvl = 0; ui.sortKey = 'rank'; ui.sortDir = 1;
    ['q', 'cat', 'chain', 'verd', 'mintvl'].forEach(function (id) { el(id).value = ''; });
    el('wl').checked = false;
    drawBoard();
  });
  bind('expBtn', 'click', downloadCsv);
  document.querySelectorAll('th button[data-sort]').forEach(function (b) {
    b.addEventListener('click', function (e) {
      var key = e.target.getAttribute('data-sort');
      if (ui.sortKey === key) ui.sortDir = -ui.sortDir;
      else { ui.sortKey = key; ui.sortDir = key === 'rank' ? 1 : -1; }
      drawBoard();
    });
  });
  bind('rows', 'click', function (e) {
    var chk = e.target.closest('.cmp-chk');
    if (chk) { e.stopPropagation(); toggleCompare(chk.getAttribute('data-cmp')); return; }
    var tr = e.target.closest('tr[data-slug]');
    if (tr) showDetail(tr.getAttribute('data-slug'));
  });
  bind('cmpGo', 'click', showCompare);
  bind('cmpClr', 'click', function () { ui.compare = []; drawBoard(); });
  bind('overlay', 'click', function (e) { if (e.target.id === 'overlay') hideOverlay(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') hideOverlay(); });
  drawModel();
  drawAnchors();
  drawAudit();
  drawBoard();
})();
