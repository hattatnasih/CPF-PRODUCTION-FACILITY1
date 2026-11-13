#!/usr/bin/env node
/* Headless regression test for the HBJF engine.
 * usage: node scripts/headless_test.js [path/to/engine.js]
 * 1) steady state must hold for 1 h with no alarms at 600 m3/h, 35 % WC
 * 2) scaled configurations must start clean
 * 3) every scenario runs twice: idle operator (must score lower / fail objectives) and a scripted
 *    competent operator (must score >= 80). Exit code 1 if any check fails.
 */
const path = require('path');
const E = require(path.resolve(process.argv[2] || path.join(__dirname, '../www/js/engine.js')));
let failures = 0;
const ok = (c, m) => { console.log((c ? '  PASS ' : '  FAIL ') + m); if (!c) failures++; };
const BASE = { wells: { liquidRate: 600, waterCut: 0.35 }, tank: { cap: 6000 }, export: { setFlow: 450 } };

function runScenario(id, actor, maxT) {
  const p = E.createPlant(BASE); p.startScenario(id);
  const log = {};
  for (let t = 0; t < maxT && !p.scenario.done; t += 5) { actor && actor(p, p.s.t - p.scenario.t0, log); p.advance(5); }
  return p;
}
const at = (log, key, el, from, fn) => { if (el >= from && !log[key]) { log[key] = 1; fn(); } };

console.log('Steady state (1 h):');
{
  const p = E.createPlant(BASE); p.advance(3600);
  const T = (k) => p.tag(k).v;
  ok(Math.abs(T('PT-001') - 12) < 0.3, 'V-001 pressure ~12 barg (' + T('PT-001').toFixed(2) + ')');
  ok(Math.abs(T('LT-001') - 50) < 4 && Math.abs(T('LT-101') - 50) < 4 && Math.abs(T('LT-103') - 50) < 5, 'SC/V-100/HT-200 levels ~50%');
  ok(Math.abs(T('PT-101') - 6) < 0.2 && Math.abs(T('PT-102') - 2.5) < 0.2 && Math.abs(T('PT-104') - 1.2) < 0.15, 'V-100 / HT-200 / C-101 pressures on set-point');
  ok(Math.abs(T('TT-102') - 85) < 2 && Math.abs(T('TT-104') - 120) < 3 && Math.abs(T('TT-105') - 48) < 2, 'HT-200 85, reboiler 120, cooler out 48 degC');
  ok(T('AT-101') < 0.3, 'crude BS&W in spec (' + T('AT-101').toFixed(2) + '%)');
  ok(T('AT-102') < 10, 'RVP in spec (' + T('AT-102').toFixed(1) + ')');
  ok(Math.abs(T('FT-201') - 450) < 10, 'export 450 m3/h (' + T('FT-201').toFixed(0) + ')');
  ok(Math.abs(T('FT-001') - 600) < 15, 'inlet 600 m3/h (' + T('FT-001').toFixed(0) + ')');
  ok(p.activeAlarms().length === 0, 'no alarms at steady state (' + p.activeAlarms().map(a => a.id).join(',') + ')');
}

console.log('\nScaled facility configs (each must start clean and stay stable for 1 h):');
[['800 m3/h, 35% WC, GOR 90', { wells: { liquidRate: 800, waterCut: 0.35, gor: 90 } }],
 ['300 m3/h, 10% WC, GOR 40', { wells: { liquidRate: 300, waterCut: 0.10, gor: 40 } }],
 ['500 m3/h, 50% WC', { wells: { liquidRate: 500, waterCut: 0.5, gor: 50 } }]].forEach(([n, c]) => {
  const p = E.createPlant(c); p.advance(3600);
  const T = (k) => p.tag(k).v;
  ok(Math.abs(T('LT-001') - 50) < 5 && Math.abs(T('PT-001') - 12) < 0.4 && T('AT-101') < 0.4 && p.activeAlarms().length === 0,
     n + ' -> SC ' + T('LT-001').toFixed(0) + '%, ' + T('PT-001').toFixed(1) + ' barg, BSW ' + T('AT-101').toFixed(2) + '%, alarms: ' + (p.activeAlarms().map(a => a.id).join(',') || 'none'));
});

