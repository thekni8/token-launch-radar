(function () {
  'use strict';
  var R = LL.rows, CATS = LL.cats, CHAINS = LL.chains, MDL = LL.mdl || {};
  var FCFG = LL.farmCfg || { defDep: 1000, defDays: 90, minDep: 100, maxDep: 50000, tvlShare: 0.0005 };
  var GRID = LL.grid || [100, 200, 350, 500, 750, 1000, 1500, 2500, 4000, 6000, 10000, 15000, 25000, 35000, 50000];
  var VERD = ['SKIP', 'THIN', 'FARM'], VCLS = ['v-skip', 'v-thin', 'v-farm'];
  var TDN = '<td class="num">';
  var state = { tab: 'board', q: '', cat: '', chain: '', verd: '', wl: false, min: 0, sort: 'rank', dir: 1, auto: true, dep: FCFG.defDep, days: FCFG.defDays, pool: 8, cmp: [], openSlug: null };
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
  function fmtHr(v) {
    if (!isFinite(v)) return '$0.00/h';
    var s = v >= 0 ? '+' : '-', a = Math.abs(v);
    return s + '$' + a.toFixed(a > 0 && a < 0.01 ? 3 : 2) + '/h';
  }
  function ageText(d) { if (d < 0) return '—'; return d >= 365 ? (d / 365).toFixed(1) + 'y' : d + 'd'; }
  function median(arr) {
    if (!arr.length) return 0;
    var a = arr.slice().sort(function (x, y) { return x - y; }), m = a.length >> 1;
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  }
  function fPct(v) { return (v == null || isNaN(v)) ? '—' : (v * 100).toFixed(1) + '%'; }
  function fRho(v) { return (v == null || isNaN(v)) ? '—' : Number(v).toFixed(3); }
  function fMiss(v) { return (v == null || isNaN(v)) ? '—' : Number(v).toFixed(2) + '×'; }
  function evalFarmAt(tvl, imp, fees, dep, days, pool, cap) {
    var k = imp * (pool / 100) * (days / 90);
    var gross = imp > 0 ? k * (dep / (tvl + dep)) : 0;
    var net = gross - fees, roi = (net / dep) * 100, hr = net / (days * 24);
    var denom = k - fees, be = (imp > 0 && denom > 0) ? (fees * tvl) / denom : -1;
    var pays = be > 0 && be <= cap;
    var beLbl = pays ? 'pays from ' + fmt$(be) : 'no ticket pays';
    var v = imp <= 0 ? 0 : ((net >= 50 && roi >= 5) ? 2 : (net > 0 ? 1 : 0));
    return { dep: dep, gross: gross, fees: fees, net: net, roi: roi, hr: hr, hrLbl: fmtHr(hr), be: be, beLbl: beLbl, pays: pays, cap: cap, v: v };
  }
  function calcFarm(row) {
    var tvl = row[4], imp = row[6], fees = row[21] || 0;
    var days = state.days > 0 ? state.days : 1, pool = state.pool;
    var cap = Math.max(FCFG.minDep, Math.min(FCFG.maxDep, tvl * FCFG.tvlShare));
    if (!state.auto) return evalFarmAt(tvl, imp, fees, state.dep > 0 ? state.dep : 1, days, pool, cap);
    // Default sandbox settings: use the exact precomputed plan economics
    // serialised in the row. Recomputing from the sig4-rounded implied value
    // drifts the net by a cent vs board.json (e.g. $80.48 vs $80.49).
    if (days === FCFG.defDays && pool === 8 && row[31] > 0) {
      var dep0 = row[31], net0 = row[18], hr0 = row[32];
      return { dep: dep0, gross: net0 + fees, fees: fees, net: net0, roi: (net0 / dep0) * 100, hr: hr0, hrLbl: fmtHr(hr0), be: row[19] > 0 ? row[19] : -1, beLbl: row[33] || '', pays: row[19] > 0 && row[19] <= cap, cap: cap, v: row[17] };
    }
    var best = null, cands = [];
    for (var i = 0; i < GRID.length; i++) if (GRID[i] >= FCFG.minDep && GRID[i] <= cap) cands.push(GRID[i]);
    var rCap = Math.round(cap);
    if (rCap >= FCFG.minDep && (!cands.length || cands[cands.length - 1] < rCap)) cands.push(rCap);
    for (var j = 0; j < cands.length; j++) {
      var e = evalFarmAt(tvl, imp, fees, cands[j], days, pool, cap);
      if (e.net > 0 && (!best || e.net > best.net)) best = e;
    }
    if (best) return best;
    var fb = Math.round(Math.max(FCFG.minDep, Math.min(cap, state.dep > 0 ? state.dep : FCFG.defDep)));
    return evalFarmAt(tvl, imp, fees, fb, days, pool, cap);
  }
  function fill(t, n, c, d) { return t.split('{n}').join(n).split('{c}').join(c).split('{d}').join(d); }
  function tile(cls, lbl, val, ba) { return '<div' + (cls ? ' class="' + cls + '"' : '') + '><span>' + lbl + '</span><b' + (ba || '') + '>' + val + '</b></div>'; }
  function barRow(lbl, pct, cls, val) { return '<div class="bar-row"><span class="lbl">' + lbl + '</span><span class="bar"><i' + (cls ? ' class="' + cls + '"' : '') + ' style="width:' + pct + '%"></i></span><span class="val">' + val + '</span></div>'; }
  function farmPlan(row, f) {
    var cat = CATS[row[2]], name = row[1];
    var chains = row[3].map(function (i) { return CHAINS[i] || ''; });
    var fam = (LL.fam && LL.fam[cat]) || 'generic';
    var tpl = (LL.tpl && (LL.tpl[fam] || LL.tpl.generic)) || [];
    var c = CHAINS[row[20]] || chains[0] || 'Ethereum', d = '';
    for (var k = 0; k < chains.length; k++) if (chains[k] !== c) { d = chains[k]; break; }
    var dep = fmt$(f.dep), fee = fmt$(f.fees);
    return [
      'Deploy ' + dep + ' via ' + c + ' (~' + fee + ' round-trip fees): ' + fill(tpl[0] || '', name, c, d),
      fill(tpl[1] || '', name, c, d),
      fill(tpl[2] || '', name, c, d),
      fill(chains.length >= 2 && d ? LL.multi : LL.single, name, c, d),
      'Plan at ' + dep + ' for ' + state.days + 'd: ' + fmt$(f.net) + ' net (' + f.hrLbl + ', ' + f.roi.toFixed(1) + '% ROI) after ~' + fee + ' fees; ' + f.beLbl + ' — verdict ' + VERD[f.v] + '.'
    ];
  }
  function renderKpis() {
    var wlEv = [], farmN = 0;
    for (var i = 0; i < R.length; i++) { if (R[i][8] === 1) wlEv.push(R[i][6]); if (calcFarm(R[i]).v === 2) farmN++; }
    var lo = MDL.lo || {}, loo = MDL.loo || [], cal = MDL.cal || [];
    var auditTot = (LL.audit && LL.audit[6]) || LL.t;
    var tiles = [
      ['Watchlist Covered', wlEv.length + '/' + LL.w, 'Median EV ' + money(median(wlEv))],
      ['Launch Odds LOO', fPct(lo.looAcc), (lo.looOk || 0) + '/' + (lo.n || LL.t) + ' right vs ' + fPct(lo.baseAcc) + ' base'],
      ['Value LOO Miss', fMiss(loo[1]), fPct(loo[2]) + ' ≤2× · ' + fPct(loo[3]) + ' ≤3× (' + (loo[5] || MDL.fitN || 0) + ' refits)'],
      ['Range Holds', fPct(cal[2]) + ' / ' + fPct(cal[4]), 'P25–75 (50% id.) · P10–90 (80% id.)'],
      ['FARM Rated', String(farmN), (state.auto ? 'Auto-sized' : dollars(state.dep)) + ' · ' + state.days + 'd · ' + state.pool + '%'],
      ['Snapshot Accounted', auditTot + '/' + LL.t, (LL.kinN || 0) + ' board rows flagged kin']
    ];
    $('kpis').innerHTML = tiles.map(function (t) {
      return '<div class="kpi"><span class="k-lbl">' + esc(t[0]) + '</span><b class="k-val">' + esc(t[1]) + '</b><span class="k-sub">' + esc(t[2]) + '</span></div>';
    }).join('');
  }
  function buildScatter(anch) {
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
    function ln(x1, y1, x2, y2, cls) { return '<line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '" class="' + cls + '"/>'; }
    var out = ['<svg class="scat" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="LOO predicted vs actual market cap log-log scatter">'];
    for (var t = Math.ceil(lo); t <= Math.floor(hi); t++) {
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
        '"><title>TVL ' + esc(money(p[2])) + ' | Actual ' + esc(money(p[3])) + ' | LOO Pred ' + esc(money(p[4])) + ' (' + ratio.toFixed(2) + '×)</title></circle>');
    }
    out.push('<text x="' + (PL + PW / 2) + '" y="' + (H - 3) + '" text-anchor="middle" class="ax-lbl">Actual Market Cap (log10)</text>');
    out.push('<text x="12" y="' + (PT + PH / 2) + '" text-anchor="middle" transform="rotate(-90 12 ' + (PT + PH / 2) + ')" class="ax-lbl">LOO Predicted (log10)</text>');
    out.push('</svg><div class="scat-leg"><span class="dot-ok"></span> Within 2× <span class="dot-out"></span> &gt;2× — solid: y = x, dashed: 2× band (LOO predictions)</div>');
    return out.join('');
  }
  function renderModel() {
    var el = (MDL.el != null ? MDL.el : (LL.el / 1000)).toFixed(3);
    var int10 = MDL.int != null ? (MDL.int / Math.LN10).toFixed(2) : '—';
    var loo = MDL.loo || [], cal = MDL.cal || [], lo = MDL.lo || {};
    var catMults = (LL.catf || []).filter(function (c) { return c[0] > 0; }).map(function (c) { return Math.exp(c[1] / 1000); });
    var catMin = catMults.length ? Math.min.apply(null, catMults).toFixed(2) : '1.00';
    var catMax = catMults.length ? Math.max.apply(null, catMults).toFixed(2) : '1.00';
    var gText = MDL.gKept && MDL.gCoef != null ? 'exp(' + MDL.gCoef.toFixed(3) + '·asinh(chg7d/100))' : '1.00 (dropped by CV)';
    var aText = MDL.aKept && MDL.aCoef != null ? 'exp(' + MDL.aCoef.toFixed(3) + '·ln(1+age/365))' : '1.00 (dropped by CV)';
    $('mdlSummary').textContent = '— EV = 10^' + int10 + ' × TVL^' + el + ' × cat × P(launch) · LOO ' + fMiss(loo[1]) + ' · Range holds ' + fPct(cal[2]) + '/' + fPct(cal[4]);
    $('mdlNarrative').innerHTML =
      '<p>Every board row is ranked by <b>Expected Value = Value-if-Launches × Launch Odds</b>, calibrated from <b>' + (MDL.fitN || 0) + '</b> tokenised anchors (' + (MDL.out || 0) + ' outliers dropped) and all <b>' + (lo.n || LL.t) + '</b> snapshot protocols:</p>' +
      '<p class="formula">implied = 10<sup>' + int10 + '</sup> &times; TVL<sup>' + el + '</sup> &times; category &times; growth &times; age &times; launch odds</p>' +
      '<ul class="terms">' +
      '<li><b>10<sup>' + int10 + '</sup></b>: global circulating-mcap intercept (natural-log ' + (MDL.int != null ? MDL.int.toFixed(3) : '—') + ').</li>' +
      '<li><b>TVL<sup>' + el + '</sup></b>: sub-linear size elasticity (&lt;1 prevents linear-multiple overvaluation of huge TVL).</li>' +
      '<li><b>category</b>: empirical-Bayes shrunk offset (×' + catMin + '–×' + catMax + ', weight <i>n</i>/(<i>n</i>+8)).</li>' +
      '<li><b>growth</b>: ' + gText + ' · <b>age</b>: ' + aText + '.</li>' +
      '<li><b>launch odds</b>: cohort tokenisation share (age band + category), shrunk to ' + fPct(lo.base) + ' base rate (<i>k</i>=' + (lo.k || 10) + ').</li></ul>';
    var cv = MDL.cv || [], big = MDL.cvBig || [], base = MDL.base || [], hold = MDL.hold || [];
    var cvRows = [
      ['LOO (125 refits, selected)', loo[5], loo[1], loo[0], loo[2], loo[3], loo[4]],
      ['5-fold CV (Model, all)', cv[3], null, cv[0], cv[1], null, cv[2]],
      ['5-fold CV (TVL ≥ $10M)', big[3], null, big[0], big[1], null, big[2]],
      ['Baseline (Global Median)', cv[3], null, base[0], base[1], null, base[2]],
      ['Newest-Listed Holdout', hold[2], null, hold[0], hold[1], null, null]
    ];
    $('mdlCv').innerHTML = cvRows.map(function (r) {
      return '<tr><td>' + r[0] + '</td>' + TDN + (r[1] || '—') + '</td>' + TDN + fMiss(r[2]) + '</td>' + TDN + fPct(r[3]) + '</td>' + TDN + fPct(r[4]) + '</td>' + TDN + fPct(r[5]) + '</td>' + TDN + fRho(r[6]) + '</td></tr>';
    }).join('');
    $('mdlCal').innerHTML =
      '<div class="cal-grid">' +
      tile('', 'P25–P75 RANGE HOLDS', fPct(cal[2]) + ' (' + (cal[1] || 0) + '/' + (cal[0] || 0) + ') — 50% if exact') +
      tile('', 'P10–P90 RANGE HOLDS', fPct(cal[4]) + ' (' + (cal[3] || 0) + '/' + (cal[0] || 0) + ') — 80% if exact') +
      '</div><p class="muted sm">Checked on out-of-bag held-out anchors across 250 seeded bootstrap refits (parameter-uncertainty bands; honest coverage reported even when narrow).</p>';
    $('mdlAbl').innerHTML = (MDL.abl || []).map(function (s) {
      var stCls = s[8] === 'selected' ? 'v-farm' : (s[8] === 'dropped' ? 'v-skip' : 'v-thin');
      return '<tr' + (s[7] ? ' class="sel-row"' : '') + '><td>' + esc(s[1]) + '</td>' + TDN + fMiss(s[4]) + '</td>' + TDN + fPct(s[3]) + '</td>' +
        TDN + fPct(s[5]) + '</td>' + TDN + fPct(s[6]) + '</td><td><span class="pill ' + stCls + '">' + esc(String(s[8]).toUpperCase()) + '</span></td></tr>';
    }).join('') || '<tr><td colspan="6">No ablation data.</td></tr>';
    $('mdlLoMeta').innerHTML =
      'Base rate: <b>' + (lo.tok || 0) + '/' + (lo.n || LL.t) + ' (' + fPct(lo.base) + ')</b> &middot; ' +
      'LOO called right: <b>' + (lo.looOk || 0) + '/' + (lo.n || LL.t) + ' (' + fPct(lo.looAcc) + ')</b> vs base-rate alone <b>' + fPct(lo.baseAcc) + '</b> (shrinkage k=' + (lo.k || 10) + ', undated k=' + (lo.uk || 20) + ').';
    $('mdlLoBands').innerHTML = (lo.bands || []).map(function (b) {
      return '<tr><td>' + esc(b[0]) + '</td>' + TDN + b[1] + '</td>' + TDN + b[2] + '</td>' + TDN + fPct(b[3]) + '</td></tr>';
    }).join('');
    $('mdlLoCaveat').textContent = 'Launch odds = share of similar protocols (same age band + category) that already record a token, shrunk to the ' + fPct(lo.base) + ' base rate. It predicts no launch: a protocol here records no token, which is not proof it has none, and any protocol may launch tomorrow — these odds are a cohort base rate, not a forecast of a single protocol.';
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
      var lp = anch[i][3] || anch[i][2], r = anch[i][1] > 0 ? lp / anch[i][1] : 0;
      rats.push(r);
      if (r >= 0.5 && r <= 2) hit++;
    }
    var loo = MDL.loo || [];
    $('anchStats').innerHTML = '<div class="st-grid">' +
      tile('', 'Fit anchors (plotted)', (MDL.fitN || 0) + ' (' + anch.length + ')') +
      tile('', 'Outliers dropped', MDL.out || 0) +
      tile('', 'LOO median miss', fMiss(loo[1])) +
      tile('', 'LOO within 2× / 3×', fPct(loo[2]) + ' / ' + fPct(loo[3])) +
      tile('', 'Median anchor TVL', money(median(tvls))) +
      tile('', 'Sample LOO ≤2×', anch.length ? ((hit / anch.length) * 100).toFixed(1) + '%' : '—') + '</div>';
    $('anchRows').innerHTML = anch.map(function (a, idx) {
      var lp = a[3] || a[2], r = a[1] > 0 ? lp / a[1] : 0, ok = r >= 0.5 && r <= 2;
      return '<tr>' + TDN + (idx + 1) + '</td>' + TDN + dollars(a[0]) + '</td>' + TDN + dollars(a[1]) + '</td>' + TDN + dollars(a[2]) + '</td>' + TDN + dollars(lp) + '</td>' + TDN + r.toFixed(2) + '×</td>' +
        TDN + '<span class="pill ' + (ok ? 'v-farm' : 'v-thin') + '">' + (ok ? 'YES' : 'NO') + '</span></td></tr>';
    }).join('') || '<tr><td colspan="7">No anchors available.</td></tr>';
  }
  function renderAudit() {
    var part = LL.part || [];
    var sum = 0;
    for (var i = 0; i < part.length; i++) sum += part[i][3];
    var tot = LL.t || sum || 1;
    $('auditCards').innerHTML =
      tile('aud-card', 'Tracked Snapshot', LL.t) +
      tile('aud-card', 'Sum of ' + part.length + ' Buckets', sum) +
      tile('aud-card', 'Reconciliation', sum === LL.t ? 'EXACT MATCH' : 'DELTA ' + (LL.t - sum), ' class="' + (sum === LL.t ? 'up' : 'down') + '"') +
      tile('aud-card', 'Kin of a Token (Board)', (LL.kinN || 0) + ' flagged (info only)');
    $('auditRows').innerHTML = part.map(function (b) {
      var pct = ((b[3] / tot) * 100).toFixed(1) + '%';
      var gCls = b[2] === 'board' ? 'v-farm' : (b[2] === 'anchors' ? 'v-thin' : 'v-skip');
      var slugs = b[4] || [];
      var slugHtml = slugs.length
        ? '<details class="slug-det"><summary>' + slugs.length + ' slugs</summary><div class="slug-list">' + slugs.map(esc).join(', ') + '</div></details>'
        : '<span class="muted">none</span>';
      return '<tr><td><b>' + esc(b[1]) + '</b></td>' + TDN + b[3] + '</td>' + TDN + pct + '</td>' +
        '<td><span class="pill ' + gCls + '">' + esc(String(b[2]).toUpperCase()) + '</span></td><td>' + slugHtml + '</td></tr>';
    }).join('') + '<tr class="aud-tot"><td><b>Total Snapshot</b></td>' + TDN + '<b>' + sum + ' / ' + LL.t + '</b></td>' + TDN + '<b>100.0%</b></td><td></td><td>100% mutually exclusive partition; board rows record no token.</td></tr>';
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
    if (s === 'val') return r[22];
    if (s === 'odds') return r[23];
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
    return '<div class="rbar" title="Expected-value rank range #' + lo + '–#' + hi + '">' +
      '<span style="left:' + left.toFixed(1) + '%;width:' + w.toFixed(1) + '%"></span><i style="left:' + dot.toFixed(1) + '%"></i></div>';
  }
  function rowHtml(item) {
    var row = item.row, rank = item.idx + 1, f = item.f;
    var chains = row[3].slice(0, 2).map(function (i) { return CHAINS[i] || ''; });
    var extra = row[3].length > 2 ? ' +' + (row[3].length - 2) : '';
    var chk = state.cmp.indexOf(row[0]) >= 0 ? ' checked' : '';
    var vPill = '<span class="pill ' + VCLS[f.v] + '">' + VERD[f.v] + '</span>';
    var oddsPct = (row[23] / 10).toFixed(0) + '%';
    var coh = row[24] || ['—', 0, 0, 0];
    var kinB = row[34] === 1 ? '<span class="badge kin" title="Kin of token: ' + esc((row[35] || []).join(', ')) + '">KIN</span>' : '';
    return '<tr data-slug="' + esc(row[0]) + '">' +
      '<td class="chk-col"><input type="checkbox" class="cmp-chk" data-cmp="' + esc(row[0]) + '"' + chk + ' aria-label="Compare ' + esc(row[1]) + '"></td>' +
      '<td class="num rank-cell"><b>#' + rank + '</b><span class="rng">' + row[13] + '–' + row[14] + '</span>' + rankBar(rank, row[13], row[14]) + '</td>' +
      '<td><b>' + esc(row[1]) + '</b>' + (row[8] === 1 ? '<span class="badge">WL</span>' : '') + kinB + '<br><span class="slug">' + esc(row[0]) + '</span></td>' +
      '<td>' + esc(CATS[row[2]]) + '</td><td class="chains">' + esc(chains.join(', ')) + esc(extra) + '</td>' +
      TDN + money(row[4]) + '</td>' +
      TDN + '<span>' + money(row[22]) + '</span><span class="rng">P25–75 ' + money(row[28]) + '–' + money(row[29]) + '</span></td>' +
      TDN + '<b class="odds">' + oddsPct + '</b><span class="rng">' + esc(coh[0]) + ' (' + coh[2] + '/' + coh[1] + ')</span></td>' +
      TDN + '<span class="implied">' + money(row[6]) + '</span><span class="rng">P25–75 ' + money(row[25]) + '–' + money(row[26]) + '</span></td>' +
      TDN + '<span class="' + (f.net >= 0 ? 'up' : 'down') + '">' + dollars(f.net) + '</span> ' + vPill + '<span class="rng">' + money(f.dep) + ' · ' + f.hrLbl + ' · ' + esc(f.beLbl) + '</span></td>' +
      TDN + ageText(row[7]) + '</td></tr>';
  }
  function renderBoard() {
    var list = filtered(), html = '';
    for (var i = 0; i < list.length; i++) html += rowHtml(list[i]);
    $('rows').innerHTML = html || '<tr><td colspan="11">No protocols match these filters.</td></tr>';
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
    var cf = row[10] / 1000, gf = row[11] / 1000, af = row[12] / 1000, loProb = row[23] / 1000;
    var coh = row[24] || ['—', 0, 0, 0];
    var el = (LL.el / 1000).toFixed(3);
    var chg = row[5] === null ? 'not reported' : (row[5] >= 0 ? '+' : '') + row[5].toFixed(2) + '% (7d)';
    var f = calcFarm(row);
    var cheapChain = CHAINS[row[20]] || chains[0] || '—';
    var steps = farmPlan(row, f).map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('');
    var inCmp = state.cmp.indexOf(slug) >= 0;
    var peers = [];
    for (var p = 0; p < R.length && peers.length < 4; p++) {
      if (p !== idx && R[p][2] === row[2]) peers.push('<button class="peer-btn" data-peer="' + esc(R[p][0]) + '">#' + (p + 1) + ' ' + esc(R[p][1]) + ' (' + money(R[p][6]) + ')</button>');
    }
    var cfPct = Math.min(100, Math.max(4, Math.round((cf / 2) * 100)));
    var loPct = Math.min(100, Math.max(4, Math.round(loProb * 100)));
    var kinHtml = row[34] === 1
      ? '<dt>Kin of a token</dt><dd><span class="badge kin">KIN</span> Matches tokenised stem: ' + esc((row[35] || []).join(', ')) + ' (informational only)</dd>'
      : '';
    $('detail').innerHTML =
      '<div class="det-act"><button class="btn" id="detCmp">' + (inCmp ? 'Remove from Compare' : '+ Add to Compare') + '</button>' +
      '<button class="btn" id="closeBtn">Close ×</button></div>' +
      '<h2>' + esc(row[1]) + (row[8] === 1 ? '<span class="badge">WATCHLIST</span>' : '') + (row[34] === 1 ? '<span class="badge kin">KIN</span>' : '') + '</h2>' +
      '<p class="sub">Rank #' + (idx + 1) + ' of ' + R.length + ' (range #' + row[13] + '–#' + row[14] + ') · ' + esc(row[0]) + ' · records no token</p>' +
      '<dl><dt>Category</dt><dd>' + esc(cat) + ' (' + (LL.catn[row[2]] || 0) + ' tokenised anchors)</dd>' +
      '<dt>Chains</dt><dd>' + esc(chains.join(', ')) + '</dd>' +
      '<dt>TVL / 7d</dt><dd>' + dollars(row[4]) + ' (' + esc(chg) + ')</dd>' +
      '<dt>Tenure &amp; Cohort</dt><dd>' + (row[7] < 0 ? 'Undated' : row[7] + ' days') + ' · Band <b>' + esc(coh[0]) + '</b> · ' + coh[2] + '/' + coh[1] + ' tokenised (weight ' + Math.round(coh[3] / 10) + '%)</dd>' +
      '<dt>Value if Launches</dt><dd><b>' + dollars(row[22]) + '</b> · P25–75: ' + money(row[28]) + '–' + money(row[29]) + ' · P10–90: ' + money(row[27]) + '–' + money(row[30]) + '</dd>' +
      '<dt>Expected Value</dt><dd><b class="implied">' + dollars(row[6]) + '</b> · P25–75: ' + money(row[25]) + '–' + money(row[26]) + ' · P10–90: ' + money(row[15]) + '–' + money(row[16]) + '</dd>' +
      kinHtml + '</dl>' +
      '<h3>Expected-Value Decomposition (TVL Elasticity ' + el + ')</h3>' +
      '<p class="break">Base ' + dollars(row[9]) + ' × cat ' + cf.toFixed(3) + ' × growth ' + gf.toFixed(3) +
      ' × age ' + af.toFixed(3) + ' = ' + dollars(row[22]) + ' × launch odds ' + (loProb * 100).toFixed(1) + '% = <span class="tot">' + dollars(row[6]) + ' EV</span></p>' +
      barRow('Category factor', cfPct, '', '×' + cf.toFixed(3)) +
      barRow('Launch odds (' + esc(coh[0]) + ')', loPct, 'tel', (loProb * 100).toFixed(1) + '%') +
      '<h3>Deposit-Sized Farm Plan (' + (state.auto ? 'Auto-sized' : 'Fixed') + ' ' + dollars(f.dep) + ' · ' + state.days + 'd · ' + state.pool + '% pool)</h3>' +
      '<div class="econ-grid">' +
      tile('', 'Verdict', VERD[f.v], ' class="pill ' + VCLS[f.v] + '"') +
      tile('', 'Plan Deposit', dollars(f.dep) + ' (cap ' + money(f.cap) + ')') +
      tile('', 'Net Return', dollars(f.net), ' class="' + (f.net >= 0 ? 'up' : 'down') + '"') +
      tile('', 'Net / Hour', f.hrLbl, ' class="' + (f.hr >= 0 ? 'up' : 'down') + '"') +
      tile('', 'Breakeven', f.beLbl) +
      tile('', 'Fees (' + esc(cheapChain) + ') / ROI', fmt$(f.fees) + ' · ' + f.roi.toFixed(1) + '%') + '</div>' +
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
      ['Category / Tenure', function (it) { return esc(CATS[it.row[2]]) + ' · ' + ageText(it.row[7]); }],
      ['TVL', function (it) { return dollars(it.row[4]); }],
      ['Value if Launches', function (it) { return dollars(it.row[22]) + ' (P25–75 ' + money(it.row[28]) + '–' + money(it.row[29]) + ')'; }],
      ['Launch Odds (cohort)', function (it) { var c = it.row[24] || ['—', 0, 0]; return (it.row[23] / 10).toFixed(1) + '% (' + esc(c[0]) + ' ' + c[2] + '/' + c[1] + ')'; }],
      ['Expected Value', function (it) { return '<b class="implied">' + dollars(it.row[6]) + '</b>'; }],
      ['EV P25–P75 / P10–P90', function (it) { return money(it.row[25]) + '–' + money(it.row[26]) + ' / ' + money(it.row[15]) + '–' + money(it.row[16]); }],
      ['Plan Deposit / Chain', function (it, f) { return dollars(f.dep) + ' on ' + esc(CHAINS[it.row[20]] || '—') + ' (' + fmt$(f.fees) + ')'; }],
      ['Net / Net-per-Hour', function (it, f) { return '<b class="' + (f.net >= 0 ? 'up' : 'down') + '">' + dollars(f.net) + '</b> (' + f.hrLbl + ')'; }],
      ['Breakeven / ROI', function (it, f) { return esc(f.beLbl) + ' · ' + f.roi.toFixed(1) + '%'; }],
      ['Verdict', function (it, f) { return '<span class="pill ' + VCLS[f.v] + '">' + VERD[f.v] + '</span>'; }]
    ];
    var body = spec.map(function (s) {
      return '<tr><td><b>' + esc(s[0]) + '</b></td>' + items.map(function (it) { return '<td>' + s[1](it, calcFarm(it.row)) + '</td>'; }).join('') + '</tr>';
    }).join('');
    $('detail').innerHTML =
      '<div class="det-act"><button class="btn" id="closeBtn">Close ×</button></div>' +
      '<h2>Side-by-Side Comparison</h2>' +
      '<p class="sub">' + (state.auto ? 'Auto-sized deposit per protocol' : dollars(state.dep) + ' fixed deposit') + ' · ' + state.days + ' days · ' + state.pool + '% airdrop pool</p>' +
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
    var head = ['Rank', 'RankLow', 'RankHigh', 'Name', 'Slug', 'Category', 'Chains', 'TVL_USD', 'ValueIfLaunch_USD', 'LaunchOdds_Pct', 'ExpectedValue_USD', 'EV_P25_USD', 'EV_P75_USD', 'EV_P10_USD', 'EV_P90_USD', 'Age_Days', 'Watchlist', 'KinFlag', 'CheapestChain', 'Fees_USD', 'PlanDeposit_USD', 'HoldingDays', 'Pool_Pct', 'Net_USD', 'NetPerHour_USD', 'ROI_Pct', 'Breakeven', 'Verdict'];
    var lines = [head.join(',')];
    for (var i = 0; i < list.length; i++) {
      var r = list[i].row, f = list[i].f, chains = r[3].map(function (c) { return CHAINS[c] || ''; }).join('|');
      lines.push([
        list[i].idx + 1, r[13], r[14], q(r[1]), q(r[0]), q(CATS[r[2]]), q(chains), Math.round(r[4]),
        Math.round(r[22]), (r[23] / 10).toFixed(1), Math.round(r[6]), Math.round(r[25]), Math.round(r[26]),
        Math.round(r[15]), Math.round(r[16]), r[7] < 0 ? '' : r[7], r[8], r[34], q(CHAINS[r[20]] || ''),
        r[21].toFixed(2), Math.round(f.dep), state.days, state.pool, f.net.toFixed(2), f.hr.toFixed(4),
        f.roi.toFixed(2), q(f.beLbl), VERD[f.v]
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
    state.auto = $('sbAuto').checked;
    state.dep = Math.max(1, Number($('sbDep').value) || FCFG.defDep);
    state.days = Math.max(1, Number($('sbDays').value) || FCFG.defDays);
    state.pool = Number($('sbPool').value) || 8;
    renderBoard();
    if (!$('overlay').hidden && state.openSlug) openDetail(state.openSlug);
  }
  fillSelect($('cat'), CATS);
  fillSelect($('chain'), CHAINS);
  $('meta').innerHTML = 'Snapshot <b>' + esc(LL.a) + '</b><br><b>' + LL.t + '</b> protocols tracked · <b>' + LL.w + '</b> watchlist<br><b>' + R.length + '</b> launch candidates';
  on('tabs', 'click', function (e) { var b = e.target.closest('.tab'); if (b) switchTab(b.getAttribute('data-tab')); });
  on('sbAuto', 'change', onSandbox);
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
