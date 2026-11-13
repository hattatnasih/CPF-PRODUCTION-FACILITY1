/* HBJF — DCS-style operator UI. Pure DOM/SVG/canvas, no dependencies, works offline in an Android WebView. */
(function () {
  'use strict';
  var E = window.CPFEngine, cfg = window.CPF_CONFIG || {};
  var plant = E.createPlant(cfg);
  var s = function () { return plant.s; };
  var $ = function (id) { return document.getElementById(id); };
  var NS = 'http://www.w3.org/2000/svg';
  var VBW = 1900, VBH = 1000;

  // ------------------------------------------------------------------ helpers
  function h(tag, attrs, kids) {
    var e = document.createElement(tag);
    if (attrs) for (var k in attrs) { if (k === 'text') e.textContent = attrs[k]; else if (k === 'html') e.innerHTML = attrs[k]; else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), attrs[k]); else e.setAttribute(k, attrs[k]); }
    (kids || []).forEach(function (c) { if (c) e.appendChild(c); });
    return e;
  }
  function fmt(v, unit) {
    if (v === undefined || v === null || isNaN(v)) return '--';
    var d = unit === 'barg' ? 2 : (unit === 'm3/h' || unit === 'Sm3/h' || unit === 'ppm') ? 0 : 1;
    if (unit === '%' && Math.abs(v) < 2) d = 2;
    return v.toFixed(d);
  }
  function clock(t) { t = Math.floor(t); var hh = Math.floor(t / 3600), mm = Math.floor(t % 3600 / 60), ss = t % 60; return [hh, mm, ss].map(function (x) { return (x < 10 ? '0' : '') + x; }).join(':'); }
  var toastT;
  function toast(msg, err) { var t = $('toast'); t.textContent = msg; t.className = 'toast' + (err ? ' err' : ''); clearTimeout(toastT); toastT = setTimeout(function () { t.className = 'toast hidden'; }, 2600); }
  function act(a, id, v) { var r = plant.cmd(a, id, v); if (r && r.ok === false && r.msg) toast(r.msg, true); return r; }
  var tg = function (t) { return plant.tag(t); };
  function pct(x) { return Math.max(0, Math.min(100, x)); }
  var UNIT = { 'm3/h': 'm³/h', 'Sm3/h': 'Sm³/h' };

  // ------------------------------------------------------------------ equipment tables
  var LOOP_DEF = {}, LOOP_OF_VALVE = {};
  plant.LOOP_DEFS.forEach(function (d) { LOOP_DEF[d[0]] = d; LOOP_OF_VALVE[d[10]] = d[0]; });
  var EQ = {
    'WELLS':  { title: 'Wells W-1…W-3 / production manifold MF-1', tags: ['PT-000', 'TT-000', 'FT-001'], special: 'wells' },
    'ESDV':   { title: 'ESDV-001 inlet shutdown valve', tags: ['FT-001'], special: 'esdv' },
    'V-001': { title: 'V-001 slug catcher', tags: ['LT-001', 'LI-002', 'PT-001', 'TT-001'], loops: ['LIC-001', 'LIC-002', 'PIC-001'], special: 'drain:DR-001' },
    'HX-1':  { title: 'HX-1 thermal (hot oil) heat exchanger', tags: ['TT-001', 'TT-106', 'TT-107'], special: 'hx1' },
    'V-100':  { title: 'V-100 1st stage separator', tags: ['LT-101', 'LI-102', 'PT-101', 'TT-106'], loops: ['LIC-101', 'LIC-102', 'PIC-101'], special: 'drain:DR-101' },
    'V-210':  { title: 'V-210 hot-oil exchanger (V-210)', tags: ['TT-106', 'TT-103', 'TT-101'], loops: ['TIC-103'] },
    'HT-200':  { title: 'HT-200 heater treater', tags: ['LT-103', 'LI-104', 'TT-102', 'PT-102', 'AT-103'], equip: ['E-103'], loops: ['TIC-102', 'LIC-103', 'LIC-104', 'PIC-102'], special: 'dem', drain: 'DR-102' },
    'P-101A': { title: 'P-101A transfer pump', tags: ['LT-103', 'VT-101A'], equip: ['P-101A'], special: 'auto:P-101' },
    'P-101B': { title: 'P-101B transfer pump', tags: ['LT-103', 'VT-101B'], equip: ['P-101B'], special: 'auto:P-101' },
    'MF-2':   { title: 'MF-2 oil manifold: gate valves GV-1 / GV-2 / GV-3 / GV-4', tags: ['TT-102', 'AT-103'], special: 'mf2' },
    'C-101':  { title: 'C-101 stripping column & E-104 reboiler', tags: ['LT-105', 'PT-104', 'TT-104', 'AT-102', 'AT-103', 'FT-N2'], loops: ['TIC-104', 'LIC-105', 'PIC-104'], extra: ['mf2'] },
    'HO-1':   { title: 'HO-1 hot oil heater', tags: ['TT-101'], equip: ['HO-1'], loops: ['TIC-101'] },
    'E-105':  { title: 'E-105 oil fan cooler (with bypass BV-CL)', tags: ['TT-107', 'TT-105', 'TT-110'], loops: ['TIC-105'], special: 'cooler' },
    'V-110':  { title: 'V-110 2nd stage separator', tags: ['LT-106', 'LI-107', 'PT-103', 'TT-110', 'AT-101', 'AT-102'], loops: ['LIC-106', 'LIC-107', 'PIC-103'], special: 'drain:DR-103', extra: ['cooler'] },
    'TK-410':  { title: 'TK-410 storage tank (cold vent to LP flare)', tags: ['LT-201', 'AT-201', 'FT-201', 'PT-410', 'FT-405'], loops: ['FIC-201'], special: 'route', extra: ['vent'] },
    'P-201A': { title: 'P-201A export pump', tags: ['FT-201', 'LT-201', 'VT-201A'], equip: ['P-201A'], special: 'auto:P-201' },
    'P-201B': { title: 'P-201B export pump', tags: ['FT-201', 'LT-201', 'VT-201B'], equip: ['P-201B'], special: 'auto:P-201' },
    'TK-430':  { title: 'TK-430 slop tank', tags: ['LT-202'], equip: ['P-501'] },
    'TK-420':  { title: 'TK-420 produced water tank', tags: ['LT-301', 'AT-301', 'FT-301'], loops: ['LIC-301'] },
    'P-301A': { title: 'P-301A disposal pump', tags: ['LT-301', 'FT-301', 'VT-301A'], equip: ['P-301A'], special: 'auto:P-301' },
    'P-301B': { title: 'P-301B disposal pump', tags: ['LT-301', 'FT-301', 'VT-301B'], equip: ['P-301B'], special: 'auto:P-301' },
    'V-401':  { title: 'V-401 flare knock-out drum (FKOD)', tags: ['PT-401', 'LT-401', 'FT-401'], loops: ['LIC-401'], special: 'auto:P-401' },
    'P-401A': { title: 'P-401A FKOD pump', tags: ['LT-401', 'VT-401A'], equip: ['P-401A'], special: 'auto:P-401' },
    'P-401B': { title: 'P-401B FKOD pump', tags: ['LT-401', 'VT-401B'], equip: ['P-401B'], special: 'auto:P-401' },
    'FLARE':  { title: 'FL-401 flare stack', tags: ['PT-401', 'FT-401'], special: 'flare' },
    'UTIL':   { title: 'Utilities & ambient', tags: ['PT-901', 'TT-900'], special: 'util' },
    'LACT':   { title: 'LACT custody-transfer skid', tags: ['FT-202', 'AT-202', 'QT-202', 'FT-201'], special: 'lact' },
    'FUELGAS': { title: 'Fuel gas header & flare purge', tags: ['PT-902', 'FT-402', 'LT-402'], special: 'fuel' },
    'WTRT':   { title: 'Produced water treatment (hydrocyclone)', tags: ['AT-300', 'AT-301', 'FT-301', 'LT-301'], special: 'wtrt' },
    'CHEM':   { title: 'Chemical injection', tags: ['AT-501'], special: 'chem' },
    'POWER':  { title: 'Power generation G-1 / G-2 (2 x generator)', tags: ['JT-901', 'JI-901'], equip: ['G-1', 'G-2'], special: 'power' },
    'N2PKG':  { title: 'N2 package (stripping gas to C-101)', tags: ['FT-N2', 'PT-N2', 'AT-103', 'AT-102'], equip: ['N2-PKG'], special: 'n2' },
    'LPF':    { title: 'FL-402 LP flare (TK-410 cold vent)', tags: ['PT-405', 'FT-405', 'PT-410'], special: 'lpf' }
  };
  var EQ_NAME = { 'G-1': 'G-1 generator (60 s run-up)', 'G-2': 'G-2 generator (60 s run-up)', 'N2-PKG': 'N2 package (30 s start)', 'HO-1': 'HO-1 hot oil heater (30 s purge)', 'E-103': 'E-103 heater treater burner (30 s purge)', 'P-501': 'P-501 slop pump (return to V-001)' };
  var TAG_EQ = { 'PT-000': 'WELLS', 'TT-000': 'WELLS', 'FT-001': 'WELLS', 'LT-001': 'V-001', 'LI-002': 'V-001', 'PT-001': 'V-001', 'TT-001': 'V-001', 'TT-106': 'HX-1', 'TT-107': 'HX-1',
    'LT-101': 'V-100', 'LI-102': 'V-100', 'PT-101': 'V-100', 'TT-103': 'V-210', 'TT-101': 'HO-1', 'TT-102': 'HT-200', 'LT-103': 'HT-200', 'LI-104': 'HT-200', 'PT-102': 'HT-200', 'AT-103': 'HT-200',
    'LT-105': 'C-101', 'PT-104': 'C-101', 'TT-104': 'C-101', 'AT-102': 'C-101', 'TT-105': 'E-105', 'LT-106': 'V-110', 'LI-107': 'V-110', 'PT-103': 'V-110', 'AT-101': 'V-110',
    'PT-401': 'V-401', 'LT-401': 'V-401', 'FT-401': 'FLARE', 'LT-201': 'TK-410', 'AT-201': 'TK-410', 'FT-201': 'TK-410', 'LT-202': 'TK-430', 'LT-301': 'TK-420', 'AT-301': 'TK-420', 'FT-301': 'TK-420', 'PT-901': 'UTIL' };
  var TAG_EQ2 = { 'PT-902': 'FUELGAS', 'FT-402': 'FUELGAS', 'LT-402': 'FLARE', 'AT-202': 'LACT', 'FT-202': 'LACT', 'QT-202': 'LACT', 'AT-501': 'CHEM', 'AT-300': 'WTRT', 'JT-901': 'POWER', 'JI-901': 'POWER', 'TT-900': 'UTIL', 'FT-T1': 'WELLS', 'AT-T1': 'WELLS' };
  for (var tk2 in TAG_EQ2) TAG_EQ[tk2] = TAG_EQ2[tk2];
  TAG_EQ['TT-110'] = 'V-110'; TAG_EQ['FT-N2'] = 'N2PKG'; TAG_EQ['PT-N2'] = 'N2PKG'; TAG_EQ['PT-410'] = 'TK-410'; TAG_EQ['PT-405'] = 'LPF'; TAG_EQ['FT-405'] = 'LPF'; TAG_EQ['AT-103'] = 'HT-200';
  ['101A', '101B', '201A', '201B', '301A', '301B', '401A', '401B'].forEach(function (n) { TAG_EQ['VT-' + n] = 'P-' + n; });
  var ALM_EQ = {};
  plant.ALARM_DEFS.forEach(function (d) { ALM_EQ[d[0]] = TAG_EQ[d[2]]; });
  ['P-101A', 'P-101B', 'P-201A', 'P-201B', 'P-301A', 'P-401A'].forEach(function (p) { ALM_EQ[p + ' TRIP'] = p; });
  ['P-301B', 'P-401B', 'P-201B'].forEach(function (p) { ALM_EQ[p + ' TRIP'] = p; });
  ['G-1 TRIP', 'G-2 TRIP', 'LOAD SHED', 'POWER OVERLOAD'].forEach(function (a) { ALM_EQ[a] = 'POWER'; });
  ['LACT DIVERT', 'LACT PROVE DUE', 'LACT SAMPLER FULL'].forEach(function (a) { ALM_EQ[a] = 'LACT'; });
  ['101A', '101B', '201A', '201B', '301A', '301B', '401A', '401B'].forEach(function (n) { ALM_EQ['SEAL ' + n] = 'P-' + n; });
  ALM_EQ['SEAL 501'] = 'TK-430';
  ALM_EQ['N2 PKG TRIP'] = 'N2PKG'; ALM_EQ['LP PILOT OUT'] = 'LPF'; ALM_EQ['TK410 PVRV LIFT'] = 'TK-410'; ALM_EQ['TK410 VACUUM'] = 'TK-410'; ALM_EQ['AAH-103'] = 'C-101';
  ['F&G OVERRIDE', 'F&G KEY', 'SIS BYPASS', 'OVR EXPIRING'].forEach(function (a) { ALM_EQ[a] = 'FGSTAB'; });
  plant.FG_ZONES.forEach(function (zz) {
    var Z = zz[0]; ALM_EQ['FGS CONF ' + Z] = 'FGS:' + Z; ALM_EQ['DET FAULT ' + Z] = 'FGS:' + Z; ALM_EQ['ZONE BLIND ' + Z] = 'FGS:' + Z;
    plant.FG_KEYS.forEach(function (k) { var pre = plant.FG_TYPES[k].pre; ALM_EQ[pre + 'A-' + Z + ' LOW'] = 'FGS:' + Z; ALM_EQ[pre + 'A-' + Z + ' HIGH'] = 'FGS:' + Z; });
  });
  ALM_EQ['HO-1 TRIP'] = 'HO-1'; ALM_EQ['E-103 TRIP'] = 'HT-200'; ALM_EQ['PILOT OUT'] = 'FLARE'; ALM_EQ['PSV OPEN'] = 'V-001'; ALM_EQ['POWER FAIL'] = 'UTIL';

  var AREAS = [
    ['Overview', 0, 0, VBW, VBH], ['Wells & SC', 0, 20, 600, 520], ['Separation', 560, 20, 460, 520], ['Treater', 980, 20, 460, 500], ['Stripping', 1380, 20, 520, 620],
    ['Flare', 1560, 20, 340, 330], ['MF-2 / N2', 1220, 60, 520, 520], ['TK-410 / LP flare', 1100, 470, 560, 340], ['Cooling', 470, 500, 600, 320], ['Storage', 1060, 500, 680, 480], ['Water', 0, 420, 520, 580], ['Slop', 1050, 740, 500, 260], ['Packages', 420, 830, 740, 170], ['Export & LACT', 1380, 560, 520, 440]
  ];

  // ------------------------------------------------------------------ mimic (SVG)
  var upd = [];
  var viewUpd = {};
  var FG_KEYS_L = plant.FG_KEYS;
  var svg = $('mimic');
  function S(tag, attrs, parent) { var e = document.createElementNS(NS, tag); for (var k in attrs) e.setAttribute(k, attrs[k]); (parent || svg).appendChild(e); return e; }
  function txt(x, y, t, cls, parent, anchor) { var e = S('text', { x: x, y: y, 'class': cls || '', 'text-anchor': anchor || 'start' }, parent); e.textContent = t; return e; }
  function pipe(d, cls, flowFn) {
    S('path', { d: d, 'class': 'pipe ' + (cls || '') });
    if (flowFn) { var f = S('path', { d: d, 'class': 'flow ' + (cls || '') }); upd.push(function () { var on = flowFn() > 0.5; var c = 'flow ' + (cls || '') + (on ? ' on' : ''); if (f.getAttribute('class') !== c) f.setAttribute('class', c); }); }
  }
  function eqGroup(id, parent) { var g = S('g', { 'class': 'eq', 'data-id': id }, parent); g.addEventListener('click', function () { openSheet(id); }); return g; }
  function inside(parent, x, y, prefix, tag, anchor) {
    var e = txt(x, y, '--', 'in', parent, anchor || 'start');
    upd.push(function () { var q = tg(tag); e.textContent = prefix + ' ' + fmt(q.v, q.unit) + (q.unit === '%' ? '%' : q.unit === 'barg' ? ' bar' : q.unit === '°C' ? '°C' : q.unit === 'psi' ? ' psi' : q.unit === 'ppm' ? ' ppm' : ''); });
  }
  function readout(parent, x, y, label, tag, anchor) {
    if (label) txt(x, y, label, 'tagl', parent, anchor);
    var t = txt(x, y + (label ? 14 : 0), '--', 'val', parent, anchor);
    upd.push(function () { var q = tg(tag); t.textContent = fmt(q.v, q.unit) + ' ' + (UNIT[q.unit] || q.unit); });
  }
  // ISA instrument bubble: DCS-mounted (line through circle). target: loop id or tag
  function bubble(x, y, name, target, o) {
    o = o || {};
    var parts = name.split('-'), g = S('g', { 'class': 'eq inst', 'data-id': o.eq || ('INST:' + name) });
    g.addEventListener('click', function () { if (LOOP_DEF[name]) openSheet('LOOP:' + name); else openSheet('INST:' + name); });
    var c = S('circle', { cx: x, cy: y, r: 14, 'class': 'bub' }, g);
    S('line', { x1: x - 14, y1: y, x2: x + 14, y2: y, 'class': 'bubl' }, g);
    txt(x, y - 3, parts[0], 'bt', g, 'middle'); txt(x, y + 10, parts[1] || '', 'bt', g, 'middle');
    var tag = target || name, vt = null, mt = null;
    if (!o.noval) { vt = txt(x, y + 28, '--', 'bv', g, 'middle'); }
    if (LOOP_DEF[name]) mt = txt(x + 18, y - 8, 'A', 'bm', g);
    upd.push(function () {
      var q = tg(LOOP_DEF[name] ? LOOP_DEF[name][9] : tag);
      if (vt && q) vt.textContent = fmt(q.v, q.unit) + (q.unit === '%' ? '%' : q.unit === 'barg' ? '' : q.unit === '°C' ? '°' : ' ' + (UNIT[q.unit] || q.unit));
      if (mt) { var L = plant.loops[name]; mt.textContent = L.mode === 'AUTO' ? 'A' : 'M'; mt.setAttribute('class', 'bm' + (L.mode === 'AUTO' ? '' : ' man')); }
      var ar = alarmOf(LOOP_DEF[name] ? LOOP_DEF[name][9] : tag), cl = 'bub' + (ar ? ' almc' + ar : '');
      if (c.getAttribute('class') !== cl) c.setAttribute('class', cl);
    });
    return g;
  }
  function alarmOf(tag) {   // worst active (not RTN) priority for any alarm on this tag; cached per refresh
    var w = 0; plant.ALARM_DEFS.forEach(function (d) { if (d[2] !== tag) return; var a = plant.alarms[d[0]]; if (a && a.state !== 'NORMAL' && a.state !== 'RTN_UNACK') { if (!w || d[5] < w) w = d[5]; } });
    return w;
  }
  // control valve with diaphragm actuator + its loop bubble
  function ctl(loopId, x, y, o) {
    o = o || {};
    var d = LOOP_DEF[loopId], vid = d[10], vert = o.v;
    var g = S('g', { 'class': 'eq', 'data-id': 'LOOP:' + loopId }); g.addEventListener('click', function () { openSheet('LOOP:' + loopId); });
    var w = S('g', vert ? { transform: 'rotate(90 ' + x + ' ' + y + ')' } : {}, g);
    S('rect', { x: x - 14, y: y - 24, width: 28, height: 34, fill: 'transparent' }, w);
    var p = S('path', { d: 'M' + (x - 10) + ',' + (y - 7) + ' L' + (x + 10) + ',' + (y + 7) + ' L' + (x + 10) + ',' + (y - 7) + ' L' + (x - 10) + ',' + (y + 7) + ' Z', 'class': 'vlv' }, w);
    S('path', { d: 'M' + x + ',' + y + ' V' + (y - 14) + ' M' + (x - 8) + ',' + (y - 14) + ' a8,8 0 0 1 16,0 Z', 'class': 'act' }, w);
    var t = txt(o.tx !== undefined ? x + o.tx : x, o.ty !== undefined ? y + o.ty : y + 22, '0%', 'vp', g, o.ta || 'middle');
    upd.push(function () { var pos = s().valves[vid].pos; p.setAttribute('fill-opacity', (.12 + pos / 100 * .85).toFixed(2)); t.textContent = Math.round(pos) + '%'; });
    if (!o.nob) bubble(x + (o.dx !== undefined ? o.dx : 0), y + (o.dy !== undefined ? o.dy : -42), loopId, null, { eq: 'LOOP:' + loopId });
    return g;
  }
  function hvalve(id, x, y, o) {   // hand valve (slider on faceplate)
    o = o || {};
    var g = S('g', { 'class': 'eq', 'data-id': 'HV:' + id }); g.addEventListener('click', function () { openSheet('HV:' + id); });
    var w = S('g', o.v ? { transform: 'rotate(90 ' + x + ' ' + y + ')' } : {}, g);
    S('rect', { x: x - 14, y: y - 16, width: 28, height: 28, fill: 'transparent' }, w);
    var p = S('path', { d: 'M' + (x - 9) + ',' + (y - 6) + ' L' + (x + 9) + ',' + (y + 6) + ' L' + (x + 9) + ',' + (y - 6) + ' L' + (x - 9) + ',' + (y + 6) + ' Z', 'class': 'vlv' }, w);
    S('path', { d: 'M' + x + ',' + y + ' V' + (y - 11) + ' M' + (x - 6) + ',' + (y - 11) + ' H' + (x + 6), 'class': 'act' }, w);
    txt(o.lx !== undefined ? x + o.lx : x, o.ly !== undefined ? y + o.ly : y + 24, id, 'tagl', g, o.la || 'middle');
    var t = txt(o.lx !== undefined ? x + o.lx : x, (o.ly !== undefined ? y + o.ly : y + 24) + 11, '0%', 'vp', g, o.la || 'middle');
    upd.push(function () { var pos = s().hv[id]; p.setAttribute('fill-opacity', (.12 + pos / 100 * .85).toFixed(2)); t.textContent = Math.round(pos) + '%'; });
  }
  function xvalve(label, x, y, openFn, o) {  // shutdown / on-off valve with spring-return actuator box
    o = o || {};
    var g = S('g', { 'class': 'eq', 'data-id': o.eq || 'ESDV' }); g.addEventListener('click', function () { openSheet(o.eq || 'ESDV'); });
    S('rect', { x: x - 14, y: y - 28, width: 28, height: 40, fill: 'transparent' }, g);
    var p = S('path', { d: 'M' + (x - 10) + ',' + (y - 7) + ' L' + (x + 10) + ',' + (y + 7) + ' L' + (x + 10) + ',' + (y - 7) + ' L' + (x - 10) + ',' + (y + 7) + ' Z', 'class': 'vlv' }, g);
    S('path', { d: 'M' + x + ',' + y + ' V' + (y - 10), 'class': 'act' }, g);
    S('rect', { x: x - 9, y: y - 24, width: 18, height: 14, 'class': 'act' }, g);
    txt(x, y - 13, 'S', 'bt', g, 'middle');
    txt(x, y + 21, label, 'tagl', g, 'middle');
    var t = txt(x, y + 32, '', 'vp', g, 'middle');
    upd.push(function () { var f = openFn(); p.setAttribute('fill-opacity', (.12 + f * .85).toFixed(2)); t.textContent = Math.round(f * 100) + '%'; });
  }
  function pump(id, x, y, o) {
    o = o || {};
    var g = eqGroup(id), c = S('circle', { cx: x, cy: y, r: 14, 'class': 'pumpc' }, g);
    S('path', { d: 'M' + (x - 6) + ',' + (y - 7) + ' L' + (x + 8) + ',' + y + ' L' + (x - 6) + ',' + (y + 7) + ' Z', 'class': 'pumpt' }, g);
    S('path', { d: 'M' + (x + 4) + ',' + (y - 13) + ' V' + (y - 20) + ' H' + (x + 14), 'class': 'pipe', style: 'stroke-width:2' }, g);
    txt(x, y + 28, id, 'tagl', g, 'middle');
    upd.push(function () { var st = s().pumps[id]; var cl = 'pumpc ' + st; if (c.getAttribute('class') !== cl) c.setAttribute('class', cl); });
  }
  var cpN = 0;
  function fills(parent, x, y, w, hg, o, clipDef) {
    var oil = S('rect', { x: x, width: w, fill: o.oil || '#2f6a9c', opacity: .75 }, parent);
    var wat = S('rect', { x: x, width: w, fill: '#1f8f84', opacity: .85 }, parent);
    var tl = o.lvl, ti = o.ifc;
    upd.push(function () {
      var L = tl ? tg(tl).v : 0, I = ti ? tg(ti).v : 0;
      var top = o.sump ? hg * o.sump : hg, base = y + hg;
      var hw = top * Math.min(I, 100) / 100, ho = top * Math.min(L, 100) / 100;
      wat.setAttribute('y', base - hw); wat.setAttribute('height', hw);
      oil.setAttribute('y', base - ho); oil.setAttribute('height', Math.max(ho - hw, 0));
    });
  }
  function hvessel(id, x, y, w, hg, o) {    // horizontal vessel (capsule), optional water boot
    var g = eqGroup(id), cp = 'cp' + (cpN++), rx = hg / 2.4;
    var def = S('clipPath', { id: cp }, g); S('rect', { x: x, y: y, width: w, height: hg, rx: rx }, def);
    if (o.boot) { var bx = o.boot; S('rect', { x: bx - 10, y: y + hg - 2, width: 20, height: 20, rx: 3, 'class': 'vessel', 'data-box': id }, g); }
    S('rect', { x: x, y: y, width: w, height: hg, rx: rx, 'class': 'vessel', 'data-box': id }, g);
    var liq = S('g', { 'clip-path': 'url(#' + cp + ')' }, g); fills(liq, x, y, w, hg, o);
    S('path', { d: 'M' + (x + w * 0.62) + ',' + y + ' V' + (y + hg), 'class': 'weir' }, g);
    txt(x + w / 2, y - 8, id, 'eqn', g, 'middle'); if (o.sub) txt(x + w / 2, y + hg + (o.boot ? 38 : 16), o.sub, 'tagl', g, 'middle');
    return g;
  }
  function vvessel(id, x, y, w, hg, o) {   // vertical vessel / column
    var g = eqGroup(id), cp = 'cp' + (cpN++), rx = Math.min(w / 2.5, 14);
    var def = S('clipPath', { id: cp }, g); S('rect', { x: x, y: y, width: w, height: hg, rx: rx }, def);
    S('rect', { x: x, y: y, width: w, height: hg, rx: rx, 'class': 'vessel', 'data-box': id }, g);
    var liq = S('g', { 'clip-path': 'url(#' + cp + ')' }, g); fills(liq, x, y, w, hg, o);
    txt(x + w / 2, y - 8, id, 'eqn', g, 'middle'); if (o.sub) txt(x + w / 2, y + hg + 16, o.sub, 'tagl', g, 'middle');
    return g;
  }
  function tank(id, x, y, w, hg, o) {
    var g = eqGroup(id), cp = 'cp' + (cpN++);
    var def = S('clipPath', { id: cp }, g); S('rect', { x: x, y: y, width: w, height: hg }, def);
    S('path', { d: 'M' + x + ',' + y + ' L' + (x + w / 2) + ',' + (y - 16) + ' L' + (x + w) + ',' + y, 'class': 'vessel', 'data-box': id, fill: 'none' }, g);
    S('rect', { x: x, y: y, width: w, height: hg, 'class': 'vessel', 'data-box': id }, g);
    var liq = S('g', { 'clip-path': 'url(#' + cp + ')' }, g); fills(liq, x, y, w, hg, o);
    txt(x + w / 2, y - 24, id, 'eqn', g, 'middle'); if (o.sub) txt(x + w / 2, y + hg + 16, o.sub, 'tagl', g, 'middle');
    return g;
  }
  function hxsym(id, cx, cy, r, o) {        // ISA heat exchanger: circle + zig-zag (tube side horizontal)
    var g = eqGroup(id); o = o || {};
    S('circle', { cx: cx, cy: cy, r: r, 'class': 'vessel', 'data-box': id }, g);
    var d = 'M' + (cx - r) + ',' + cy + ' L' + (cx - r * .6) + ',' + cy, n = 6, i;
    for (i = 0; i < n; i++) d += ' L' + (cx - r * .6 + (i + .5) * (r * 1.2 / n)) + ',' + (cy + (i % 2 ? -r * .4 : r * .4));
    d += ' L' + (cx + r * .6) + ',' + cy + ' L' + (cx + r) + ',' + cy;
    S('path', { d: d, 'class': 'zig' }, g);
    txt(cx, cy - r - 8, id, 'eqn', g, 'middle'); if (o.sub) txt(cx, cy + r + (o.subDy || 36), o.sub, 'tagl', g, 'middle');
    return g;
  }
  function flame(x, y, cls) { return S('path', { d: 'M' + x + ',' + (y + 12) + ' q-9,-8 -2,-18 q2,6 5,2 q4,6 -3,16 Z', 'class': 'flame ' + (cls || '') }); }

  // ---------------------------------------------------------------- flowsheet
  function buildMimic() {
    svg.innerHTML = ''; upd = [];
    var F = function () { return s().flows; };
    txt(24, 36, (cfg.facilityName || 'CPF') + ' — OIL TRAIN', 'title');
    var legend = ['oil / crude', 'gas to flare', 'produced water', 'hot oil', 'drain / slop'], lc = ['', 'gas', 'water', 'hot', 'drain'];
    legend.forEach(function (l, i) { S('path', { d: 'M' + (24 + i * 150) + ',58 h24', 'class': 'pipe ' + lc[i] }); txt(54 + i * 150, 62, l, 'tagl'); });

    // ---------- pipes (drawn first, equipment on top)
    var inl = function () { return s().inl.q; };
    ['W-1', 'W-2', 'W-3'].forEach(function (w, i) { var y = 150 + i * 90; pipe('M92,' + y + ' H150', '', function () { return s().wells[w].open ? inl() * s().wells[w].share : 0; }); });
    pipe('M150,150 V330', '', inl);
    pipe('M150,270 H250', '', inl);
    pipe('M430,270 H476 M554,270 H640', '', function () { return F().qSC; });
    pipe('M800,270 H876 M924,270 H1000', '', function () { return F().q101; });
    pipe('M960,270 V130 H1390', '', function () { return F().qBH; });                 // BV-HT bypass
    pipe('M1200,290 H1230 V410 M1230,350 H1262 M1230,410 H1262', '', function () { return F().q103; });
    pipe('M1288,350 H1330 M1288,410 H1330 M1330,410 V270 H1390', '', function () { return F().q103; });
    pipe('M1390,130 V340', '', function () { return F().qM; });
    pipe('M1390,270 H1470', '', function () { return F().qCin; });
    pipe('M1390,345 V362 M1362,362 H1418 M1362,362 V520 M1418,362 V520', '', function () { return F().qDir; });   // GV-3 / GV-4 straight bypass legs
    pipe('M560,640 V530 H800 V640', '', function () { return F().qHX * F().fcb; });                                 // cooler bypass BV-CL to V-110 tie-in
    pipe('M1600,294 V335 H1550', 'gas', function () { return s().n2.flow; });                                       // N2 to stripper
    pipe('M1275,552 V532 H1470 V600 H1500', 'gas', function () { return s().lpf.flow; });                             // TK-410 cold vent to LP flare
    pipe('M1510,400 V520 H545 V640 H600', '', function () { return F().qHX; });          // stripped crude straight to the cooler
    pipe('M905,450 H515 V294', 'hot', function () { return s().ho.burner === 'ON' ? 1 : 0; });   // hot oil to HX-1
    pipe('M740,640 H860', '', function () { return F().qHX; });
    pipe('M1020,640 H1170', '', function () { return s().routeNow === 'TANK' ? F().q106 : 0; });
    pipe('M1100,640 V860 H1150', '', function () { return s().routeNow === 'SLOP' ? F().q106 : 0; });
    pipe('M1310,700 H1346 M1346,670 V730 M1346,670 H1371 M1346,730 H1371', '', function () { return s().exp.q; });
    pipe('M1399,670 H1430 M1399,730 H1430 M1430,670 V730 M1430,700 H1700', '', function () { return s().exp.q; });
    // gas
    var gh = 'M330,70 H1660 V150 H1700';
    pipe(gh, 'gas', function () { return F().gSC + F().g101 + F().gHT + F().gCol + F().g103; });
    pipe('M330,230 V70', 'gas', function () { return F().gSC; });
    pipe('M700,230 V70', 'gas', function () { return F().g101; });
    pipe('M1040,215 V70', 'gas', function () { return F().gHT; });
    pipe('M1510,130 V70', 'gas', function () { return F().gCol; });
    pipe('M990,600 V70', 'gas', function () { return F().g103; });
    pipe('M1780,200 H1850 V100', 'gas', function () { return s().flare.flow; });
    // water
    pipe('M345,350 V480 M715,350 V480 M1085,350 V480 M1085,480 H105 V790', 'water', function () { return F().qSCw + F().q102w + F().q104w; });
    pipe('M940,710 V770 H105', 'water', function () { return F().q107w; });
    pipe('M135,860 H230 M290,860 H350 M410,860 H460', 'water', function () { return F().disp; });
    // hot oil
    pipe('M1600,520 H1570 V450 H905 V294', 'hot', function () { return s().ho.burner === 'ON' ? 1 : 0; });
    pipe('M1650,470 V405', 'hot', function () { return s().ho.burner === 'ON' ? 1 : 0; });
    // reboiler loop
    pipe('M1550,370 H1600 M1550,395 H1600', '', function () { return F().qCin; });
    // drains / slop
    pipe('M1780,250 V285 M1745,320 V860 H1880 V300 M1880,300 H1790', 'drain', function () { return 0; });

    // ---------- wells & MF-1
    ['W-1', 'W-2', 'W-3'].forEach(function (w, i) {
      var y = 150 + i * 90, g = S('g', { 'class': 'eq well', 'data-id': 'WELLS' }); g.addEventListener('click', function () { openSheet('WELLS'); });
      var tr = S('path', { d: 'M62,' + (y + 26) + ' V' + (y - 18) + ' M50,' + (y - 6) + ' H74 M62,' + (y - 18) + ' h-6 M62,' + (y - 18) + ' h6 M62,' + (y + 4) + ' H92 M76,' + (y - 2) + ' l8,12 M76,' + (y + 10) + ' l8,-12', 'class': 'tree' }, g);
      S('rect', { x: 40, y: y - 30, width: 56, height: 62, fill: 'transparent' }, g);
      txt(62, y + 46, w, 'eqn', g, 'middle');
      upd.push(function () { var c = 'tree' + (s().wells[w].open ? ' on' : ''); if (tr.getAttribute('class') !== c) tr.setAttribute('class', c); });
    });
    txt(150, 112, 'MF-1', 'eqn', svg, 'middle');
    var gw = eqGroup('WELLS'); S('rect', { x: 140, y: 140, width: 20, height: 200, fill: 'transparent' }, gw);
    bubble(110, 372, 'PT-000', 'PT-000'); bubble(190, 372, 'FT-001', 'FT-001');
    xvalve('ESDV-001', 205, 270, function () { return s().esdv.pos / 100; });

    // ---------- V-001 slug catcher
    var g = hvessel('V-001', 250, 225, 180, 90, { lvl: 'LT-001', ifc: 'LI-002', boot: 345, sub: 'Slug catcher' });
    inside(g, 262, 252, 'L', 'LT-001'); inside(g, 262, 267, 'P', 'PT-001'); inside(g, 262, 282, 'T', 'TT-001');
    ctl('PIC-001', 330, 160, { v: true, dx: 56, dy: 0 }); ctl('LIC-001', 455, 270, { dy: -46 }); ctl('LIC-002', 345, 415, { v: true, dx: 56, dy: 0 });
    hvalve('DR-001', 372, 342, { lx: 14, ly: 4, la: 'start' });
    var psvSC = S('path', { d: 'M395,225 V205 m-6,0 h12 l-6,-10 Z', 'class': 'psv' }); txt(400, 202, 'PSV-001', 'tagl');
    upd.push(function () { psvSC.setAttribute('class', 'psv' + (s().sc.psv ? ' lift' : '')); });
    xvalve('BDV-001', 430, 160, function () { return s().bdv ? 1 : 0; }, { eq: 'ESDV' });
    pipe('M430,168 V70', 'gas');

    // ---------- HX-1
    var gx = hxsym('HX-1', 515, 270, 24, { sub: 'HX-1 thermal (hot oil)' });
    S('rect', { x: 490, y: 246, width: 50, height: 48, fill: 'transparent' }, gx);
    bubble(580, 335, 'TT-106', 'TT-106'); bubble(460, 335, 'TT-107', 'TT-107');

    // ---------- V-100
    g = hvessel('V-100', 640, 230, 160, 80, { lvl: 'LT-101', ifc: 'LI-102', boot: 715, sub: '1st stage separator' });
    inside(g, 652, 256, 'L', 'LT-101'); inside(g, 652, 271, 'P', 'PT-101');
    ctl('PIC-101', 700, 160, { v: true, dx: 56, dy: 0 }); ctl('LIC-101', 825, 270, { dy: -46 }); ctl('LIC-102', 715, 415, { v: true, dx: 56, dy: 0 });
    hvalve('DR-101', 742, 340, { lx: 14, ly: 4, la: 'start' });

    // ---------- V-210
    gx = hxsym('V-210', 900, 270, 24, { sub: 'V-210 hot oil' });
    ctl('TIC-103', 905, 380, { v: true, dx: 56, dy: 0 }); bubble(960, 330, 'TT-103', 'TT-103');
    hvalve('BV-HT', 1000, 130, { ly: -22 }); txt(1000, 112, 'bypass HT-200', 'tagl', svg, 'middle');

    // ---------- HT-200 heater treater
    g = hvessel('HT-200', 1000, 215, 200, 100, { lvl: 'LT-103', ifc: 'LI-104', boot: 1085, sub: 'Heater treater' });
    var ft = S('path', { d: 'M1022,290 H1150 q16,0 16,-12 q0,-12 -16,-12 H1060', 'class': 'firetube' }, g);
    var st = S('path', { d: 'M1166,270 V160 H1182 V270', 'class': 'stack' }); txt(1174, 152, 'stack', 'tagl', svg, 'middle');
    var htFlame = flame(1008, 288, 'off'); txt(1008, 320, 'E-103', 'tagl', svg, 'middle');
    upd.push(function () { var b = s().ht.burner; htFlame.setAttribute('class', 'flame ' + b); ft.setAttribute('class', 'firetube' + (b === 'ON' ? ' hot' : '')); });
    inside(g, 1030, 238, 'L', 'LT-103'); inside(g, 1030, 253, 'T', 'TT-102'); inside(g, 1120, 238, 'P', 'PT-102'); inside(g, 1120, 253, 'BSW', 'AT-103');
    ctl('PIC-102', 1040, 165, { v: true, dx: 56, dy: 0 }); ctl('TIC-102', 1060, 360, { v: true, dx: 56, dy: 0, nob: true });
    bubble(1128, 360, 'TIC-102', null, { noval: false });
    ctl('LIC-104', 1085, 415, { v: true, dx: 56, dy: 0 });
    hvalve('DR-102', 1112, 342, { lx: 14, ly: 4, la: 'start' });
    var psvHT = S('path', { d: 'M1010,215 V200 m-6,0 h12 l-6,-10 Z', 'class': 'psv' });
    upd.push(function () { psvHT.setAttribute('class', 'psv' + (s().ht.psv ? ' lift' : '')); });

    // ---------- P-101A/B and LCV-103
    pump('P-101A', 1275, 350); pump('P-101B', 1275, 410);
    ctl('LIC-103', 1330, 330, { v: true, dx: 56, dy: 0 });

    // ---------- MF-2
    var gm = eqGroup('MF-2'); S('rect', { x: 1380, y: 125, width: 20, height: 220, rx: 6, 'class': 'vessel', 'data-box': 'MF-2' }, gm); txt(1390, 112, 'MF-2', 'eqn', gm, 'middle');
    hvalve('GV-1', 1430, 270, { ly: 22 }); txt(1430, 247, 'stripper in', 'tagl', svg, 'middle');
    hvalve('GV-2', 1510, 490, { lx: 18, ly: 2, la: 'start' }); txt(1528, 480, 'stripper out', 'tagl');
    hvalve('GV-3', 1362, 420, { v: true, lx: -16, ly: 2, la: 'end' }); hvalve('GV-4', 1418, 420, { v: true, lx: 16, ly: 2, la: 'start' });
    txt(1390, 402, 'bypass to', 'tagl', svg, 'middle'); txt(1390, 413, 'cooler', 'tagl', svg, 'middle');

    // ---------- C-101 stripping column + E-104 reboiler
    g = vvessel('C-101', 1470, 130, 80, 270, { lvl: 'LT-105', sump: 0.28, sub: 'Stripping column' });
    for (var i = 0; i < 9; i++) S('path', { d: 'M1472,' + (150 + i * 18) + ' H' + (i % 2 ? 1530 : 1548), 'class': 'tray' }, g);
    inside(g, 1478, 316, 'L', 'LT-105'); inside(g, 1478, 331, 'P', 'PT-104'); inside(g, 1478, 346, 'T', 'TT-104'); inside(g, 1478, 361, 'RVP', 'AT-102');
    ctl('PIC-104', 1510, 100, { v: true, dx: -56, dy: 0 }); ctl('LIC-105', 1510, 450, { v: true, dx: -56, dy: 0 });
    var gr = eqGroup('C-101'); S('rect', { x: 1600, y: 352, width: 100, height: 52, rx: 20, 'class': 'vessel', 'data-box': 'C-101' }, gr);
    S('path', { d: 'M1612,378 l12,-12 l12,24 l12,-24 l12,24 l12,-24 l12,24 l12,-12', 'class': 'zig' }, gr); txt(1650, 424, 'E-104 reboiler', 'tagl', gr, 'middle');
    ctl('TIC-104', 1650, 438, { v: true, dx: 56, dy: 0 });

    // ---------- HO-1 hot oil heater
    var gh1 = eqGroup('HO-1'); S('rect', { x: 1600, y: 470, width: 140, height: 100, rx: 6, 'class': 'vessel', 'data-box': 'HO-1' }, gh1);
    var coil = S('path', { d: 'M1616,500 H1724 M1616,520 H1724 M1616,540 H1724', 'class': 'firetube' }, gh1);
    S('path', { d: 'M1752,470 V420 H1766 V470', 'class': 'stack' }); txt(1718, 590, 'HO-1', 'eqn', gh1, 'middle');
    var hoFlame = flame(1670, 566, 'off'); var hoT = txt(1670, 490, '--', 'in', gh1, 'middle');
    upd.push(function () { var b = s().ho.burner; hoFlame.setAttribute('class', 'flame ' + b); coil.setAttribute('class', 'firetube' + (b === 'ON' ? ' hot' : '')); hoT.textContent = 'T ' + fmt(tg('TT-101').v, '°C') + '°C'; });
    ctl('TIC-101', 1760, 520, { dx: 0, dy: 70, nob: false }); txt(1600, 612, 'fuel gas → TCV-101', 'tagl');

    // ---------- E-105 oil cooler (air fin)
    var ge = eqGroup('E-105'); S('rect', { x: 600, y: 610, width: 140, height: 60, 'class': 'vessel', 'data-box': 'E-105' }, ge);
    for (i = 0; i < 6; i++) S('path', { d: 'M' + (620 + i * 20) + ',616 V664', 'class': 'tray' }, ge);
    S('circle', { cx: 670, cy: 590, r: 18, 'class': 'vessel', 'data-box': 'E-105' }, ge); var fan = S('path', { d: 'M652,590 H688 M670,572 V608 M657,577 L683,603 M683,577 L657,603', 'class': 'zig fan' }, ge);
    S('path', { d: 'M670,608 V610', 'class': 'pipe' }, ge); txt(670, 694, 'E-105 oil cooler', 'tagl', ge, 'middle');
    upd.push(function () { var sp = s().valves['FAN-105'].pos; fan.setAttribute('class', 'zig fan' + (sp > 5 && s().power.on ? ' spin' : '')); fan.style.animationDuration = (sp > 5 ? (2.2 - sp / 60).toFixed(2) : 0) + 's'; });
    hvalve('BV-CL', 680, 530, { ly: -26 }); txt(716, 513, 'cooler bypass', 'tagl'); bubble(825, 585, 'TT-110', 'TT-110');
    ctl('TIC-105', 640, 760, { dx: 56, dy: 0, nob: false, v: false, ty: 22 }); bubble(770, 590, 'TT-105', 'TT-105');
    S('path', { d: 'M640,740 V672', 'class': 'dash' });

    // ---------- V-110 2nd stage separator
    g = hvessel('V-110', 860, 600, 160, 80, { lvl: 'LT-106', ifc: 'LI-107', boot: 940, sub: '2nd stage separator' });
    inside(g, 872, 626, 'L', 'LT-106'); inside(g, 872, 641, 'P', 'PT-103'); inside(g, 872, 656, 'BSW', 'AT-101');
    ctl('PIC-103', 990, 560, { v: true, dx: 56, dy: 0 }); ctl('LIC-106', 1060, 640, { dy: -46 }); ctl('LIC-107', 940, 745, { v: true, dx: 56, dy: 0 });
    hvalve('DR-103', 970, 700, { lx: 14, ly: 4, la: 'start' });
    bubble(880, 570, 'AT-101', 'AT-101', { noval: false }); bubble(920, 570, 'AT-102', 'AT-102');
    // route valves
    var rt = S('g', { 'class': 'eq', 'data-id': 'TK-410' }); rt.addEventListener('click', function () { openSheet('TK-410'); });
    var xt = S('path', { d: 'M1121,634 L1139,646 L1139,634 L1121,646 Z', 'class': 'vlv' }, rt), xs = S('path', { d: 'M1094,776 L1106,794 L1118,776 L1094,794 Z', 'class': 'vlv', transform: 'rotate(0)' }, rt);
    txt(1130, 664, 'to TK-410', 'tagl', rt, 'middle'); txt(1112, 812, 'to slop', 'tagl', rt, 'start');
    upd.push(function () { xt.setAttribute('fill-opacity', s().routeNow === 'TANK' ? .9 : .1); xs.setAttribute('fill-opacity', s().routeNow === 'SLOP' ? .9 : .1); });

    // ---------- TK-410 and export
    g = tank('TK-410', 1170, 560, 140, 180, { lvl: 'LT-201', sub: 'Storage tank' }); inside(g, 1180, 600, 'L', 'LT-201'); inside(g, 1180, 616, 'BSW', 'AT-201');
    pump('P-201A', 1385, 670); pump('P-201B', 1385, 730);
    ctl('FIC-201', 1560, 700, { dy: -46 }); bubble(1660, 640, 'FT-201', 'FT-201'); txt(1540, 748, 'EXPORT PIPELINE ►', 'eqn', svg);

    // ---------- TK-430 slop tank, TK-420 water, disposal pumps
    g = tank('TK-430', 1150, 810, 100, 120, { lvl: 'LT-202', oil: '#7a6a30', sub: 'Slop tank' }); inside(g, 1160, 850, 'L', 'LT-202');
    pump('P-501', 1320, 890); txt(1350, 884, '→ V-001 recycle', 'tagl'); pipe('M1250,890 H1306', 'drain', function () { return s().pumps['P-501'] === 'RUNNING' ? 1 : 0; });
    g = tank('TK-420', 60, 790, 90, 140, { lvl: 'LT-301', oil: '#1f8f84', sub: 'Produced water' }); inside(g, 68, 830, 'L', 'LT-301'); inside(g, 68, 846, 'OiW', 'AT-301');
    pump('P-301A', 230, 860); pump('P-301B', 290, 860); ctl('LIC-301', 380, 860, { dy: -46 }); txt(430, 840, 'DISPOSAL ►', 'eqn');
    bubble(190, 930, 'FT-301', 'FT-301');

    // ---------- V-401 FKOD, flare
    g = vvessel('V-401', 1700, 100, 80, 150, { lvl: 'LT-401', oil: '#7a6a30', sub: 'Flare KO drum' }); inside(g, 1708, 130, 'P', 'PT-401'); inside(g, 1708, 145, 'L', 'LT-401');
    pump('P-401A', 1730, 330); pump('P-401B', 1790, 330); ctl('LIC-401', 1760, 285, { v: true, dx: -50, dy: 0 });
    var gf = eqGroup('FLARE'); S('rect', { x: 1843, y: 100, width: 14, height: 160, 'class': 'vessel', 'data-box': 'FLARE' }, gf); var fl = flame(1850, 92, 'ON'); fl.setAttribute('transform', 'translate(1850 92) scale(2.2) translate(-1850 -92)');
    var pil = txt(1850, 280, '', 'in', gf, 'middle'); txt(1850, 296, 'FL-401', 'eqn', gf, 'middle'); S('rect', { x: 1800, y: 60, width: 100, height: 40, fill: 'transparent' }, gf);
    upd.push(function () { var p = s().flare.pilot, big = s().flare.flow > 1500; fl.setAttribute('class', 'flame ' + (p === 'ON' ? 'ON' : 'off') + (big ? ' big' : '')); pil.textContent = 'PILOT ' + p; pil.style.fill = p === 'ON' ? '#a9f0c7' : '#ff6b6b'; });
    bubble(1625, 120, 'PT-401', 'PT-401'); bubble(1650, 176, 'FT-401', 'FT-401');
    var psvFK = S('path', { d: 'M1740,100 V84 m-6,0 h12 l-6,-10 Z', 'class': 'psv' }); upd.push(function () { psvFK.setAttribute('class', 'psv' + (s().fk.psv ? ' lift' : '')); });
    txt(1790, 322 + 38, 'to slop ▼', 'tagl', svg, 'middle');

    // ---------- utilities
    var gu = eqGroup('UTIL'); S('rect', { x: 1400, y: 800, width: 480, height: 150, rx: 8, 'class': 'vessel', 'data-box': 'UTIL' }, gu);
    txt(1416, 826, 'UTILITIES & STATUS', 'eqn', gu); readout(gu, 1416, 850, 'INSTR AIR', 'PT-901');
    var ut = txt(1540, 866, '', 'val', gu); upd.push(function () { var q = s(); ut.textContent = 'IAC-A ' + q.ia.A + ' · IAC-B ' + q.ia.B; });
    var pw = txt(1540, 886, '', 'val', gu); upd.push(function () { pw.textContent = 'POWER ' + (s().power.on ? 'ON' : 'LOST'); pw.style.fill = s().power.on ? '#c8d6e6' : '#ff6b6b'; });
    var rf = txt(1416, 916, '', 'val', gu); upd.push(function () { var q = s(); rf.textContent = 'Route ' + q.route + ' → ' + q.routeNow + ' · Flared ' + Math.round(q.flare.total) + ' Sm³'; });
    var rg = txt(1416, 936, '', 'val', gu); upd.push(function () { var q = s(); rg.textContent = 'PSV ' + (q.sc.psv || q.v101.psv || q.ht.psv ? 'LIFTING' : 'closed') + ' · BDV ' + (q.bdv ? 'OPEN' : 'closed') + ' · auto-start ' + ['P-101', 'P-201', 'P-301', 'P-401'].map(function (k) { return q.auto[k] ? '●' : '○'; }).join(''); });
    // ---------- realism packages: LACT, fuel gas / purge, water treatment, chemicals, power, chokes
    function pkg(id, x, y, w, hg, title) { var g = eqGroup(id); S('rect', { x: x, y: y, width: w, height: hg, rx: 8, 'class': 'vessel', 'data-box': id }, g); txt(x + 10, y + 20, title, 'eqn', g); return g; }
    function dyn(g, x, y, fn, anchor) { var e = txt(x, y, '', 'in', g, anchor); upd.push(function () { var r = fn(); if (e.textContent !== r[0]) e.textContent = r[0]; e.style.fill = r[1] || ''; }); return e; }
    var RED = '#ff6b6b', GRN = '#a9f0c7', YEL = '#ffd479';
    // ---- N2 package (stripping gas), TK-410 PVRV, cold vent valve and LP flare FL-402
    var gn2 = pkg('N2PKG', 1568, 222, 126, 72, 'N2 PACKAGE');
    dyn(gn2, 1578, 254, function () { var st = s().n2.pkg; return ['N2-PKG ' + st, st === 'RUNNING' ? GRN : st === 'TRIPPED' ? RED : st === 'STARTING' ? YEL : '']; });
    inside(gn2, 1578, 269, 'HDR', 'PT-N2'); inside(gn2, 1578, 284, 'FLOW', 'FT-N2');
    hvalve('XV-N2', 1575, 335, { ly: -20 });
    var psvTK = S('path', { d: 'M1200,553 V541 m-5,0 h10 l-5,-8 Z', 'class': 'psv' }); txt(1190, 538, 'PVRV', 'tagl', svg, 'end');
    upd.push(function () { psvTK.setAttribute('class', 'psv' + (s().tank.lift ? ' lift' : '')); });
    hvalve('VENT-410', 1470, 570, { v: true, lx: -16, ly: 2, la: 'end' }); txt(1384, 550, 'cold vent to LP flare', 'tagl');
    bubble(1340, 578, 'PT-410', 'PT-410'); bubble(1560, 590, 'FT-405', 'FT-405');
    var glp = eqGroup('LPF'); S('rect', { x: 1500, y: 548, width: 14, height: 92, 'class': 'vessel', 'data-box': 'LPF' }, glp);
    var flp = flame(1507, 540, 'ON'); flp.setAttribute('transform', 'translate(1507 540) scale(1.5) translate(-1507 -540)');
    var lpt = txt(1507, 690, '', 'in', glp, 'middle'); txt(1507, 660, 'LP FLARE', 'eqn', glp, 'middle'); txt(1507, 674, 'FL-402', 'tagl', glp, 'middle'); S('rect', { x: 1480, y: 520, width: 60, height: 130, fill: 'transparent' }, glp);
    upd.push(function () { var p = s().lpf.pilot; flp.setAttribute('class', 'flame ' + (p === 'ON' ? 'ON' : 'off') + (s().lpf.flow > 120 ? ' big' : '')); lpt.textContent = 'PILOT ' + p; lpt.style.fill = p === 'ON' ? '#a9f0c7' : '#ff6b6b'; });
    var gl = pkg('LACT', 1700, 610, 190, 175, 'LACT SKID');
    pipe('M1664,700 H1890', '', function () { return s().exp.q; });
    bubble(1745, 652, 'FT-202', 'FT-202'); bubble(1805, 652, 'AT-202', 'AT-202');
    S('rect', { x: 1740, y: 688, width: 24, height: 24, 'class': 'vessel' }, gl); txt(1752, 704, 'M', 'in', gl, 'middle');
    S('rect', { x: 1800, y: 692, width: 18, height: 16, 'class': 'vessel' }, gl); txt(1809, 703, 'S', 'in', gl, 'middle');
    dyn(gl, 1710, 738, function () { var l = s().lact; return ['MF ' + l.mf.toFixed(4) + '  err ' + (l.dev * 100).toFixed(2) + '%', Math.abs(l.dev) > 0.003 ? YEL : '']; });
    dyn(gl, 1710, 754, function () { var l = s().lact; return ['BS&W ' + l.bsw.toFixed(2) + '%  pot ' + Math.round(l.samp) + '%', '']; });
    dyn(gl, 1710, 770, function () { var l = s().lact; return [l.divert ? 'DIVERT TO SLOP' : l.prove > 0 ? 'PROVING ' + Math.ceil(l.prove) + ' s' : 'ON SPEC · FLOW TO PIPELINE', l.divert ? RED : l.prove > 0 ? YEL : GRN]; });
    var gfu = pkg('FUELGAS', 440, 850, 165, 135, 'FUEL GAS & PURGE');
    inside(gfu, 452, 882, 'FG HDR', 'PT-902'); inside(gfu, 452, 900, 'PURGE', 'FT-402'); inside(gfu, 452, 918, 'SEAL DRUM', 'LT-402');
    dyn(gfu, 452, 940, function () { var ok = s().fg.P > 2.5; return [ok ? 'Burner gas available' : 'FUEL GAS LOW', ok ? GRN : RED]; }); txt(452, 966, 'source: V-100 gas', 'tagl', gfu);
    var gwt = pkg('WTRT', 613, 850, 165, 135, 'WATER TREATMENT');
    S('path', { d: 'M728,894 h30 v18 l-15,24 l-15,-24 Z', 'class': 'vessel' }, gwt); txt(743, 908, 'HC', 'in', gwt, 'middle');
    inside(gwt, 625, 884, 'IN', 'AT-300'); inside(gwt, 625, 902, 'OiW', 'AT-301');
    dyn(gwt, 625, 922, function () { var w = s().wt; return ['Efficiency ' + Math.round(w.eff * 100) + '%', w.eff < 0.6 ? RED : '']; });
    dyn(gwt, 625, 940, function () { var w = s().wt; return [w.back > 0 ? 'BACKWASH ' + Math.ceil(w.back) + ' s' : w.skim > 0 ? 'SKIMMING ' + Math.ceil(w.skim) + ' s' : 'Normal', w.back > 0 || w.skim > 0 ? YEL : GRN]; });
    var gch = pkg('CHEM', 786, 850, 165, 135, 'CHEMICAL INJECTION');
    dyn(gch, 798, 882, function () { return ['DEMULSIFIER ' + s().dem + ' ppm', '']; });
    dyn(gch, 798, 900, function () { return ['CORR. INHIB. ' + s().chem.ci + ' ppm', '']; });
    dyn(gch, 798, 918, function () { return ['ANTIFOAM ' + s().chem.af + ' ppm', s().flt.foamEff > 0.15 ? YEL : '']; });
    inside(gch, 798, 940, 'CORROSION', 'AT-501'); txt(798, 966, 'mpy (field of probe)', 'tagl', gch);
    var gpw = pkg('POWER', 959, 850, 165, 135, 'POWER 2 x GEN');
    ['G-1', 'G-2'].forEach(function (gn, i) { dyn(gpw, 971, 880 + i * 16, function () { var st = s().gen[gn]; return [gn + ' ' + st, st === 'RUNNING' ? GRN : st === 'TRIPPED' ? RED : st === 'STARTING' ? YEL : '']; }); });
    dyn(gpw, 971, 936, function () { var pw = s().power; return ['LOAD ' + Math.round(pw.demand) + ' / ' + Math.round(pw.cap) + ' kW', pw.shed ? RED : '']; });
    dyn(gpw, 971, 954, function () { var pw = s().power; return [!pw.on ? 'BLACKOUT' : pw.shed ? 'LOAD SHED ACTIVE' : 'Bus healthy', !pw.on || pw.shed ? RED : GRN]; });
    ['W-1', 'W-2', 'W-3'].forEach(function (w, i) { var y = 150 + i * 90; dyn(svg, 97, y - 7, function () { var q = s().wells[w]; return ['CK ' + Math.round(q.choke) + '%', q.open ? '' : '#7d8ba0']; }); });
    dyn(svg, 1896, 312, function () { return ['SEAL ' + Math.round(s().seal.lvl) + '%', s().seal.lvl < 40 ? RED : '']; }, 'end');
    dyn(svg, 1896, 324, function () { return ['PURGE ' + Math.round(tg('FT-402').v), '']; }, 'end');
    if (cfg.ownerName) { var wm = txt(1876, 977, cfg.ownerName, '', svg, 'end'); wm.style.cssText = 'font:700 22px system-ui;fill:#3a85d6;opacity:.85'; }
    if (cfg.credit) { var wm2 = txt(1876, 996, cfg.credit, '', svg, 'end'); wm2.style.cssText = 'font:600 16px system-ui;fill:#6f8fb5;opacity:.95'; }
    // ---------- F&G zone overlay: dashed zone outlines + G / H / F status chips
    var ZR = { Z1: [[30, 95, 430, 350]], Z2: [[465, 95, 760, 350]], Z3: [[1230, 95, 470, 350]], Z4: [[470, 540, 1050, 240]], Z5: [[30, 775, 470, 215], [1135, 795, 230, 150]], Z6: [[430, 840, 705, 150]], Z7: [[1705, 60, 195, 300], [1590, 455, 160, 135]] };
    var fgCols = { ok: '#2f7d57', low: '#e0b43a', high: '#ff4d4d', ovr: '#6b7a90', blind: '#c04bd6' };
    plant.FG_ZONES.forEach(function (zz) {
      var Z = zz[0], outs = [], chips = [];
      ZR[Z].forEach(function (r, ri) {
        var o = S('rect', { x: r[0], y: r[1], width: r[2], height: r[3], rx: 10, fill: 'none', 'stroke-dasharray': '10 7', 'stroke-width': 1.6, 'stroke-opacity': .55, stroke: fgCols.ok, 'pointer-events': 'none' }); outs.push(o);
        if (ri === 0) {
          var cg = S('g', { 'class': 'fgchip', style: 'cursor:pointer' }); cg.addEventListener('click', function () { gotoFG(Z, 'fg'); });
          S('rect', { x: r[0] + 5, y: r[1] + 4, width: 78, height: 20, rx: 5, fill: '#0b141f', 'fill-opacity': .85, stroke: '#2a3b52' }, cg);
          txt(r[0] + 10, r[1] + 18, Z, 'tagl', cg);
          FG_KEYS_L.forEach(function (k, ki) { var sq = S('rect', { x: r[0] + 30 + ki * 17, y: r[1] + 8, width: 13, height: 13, rx: 2, fill: fgCols.ok }, cg); chips.push([k, sq]); txt(r[0] + 36.5 + ki * 17, r[1] + 18.5, k === 'gas' ? 'G' : k === 'h2s' ? 'H' : 'F', 'bt', cg, 'middle'); });
        }
      });
      upd.push(function () {
        var worst = 'ok';
        chips.forEach(function (c) {
          var zr = s().fgs.z[Z][c[0]], pre = plant.FG_TYPES[c[0]].pre, st = zr.blind ? 'blind' : (zr.conf || zr.high) ? 'high' : zr.low ? 'low' : (s().fgs.ovr[pre + '-' + Z + '-A'] !== undefined || s().fgs.ovr[pre + '-' + Z + '-B'] !== undefined) ? 'ovr' : 'ok';
          if (c[1].getAttribute('fill') !== fgCols[st]) c[1].setAttribute('fill', fgCols[st]);
          var rank = { ok: 0, ovr: 1, low: 2, blind: 3, high: 4 }; if (rank[st] > rank[worst]) worst = st;
        });
        outs.forEach(function (o) { o.setAttribute('stroke', fgCols[worst]); o.setAttribute('stroke-opacity', worst === 'ok' ? .45 : .95); });
      });
    });
    // alarm highlight on equipment outlines
    upd.push(function () {
      var worst = {}; plant.activeAlarms().forEach(function (a) { if (a.state === 'RTN_UNACK') return; var e = ALM_EQ[a.id]; if (e && (!worst[e] || a.pr < worst[e])) worst[e] = a.pr; });
      Array.prototype.forEach.call(svg.querySelectorAll('.vessel'), function (r) {
        var id = r.getAttribute('data-box'), c = 'vessel' + (worst[id] ? ' almc' + worst[id] : '');
        if (r.getAttribute('class') !== c) r.setAttribute('class', c);
      });
    });
  }

  // ------------------------------------------------------------------ faceplate widgets
  var sheetUpd = [], dragging = false;
  function limitsFor(tag, lo, hi) {
    var out = []; plant.ALARM_DEFS.forEach(function (d) { if (d[2] === tag) { var k = d[0].split('-')[0].replace(/^[A-Z]A/, ''); out.push({ pos: (d[4] - lo) / (hi - lo) * 100, pr: d[5], lab: d[3] === '>' ? (d[0].indexOf('HH') > 0 ? 'HH' : 'H') : (d[0].indexOf('LL') > 0 ? 'LL' : 'L'), id: d[0], lim: d[4] }); } });
    return out;
  }
  function miniTrend(id, tag) {
    var cv = h('canvas', { 'class': 'mini' });
    function draw() {
      var q = tg(tag), L = plant.loops[id], dpr = window.devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight; if (!W) return;
      cv.width = W * dpr; cv.height = H * dpr; var g = cv.getContext('2d'); g.scale(dpr, dpr); g.fillStyle = '#0b141f'; g.fillRect(0, 0, W, H);
      var n = Math.min(histT.length, 60), st = histT.length - n; if (n < 2) return;
      var pvs = hist[tag] || [], sps = hist['SP:' + id] || [], ops = hist['OP:' + id] || [];
      var lo = q.lo, hi = q.hi, mn = 1e9, mx = -1e9, k;
      for (k = 0; k < n; k++) { var v = pvs[st + k]; if (v < mn) mn = v; if (v > mx) mx = v; var sv = sps[st + k]; if (sv < mn) mn = sv; if (sv > mx) mx = sv; }
      var pad = Math.max((mx - mn) * 0.3, (hi - lo) * 0.02); mn -= pad; mx += pad; if (mn < lo) mn = lo; if (mx > hi) mx = hi; if (mx - mn < 1e-6) mx = mn + 1;
      function y(v) { return H - (v - mn) / (mx - mn) * (H - 6) - 3; }
      g.strokeStyle = '#6a7f98'; g.lineWidth = 1; g.beginPath(); for (k = 0; k < n; k++) { var oy = H - ops[st + k] / 100 * (H - 6) - 3, ox = k / (n - 1) * W; if (k) g.lineTo(ox, oy); else g.moveTo(ox, oy); } g.stroke();
      g.setLineDash([4, 3]); g.strokeStyle = '#fff'; g.beginPath(); for (k = 0; k < n; k++) { var yy = y(sps[st + k]); if (k) g.lineTo(k / (n - 1) * W, yy); else g.moveTo(0, yy); } g.stroke(); g.setLineDash([]);
      g.strokeStyle = '#5aa7ff'; g.lineWidth = 2; g.beginPath(); for (k = 0; k < n; k++) { var py = y(pvs[st + k]); if (k) g.lineTo(k / (n - 1) * W, py); else g.moveTo(0, py); } g.stroke();
      g.fillStyle = '#8396ad'; g.font = '9px system-ui'; g.fillText(mx.toFixed(1), 3, 10); g.fillText(mn.toFixed(1), 3, H - 3); g.fillText('PV blue · SP white · OP grey · 10 min', W - 160, 10);
    }
    sheetUpd.push(draw);
    return cv;
  }
  function loopWidget(id) {
    var L = plant.loops[id], span = L.hi - L.lo, step = span <= 20 ? 0.1 : 1, d = LOOP_DEF[id];
    var wrap = h('div', { 'class': 'fp' });
    var modeTag = h('span', { 'class': 'tag AUTO', text: 'AUTO' });
    wrap.appendChild(h('h4', null, [h('span', { text: id + ' · ' + L.desc }), modeTag]));
    var gPV = h('b', { text: '--' }), gSP = h('b', { text: '--' }), gOP = h('b', { text: '--' });
    wrap.appendChild(h('div', { 'class': 'fpgrid' }, [h('div', null, [h('small', { text: 'PV ' + L.unit }), gPV]), h('div', null, [h('small', { text: 'SP' }), gSP]), h('div', null, [h('small', { text: 'OP % (' + d[10] + ')' }), gOP])]));
    var bar = h('div', { 'class': 'bar' }, [h('i'), h('u')]);
    limitsFor(L.tag, L.lo, L.hi).forEach(function (l) { if (l.pos >= 0 && l.pos <= 100) bar.appendChild(h('s', { 'class': 'lim p' + l.pr, style: 'left:' + l.pos + '%', title: l.id + ' ' + l.lim })); });
    wrap.appendChild(bar);
    var lg = limitsFor(L.tag, L.lo, L.hi).sort(function (a, b) { return a.pos - b.pos; });
    if (lg.length) wrap.appendChild(h('div', { 'class': 'limtxt', text: 'Alarms: ' + lg.map(function (l) { return l.lab + ' ' + l.lim; }).join(' · ') }));
    var bar2 = h('div', { 'class': 'bar', style: 'margin-top:4px' }, [h('i', { 'class': 'op' })]); wrap.appendChild(bar2);
    var spIn = h('input', { type: 'number', step: step, inputmode: 'decimal' });
    var bAuto = h('button', { text: 'AUTO', onclick: function () { act('setMode', id, 'AUTO'); } });
    var bMan = h('button', { text: 'MAN', onclick: function () { act('setMode', id, 'MAN'); } });
    var minus = h('button', { text: '−', onclick: function () { act('setSP', id, L.sp - step); } });
    var plus = h('button', { text: '+', onclick: function () { act('setSP', id, L.sp + step); } });
    spIn.addEventListener('change', function () { act('setSP', id, parseFloat(spIn.value)); });
    wrap.appendChild(h('div', { 'class': 'ctl' }, [bAuto, bMan, h('span', { text: 'SP', style: 'margin-left:8px;color:#8396ad' }), minus, spIn, plus]));
    var slider = h('input', { type: 'range', min: 0, max: 100, step: 1 });
    ['pointerdown', 'touchstart'].forEach(function (ev) { slider.addEventListener(ev, function () { dragging = true; }); });
    ['pointerup', 'touchend', 'change'].forEach(function (ev) { slider.addEventListener(ev, function () { dragging = false; }); });
    slider.addEventListener('input', function () { act('setOP', id, +slider.value); });
    wrap.appendChild(h('div', { 'class': 'ctl' }, [h('span', { text: 'OP', style: 'color:#8396ad' }), slider]));
    wrap.appendChild(miniTrend(id, L.tag));
    sheetUpd.push(function () {
      var q = tg(L.tag), man = L.mode === 'MAN';
      gPV.textContent = fmt(q.v, L.unit); gSP.textContent = fmt(L.sp, L.unit); gOP.textContent = L.op.toFixed(0);
      modeTag.textContent = L.mode; modeTag.className = 'tag ' + L.mode;
      bar.firstChild.style.width = pct((q.v - L.lo) / span * 100) + '%'; bar.children[1].style.left = pct((L.sp - L.lo) / span * 100) + '%';
      bar2.firstChild.style.width = L.op + '%';
      if (document.activeElement !== spIn) spIn.value = +L.sp.toFixed(2);
      if (!dragging) slider.value = L.op; slider.disabled = !man;
      bAuto.className = man ? '' : 'primary'; bMan.className = man ? 'primary' : '';
    });
    return wrap;
  }
  function tagGrid(tags) {
    var g = h('div', { 'class': 'fpgrid' });
    tags.forEach(function (t) { var q = tg(t), b = h('b', { text: '--' }), sm = h('small', { text: t + ' ' + q.desc + ' (' + (UNIT[q.unit] || q.unit) + ')' }); g.appendChild(h('div', null, [sm, b])); sheetUpd.push(function () { var z = tg(t), al = alarmOf(t); b.textContent = fmt(z.v, z.unit); b.style.color = al === 1 ? '#ff6b6b' : al === 2 ? '#ffb347' : al === 3 ? '#ffe066' : ''; }); });
    return h('div', { 'class': 'fp' }, [g]);
  }
  function stateOf(id) { var q = s(); if (id === 'N2-PKG') return q.n2.pkg; if (id.charAt(0) === 'G') return q.gen[id]; return id === 'HO-1' ? q.ho.burner : id === 'E-103' ? q.ht.burner : q.pumps[id]; }
  function equipWidget(id) {
    var wrap = h('div', { 'class': 'fp' }), st = h('span', { 'class': 'status', text: '' });
    wrap.appendChild(h('h4', null, [h('span', { text: EQ_NAME[id] || (id + ' pump') }), st]));
    wrap.appendChild(h('div', { 'class': 'ctl' }, [h('button', { 'class': 'go', text: 'START', onclick: function () { act('start', id); } }), h('button', { text: 'STOP', onclick: function () { act('stop', id); } }), h('button', { text: 'RESET TRIP', onclick: function () { act('resetTrip', id); } })]));
    sheetUpd.push(function () { var v = stateOf(id); st.textContent = v; st.className = 'status ' + v; });
    return wrap;
  }
  function sliderRow(label, min, max, stp, get, set, unit) {
    var out = h('span', { 'class': 'v', text: '' }), sl = h('input', { type: 'range', min: min, max: max, step: stp });
    ['pointerdown', 'touchstart'].forEach(function (ev) { sl.addEventListener(ev, function () { dragging = true; }); });
    ['pointerup', 'touchend', 'change'].forEach(function (ev) { sl.addEventListener(ev, function () { dragging = false; }); });
    sl.addEventListener('input', function () { set(+sl.value); });
    sheetUpd.push(function () { var v = get(); if (!dragging) sl.value = v; out.textContent = (+v).toFixed(stp < 1 ? 2 : 0) + ' ' + (unit || ''); });
    return h('div', { 'class': 'row' }, [h('span', { 'class': 'k', text: label }), sl, out]);
  }
  function kvRow(label, fn) { var v = h('span', { 'class': 'v' }); sheetUpd.push(function () { v.textContent = fn(); }); return h('div', { 'class': 'row' }, [h('span', { 'class': 'k', text: label }), v]); }
  function special(kind, body) {
    var p = h('div', { 'class': 'fp' }), k = kind.split(':');
    if (k[0] === 'dem') {
      p.appendChild(h('h4', null, [h('span', { text: 'Demulsifier injection (upstream of V-001)' })]));
      p.appendChild(sliderRow('Dose', 0, 50, 1, function () { return s().dem; }, function (v) { act('dem', null, v); }, 'ppm'));
    } else if (k[0] === 'drain') {
      p.appendChild(h('h4', null, [h('span', { text: 'Drain valve ' + k[1] + ' → drain header → TK-430 slop' })]));
      p.appendChild(sliderRow(k[1], 0, 100, 5, function () { return s().hv[k[1]]; }, function (v) { act('hv', k[1], v); }, '%'));
      p.appendChild(h('p', { 'class': 'note', text: 'Drains take water first, then oil. Use for water draw-off or emergency level reduction only.' }));
    } else if (k[0] === 'auto') {
      var grp = k[1], st = h('span', { 'class': 'status' });
      sheetUpd.push(function () { st.textContent = s().auto[grp] ? 'ARMED' : 'MANUAL'; st.className = 'status ' + (s().auto[grp] ? 'RUNNING' : 'STOPPED'); });
      p.appendChild(h('h4', null, [h('span', { text: grp + ' standby auto-start on duty-pump trip' }), st]));
      p.appendChild(h('div', { 'class': 'ctl' }, [h('button', { 'class': 'go', text: 'ARM', onclick: function () { act('auto', grp, true); } }), h('button', { text: 'DISARM', onclick: function () { act('auto', grp, false); } })]));
    } else if (k[0] === 'route') {
      p.appendChild(h('h4', null, [h('span', { text: 'Crude routing from V-110' })]));
      var btns = ['AUTO', 'TANK', 'SLOP'].map(function (r) { var b = h('button', { text: r === 'AUTO' ? 'AUTO (divert off-spec)' : r === 'TANK' ? 'To TK-410' : 'To TK-430 slop', onclick: function () { act('route', null, r); } }); sheetUpd.push(function () { b.className = s().route === r ? 'primary' : ''; }); return b; });
      p.appendChild(h('div', { 'class': 'ctl' }, btns));
    } else if (k[0] === 'util') {
      p.appendChild(h('h4', null, [h('span', { text: 'Instrument air compressors & power' })]));
      ['IAC-A', 'IAC-B'].forEach(function (c) { var st = h('span', { 'class': 'status' }); sheetUpd.push(function () { var v = s().ia[c === 'IAC-A' ? 'A' : 'B']; st.textContent = v; st.className = 'status ' + v; }); p.appendChild(h('div', { 'class': 'row' }, [h('span', { 'class': 'k', text: c }), st, h('button', { 'class': 'go', text: 'START', onclick: function () { act('iaStart', c); } }), h('button', { text: 'STOP', onclick: function () { act('iaStop', c); } })])); });
      var pw = h('span', { 'class': 'status' }); sheetUpd.push(function () { pw.textContent = s().power.on ? 'ON' : 'LOST'; pw.className = 'status ' + (s().power.on ? 'ON' : 'TRIPPED'); });
      p.appendChild(h('div', { 'class': 'row' }, [h('span', { 'class': 'k', text: 'Main power' }), pw, h('button', { 'class': 'go', text: 'RESTORE', onclick: function () { act('power', null, true); } })]));
      p.appendChild(sliderRow('Ambient temperature base', -10, 55, 1, function () { return plant.cfg.ambient; }, function (v) { act('ambient', null, v); }, '°C'));
      p.appendChild(h('p', { 'class': 'note', text: 'Ambient swings about ±3 °C over a 24 h cycle (night is cooler): air cooler duty, hot-oil losses and gas density follow it.' }));
    } else if (k[0] === 'lact') {
      p.appendChild(h('h4', null, [h('span', { text: 'LACT: meter, BS&W monitor, sampler, prover' })]));
      p.appendChild(kvRow('Meter factor (applied)', function () { return s().lact.mf.toFixed(4); }));
      p.appendChild(kvRow('Meter error vs prover', function () { return (s().lact.dev * 100).toFixed(2) + ' %'; }));
      p.appendChild(kvRow('Status', function () { var l = s().lact; return l.divert ? 'DIVERTING off-spec crude' : l.prove > 0 ? 'Proving ' + Math.ceil(l.prove) + ' s' : 'On spec'; }));
      p.appendChild(h('div', { 'class': 'ctl' }, [h('button', { 'class': 'go', text: 'PROVE METER (120 s)', onclick: function () { act('prove'); } }), h('button', { text: 'TAKE COMPOSITE SAMPLE', onclick: function () { act('lactSample'); toast('Sample taken, lab result in the journal'); } })]));
      p.appendChild(h('p', { 'class': 'note', text: 'The LACT diverts crude to slop when BS&W stays above spec for 30 s. Meter factor drifts slowly; prove the meter when the PROVE DUE alarm appears (a real prove needs export flow). Empty the sampler pot with a composite sample before it fills.' }));
    } else if (k[0] === 'fuel') {
      p.appendChild(h('h4', null, [h('span', { text: 'Fuel gas header and flare seal drum' })]));
      p.appendChild(kvRow('Burners permitted', function () { return s().fg.P > 2.5 ? 'Yes (PT-902 above 2.5 barg)' : 'NO, fuel gas too low'; }));
      p.appendChild(kvRow('Seal drum level', function () { return Math.round(s().seal.lvl) + ' % (normal 60 to 80 %)'; }));
      p.appendChild(h('p', { 'class': 'note', text: 'Fuel gas is taken from V-100 gas. If V-100 pressure falls (low production, cold start) PT-902 drops and the burners trip at 2.0 barg. Purge gas keeps the flare header positive; a low seal drum level risks flashback.' }));
    } else if (k[0] === 'wtrt') {
      p.appendChild(h('h4', null, [h('span', { text: 'Hydrocyclone and TK-420 skimming' })]));
      p.appendChild(kvRow('Hydrocyclone efficiency', function () { return Math.round(s().wt.eff * 100) + ' %'; }));
      p.appendChild(kvRow('Backwash / skim timers', function () { var w = s().wt; return Math.ceil(w.back) + ' s / ' + Math.ceil(w.skim) + ' s'; }));
      p.appendChild(h('div', { 'class': 'ctl' }, [h('button', { 'class': 'go', text: 'BACKWASH (5 min)', onclick: function () { act('backwash'); } }), h('button', { text: 'SKIM TK-420 (5 min)', onclick: function () { act('skim'); } })]));
      p.appendChild(h('p', { 'class': 'note', text: 'Oil in water above 40 ppm alarms and above 100 ppm is a disposal-limit breach. Fouling lowers efficiency; backwashing restores it over about 5 min, skimming helps while it recovers.' }));
    } else if (k[0] === 'chem') {
      p.appendChild(h('h4', null, [h('span', { text: 'Chemical injection doses' })]));
      p.appendChild(sliderRow('Demulsifier (upstream V-001)', 0, 50, 1, function () { return s().dem; }, function (v) { act('dem', null, v); }, 'ppm'));
      p.appendChild(sliderRow('Corrosion inhibitor', 0, 30, 1, function () { return s().chem.ci; }, function (v) { act('chem', 'ci', v); }, 'ppm'));
      p.appendChild(sliderRow('Antifoam (V-100)', 0, 30, 1, function () { return s().chem.af; }, function (v) { act('chem', 'af', v); }, 'ppm'));
      p.appendChild(h('p', { 'class': 'note', text: 'More demulsifier helps water break out but costs money. Corrosion inhibitor lowers the corrosion rate (AT-501); antifoam suppresses foam in V-100. Over-dosing is waste, under-dosing shows up as alarms.' }));
    } else if (k[0] === 'power') {
      p.appendChild(h('h4', null, [h('span', { text: 'Site power: 2 x generator, load shedding' })]));
      p.appendChild(kvRow('Load / capacity', function () { var pw = s().power; return Math.round(pw.demand) + ' / ' + Math.round(pw.cap) + ' kW'; }));
      p.appendChild(kvRow('Load shedding', function () { return s().power.shed ? 'ACTIVE (P-301/P-501 tripped, fan limited)' : 'Inactive'; }));
      p.appendChild(h('div', { 'class': 'ctl' }, [h('button', { 'class': 'go', text: 'RESET LOAD SHED', onclick: function () { act('shedReset'); } }), h('button', { text: 'RESTORE MAIN POWER', onclick: function () { act('power', null, true); } })]));
      p.appendChild(h('p', { 'class': 'note', text: 'Two generators share the site load. One generator cannot carry the full plant: if one trips the system sheds the disposal and slop pumps. Reset the trip, restart the machine (60 s run-up), then reset load shedding and restart P-301A/B and P-501.' }));
    } else if (k[0] === 'wells') {
      p.appendChild(h('h4', null, [h('span', { text: 'Wells (open / shut-in)' })]));
      ['W-1', 'W-2', 'W-3'].forEach(function (w) { var st = h('span', { 'class': 'status' }); sheetUpd.push(function () { var o = s().wells[w].open; st.textContent = o ? 'OPEN' : 'SHUT-IN'; st.className = 'status ' + (o ? 'RUNNING' : 'STOPPED'); }); p.appendChild(h('div', { 'class': 'row' }, [h('span', { 'class': 'k', text: w + ' (' + Math.round(s().wells[w].share * 100) + '% of rate)' }), st, h('button', { 'class': 'go', text: 'OPEN', onclick: function () { act('well', w, true); } }), h('button', { text: 'SHUT IN', onclick: function () { act('well', w, false); } })])); });
      p.appendChild(h('h4', { style: 'margin-top:10px' }, [h('span', { text: 'Field conditions (choke / reservoir)' })]));
      p.appendChild(sliderRow('Liquid rate', 0, 900, 10, function () { return s().well.liquidRate; }, function (v) { act('rateSet', null, v); }, 'm³/h'));
      p.appendChild(sliderRow('Water cut', 0, 0.8, 0.01, function () { return s().well.wc; }, function (v) { act('wcSet', null, v); }, ''));
      p.appendChild(h('h4', { style: 'margin-top:10px' }, [h('span', { text: 'Wellhead chokes and well test' })]));
      ['W-1', 'W-2', 'W-3'].forEach(function (w) {
        p.appendChild(sliderRow(w + ' choke', 0, 100, 5, function () { return s().wells[w].choke; }, function (v) { act('choke', w, v); }, '%'));
        var tb = h('button', { text: 'TEST ' + w, onclick: function () { act('wellTest', w, s().test.well !== w); } }); sheetUpd.push(function () { tb.className = s().test.well === w ? 'primary' : ''; tb.textContent = (s().test.well === w ? 'STOP TEST ' : 'TEST ') + w; });
        p.appendChild(h('div', { 'class': 'ctl' }, [tb]));
      });
      p.appendChild(tagGrid(['FT-T1', 'AT-T1']));
      p.appendChild(h('p', { 'class': 'note', text: 'Well test: line one well up to the test separator to read its own rate and water cut. Chokes are the quickest way to cut production. Wells differ in water cut (W-3 is the wettest).' }));
    } else if (k[0] === 'esdv') {
      p.appendChild(h('h4', null, [h('span', { text: 'ESDV-001 inlet shutdown valve (20 s stroke)' })]));
      p.appendChild(h('div', { 'class': 'ctl' }, [h('button', { 'class': 'go', text: 'OPEN (after ESD reset)', onclick: function () { act('openInlet'); } }), h('button', { text: 'CLOSE', onclick: function () { act('closeInlet'); } })]));
      p.appendChild(h('div', { 'class': 'ctl' }, [h('button', { text: 'BDV-001 OPEN', onclick: function () { act('bdv', null, true); } }), h('button', { text: 'BDV-001 CLOSE', onclick: function () { act('bdv', null, false); } })]));
    } else if (k[0] === 'mf2') {
      p.appendChild(h('h4', null, [h('span', { text: 'MF-2 oil manifold: gate valves and bypass' })]));
      p.appendChild(sliderRow('GV-1 stripper inlet', 0, 100, 5, function () { return s().hv['GV-1']; }, function (v) { act('hv', 'GV-1', v); }, '%'));
      p.appendChild(sliderRow('GV-2 stripper outlet', 0, 100, 5, function () { return s().hv['GV-2']; }, function (v) { act('hv', 'GV-2', v); }, '%'));
      p.appendChild(sliderRow('GV-3 bypass (straight valve)', 0, 100, 5, function () { return s().hv['GV-3']; }, function (v) { act('hv', 'GV-3', v); }, '%'));
      p.appendChild(sliderRow('GV-4 bypass (straight valve)', 0, 100, 5, function () { return s().hv['GV-4']; }, function (v) { act('hv', 'GV-4', v); }, '%'));
      p.appendChild(sliderRow('BV-HT (around HT-200)', 0, 100, 5, function () { return s().hv['BV-HT']; }, function (v) { act('hv', 'BV-HT', v); }, '%'));
      p.appendChild(h('p', { 'class': 'note', text: 'Normal line-up: GV-1 and GV-2 open (crude through C-101), GV-3 and GV-4 closed, BV-HT closed. Opening the straight bypass valves sends un-stripped crude to the cooler (RVP and H2S up). Closing GV-2 with GV-1 open fills the column; closing all four dead-heads the P-101 pumps. BV-HT sends cold wet crude from V-210 straight to MF-2 (BS&W up).' }));
      var fl = h('div', { 'class': 'row' }); var fv = h('span', { 'class': 'v' }); fl.appendChild(h('span', { 'class': 'k', text: 'Flow MF-2 / column / bypass' })); fl.appendChild(fv); p.appendChild(fl);
      sheetUpd.push(function () { var f = s().flows; fv.textContent = Math.round(f.qM) + ' / ' + Math.round(f.qCin) + ' / ' + Math.round(f.qDir + f.qBH) + ' m³/h'; });
    } else if (k[0] === 'cooler') {
      p.appendChild(h('h4', null, [h('span', { text: 'E-105 fan cooler bypass BV-CL (ties into V-110 inlet)' })]));
      p.appendChild(sliderRow('BV-CL cooler bypass', 0, 100, 5, function () { return s().hv['BV-CL']; }, function (v) { act('hv', 'BV-CL', v); }, '%'));
      p.appendChild(kvRow('V-110 inlet temperature (TT-110)', function () { return tg('TT-110').v.toFixed(1) + ' °C (alarm above 60)'; }));
      p.appendChild(h('p', { 'class': 'note', text: 'Normally closed. Open it only when the cooler is isolated or fouled: hot crude reaches V-110 and the tank, gas and RVP rise.' }));
    } else if (k[0] === 'n2') {
      p.appendChild(h('h4', null, [h('span', { text: 'N2 stripping gas to C-101' })]));
      p.appendChild(sliderRow('XV-N2 N2 flow valve', 0, 100, 5, function () { return s().hv['XV-N2']; }, function (v) { act('hv', 'XV-N2', v); }, '%'));
      p.appendChild(kvRow('N2 flow / header pressure', function () { return Math.round(s().n2.flow) + ' Sm³/h / ' + s().n2.P.toFixed(1) + ' barg'; }));
      p.appendChild(kvRow('Stripped crude H2S / RVP', function () { return tg('AT-103').v.toFixed(1) + ' ppm / ' + tg('AT-102').v.toFixed(1) + ' psi'; }));
      p.appendChild(h('p', { 'class': 'note', text: 'N2 strips H2S and light ends in C-101 together with the reboiler. Normal valve position is about 50 %. Without N2 (package trip or valve shut) RVP and H2S rise and crude goes off-spec.' }));
    } else if (k[0] === 'vent') {
      p.appendChild(h('h4', null, [h('span', { text: 'TK-410 cold vent to LP flare' })]));
      p.appendChild(sliderRow('VENT-410 vent valve', 0, 100, 5, function () { return s().hv['VENT-410']; }, function (v) { act('hv', 'VENT-410', v); }, '%'));
      p.appendChild(kvRow('Vapour pressure PT-410', function () { var q = s().tank; return q.P.toFixed(1) + ' mbarg' + (q.lift ? '  PVRV LIFTING' : q.vac ? '  VACUUM RELIEF' : ''); }));
      p.appendChild(kvRow('Vent flow to LP flare', function () { return Math.round(s().lpf.flow) + ' m³/h'; }));
      p.appendChild(h('p', { 'class': 'note', text: 'Tank breathing goes to the LP flare. If VENT-410 is closed the pressure builds, the PVRV lifts (+35 mbarg) and hydrocarbon and H2S reach the tank farm; when exporting with the vent closed the tank pulls vacuum (PVRV opens at -3 mbarg).' }));
    } else if (k[0] === 'lpf') {
      var lps = h('span', { 'class': 'status' }); sheetUpd.push(function () { lps.textContent = s().lpf.pilot; lps.className = 'status ' + (s().lpf.pilot === 'ON' ? 'RUNNING' : 'TRIPPED'); });
      p.appendChild(h('h4', null, [h('span', { text: 'LP flare pilot' }), lps]));
      p.appendChild(h('div', { 'class': 'ctl' }, [h('button', { 'class': 'go', text: 'RE-IGNITE LP PILOT', onclick: function () { act('flareIgnite', 'LP'); } })]));
      p.appendChild(kvRow('LP header pressure', function () { return (tg('PT-405').v * 1000).toFixed(0) + ' mbarg'; }));
    } else if (k[0] === 'hx1') {
      p.appendChild(h('h4', null, [h('span', { text: 'HX-1 thermal heat exchanger' })]));
      var du = h('div', { 'class': 'row' }); var dv = h('span', { 'class': 'v' }); du.appendChild(h('span', { 'class': 'k', text: 'Fouling factor (instructor)' })); du.appendChild(dv); p.appendChild(du);
      sheetUpd.push(function () { dv.textContent = (plant.cfg.hx1.foul * 100).toFixed(0) + ' %'; });
      p.appendChild(h('p', { 'class': 'note', text: 'Thermal oil exchanger: hot oil from HO-1 heats the V-001 oil before V-100. Stripped crude from C-101 goes directly to the E-105 cooler. Fouling lowers V-100 feed temperature, so V-210 and E-103 must work harder and HO-1 takes more load.' }));
    } else if (k[0] === 'flare') {
      var ps = h('span', { 'class': 'status' }); sheetUpd.push(function () { ps.textContent = s().flare.pilot; ps.className = 'status ' + (s().flare.pilot === 'ON' ? 'RUNNING' : 'TRIPPED'); });
      p.appendChild(h('h4', null, [h('span', { text: 'Flare pilot' }), ps]));
      p.appendChild(h('div', { 'class': 'ctl' }, [h('button', { 'class': 'go', text: 'RE-IGNITE PILOT', onclick: function () { act('flareIgnite'); } })]));
      p.appendChild(h('p', { 'class': 'note', text: 'An unlit flare vents raw gas: re-ignite promptly. Do not re-ignite while V-401 level is above 90%.' }));
      p.appendChild(kvRow('Seal drum level / purge gas', function () { return Math.round(s().seal.lvl) + ' % / ' + Math.round(tg('FT-402').v) + ' Sm³/h'; }));
    }
    body.appendChild(p);
  }
  function openSheet(id) {
    var body = $('sheetBody'); body.innerHTML = ''; sheetUpd = [];
    if (id.indexOf('LOOP:') === 0) { var lp = id.slice(5); $('sheetTitle').textContent = lp + ' · ' + LOOP_DEF[lp][1]; body.appendChild(loopWidget(lp)); var eq = TAG_EQ[LOOP_DEF[lp][9]]; if (eq) body.appendChild(h('div', { 'class': 'ctl' }, [h('button', { text: 'Open ' + eq + ' equipment page', onclick: function () { openSheet(eq); } })])); }
    else if (id.indexOf('INST:') === 0) { var tag = id.slice(5); $('sheetTitle').textContent = tag + ' · ' + (tg(tag) ? tg(tag).desc : ''); body.appendChild(tagGrid([tag])); var cv = h('canvas', { 'class': 'mini', style: 'height:120px' }); body.appendChild(cv); sheetUpd.push(function () { drawSimple(cv, tag); }); }
    else if (id.indexOf('HV:') === 0) { var hv = id.slice(3); $('sheetTitle').textContent = hv + ' hand valve'; special(/^(BV-HT|GV-\d)$/.test(hv) ? 'mf2' : hv === 'BV-CL' ? 'cooler' : hv === 'XV-N2' ? 'n2' : hv === 'VENT-410' ? 'vent' : 'drain:' + hv, body); }
    else {
      var spec = EQ[id] || { title: id, tags: [] }; $('sheetTitle').textContent = spec.title;
      if (spec.tags && spec.tags.length) body.appendChild(tagGrid(spec.tags));
      (spec.equip || []).forEach(function (e) { body.appendChild(equipWidget(e)); });
      if (spec.special) special(spec.special, body);
      (spec.extra || []).forEach(function (x) { special(x, body); });
      if (spec.drain) special('drain:' + spec.drain, body);
      (spec.loops || []).forEach(function (l) { body.appendChild(loopWidget(l)); });
    }
    $('sheet').className = 'sheet'; refreshSheet();
    try { history.pushState({ sheet: 1 }, ''); } catch (e) {}
  }
  function drawSimple(cv, tag) {
    var q = tg(tag), dpr = window.devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight; if (!W) return;
    cv.width = W * dpr; cv.height = H * dpr; var g = cv.getContext('2d'); g.scale(dpr, dpr); g.fillStyle = '#0b141f'; g.fillRect(0, 0, W, H);
    var a = hist[tag] || [], n = Math.min(a.length, 60), st = a.length - n; if (n < 2) return;
    var mn = 1e9, mx = -1e9, k; for (k = 0; k < n; k++) { mn = Math.min(mn, a[st + k]); mx = Math.max(mx, a[st + k]); }
    var pad = Math.max((mx - mn) * .3, (q.hi - q.lo) * .02); mn -= pad; mx += pad; if (mx - mn < 1e-6) mx = mn + 1;
    g.strokeStyle = '#5aa7ff'; g.lineWidth = 2; g.beginPath(); for (k = 0; k < n; k++) { var y = H - (a[st + k] - mn) / (mx - mn) * (H - 6) - 3; if (k) g.lineTo(k / (n - 1) * W, y); else g.moveTo(0, y); } g.stroke();
    g.fillStyle = '#8396ad'; g.font = '9px system-ui'; g.fillText(mx.toFixed(1), 3, 10); g.fillText(mn.toFixed(1), 3, H - 3);
  }
  function closeSheet() { $('sheet').className = 'sheet hidden'; sheetUpd = []; }
  function refreshSheet() { sheetUpd.forEach(function (f) { f(); }); }
  $('sheetClose').onclick = function () { closeSheet(); try { if (history.state && history.state.sheet) history.back(); } catch (e) {} };
  $('sheet').addEventListener('click', function (e) { if (e.target === $('sheet')) $('sheetClose').onclick(); });
  window.addEventListener('popstate', closeSheet);

  // ------------------------------------------------------------------ control tab
  var LOOP_GROUPS = [['Slug catcher V-001', ['LIC-001', 'LIC-002', 'PIC-001']], ['Separation V-100 / V-210', ['LIC-101', 'LIC-102', 'PIC-101', 'TIC-103']], ['Hot oil & heater treater', ['TIC-101', 'TIC-102', 'LIC-103', 'LIC-104', 'PIC-102']],
    ['Stripping column C-101', ['TIC-104', 'LIC-105', 'PIC-104']], ['Cooling & V-110', ['TIC-105', 'LIC-106', 'LIC-107', 'PIC-103']], ['Export / water / flare', ['FIC-201', 'LIC-301', 'LIC-401']]];
  function buildControl() {
    var root = $('controlList'); root.innerHTML = ''; var rows = [];
    root.appendChild(h('div', { 'class': 'loopRow', style: 'color:#8396ad;font-size:11px;margin:8px 8px 0' }, [h('div', { text: 'LOOP' }), h('div', { text: 'SERVICE' }), h('div', { 'class': 'num', text: 'PV' }), h('div', { 'class': 'num', text: 'SP' }), h('div', { 'class': 'num', text: 'OP' })]));
    LOOP_GROUPS.forEach(function (gr) {
      var p = h('div', { 'class': 'panel' }, [h('h3', { text: gr[0] })]);
      gr[1].forEach(function (lid) {
        var L = plant.loops[lid], d = LOOP_DEF[lid];
        var pvT = h('div', { 'class': 'num' }), spT = h('div', { 'class': 'num' }), opT = h('div', { 'class': 'num' }), mode = h('span', { 'class': 'tag AUTO', text: 'AUTO' });
        p.appendChild(h('div', { 'class': 'loopRow', onclick: function () { openSheet('LOOP:' + lid); } }, [h('div', null, [h('b', { text: lid }), mode]), h('div', null, [h('small', { text: d[1] })]), pvT, spT, opT]));
        rows.push(function () { var q = tg(L.tag), al = alarmOf(L.tag); pvT.textContent = fmt(q.v, L.unit); pvT.style.color = al === 1 ? '#ff6b6b' : al === 2 ? '#ffb347' : al === 3 ? '#ffe066' : ''; spT.textContent = fmt(L.sp, L.unit); opT.textContent = L.op.toFixed(0) + '%'; mode.textContent = L.mode; mode.className = 'tag ' + L.mode; });
      });
      root.appendChild(p);
    });
    var eqp = h('div', { 'class': 'panel' }, [h('h3', { text: 'Rotating equipment & fired heaters' })]);
    ['HO-1', 'E-103', 'N2-PKG', 'G-1', 'G-2', 'P-101A', 'P-101B', 'P-201A', 'P-201B', 'P-301A', 'P-301B', 'P-401A', 'P-401B', 'P-501'].forEach(function (id) {
      var st = h('span', { 'class': 'status' }), tgt = id === 'E-103' ? 'HT-200' : id === 'P-501' ? 'TK-430' : id === 'N2-PKG' ? 'N2PKG' : /^G-/.test(id) ? 'POWER' : id;
      eqp.appendChild(h('div', { 'class': 'row', onclick: function () { openSheet(tgt); } }, [h('span', { 'class': 'k', text: id + ' ' + ({ 'HO-1': 'hot oil heater', 'E-103': 'treater burner', 'P-501': 'slop pump', 'N2-PKG': 'N2 package', 'G-1': 'generator', 'G-2': 'generator' }[id] || 'pump') }), st]));
      rows.push(function () { var v = stateOf(id); st.textContent = v; st.className = 'status ' + v; });
    });
    root.appendChild(eqp);
    var op = h('div', { 'class': 'panel' }, [h('h3', { text: 'Other plant items' })]);
    [['MF-2', 'MF-2 gate valves GV-1..GV-4 / BV-HT'], ['N2PKG', 'N2 package / stripping gas'], ['LPF', 'LP flare / TK-410 vent'], ['E-105', 'Cooler bypass BV-CL'], ['TK-410', 'Crude routing / TK-410'], ['HT-200', 'Demulsifier & drains'], ['V-401', 'FKOD / flare pilot'], ['WELLS', 'Wells / field conditions'], ['ESDV', 'Inlet ESDV / BDV'], ['UTIL', 'Utilities / power']].forEach(function (x) { op.appendChild(h('div', { 'class': 'row', onclick: function () { openSheet(x[0] === 'V-401' ? 'FLARE' : x[0]); } }, [h('span', { 'class': 'k', text: x[1] }), h('span', { text: '›' })])); });
    root.appendChild(op);
    viewUpd.control = function () { rows.forEach(function (f) { f(); }); };
  }

  // ------------------------------------------------------------------ alarms tab
  var alarmSig = '';
  function renderAlarms(force) {
    var list = plant.activeAlarms();
    var sig = list.map(function (a) { return a.id + a.state; }).join('|') + '#' + plant.log.length + (plant.log[0] ? plant.log[0].text : '') + '#' + plant.flood + '#' + Object.keys(s().shelf).join(',') + (s().first ? s().first.id : '');
    if (!force && sig === alarmSig) return; alarmSig = sig;
    var root = $('alarmView'); root.innerHTML = '';
    root.appendChild(h('div', { 'class': 'panel' }, [h('h3', { text: 'Active alarms (' + list.length + ')' }), h('div', { 'class': 'ctl' }, [h('button', { 'class': 'primary', text: 'ACKNOWLEDGE ALL', onclick: function () { act('ackAll'); renderAlarms(true); } })])]));
    var fl = plant.flood || 0, fp = h('div', { 'class': 'panel' }, [h('h3', { text: 'Alarm management (ISA-18.2)' }), h('div', { 'class': 'row' }, [h('span', { 'class': 'k', text: 'Alarms raised in last 10 min (flood above 10)' }), h('span', { 'class': 'v', style: 'color:' + (fl > 10 ? '#ff6b6b' : fl > 5 ? '#ffd479' : '#a9f0c7'), text: String(fl) + (fl > 10 ? ' FLOOD' : '') })])]);
    var fo = s().first; if (fo && s().t - fo.t0 < 1800) { fp.appendChild(h('div', { 'class': 'row' }, [h('span', { 'class': 'k', text: 'First-out: ' + fo.id + ' ' + fo.desc + ' at ' + clock(fo.t0) }), h('span', { 'class': 'v', text: fo.cascade.length ? '+' + fo.cascade.length : '' })])); if (fo.cascade.length) fp.appendChild(h('div', { 'class': 'note', text: 'Then: ' + fo.cascade.slice(0, 10).map(function (c) { return c.id + ' (+' + c.dt + ' s)'; }).join(', ') })); }
    root.appendChild(fp);
    var p = h('div', { 'class': 'panel' });
    if (!list.length) p.appendChild(h('div', { 'class': 'row', text: 'No active alarms' }));
    list.forEach(function (a) {
      var unack = a.state === 'ACTIVE_UNACK' || a.state === 'RTN_UNACK', eq = ALM_EQ[a.id];
      p.appendChild(h('div', { 'class': 'alm p' + a.pr + (unack ? ' unack' : '') + (a.state === 'RTN_UNACK' ? ' rtn' : ''), onclick: function () { if (eq === 'FGSTAB') { gotoFG(null, 'ovr'); } else if (eq && eq.indexOf('FGS:') === 0) { gotoFG(eq.slice(4), 'fg'); } else if (eq) { tabTo('overview'); openSheet(eq); } } }, [
        h('div', { 'class': 'pri' }),
        h('div', null, [h('b', { text: a.id }), h('small', { text: a.desc + (a.value ? ' · ' + a.value : '') }), h('small', { text: (a.state === 'RTN_UNACK' ? 'Returned to normal · ' : '') + clock(a.since) + (eq ? ' · ' + eq : '') })]),
        h('div', { 'class': 'btns' }, [h('button', { text: unack ? 'ACK' : '', onclick: function (e) { e.stopPropagation(); act('ack', a.id); renderAlarms(true); } }),
          a.pr > 1 ? h('button', { 'class': 'sh', text: 'SHELVE', onclick: function (e) { e.stopPropagation(); act('shelve', a.id, 15); renderAlarms(true); } }) : null])]));
    });
    root.appendChild(p);
    var shl = plant.shelvedList();
    if (shl.length) { var sp = h('div', { 'class': 'panel' }, [h('h3', { text: 'Shelved alarms (' + shl.length + ')' })]); shl.forEach(function (x) { sp.appendChild(h('div', { 'class': 'row' }, [h('span', { 'class': 'k', text: x.id + ' · returns in ' + Math.max(0, Math.ceil((x.until - s().t) / 60)) + ' min' }), h('button', { text: 'UNSHELVE', onclick: function () { act('unshelve', x.id); renderAlarms(true); } })])); }); root.appendChild(sp); }
    var jp = h('div', { 'class': 'panel' }, [h('h3', { text: 'Event journal' })]);
    plant.log.slice(0, 60).forEach(function (l) { jp.appendChild(h('div', { 'class': 'logline', html: '<span class="' + l.type + '">' + clock(l.t) + ' ' + l.type + '</span> ' + l.text.replace(/</g, '&lt;') })); });
    root.appendChild(jp);
  }

  // ------------------------------------------------------------------ trends
  var hist2 = {}, histT2 = [], rec2 = 0;
  function clearHist() { hist = {}; histT = []; hist2 = {}; histT2 = []; rec2 = 0; }
  var hist = {}, histT = [], trendSel = ['LT-001', 'PT-001', 'TT-102', 'AT-101'], trendWin = 1800, cross = null;
  function pushH(k, v) { var a = hist[k] || (hist[k] = []); a.push(v); if (a.length > 720) a.shift(); }
  function record() {
    histT.push(s().t); if (histT.length > 720) histT.shift();
    plant.tags().forEach(function (q) { pushH(q.tag, q.v); });
    plant.LOOP_DEFS.forEach(function (d) { var L = plant.loops[d[0]]; pushH('SP:' + d[0], L.sp); pushH('OP:' + d[0], L.op); });
    rec2++;
    if (rec2 % 6 === 0) { histT2.push(s().t); if (histT2.length > 1440) histT2.shift(); plant.tags().forEach(function (q) { var a = hist2[q.tag] || (hist2[q.tag] = []); a.push(q.v); if (a.length > 1440) a.shift(); }); }
  }
  var COLORS = ['#5aa7ff', '#ffb347', '#7be0a0', '#ff7b9c', '#c7a6ff'];
  function buildTrends() {
    var root = $('trendView'); root.innerHTML = '';
    var p = h('div', { 'class': 'panel' }, [h('h3', { text: 'Trends (tap a tag to add/remove, max 5)' })]);
    var chips = h('div', { 'class': 'chips' });
    plant.tags().forEach(function (q) { chips.appendChild(h('span', { 'class': 'chip' + (trendSel.indexOf(q.tag) >= 0 ? ' on' : ''), text: q.tag, onclick: function () { var i = trendSel.indexOf(q.tag); if (i >= 0) trendSel.splice(i, 1); else { if (trendSel.length >= 5) trendSel.shift(); trendSel.push(q.tag); } buildTrends(); } })); });
    p.appendChild(chips);
    var win = h('div', { 'class': 'ctl' }); [['10 min', 600], ['30 min', 1800], ['2 h', 7200], ['12 h', 43200], ['24 h', 86400]].forEach(function (w) { win.appendChild(h('button', { text: w[0], 'class': trendWin === w[1] ? 'primary' : '', onclick: function () { trendWin = w[1]; buildTrends(); } })); });
    win.appendChild(h('button', { text: 'COPY CSV', onclick: exportCSV })); p.appendChild(win); root.appendChild(p);
    var cv = h('canvas', { id: 'trendCv' }); root.appendChild(h('div', { 'class': 'panel' }, [cv, h('div', { id: 'trendLegend', 'class': 'chips' })]));
    cv.addEventListener('pointerdown', function (e) { cross = e.offsetX / cv.clientWidth; drawTrend(); });
    cv.addEventListener('pointermove', function (e) { if (e.buttons || e.pointerType === 'touch') { cross = e.offsetX / cv.clientWidth; drawTrend(); } });
    drawTrend();
  }
  function drawTrend() {
    var cv = $('trendCv'); if (!cv) return;
    var dpr = window.devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight; if (!W) return;
    cv.width = W * dpr; cv.height = H * dpr; var g = cv.getContext('2d'); g.scale(dpr, dpr);
    g.fillStyle = '#0b141f'; g.fillRect(0, 0, W, H); g.strokeStyle = '#1d2b3d'; g.lineWidth = 1; g.font = '10px system-ui'; g.fillStyle = '#8396ad';
    for (var i = 1; i < 5; i++) { g.beginPath(); g.moveTo(0, H * i / 5); g.lineTo(W, H * i / 5); g.stroke(); g.fillText((100 - i * 20) + '%', 3, H * i / 5 - 2); }
    var T2 = trendWin > 7200, HT = T2 ? histT2 : histT, HH = T2 ? hist2 : hist, SS = T2 ? 60 : 10;
    var n = Math.min(HT.length, Math.round(trendWin / SS)), start = HT.length - n;
    var leg = $('trendLegend'); leg.innerHTML = '';
    var idx = cross !== null && n > 1 ? Math.max(0, Math.min(n - 1, Math.round(cross * (n - 1)))) : n - 1;
    trendSel.forEach(function (t, ci) {
      var q = tg(t), a = HH[t] || []; g.strokeStyle = COLORS[ci]; g.lineWidth = 1.8; g.beginPath();
      for (var k = 0; k < n; k++) { var v = a[start + k], y = H - (v - q.lo) / (q.hi - q.lo) * H * .96 - H * .02, x = n > 1 ? k / (n - 1) * W : 0; if (k === 0) g.moveTo(x, y); else g.lineTo(x, y); }
      g.stroke();
      var cur = a[start + idx];
      leg.appendChild(h('span', { 'class': 'chip', style: 'border-color:' + COLORS[ci], text: t + ' ' + (cur !== undefined ? fmt(cur, q.unit) : '--') + ' ' + (UNIT[q.unit] || q.unit) + ' [' + q.lo + '–' + q.hi + ']' }));
    });
    if (cross !== null && n > 1) { var cx = idx / (n - 1) * W; g.strokeStyle = '#fff'; g.beginPath(); g.moveTo(cx, 0); g.lineTo(cx, H); g.stroke(); g.fillStyle = '#fff'; g.fillText(clock(HT[start + idx]), Math.min(cx + 4, W - 60), 12); }
  }
  function copyText(txt, msg) {
    function fb() { showModal('<h3>Copy this text</h3><textarea id="cpTxt" readonly style="width:100%;height:220px;background:#0b141f;color:#fff;border:1px solid #1d2b3d;border-radius:8px;font:11px ui-monospace,monospace"></textarea><button class="primary" id="mOk" style="width:100%;margin-top:8px">Close</button>', 'mOk'); var ta = $('cpTxt'); ta.value = txt; ta.focus(); ta.select(); }
    try { navigator.clipboard.writeText(txt).then(function () { toast(msg || 'Copied'); }, fb); } catch (e) { fb(); }
  }
  function exportCSV() {
    var T2 = trendWin > 7200, HT = T2 ? histT2 : histT, HH = T2 ? hist2 : hist, SS = T2 ? 60 : 10, n = Math.min(HT.length, Math.round(trendWin / SS)), start = HT.length - n;
    var rows = ['time_s,' + trendSel.join(',')];
    for (var i = 0; i < n; i++) rows.push(Math.round(HT[start + i]) + ',' + trendSel.map(function (tag) { var v = (HH[tag] || [])[start + i]; return v === undefined ? '' : (+v).toFixed(3); }).join(','));
    copyText(rows.join('\n'), 'CSV copied (' + n + ' rows)');
  }

  // ------------------------------------------------------------------ safety tab: ESD / cause & effect / fire & gas / overrides
  var fgSel = 'Z1', safeTab = 'ce';
  var ST_COL = { ok: '#2f7d57', low: '#e0b43a', high: '#ff4d4d', ovr: '#6b7a90', blind: '#c04bd6', fault: '#e08a3a' };
  function gotoFG(z, tab) { if (z) fgSel = z; safeTab = tab || 'fg'; tabTo('safety'); }
  function mmss(sec) { sec = Math.max(0, Math.round(sec)); return Math.floor(sec / 60) + ':' + ('0' + (sec % 60)).slice(-2); }
  function zoneStatus(Z) {
    var worst = 'ok', rank = { ok: 0, ovr: 1, fault: 2, low: 3, blind: 4, high: 5 };
    plant.FG_KEYS.forEach(function (k) {
      var zr = s().fgs.z[Z][k], pre = plant.FG_TYPES[k].pre, st = zr.blind ? 'blind' : (zr.conf || zr.high) ? 'high' : zr.low ? 'low' : zr.fault ? 'fault' : (s().fgs.ovr[pre + '-' + Z + '-A'] !== undefined || s().fgs.ovr[pre + '-' + Z + '-B'] !== undefined) ? 'ovr' : 'ok';
      if (rank[st] > rank[worst]) worst = st;
    });
    return worst;
  }
  function keySwitch() {
    var box = h('div', { 'class': 'panel' }, [h('h3', { text: 'F&G inhibit key switch (override authority)' })]);
    var st = h('span', { 'class': 'status' }), b1 = h('button', { 'class': 'primary', text: 'TURN KEY TO OVERRIDE', onclick: function () { act('fgKey', null, true); } }), b2 = h('button', { text: 'REMOVE KEY (NORMAL)', onclick: function () { act('fgKey', null, false); } });
    box.appendChild(h('div', { 'class': 'row' }, [h('span', { 'class': 'k', text: 'Key position' }), st]));
    box.appendChild(h('div', { 'class': 'ctl' }, [b1, b2]));
    box.appendChild(h('p', { 'class': 'note', text: 'Overrides need the key in OVERRIDE and a work permit or shift-supervisor approval. Every override is logged, raises an alarm, auto-expires after 60 min, and leaves that zone with degraded voting (2oo2 becomes 1oo1) or blind if both detectors are overridden. Always DE-OVERRIDE as soon as the job is finished and remove the key.' }));
    return { el: box, upd: function () { var k = s().fgs.key; st.textContent = k ? 'OVERRIDE' : 'NORMAL'; st.className = 'status ' + (k ? 'TRIPPED' : 'RUNNING'); b1.className = k ? '' : 'primary'; b2.className = k ? 'primary' : ''; } };
  }
  function buildSafety() {
    var root = $('safetyView'); root.innerHTML = '';
    var bar = h('div', { 'class': 'chips safetabs' });
    [['ce', 'ESD & C&E'], ['fg', 'Fire & Gas'], ['ovr', 'Overrides']].forEach(function (x) { bar.appendChild(h('span', { 'class': 'chip' + (safeTab === x[0] ? ' on' : ''), text: x[1], onclick: function () { safeTab = x[0]; buildSafety(); } })); });
    root.appendChild(bar);
    var body = h('div'); root.appendChild(body);
    delete viewUpd.safety;
    if (safeTab === 'ce') safetyCE(body); else if (safeTab === 'fg') safetyFG(body); else safetyOVR(body);
  }
  function safetyCE(root) {
    var pbBox = h('div', { 'class': 'panel' }, [h('h3', { text: 'Shutdown controls' })]);
    var esd = h('button', { 'class': 'pb danger', text: 'ESD-1 — HOLD 1 s' }), t = null;
    var down = function () { esd.textContent = 'HOLDING…'; t = setTimeout(function () { act('esd'); esd.textContent = 'ESD-1 — HOLD 1 s'; t = null; }, 1000); }, up = function () { if (t) { clearTimeout(t); t = null; esd.textContent = 'ESD-1 — HOLD 1 s'; } };
    ['pointerdown'].forEach(function (e) { esd.addEventListener(e, down); }); ['pointerup', 'pointerleave', 'pointercancel'].forEach(function (e) { esd.addEventListener(e, up); });
    pbBox.appendChild(esd);
    pbBox.appendChild(h('div', { 'class': 'ctl' }, [h('button', { text: 'PSD (process shutdown)', onclick: function () { act('psd'); } }), h('button', { 'class': 'primary', text: 'RESET ESD / PSD', onclick: function () { var r = act('resetESD'); if (r && r.ok) toast('ESD / PSD reset'); } }), h('button', { text: 'SILENCE HORN', onclick: function () { act('hornReset'); } })]));
    var st = h('div', { id: 'safetyStatus' }); pbBox.appendChild(st); root.appendChild(pbBox);
    var ce = h('div', { 'class': 'panel' }, [h('h3', { text: 'Cause & effect matrix (live)' })]);
    var tbl = h('table', { 'class': 'ce' }), hd = h('tr', null, [h('th', { text: 'Cause' }), h('th', { text: 'Vote' }), h('th', { text: 'Level' })]);
    plant.EFFECTS.forEach(function (e) { hd.appendChild(h('th', { text: e[0], title: e[1] })); }); hd.appendChild(h('th', { text: 'BYP' })); tbl.appendChild(hd);
    var rowsEl = plant.CE().map(function (c) {
      var bt = c.kind === 'process' ? h('button', { 'class': 'bypb', text: 'BYP', onclick: function () { var cur = plant.CE().filter(function (x) { return x.id === c.id; })[0]; act('ceByp', c.id, !(cur && cur.byp)); } }) : null;
      var tdName = h('td', { text: c.id + '  ' + c.desc }), tdVote = h('td', { text: c.vote }), r = h('tr', null, [tdName, tdVote, h('td', { text: c.level === 1 ? 'PSD' : 'ESD-1' })]);
      plant.EFFECTS.forEach(function (e) { r.appendChild(h('td', { 'class': c.level >= e[2] ? 'x' : '', text: c.level >= e[2] ? '●' : '' })); });
      r.appendChild(h('td', null, [bt]));
      if (c.kind === 'fg') r.onclick = function () { gotoFG(c.id.split('-')[1], 'fg'); };
      tbl.appendChild(r); return { c: c, r: r, tdVote: tdVote, bt: bt };
    });
    ce.appendChild(h('div', { 'class': 'cescroll' }, [tbl]));
    ce.appendChild(h('p', { 'class': 'note', text: 'PSD (level 1) closes ESDV-001, trips HO-1 and E-103 and sounds the general alarm. ESD-1 (level 2) additionally trips transfer, export, disposal and slop pumps and opens BDV-001 to flare; FKOD pumps P-401 stay available. Fire and gas causes need 2oo2 agreement of the zone detectors (1oo1 when one is overridden or faulty). BYP = SIS bypass of a process cause: needs the inhibit key, expires in 60 min.' }));
    root.appendChild(ce);
    viewUpd.safety = function () {
      var q = s(), live = plant.CE(), mp = {}; live.forEach(function (c) { mp[c.id] = c; });
      rowsEl.forEach(function (o) { var c = mp[o.c.id]; o.tdVote.textContent = c.vote; o.r.className = c.byp ? 'byp' : c.active ? 'act' : ''; if (o.bt) { o.bt.className = 'bypb' + (c.byp ? ' on' : ''); o.bt.textContent = c.byp ? 'BYPASSED' : 'BYP'; } });
      st.innerHTML = '<div class="row"><span class="k">Shutdown state</span><span class="v">' + ['NORMAL', 'PSD', 'ESD-1'][q.esd.level] + '</span></div>' +
        '<div class="row"><span class="k">Causes</span><span class="v">' + (q.esd.causes.join('; ').replace(/</g, '&lt;') || '—') + '</span></div>' +
        '<div class="row"><span class="k">ESDV-001 / BDV-001</span><span class="v">' + Math.round(q.esdv.pos) + '% / ' + (q.bdv ? 'OPEN' : 'closed') + '</span></div>' +
        '<div class="row"><span class="k">General alarm horn</span><span class="v">' + (q.horn ? 'SOUNDING' : 'silent') + '</span></div>' +
        '<div class="row"><span class="k">PSV-001 / PSV-101 / PSV-102 / TK-410 PVRV</span><span class="v">' + [q.sc.psv, q.v101.psv, q.ht.psv, q.tank.lift].map(function (x) { return x ? 'LIFT' : 'shut'; }).join(' / ') + '</span></div>' +
        '<div class="row"><span class="k">HP flare pilot / LP flare pilot</span><span class="v">' + q.flare.pilot + ' / ' + q.lpf.pilot + '</span></div>';
    };
  }
  function safetyFG(root) {
    var ks = keySwitch(); var zbar = h('div', { 'class': 'chips' }), zch = {};
    plant.FG_ZONES.forEach(function (zz) { var c = h('span', { 'class': 'chip', text: zz[0], onclick: function () { fgSel = zz[0]; buildSafety(); } }); zch[zz[0]] = c; zbar.appendChild(c); });
    root.appendChild(h('div', { 'class': 'panel' }, [h('h3', { text: 'Fire & gas zones' }), zbar]));
    var Z = fgSel, zdef = plant.FG_ZONES.filter(function (z) { return z[0] === Z; })[0];
    var card = h('div', { 'class': 'panel' }, [h('h3', { text: Z + ' · ' + zdef[1] })]); root.appendChild(card);
    var voteRows = {}, detRows = {};
    plant.FG_KEYS.forEach(function (k) {
      var T0 = plant.FG_TYPES[k], vs = h('span', { 'class': 'v' });
      card.appendChild(h('h4', { style: 'margin:10px 0 4px' }, [h('span', { text: T0.name + '  (alarm ' + T0.lo + ' ' + T0.unit + ' 1oo2 · ESD-1 ' + T0.hi + ' ' + T0.unit + ' 2oo2)' })]));
      card.appendChild(h('div', { 'class': 'row' }, [h('span', { 'class': 'k', text: 'Voting / state' }), vs])); voteRows[k] = vs;
      ['A', 'B'].forEach(function (p) {
        var id = T0.pre + '-' + Z + '-' + p, val = h('b', { text: '--' }), sta = h('span', { 'class': 'status' }), bo = h('button', { text: 'OVERRIDE', onclick: function () { act('fgOvr', id, s().fgs.ovr[id] === undefined); } });
        card.appendChild(h('div', { 'class': 'row detrow' }, [h('span', { 'class': 'k', text: id }), val, sta, bo])); detRows[id] = { val: val, sta: sta, bo: bo, k: k };
      });
    });
    card.appendChild(h('div', { 'class': 'ctl' }, [h('button', { text: 'OVERRIDE ALL ' + Z, onclick: function () { act('fgOvrZone', Z, true); } }), h('button', { 'class': 'primary', text: 'DE-OVERRIDE ALL ' + Z, onclick: function () { act('fgOvrZone', Z, false); } })]));
    card.appendChild(h('div', { 'class': 'ctl' }, [h('button', { text: 'FIELD CHECK ' + Z + ' (portable monitor)', onclick: function () { act('field', 'FG-' + Z); toast('Field operator sent to ' + Z); } }), h('button', { text: 'FIRE TEAM TO ' + Z, onclick: function () { act('hazardResp', Z, 'fire'); } }), h('button', { text: 'LEAK TEAM TO ' + Z, onclick: function () { act('hazardResp', Z, 'leak'); } })]));
    card.appendChild(h('p', { 'class': 'note', text: 'Verify a detector reading before you override it: send the field operator with a portable monitor. A spurious single reading does not trip the plant while 2oo2 voting is intact; overriding the healthy partner would turn one false signal into a shutdown.' }));
    root.appendChild(ks.el);
    viewUpd.safety = function () {
      ks.upd();
      plant.FG_ZONES.forEach(function (zz) { var st = zoneStatus(zz[0]); zch[zz[0]].className = 'chip' + (zz[0] === Z ? ' on' : ''); zch[zz[0]].style.borderColor = ST_COL[st]; zch[zz[0]].style.color = st === 'ok' ? '' : '#fff'; zch[zz[0]].style.background = st === 'ok' ? '' : ST_COL[st] + '55'; });
      plant.FG_KEYS.forEach(function (k) { var zr = s().fgs.z[Z][k]; voteRows[k].textContent = zr.vote + (zr.conf ? '  · CONFIRMED (ESD-1 demand)' : zr.high ? '  · HIGH' : zr.low ? '  · LOW alarm' : '  · normal') + (zr.fault ? '  · detector fault' : ''); voteRows[k].style.color = zr.conf || zr.high ? '#ff6b6b' : zr.low ? '#ffd479' : zr.blind ? '#d98cff' : ''; });
      Object.keys(detRows).forEach(function (id) {
        var d = s().fgs.det[id], r = detRows[id], T0 = plant.FG_TYPES[d.type], ov = s().fgs.ovr[id];
        r.val.textContent = d.val.toFixed(d.type === 'h2s' ? 1 : 0) + ' ' + T0.unit;
        r.sta.textContent = ov !== undefined ? 'OVERRIDDEN ' + mmss(ov - s().t) : d.fault === 'fail' ? 'FAULT' : d.val >= T0.hi ? 'HIGH' : d.val >= T0.lo ? 'LOW' : 'OK';
        r.sta.className = 'status ' + (ov !== undefined ? 'STOPPED' : (d.fault === 'fail' || d.val >= T0.hi) ? 'TRIPPED' : d.val >= T0.lo ? 'STARTING' : 'RUNNING');
        r.bo.textContent = ov !== undefined ? 'DE-OVERRIDE' : 'OVERRIDE'; r.bo.className = ov !== undefined ? 'primary' : '';
      });
    };
  }
  function safetyOVR(root) {
    var ks = keySwitch(); root.appendChild(ks.el);
    var list = h('div', { 'class': 'panel' }, [h('h3', { text: 'Active overrides and bypasses' })]); root.appendChild(list);
    var box = h('div'); list.appendChild(box);
    list.appendChild(h('div', { 'class': 'ctl' }, [h('button', { 'class': 'primary', text: 'DE-OVERRIDE ALL (restore detection)', onclick: function () { act('fgDeoverrideAll'); } })]));
    var summary = h('div', { 'class': 'panel' }, [h('h3', { text: 'Zone detection status' })]); root.appendChild(summary);
    var sbox = h('div'); summary.appendChild(sbox);
    var sig = '';
    viewUpd.safety = function () {
      ks.upd();
      var ov = s().fgs.ovr, bp = s().ceByp, keys = Object.keys(ov), bks = Object.keys(bp), sg = keys.join(',') + '|' + bks.join(',');
      if (sg !== sig) {
        sig = sg; box.innerHTML = '';
        if (!keys.length && !bks.length) box.appendChild(h('div', { 'class': 'row', text: 'No overrides or bypasses active. Detection and shutdown logic fully available.' }));
        keys.forEach(function (id) { var rem = h('span', { 'class': 'v' }); box.appendChild(h('div', { 'class': 'row', 'data-ov': id }, [h('span', { 'class': 'k', text: 'Detector ' + id }), rem, h('button', { 'class': 'primary', text: 'DE-OVERRIDE', onclick: function () { act('fgOvr', id, false); } })])); });
        bks.forEach(function (id) { box.appendChild(h('div', { 'class': 'row', 'data-by': id }, [h('span', { 'class': 'k', text: 'SIS bypass ' + id }), h('span', { 'class': 'v' }), h('button', { 'class': 'primary', text: 'REMOVE BYPASS', onclick: function () { act('ceByp', id, false); } })])); });
      }
      Array.prototype.forEach.call(box.querySelectorAll('[data-ov]'), function (r) { r.querySelector('.v').textContent = 'expires in ' + mmss(ov[r.getAttribute('data-ov')] - s().t); });
      Array.prototype.forEach.call(box.querySelectorAll('[data-by]'), function (r) { r.querySelector('.v').textContent = 'expires in ' + mmss(bp[r.getAttribute('data-by')] - s().t); });
      var rows = plant.FG_ZONES.map(function (zz) {
        var st = zoneStatus(zz[0]), v = plant.FG_KEYS.map(function (k) { return plant.FG_TYPES[k].pre + ' ' + s().fgs.z[zz[0]][k].vote; }).join(' · ');
        return '<div class="row"><span class="k"><b style="color:' + ST_COL[st] + '">●</b> ' + zz[0] + ' ' + zz[1] + '</span><span class="v" style="font-size:11px">' + v + '</span></div>';
      }).join('');
      if (sbox.getAttribute('data-h') !== rows) { sbox.setAttribute('data-h', rows); sbox.innerHTML = rows; }
    };
  }

  // ------------------------------------------------------------------ train tab
  var scoreShown = false;
  function buildTrain() {
    var root = $('trainView'); root.innerHTML = '';
    root.appendChild(h('div', { 'class': 'panel' }, [h('h3', { text: 'Operator' }), h('div', { 'class': 'ctl' }, [h('input', { type: 'text', id: 'opName', maxlength: '30', placeholder: 'Trainee name (for the report)', value: opName(), oninput: function (e) { setOp(e.target.value); } })]),
      h('p', { 'class': 'note', text: (cfg.ownerName ? 'Owner / instructor: ' + cfg.ownerName : '') + (cfg.credit ? '   ·   ' + cfg.credit : '') })]));
    root.appendChild(h('div', { id: 'scnActive' })); root.appendChild(h('div', { 'class': 'panel', id: 'kpiBox' }));
    var p = h('div', { 'class': 'panel' }, [h('h3', { text: 'Training scenarios' })]);
    plant.scenarios().forEach(function (d) {
      p.appendChild(h('div', { 'class': 'scn' }, [h('h4', null, [h('span', { text: d.title }), h('span', { 'class': 'badge ' + d.difficulty, text: d.difficulty })]), h('p', { text: d.desc }),
        h('div', { 'class': 'ctl' }, [h('button', { 'class': 'primary', text: 'START', onclick: function () { startScn(d.id); } })])]));
    });
    root.appendChild(p);
    var hp = h('div', { 'class': 'panel' }, [h('h3', { text: 'Score history' })]), hs = scores().slice(-8).reverse();
    if (!hs.length) hp.appendChild(h('div', { 'class': 'row', text: 'No completed scenarios yet' }));
    hs.forEach(function (r) { hp.appendChild(h('div', { 'class': 'row' }, [h('span', { 'class': 'k', text: r.date + ' · ' + r.title + (r.op ? ' · ' + r.op : '') }), h('span', { 'class': 'v', text: r.grade + ' ' + r.score })])); });
    hp.appendChild(h('div', { 'class': 'ctl' }, [h('button', { 'class': 'primary', text: 'TRAINING REPORT', onclick: showReport }), h('button', { text: 'Clear history', onclick: function () { try { localStorage.removeItem('nf_cpf_scores'); } catch (e) {} buildTrain(); } })]));
    root.appendChild(hp);
    var ins = h('div', { 'class': 'panel' }, [h('h3', { text: 'Instructor: inject faults' })]);
    var F = [['LT-101 drifting low', function () { plant.fault('inst', 'LT-101', { mode: 'DRIFT', rate: -0.04 }); }], ['FT-001 frozen', function () { plant.fault('inst', 'FT-001', { mode: 'FROZEN' }); }], ['PT-101 reads high', function () { plant.fault('inst', 'PT-101', { mode: 'HIGH' }); }],
      ['LCV-103 stuck', function () { plant.fault('valve', 'LCV-103'); }], ['P-101A seal leak', function () { plant.fault('pump', 'P-101A', { kind: 'seal', rate: 1 / 600 }); }], ['P-101A bearing wear', function () { plant.fault('pump', 'P-101A', { kind: 'bearing', v: 0.5 }); }],
      ['P-101B fails to start', function () { plant.fault('pump', 'P-101B', { kind: 'nostart' }); }], ['Foam in V-100', function () { plant.fault('foam', null, { v: 0.8 }); }], ['Emulsion carryover', function () { plant.fault('emul', null, { v: 0.6 }); }],
      ['V-210 fouling', function () { plant.fault('hx2', null, { v: 0.5 }); }], ['G-1 trip', function () { plant.fault('gen', 'G-1'); }], ['LACT meter drift', function () { plant.fault('lact', null, { v: 1.006 }); }], ['Hydrocyclone fouled', function () { plant.fault('hc', null, { v: 0.4 }); }],
      ['Trip P-101A (no standby)', function () { s().auto['P-101'] = false; s().pumps['P-101A'] = 'TRIPPED'; }], ['Trip HO-1', function () { s().ho.burner = 'TRIPPED'; }], ['Trip E-103', function () { s().ht.burner = 'TRIPPED'; }],
      ['Trip P-201A', function () { s().pumps['P-201A'] = 'TRIPPED'; }], ['Slug +100% 3 min', function () { s().well.slug = 1.0; setTimeout(function () { s().well.slug = 0; }, 180000 / speed); }],
      ['Water cut +25 pts', function () { s().well.wc = Math.min(0.8, s().well.wc + 0.25); }], ['IA failure', function () { s().ia.A = 'STOPPED'; s().ia.leak = true; setTimeout(function () { s().ia.leak = false; }, 300000 / speed); }],
      ['Power failure (blackout)', function () { act('power', null, false); }], ['Gas leak Z2', function () { plant.fault('leak', 'Z2', { kind: 'gas', rate: 0.5 }); }], ['H2S leak Z1', function () { plant.fault('leak', 'Z1', { kind: 'h2s', rate: 0.1 }); }], ['Fire Z3', function () { plant.fault('fire', 'Z3'); }],
      ['Spurious GD-Z3-A', function () { plant.fault('detector', 'GD-Z3-A', { kind: 'spike' }); }], ['GD-Z2-B fails (fault)', function () { plant.fault('detector', 'GD-Z2-B', { kind: 'fail' }); }], ['N2 package trip', function () { plant.fault('n2'); }], ['Block TK-410 vent', function () { plant.fault('vent'); }], ['LP pilot out', function () { plant.fault('lpout'); }],
      ['Pipeline 40%', function () { s().pipe.avail = 0.4; }], ['Flare pilot out', function () { s().flare.pilot = 'OUT'; }], ['HX-1 fouling 60%', function () { plant.cfg.hx1.foul = 0.6; }],
      ['Open GV-3 / GV-4', function () { s().hv['GV-3'] = 100; s().hv['GV-4'] = 100; }], ['Close GV-2', function () { s().hv['GV-2'] = 0; }], ['Open BV-CL', function () { s().hv['BV-CL'] = 100; }], ['Open BV-HT', function () { s().hv['BV-HT'] = 100; }],
      ['Clear faults', function () { s().pipe.avail = 1; s().well.wc = cfgWC(); s().well.slug = 0; s().ia.leak = false; act('power', null, true); plant.fault('clear'); s().hv['GV-1'] = 100; s().hv['GV-2'] = 100; s().hv['GV-3'] = 0; s().hv['GV-4'] = 0; s().hv['BV-CL'] = 0; s().hv['VENT-410'] = 100; s().hv['BV-HT'] = 0; s().fk.surge = 0; plant.cfg.hx1.foul = 0; }]];
    var ctl = h('div', { 'class': 'ctl' }); F.forEach(function (f) { ctl.appendChild(h('button', { text: f[0], onclick: function () { f[1](); toast(f[0] + ' injected'); } })); }); ins.appendChild(ctl); root.appendChild(ins);
    var sv = h('div', { 'class': 'panel' }, [h('h3', { text: 'Session' }), h('div', { 'class': 'ctl' }, [
      h('button', { text: 'Reset to normal operation', onclick: function () { plant.reset('normal'); clearHist(); toast('Plant reset'); alarmSig = ''; } }),
      h('button', { text: 'Cold shutdown state', onclick: function () { plant.startScenario('cold-startup'); clearHist(); toast('Cold shutdown loaded'); } }),
      h('button', { text: 'Save', onclick: function () { save(true); } }), h('button', { text: 'Load', onclick: load }), h('button', { text: 'العربية / English', onclick: function () { if (window.__cpfUI.toggleLang) window.__cpfUI.toggleLang(); } })])]);
    root.appendChild(sv);
    root.appendChild(h('div', { 'class': 'panel note', text: 'Training aid: a simplified dynamic model with illustrative numbers, tuned to the plant data supplied (600 m³/h liquid, 35% water cut, 6000 m³ tank, 450 m³/h export). It is not a validated process simulation and must not be used for design, safety-case or operating decisions. Real procedures are defined by your site SOPs and permit-to-work system.' }));
    viewUpd.train = renderTrainStatus;
  }
  function cfgWC() { return (cfg.wells && cfg.wells.waterCut !== undefined) ? cfg.wells.waterCut : E.DEFAULTS.wells.waterCut; }
  function startScn(id) { plant.startScenario(id); clearHist(); record(); scoreShown = false; alarmSig = ''; setSpeed(1); tabTo('overview'); var d = plant.scenarios().filter(function (x) { return x.id === id; })[0]; showModal('<h3>' + d.title + '</h3><p>' + d.brief + '</p><ul>' + d.objectives.map(function (o) { return '<li>' + o + '</li>'; }).join('') + '</ul><button class="primary" id="mOk" style="width:100%">Begin</button>', 'mOk'); }
  function renderTrainStatus() {
    var sc = plant.scenario, box = $('scnActive'); if (!box) return;
    if (!sc) { box.innerHTML = ''; } else {
      var el = Math.floor(s().t - sc.t0);
      box.innerHTML = '<div class="panel"><h3>' + sc.def.title + ' — ' + (sc.done ? 'COMPLETE' : clock(el) + ' / ' + clock(sc.def.duration)) + '</h3>' + sc.def.objectives.map(function (o, i) { var st = sc.status[i]; return '<div class="obj ' + st + '">' + (st === 'done' ? '✔ ' : st === 'failed' ? '✘ ' : '○ ') + o.text + '</div>'; }).join('') + (sc.score ? '<div class="big">' + sc.score.grade + ' · ' + sc.score.total + '</div>' : '') + '</div>';
    }
    var k = plant.kpi;
    $('kpiBox').innerHTML = '<h3>KPIs (since start)</h3>' + [['Exported crude', k.exportedM3.toFixed(0) + ' m³'], ['Gas to flare', (k.flaredSm3 / 1000).toFixed(0) + ' kSm³'], ['Unlit-flare venting', Math.round(k.ventSec) + ' s'], ['Off-spec crude', k.offspecM3.toFixed(0) + ' m³'], ['PSD / ESD-1 / PSV', k.psdCount + ' / ' + k.esdCount + ' / ' + k.psvLifts], ['P1 alarm time', Math.round(k.alarmSecP1 / 60) + ' min']].map(function (r) { return '<div class="row"><span class="k">' + r[0] + '</span><span class="v">' + r[1] + '</span></div>'; }).join('');
    if (sc && sc.done && !scoreShown) { scoreShown = true; addScore({ date: new Date().toLocaleDateString(), op: opName(), id: sc.def.id, title: sc.def.title, score: sc.score.total, grade: sc.score.grade, notes: sc.score.notes.join('; ') }); showModal('<h3>' + sc.def.title + (opName() ? ' — ' + opName() : cfg.ownerName ? ' — ' + cfg.ownerName : '') + '</h3><div class="big">' + sc.score.grade + ' · ' + sc.score.total + '</div>' + (sc.score.notes.length ? '<ul>' + sc.score.notes.map(function (n) { return '<li>' + n + '</li>'; }).join('') + '</ul>' : '<p>Clean run — no penalties.</p>') + '<button class="primary" id="mOk" style="width:100%">Close</button>', 'mOk'); }
  }
  function opName() { try { return localStorage.getItem('nf_cpf_op') || ''; } catch (e) { return ''; } }
  function setOp(n) { try { localStorage.setItem('nf_cpf_op', n); } catch (e) {} }
  function scores() { try { return JSON.parse(localStorage.getItem('nf_cpf_scores') || '[]'); } catch (e) { return []; } }
  function addScore(r) { var a = scores(); a.push(r); if (a.length > 100) a.shift(); try { localStorage.setItem('nf_cpf_scores', JSON.stringify(a)); } catch (e) {} }
  function reportText() {
    var a = scores(), L = [], sum = 0;
    L.push((cfg.facilityName || 'CPF') + ' - OPERATOR TRAINING REPORT'); L.push('Operator: ' + (opName() || '(not set)') + (cfg.ownerName ? '    Owner / instructor: ' + cfg.ownerName : '')); if (cfg.credit) L.push(cfg.credit);
    L.push('Date: ' + new Date().toLocaleString()); L.push('');
    if (!a.length) L.push('No completed scenarios yet.');
    a.forEach(function (r) { sum += r.score; L.push(r.date + ' | ' + r.title + ' | ' + r.grade + ' ' + r.score + (r.op ? ' | ' + r.op : '') + (r.notes ? ' | ' + r.notes : '')); });
    if (a.length) { L.push(''); L.push('Scenarios: ' + a.length + '   Average score: ' + Math.round(sum / a.length)); }
    return L.join('\n');
  }
  function showReport() {
    var txt = reportText();
    showModal('<h3>Training report</h3><pre id="rpt" class="rpt"></pre><div class="ctl"><button class="primary" id="mOk">Close</button><button id="rpPrint">Print</button><button id="rpCopy">Copy text</button></div>', 'mOk');
    $('rpt').textContent = txt; $('rpPrint').onclick = function () { try { window.print(); } catch (e) { toast('Printing is not available here, use Copy text', true); } }; $('rpCopy').onclick = function () { copyText(txt, 'Report copied'); };
  }
  function showModal(html, okId) { var m = $('modal'); $('modalBox').innerHTML = html + (cfg.credit ? '<p class="credit">' + cfg.credit + '</p>' : ''); m.className = 'modal'; $(okId).onclick = function () { m.className = 'modal hidden'; }; }

  // ------------------------------------------------------------------ save / load
  function save(manual) { try { localStorage.setItem('nf_cpf_save_v3', plant.snapshot()); if (manual) toast('Session saved'); } catch (e) { if (manual) toast('Save not available', true); } }
  function load() { try { var d = localStorage.getItem('nf_cpf_save_v3'); if (!d) return toast('No saved session', true); plant.restore(d); clearHist(); alarmSig = ''; toast('Session loaded'); } catch (e) { toast('Load failed', true); } }

  // ------------------------------------------------------------------ top bar, tabs, audio, zoom, areas
  var curView = 'overview', speed = 1, paused = false, muted = true, audio = null, lastUnack = 0;
  function setSpeed(x) { speed = x; Array.prototype.forEach.call($('speed').children, function (b) { b.className = (+b.getAttribute('data-x') === x) ? 'on' : ''; }); }
  [1, 5, 10, 30, 60].forEach(function (x) { $('speed').appendChild(h('button', { text: x + '×', 'data-x': x, onclick: function () { setSpeed(x); } })); }); setSpeed(1);
  $('btnPause').onclick = function () { paused = !paused; $('btnPause').textContent = paused ? '▶' : '❚❚'; };
  $('btnMute').onclick = function () { muted = !muted; $('btnMute').textContent = muted ? '🔕' : '🔔'; if (!muted && !audio) { try { audio = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} } };
  $('btnMute').textContent = '🔕';
  function beep(n) { if (muted || !audio) return; try { for (var i = 0; i < n; i++) { var o = audio.createOscillator(), g = audio.createGain(); o.frequency.value = n > 1 ? 880 : 660; g.gain.value = .08; o.connect(g); g.connect(audio.destination); o.start(audio.currentTime + i * .22); o.stop(audio.currentTime + i * .22 + .15); } } catch (e) {} }
  function tabTo(v) {
    curView = v; Array.prototype.forEach.call(document.querySelectorAll('#tabs button'), function (b) { b.className = b.getAttribute('data-v') === v ? 'on' : ''; });
    Array.prototype.forEach.call(document.querySelectorAll('.view'), function (x) { x.className = 'view' + (x.id === 'v-' + v ? ' active' : ''); });
    var ub = window.__cpfUI && window.__cpfUI.build[v]; if (ub) ub(); if (v === 'alarms') renderAlarms(true); if (v === 'trends') buildTrends(); if (v === 'train') buildTrain(); if (v === 'safety') buildSafety(); if (v === 'control') buildControl();
  }
  Array.prototype.forEach.call(document.querySelectorAll('#tabs button'), function (b) { b.onclick = function () { tabTo(b.getAttribute('data-v')); }; });
  $('alarmBanner').onclick = function () { tabTo('alarms'); };
  var zoom = VBW;
  function setZoom(w) { zoom = Math.max(250, Math.min(3600, w)); svg.style.width = zoom + 'px'; svg.style.height = zoom * VBH / VBW + 'px'; }
  $('zIn').onclick = function () { setZoom(zoom * 1.25); }; $('zOut').onclick = function () { setZoom(zoom / 1.25); };
  function gotoArea(a) {
    var wrap = $('mimicWrap'), sc = wrap.clientWidth / a[3]; setZoom(VBW * sc);
    wrap.scrollLeft = a[1] * sc; wrap.scrollTop = a[2] * sc;
    Array.prototype.forEach.call($('areaBar').children, function (b) { b.className = b.getAttribute('data-a') === a[0] ? 'on' : ''; });
  }
  AREAS.forEach(function (a) { $('areaBar').appendChild(h('button', { text: a[0], 'data-a': a[0], onclick: function () { gotoArea(a); } })); });
  function fitAll() { gotoArea(AREAS[0]); }

  function refreshTop() {
    $('clock').textContent = clock(s().t); $('facName').textContent = (cfg.facilityName || 'CPF');
    var list = plant.activeAlarms(), unack = list.filter(function (a) { return a.state === 'ACTIVE_UNACK' || a.state === 'RTN_UNACK'; });
    var act1 = list.filter(function (a) { return a.state !== 'RTN_UNACK'; }), top = act1[0] || list[0], b = $('alarmBanner');
    if (!top) { b.className = 'banner ok'; $('alarmText').textContent = 'No active alarms'; }
    else { b.className = 'banner p' + top.pr + (unack.length ? ' blink' : ''); $('alarmText').textContent = (top.pr === 1 ? '‼ ' : '▲ ') + top.id + ' · ' + top.desc + (list.length > 1 ? ' (+' + (list.length - 1) + ')' : ''); }
    $('tabAlarmCnt').textContent = unack.length ? unack.length : '';
    if (unack.length > lastUnack) { var p1 = unack.some(function (a) { return a.pr === 1; }); beep(p1 ? 2 : 1); if (p1 && navigator.vibrate) { try { navigator.vibrate([120, 80, 120]); } catch (e) {} } }
    lastUnack = unack.length;
    var fb = $('fgBadge');
    if (fb) {
      var fa = plant.fgsActive(), ovn = Object.keys(s().fgs.ovr).length + Object.keys(s().ceByp).length, anyLow = plant.FG_ZONES.some(function (z) { return plant.FG_KEYS.some(function (k) { return s().fgs.z[z[0]][k].low; }); });
      fb.className = 'esd ' + (fa.length ? 'esd1' : (anyLow || s().horn) ? 'psd' : ovn ? 'psd' : 'ok');
      fb.textContent = fa.length ? 'F&G ALARM' : anyLow ? 'F&G PRE-ALARM' : ovn ? 'F&G OVR ' + ovn : 'F&G OK';
    }
    var lv = s().esd.level, e = $('esdBadge'); e.className = 'esd ' + (lv === 0 ? 'ok' : lv === 1 ? 'psd' : 'esd1'); e.textContent = lv === 0 ? 'ESD OK' : lv === 1 ? 'PSD' : 'ESD-1';
  }

  // ------------------------------------------------------------------ main loop
  var lastReal = performance.now(), acc = 0, lastUI = 0;
  function frame(now) {
    var dtReal = Math.min((now - lastReal) / 1000, 0.25); lastReal = now;
    if (!paused) {
      acc += dtReal * speed;
      var chunks = 0;
      while (acc >= 10 && chunks < 80) { plant.advance(10); acc -= 10; chunks++; record(); }
      if (acc >= plant.cfg.dt && chunks < 80) { var n = Math.floor(acc / plant.cfg.dt); plant.advance(n * plant.cfg.dt); acc -= n * plant.cfg.dt; if (s().t - (histT[histT.length - 1] || 0) >= 10) record(); }
    }
    if (now - lastUI > 250) {
      lastUI = now; upd.forEach(function (f) { f(); }); if (viewUpd[curView]) viewUpd[curView](); refreshTop(); refreshSheet();
      if (curView === 'alarms') renderAlarms(false);
      if (curView === 'trends') drawTrend();
    }
    requestAnimationFrame(frame);
  }
  if (cfg.ownerName) { $('ownerTag').textContent = cfg.ownerName; if (cfg.credit) $('ownerTag').appendChild(h('small', { text: cfg.credit })); }
  buildMimic(); record(); fitAll();
  window.addEventListener('resize', function () { var a = AREAS.filter(function (x) { return $('areaBar').querySelector('.on') && $('areaBar').querySelector('.on').getAttribute('data-a') === x[0]; })[0]; if (a) gotoArea(a); });
  document.addEventListener('visibilitychange', function () { if (document.hidden) { paused = true; $('btnPause').textContent = '▶'; save(false); } });
  try { if (navigator.wakeLock) navigator.wakeLock.request('screen').catch(function () {}); } catch (e) {}
  if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) { navigator.serviceWorker.register('sw.js').catch(function () {}); }
  window.__cpfUI = { gotoFG: gotoFG, h: h, act: act, toast: toast, clock: clock, fmt: fmt, plant: plant, s: s, tg: tg, cfg: cfg, showModal: showModal, copyText: copyText, viewUpd: viewUpd, tabTo: tabTo, openSheet: openSheet, build: {}, opName: opName, EQ: EQ };
  window.__cpf = { plant: plant, tabTo: tabTo, openSheet: openSheet, setSpeed: setSpeed, gotoArea: gotoArea, AREAS: AREAS };
  requestAnimationFrame(frame);
})();