const cases = [
  ['slug-arrival', (p, el, l) => { at(l, 'a', el, 62, () => { p.cmd('setOP', 'LIC-001', 40); p.cmd('setOP', 'LIC-002', 80); }); at(l, 'b', el, 420, () => { ['LIC-001', 'LIC-002'].forEach(x => p.cmd('setMode', x, 'AUTO')); }); }, 1500],
  ['high-wc-upset', (p, el, l) => { at(l, 'a', el, 70, () => { p.cmd('dem', null, 50); p.cmd('setSP', 'TIC-102', 95); }); }, 2400],
  ['transfer-pump-trip', (p, el, l) => { at(l, 'a', el, 40, () => { p.cmd('start', 'P-101B'); p.cmd('auto', 'P-101', true); }); }, 1200],
  ['heater-trip', (p, el, l) => { at(l, 'a', el, 40, () => { p.cmd('resetTrip', 'HO-1'); p.cmd('start', 'HO-1'); }); }, 3000],
  ['column-bypass', (p, el, l) => { at(l, 'a', el, 60, () => { p.cmd('hv', 'GV-3', 0); p.cmd('hv', 'GV-4', 0); }); }, 2400],
  ['instrument-air-failure', (p, el, l) => { at(l, 'a', el, 40, () => p.cmd('iaStart', 'IAC-B')); }, 1500],
  ['flare-fkod-upset', (p, el, l) => { at(l, 'a', el, 40, () => { p.cmd('start', 'P-401B'); p.cmd('auto', 'P-401', true); }); at(l, 'b', el, 100, () => p.cmd('flareIgnite')); }, 1800],
  ['export-restriction', (p, el, l) => { at(l, 'a', el, 40, () => p.cmd('start', 'P-201B')); at(l, 'b', el, 620, () => p.cmd('setSP', 'FIC-201', 200)); }, 2400],
  ['gas-leak-esd', (p, el, l) => { at(l, 'a', el, 100, () => p.cmd('esd')); at(l, 'b', el, 130, () => p.cmd('hornReset')); }, 900],
  ['h2s-leak-z1', (p, el, l) => { at(l, 'a', el, 120, () => p.cmd('esd')); at(l, 'b', el, 140, () => p.cmd('hazardResp', 'Z1', 'leak')); }, 900],
  ['fire-z3', (p, el, l) => { at(l, 'a', el, 70, () => { p.cmd('hornReset'); p.cmd('hazardResp', 'Z3', 'fire'); }); }, 1200],
  ['spurious-detector', (p, el, l) => { at(l, 'a', el, 60, () => p.cmd('field', 'FG-Z3')); at(l, 'b', el, 120, () => { p.cmd('fgKey', null, true); p.cmd('fgOvr', 'GD-Z3-A', true); }); at(l, 'c', el, 150, () => p.cmd('fgKey', null, false)); at(l, 'd', el, 440, () => p.cmd('fgOvr', 'GD-Z3-A', false)); }, 1500],
  ['n2-package-trip', (p, el, l) => { at(l, 'a', el, 60, () => { p.cmd('resetTrip', 'N2-PKG'); p.cmd('start', 'N2-PKG'); }); }, 1800],
  ['tk410-vent-blocked', (p, el, l) => { at(l, 'a', el, 80, () => p.cmd('field', 'TK410-VENT')); at(l, 'b', el, 140, () => p.cmd('hv', 'VENT-410', 100)); }, 1200],
  ['cooler-bypass-open', (p, el, l) => { at(l, 'a', el, 90, () => p.cmd('hv', 'BV-CL', 0)); }, 1200],
  ['instrument-fault', (p, el, l) => { at(l, 'a', el, 120, () => p.cmd('setMode', 'LIC-101', 'MAN')); at(l, 'b', el, 150, () => p.cmd('ptw', 'LT-101', true)); at(l, 'c', el, 470, () => p.cmd('ptw', 'LT-101', false)); at(l, 'd', el, 480, () => p.cmd('setMode', 'LIC-101', 'AUTO')); }, 1800],
  ['stuck-valve', (p, el, l) => { at(l, 'a', el, 60, () => { p.cmd('choke', 'W-3', 40); p.cmd('choke', 'W-2', 60); }); at(l, 'b', el, 100, () => p.cmd('ptw', 'LCV-103', true)); at(l, 'c', el, 420, () => p.cmd('ptw', 'LCV-103', false)); at(l, 'd', el, 500, () => { p.cmd('choke', 'W-3', 100); p.cmd('choke', 'W-2', 100); }); }, 1800],
  ['foaming', (p, el, l) => { at(l, 'a', el, 60, () => p.cmd('chem', 'af', 14)); }, 1800],
  ['pump-seal-leak', (p, el, l) => { at(l, 'a', el, 100, () => p.cmd('start', 'P-101B')); at(l, 'b', el, 130, () => p.cmd('stop', 'P-101A')); at(l, 'c', el, 160, () => p.cmd('ptw', 'P-101A', true)); at(l, 'd', el, 480, () => p.cmd('ptw', 'P-101A', false)); }, 1500],
  ['generator-trip', (p, el, l) => { at(l, 'a', el, 40, () => { p.cmd('resetTrip', 'G-1'); p.cmd('start', 'G-1'); }); at(l, 'b', el, 125, () => { p.cmd('shedReset'); }); at(l, 'c', el, 135, () => p.cmd('start', 'P-301A')); }, 1500],
  ['lact-meter-drift', (p, el, l) => { at(l, 'a', el, 60, () => p.cmd('prove')); at(l, 'b', el, 300, () => p.cmd('lactSample')); }, 1200],
  ['hydrocyclone-fouling', (p, el, l) => { at(l, 'a', el, 60, () => { p.cmd('backwash'); p.cmd('skim'); }); }, 1800],
];
cases.forEach(([id, actor, maxT]) => {
  console.log('\nScenario ' + id + ':');
  const idle = runScenario(id, null, maxT), good = runScenario(id, actor, maxT);
  const si = idle.scenario.score, sg = good.scenario.score;
  console.log('  idle operator -> score ' + (si ? si.total : 'n/a (' + idle.scenario.status + ')') + (si && si.notes.length ? ' [' + si.notes.join('; ') + ']' : ''));
  console.log('  good operator -> score ' + (sg ? sg.total : 'n/a (' + good.scenario.status + ')') + (sg && sg.notes.length ? ' [' + sg.notes.join('; ') + ']' : ''));
  ok(sg && sg.total >= 80, 'competent operator scores >= 80');
  ok(!si || !sg || si.total < sg.total, 'idle operator scores lower than competent operator');
});

