/* HBJF — process engine (UI-agnostic; runs in the WebView and in Node).
 *
 * Flowsheet (oil train):
 *   Wellheads W-1..3 -> oil manifold MF-1 -> ESDV-001 -> slug catcher V-001
 *   -> shell & tube thermal (hot oil) exchanger HX-1 heated by HO-1 -> 1st stage separator V-100
 *   -> exchanger V-210 (hot oil) -> heater treater HT-200 (fired, E-103 burner; bypass BV-HT)
 *   -> 2 x Viking transfer pumps P-101A/B -> oil manifold MF-2 with 4 gate / straight valves:
 *        GV-1 stripping column inlet, GV-2 stripping column outlet, GV-3 and GV-4 straight bypass to the cooler
 *   -> stripping column C-101 (reboiler on hot oil, N2 stripping gas from the N2 package via XV-N2)
 *   -> oil fan cooler E-105 (bypass line BV-CL ties in at V-110) -> 2nd stage separator V-110
 *   -> storage tank TK-410 (or slop TK-430) -> export pumps P-201A/B -> LACT -> pipeline.
 *   TK-410 cold vent (VENT-410, PVRV) -> LP flare FL-402.
 *   Gas from every vessel -> flare KO drum V-401 (FKOD) -> HP flare FL-401 (pilot).
 *   Water from every vessel -> produced water tank TK-420 -> disposal pumps P-301A/B.
 *   Drains -> slop tank TK-430; FKOD pumps P-401A/B -> slop; slop pump P-501 -> V-001.
 *   Utilities: hot oil heater HO-1, instrument air, N2 package, 2 x generator G-1 / G-2 (load shedding).
 *   Safety: PSD (level 1) / ESD-1 (level 2) data-driven cause & effect, PSVs, BDV-001, fired-heater and pump trips,
 *   fire & gas system: 7 zones x (combustible gas, H2S, flame) detectors A/B, 2oo2 voting that degrades to 1oo1 on
 *   override / fault, inhibit key switch, detector override / de-override with 60 min auto-expiry, SIS bypass.
 * Volumes m3, pressures barg, liquid flows m3/h, gas Sm3/h, temperatures degC, duties kW.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CPFEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DEFAULTS = {
    facilityName: 'CPF-1',
    dt: 0.5,
    wells: { liquidRate: 600, waterCut: 0.35, gor: 60, wellheadTemp: 50, wellheadP: 35 },
    sc:   { cap: 250, gasVol: 180, P: 12.0, psvSet: 16.5 },
    v101: { cap: 160, gasVol: 55, P: 6.0, psvSet: 9.5 },
    ht:   { cap: 140, gasVol: 40, P: 2.5, T: 85, psvSet: 4.8, burnerMaxKW: 5000 },
    col:  { cap: 40, gasVol: 60, P: 1.2, Treb: 120 },
    v103: { cap: 90, gasVol: 45, P: 0.8 },
    fkod: { cap: 30, gasVol: 150, P: 0.10, psvSet: 2.0 },
    ho:   { T: 190, maxKW: 15000 },
    hx1:  { eff: 0.28, foul: 0 },
    dem: 25,
    tank:  { cap: 6000, level: 55, bswSpec: 0.5 },
    slop:  { cap: 600, level: 12 },
    water: { cap: 800, level: 40 },
    export: { pumpFlow: 520, setFlow: 450 },
    rvpSpec: 10.0,
    ambient: 30,
    weather: { amp: 3 },
    gen: { cap: 1500 },
    chem: { ci: 10, af: 5 }
  };

  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function merge(a, b) {
    for (var k in b) {
      if (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && a[k] && typeof a[k] === 'object') merge(a[k], b[k]);
      else a[k] = b[k];
    }
    return a;
  }
  function clamp(x, lo, hi) { return x < lo ? lo : (x > hi ? hi : x); }
  function vflow(pos, qmax, dp, dpn) { return qmax * (pos / 100) * Math.sqrt(Math.max(dp, 0) / dpn); }
  var ATM = 1.013;
  function capr(q, b) { return Math.max(q, 0) * ((1 - b) * 850 * 2.0 + b * 1000 * 4.18) / 3600; }   // kW/K

  // ------------------------------------------------------------------ alarms
  // [id, description, tag, '>'|'<', limit, priority (1 high .. 3 low), deadband]
  var ALARM_DEFS = [
    ['PAHH-001', 'V-001 pressure high-high', 'PT-001', '>', 14.5, 1, 0.3],
    ['PAH-001',  'V-001 pressure high', 'PT-001', '>', 13.3, 2, 0.3],
    ['PAL-001',  'V-001 pressure low', 'PT-001', '<', 9.5, 3, 0.3],
    ['LAHH-001', 'V-001 level high-high', 'LT-001', '>', 85, 1, 2],
    ['LAH-001',  'V-001 level high', 'LT-001', '>', 70, 2, 2],
    ['LAL-001',  'V-001 level low', 'LT-001', '<', 25, 2, 2],
    ['LALL-001', 'V-001 level low-low', 'LT-001', '<', 10, 1, 2],
    ['LAH-002',  'V-001 interface high', 'LI-002', '>', 45, 2, 2],
    ['LAL-002',  'V-001 interface low (oil carry-under)', 'LI-002', '<', 8, 2, 2],
    ['PAHH-101', 'V-100 pressure high-high', 'PT-101', '>', 8.0, 1, 0.2],
    ['PAH-101',  'V-100 pressure high', 'PT-101', '>', 7.2, 2, 0.2],
    ['PAL-101',  'V-100 pressure low', 'PT-101', '<', 4.5, 3, 0.2],
    ['LAHH-101', 'V-100 level high-high', 'LT-101', '>', 85, 1, 2],
    ['LAH-101',  'V-100 level high', 'LT-101', '>', 70, 2, 2],
    ['LAL-101',  'V-100 level low', 'LT-101', '<', 25, 2, 2],
    ['LALL-101', 'V-100 level low-low', 'LT-101', '<', 10, 1, 2],
    ['LAH-102',  'V-100 interface high', 'LI-102', '>', 40, 2, 2],
    ['TAH-103',  'V-210 outlet temperature high', 'TT-103', '>', 90, 2, 2],
    ['TAL-103',  'V-210 outlet temperature low', 'TT-103', '<', 66, 3, 2],
    ['PAH-102',  'HT-200 pressure high', 'PT-102', '>', 3.3, 2, 0.15],
    ['PAHH-102', 'HT-200 pressure high-high', 'PT-102', '>', 4.0, 1, 0.15],
    ['LAH-103',  'HT-200 level high', 'LT-103', '>', 75, 2, 2],
    ['LAHH-103', 'HT-200 level high-high', 'LT-103', '>', 88, 1, 2],
    ['LAL-103',  'HT-200 level low', 'LT-103', '<', 25, 2, 2],
    ['LALL-103', 'HT-200 level low-low (pump & burner trip)', 'LT-103', '<', 12, 1, 2],
    ['LAH-104',  'HT-200 interface high', 'LI-104', '>', 40, 2, 2],
    ['TAH-102',  'HT-200 temperature high', 'TT-102', '>', 93, 2, 1.5],
    ['TAHH-102', 'HT-200 temperature high-high (burner trip)', 'TT-102', '>', 100, 1, 1.5],
    ['TAL-102',  'HT-200 temperature low', 'TT-102', '<', 74, 3, 2],
    ['TAH-101',  'HO-1 hot oil temperature high', 'TT-101', '>', 205, 2, 2],
    ['TAHH-101', 'HO-1 hot oil temperature high-high (burner trip)', 'TT-101', '>', 218, 1, 2],
    ['TAL-101',  'HO-1 hot oil temperature low', 'TT-101', '<', 165, 3, 3],
    ['PAH-104',  'C-101 pressure high', 'PT-104', '>', 1.9, 2, 0.1],
    ['PAHH-104', 'C-101 pressure high-high', 'PT-104', '>', 2.4, 1, 0.1],
    ['LAH-105',  'C-101 sump level high', 'LT-105', '>', 75, 2, 2],
    ['LAL-105',  'C-101 sump level low', 'LT-105', '<', 25, 2, 2],
    ['TAL-104',  'C-101 reboiler temperature low', 'TT-104', '<', 112, 3, 2],
    ['TAH-104',  'C-101 reboiler temperature high', 'TT-104', '>', 130, 3, 2],
    ['TAH-105',  'E-105 outlet temperature high', 'TT-105', '>', 58, 2, 2],
    ['PAH-103',  'V-110 pressure high', 'PT-103', '>', 1.3, 2, 0.1],
    ['LAH-106',  'V-110 level high', 'LT-106', '>', 75, 2, 2],
    ['LAL-106',  'V-110 level low', 'LT-106', '<', 25, 2, 2],
    ['LAH-107',  'V-110 interface high', 'LI-107', '>', 40, 2, 2],
    ['AAH-102',  'Crude RVP high (off-spec)', 'AT-102', '>', 10.0, 2, 0.2],
    ['AAH-101',  'Crude BS&W high (>0.4%)', 'AT-101', '>', 0.4, 2, 0.04],
    ['AAHH-101', 'Crude BS&W high-high (off-spec)', 'AT-101', '>', 0.5, 1, 0.04],
    ['PAH-401',  'Flare header (FKOD) pressure high', 'PT-401', '>', 0.8, 2, 0.1],
    ['PAHH-401', 'Flare header (FKOD) pressure high-high', 'PT-401', '>', 1.2, 1, 0.1],
    ['LAH-401',  'FKOD level high', 'LT-401', '>', 50, 2, 2],
    ['LAHH-401', 'FKOD level high-high', 'LT-401', '>', 75, 1, 2],
    ['LAHH-201', 'TK-410 level high-high', 'LT-201', '>', 93, 1, 1],
    ['LAH-201',  'TK-410 level high', 'LT-201', '>', 85, 2, 1],
    ['LAL-201',  'TK-410 level low', 'LT-201', '<', 10, 2, 1],
    ['LALL-201', 'TK-410 level low-low (export pump trip)', 'LT-201', '<', 4, 1, 1],
    ['AAH-201',  'TK-410 BS&W out of spec', 'AT-201', '>', 0.5, 2, 0.02],
    ['LAH-202',  'TK-430 slop tank level high', 'LT-202', '>', 80, 2, 2],
    ['LAH-301',  'TK-420 water level high', 'LT-301', '>', 80, 2, 2],
    ['LAL-301',  'TK-420 water level low', 'LT-301', '<', 20, 3, 2],
    ['AAH-301',  'Oil-in-water high', 'AT-301', '>', 40, 2, 3],
    ['AAHH-301', 'Oil-in-water high-high', 'AT-301', '>', 100, 1, 3],
    ['AAH-103',  'Stripped crude H2S high (N2 stripping poor)', 'AT-103', '>', 12, 2, 0.5],
    ['TAH-110',  'V-110 inlet temperature high (cooler bypass?)', 'TT-110', '>', 60, 2, 2],
    ['PAL-N2',   'N2 package pressure low', 'PT-N2', '<', 5.0, 2, 0.3],
    ['PAH-410',  'TK-410 vapour pressure high', 'PT-410', '>', 22, 2, 2],
    ['PAHH-410', 'TK-410 vapour pressure high-high (PVRV lifting)', 'PT-410', '>', 32, 1, 2],
    ['PAL-410',  'TK-410 vapour pressure low (vacuum risk)', 'PT-410', '<', -2, 2, 0.5],
    ['PAH-405',  'LP flare header pressure high', 'PT-405', '>', 0.03, 2, 0.004],
    ['PAL-901',  'Instrument air pressure low', 'PT-901', '<', 5.5, 2, 0.3],
    ['PALL-901', 'Instrument air pressure low-low', 'PT-901', '<', 4.0, 1, 0.3]
  ];
  // ------------------------------------------------------------------ fire & gas system definitions
  var FG_ZONES = [
    ['Z1', 'Wellhead, MF-1 manifold and V-001 slug catcher'],
    ['Z2', 'Separation: HX-1, V-100, V-210, HT-200'],
    ['Z3', 'Manifold MF-2, P-101 pumps, C-101 stripper, N2 package'],
    ['Z4', 'Cooler E-105, V-110, TK-410 and export pumps'],
    ['Z5', 'Water and slop: TK-420, P-301, TK-430, P-501'],
    ['Z6', 'Packages: generators G-1 / G-2, switchgear, fuel gas'],
    ['Z7', 'FKOD V-401, HP flare, HO-1 hot oil heater']
  ];
  // type -> pre-alarm (1oo2), high / confirmed (2oo2) thresholds
  var FG_TYPES = {
    gas:  { name: 'Combustible gas', pre: 'GD', unit: '%LEL', lo: 20, hi: 60, max: 100 },
    h2s:  { name: 'H2S',             pre: 'HS', unit: 'ppm',  lo: 5,  hi: 15, max: 50 },
    fire: { name: 'Flame (UV/IR)',   pre: 'FD', unit: '%',    lo: 30, hi: 60, max: 100 }
  };
  var FG_KEYS = ['gas', 'h2s', 'fire'];
  var FG_EXPIRE = 3600;          // override auto-expiry (s)
  // process causes of PSD (level 1) and ESD-1 (level 2): id, tag, description, level, test
  var CAUSES = [
    ['PSHH-001', 'PT-001', 'V-001 pressure high-high', 1, function (t) { return t['PT-001'].v >= 15.0; }],
    ['LSHH-001', 'LT-001', 'V-001 level high-high', 1, function (t) { return t['LT-001'].v >= 90; }],
    ['PSHH-101', 'PT-101', 'V-100 pressure high-high', 1, function (t) { return t['PT-101'].v >= 8.5; }],
    ['LSHH-101', 'LT-101', 'V-100 level high-high', 1, function (t) { return t['LT-101'].v >= 90; }],
    ['LSHH-103', 'LT-103', 'HT-200 level high-high', 1, function (t) { return t['LT-103'].v >= 92; }],
    ['PSHH-102', 'PT-102', 'HT-200 pressure high-high', 1, function (t) { return t['PT-102'].v >= 4.5; }],
    ['PSHH-401', 'PT-401', 'Flare header (FKOD) pressure high-high', 1, function (t) { return t['PT-401'].v >= 1.4; }],
    ['LSHH-401', 'LT-401', 'FKOD level high-high (liquid carry-over to flare)', 1, function (t) { return t['LT-401'].v >= 85; }],
    ['LSHH-201', 'LT-201', 'TK-410 level high-high', 1, function (t) { return t['LT-201'].v >= 95; }]
  ];
  // final elements (effects); an effect fires at or above its minimum level
  var EFFECTS = [
    ['ESDV-001', 'Inlet ESDV-001 closes', 1],
    ['BURN', 'HO-1 and E-103 burners trip', 1],
    ['HORN', 'General alarm, beacons and horns', 1],
    ['PUMPS', 'P-101 / P-201 / P-301 / P-501 trip', 2],
    ['BDV', 'Blowdown BDV-001 opens to flare', 2]
  ];

  var TRIPS = { 'P-101A': 1, 'P-101B': 1, 'P-201A': 1, 'P-201B': 1, 'P-301A': 1, 'P-301B': 1, 'P-401A': 1, 'P-401B': 1, 'P-501': 1 };
  var EVENT_ALARMS = [
    ['P-101A TRIP', 'Transfer pump P-101A tripped', 2, function (s) { return s.pumps['P-101A'] === 'TRIPPED'; }],
    ['P-101B TRIP', 'Transfer pump P-101B tripped', 2, function (s) { return s.pumps['P-101B'] === 'TRIPPED'; }],
    ['P-201A TRIP', 'Export pump P-201A tripped', 2, function (s) { return s.pumps['P-201A'] === 'TRIPPED'; }],
    ['P-201B TRIP', 'Export pump P-201B tripped', 2, function (s) { return s.pumps['P-201B'] === 'TRIPPED'; }],
    ['P-301A TRIP', 'Disposal pump P-301A tripped', 2, function (s) { return s.pumps['P-301A'] === 'TRIPPED'; }],
    ['P-401A TRIP', 'FKOD pump P-401A tripped', 2, function (s) { return s.pumps['P-401A'] === 'TRIPPED'; }],
    ['HO-1 TRIP',   'Hot oil heater HO-1 tripped', 1, function (s) { return s.ho.burner === 'TRIPPED'; }],
    ['E-103 TRIP',  'Heater treater burner E-103 tripped', 2, function (s) { return s.ht.burner === 'TRIPPED'; }],
    ['PILOT OUT',   'Flare pilot flame-out', 1, function (s) { return s.flare.pilot === 'OUT'; }],
    ['PSD ACTIVE',  'Process shutdown (PSD) active', 1, function (s) { return s.esd.level === 1; }],
    ['ESD-1 ACTIVE', 'Emergency shutdown (ESD-1) active', 1, function (s) { return s.esd.level === 2; }],
    ['POWER FAIL',  'Main power failure', 1, function (s) { return !s.power.on; }],
    ['PSV OPEN',    'PSV lifting to flare', 1, function (s) { return s.sc.psv || s.v101.psv || s.ht.psv; }],
    ['F&G OVERRIDE', 'Fire and gas detector override(s) active - detection degraded', 2, function (s) { return Object.keys(s.fgs.ovr).length > 0; }],
    ['F&G KEY', 'F&G inhibit key switch in OVERRIDE position', 2, function (s) { return s.fgs.key; }],
    ['SIS BYPASS', 'Process shutdown cause bypass active', 2, function (s) { return Object.keys(s.ceByp).length > 0; }],
    ['OVR EXPIRING', 'F&G override expires in less than 10 min - re-evaluate', 3, function (s) { for (var k in s.fgs.ovr) if (s.fgs.ovr[k] - s.t < 600) return true; for (var c in s.ceByp) if (s.ceByp[c] - s.t < 600) return true; return false; }],
    ['G-1 TRIP', 'Generator G-1 tripped', 1, function (s) { return s.gen['G-1'] === 'TRIPPED'; }],
    ['G-2 TRIP', 'Generator G-2 tripped', 1, function (s) { return s.gen['G-2'] === 'TRIPPED'; }],
    ['N2 PKG TRIP', 'N2 package tripped', 2, function (s) { return s.n2.pkg === 'TRIPPED'; }],
    ['LP PILOT OUT', 'LP flare pilot flame-out (TK-410 cold vent venting)', 2, function (s) { return s.lpf.pilot === 'OUT'; }],
    ['TK410 PVRV LIFT', 'TK-410 PVRV relieving to atmosphere', 1, function (s) { return s.tank.lift; }],
    ['TK410 VACUUM', 'TK-410 vacuum relief open (air ingress)', 1, function (s) { return s.tank.vac; }],
    ['LOAD SHED', 'Load shedding active (generation short)', 1, function (s) { return s.power.shed; }],
    ['POWER OVERLOAD', 'Electrical demand above generation', 1, function (s) { return s.power.demand > s.power.cap && s.power.on; }],
    ['LACT DIVERT', 'LACT diverting: export BS&W out of spec', 2, function (s) { return s.lact.divert; }],
    ['LACT PROVE DUE', 'LACT meter factor out of tolerance - prove meter', 3, function (s) { return Math.abs(s.lact.dev) > 0.003; }],
    ['LACT SAMPLER FULL', 'LACT sampler pot nearly full', 3, function (s) { return s.lact.samp > 95; }]
  ];
  FG_ZONES.forEach(function (zz) {
    var Z = zz[0];
    FG_KEYS.forEach(function (k) {
      var T = FG_TYPES[k], lbl = T.name + ' ' + Z;
      EVENT_ALARMS.push([T.pre + 'A-' + Z + ' LOW', lbl + ' detected (1oo2 above ' + T.lo + ' ' + T.unit + ')', 2, function (s) { return s.fgs.z[Z][k].low && !s.fgs.z[Z][k].high; }]);
      EVENT_ALARMS.push([T.pre + 'A-' + Z + ' HIGH', lbl + ' HIGH (1oo2 above ' + T.hi + ' ' + T.unit + ')', 1, function (s) { return s.fgs.z[Z][k].high; }]);
    });
    EVENT_ALARMS.push(['FGS CONF ' + Z, 'F&G CONFIRMED in zone ' + Z + ' (2oo2): ESD-1 demand', 1, function (s) { return FG_KEYS.some(function (k) { return s.fgs.z[Z][k].conf; }); }]);
    EVENT_ALARMS.push(['DET FAULT ' + Z, 'Detector fault in zone ' + Z, 2, function (s) { return FG_KEYS.some(function (k) { return s.fgs.z[Z][k].fault; }); }]);
    EVENT_ALARMS.push(['ZONE BLIND ' + Z, 'Zone ' + Z + ' blind: no healthy detector left for a gas type', 1, function (s) { return FG_KEYS.some(function (k) { return s.fgs.z[Z][k].blind; }); }]);
  });
  var VIBP = ['P-101A', 'P-101B', 'P-201A', 'P-201B', 'P-301A', 'P-301B', 'P-401A', 'P-401B'];
  var PUMPS = VIBP.concat(['P-501']);
  VIBP.forEach(function (p) {
    var n = p.slice(2);
    ALARM_DEFS.push(['VAH-' + n, p + ' vibration high', 'VT-' + n, '>', 7.0, 2, 0.3], ['VAHH-' + n, p + ' vibration high-high (trip)', 'VT-' + n, '>', 11.0, 1, 0.3]);
    EVENT_ALARMS.push(['SEAL ' + n, p + ' mechanical seal leaking', 2, function (s) { return s.pf[p].seal > 0.3 && s.pumps[p] === 'RUNNING'; }]);
  });
  ALARM_DEFS.push(['PAL-902', 'Fuel gas header pressure low', 'PT-902', '<', 3.0, 2, 0.2], ['PALL-902', 'Fuel gas header pressure low-low (burner trip)', 'PT-902', '<', 2.0, 1, 0.2],
    ['LAL-402', 'Flare seal drum level low', 'LT-402', '<', 40, 2, 3], ['LALL-402', 'Flare seal drum level low-low (flashback risk)', 'LT-402', '<', 15, 1, 3],
    ['FAL-402', 'Flare purge gas flow low', 'FT-402', '<', 60, 3, 10], ['AAH-501', 'Corrosion rate high (raise inhibitor)', 'AT-501', '>', 5, 3, 0.3],
    ['AAH-202', 'LACT BS&W high', 'AT-202', '>', 0.5, 1, 0.03]);

  // ------------------------------------------------------------------ control loops
  // id, desc, unit, lo, hi, sp, kp, ti(s), dir(+1 direct/-1 reverse), PV tag, output (valve/fan), fail position, pneumatic?
  var LOOP_DEFS = [
    ['LIC-001', 'V-001 oil level',          '%',    0, 100, 50,  1.5, 400,   1, 'LT-001', 'LCV-001', 0, 1],
    ['LIC-002', 'V-001 water interface',    '%',    0, 100, 25,  0.6, 1500,  1, 'LI-002', 'LCV-002', 0, 1],
    ['PIC-001', 'V-001 pressure (to FKOD)', 'barg', 0, 20,  12,  4.0, 150,   1, 'PT-001', 'PCV-001', 0, 1],
    ['LIC-101', 'V-100 oil level',           '%',    0, 100, 50,  1.5, 400,   1, 'LT-101', 'LCV-101', 0, 1],
    ['LIC-102', 'V-100 water interface',     '%',    0, 100, 25,  3.0, 1800,  1, 'LI-102', 'LCV-102', 0, 1],
    ['PIC-101', 'V-100 pressure (to FKOD)',  'barg', 0, 12,  6,   4.0, 150,   1, 'PT-101', 'PCV-101', 0, 1],
    ['TIC-101', 'HO-1 hot oil temperature',  '°C',   0, 250, 190, 1.0, 150,  -1, 'TT-101', 'TCV-101', 0, 1],
    ['TIC-102', 'HT-200 temperature (E-103)', '°C',   0, 120, 85,  0.6, 600,  -1, 'TT-102', 'TCV-102', 0, 1],
    ['TIC-103', 'V-210 outlet temperature',  '°C',   0, 120, 78,  0.8, 240,  -1, 'TT-103', 'TCV-103', 0, 1],
    ['LIC-103', 'HT-200 level (pump disch.)', '%',    0, 100, 50,  1.5, 400,   1, 'LT-103', 'LCV-103', 0, 1],
    ['LIC-104', 'HT-200 water interface',     '%',    0, 100, 25,  3.0, 1600,  1, 'LI-104', 'LCV-104', 0, 1],
    ['PIC-102', 'HT-200 pressure (to FKOD)',  'barg', 0, 8,   2.5, 4.0, 150,   1, 'PT-102', 'PCV-102', 0, 1],
    ['TIC-104', 'C-101 reboiler temperature', '°C',  0, 200, 120, 0.5, 600,  -1, 'TT-104', 'TCV-104', 0, 1],
    ['LIC-105', 'C-101 sump level',          '%',    0, 100, 50,  0.6, 300,   1, 'LT-105', 'LCV-105', 0, 1],
    ['PIC-104', 'C-101 pressure (to FKOD)',  'barg', 0, 6,   1.2, 4.0, 150,   1, 'PT-104', 'PCV-104', 0, 1],
    ['TIC-105', 'E-105 outlet temperature (fan VFD)', '°C', 0, 100, 48, 1.5, 120, 1, 'TT-105', 'FAN-105', 0, 0],
    ['LIC-106', 'V-110 oil level',           '%',    0, 100, 50,  1.0, 400,   1, 'LT-106', 'LCV-106', 0, 1],
    ['LIC-107', 'V-110 water interface',     '%',    0, 100, 25,  4.0, 2500,  1, 'LI-107', 'LCV-107', 0, 1],
    ['PIC-103', 'V-110 pressure (to FKOD)',  'barg', 0, 4,   0.8, 4.0, 150,   1, 'PT-103', 'PCV-103', 0, 1],
    ['FIC-201', 'Export flow',               'm3/h', 0, 900, 450, 0.5, 40,   -1, 'FT-201', 'FCV-201', 0, 1],
    ['LIC-301', 'TK-420 water level',         '%',    0, 100, 40,  1.0, 800,  1, 'LT-301', 'FCV-301', 0, 1],
    ['LIC-401', 'FKOD V-401 level',          '%',    0, 100, 20,  0.8, 900,   1, 'LT-401', 'LCV-401', 0, 1]
  ];
  var VALVES = ['LCV-001', 'LCV-002', 'PCV-001', 'LCV-101', 'LCV-102', 'PCV-101', 'TCV-101', 'TCV-102', 'TCV-103',
                'LCV-103', 'LCV-104', 'PCV-102', 'TCV-104', 'LCV-105', 'PCV-104', 'FAN-105', 'LCV-106', 'LCV-107',
                'PCV-103', 'FCV-201', 'FCV-301', 'LCV-401'];
  VALVES.forEach(function (id) { EVENT_ALARMS.push(['VDEV ' + id, 'Valve ' + id + ' position deviation (stuck?)', 3, function (s) { return s.valves[id].devT > 30; }]); });
  var HAND = ['BV-HT', 'GV-1', 'GV-2', 'GV-3', 'GV-4', 'BV-CL', 'XV-N2', 'VENT-410', 'DR-001', 'DR-101', 'DR-102', 'DR-103', 'FP-401'];   // manual (hand) valves 0..100 %

  // ------------------------------------------------------------------ plant
  function createPlant(userCfg) {
    var C = merge(clone(DEFAULTS), userCfg || {});
    var U = userCfg || {};
    var D = DEFAULTS;
    function auto(sec, key, val) { if (!(U[sec] && U[sec][key] !== undefined)) C[sec][key] = val; }
    var scL = Math.max(C.wells.liquidRate / 600, 0.05);
    var scO = Math.max(C.wells.liquidRate * (1 - C.wells.waterCut) / 390, 0.05);
    var scW = Math.max(C.wells.liquidRate * C.wells.waterCut / 210, 0.05);
    var scG = Math.max(C.wells.liquidRate * (1 - C.wells.waterCut) * C.wells.gor / 23400, 0.05);
    var scV = Math.max(scL, 0.25);
    ['sc', 'v101', 'ht', 'col', 'v103', 'fkod'].forEach(function (k) { auto(k, 'cap', D[k].cap * scV); auto(k, 'gasVol', D[k].gasVol * scV); });
    auto('water', 'cap', D.water.cap * scW);
    auto('export', 'setFlow', Math.round(450 * scO));
    auto('export', 'pumpFlow', Math.round(Math.max(520 * scO, C.export.setFlow * 1.1)));
    auto('ho', 'maxKW', Math.round(D.ho.maxKW * scO)); auto('ht', 'burnerMaxKW', Math.round(D.ht.burnerMaxKW * scO));
    // operating point shifts with water cut: hotter treater and more demulsifier
    var wcx = Math.max(0, C.wells.waterCut - 0.35);
    auto('ht', 'T', Math.round(Math.min(95, 85 + 30 * wcx)));
    if (!(U.dem !== undefined)) C.dem = Math.round(Math.max(10, Math.min(50, 25 + 60 * wcx)));
    var P = { cfg: C, s: null, loops: {}, alarms: {}, log: [], kpi: null, scenario: null, events: [], tagTable: {} };
    var s;
    var TAMB = C.ambient;
    var SPEC = { hxG2: 68 * scO, hxGreb: 183 * scO, hoC: 144000 * scO, hoLoss: 15 * scO };

    function logEvt(type, text) { P.log.unshift({ t: s ? s.t : 0, type: type, text: text }); if (P.log.length > 300) P.log.pop(); }
    function freshKpi() {
      return { flaredSm3: 0, ventSec: 0, flareLiqSec: 0, offspecM3: 0, exportedM3: 0, psdCount: 0, esdCount: 0, psvLifts: 0,
               alarmSecP1: 0, tankContamSec: 0, maxPsc: 0, maxLsc: 0, minLsc: 100, maxL101: 0, maxPfk: 0, maxLfk: 0, maxTankL: 0, maxPv101: 0, tripCount: 0, maxWater: 0, lactDivertSec: 0, shelved: 0, floodSec: 0, ovrCount: 0, ovrNoPtw: 0 };
    }

    function freshFgs() {
      var g = { key: false, resp: {}, ovr: {}, z: {}, det: {}, src: {}, fire: {}, auto: {}, c: {}, firstHigh: null };
      FG_ZONES.forEach(function (zz) {
        var Z = zz[0]; g.z[Z] = {}; g.c[Z] = { gas: 0, h2s: 0, fire: 0 };
        FG_KEYS.forEach(function (k) {
          g.z[Z][k] = { low: false, high: false, conf: false, fault: false, blind: false, vote: '2oo2' };
          ['A', 'B'].forEach(function (p) { var id = FG_TYPES[k].pre + '-' + Z + '-' + p; g.det[id] = { id: id, type: k, zone: Z, pos: p, k: p === 'A' ? 1 : (k === 'fire' ? 0.9 : 0.8), val: 0, fault: null, ft: 0 }; });
        });
      });
      return g;
    }
    // ---- initial state
    function initState(mode) {
      var cold = mode === 'cold';
      var Cc = C;
      s = P.s = {
        t: 0, power: { on: true }, ia: { P: 7.2, A: 'RUNNING', B: 'STOPPED', leak: false },
        well: { liquidRate: Cc.wells.liquidRate, wc: Cc.wells.waterCut, gor: Cc.wells.gor, Tw: Cc.wells.wellheadTemp, slug: 0, Pw: Cc.wells.wellheadP },
        wells: { 'W-1': { open: true, share: 0.40, choke: 100, off: -0.07 }, 'W-2': { open: true, share: 0.35, choke: 100, off: 0 }, 'W-3': { open: true, share: 0.25, choke: 100, off: 0.112 } },
        test: { well: null },
        esdv: { pos: cold ? 0 : 100, cmd: cold ? 0 : 1 },
        esd: { level: cold ? 2 : 0, causes: [], reset: !cold },
        hazard: { lpOut: false },
        fgs: freshFgs(), ceByp: {}, horn: false,
        bdv: false,
        sc:   { vo: (cold ? 0.08 : 0.25) * Cc.sc.cap, vw: (cold ? 0.03 : 0.25) * Cc.sc.cap, P: cold ? 0.4 : Cc.sc.P, T: cold ? TAMB + 3 : Cc.wells.wellheadTemp - 1, b: cold ? 0.05 : 0.04, psv: false },
        hx1:  { Tc: cold ? TAMB + 3 : 69, Th: cold ? TAMB + 3 : 99 },
        v101: { vo: (cold ? 0.1 : 0.375) * Cc.v101.cap, vw: (cold ? 0.03 : 0.25) * Cc.v101.cap, P: cold ? 0.3 : Cc.v101.P, T: cold ? TAMB + 3 : 69, b: cold ? 0.04 : 0.028, psv: false },
        hx2:  { T: cold ? TAMB + 3 : 78 },
        ht:   { vo: (cold ? 0.15 : 0.40) * Cc.ht.cap, vw: (cold ? 0.03 : 0.10) * Cc.ht.cap, P: cold ? 0.3 : Cc.ht.P, T: cold ? TAMB + 3 : Cc.ht.T,
                b: cold ? 0.03 : 0.004, burner: cold ? 'OFF' : 'ON', purge: 0, psv: false },
        col:  { h2s: cold ? 30 : 8, v: (cold ? 0.15 : 0.5) * Cc.col.cap, P: cold ? 0.3 : Cc.col.P, Treb: cold ? TAMB + 3 : Cc.col.Treb, rvp: cold ? 15 : 8.6 },
        ho:   { T: cold ? TAMB + 3 : Cc.ho.T, burner: cold ? 'OFF' : 'ON', purge: 0 },
        cool: { T: cold ? TAMB + 3 : 48.5, Tin: cold ? TAMB + 3 : 120 },
        v103: { vo: (cold ? 0.15 : 0.40) * Cc.v103.cap, vw: (cold ? 0.03 : 0.12) * Cc.v103.cap, P: cold ? 0.3 : Cc.v103.P, T: cold ? TAMB + 3 : 48.5, b: cold ? 0.03 : 0.0017 },
        tank: { v: (cold ? 20 : Cc.tank.level) / 100 * Cc.tank.cap, bsw: 0.12, P: 3, lift: false, vac: false },
        n2: { pkg: 'RUNNING', P: 7.5, flow: 0, cd: 0 },
        lpf: { P: 0.008, pilot: 'ON', flow: 0 },
        slop: { v: Cc.slop.level / 100 * Cc.slop.cap },
        water: { v: Cc.water.level / 100 * Cc.water.cap, ppm: 22, ppmIn: 147 },
        fk:   { v: 0.20 * Cc.fkod.cap, P: cold ? 0.05 : Cc.fkod.P, surge: 0, psv: false },
        flare: { flow: 0, total: 0, pilot: 'ON', venting: false },
        pumps: { 'P-101A': cold ? 'STOPPED' : 'RUNNING', 'P-101B': 'STOPPED', 'P-201A': cold ? 'STOPPED' : 'RUNNING', 'P-201B': 'STOPPED',
                 'P-301A': cold ? 'STOPPED' : 'RUNNING', 'P-301B': 'STOPPED', 'P-401A': 'RUNNING', 'P-401B': 'STOPPED', 'P-501': 'STOPPED' },
        auto: { 'P-101': true, 'P-201': true, 'P-301': true, 'P-401': true },
        hv: { 'BV-HT': 0, 'GV-1': 100, 'GV-2': 100, 'GV-3': 0, 'GV-4': 0, 'BV-CL': 0, 'XV-N2': 50, 'VENT-410': 100, 'DR-001': 0, 'DR-101': 0, 'DR-102': 0, 'DR-103': 0, 'FP-401': 30 },
        dem: Cc.dem, pipe: { avail: 1 },
        route: 'AUTO', routeNow: 'TANK', exp: { q: 0 }, inl: { q: 0 },
        suppressLowUntil: 0, flows: {}, valves: {}, lock: {},
        weather: { amp: C.weather.amp }, amb: TAMB,
        gen: { 'G-1': 'RUNNING', 'G-2': 'RUNNING', cd: { 'G-1': 0, 'G-2': 0 } },
        fg: { P: cold ? 0.3 : 4.0 }, seal: { lvl: 70 },
        chem: { ci: Cc.chem.ci, af: Cc.chem.af, cr: 2.2 },
        lact: { mf: 1, mfTrue: 1.0, bsw: 0.12, divert: false, divT: 0, prove: 0, samp: 12, dev: 0, lastProve: 0 },
        wt: { eff: 0.85, skim: 0, back: 0 },
        flt: { foam: 0, emul: 0, hx2foul: 0, foamEff: 0 },
        inst: {}, pf: {}, ptw: {}, ptwSeq: 0, field: { tasks: [], done: {}, seq: 0 }, notes: [], shelf: {}, first: null, floodT: [], proc: { id: null }
      };
      s.power.demand = 0; s.power.cap = 3000; s.power.shed = false; s.power.ovT = 0; s.power.blk = false; s.power.uf = false;
      PUMPS.forEach(function (p) { s.pf[p] = { seal: 0, sealRate: 0, bear: 0, fail: false, vib: 0 }; });
      VALVES.forEach(function (id) { s.valves[id] = { pos: 0, tgt: 0, stuck: false, iso: false, devT: 0 }; });
      if (!cold) {
        var init = { 'LCV-001': 49, 'LCV-002': 47, 'PCV-001': 45, 'LCV-101': 50, 'LCV-102': 12, 'PCV-101': 45, 'TCV-101': 70, 'TCV-102': 36,
                     'TCV-103': 40, 'LCV-103': 50, 'LCV-104': 24, 'PCV-102': 45, 'TCV-104': 50, 'LCV-105': 50, 'PCV-104': 45, 'FAN-105': 65,
                     'LCV-106': 50, 'LCV-107': 10, 'PCV-103': 45, 'FCV-201': 50, 'FCV-301': 52, 'LCV-401': 10 };
        for (var v in init) { s.valves[v].pos = s.valves[v].tgt = init[v]; }
      }
      P.loops = {};
      LOOP_DEFS.forEach(function (d) {
        P.loops[d[0]] = { id: d[0], desc: d[1], unit: d[2], lo: d[3], hi: d[4], sp: d[5], kp: d[6], ti: d[7], dir: d[8], tag: d[9], out: d[10], fail: d[11], pneu: d[12], mode: 'AUTO', op: 0, e1: 0 };
        if (s.valves[d[10]]) P.loops[d[0]].op = s.valves[d[10]].pos;
      });
      var Lp = P.loops;
      Lp['PIC-001'].sp = Cc.sc.P; Lp['PIC-101'].sp = Cc.v101.P; Lp['PIC-102'].sp = Cc.ht.P; Lp['TIC-102'].sp = Cc.ht.T;
      Lp['PIC-104'].sp = Cc.col.P; Lp['TIC-104'].sp = Cc.col.Treb; Lp['PIC-103'].sp = Cc.v103.P; Lp['TIC-101'].sp = Cc.ho.T;
      Lp['FIC-201'].sp = Cc.export.setFlow; Lp['LIC-301'].sp = Cc.water.level;
      P.alarms = {}; P.kpi = freshKpi(); P.events = []; P.scenario = null;
      computeTags();
    }

    // ---- instrument values (PVs)
    function computeTags() {
      var T = P.tagTable;
      function set(tag, desc, unit, val, lo, hi) { T[tag] = { tag: tag, desc: desc, unit: unit, v: val, tv: val, lo: lo, hi: hi }; }
      var cs = C;
      set('FT-001', 'Production inlet flow', 'm3/h', s.inl.q, 0, 900);
      set('PT-000', 'Wellhead pressure', 'barg', s.well.Pw * s.esdv.pos / 100 + (1 - s.esdv.pos / 100) * s.sc.P, 0, 60);
      set('TT-000', 'Wellhead temperature', '°C', s.well.Tw, 0, 100);
      set('LT-001', 'V-001 level', '%', (s.sc.vo + s.sc.vw) / cs.sc.cap * 100, 0, 100);
      set('LI-002', 'V-001 interface', '%', s.sc.vw / cs.sc.cap * 100, 0, 100);
      set('PT-001', 'V-001 pressure', 'barg', s.sc.P, 0, 20);
      set('TT-001', 'V-001 temperature', '°C', s.sc.T, 0, 150);
      set('TT-106', 'HX-1 oil outlet (V-100 inlet)', '°C', s.hx1.Tc, 0, 150);
      set('TT-107', 'HX-1 hot oil return', '°C', s.hx1.Th, 0, 200);
      set('LT-101', 'V-100 level', '%', (s.v101.vo + s.v101.vw) / cs.v101.cap * 100, 0, 100);
      set('LI-102', 'V-100 interface', '%', s.v101.vw / cs.v101.cap * 100, 0, 100);
      set('PT-101', 'V-100 pressure', 'barg', s.v101.P, 0, 12);
      set('TT-103', 'V-210 outlet temperature', '°C', s.hx2.T, 0, 150);
      set('TT-101', 'HO-1 hot oil temperature', '°C', s.ho.T, 0, 250);
      set('TT-102', 'HT-200 temperature', '°C', s.ht.T, 0, 150);
      set('LT-103', 'HT-200 level', '%', (s.ht.vo + s.ht.vw) / cs.ht.cap * 100, 0, 100);
      set('LI-104', 'HT-200 interface', '%', s.ht.vw / cs.ht.cap * 100, 0, 100);
      set('PT-102', 'HT-200 pressure', 'barg', s.ht.P, 0, 8);
      set('AT-103', 'HT-200 outlet BS&W', '%', s.ht.b * 100, 0, 5);
      set('LT-105', 'C-101 sump level', '%', s.col.v / cs.col.cap * 100, 0, 100);
      set('PT-104', 'C-101 pressure', 'barg', s.col.P, 0, 6);
      set('TT-104', 'C-101 reboiler temperature', '°C', s.col.Treb, 0, 200);
      set('TT-105', 'E-105 outlet temperature', '°C', s.cool.T, 0, 100);
      set('LT-106', 'V-110 level', '%', (s.v103.vo + s.v103.vw) / cs.v103.cap * 100, 0, 100);
      set('LI-107', 'V-110 interface', '%', s.v103.vw / cs.v103.cap * 100, 0, 100);
      set('PT-103', 'V-110 pressure', 'barg', s.v103.P, 0, 4);
      set('AT-101', 'Crude BS&W (V-110 outlet)', '%', s.v103.b * 100, 0, 2);
      set('AT-102', 'Crude RVP', 'psi', s.col.rvp, 0, 20);
      Object.keys(s.fgs.det).forEach(function (id) { var d = s.fgs.det[id], T0 = FG_TYPES[d.type]; set(id, d.zone + ' ' + T0.name + ' detector ' + d.pos + (s.fgs.ovr[id] ? ' (OVERRIDDEN)' : ''), T0.unit, d.val, 0, T0.max); });
      set('AT-103', 'C-101 outlet H2S in crude (stripped)', 'ppm', s.col.h2s, 0, 60);
      set('TT-110', 'V-110 inlet temperature (after cooler / bypass mix)', '°C', s.v103.T, 0, 150);
      set('FT-N2', 'N2 flow to C-101 stripping column', 'Sm3/h', s.n2.flow, 0, 200);
      set('PT-N2', 'N2 package header pressure', 'barg', s.n2.P, 0, 12);
      set('PT-410', 'TK-410 vapour space pressure', 'mbarg', s.tank.P, -10, 60);
      set('PT-405', 'LP flare header pressure', 'barg', s.lpf.P, -0.01, 0.1);
      set('FT-405', 'TK-410 cold vent flow to LP flare', 'm3/h', s.lpf.flow, 0, 600);
      set('PT-401', 'FKOD / flare header pressure', 'barg', s.fk.P, -0.2, 3);
      set('LT-401', 'FKOD V-401 level', '%', s.fk.v / cs.fkod.cap * 100, 0, 100);
      set('FT-401', 'Flare gas flow', 'Sm3/h', s.flare.flow, 0, 80000);
      set('LT-201', 'TK-410 shipping tank level', '%', s.tank.v / cs.tank.cap * 100, 0, 100);
      set('AT-201', 'TK-410 BS&W', '%', s.tank.bsw, 0, 2);
      set('LT-202', 'TK-430 slop tank level', '%', s.slop.v / cs.slop.cap * 100, 0, 100);
      set('FT-201', 'Export flow', 'm3/h', s.exp.q, 0, 900);
      set('LT-301', 'TK-420 water tank level', '%', s.water.v / cs.water.cap * 100, 0, 100);
      set('FT-301', 'Water disposal flow', 'm3/h', s.flows.disp || 0, 0, 500);
      set('AT-301', 'Oil in water', 'ppm', s.water.ppm, 0, 200);
      set('PT-901', 'Instrument air pressure', 'barg', s.ia.P, 0, 9);
      set('TT-900', 'Ambient temperature', '°C', s.amb, 0, 60);
      set('PT-902', 'Fuel gas header pressure', 'barg', s.fg.P, 0, 8);
      set('FT-402', 'Flare purge gas flow', 'Sm3/h', s.flare.purge || 0, 0, 500);
      set('LT-402', 'Flare seal drum level', '%', s.seal.lvl, 0, 100);
      set('FT-202', 'LACT gross meter flow', 'm3/h', s.exp.q * s.lact.mfTrue, 0, 900);
      set('AT-202', 'LACT BS&W monitor', '%', s.lact.bsw, 0, 2);
      set('QT-202', 'LACT sampler pot level', '%', s.lact.samp, 0, 100);
      set('AT-501', 'Corrosion rate', 'mpy', s.chem.cr, 0, 20);
      set('AT-300', 'Hydrocyclone inlet oil in water', 'ppm', s.water.ppmIn || 0, 0, 1500);
      set('JT-901', 'Electrical load', 'kW', s.power.demand, 0, 8000);
      set('JI-901', 'Generation capacity', 'kW', s.power.cap, 0, 8000);
      VIBP.forEach(function (p) { set('VT-' + p.slice(2), p + ' vibration', 'mm/s', s.pf[p].vib, 0, 20); });
      var tw = s.test.well && s.wells[s.test.well];
      set('FT-T1', 'Well test separator flow', 'm3/h', tw && tw.open ? s.well.liquidRate * (1 + s.well.slug) * tw.share * tw.choke / 100 * s.esdv.pos / 100 : 0, 0, 500);
      set('AT-T1', 'Well test water cut', '%', tw && tw.open ? clamp(s.well.wc + tw.off, 0, 0.95) * 100 : 0, 0, 100);
      T['LT-101'].v += (s.flt.foamEff || 0) * 25;
      for (var it in s.inst) {
        var f = s.inst[it], q = T[it]; if (!q) continue;
        if (f.mode === 'FROZEN') { if (f.val === undefined) f.val = q.v; q.v = f.val; }
        else if (f.mode === 'DRIFT') q.v = clamp(q.v + f.off, q.lo, q.hi);
        else if (f.mode === 'BIAS') q.v = clamp(q.v + f.bias, q.lo, q.hi);
        else if (f.mode === 'HIGH') q.v = q.hi; else if (f.mode === 'LOW') q.v = q.lo;
      }
    }
    function pv(tag) { return P.tagTable[tag].v; }

    // ---- PID (velocity form: bumpless, natural anti-windup)
    function runLoops(dt) {
      var airOK = s.ia.P > 3.5;
      for (var id in P.loops) {
        var L = P.loops[id], span = L.hi - L.lo, meas = pv(L.tag);
        if (L.mode === 'AUTO') {
          var e = L.dir * (meas - L.sp) / span * 100;
          L.op = clamp(L.op + L.kp * ((e - L.e1) + dt / L.ti * e), 0, 100);
          L.e1 = e;
        } else L.e1 = L.dir * (meas - L.sp) / span * 100;
        if (s.valves[L.out]) s.valves[L.out].tgt = (airOK || !L.pneu) ? L.op : L.fail;
      }
      // low-level lock-outs on liquid legs (prevent gas blow-by)
      [['LT-001', 'LCV-001'], ['LT-101', 'LCV-101'], ['LT-103', 'LCV-103'], ['LT-105', 'LCV-105'], ['LT-106', 'LCV-106']].forEach(function (p) {
        var lv = pv(p[0]);
        if (lv < 6) s.lock[p[1]] = true; else if (lv > 15) s.lock[p[1]] = false;
        if (s.lock[p[1]]) s.valves[p[1]].tgt = 0;
      });
      if (s.power.shed && s.valves['FAN-105'].tgt > 50) s.valves['FAN-105'].tgt = 50;
      if (!s.power.on) s.valves['FAN-105'].tgt = 0;
      VALVES.forEach(function (v) {
        var V = s.valves[v], step = 10 * dt, d = V.tgt - V.pos;
        if (!V.stuck && !V.iso) V.pos += clamp(d, -step, step);
        if (Math.abs(V.tgt - V.pos) > 15) V.devT += dt; else V.devT = 0;
      });
      var tg = (s.esdv.cmd && s.esd.level === 0) ? 100 : 0, st = 5 * dt;
      s.esdv.pos += clamp(tg - s.esdv.pos, -st, st);
    }

    // ---- helper: three-phase vessel liquid balance. returns {qw, ow}
    function vessel(v, cap, oilIn, watIn, qo, bo, qwReq, h) {
      var avail = v.vw / h * 0.9, ow = 0, qw = qwReq;
      if (qw > avail) { ow = qw - avail; qw = avail; }
      v.vo += (oilIn - qo * (1 - bo) - ow) * h;
      v.vw += (watIn - qo * bo - qw) * h;
      v.vo = clamp(v.vo, 0, cap); v.vw = clamp(v.vw, 0, cap);
      if (v.vo + v.vw > cap) v.vo = cap - v.vw;
      return { qw: qw, ow: ow };
    }
    function gasBal(v, Vg, inflow, outflow, dLiq, h, hi) {
      var Pa = v.P + ATM;
      Pa += ((inflow - outflow) * h * ATM) / Vg + Pa * (dLiq / Vg);
      v.P = clamp(Pa - ATM, -0.2, hi);
    }
    function drainFrom(v, id, h, cap) {     // hand drain valve; takes water first, then oil. returns m3/h
      var pos = s.hv[id];
      if (!pos) return 0;
      var q = 70 * scV * pos / 100;
      var take = Math.min(q * h, v.vw + v.vo);
      var fromW = Math.min(take, v.vw); v.vw -= fromW; v.vo -= (take - fromW);
      return take / h;
    }

    // ---- electrical power: generators G-1..3, load shedding, blackout
    function powerSystem(dt) {
      var scP = Math.max(scL, 0.3), gens = 0, g, nRun = 0;
      ['G-1', 'G-2'].forEach(function (g) {
        if (s.gen[g] === 'STARTING') { s.gen.cd[g] -= dt; if (s.gen.cd[g] <= 0) { s.gen[g] = 'RUNNING'; logEvt('OP', g + ' running, on the bus'); } }
        if (s.gen[g] === 'RUNNING') gens++;
      });
      PUMPS.forEach(function (p) { if (s.pumps[p] === 'RUNNING') nRun++; });
      var fanP = s.valves['FAN-105'].pos / 100, ia = (s.ia.A === 'RUNNING' ? 1 : 0) + (s.ia.B === 'RUNNING' ? 1 : 0);
      var demand = (400 + 250 * nRun + 300 * fanP + 150 * ia) * scP, cap = C.gen.cap * scP * gens;
      s.power.demand = s.power.on ? demand : 0; s.power.cap = cap;
      if (!s.power.blk && gens > 0 && !s.power.uf) {
        if (demand > cap) {
          s.power.ovT += dt;
          if (!s.power.shed && s.power.ovT >= 3) {
            s.power.shed = true; logEvt('ALM', 'Load shedding: disposal and slop pumps tripped, fan limited to 50 %');
            ['P-301A', 'P-301B', 'P-501'].forEach(function (p) { if (s.pumps[p] === 'RUNNING') s.pumps[p] = 'TRIPPED'; });
          }
          if (s.power.ovT >= 25) { s.power.uf = true; logEvt('ESD', 'Under-frequency: total blackout'); }
        } else s.power.ovT = 0;
      }
      s.power.on = !s.power.blk && gens > 0 && !s.power.uf;
    }

    // ---- permit to work / isolations
    function permit(id, issue) {
      if (!issue) {
        var w = s.ptw[id]; if (!w) return { ok: false, msg: 'No permit on ' + id };
        if (w.ready) { repair(id); logEvt('PTW', w.no + ' closed on ' + id + ': work complete, equipment returned'); }
        else logEvt('PTW', w.no + ' cancelled on ' + id + ': work not done');
        if (s.valves[id]) s.valves[id].iso = false;
        delete s.ptw[id]; return { ok: true, msg: '' };
      }
      if (s.ptw[id]) return { ok: false, msg: 'Permit already issued' };
      var kind = null;
      if (TRIPS[id]) { if (s.pumps[id] === 'RUNNING') return { ok: false, msg: 'Stop ' + id + ' before isolating' }; kind = 'pump'; }
      else if (id === 'HO-1') { if (s.ho.burner !== 'OFF' && s.ho.burner !== 'TRIPPED') return { ok: false, msg: 'Burner must be off' }; kind = 'burner'; }
      else if (id === 'E-103') { if (s.ht.burner !== 'OFF' && s.ht.burner !== 'TRIPPED') return { ok: false, msg: 'Burner must be off' }; kind = 'burner'; }
      else if (/^G-/.test(id) && s.gen[id] !== undefined) { if (s.gen[id] === 'RUNNING' || s.gen[id] === 'STARTING') return { ok: false, msg: 'Stop ' + id + ' first' }; kind = 'gen'; }
      else if (s.valves[id]) { kind = 'valve'; s.valves[id].iso = true; }
      else if (P.tagTable[id]) kind = 'inst';
      else return { ok: false, msg: 'Cannot isolate ' + id };
      s.ptwSeq++; s.ptw[id] = { no: 'PTW-' + (100 + s.ptwSeq), t0: s.t, ready: false, kind: kind };
      logEvt('PTW', 'Permit ' + s.ptw[id].no + ' issued: ' + id + ' isolated and locked off (LOTO)');
      return { ok: true, msg: '' };
    }
    function repair(id) {
      if (s.pf[id]) s.pf[id] = { seal: 0, sealRate: 0, bear: 0, fail: false, vib: 0 };
      if (s.valves[id]) { s.valves[id].stuck = false; s.valves[id].devT = 0; }
      delete s.inst[id];
      if (s.pumps[id] === 'TRIPPED') s.pumps[id] = 'STOPPED';
      if (id === 'HO-1' && s.ho.burner === 'TRIPPED') s.ho.burner = 'OFF';
      if (id === 'E-103' && s.ht.burner === 'TRIPPED') s.ht.burner = 'OFF';
      if (s.gen[id] === 'TRIPPED') s.gen[id] = 'STOPPED';
    }

    // ---- field operator
    function fieldList() {
      var L = [], k, tg;
      Object.keys(P.tagTable).forEach(function (k) {
        var q = P.tagTable[k];
        if (/^LT-/.test(k)) L.push({ id: 'LG-' + k, area: 'Level', label: 'Level gauge glass at ' + q.desc });
        else if (/^PT-/.test(k)) L.push({ id: 'PG-' + k, area: 'Pressure', label: 'Local pressure gauge: ' + q.desc });
        else if (/^TT-/.test(k)) L.push({ id: 'TG-' + k, area: 'Temperature', label: 'Local thermometer: ' + q.desc });
      });
      PUMPS.forEach(function (p) { L.push({ id: 'WD-' + p, area: 'Rotating', label: 'Walk-down of ' + p + ' (seal, bearing, noise)' }); });
      ['G-1', 'G-2'].forEach(function (g) { L.push({ id: 'WD-' + g, area: 'Rotating', label: 'Walk-down of generator ' + g }); });
      VALVES.forEach(function (v) { L.push({ id: 'SP-' + v, area: 'Valves', label: 'Check stem position of ' + v }); });
      FG_ZONES.forEach(function (zz) { L.push({ id: 'FG-' + zz[0], area: 'Fire & gas', label: 'Portable gas / H2S monitor and visual check in zone ' + zz[0] + ' (' + zz[1] + ')' }); });
      L.push({ id: 'WD-N2-PKG', area: 'Rotating', label: 'Walk-down of N2 package' });
      L.push({ id: 'TK410-VENT', area: 'Tanks', label: 'TK-410 PVRV, flame arrestor and cold vent line to LP flare' });
      L.push({ id: 'LPF-PILOT', area: 'Flare', label: 'Visual check of LP flare pilot flame' });
      HAND.forEach(function (hv) { L.push({ id: 'HV-' + hv, area: 'Hand valves', label: 'Check stem position of hand valve ' + hv }); });
      L.push({ id: 'FLARE-PILOT', area: 'Flare', label: 'Visual check of flare pilot flame' });
      L.push({ id: 'SEAL-DRUM', area: 'Flare', label: 'Flare seal drum water level gauge' });
      L.push({ id: 'SG-HO1', area: 'Heaters', label: 'Burner sight glass HO-1' });
      L.push({ id: 'SG-E103', area: 'Heaters', label: 'Burner sight glass E-103' });
      L.push({ id: 'LAB-CRUDE', area: 'Lab', label: 'Take a crude grab sample (BS&W, salt)' });
      L.push({ id: 'LAB-WATER', area: 'Lab', label: 'Take a water sample (oil in water)' });
      L.push({ id: 'LACT-POT', area: 'LACT', label: 'Check LACT sampler pot level' });
      L.push({ id: 'CHEM-TANKS', area: 'Chemicals', label: 'Check chemical day-tank levels' });
      return L;
    }
    P.fieldChecks = function () { return fieldList().map(function (f) { var d = s.field.done[f.id]; return { id: f.id, area: f.area, label: f.label, done: d !== undefined, at: d }; }); };
    function fieldOrder(id) {
      if (s.field.cur) return { ok: false, msg: 'Field operator is busy with ' + s.field.cur.id };
      if (!fieldList().some(function (f) { return f.id === id; })) return { ok: false, msg: 'Unknown task' };
      s.field.cur = { id: id, t0: s.t, dur: 40 };
      logEvt('FIELD', 'Field operator sent to: ' + id);
      return { ok: true, msg: '' };
    }
    function fmt(x, d) { return (+x).toFixed(d === undefined ? 1 : d); }
    function fieldResult(id) {
      var m = id.match(/^(LG|PG|TG)-(.+)$/), q;
      if (m) { q = P.tagTable[m[2]]; var tr = q.tv; return 'Local gauge ' + m[2] + ' reads ' + fmt(tr, Math.abs(tr) < 10 ? 2 : 1) + ' ' + q.unit + '. DCS shows ' + fmt(q.v, Math.abs(q.v) < 10 ? 2 : 1) + ' ' + q.unit + (Math.abs(tr - q.v) > 0.04 * (q.hi - q.lo) ? '  <-- MISMATCH, suspect the transmitter' : ' (agrees)'); }
      m = id.match(/^WD-(.+)$/);
      if (m) {
        var n = m[1];
        if (/^G-/.test(n)) return n + ': ' + s.gen[n] + (s.gen[n] === 'TRIPPED' ? ', trip flag on local panel' : ', no leaks, normal noise');
        var f = s.pf[n], st = s.pumps[n], out = n + ' is ' + st + '. ';
        if (f.fail) out += 'Motor will not turn, breaker tripped. ';
        if (f.seal > 0.3) out += 'Mechanical seal leaking (' + Math.round(f.seal * 100) + ' % of limit), product on baseplate. ';
        if (f.bear > 0.2) out += 'Bearing housing hot and noisy. ';
        if (f.vib > 7) out += 'Vibration high at ' + fmt(f.vib) + ' mm/s. ';
        if (out.length < n.length + 20 + st.length) out += 'No leaks, normal sound and temperature.';
        return out;
      }
      m = id.match(/^FG-(Z\d)$/);
      if (m) {
        var zc = s.fgs.c[m[1]], zt = P.tagTable, ms = [];
        ms.push('Portable monitor zone ' + m[1] + ': combustible gas ' + fmt(zc.gas, 0) + ' %LEL, H2S ' + fmt(zc.h2s, 1) + ' ppm, ' + (zc.fire > 0.2 ? 'FLAMES / FIRE VISIBLE' : 'no flame visible') + '.');
        FG_KEYS.forEach(function (k) { ['A', 'B'].forEach(function (p) { var d = s.fgs.det[FG_TYPES[k].pre + '-' + m[1] + '-' + p], tv = zc[k] * (k === 'fire' ? 100 : 1) * d.k; if (Math.abs(d.val - tv) > 0.1 * FG_TYPES[k].max) ms.push(d.id + ' shows ' + fmt(d.val, 0) + ' ' + FG_TYPES[k].unit + ' but the real level is ' + fmt(tv, 0) + ': detector is SPURIOUS/FAULTY.'); }); });
        return ms.join(' ');
      }
      if (id === 'WD-N2-PKG') return 'N2 package: ' + s.n2.pkg + ', header ' + fmt(s.n2.P, 1) + ' barg' + (s.n2.pkg === 'TRIPPED' ? ', trip flag on local panel (power / compressor)' : ', normal');
      if (id === 'TK410-VENT') return 'TK-410 vent line: VENT-410 stem at ' + fmt(s.hv['VENT-410'], 0) + ' %, vapour pressure ' + fmt(s.tank.P, 1) + ' mbarg, PVRV ' + (s.tank.lift ? 'LIFTING, vapour smell at tank roof' : s.tank.vac ? 'vacuum side open, drawing air' : 'seated') + (s.hv['VENT-410'] < 50 ? '. Vent valve is closed or choked!' : '.');
      if (id === 'LPF-PILOT') return 'LP flare pilot is ' + (s.lpf.pilot === 'ON' ? 'burning steadily' : 'OUT, no flame visible');
      m = id.match(/^HV-(.+)$/);
      if (m) return m[1] + ' hand valve stem at ' + fmt(s.hv[m[1]], 0) + ' %';
      m = id.match(/^SP-(.+)$/);
      if (m) { var v = s.valves[m[1]]; return m[1] + ' stem at ' + fmt(v.pos, 0) + ' %, DCS demand ' + fmt(v.tgt, 0) + ' %' + (Math.abs(v.pos - v.tgt) > 8 ? '  <-- MISMATCH, valve is not following (stuck or no air)' : ' (agrees)'); }
      if (id === 'FLARE-PILOT') return 'Flare pilot is ' + (s.flare.pilot === 'ON' ? 'burning steadily' : 'OUT, no flame visible');
      if (id === 'SEAL-DRUM') return 'Seal drum water level ' + fmt(s.seal.lvl, 0) + ' % (normal 60 to 80 %)';
      if (id === 'SG-HO1') return 'HO-1 burner: ' + s.ho.burner + (s.ho.burner === 'ON' ? ', stable blue flame' : ', no flame');
      if (id === 'SG-E103') return 'E-103 burner: ' + s.ht.burner + (s.ht.burner === 'ON' ? ', stable blue flame' : ', no flame');
      if (id === 'LAB-CRUDE') return 'Lab result crude: BS&W ' + fmt(s.tank.bsw, 2) + ' % in TK-410, ' + fmt(P.tagTable['AT-101'].tv, 2) + ' % at HT-200 outlet';
      if (id === 'LAB-WATER') return 'Lab result water: oil in water ' + fmt(P.tagTable['AT-301'].tv, 0) + ' ppm at TK-420';
      if (id === 'LACT-POT') return 'Sampler pot ' + fmt(s.lact.samp, 0) + ' % full';
      if (id === 'CHEM-TANKS') return 'Chemical tanks OK. Demulsifier ' + s.dem + ' ppm, corrosion inhibitor ' + s.chem.ci + ' ppm, antifoam ' + s.chem.af + ' ppm';
      return 'Checked';
    }

    // ---- procedures
    var PROCS = {
      startup: { title: 'Plant start-up after shutdown', steps: [
        ['Reset ESD/PSD', function (s) { return s.esd.level === 0; }],
        ['Open inlet ESDV-001', function (s) { return s.esdv.pos > 99; }],
        ['Confirm fuel gas header above 2.5 barg (PT-902)', function (s) { return s.fg.P > 2.5; }],
        ['Light HO-1 (purge, then burner on)', function (s) { return s.ho.burner === 'ON'; }],
        ['Hot oil above 140 degC', function (s) { return s.ho.T > 140; }],
        ['Light E-103 on HT-200', function (s) { return s.ht.burner === 'ON'; }],
        ['Start a transfer pump P-101', function (s) { return s.pumps['P-101A'] === 'RUNNING' || s.pumps['P-101B'] === 'RUNNING'; }],
        ['Start an export pump P-201', function (s) { return s.pumps['P-201A'] === 'RUNNING' || s.pumps['P-201B'] === 'RUNNING'; }],
        ['Export above 300 m3/h', function (s) { return s.exp.q > 300; }]] },
      shutdown: { title: 'Planned shutdown', steps: [
        ['Shut in all wells', function (s) { return !s.wells['W-1'].open && !s.wells['W-2'].open && !s.wells['W-3'].open; }],
        ['Switch off E-103', function (s) { return s.ht.burner === 'OFF'; }],
        ['Switch off HO-1', function (s) { return s.ho.burner === 'OFF'; }],
        ['Stop transfer pumps P-101A/B', function (s) { return s.pumps['P-101A'] !== 'RUNNING' && s.pumps['P-101B'] !== 'RUNNING'; }],
        ['Close inlet ESDV-001', function (s) { return s.esdv.pos < 1; }],
        ['Stop export pumps P-201A/B', function (s) { return s.pumps['P-201A'] !== 'RUNNING' && s.pumps['P-201B'] !== 'RUNNING'; }]] },
      changeover: { title: 'Transfer pump changeover P-101A to P-101B', steps: [
        ['Start P-101B (both running)', function (s) { return s.pumps['P-101B'] === 'RUNNING'; }],
        ['Stop P-101A', function (s) { return s.pumps['P-101A'] === 'STOPPED'; }],
        ['HT-200 level between 30 and 80 % after the change', function (s) { var l = P.tagTable['LT-103'].tv; return l > 30 && l < 80; }]] },
      pumpiso: { title: 'Isolate P-101A for maintenance', steps: [
        ['Standby P-101B running', function (s) { return s.pumps['P-101B'] === 'RUNNING'; }],
        ['P-101A stopped', function (s) { return s.pumps['P-101A'] !== 'RUNNING'; }],
        ['Permit issued and P-101A locked off', function (s) { return !!s.ptw['P-101A']; }],
        ['Maintenance complete (permit ready, about 5 min)', function (s) { return !!s.ptw['P-101A'] && s.ptw['P-101A'].ready; }],
        ['Close the permit', function (s) { return !s.ptw['P-101A']; }]] },
      lightup: { title: 'HO-1 light-up', steps: [
        ['Check fuel gas above 2.5 barg', function (s) { return s.fg.P > 2.5; }],
        ['Start purge', function (s) { return s.ho.burner === 'PURGE' || s.ho.burner === 'ON'; }],
        ['Burner on after purge', function (s) { return s.ho.burner === 'ON'; }]] }
    };
    function startProc(id) {
      if (!PROCS[id]) return;
      s.proc = { id: id, t0: s.t, latched: PROCS[id].steps.map(function () { return false; }), done: false };
      logEvt('PROC', 'Procedure started: ' + PROCS[id].title);
    }
    P.procs = function () { return Object.keys(PROCS).map(function (k) { return { id: k, title: PROCS[k].title, n: PROCS[k].steps.length }; }); };
    P.procState = function () {
      var pr = s.proc; if (!pr || !pr.id) return null;
      return { id: pr.id, title: PROCS[pr.id].title, done: pr.done, t0: pr.t0, steps: PROCS[pr.id].steps.map(function (st, i) { return { text: st[0], done: pr.latched[i] }; }) };
    };

    // ---- per-step housekeeping: permits, field operator, procedures
    function housekeeping(dt) {
      var k, w;
      for (k in s.ptw) { w = s.ptw[k]; if (!w.ready && s.t - w.t0 >= 300) { w.ready = true; logEvt('PTW', w.no + ': work on ' + k + ' complete, permit ready to close'); } }
      var fc = s.field.cur;
      if (fc && s.t - fc.t0 >= fc.dur) { s.field.cur = null; s.field.done[fc.id] = s.t; logEvt('FIELD', fieldResult(fc.id)); }
      var pr = s.proc;
      if (pr && pr.id && !pr.done) {
        var steps = PROCS[pr.id].steps, i;
        for (i = 0; i < steps.length; i++) { if (pr.latched[i]) continue; if (steps[i][1](s)) pr.latched[i] = true; break; }
        if (pr.latched.every(function (x) { return x; })) { pr.done = true; logEvt('PROC', 'Procedure complete: ' + PROCS[pr.id].title + ' (' + Math.round(s.t - pr.t0) + ' s)'); }
      }
    }

    // ---- faults (scenarios and instructor)
    P.fault = function (type, id, o) {
      o = o || {};
      switch (type) {
        case 'inst': s.inst[id] = { mode: o.mode || 'DRIFT', rate: o.rate || 0, off: 0, bias: o.bias || 0 }; break;
        case 'valve': if (s.valves[id]) s.valves[id].stuck = true; break;
        case 'pump':
          if (!s.pf[id]) break;
          if (o.kind === 'bearing') s.pf[id].bear = o.v !== undefined ? o.v : 0.5;
          else if (o.kind === 'nostart') s.pf[id].fail = true;
          else s.pf[id].sealRate = o.rate || 1 / 600;
          break;
        case 'foam': s.flt.foam = o.v !== undefined ? o.v : 0.8; break;
        case 'emul': s.flt.emul = o.v !== undefined ? o.v : 0.6; break;
        case 'hx2': s.flt.hx2foul = o.v !== undefined ? o.v : 0.5; break;
        case 'leak': { var zk = o.kind || 'gas'; s.fgs.src[id + ':' + zk] = o.rate !== undefined ? o.rate : (zk === 'gas' ? 0.5 : 0.1); logEvt('FAULT', (zk === 'gas' ? 'Gas' : 'H2S') + ' release in ' + id); break; }
        case 'fire': s.fgs.fire[id] = true; logEvt('FAULT', 'Fire in ' + id); break;
        case 'detector': if (s.fgs.det[id]) { s.fgs.det[id].fault = o.kind || 'spike'; s.fgs.det[id].ft = 0; if (o.dur) s.fgs.det[id].until = s.t + o.dur; logEvt('FAULT', 'Detector ' + id + ' fault: ' + (o.kind || 'spike')); } break;
        case 'n2': s.n2.pkg = 'TRIPPED'; logEvt('ALM', 'N2 package tripped'); break;
        case 'lpout': s.hazard.lpOut = true; s.lpf.pilot = 'OUT'; break;
        case 'vent': s.hv['VENT-410'] = 0; break;
        case 'gen': if (s.gen[id] !== undefined) { s.gen[id] = 'TRIPPED'; logEvt('ALM', id + ' tripped'); } break;
        case 'lact': s.lact.mfTrue = o.v !== undefined ? o.v : 1.006; break;
        case 'hc': s.wt.eff = o.v !== undefined ? o.v : 0.4; break;
        case 'burner': if (id === 'HO-1') s.ho.burner = 'TRIPPED'; else s.ht.burner = 'TRIPPED'; break;
        case 'clear':
          s.fgs.src = {}; s.fgs.fire = {}; for (var dk in s.fgs.det) { s.fgs.det[dk].fault = null; s.fgs.det[dk].ft = 0; }
          s.hazard.lpOut = false;
          s.inst = {}; for (var v in s.valves) s.valves[v].stuck = false;
          for (var pp in s.pf) s.pf[pp] = { seal: 0, sealRate: 0, bear: 0, fail: false, vib: 0 };
          s.flt.foam = 0; s.flt.emul = 0; s.flt.hx2foul = 0; s.lact.mfTrue = 1.0; s.wt.eff = 0.85; break;
      }
    };

    // ---- shift log / handover
    P.shelvedList = function () { return Object.keys(s.shelf).map(function (k) { return { id: k, until: s.shelf[k] }; }); };
    P.handover = function () {
      var tg = P.tagTable, L = [], now = new Date();
      L.push('SHIFT HANDOVER - ' + C.facilityName + '  (sim time ' + Math.round(s.t / 60) + ' min)');
      L.push('Production: inlet ' + fmt(tg['FT-001'].v, 0) + ' m3/h, export ' + fmt(s.exp.q, 0) + ' m3/h, water cut ' + fmt(s.well.wc * 100, 0) + ' %');
      L.push('Tank TK-410 ' + fmt(tg['LT-201'].v, 0) + ' %, BS&W ' + fmt(s.tank.bsw, 2) + ' %. ESD level ' + s.esd.level);
      L.push('Power: ' + ['G-1', 'G-2'].map(function (g) { return g + ' ' + s.gen[g]; }).join(', ') + (s.power.shed ? ' (LOAD SHED ACTIVE)' : ''));
      var run = Object.keys(s.pumps).filter(function (k) { return s.pumps[k] === 'RUNNING'; }), trip = Object.keys(s.pumps).filter(function (k) { return s.pumps[k] === 'TRIPPED'; });
      L.push('Pumps running: ' + (run.join(', ') || 'none') + (trip.length ? '. Tripped: ' + trip.join(', ') : ''));
      var pk = Object.keys(s.ptw); L.push('Open permits: ' + (pk.length ? pk.map(function (k) { return s.ptw[k].no + ' on ' + k + (s.ptw[k].ready ? ' (ready to close)' : ''); }).join('; ') : 'none'));
      var sh = Object.keys(s.shelf); L.push('Shelved alarms: ' + (sh.length ? sh.join(', ') : 'none'));
      var ac = P.activeAlarms(); L.push('Active alarms: ' + ac.length + (ac.length ? ' (' + ac.slice(0, 5).map(function (a) { return a.id; }).join(', ') + ')' : ''));
      L.push('Notes:'); if (!s.notes.length) L.push('  - none'); s.notes.slice(0, 10).reverse().forEach(function (n) { L.push('  - [' + Math.round(n.t / 60) + ' min] ' + n.text); });
      return L.join('\n');
    };

    // ---- main step
    function step(dt) {
      var h = dt / 3600, R = C, W = s.well;
      s.t += dt;
      TAMB = C.ambient + s.weather.amp * Math.sin(2 * Math.PI * s.t / 86400); s.amb = TAMB;
      for (var ik in s.inst) { var fi = s.inst[ik]; if (fi.mode === 'DRIFT') fi.off += fi.rate * dt; }
      s.flt.foamEff = s.flt.foam * Math.max(0, 1 - s.chem.af / 15);
      powerSystem(dt); housekeeping(dt);
      computeTags();
      var iaSupply = s.power.on && (s.ia.A === 'RUNNING' || s.ia.B === 'RUNNING');
      if (iaSupply) s.ia.P = Math.min(7.2, s.ia.P + 0.05 * dt); else s.ia.P = Math.max(0, s.ia.P - 0.02 * dt);
      if (s.ia.leak) s.ia.P = Math.max(0, s.ia.P - 0.03 * dt);
      runLoops(dt);
      var Vv = function (id) { return s.valves[id].pos; };
      var GOR = W.gor, shareEff = 0, wcNum = 0;
      for (var wk in s.wells) { var wl = s.wells[wk]; if (wl.open) { var se = wl.share * wl.choke / 100; shareEff += se; wcNum += se * clamp(W.wc + wl.off, 0, 0.95); } }
      var wcNow = shareEff > 0 ? wcNum / shareEff : W.wc, share = shareEff;

      // ---------- wells, manifold, inlet
      var Qw = W.liquidRate * (1 + W.slug) * share * s.esdv.pos / 100;
      var slopRet = (s.pumps['P-501'] === 'RUNNING' && s.slop.v > 1) ? 30 * scO : 0;
      s.inl.q = Qw + slopRet;
      var oilIn = Qw * (1 - wcNow) + slopRet, watIn = Qw * wcNow;
      var gasTot = ((oilIn - slopRet) / (1 + W.slug) * (1 + 0.3 * W.slug) + slopRet) * GOR;   // slugs are liquid-rich
      s.sc.T += (W.Tw - 1 - s.sc.T) * Math.min(1, dt / 120);

      // ---------- slug catcher V-001
      var sc = s.sc, lvlSC = (sc.vo + sc.vw) / R.sc.cap, ifcSC = sc.vw / R.sc.cap;
      var qSC = vflow(Vv('LCV-001'), 820 * scL, sc.P - s.v101.P + 0.3 + 0.4 * lvlSC, 6.0);
      qSC = Math.min(qSC, (sc.vo + sc.vw) / h * 0.9);
      var qSCw = vflow(Vv('LCV-002'), 400 * scL, sc.P - 0.5 + 0.3, 11.8);
      var b0 = sc.b;
      var rSC = vessel(sc, R.sc.cap, oilIn, watIn, qSC, b0, qSCw, h);
      var dSC = drainFrom(sc, 'DR-001', h);
      var gasSCin = gasTot * 0.80;
      var psvSC = 0;
      if (sc.P > R.sc.psvSet) sc.psv = true; else if (sc.P < R.sc.psvSet - 1.2) sc.psv = false;
      if (sc.psv) { psvSC = 40000 * scG * Math.min(1, sc.P - R.sc.psvSet + 1.2); if (!sc.cnt) { sc.cnt = true; P.kpi.psvLifts++; logEvt('ALM', 'PSV-001 lifted at ' + sc.P.toFixed(1) + ' barg'); } } else sc.cnt = false;
      var bdSC = (s.bdv && sc.P > 0.05) ? 20000 * scG * Math.sqrt((sc.P + ATM) / 13) : 0;
      var blowSC = lvlSC < 0.05 ? 3500 * scG * (Vv('LCV-001') / 100) * (1 - lvlSC / 0.05) : 0;
      var gasOutSC = vflow(Vv('PCV-001'), 41600 * scG, sc.P - s.fk.P, 11.7);
      var carrySC = lvlSC > 0.90 ? 18 * scO * Math.min(1, (lvlSC - 0.90) * 10) : 0;
      gasBal(sc, R.sc.gasVol, gasSCin, gasOutSC + bdSC + psvSC + blowSC, (oilIn + watIn - qSC - qSCw - dSC) * h, h, 40);
      var wcFrac = clamp(wcNow, 0, 0.95);

      // ---------- heat exchanger HX-1: cold = SC oil, hot = stripped crude (computed below, uses last step's hot inlet)
      var Cc1 = capr(qSC, b0);
      // ---------- V-100
      var v1 = s.v101, lvl1 = (v1.vo + v1.vw) / R.v101.cap, ifc1 = v1.vw / R.v101.cap;
      var q101 = vflow(Vv('LCV-101'), 800 * scL, v1.P - s.ht.P + 0.3 + 0.4 * lvl1, 3.8);
      q101 = Math.min(q101, (v1.vo + v1.vw) / h * 0.9);
      var q102w = vflow(Vv('LCV-102'), 40 * scW, v1.P - 0.5 + 0.3, 5.8);
      var b1 = v1.b;
      var r1 = vessel(v1, R.v101.cap, qSC * (1 - b0), qSC * b0, q101, b1, q102w, h);
      var dV1 = drainFrom(v1, 'DR-101', h);
      var fuelFlow = 0;
      var gas101in = qSC * (1 - b0) * GOR * 0.12 + blowSC + carrySC * 0;
      var psv101 = 0;
      if (v1.P > R.v101.psvSet) v1.psv = true; else if (v1.P < R.v101.psvSet - 0.8) v1.psv = false;
      if (v1.psv) { psv101 = 14000 * scG * Math.min(1, v1.P - R.v101.psvSet + 0.8); if (!v1.cnt) { v1.cnt = true; P.kpi.psvLifts++; logEvt('ALM', 'PSV-101 lifted at ' + v1.P.toFixed(1) + ' barg'); } } else v1.cnt = false;
      var bd101 = (s.bdv && v1.P > 0.05) ? 8000 * scG * Math.sqrt((v1.P + ATM) / 7) : 0;
      var blow101 = ((v1.vo + v1.vw) / R.v101.cap < 0.05) ? 3000 * scG * (Vv('LCV-101') / 100) : 0;
      var gasOut101 = vflow(Vv('PCV-101'), 6240 * scG, v1.P - s.fk.P, 5.7);

      // ---------- hot oil heater HO-1 and consumers
      var ho = s.ho, ht = s.ht, col = s.col;
      s.fg.P += (clamp(v1.P * 0.92, 0, 4.0) - s.fg.P) * Math.min(1, dt / 20);
      var fgOK = s.fg.P > 2.0 && s.power.on;
      s.chem.cr += ((3 + 10 * wcNow) * (1 - Math.min(0.9, s.chem.ci / 15)) - s.chem.cr) * Math.min(1, dt / 600);
      if (s.wt.back > 0) { s.wt.back -= dt; s.wt.eff = Math.min(0.85, s.wt.eff + 0.85 * dt / 300); }
      if (s.wt.skim > 0) s.wt.skim -= dt;
      var heatHO = 0;
      if (ho.burner === 'PURGE') { ho.purge -= dt; if (ho.purge <= 0) ho.burner = 'ON'; }
      if (ho.burner === 'ON') heatHO = R.ho.maxKW * Vv('TCV-101') / 100;
      // V-210 outlet: explicit solution of the hot oil exchange
      var Cc2 = Math.max(capr(q101, b1), 1);
      var G2 = SPEC.hxG2 * Vv('TCV-103') / 100 * (1 - s.flt.hx2foul);
      var Tin2 = v1.T;
      var T2tgt = (Tin2 * Cc2 + G2 * ho.T) / (Cc2 + G2);
      s.hx2.T += (T2tgt - s.hx2.T) * Math.min(1, dt / 60);
      var duty2 = Cc2 * (s.hx2.T - Tin2);

      // ---------- heater treater HT-200 with bypass BV-HT
      var fb = clamp(s.hv['BV-HT'] / 100 * 0.85, 0, 0.85);
      var qBH = q101 * fb, qHT = q101 - qBH;
      var lvl2 = (ht.vo + ht.vw) / R.ht.cap;
      var nP101 = (s.pumps['P-101A'] === 'RUNNING' ? 1 : 0) + (s.pumps['P-101B'] === 'RUNNING' ? 1 : 0);
      var Ppd = nP101 > 0 ? (5.0 * (nP101 > 1 ? 1.1 : 1)) : 0;
      var gvc = function (x) { return Math.min(1, x / 40); };
      var cSt = Math.min(gvc(s.hv['GV-1']), gvc(s.hv['GV-2'])), cBy = Math.min(1, gvc(s.hv['GV-3']) + gvc(s.hv['GV-4']));
      var mfBlk = Math.min(1, (cSt + cBy) / 0.2);
      var q103 = nP101 > 0 ? vflow(Vv('LCV-103'), 800 * scL, ht.P + Ppd - col.P - 1.5, 4.8) : 0;
      q103 = Math.min(q103, (ht.vo + ht.vw) / h * 0.9) * mfBlk;
      var q104w = vflow(Vv('LCV-104'), 40 * scW, ht.P - 0.5 + 0.3, 2.3);
      var b2 = ht.b;
      var r2 = vessel(ht, R.ht.cap, qHT * (1 - b1), qHT * b1, q103, b2, q104w, h);
      var dHT = drainFrom(ht, 'DR-102', h);
      // burner / temperature
      var heatHT = 0;
      if (ht.burner === 'PURGE') { ht.purge -= dt; if (ht.purge <= 0) ht.burner = 'ON'; }
      if (ht.burner === 'ON') heatHT = R.ht.burnerMaxKW * Vv('TCV-102') / 100;
      var CcHT = Math.max(capr(qHT, b1), 1);
      var Mht = (ht.vo * 850 * 2.0 + ht.vw * 1000 * 4.18) + 60000 * scV;
      ht.T += dt * (heatHT + CcHT * (s.hx2.T - ht.T) - 8 * scV * (ht.T - TAMB)) / Mht;
      ht.T = clamp(ht.T, 0, 160);
      var gasHTin = qHT * (1 - b1) * GOR * 0.03 * (1 + 0.012 * (ht.T - 85));
      var psvHT = 0;
      if (ht.P > R.ht.psvSet) ht.psv = true; else if (ht.P < R.ht.psvSet - 0.4) ht.psv = false;
      if (ht.psv) { psvHT = 4000 * scG * Math.min(1, ht.P - R.ht.psvSet + 0.4); if (!ht.cnt) { ht.cnt = true; P.kpi.psvLifts++; logEvt('ALM', 'PSV-102 lifted at ' + ht.P.toFixed(1) + ' barg'); } } else ht.cnt = false;
      var gasOutHT = vflow(Vv('PCV-102'), 1560 * scG, ht.P - s.fk.P, 2.2);
      fuelFlow = (heatHO + heatHT) * 0.10 * 0.9;
      var fuelSup = Math.min(fuelFlow, 3000 * scG);

      // gas balances V-100 (fuel gas comes from V-100), HT
      var dLiq1 = (qSC - q101 - q102w - dV1) * h;
      gasBal(v1, R.v101.gasVol, gas101in, gasOut101 + bd101 + psv101 + blow101 + (fgOK ? fuelSup : 0), dLiq1, h, 30);
      gasBal(ht, R.ht.gasVol, gasHTin + blow101, gasOutHT + psvHT, (qHT - q103 - q104w - dHT) * h, h, 15);
      // V-100 temperature follows HX-1 cold outlet
      v1.T += (s.hx1.Tc - v1.T) * Math.min(1, dt / 90);

      // ---------- manifold MF-2 (GV-1 stripper in, GV-2 stripper out, GV-3/GV-4 straight bypass), N2 stripping column
      var qM = q103 + qBH;
      var bMF = qM > 0.01 ? (q103 * b2 + qBH * b1) / qM : b2;
      var TMF = qM > 0.01 ? (q103 * ht.T + qBH * s.hx2.T) / qM : ht.T;
      var fs = (cSt + cBy) > 0.001 ? clamp(cBy / (cSt + cBy) * 1.7, 0, 0.85) : 0;
      var qCin = qM * (1 - fs), qDir = qM * fs;
      var lvlC = col.v / R.col.cap;
      var q105 = vflow(Vv('LCV-105'), 800 * scL, col.P - s.v103.P + 3.0 + 0.4 * lvlC, 3.4);
      q105 = Math.min(q105, col.v / h * 0.9) * gvc(s.hv['GV-2']);
      col.v = clamp(col.v + (qCin - q105) * h, 0, R.col.cap);
      var dCol = 0;
      var Cf = Math.max(capr(qCin, bMF), 5 * scO);
      var Greb = SPEC.hxGreb * Vv('TCV-104') / 100;
      var Mcol = Math.max(col.v, 3) * 850 * 2.0 + 30000 * scV;
      var Qreb = Greb * (ho.T - col.Treb);
      col.Treb += dt * (Cf * (TMF - col.Treb) + Qreb - 6 * scV * (col.Treb - TAMB)) / Mcol;
      col.Treb = clamp(col.Treb, 0, 220);
      ho.T += dt * (heatHO - duty2 - Qreb - (s.flows.qhx1 || 0) - SPEC.hoLoss * (ho.T - TAMB)) / SPEC.hoC;
      ho.T = clamp(ho.T, 0, 260);
      var n2 = s.n2;
      if (n2.pkg === 'STARTING') { n2.cd -= dt; if (n2.cd <= 0) { n2.pkg = 'RUNNING'; logEvt('OP', 'N2 package running'); } }
      n2.P += (((n2.pkg === 'RUNNING' && s.power.on) ? 7.5 : 0) - n2.P) * Math.min(1, dt / 45);
      if (n2.pkg === 'RUNNING' && !s.power.on) { n2.pkg = 'TRIPPED'; logEvt('ALM', 'N2 package tripped: power loss'); }
      var n2eff = clamp(s.hv['XV-N2'] / 100 * n2.P / 7.5, 0, 1.2) * (cSt > 0.2 ? 1 : 0.2);
      n2.flow = 100 * scG * s.hv['XV-N2'] / 100 * n2.P / 7.5 * (col.P + 2 > n2.P ? 0 : 1);
      var rvpCol = clamp(14.2 - 0.14 * (col.Treb - 80) + 0.6 * (col.P - 1.2) - 3.0 * (n2eff - 0.5), 3, 18);
      col.h2s += (clamp(30 * Math.exp(-2.64 * n2eff) * (1 + 0.02 * (120 - col.Treb)) * (1 + 0.5 * fs), 1, 60) - col.h2s) * Math.min(1, dt / 240);
      var rvpFeed = clamp(14.2 - 0.14 * (TMF - 80) + 1.8, 3, 20);
      var gasCin = 8 * scG * (n2eff - 0.5) + qCin * (1 - bMF) * GOR * 0.03 + 0.7 * Math.max(col.Treb - 100, 0) * (qCin / 100) * scG / Math.max(scO, 0.05) * 0.2;
      var gasOutC = vflow(Vv('PCV-104'), 1560 * scG, col.P - s.fk.P, 0.9);
      gasBal(col, R.col.gasVol, gasCin, gasOutC, (qCin - q105) * h, h, 12);

      // ---------- HX-1 hot side, cooler E-105, V-110
      var qHX = q105 + qDir;
      if (s.cool.Tin === undefined) s.cool.Tin = 120;
      var bV3in = bMF;
      if (qHX > 0.05) {
        var Thin = (q105 * col.Treb + qDir * TMF) / qHX;
        s.cool.Tin += (Thin - s.cool.Tin) * Math.min(1, dt / 45);
      } else { s.cool.Tin += (TAMB - s.cool.Tin) * Math.min(1, dt / 300); }
      // HX-1 is a thermal (hot oil) exchanger: hot oil from HO-1 heats the V-001 oil going to V-100
      var effH = 0.118 * (1 - R.hx1.foul), hoOn = s.ho.T > s.hx1.Tc;
      var Qhx = hoOn ? effH * Math.max(Cc1, 1) * Math.max(ho.T - s.hx1.Tc, 0) : 0;
      s.hx1.Tc += ((s.sc.T + Qhx / Math.max(Cc1, 1)) - s.hx1.Tc) * Math.min(1, dt / 120);
      s.hx1.Th += ((ho.T - Qhx / Math.max(SPEC.hoC / 60, 1)) - s.hx1.Th) * Math.min(1, dt / 60);
      s.flows.qhx1 = Qhx;
      var fan = Vv('FAN-105') / 100 * (s.power.on ? 1 : 0);
      var Tcool = TAMB + (s.cool.Tin - TAMB) * Math.exp(-2.0 * fan);
      s.cool.T += (Tcool - s.cool.T) * Math.min(1, dt / 60);
      var v3 = s.v103, lvl3 = (v3.vo + v3.vw) / R.v103.cap, ifc3 = v3.vw / R.v103.cap;
      var q106 = vflow(Vv('LCV-106'), 800 * scL, v3.P + 1.5 + 0.3 * lvl3, 2.3);
      q106 = Math.min(q106, (v3.vo + v3.vw) / h * 0.9);
      var q107w = vflow(Vv('LCV-107'), 10 * scW, v3.P - 0.5 + 0.3, 1.6);
      var b3 = v3.b;
      var r3 = vessel(v3, R.v103.cap, qHX * (1 - bV3in), qHX * bV3in, q106, b3, q107w, h);
      var dV3 = drainFrom(v3, 'DR-103', h);
      var fcb = clamp(s.hv['BV-CL'] / 100 * 0.9, 0, 0.9);
      v3.T += ((s.cool.T * (1 - fcb) + s.cool.Tin * fcb) - v3.T) * Math.min(1, dt / 90);
      var gas103in = qHX * (1 - bV3in) * GOR * 0.02 * (1 + 0.03 * Math.max(0, v3.T - 55));
      var gasOut103 = vflow(Vv('PCV-103'), 1040 * scG, v3.P - s.fk.P, 0.5);
      gasBal(v3, R.v103.gasVol, gas103in, gasOut103, (qHX - q106 - q107w - dV3) * h, h, 8);

      // ---------- BS&W chain & RVP
      var dem01 = clamp(s.dem / 50, 0, 1), qn = 390 * scO + 20 * scO;
      var thru = q101;
      var b0eq = clamp(0.02 + 0.02 * Math.min(1, wcNow / 0.35) + 0.22 * Math.max(0, wcNow - 0.35) + 0.6 * Math.max(0, ifcSC - 0.33) + 0.12 * Math.max(0, lvlSC - 0.7) + 0.0003 * Math.max(0, qSC / scL - 560), 0.005, 0.5);
      var r1v = clamp(0.30 + 0.10 * (dem01 - 0.5) * 2 - 0.6 * Math.max(0, ifc1 - 0.4) - 0.3 * Math.max(0, thru / qn - 1.15) - 0.5 * s.flt.foamEff, 0.05, 0.6);
      var b1eq = b0 * (1 - r1v) + 0.03 * s.flt.foamEff;
      var ifc2 = ht.vw / R.ht.cap;
      var burnerFactor = ht.burner === 'ON' ? 0 : 0.0;
      var r2v = clamp(0.84 + 0.016 * (clamp(ht.T, 30, 105) - 85) + 0.30 * (dem01 - 0.5) - 0.9 * Math.max(0, ifc2 - 0.55) - 0.5 * Math.max(0, q103 / qn - 1.1) - 0.3 * s.flt.emul, 0.05, 0.96);
      var b2eq = b1 * (1 - r2v) + 0.012 * s.flt.emul;
      var r3v = clamp(0.60 - 0.9 * Math.max(0, ifc3 - 0.5) - 0.4 * Math.max(0, qHX / qn - 1.15) + 0.2 * (dem01 - 0.5), 0.05, 0.9);
      var b3eq = bMF * (1 - r3v);
      var kb = Math.min(1, dt / 90);
      sc.b += (b0eq - sc.b) * kb; v1.b += (b1eq - v1.b) * kb; ht.b += (b2eq - ht.b) * kb; v3.b += (b3eq - v3.b) * kb;
      var rvpMix = (qHX > 0.05 ? (q105 * rvpCol + qDir * rvpFeed) / qHX - 0.2 : rvpCol) + 0.06 * Math.max(0, v3.T - 55);
      col.rvp += (rvpMix - col.rvp) * Math.min(1, dt / 150);

      // ---------- product routing, tanks, slop
      var offspec = (v3.b * 100 > R.tank.bswSpec) || (col.rvp > R.rvpSpec + 0.3) || (col.h2s > 14);
      if (s.route === 'AUTO') s.routeNow = offspec ? 'SLOP' : 'TANK'; else s.routeNow = s.route;
      var tk = s.tank, sl = s.slop;
      if (s.routeNow === 'TANK') {
        var vOld = tk.v; tk.v += q106 * h;
        if (q106 > 0.01) tk.bsw = (vOld * tk.bsw + q106 * h * v3.b * 100) / Math.max(tk.v, 1e-6);
        if (offspec) P.kpi.tankContamSec += dt;
      } else sl.v += q106 * h;
      if (offspec) P.kpi.offspecM3 += q106 * h;
      sl.v += (dSC + dV1 + dHT + dV3) * h;
      if (slopRet > 0) sl.v = Math.max(0, sl.v - slopRet * h);
      s.flows = { qSC: qSC, q101: q101, qHT: qHT, qBH: qBH, q103: q103, qM: qM, qCin: qCin, qDir: qDir, q105: q105, qHX: qHX, q106: q106,
                  gSC: gasOutSC, g101: gasOut101, gHT: gasOutHT, gCol: gasOutC, g103: gasOut103, qSCw: rSC.qw, q102w: r1.qw, q104w: r2.qw, q107w: r3.qw, drains: dSC + dV1 + dHT + dV3, duty2: duty2, Qreb: Qreb, qByC: 0, n2eff: n2eff, cSt: cSt, cBy: cBy, fcb: fcb, heatHO: heatHO, heatHT: heatHT, fuel: fuelSup, disp: 0 };

      // ---------- export
      var nExp = (s.pumps['P-201A'] === 'RUNNING' ? 1 : 0) + (s.pumps['P-201B'] === 'RUNNING' ? 1 : 0);
      var qe = Math.min(R.export.pumpFlow * nExp, 900 * scO * Vv('FCV-201') / 100) * s.pipe.avail;
      qe = Math.max(0, Math.min(qe, tk.v / h * 0.5));
      var lc = s.lact;
      lc.bsw += (tk.bsw - lc.bsw) * Math.min(1, dt / 60);
      if (lc.bsw > R.tank.bswSpec) lc.divT += dt; else lc.divT = Math.max(0, lc.divT - dt);
      if (lc.divT > 30 && !lc.divert) { lc.divert = true; logEvt('ALM', 'LACT divert: export BS&W ' + lc.bsw.toFixed(2) + '%'); }
      if (lc.divert && lc.divT <= 0 && lc.bsw < R.tank.bswSpec - 0.05) { lc.divert = false; logEvt('OP', 'LACT divert cleared'); }
      if (lc.divert) { qe = 0; P.kpi.lactDivertSec += dt; }
      lc.mfTrue += dt * 5e-8 * (1 + 0.5 * Math.sin(s.t / 3000));
      if (lc.prove > 0) { lc.prove -= dt; if (lc.prove <= 0) { lc.mf = 1 / lc.mfTrue; lc.lastProve = s.t; logEvt('OP', 'LACT meter proving complete: meter factor ' + lc.mf.toFixed(4)); } }
      lc.dev = lc.mfTrue * lc.mf - 1;
      lc.samp = Math.min(100, lc.samp + qe * h * 0.02);
      s.exp.q = qe; tk.v = clamp(tk.v - qe * h, 0, R.tank.cap);
      P.kpi.exportedM3 += qe * h;
      var tkLvl = tk.v / R.tank.cap * 100;
      // ---------- TK-410 cold vent to LP flare (PVRV +35 / -3 mbarg)
      var lpf = s.lpf, ventOpen = s.hv['VENT-410'] / 100;
      var netVap = (s.routeNow === 'TANK' ? q106 : 0) - qe + 0.5 * q106 * Math.max(0, v3.T - 50) / 10 + 4 * scO * (tk.bsw > 0 ? 1 : 0);
      var Peq = lpf.P * 1000 + 2 + netVap / (60 * scL * Math.max(ventOpen, 0.0005));
      Peq = clamp(Peq, -40, 120);
      tk.P += (Peq - tk.P) * Math.min(1, dt / 20);
      tk.lift = tk.P > 35; tk.vac = tk.P < -3;
      if (tk.lift) { tk.P = Math.min(tk.P, 38); if (!tk.liftCnt) { tk.liftCnt = true; P.kpi.psvLifts++; P.kpi.ventSec += dt; logEvt('ALM', 'TK-410 PVRV lifted: hydrocarbon vapour to atmosphere'); } } else tk.liftCnt = false;
      if (tk.vac) tk.P = Math.max(tk.P, -4);
      var ventQ = Math.max(0, netVap) * ventOpen;
      if (s.tank.lift) ventQ = 0;
      lpf.flow = ventQ;
      if (lpf.pilot === 'ON' && s.hazard.lpOut) lpf.pilot = 'OUT';
      lpf.P += ((0.008 + 0.00004 * lpf.flow) - lpf.P) * Math.min(1, dt / 20);
      if (lpf.pilot === 'OUT' && lpf.flow > 50) P.kpi.ventSec += dt;

      // ---------- produced water
      var w = s.water, wIn = rSC.qw + r1.qw + r2.qw + r3.qw;
      var ow = rSC.ow + r1.ow + r2.ow + r3.ow;
      var ppmIn = 20 + 800 * Math.max(0, 0.12 - ifcSC) + 600 * Math.max(0, 0.10 - ifc1) + (ow > 0 ? 300 + 4 * ow : 0);
      w.ppmIn += (ppmIn / 0.15 - w.ppmIn) * Math.min(1, dt / 240);
      var ppmOut = w.ppmIn * (1 - s.wt.eff) * (s.wt.skim > 0 ? 0.7 : 1);
      w.ppm += (ppmOut - w.ppm) * Math.min(1, dt / 240);
      var nDisp = (s.pumps['P-301A'] === 'RUNNING' ? 1 : 0) + (s.pumps['P-301B'] === 'RUNNING' ? 1 : 0);
      var qd = Math.min(420 * scW * Vv('FCV-301') / 100, 250 * scW * 1.4 * nDisp) * (nDisp > 0 ? 1 : 0);
      qd = Math.min(qd, w.v / h * 0.5);
      w.v = clamp(w.v + (wIn + ow * 0 - qd) * h, 0, R.water.cap);
      s.flows.disp = qd; s.flows.wIn = wIn;

      // ---------- FKOD V-401, flare
      var fk = s.fk, flare = s.flare;
      var purgeQ = 150 * scG * s.hv['FP-401'] / 30; flare.purge = purgeQ;
      var gasToFK = purgeQ + gasOutSC + gasOut101 + gasOutHT + gasOutC + gasOut103 + bdSC + bd101 + psvSC + psv101 + psvHT;
      var nF = (s.pumps['P-401A'] === 'RUNNING' ? 1 : 0) + (s.pumps['P-401B'] === 'RUNNING' ? 1 : 0);
      var condIn = 0.00002 * gasToFK + fk.surge + carrySC + 12 * scO * s.flt.foamEff;
      var q401 = nF > 0 ? Math.min(vflow(Vv('LCV-401'), 30 * scO, 4, 4), 50 * scO) : 0;
      q401 = Math.min(q401, fk.v / h * 0.5);
      fk.v = clamp(fk.v + (condIn - q401) * h, 0, R.fkod.cap);
      sl.v += q401 * h;
      var flareOut = 22000 * scG * Math.sqrt(Math.max(fk.P + 0.05, 0) / 0.15);
      var psvFK = 0;
      if (fk.P > R.fkod.psvSet) { psvFK = 20000 * scG * (fk.P - R.fkod.psvSet + 0.2); fk.psv = true; } else fk.psv = false;
      gasBal(fk, R.fkod.gasVol, gasToFK, flareOut + psvFK, 0, h, 8);
      if (fk.P > 0.9) s.seal.lvl = Math.max(0, s.seal.lvl - (fk.P - 0.9) * dt * 0.4); else s.seal.lvl = Math.min(70, s.seal.lvl + 0.02 * dt);
      flare.flow = flareOut + psvFK;
      flare.total += flare.flow * h; P.kpi.flaredSm3 += flare.flow * h;
      flare.venting = flare.pilot === 'OUT' && flare.flow > 200;
      if (flare.venting) P.kpi.ventSec += dt;
      if (fk.v / R.fkod.cap > 0.9) P.kpi.flareLiqSec += dt;
      sl.v = clamp(sl.v, 0, R.slop.cap);

      // ---------- pump protection and standby auto-start
      var cavOf = function (p) { if (/^P-101/.test(p)) return pv('LT-103') < 18; if (/^P-201/.test(p)) return tkLvl < 7; if (/^P-301/.test(p)) return pv('LT-301') < 10; if (/^P-401/.test(p)) return pv('LT-401') < 3; return false; };
      var autoStart = function (grp, lead) {
        if (!s.auto[grp]) return;
        if (s.power.shed && grp === 'P-301') return;
        var a = grp + 'A', b = grp + 'B';
        if (s.pumps[a] !== 'RUNNING' && s.pumps[b] !== 'RUNNING' && s.pumps[lead] === 'TRIPPED') {
          var other = lead === a ? b : a;
          if (s.pumps[other] === 'STOPPED' && s.power.on && s.esd.level < 2 && !s.ptw[other]) {
            if (s.pf[other].fail) { if (!s.pf[other].failLogged) { s.pf[other].failLogged = true; logEvt('ALM', other + ' failed to auto-start (motor fault)'); } return; }
            s.pumps[other] = 'RUNNING'; logEvt('OP', other + ' auto-started (standby)');
          }
        }
      };
      PUMPS.forEach(function (p, i) {
        var f = s.pf[p], run = s.pumps[p] === 'RUNNING';
        if (run) f.seal = Math.min(1, f.seal + f.sealRate * dt);
        f.vib = run ? 1.6 + 0.05 * Math.sin(s.t / 7 + i) + 6.5 * f.seal + 8 * f.bear + (cavOf(p) ? 4 : 0) : 0;
        if (run && (f.vib >= 11 || f.seal >= 1)) { s.pumps[p] = 'TRIPPED'; P.kpi.tripCount++; logEvt('ALM', p + ' tripped: ' + (f.seal >= 1 ? 'mechanical seal failure' : 'vibration high-high')); if (p !== 'P-501') autoStart(p.slice(0, 5), p); }
      });
      ['P-101A', 'P-101B'].forEach(function (p) {
        if (s.pumps[p] === 'RUNNING' && (pv('LT-103') < 8 || !s.power.on)) { s.pumps[p] = 'TRIPPED'; P.kpi.tripCount++; logEvt('ALM', p + ' tripped: ' + (!s.power.on ? 'power loss' : 'HT-200 level low-low (dry run)')); autoStart('P-101', p); }
      });
      ['P-201A', 'P-201B'].forEach(function (p) {
        if (s.pumps[p] === 'RUNNING' && (tkLvl < 4 || !s.power.on)) { s.pumps[p] = 'TRIPPED'; P.kpi.tripCount++; logEvt('ALM', p + ' tripped: ' + (!s.power.on ? 'power loss' : 'TK-410 low-low level')); autoStart('P-201', p); }
      });
      ['P-301A', 'P-301B'].forEach(function (p) { if (s.pumps[p] === 'RUNNING' && !s.power.on) { s.pumps[p] = 'TRIPPED'; autoStart('P-301', p); } });
      ['P-401A', 'P-401B'].forEach(function (p) { if (s.pumps[p] === 'RUNNING' && !s.power.on) s.pumps[p] = 'TRIPPED'; });
      ['P-101A', 'P-101B', 'P-201A', 'P-201B', 'P-301A', 'P-301B', 'P-401A', 'P-401B'].forEach(function (p) {
        if (s.pumps[p] === 'TRIPPED' && s.pendingAuto !== false) { var g = p.slice(0, 5), lead = p; autoStart(g, lead); }
      });

      // ---------- fired heater protection
      var bt = function (what, msg) { s[what].burner = 'TRIPPED'; P.kpi.tripCount++; logEvt('ALM', msg); };
      if (ho.burner !== 'OFF' && ho.burner !== 'TRIPPED') {
        if (ho.T >= 225) bt('ho', 'HO-1 tripped: hot oil temperature high-high');
        else if (!fgOK) bt('ho', 'HO-1 tripped: fuel gas pressure low');
        else if (s.esd.level > 0) bt('ho', 'HO-1 tripped: PSD/ESD');
      }
      if (ht.burner !== 'OFF' && ht.burner !== 'TRIPPED') {
        if (ht.T >= 105) bt('ht', 'E-103 tripped: HT-200 temperature high-high');
        else if (pv('LT-103') < 12) bt('ht', 'E-103 tripped: HT-200 level low-low');
        else if (!fgOK) bt('ht', 'E-103 tripped: fuel gas pressure low');
        else if (s.esd.level > 0) bt('ht', 'E-103 tripped: PSD/ESD');
      }

      safety(dt);
      alarms(dt);
      var k1 = P.kpi;
      k1.maxPsc = Math.max(k1.maxPsc, sc.P); k1.maxLsc = Math.max(k1.maxLsc, pv('LT-001')); k1.minLsc = Math.min(k1.minLsc, pv('LT-001'));
      k1.maxL101 = Math.max(k1.maxL101, pv('LT-101')); k1.maxPv101 = Math.max(k1.maxPv101, v1.P);
      k1.maxPfk = Math.max(k1.maxPfk, fk.P); k1.maxLfk = Math.max(k1.maxLfk, pv('LT-401'));
      k1.maxTankL = Math.max(k1.maxTankL, tkLvl); k1.maxWater = Math.max(k1.maxWater, pv('LT-301'));
      runScenario(dt);
    }

    // ---- safety: PSD (level 1) / ESD-1 (level 2) cause & effect
    function raiseESD(level, cause) {
      if (s.esd.causes.indexOf(cause) < 0) s.esd.causes.push(cause);
      if (level > s.esd.level) {
        s.esd.level = level; s.esd.reset = false;
        if (level === 1) P.kpi.psdCount++; else P.kpi.esdCount++;
        logEvt('ESD', (level === 1 ? 'PSD' : 'ESD-1') + ' activated: ' + cause);
        s.esdv.cmd = 0; s.horn = true;
        if (s.ho.burner !== 'OFF') s.ho.burner = 'TRIPPED';
        if (s.ht.burner !== 'OFF') s.ht.burner = 'TRIPPED';
        if (level === 2) {
          ['P-101A', 'P-101B', 'P-201A', 'P-201B', 'P-301A', 'P-301B', 'P-501'].forEach(function (p) { if (s.pumps[p] === 'RUNNING') s.pumps[p] = 'TRIPPED'; });
          s.bdv = true;
        }
      }
    }
    // ---- fire and gas system: leak sources, detector model, 2oo2 voting with degradation on override/fault
    function fgsStep(dt) {
      var g = s.fgs, Z, k;
      // automatic sources linked to the process
      g.auto = {};
      if (s.tank.lift) g.auto['Z4:h2s'] = 0.004 * s.col.h2s;
      FG_ZONES.forEach(function (zz) {
        Z = zz[0];
        var c = g.c[Z];
        c.gas += (((g.src[Z + ':gas'] || 0) + (g.auto[Z + ':gas'] || 0)) - 0.004 * c.gas) * dt; c.gas = Math.max(0, c.gas);
        c.h2s += (((g.src[Z + ':h2s'] || 0) + (g.auto[Z + ':h2s'] || 0)) - 0.004 * c.h2s) * dt; c.h2s = Math.max(0, c.h2s);
        c.fire += ((g.fire[Z] ? 1 : 0) - c.fire) * Math.min(1, dt / 15);
      });
      Object.keys(g.resp).forEach(function (zr0) {
        if (g.resp[zr0] <= s.t) {
          var kd = g.respKind[zr0]; delete g.resp[zr0];
          if (kd === 'fire') { delete g.fire[zr0]; logEvt('OP', 'Fire in ' + zr0 + ' extinguished by the fire team'); }
          else { delete g.src[zr0 + ':gas']; delete g.src[zr0 + ':h2s']; logEvt('OP', 'Leak in ' + zr0 + ' isolated by the field team'); }
        }
      });
      // overrides auto-expire
      Object.keys(g.ovr).forEach(function (id) { if (g.ovr[id] <= s.t) { delete g.ovr[id]; logEvt('F&G', 'Override on ' + id + ' expired automatically (1 h limit): detector back in service'); } });
      Object.keys(s.ceByp).forEach(function (id) { if (s.ceByp[id] <= s.t) { delete s.ceByp[id]; logEvt('F&G', 'SIS bypass on ' + id + ' expired automatically (1 h limit)'); } });
      Object.keys(g.det).forEach(function (id) { var d = g.det[id]; if (d.fault && d.until && d.until <= s.t) { d.fault = null; d.until = 0; d.ft = 0; } });
      FG_ZONES.forEach(function (zz) {
        Z = zz[0];
        FG_KEYS.forEach(function (k) {
          var T0 = FG_TYPES[k], zr = g.z[Z][k], use = [], anyFault = false;
          ['A', 'B'].forEach(function (p) {
            var d = g.det[T0.pre + '-' + Z + '-' + p], base = g.c[Z][k] * (k === 'fire' ? 100 : 1);
            var v = d.k * base;
            if (d.fault === 'spike') v = 0.75 * T0.max; else if (d.fault === 'fail') v = 0;
            else if (d.fault === 'drift') { d.ft += dt; v = Math.min(0.5 * T0.max, d.ft * 0.02 * T0.max) + v; }
            d.val = Math.min(T0.max, Math.max(0, v));
            if (d.fault === 'fail') anyFault = true;
            if (!g.ovr[d.id] && d.fault !== 'fail') use.push(d);
          });
          zr.fault = anyFault;
          zr.blind = use.length === 0;
          zr.vote = use.length >= 2 ? '2oo2' : (use.length === 1 ? '1oo1 (degraded)' : 'BLIND');
          zr.low = use.some(function (d) { return d.val >= T0.lo; });
          zr.high = use.some(function (d) { return d.val >= T0.hi; });
          zr.conf = use.length > 0 && use.every(function (d) { return d.val >= T0.hi; });
          if (zr.conf && !g.firstHigh) g.firstHigh = { t: s.t, zone: Z, type: k };
        });
      });
    }
    function fgsActive() {
      var out = [];
      FG_ZONES.forEach(function (zz) { FG_KEYS.forEach(function (k) { var r = s.fgs.z[zz[0]][k]; if (r.conf || r.high) out.push(FG_TYPES[k].name + ' ' + zz[0]); }); });
      return out;
    }
    function safety(dt) {
      var t = P.tagTable;
      fgsStep(dt);
      if (s.esd.level < 2) {
        CAUSES.forEach(function (c) {
          if (s.ceByp[c[0]] !== undefined) return;
          if (c[4](t, s)) raiseESD(c[3], c[0] + ' ' + c[2]);
        });
        FG_ZONES.forEach(function (zz) {
          FG_KEYS.forEach(function (k) {
            var r = s.fgs.z[zz[0]][k];
            if (r.conf) raiseESD(2, (k === 'fire' ? 'FF' : k === 'gas' ? 'GHH' : 'SHH') + '-' + zz[0] + ' ' + FG_TYPES[k].name + ' confirmed (' + r.vote + ') in ' + zz[0]);
          });
        });
      }
    }

    // ---- alarm engine (ISA-18.2 states: unack / ack / return-to-normal unack)
    function alarms(dt) {
      var t = P.tagTable, A = P.alarms;
      function evalA(id, desc, pr, active, extra) {
        var a = A[id];
        if (!a) a = A[id] = { id: id, desc: desc, pr: pr, state: 'NORMAL', since: 0, value: extra };
        a.value = extra;
        var sh = s.shelf[id];
        if (sh !== undefined && sh <= s.t) { delete s.shelf[id]; sh = undefined; if (a.state === 'SHELVED') a.state = 'NORMAL'; }
        if (sh !== undefined) { if (active) { if (a.state === 'NORMAL' || a.state === 'RTN_UNACK') a.state = 'SHELVED'; } else if (a.state === 'SHELVED') a.state = 'NORMAL'; return; }
        if (active && (a.state === 'NORMAL' || a.state === 'RTN_UNACK')) {
          a.state = 'ACTIVE_UNACK'; a.since = s.t; a.count = (a.count || 0) + 1; logEvt('ALM', id + ' ' + desc + (extra ? ' (' + extra + ')' : ''));
          s.floodT.push(s.t);
          if (pr <= 2) { if (!s.first || s.t - s.first.t0 > 60) s.first = { id: id, desc: desc, t0: s.t, cascade: [] }; else if (s.first.cascade.length < 25) s.first.cascade.push({ id: id, dt: Math.round(s.t - s.first.t0) }); }
        }
        else if (!active) { if (a.state === 'ACTIVE_UNACK') a.state = 'RTN_UNACK'; else if (a.state === 'ACTIVE_ACK') a.state = 'NORMAL'; }
      }
      ALARM_DEFS.forEach(function (d) {
        var tag = t[d[2]], val = tag.v, a = A[d[0]], on = a && (a.state === 'ACTIVE_UNACK' || a.state === 'ACTIVE_ACK');
        var lim = d[4], db = d[6], act;
        if (d[3] === '>') act = on ? val > lim - db : val > lim; else act = on ? val < lim + db : val < lim;
        if (d[3] === '<' && (s.esd.level > 0 || s.suppressLowUntil > s.t)) act = false;     // state-based suppression
        evalA(d[0], d[1], d[5], act, val.toFixed(val < 10 ? 2 : 1) + ' ' + tag.unit);
      });
      EVENT_ALARMS.forEach(function (d) { evalA(d[0], d[1], d[2], d[3](s), ''); });
      while (s.floodT.length && s.floodT[0] < s.t - 600) s.floodT.shift();
      P.flood = s.floodT.length; if (P.flood > 10) P.kpi.floodSec += dt;
      for (var id in A) if (A[id].pr === 1 && (A[id].state === 'ACTIVE_UNACK' || A[id].state === 'ACTIVE_ACK')) { P.kpi.alarmSecP1 += dt; break; }
    }

    // ---- scenarios, scoring
    var SCENARIOS = buildScenarios();
    function runScenario(dt) {
      var sc = P.scenario;
      if (!sc || sc.done) return;
      var el = s.t - sc.t0;
      for (var i = 0; i < sc.def.events.length; i++) {
        var e = sc.def.events[i];
        if (!e.fired && el >= e.t) { e.fired = true; e.run(P, s); if (e.msg) logEvt('EVT', e.msg); }
      }
      sc.def.objectives.forEach(function (o, idx) {
        if (sc.status[idx] === 'pending' || sc.status[idx] === 'open') {
          var r = o.check(P, s, el, sc);
          if (r === true) { sc.status[idx] = 'done'; sc.doneAt[idx] = el; logEvt('EVT', 'Objective achieved: ' + o.text); }
          else if (r === false) { sc.status[idx] = 'failed'; sc.doneAt[idx] = el; logEvt('EVT', 'Objective failed: ' + o.text); }
        }
      });
      var allDone = sc.status.every(function (x) { return x !== 'pending' && x !== 'open'; });
      if (allDone || el >= sc.def.duration) { sc.done = true; sc.elapsed = el; sc.score = scoreScenario(); logEvt('EVT', 'Scenario complete — score ' + sc.score.total); }
    }
    function scoreScenario() {
      var sc = P.scenario, k = P.kpi, b = sc.kpi0, pts = 100, notes = [], objs = sc.def.objectives, d;
      objs.forEach(function (o, i) { if (sc.status[i] !== 'done') { pts -= Math.round(60 / objs.length); notes.push('Missed: ' + o.text); } });
      d = k.esdCount - b.esdCount; if (d > 0 && !sc.def.expectESD) { pts -= 15 * d; notes.push('ESD-1 activations: ' + d); }
      d = k.psdCount - b.psdCount; if (d > 0 && !sc.def.expectESD) { pts -= 10 * d; notes.push('PSD activations: ' + d); }
      d = k.psvLifts - b.psvLifts; if (d > 0) { pts -= 10 * d; notes.push('PSV lifts: ' + d); }
      d = k.ventSec - b.ventSec; if (d > 30) { pts -= Math.min(10, Math.round(d / 30)); notes.push('Unlit flare venting: ' + Math.round(d) + ' s'); }
      d = k.flareLiqSec - b.flareLiqSec; if (d > 20) { pts -= 8; notes.push('FKOD overfull (liquid to flare): ' + Math.round(d) + ' s'); }
      d = k.offspecM3 - b.offspecM3; if (d > 100) { var p2 = Math.min(10, Math.round(d / 100)); pts -= p2; notes.push('Off-spec crude: ' + Math.round(d) + ' m3'); }
      d = k.alarmSecP1 - b.alarmSecP1; if (d > 600) { pts -= 5; notes.push('Priority-1 alarms active ' + Math.round(d / 60) + ' min'); }
      pts = clamp(pts, 0, 100);
      return { total: pts, grade: pts >= 90 ? 'A' : pts >= 75 ? 'B' : pts >= 60 ? 'C' : 'D', notes: notes };
    }
    function settle() { var amp = s.weather.amp; s.weather.amp = 0; for (var i = 0; i < 21600; i++) step(C.dt); s.weather.amp = amp; TAMB = C.ambient; s.amb = TAMB; P.alarms = {}; s.floodT = []; s.first = null; s.t = 0; P.kpi = freshKpi(); P.log = []; s.flare.total = 0; s.lact.mfTrue = 1; s.lact.mf = 1; s.lact.dev = 0; s.lact.samp = 12; }
    P.startScenario = function (id) {
      var def = SCENARIOS.filter(function (x) { return x.id === id; })[0];
      if (!def) return false;
      initState(def.init === 'cold' ? 'cold' : 'normal');
      if (def.init !== 'cold') settle(); else s.suppressLowUntil = 1200;
      var d = { id: def.id, title: def.title, duration: def.duration, expectESD: def.expectESD, events: def.events.map(function (e) { return { t: e.t, run: e.run, msg: e.msg, fired: false }; }), objectives: def.objectives };
      P.scenario = { def: d, t0: s.t, status: def.objectives.map(function () { return 'pending'; }), doneAt: [], done: false, kpi0: JSON.parse(JSON.stringify(P.kpi)), score: null, hold: {} };
      logEvt('EVT', 'Scenario started: ' + def.title);
      return true;
    };
    P.scenarios = function () { return SCENARIOS.map(function (d) { return { id: d.id, title: d.title, desc: d.desc, difficulty: d.difficulty, brief: d.brief, objectives: d.objectives.map(function (o) { return o.text; }), duration: d.duration }; }); };

    // ---- operator commands
    P.cmd = function (action, id, value) {
      var L, ok = true, msg = '';
      switch (action) {
        case 'setSP': L = P.loops[id]; if (L) { L.sp = clamp(+value, L.lo, L.hi); logEvt('OP', id + ' SP -> ' + L.sp); } break;
        case 'setMode': L = P.loops[id]; if (L) { L.mode = value; L.e1 = 0; logEvt('OP', id + ' mode -> ' + value); } break;
        case 'setOP': L = P.loops[id]; if (L) { L.mode = 'MAN'; L.op = clamp(+value, 0, 100); } break;
        case 'start': return startEquip(id);
        case 'stop': return stopEquip(id);
        case 'resetTrip': return resetTrip(id);
        case 'ack': if (P.alarms[id]) { var a = P.alarms[id]; if (a.state === 'ACTIVE_UNACK') a.state = 'ACTIVE_ACK'; else if (a.state === 'RTN_UNACK') a.state = 'NORMAL'; } break;
        case 'ackAll': for (var k in P.alarms) { var z = P.alarms[k]; if (z.state === 'ACTIVE_UNACK') z.state = 'ACTIVE_ACK'; else if (z.state === 'RTN_UNACK') z.state = 'NORMAL'; } break;
        case 'esd': raiseESD(2, 'Manual ESD pushbutton'); break;
        case 'psd': raiseESD(1, 'Manual PSD'); break;
        case 'resetESD': return resetESD();
        case 'openInlet':
          if (s.esd.level > 0) return { ok: false, msg: 'Reset ESD/PSD first' };
          s.esdv.cmd = 1; logEvt('OP', 'Inlet ESDV-001 opened'); break;
        case 'closeInlet': s.esdv.cmd = 0; logEvt('OP', 'Inlet ESDV-001 closed'); break;
        case 'bdv': s.bdv = !!value; logEvt('OP', 'Blowdown valve BDV-001 ' + (value ? 'opened' : 'closed')); break;
        case 'dem': s.dem = clamp(+value, 0, 50); logEvt('OP', 'Demulsifier dose -> ' + s.dem + ' ppm'); break;
        case 'route': s.route = value; logEvt('OP', 'Crude routing -> ' + value); break;
        case 'hv': if (s.hv[id] !== undefined) { s.hv[id] = clamp(+value, 0, 100); logEvt('OP', id + ' hand valve -> ' + s.hv[id] + '%'); } else { ok = false; msg = 'Unknown valve'; } break;
        case 'auto': s.auto[id] = !!value; logEvt('OP', id + ' standby auto-start ' + (value ? 'ARMED' : 'DISARMED')); break;
        case 'well': if (s.wells[id]) { s.wells[id].open = !!value; logEvt('OP', id + (value ? ' opened' : ' shut in')); } break;
        case 'flareIgnite': if (id === 'LP') { s.lpf.pilot = 'ON'; if (s.hazard) s.hazard.lpOut = false; logEvt('OP', 'LP flare pilot re-ignited'); break; } if (s.fk.v / C.fkod.cap > 0.9) return { ok: false, msg: 'FKOD level too high' }; s.flare.pilot = 'ON'; logEvt('OP', 'Flare pilot re-ignited'); break;
        case 'wcSet': s.well.wc = clamp(+value, 0, 0.8); break;
        case 'rateSet': s.well.liquidRate = clamp(+value, 0, 900); break;
        case 'iaStart': s.ia[id === 'IAC-B' ? 'B' : 'A'] = 'RUNNING'; logEvt('OP', id + ' started'); break;
        case 'iaStop': s.ia[id === 'IAC-B' ? 'B' : 'A'] = 'STOPPED'; break;
        case 'power':
          if (value) { s.power.blk = false; s.power.uf = false; s.power.ovT = 0; if (!['G-1', 'G-2'].some(function (g) { return s.gen[g] === 'RUNNING'; })) s.gen['G-1'] = 'RUNNING'; } else s.power.blk = true;
          logEvt('OP', 'Main power ' + (value ? 'restored' : 'lost')); break;
        case 'shedReset':
          if (s.power.cap < s.power.demand + 350 * Math.max(scL, 0.3)) return { ok: false, msg: 'Not enough generation: start the stopped generator first' };
          s.power.shed = false; s.power.ovT = 0; logEvt('OP', 'Load shedding reset'); break;
        case 'choke': if (s.wells[id]) { s.wells[id].choke = clamp(+value, 0, 100); logEvt('OP', id + ' choke -> ' + s.wells[id].choke + '%'); } break;
        case 'wellTest': s.test.well = value ? id : null; logEvt('OP', value ? id + ' lined up to test separator' : 'Well test stopped'); break;
        case 'chem': if (id === 'ci' || id === 'af') { s.chem[id] = clamp(+value, 0, 30); logEvt('OP', (id === 'ci' ? 'Corrosion inhibitor' : 'Antifoam') + ' dose -> ' + s.chem[id] + ' ppm'); } break;
        case 'prove':
          if (s.exp.q < 50) return { ok: false, msg: 'Meter proving needs export flow' };
          if (s.lact.prove > 0) return { ok: false, msg: 'Proving already running' };
          s.lact.prove = 120; logEvt('OP', 'LACT meter proving started (120 s)'); break;
        case 'lactSample': logEvt('FIELD', 'Lab result on LACT composite sample: BS&W ' + s.lact.bsw.toFixed(2) + ' %, density 848 kg/m3'); s.lact.samp = 5; s.field.done['LACT-SAMP'] = s.t; break;
        case 'backwash': s.wt.back = 300; logEvt('OP', 'Hydrocyclone backwash started (5 min)'); break;
        case 'skim': s.wt.skim = 300; logEvt('OP', 'TK-420 skimming started (5 min)'); break;
        case 'ambient': C.ambient = clamp(+value, -10, 55); TAMB = C.ambient; logEvt('OP', 'Ambient temperature base -> ' + C.ambient + ' degC'); break;
        case 'fgKey':
          s.fgs.key = !!value; logEvt('F&G', 'F&G inhibit key switch -> ' + (value ? 'OVERRIDE (key inserted and turned, logged)' : 'NORMAL (key removed)'));
          if (value) P.kpi.ovrCount = (P.kpi.ovrCount || 0); break;
        case 'fgOvr':
          if (!s.fgs.det[id]) return { ok: false, msg: 'Unknown detector' };
          if (value) {
            if (!s.fgs.key) return { ok: false, msg: 'Inhibit key switch is not in OVERRIDE: turn the key first' };
            s.fgs.ovr[id] = s.t + FG_EXPIRE; P.kpi.ovrCount = (P.kpi.ovrCount || 0) + 1;
            var dd = s.fgs.det[id]; if (!s.ptw[dd.zone] && !s.ptw[id]) P.kpi.ovrNoPtw = (P.kpi.ovrNoPtw || 0) + 1;
            logEvt('F&G', 'OVERRIDE applied on ' + id + ' (auto-expires in 60 min). Zone ' + dd.zone + ' ' + FG_TYPES[dd.type].name + ' voting degraded');
          } else { delete s.fgs.ovr[id]; logEvt('F&G', 'De-override: ' + id + ' returned to service'); }
          break;
        case 'fgOvrZone':
          if (value && !s.fgs.key) return { ok: false, msg: 'Inhibit key switch is not in OVERRIDE: turn the key first' };
          Object.keys(s.fgs.det).forEach(function (k2) { var d2 = s.fgs.det[k2]; if (d2.zone === id) { if (value) { s.fgs.ovr[k2] = s.t + FG_EXPIRE; } else delete s.fgs.ovr[k2]; } });
          if (value) P.kpi.ovrCount = (P.kpi.ovrCount || 0) + 1;
          logEvt('F&G', (value ? 'OVERRIDE applied on ALL detectors of zone ' : 'De-override of ALL detectors of zone ') + id); break;
        case 'fgDeoverrideAll': s.fgs.ovr = {}; s.ceByp = {}; logEvt('F&G', 'All F&G overrides and SIS bypasses removed (de-override)'); break;
        case 'ceByp':
          if (!CAUSES.some(function (c) { return c[0] === id; })) return { ok: false, msg: 'Unknown cause' };
          if (value) {
            if (!s.fgs.key) return { ok: false, msg: 'Inhibit key switch is not in OVERRIDE: turn the key first' };
            s.ceByp[id] = s.t + FG_EXPIRE; P.kpi.ovrCount = (P.kpi.ovrCount || 0) + 1; logEvt('F&G', 'SIS BYPASS applied on ' + id + ' (auto-expires in 60 min)');
          } else { delete s.ceByp[id]; logEvt('F&G', 'SIS bypass removed from ' + id); }
          break;
        case 'hazardResp':
          if (!s.fgs.z[id]) return { ok: false, msg: 'Unknown zone' };
          s.fgs.resp[id] = s.t + (value === 'fire' ? 120 : 90); s.fgs.respKind = s.fgs.respKind || {}; s.fgs.respKind[id] = value;
          logEvt('OP', (value === 'fire' ? 'Fire team dispatched to ' : 'Leak isolation team dispatched to ') + id + ' (estimated ' + (value === 'fire' ? '2 min' : '90 s') + ')'); break;
        case 'hornReset': s.horn = false; logEvt('OP', 'General alarm horn silenced'); break;
        case 'ptw': return permit(id, value);
        case 'shelve':
          if (!P.alarms[id]) return { ok: false, msg: 'Unknown alarm' };
          if (P.alarms[id].pr === 1) return { ok: false, msg: 'Priority-1 alarms cannot be shelved' };
          s.shelf[id] = s.t + 60 * clamp(+value || 15, 1, 60); if (P.alarms[id].state !== 'NORMAL') P.alarms[id].state = 'SHELVED'; P.kpi.shelved++; logEvt('OP', id + ' shelved for ' + clamp(+value || 15, 1, 60) + ' min'); break;
        case 'unshelve': delete s.shelf[id]; if (P.alarms[id] && P.alarms[id].state === 'SHELVED') P.alarms[id].state = 'NORMAL'; logEvt('OP', id + ' returned from shelf'); break;
        case 'field': return fieldOrder(id);
        case 'note': if (String(value || '').trim()) { s.notes.unshift({ t: s.t, text: String(value).trim().slice(0, 300) }); logEvt('NOTE', String(value).trim().slice(0, 300)); } break;
        case 'proc': startProc(id); break;
        case 'procStop': s.proc = { id: null }; break;
        default: ok = false; msg = 'Unknown command';
      }
      return { ok: ok, msg: msg };
    };
    function startEquip(id) {
      var r = function (ok, msg) { return { ok: ok, msg: msg || '' }; };
      if (s.gen[id] !== undefined && /^G-/.test(id)) {
        if (s.ptw[id]) return r(false, 'Isolated under ' + s.ptw[id].no);
        if (s.gen[id] === 'TRIPPED') return r(false, 'Trip active - reset first');
        if (s.gen[id] === 'STOPPED') { s.gen[id] = 'STARTING'; s.gen.cd[id] = 60; logEvt('OP', id + ' start sequence (60 s)'); }
        return r(true);
      }
      if (!s.power.on) return r(false, 'No power');
      if (s.ptw[id]) return r(false, 'Isolated under ' + s.ptw[id].no);
      if (id === 'N2-PKG') {
        if (s.n2.pkg === 'TRIPPED') return r(false, 'Trip active - reset first');
        if (s.n2.pkg === 'STOPPED') { s.n2.pkg = 'STARTING'; s.n2.cd = 30; logEvt('OP', 'N2 package start sequence (30 s)'); }
        return r(true);
      }
      if (id === 'HO-1') {
        if (s.esd.level > 0) return r(false, 'ESD/PSD active');
        if (s.ho.burner === 'TRIPPED') return r(false, 'Trip active - reset first');
        if (s.fg.P < 2.5) return r(false, 'Fuel gas pressure low (PT-902 below 2.5 barg)');
        if (s.ho.burner === 'OFF') { s.ho.burner = 'PURGE'; s.ho.purge = 30; logEvt('OP', 'HO-1 purge started (30 s)'); }
        return r(true);
      }
      if (id === 'E-103') {
        if (s.esd.level > 0) return r(false, 'ESD/PSD active');
        if (s.ht.burner === 'TRIPPED') return r(false, 'Trip active - reset first');
        if (s.fg.P < 2.5) return r(false, 'Fuel gas pressure low (PT-902 below 2.5 barg)');
        if (pv('LT-103') < 20) return r(false, 'HT-200 level too low (>20%)');
        if (s.ht.burner === 'OFF') { s.ht.burner = 'PURGE'; s.ht.purge = 30; logEvt('OP', 'E-103 purge started (30 s)'); }
        return r(true);
      }
      if (TRIPS[id]) {
        if (s.pumps[id] === 'TRIPPED') return r(false, 'Trip active - reset first');
        if (s.esd.level > 1 && id !== 'P-401A' && id !== 'P-401B') return r(false, 'ESD-1 active');
        if (/^P-101/.test(id) && pv('LT-103') < 15) return r(false, 'HT-200 level too low (>15%)');
        if (/^P-201/.test(id) && pv('LT-201') < 8) return r(false, 'TK-410 level too low (>8%)');
        if (s.power.shed && (/^P-301/.test(id) || id === 'P-501')) return r(false, 'Load shedding active: reset it after generation is restored');
        if (s.pf[id] && s.pf[id].fail) { logEvt('ALM', id + ' failed to start: motor fault'); return r(false, 'Failed to start: motor fault. Isolate and repair.'); }
        s.pumps[id] = 'RUNNING'; logEvt('OP', id + ' started'); return r(true);
      }
      return r(false, 'Unknown equipment');
    }
    function stopEquip(id) {
      if (/^G-/.test(id) && s.gen[id] !== undefined) s.gen[id] = 'STOPPED';
      else if (id === 'N2-PKG') s.n2.pkg = 'STOPPED';
      else if (id === 'HO-1') s.ho.burner = 'OFF'; else if (id === 'E-103') s.ht.burner = 'OFF';
      else if (s.pumps[id] !== undefined) s.pumps[id] = 'STOPPED';
      logEvt('OP', id + ' stopped');
      return { ok: true, msg: '' };
    }
    function resetTrip(id) {
      var ok = true, msg = '';
      if (/^G-/.test(id) && s.gen[id] === 'TRIPPED') s.gen[id] = 'STOPPED';
      else if (id === 'HO-1' && s.ho.burner === 'TRIPPED') { if (s.esd.level > 0) { ok = false; msg = 'ESD/PSD active'; } else if (s.ho.T >= 215) { ok = false; msg = 'Hot oil still too hot'; } else s.ho.burner = 'OFF'; }
      else if (id === 'E-103' && s.ht.burner === 'TRIPPED') { if (s.esd.level > 0) { ok = false; msg = 'ESD/PSD active'; } else if (s.ht.T >= 100) { ok = false; msg = 'HT-200 still too hot'; } else s.ht.burner = 'OFF'; }
      else if (id === 'N2-PKG' && s.n2.pkg === 'TRIPPED') s.n2.pkg = 'STOPPED';
      else if (s.pumps[id] === 'TRIPPED') s.pumps[id] = 'STOPPED';
      if (ok) logEvt('OP', id + ' trip reset');
      return { ok: ok, msg: msg };
    }
    function resetESD() {
      var t = P.tagTable, blockers = [];
      fgsActive().forEach(function (x) { blockers.push(x + ' detection still active (clear the hazard first)'); });
      if (t['PT-001'].v >= 14.5) blockers.push('V-001 pressure still high');
      if (t['LT-001'].v >= 88) blockers.push('V-001 level still high');
      if (t['PT-101'].v >= 8.0) blockers.push('V-100 pressure still high');
      if (t['LT-101'].v >= 88) blockers.push('V-100 level still high');
      if (t['LT-103'].v >= 90) blockers.push('HT-200 level still high');
      if (t['PT-401'].v >= 1.2) blockers.push('Flare header pressure still high');
      if (t['LT-401'].v >= 80) blockers.push('FKOD level still high');
      if (t['LT-201'].v >= 93) blockers.push('TK-410 level still high');
      if (blockers.length) return { ok: false, msg: blockers[0] };
      s.esd.level = 0; s.esd.causes = []; s.esd.reset = true; s.bdv = false;
      logEvt('ESD', 'ESD/PSD reset by operator');
      return { ok: true, msg: '' };
    }

    // ---- simulation control
    P.advance = function (simSeconds) { var n = Math.round(simSeconds / C.dt); for (var i = 0; i < n; i++) step(C.dt); computeTags(); };
    P.reset = function (mode) { initState(mode || 'normal'); if (!mode || mode === 'normal') settle(); };
    P.tag = function (t) { return P.tagTable[t]; };
    P.tags = function () { return Object.keys(P.tagTable).map(function (k) { return P.tagTable[k]; }); };
    P.activeAlarms = function () {
      return Object.keys(P.alarms).map(function (k) { return P.alarms[k]; }).filter(function (a) { return a.state !== 'NORMAL' && a.state !== 'SHELVED'; })
        .sort(function (a, b) { return a.pr - b.pr || b.since - a.since; });
    };
    P.FG_ZONES = FG_ZONES; P.FG_TYPES = FG_TYPES; P.FG_KEYS = FG_KEYS; P.EFFECTS = EFFECTS; P.fgsActive = fgsActive;
    P.CE = function () {
      var rows = [];
      CAUSES.forEach(function (c) { rows.push({ id: c[0], tag: c[1], desc: c[2], level: c[3], kind: 'process', vote: '1oo1', byp: s.ceByp[c[0]] !== undefined, active: c[4](P.tagTable, s) }); });
      FG_ZONES.forEach(function (zz) { FG_KEYS.forEach(function (k) { var r = s.fgs.z[zz[0]][k]; rows.push({ id: (k === 'fire' ? 'FF' : k === 'gas' ? 'GHH' : 'SHH') + '-' + zz[0], tag: FG_TYPES[k].pre + '-' + zz[0], desc: FG_TYPES[k].name + ' confirmed in ' + zz[0] + ' (' + zz[1] + ')', level: 2, kind: 'fg', vote: r.vote, byp: false, active: r.conf }); }); });
      rows.push({ id: 'PSD-PB', tag: 'HS-PSD', desc: 'Manual PSD pushbutton', level: 1, kind: 'manual', vote: '1oo1', active: false }, { id: 'ESD-PB', tag: 'HS-ESD', desc: 'Manual ESD-1 pushbutton', level: 2, kind: 'manual', vote: '1oo1', active: false });
      return rows;
    };
    P.ALARM_DEFS = ALARM_DEFS; P.LOOP_DEFS = LOOP_DEFS; P.HAND = HAND;
    P.snapshot = function () { return JSON.stringify({ s: s, loops: P.loops, alarms: P.alarms, kpi: P.kpi }); };
    P.restore = function (str) { var o = JSON.parse(str); if (!o.s || !o.s.gen || !o.s.ptw || !o.s.chem) throw new Error('Old save format'); s = P.s = o.s; P.loops = o.loops; P.alarms = o.alarms; P.kpi = o.kpi; computeTags(); };

    initState('normal');
    if (!U.noSettle) settle();
    return P;
  }

  // ------------------------------------------------------------------ scenarios
  function buildScenarios() {
    function holdFor(sc, key, secs, el, cond) {
      var h = sc.hold; if (cond) { if (h[key] === undefined) h[key] = el; return (el - h[key]) >= secs; } h[key] = undefined; return false;
    }
    return [
      { id: 'normal-ops', title: 'Free operation', difficulty: 'Basic', duration: 7200, init: 'normal',
        desc: 'Steady-state plant, no scripted events. Explore the P&ID, trend, and adjust set-points.',
        brief: 'The plant is at normal throughput. Hold all levels, pressures, temperatures and crude quality in spec for 30 minutes.',
        events: [],
        objectives: [{ text: 'Keep all P1 alarms clear for 30 min', check: function (P, s, el) { return el > 1800 && P.kpi.alarmSecP1 < 1; } }] },
      { id: 'slug-arrival', title: 'Slug arrival at the slug catcher', difficulty: 'Intermediate', duration: 1500, init: 'normal',
        desc: 'A liquid slug arrives from the wells. Use V-001 as a buffer and protect the downstream train.',
        brief: 'At t+1 min a liquid slug (+140%) enters V-001 for 4 minutes. AUTO control pushes the slug straight into V-100. Take LIC-001 to manual (about 40%) so V-001 absorbs it, open LIC-002 (about 80%) to keep the water interface down, then return both to AUTO. Keep V-001 below 80% and V-100 below 60%.',
        events: [{ t: 60, msg: 'Slug detected at the inlet', run: function (P, s) { s.well.slug = 1.4; } }, { t: 300, msg: 'Slug passed', run: function (P, s) { s.well.slug = 0; } }],
        objectives: [
          { text: 'No PSD/ESD during the slug', check: function (P, s, el) { return s.esd.level > 0 ? false : (el > 900 ? true : 'open'); } },
          { text: 'V-001 level stays below 80%', check: function (P, s, el) { return P.kpi.maxLsc >= 80 ? false : (el > 900 ? true : 'open'); } },
          { text: 'V-100 level stays below 60% (downstream protected)', check: function (P, s, el) { return P.kpi.maxL101 >= 60 ? false : (el > 900 ? true : 'open'); } }] },
      { id: 'high-wc-upset', title: 'High water cut upset', difficulty: 'Intermediate', duration: 2400, init: 'normal',
        desc: 'Water cut jumps from 35% to 60%. Protect the shipping tank from off-spec crude.',
        brief: 'Water cut rises by 25 points. Raise the demulsifier dose and heater treater temperature (TIC-102), watch the water interface controllers, and keep AUTO routing so off-spec crude diverts to slop TK-430.',
        events: [{ t: 60, msg: 'Water cut increased by 25 points', run: function (P, s) { s.well.wc = Math.min(0.8, s.well.wc + 0.25); } }],
        objectives: [
          { text: 'TK-410 BS&W stays below 0.5%', check: function (P, s, el) { return s.tank.bsw > 0.5 ? false : (el > 1500 ? true : 'open'); } },
          { text: 'Crude BS&W (AT-101) recovered below 0.25% by 25 min', check: function (P, s, el) { var v = P.tag('AT-101').v; return (v < 0.25 && el > 600) ? true : (el > 1500 ? false : 'open'); } },
          { text: 'Produced water tank TK-420 stays below 80%', check: function (P, s, el) { return P.kpi.maxWater >= 80 ? false : (el > 1500 ? true : 'open'); } }] },
      { id: 'transfer-pump-trip', title: 'Transfer pump P-101A trip', difficulty: 'Intermediate', duration: 1200, init: 'normal',
        desc: 'The duty transfer pump trips with standby auto-start disarmed.',
        brief: 'P-101A trips at t+30 s and the standby auto-start is in manual. HT-200 level will rise. Start P-101B, then re-arm auto-start, before HT-200 reaches the PSD level.',
        events: [{ t: 30, msg: 'P-101A tripped (motor overload); standby auto-start DISARMED', run: function (P, s) { s.auto['P-101'] = false; s.pumps['P-101A'] = 'TRIPPED'; } }],
        objectives: [
          { text: 'Start P-101B', check: function (P, s, el) { return s.pumps['P-101B'] === 'RUNNING' ? true : (el > 300 ? false : 'open'); } },
          { text: 'HT-200 level never reaches 88%', check: function (P, s, el) { return P.tag('LT-103').v >= 88 ? false : (el > 700 ? true : 'open'); } },
          { text: 'No PSD', check: function (P, s, el) { return P.kpi.psdCount > 0 ? false : (el > 700 ? true : 'open'); } }] },
      { id: 'heater-trip', title: 'Hot oil heater HO-1 trip', difficulty: 'Advanced', duration: 3000, init: 'normal',
        desc: 'The hot oil heater trips. Temperatures fall and crude goes off-spec.',
        brief: 'HO-1 trips on flame failure at t+30 s. V-210 and the stripping column lose heat; BS&W and RVP climb. Reset and relight HO-1, keep routing on AUTO, and keep TK-410 on spec.',
        events: [{ t: 30, msg: 'HO-1 flame failure trip', run: function (P, s) { s.ho.burner = 'TRIPPED'; } }],
        objectives: [
          { text: 'Relight HO-1 and have hot oil above 180 °C', check: function (P, s, el) { return s.ho.burner === 'ON' && s.ho.T > 180 ? true : (el > 1500 ? false : 'open'); } },
          { text: 'TK-410 BS&W stays below 0.5%', check: function (P, s, el) { return s.tank.bsw > 0.5 ? false : (el > 2400 ? true : 'open'); } },
          { text: 'Reboiler back above 115 °C by 40 min', check: function (P, s, el) { return s.col.Treb > 115 && el > 300 ? true : (el > 2400 ? false : 'open'); } }] },
      { id: 'column-bypass', title: 'Stripping column bypass left open', difficulty: 'Intermediate', duration: 2400, init: 'normal',
        desc: 'Manifold bypass gate valves GV-3 and GV-4 are found open. Un-stripped crude is reaching the tank.',
        brief: 'Manifold bypass valves GV-3 and GV-4 (around the stripping column C-101) are found 100% open after maintenance. RVP will rise. Close both, make sure crude is routed to slop while off-spec and recover RVP below spec.',
        events: [{ t: 30, msg: 'GV-3 / GV-4 (C-101 bypass) found fully open', run: function (P, s) { s.hv['GV-3'] = 100; s.hv['GV-4'] = 100; } }],
        objectives: [
          { text: 'Close GV-3 and GV-4', check: function (P, s, el) { return (s.hv['GV-3'] < 5 && s.hv['GV-4'] < 5) ? true : (el > 600 ? false : 'open'); } },
          { text: 'Crude RVP recovered below 10 psi', check: function (P, s, el) { return P.tag('AT-102').v < 10 && el > 200 ? true : (el > 1800 ? false : 'open'); } },
          { text: 'Keep off-spec crude out of TK-410 (RVP in tank feed below 10.3)', check: function (P, s, el) { return P.kpi.tankContamSec > 120 ? false : (el > 1500 ? true : 'open'); } }] },
      { id: 'instrument-air-failure', title: 'Instrument air failure', difficulty: 'Advanced', duration: 1500, init: 'normal',
        desc: 'IAC-A trips and a header leak drains instrument air; valves drift to fail-safe.',
        brief: 'IAC-A trips and the air header leaks. Valves will fail-safe below 3.5 barg. Start IAC-B quickly and stabilise the plant.',
        events: [{ t: 20, msg: 'IAC-A tripped; air header leak', run: function (P, s) { s.ia.A = 'STOPPED'; s.ia.leak = true; } },
                 { t: 330, msg: 'Air leak isolated', run: function (P, s) { s.ia.leak = false; } }],
        objectives: [
          { text: 'Start IAC-B', check: function (P, s, el) { return s.ia.B === 'RUNNING' ? true : (el > 400 ? false : 'open'); } },
          { text: 'Instrument air restored above 6 bar', check: function (P, s, el) { return s.ia.P > 6 && el > 60 ? true : (el > 900 ? false : 'open'); } },
          { text: 'No ESD-1', check: function (P, s, el) { return P.kpi.esdCount > 0 ? false : (el > 900 ? true : 'open'); } }] },
      { id: 'flare-fkod-upset', title: 'FKOD high level and flare pilot out', difficulty: 'Advanced', duration: 1800, init: 'normal',
        desc: 'The FKOD pump trips, condensate surges in, and the flare pilot goes out.',
        brief: 'P-401A trips with auto-start disarmed, a condensate surge fills V-401 and the flare pilot goes out. Start P-401B, keep FKOD below 75%, then re-ignite the pilot.',
        events: [{ t: 30, msg: 'P-401A tripped; auto-start DISARMED; condensate surge to V-401', run: function (P, s) { s.auto['P-401'] = false; s.pumps['P-401A'] = 'TRIPPED'; s.fk.surge = 4 * P.cfg.fkod.cap / 30; } },
                 { t: 60, msg: 'Flare pilot flame-out', run: function (P, s) { s.flare.pilot = 'OUT'; } },
                 { t: 420, msg: 'Condensate surge over', run: function (P, s) { s.fk.surge = 0; } }],
        objectives: [
          { text: 'Start FKOD pump P-401B', check: function (P, s, el) { return s.pumps['P-401B'] === 'RUNNING' ? true : (el > 300 ? false : 'open'); } },
          { text: 'FKOD level never reaches 75%', check: function (P, s, el) { return P.kpi.maxLfk >= 75 ? false : (el > 900 ? true : 'open'); } },
          { text: 'Re-ignite the flare pilot', check: function (P, s, el) { return s.flare.pilot === 'ON' ? true : (el > 500 ? false : 'open'); } }] },
      { id: 'export-restriction', title: 'Export pump trip / pipeline restriction', difficulty: 'Intermediate', duration: 2400, init: 'normal',
        desc: 'P-201A trips and the pipeline operator cuts capacity. Avoid tank overfill.',
        brief: 'P-201A trips at t+30 s with auto-start off. Start P-201B and manage the shipping tank; pipeline capacity falls to 40%. Keep TK-410 below 93%.',
        events: [{ t: 30, msg: 'P-201A tripped (motor overload); standby auto-start DISARMED', run: function (P, s) { s.auto['P-201'] = false; s.pumps['P-201A'] = 'TRIPPED'; s.tank.v = Math.max(s.tank.v, 0.88 * P.cfg.tank.cap); } },
                 { t: 600, msg: 'Pipeline operator restricts to 40%', run: function (P, s) { s.pipe.avail = 0.4; } }],
        objectives: [
          { text: 'Start P-201B', check: function (P, s, el) { return s.pumps['P-201B'] === 'RUNNING' ? true : (el > 300 ? false : 'open'); } },
          { text: 'TK-410 stays below 95% (no PSD)', check: function (P, s, el) { return P.kpi.maxTankL >= 94.5 ? false : (el > 1500 ? true : 'open'); } }] },
      { id: 'gas-leak-esd', title: 'Gas leak in separation area (Z2): manual ESD-1', difficulty: 'Advanced', duration: 900, init: 'normal', expectESD: true,
        desc: 'Hydrocarbon gas builds up around V-100 / HT-200. Detectors rise slowly; make the call before 2oo2 confirmation.',
        brief: 'A gas release starts in zone Z2. GD-Z2-A/B rise; 20 %LEL gives a pre-alarm, 60 %LEL on both detectors auto-confirms ESD-1. Verify in the F&G panel, and press ESD-1 yourself before the auto action. Then confirm inlet closed, BDV open, pumps tripped, and silence the horn.',
        events: [{ t: 30, msg: 'Gas release in Z2', run: function (P, s) { P.fault('leak', 'Z2', { kind: 'gas', rate: 0.5 }); } }],
        objectives: [
          { text: 'Press manual ESD-1 before the gas auto-confirms', check: function (P, s, el) { if (s.esd.level === 2) return (s.esd.causes[0] || '').indexOf('Manual') === 0 ? true : false; return el > 500 ? false : 'open'; } },
          { text: 'Inlet ESDV-001 closed after ESD', check: function (P, s, el) { return s.esd.level === 2 && s.esdv.pos < 1 ? true : (el > 500 ? false : 'open'); } },
          { text: 'Silence the general alarm horn', check: function (P, s, el) { return s.esd.level === 2 && !s.horn ? true : (el > 600 ? false : 'open'); } }] },
      { id: 'h2s-leak-z1', title: 'H2S release at wellhead manifold (Z1)', difficulty: 'Advanced', duration: 900, init: 'normal', expectESD: true,
        desc: 'Sour gas leak at the inlet area. H2S detectors climb; ESD-1 on 2oo2 above 15 ppm.',
        brief: 'H2S is leaking at the inlet manifold. HS-Z1-A/B pre-alarm at 5 ppm. Treat it as a life-safety event: initiate ESD-1 before 15 ppm on both detectors, send the leak team, and keep the plant shut down until the zone is clear.',
        events: [{ t: 30, msg: 'H2S release in Z1', run: function (P, s) { P.fault('leak', 'Z1', { kind: 'h2s', rate: 0.1 }); } }],
        objectives: [
          { text: 'Initiate manual ESD-1 before 2oo2 H2S confirmation', check: function (P, s, el) { if (s.esd.level === 2) return (s.esd.causes[0] || '').indexOf('Manual') === 0 ? true : false; return el > 500 ? false : 'open'; } },
          { text: 'Leak isolation team dispatched to Z1', check: function (P, s, el) { return s.fgs.resp['Z1'] !== undefined || (el > 200 && s.fgs.src['Z1:h2s'] === undefined) ? true : (el > 400 ? false : 'open'); } },
          { text: 'Plant not restarted until H2S clears (no ESD reset while detectors high)', check: function (P, s, el) { return (s.esd.level === 0 && P.fgsActive().length > 0) ? false : (el > 800 ? true : 'open'); } }] },
      { id: 'fire-z3', title: 'Fire at the air cooler (Z3): ESD-1 and emergency response', difficulty: 'Advanced', duration: 1200, init: 'normal', expectESD: true,
        desc: 'Flame detection in the cooler/stripper area confirms and trips ESD-1.',
        brief: 'Fire in zone Z3. Flame detectors confirm 2oo2 and ESD-1 trips automatically. Verify the C&E effects (inlet closed, burners tripped, pumps tripped, BDV open), silence the horn, dispatch the fire team and reset only after the fire is out.',
        events: [{ t: 30, msg: 'Fire in Z3', run: function (P, s) { P.fault('fire', 'Z3'); } }],
        objectives: [
          { text: 'ESD-1 active within 60 s of fire', check: function (P, s, el) { return s.esd.level === 2 ? ((el - 30) <= 60) : (el > 120 ? false : 'open'); } },
          { text: 'BDV open and burners tripped (C&E verified)', check: function (P, s, el) { return (s.bdv && s.ho.burner !== 'ON' && s.ht.burner !== 'ON') ? true : (el > 200 ? false : 'open'); } },
          { text: 'Fire team dispatched to Z3', check: function (P, s, el) { return (el > 40 && (s.fgs.resp['Z3'] !== undefined || !s.fgs.fire['Z3'])) ? true : (el > 300 ? false : 'open'); } },
          { text: 'Horn silenced', check: function (P, s, el) { return !s.horn && s.esd.level === 2 ? true : (el > 400 ? false : 'open'); } }] },
      { id: 'spurious-detector', title: 'Spurious gas detector GD-Z3-A: verify, override, de-override', difficulty: 'Intermediate', duration: 1500, init: 'normal',
        desc: 'A gas detector reads high with no leak. Do not trip the plant; investigate and manage the override properly.',
        brief: 'GD-Z3-A shows high gas but there is no leak. 2oo2 voting holds the plant, but you are one failure from a trip. Send the field operator to Z3 to verify, then turn the inhibit key, override GD-Z3-A, remove the key. When the technician repairs it, DE-OVERRIDE the detector within 3 min.',
        events: [{ t: 30, msg: 'GD-Z3-A reads high: spurious', run: function (P, s) { P.fault('detector', 'GD-Z3-A', { kind: 'spike' }); } },
                 { t: 420, msg: 'Technician replaced GD-Z3-A (reading normal)', run: function (P, s) { s.fgs.det['GD-Z3-A'].fault = null; } }],
        objectives: [
          { text: 'Field check of zone Z3 done (confirm no leak)', check: function (P, s, el, sc) { var d = s.field.done['FG-Z3']; return (d !== undefined && d >= sc.t0) ? true : (el > 300 ? false : 'open'); } },
          { text: 'GD-Z3-A overridden using the inhibit key', check: function (P, s, el) { return s.fgs.ovr['GD-Z3-A'] !== undefined || el > 420 ? (s.fgs.ovr['GD-Z3-A'] !== undefined || P.kpi.ovrCount > 0) : 'open'; } },
          { text: 'No spurious ESD / PSD', check: function (P, s, el) { return (P.kpi.esdCount + P.kpi.psdCount) > 0 ? false : (el > 1200 ? true : 'open'); } },
          { text: 'Detector de-overridden within 3 min of repair', check: function (P, s, el) { if (el < 420) return 'open'; return (s.fgs.ovr['GD-Z3-A'] === undefined) ? true : (el > 600 ? false : 'open'); } }] },
      { id: 'n2-package-trip', title: 'N2 package trip: stripping column loses N2', difficulty: 'Intermediate', duration: 1800, init: 'normal',
        desc: 'Without N2 the stripping column cannot remove H2S and light ends. RVP and H2S in crude rise.',
        brief: 'The N2 package trips. Stripping gas to C-101 drops; RVP and H2S in the stripped crude climb. Make sure off-spec crude goes to slop, reset and restart the N2 package, and recover RVP below 10 psi and H2S below 12 ppm.',
        events: [{ t: 30, msg: 'N2 package tripped', run: function (P, s) { P.fault('n2'); } }],
        objectives: [
          { text: 'Restart N2 package within 6 min', check: function (P, s, el) { return (el > 40 && (s.n2.pkg === 'RUNNING' || s.n2.pkg === 'STARTING')) ? true : (el > 400 ? false : 'open'); } },
          { text: 'No off-spec crude into TK-410', check: function (P, s, el) { return P.kpi.tankContamSec > 120 ? false : (el > 1500 ? true : 'open'); } },
          { text: 'RVP below 10 psi and H2S below 12 ppm by 25 min', check: function (P, s, el) { return (P.tagTable['AT-102'].v < 10 && P.tagTable['AT-103'].v < 12 && el > 120) ? true : (el > 1500 ? false : 'open'); } }] },
      { id: 'tk410-vent-blocked', title: 'TK-410 cold vent blocked: PVRV lifting', difficulty: 'Intermediate', duration: 1200, init: 'normal',
        desc: 'The cold vent line to the LP flare is closed; TK-410 vapour pressure builds.',
        brief: 'VENT-410 is found closed after maintenance. TK-410 vapour pressure rises, the PVRV lifts to atmosphere and H2S shows up at the tank farm. Reopen the vent, check TK-410 locally and get pressure back to normal.',
        events: [{ t: 30, msg: 'VENT-410 found closed', run: function (P, s) { P.fault('vent'); } }],
        objectives: [
          { text: 'Field operator checks TK-410 vent', check: function (P, s, el, sc) { var d = s.field.done['TK410-VENT']; return (d !== undefined && d >= sc.t0) ? true : (el > 400 ? false : 'open'); } },
          { text: 'VENT-410 reopened within 5 min', check: function (P, s, el) { return (el > 40 && s.hv['VENT-410'] >= 50) ? true : (el > 330 ? false : 'open'); } },
          { text: 'No ESD', check: function (P, s, el) { return P.kpi.esdCount > 0 ? false : (el > 900 ? true : 'open'); } },
          { text: 'TK-410 pressure below 20 mbarg by 10 min', check: function (P, s, el) { return (P.tagTable['PT-410'].v < 20 && s.hv['VENT-410'] >= 50) ? true : (el > 800 ? false : 'open'); } }] },
      { id: 'cooler-bypass-open', title: 'Cooler bypass BV-CL left open', difficulty: 'Beginner', duration: 1200, init: 'normal',
        desc: 'Hot crude bypasses E-105 and reaches V-110.',
        brief: 'BV-CL (cooler bypass to V-110) is found open after a cooler cleaning. Hot crude enters V-110, gas and RVP rise. Close the bypass and bring TT-110 below 55 degC.',
        events: [{ t: 30, msg: 'BV-CL found open', run: function (P, s) { s.hv['BV-CL'] = 100; } }],
        objectives: [
          { text: 'Close BV-CL', check: function (P, s, el) { return (el > 40 && s.hv['BV-CL'] < 5) ? true : (el > 400 ? false : 'open'); } },
          { text: 'V-110 inlet below 55 degC', check: function (P, s, el) { return (s.hv['BV-CL'] < 5 && P.tagTable['TT-110'].v < 55) ? true : (el > 1000 ? false : 'open'); } }] },
      { id: 'cold-startup', title: 'Cold start-up after shutdown', difficulty: 'Advanced', duration: 5400, init: 'cold', expectESD: true,
        desc: 'Plant is shut down and depressurised. Bring it back to stable on-spec export.',
        brief: 'Reset ESD, open ESDV-001, start HO-1 (needs fuel gas pressure from V-100 above 2.8 barg), then E-103 once HT-200 is above 20%, start P-101A, then export pump P-201A. Keep AUTO routing so off-spec crude goes to slop.',
        events: [],
        objectives: [
          { text: 'Reset ESD and open inlet ESDV-001', check: function (P, s, el) { return s.esd.level === 0 && s.esdv.pos > 99 ? true : (el > 600 ? false : 'open'); } },
          { text: 'HO-1 firing and hot oil above 140 °C', check: function (P, s, el) { return s.ho.burner === 'ON' && s.ho.T > 140 ? true : (el > 3600 ? false : 'open'); } },
          { text: 'E-103 firing and HT-200 above 70 °C', check: function (P, s, el) { return s.ht.burner === 'ON' && s.ht.T > 70 ? true : (el > 3000 ? false : 'open'); } },
          { text: 'Export > 300 m3/h on-spec for 5 min', check: function (P, s, el, sc) { return holdFor(sc, 'x', 300, el, s.exp.q > 300 && s.v103.b * 100 < 0.5) ? true : (el > 5000 ? false : 'open'); } }] }

      ,{ id: 'instrument-fault', title: 'Level transmitter LT-101 drifting', difficulty: 'Advanced', duration: 1800, init: 'normal',
        desc: 'The V-100 level transmitter slowly drifts low while the real level climbs.',
        brief: 'LT-101 starts to drift low. LIC-101 will believe the vessel is emptying and close LCV-101. Spot the problem (a field level check shows the real level), take LIC-101 to manual, then isolate and repair the transmitter under a permit.',
        events: [{ t: 30, msg: 'LT-101 output starts drifting', run: function (P, s) { P.fault('inst', 'LT-101', { mode: 'DRIFT', rate: -0.04 }); } }],
        objectives: [
          { text: 'Take LIC-101 to manual within 8 min', check: function (P, s, el) { return P.loops['LIC-101'].mode === 'MAN' ? true : (el > 510 ? false : 'open'); } },
          { text: 'True V-100 level never reaches 85%', check: function (P, s, el) { return P.tag('LT-101').tv >= 85 ? false : (el > 1500 ? true : 'open'); } },
          { text: 'Transmitter repaired under a permit', check: function (P, s, el) { return (el > 60 && !s.inst['LT-101']) ? true : (el > 1700 ? false : 'open'); } }] }
      ,{ id: 'stuck-valve', title: 'Level control valve LCV-103 stuck', difficulty: 'Advanced', duration: 1800, init: 'normal',
        desc: 'LCV-103 sticks in position while the wells produce more.',
        brief: 'LCV-103 on HT-200 is stuck at its current position and production rises 15%. HT-200 level will climb. Choke back the wells, then isolate the valve under a permit, have it repaired and bring production back.',
        events: [{ t: 30, msg: 'LCV-103 stuck; wells producing 15% more', run: function (P, s) { P.fault('valve', 'LCV-103'); s.well.liquidRate *= 1.15; } }],
        objectives: [
          { text: 'Choke back production within 5 min', check: function (P, s, el) { var sum = 0; for (var k in s.wells) if (s.wells[k].open) sum += s.wells[k].choke; return sum < 285 ? true : (el > 330 ? false : 'open'); } },
          { text: 'HT-200 level stays below 88%', check: function (P, s, el) { return P.tag('LT-103').tv >= 88 ? false : (el > 1500 ? true : 'open'); } },
          { text: 'LCV-103 repaired under a permit', check: function (P, s, el) { return (el > 60 && !s.valves['LCV-103'].stuck) ? true : (el > 1700 ? false : 'open'); } }] }
      ,{ id: 'foaming', title: 'Foaming in V-100', difficulty: 'Intermediate', duration: 1800, init: 'normal',
        desc: 'Foam builds in the first stage separator and carries liquid to the gas line.',
        brief: 'Foam appears in V-100: the level reading is unreliable and liquid is carried to the FKOD and the oil. Raise the antifoam dose (V-100 chemical injection) to at least 12 ppm, keep the FKOD below 60% and recover crude BS&W.',
        events: [{ t: 30, msg: 'Foam detected in V-100', run: function (P, s) { P.fault('foam', null, { v: 0.8 }); s.chem.af = 5; } }],
        objectives: [
          { text: 'Antifoam dose raised to 12 ppm or more within 10 min', check: function (P, s, el) { return s.chem.af >= 12 ? true : (el > 630 ? false : 'open'); } },
          { text: 'FKOD level stays below 60%', check: function (P, s, el) { return P.tag('LT-401').tv >= 60 ? false : (el > 1500 ? true : 'open'); } },
          { text: 'Crude BS&W (AT-101) back below 0.3% by 25 min', check: function (P, s, el) { return (P.tag('AT-101').v < 0.3 && el > 400) ? true : (el > 1500 ? false : 'open'); } }] }
      ,{ id: 'pump-seal-leak', title: 'P-101A mechanical seal leak', difficulty: 'Intermediate', duration: 1500, init: 'normal',
        desc: 'The duty transfer pump develops a growing seal leak.',
        brief: 'P-101A seal is leaking and getting worse; the pump will trip on vibration in about 10 min. Change over to P-101B (start it, then stop P-101A), isolate P-101A under a permit, let maintenance finish and close the permit.',
        events: [{ t: 30, msg: 'P-101A seal leak starts', run: function (P, s) { P.fault('pump', 'P-101A', { kind: 'seal', rate: 1 / 600 }); } }],
        objectives: [
          { text: 'Change over to P-101B before P-101A trips', check: function (P, s, el) { if (s.pumps['P-101A'] === 'TRIPPED') return false; return (s.pumps['P-101B'] === 'RUNNING' && s.pumps['P-101A'] !== 'RUNNING') ? true : (el > 700 ? false : 'open'); } },
          { text: 'Permit issued on P-101A', check: function (P, s, el) { return (s.ptw['P-101A'] || s.pf['P-101A'].sealRate === 0) ? true : (el > 900 ? false : 'open'); } },
          { text: 'Seal repaired and permit closed', check: function (P, s, el) { return (el > 60 && s.pf['P-101A'].sealRate === 0 && !s.ptw['P-101A']) ? true : (el > 1400 ? false : 'open'); } }] }
      ,{ id: 'generator-trip', title: 'Generator G-1 trip and load shed', difficulty: 'Advanced', duration: 1500, init: 'normal',
        desc: 'One of the two running generators trips; non-essential pumps are shed.',
        brief: 'G-1 trips; G-2 alone cannot carry the load and the system sheds P-301A/B and P-501. Reset the G-1 trip, restart G-1 (60 s run-up), reset the load shedding once capacity is back and restart disposal pump P-301A. Avoid a blackout.',
        events: [{ t: 30, msg: 'G-1 tripped', run: function (P, s) { P.fault('gen', 'G-1'); } }],
        objectives: [
          { text: 'Restart G-1 within 5 min', check: function (P, s, el) { return (s.gen['G-1'] === 'RUNNING' || s.gen['G-1'] === 'STARTING') ? true : (el > 330 ? false : 'open'); } },
          { text: 'No blackout', check: function (P, s, el) { return !s.power.on ? false : (el > 900 ? true : 'open'); } },
          { text: 'Load shed reset and P-301A running within 15 min', check: function (P, s, el) { return (!s.power.shed && s.pumps['P-301A'] === 'RUNNING') ? true : (el > 930 ? false : 'open'); } }] }
      ,{ id: 'lact-meter-drift', title: 'LACT meter factor out of tolerance', difficulty: 'Intermediate', duration: 1200, init: 'normal',
        desc: 'The custody-transfer meter has drifted and must be proved.',
        brief: 'The LACT meter factor has drifted 0.6%. Run the meter prover, then pull a composite sample for the lab. Custody transfer accuracy matters.',
        events: [{ t: 30, msg: 'LACT prove-due alarm: meter factor out of tolerance', run: function (P, s) { P.fault('lact', null, { v: 1.006 }); } }],
        objectives: [
          { text: 'Run the meter prover', check: function (P, s, el, sc) { return s.lact.lastProve > sc.t0 ? true : (el > 900 ? false : 'open'); } },
          { text: 'Meter error back within 0.1%', check: function (P, s, el, sc) { return (s.lact.lastProve > sc.t0 && Math.abs(s.lact.dev) < 0.001) ? true : (el > 1100 ? false : 'open'); } },
          { text: 'Take a LACT composite sample', check: function (P, s, el, sc) { var d = s.field.done['LACT-SAMP']; return (d !== undefined && d >= sc.t0) ? true : (el > 1100 ? false : 'open'); } }] }
      ,{ id: 'hydrocyclone-fouling', title: 'Hydrocyclone fouling, oil in water high', difficulty: 'Intermediate', duration: 1800, init: 'normal',
        desc: 'Water treatment efficiency collapses and oil carries over into TK-420.',
        brief: 'The produced water hydrocyclone is fouled and oil-in-water (AT-301) is rising. Start a hydrocyclone backwash, skim TK-420 and get AT-301 below 40 ppm before disposal limits are broken.',
        events: [{ t: 30, msg: 'Hydrocyclone efficiency falls', run: function (P, s) { P.fault('hc', null, { v: 0.4 }); } }],
        objectives: [
          { text: 'Start the hydrocyclone backwash within 10 min', check: function (P, s, el) { return (s.wt.back > 0 || s.wt.eff > 0.6) ? true : (el > 630 ? false : 'open'); } },
          { text: 'Oil in water (AT-301) below 40 ppm by 25 min', check: function (P, s, el) { return (P.tag('AT-301').v < 40 && el > 400) ? true : (el > 1500 ? false : 'open'); } }] }
    ];
  }

  return { createPlant: createPlant, DEFAULTS: DEFAULTS, ALARM_DEFS: ALARM_DEFS, LOOP_DEFS: LOOP_DEFS, VALVES: VALVES, HAND: HAND };
});