console.log('\nScenario cold-startup (scripted procedure):');
{
  const p = E.createPlant(BASE); p.startScenario('cold-startup'); const l = {};
  for (let t = 0; t < 5400 && !p.scenario.done; t += 5) {
    const el = p.s.t - p.scenario.t0;
    at(l, 'r', el, 10, () => p.cmd('resetESD'));
    at(l, 'o', el, 20, () => p.cmd('openInlet'));
    at(l, 'w', el, 30, () => { p.cmd('start', 'P-301A'); });
    if (el > 100 && !l.h && p.cmd('start', 'HO-1').ok) l.h = 1;
    if (el > 200 && !l.b && p.cmd('start', 'E-103').ok) l.b = 1;
    if (el > 300 && !l.p && p.tag('LT-103').v > 25 && p.cmd('start', 'P-101A').ok) l.p = 1;
    if (el > 400 && !l.e && p.tag('LT-201').v > 10 && p.cmd('start', 'P-201A').ok) l.e = 1;
    if (p.s.ho.burner === 'TRIPPED') p.cmd('resetTrip', 'HO-1');
    p.advance(5);
  }
  const sc = p.scenario;
  console.log('  status ' + sc.status.join(',') + ' score ' + (sc.score ? sc.score.total : 'n/a'));
  ok(sc.score && sc.score.total >= 60, 'scripted start-up completes with score >= 60');
}
console.log(failures ? '\n' + failures + ' CHECK(S) FAILED' : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
