/* Ops tab (procedures, permits, field operator, shift log) and Arabic UI option.
   Uses the helpers exported by app.js on window.__cpfUI. */
(function () {
  'use strict';
  var UI = window.__cpfUI; if (!UI) return;
  var h = UI.h, act = UI.act, plant = UI.plant, s = UI.s, clock = UI.clock, toast = UI.toast, $ = function (id) { return document.getElementById(id); };
  var sub = 'proc', sig = '', openAreas = {};
  var SUBS = [['proc', 'Procedures'], ['ptw', 'Permits'], ['field', 'Field'], ['log', 'Shift log']];
  var liveEls = [];

  function mark(done) { return done ? '✔ ' : '○ '; }
  function ptwText(k, w) {
    var left = Math.max(0, Math.ceil(300 - (s().t - w.t0)));
    return w.no + ' · ' + k + ' · ' + (w.ready ? 'READY TO CLOSE' : 'work in progress, ' + left + ' s');
  }

  function viewProc(root) {
    var ps = plant.procState();
    var p = h('div', { 'class': 'panel' }, [h('h3', { text: 'Operating procedures' })]);
    plant.procs().forEach(function (pr) {
      p.appendChild(h('div', { 'class': 'row' }, [h('span', { 'class': 'k', text: pr.title + ' (' + pr.n + ' steps)' }), h('button', { 'class': 'go', text: 'START', onclick: function () { act('proc', pr.id); sig = ''; render(true); } })]));
    });
    p.appendChild(h('p', { 'class': 'note', text: 'Pick a procedure, then carry it out on the plant. Each step ticks by itself, in order, when the plant reaches that state.' }));
    root.appendChild(p);
    if (ps) {
      var q = h('div', { 'class': 'panel' }, [h('h3', { text: ps.title + (ps.done ? ' - COMPLETE' : '') })]);
      ps.steps.forEach(function (st, i) { q.appendChild(h('div', { 'class': 'obj ' + (st.done ? 'done' : 'open'), text: mark(st.done) + (i + 1) + '. ' + st.text })); });
      q.appendChild(h('div', { 'class': 'ctl' }, [h('button', { text: 'STOP PROCEDURE', onclick: function () { act('procStop'); sig = ''; render(true); } })]));
      root.appendChild(q);
    }
  }

  function viewPtw(root) {
    var keys = Object.keys(s().ptw), p = h('div', { 'class': 'panel' }, [h('h3', { text: 'Permits to work and isolations (' + keys.length + ')' })]);
    if (!keys.length) p.appendChild(h('div', { 'class': 'row', text: 'No open permits' }));
    keys.forEach(function (k) {
      var w = s().ptw[k], lbl = h('span', { 'class': 'k', text: ptwText(k, w) }); liveEls.push(function () { lbl.textContent = ptwText(k, s().ptw[k] || w); });
      p.appendChild(h('div', { 'class': 'row' }, [lbl, h('button', { 'class': w.ready ? 'go' : '', text: w.ready ? 'CLOSE PERMIT' : 'CANCEL', onclick: function () { act('ptw', k, false); sig = ''; render(true); } })]));
    });
    root.appendChild(p);
    var ip = h('div', { 'class': 'panel' }, [h('h3', { text: 'Issue a permit' })]), sel = h('select', { id: 'ptwSel' });
    function grp(label, ids) { var g = h('optgroup', { label: label }); ids.forEach(function (i) { g.appendChild(h('option', { value: i, text: i })); }); sel.appendChild(g); }
    grp('Pumps', Object.keys(s().pumps)); grp('Burners and generators', ['HO-1', 'E-103', 'G-1', 'G-2', 'G-3']); grp('Valves', Object.keys(s().valves));
    grp('Instruments', plant.tags().map(function (q) { return q.tag; }).filter(function (t) { return /^(LT|PT|TT|FT|AT)-/.test(t); }));
    ip.appendChild(h('div', { 'class': 'ctl' }, [sel, h('button', { 'class': 'primary', text: 'ISSUE PERMIT', onclick: function () { var r = act('ptw', sel.value, true); sig = ''; render(true); if (r && r.ok) toast('Permit issued on ' + sel.value); } })]));
    ip.appendChild(h('p', { 'class': 'note', text: 'Pumps, burners and generators must be stopped first. The item is locked off (LOTO) and cannot be started. Maintenance takes about 5 min; close the permit once it shows READY to return the equipment repaired. Cancelling early leaves the fault in place.' }));
    root.appendChild(ip);
  }

  function viewField(root) {
    var fc = s().field.cur, p = h('div', { 'class': 'panel' }, [h('h3', { text: 'Field operator' })]);
    var st = h('div', { 'class': 'row' }); var lab = h('span', { 'class': 'k', text: '' }); st.appendChild(lab); p.appendChild(st);
    liveEls.push(function () { var c = s().field.cur; lab.textContent = c ? 'On the way to ' + c.id + ': ' + Math.max(0, Math.ceil(c.dur - (s().t - c.t0))) + ' s' : 'Field operator available'; });
    var res = plant.log.filter(function (l) { return l.type === 'FIELD'; }).slice(0, 6);
    res.forEach(function (l) { p.appendChild(h('div', { 'class': 'logline', html: '<span class="FIELD">' + clock(l.t) + '</span> ' + l.text.replace(/</g, '&lt;') })); });
    p.appendChild(h('p', { 'class': 'note', text: 'Each field check takes 40 s of plant time. Local gauges show the true value: compare them with the DCS to catch a bad transmitter. Walk-downs find seal leaks and noisy bearings before the DCS does.' }));
    root.appendChild(p);
    var groups = {}; plant.fieldChecks().forEach(function (f) { (groups[f.area] = groups[f.area] || []).push(f); });
    Object.keys(groups).forEach(function (a) {
      var d = h('details', { 'class': 'panel' }); if (openAreas[a]) d.setAttribute('open', '');
      d.addEventListener('toggle', function () { openAreas[a] = d.open; });
      d.appendChild(h('summary', { text: a + ' (' + groups[a].filter(function (f) { return f.done; }).length + '/' + groups[a].length + ')' }));
      groups[a].forEach(function (f) { d.appendChild(h('div', { 'class': 'row' }, [h('span', { 'class': 'k', text: mark(f.done) + f.label }), (function () { var b = h('button', { text: 'SEND', onclick: function () { act('field', f.id); sig = ''; render(true); } }); if (fc) b.disabled = true; return b; })()])); });
      root.appendChild(d);
    });
  }

  function viewLog(root) {
    var p = h('div', { 'class': 'panel' }, [h('h3', { text: 'Shift log and handover' })]);
    var ta = h('textarea', { id: 'noteTxt', maxlength: '300', placeholder: 'Write a log entry (e.g. P-101A seal weeping, permit raised)' });
    p.appendChild(ta);
    p.appendChild(h('div', { 'class': 'ctl' }, [h('button', { 'class': 'primary', text: 'ADD NOTE', onclick: function () { if (ta.value.trim()) { act('note', null, ta.value); ta.value = ''; sig = ''; render(true); } } }), h('button', { text: 'HANDOVER', onclick: showHandover })]));
    s().notes.slice(0, 15).forEach(function (n) { p.appendChild(h('div', { 'class': 'logline', html: '<span class="OP">' + clock(n.t) + ' NOTE</span> ' + n.text.replace(/</g, '&lt;') })); });
    root.appendChild(p);
    var jp = h('div', { 'class': 'panel' }, [h('h3', { text: 'Journal' })]);
    plant.log.slice(0, 40).forEach(function (l) { jp.appendChild(h('div', { 'class': 'logline', html: '<span class="' + l.type + '">' + clock(l.t) + ' ' + l.type + '</span> ' + l.text.replace(/</g, '&lt;') })); });
    root.appendChild(jp);
  }
  function showHandover() {
    var txt = plant.handover();
    UI.showModal('<h3>Shift handover</h3><pre id="hoTxt" class="rpt"></pre><div class="ctl"><button class="primary" id="mOk">Close</button><button id="hoPrint">Print</button><button id="hoCopy">Copy text</button></div>', 'mOk');
    $('hoTxt').textContent = txt; $('hoPrint').onclick = function () { try { window.print(); } catch (e) { toast('Printing is not available here, use Copy text', true); } }; $('hoCopy').onclick = function () { UI.copyText(txt, 'Handover copied'); };
  }

  function signature() {
    var q = s();
    if (sub === 'proc') { var ps = plant.procState(); return 'p' + (ps ? ps.id + ps.steps.map(function (x) { return x.done ? 1 : 0; }).join('') : ''); }
    if (sub === 'ptw') return 'w' + Object.keys(q.ptw).map(function (k) { return k + (q.ptw[k].ready ? 1 : 0); }).join(',');
    if (sub === 'field') return 'f' + (q.field.cur ? q.field.cur.id : '') + Object.keys(q.field.done).length + plant.log.filter(function (l) { return l.type === 'FIELD'; }).length;
    return 'l' + q.notes.length;
  }
  function render(force) {
    var root = $('opsView'); if (!root) return;
    var sg = sub + signature(); if (!force && sg === sig) return; sig = sg; liveEls = [];
    var keepTop = root.parentNode.scrollTop; root.innerHTML = '';
    var seg = h('div', { 'class': 'seg' }); SUBS.forEach(function (x) { seg.appendChild(h('button', { 'class': sub === x[0] ? 'on' : '', text: x[1], onclick: function () { sub = x[0]; render(true); } })); });
    root.appendChild(seg);
    if (sub === 'proc') viewProc(root); else if (sub === 'ptw') viewPtw(root); else if (sub === 'field') viewField(root); else viewLog(root);
    root.parentNode.scrollTop = keepTop; applyLang(root);
  }
  UI.build.ops = function () { sig = ''; render(true); };
  UI.viewUpd.ops = function () { render(false); liveEls.forEach(function (f) { f(); }); };

  // ------------------------------------------------------------------ Arabic (interface chrome only)
  var AR = {
    'Overview': 'نظرة عامة', 'Control': 'التحكم', 'Alarms': 'الإنذارات', 'Trends': 'الاتجاهات', 'Safety': 'السلامة', 'Train': 'التدريب', 'Ops': 'العمليات',
    'ACKNOWLEDGE ALL': 'تأكيد الكل', 'ACK': 'تأكيد', 'SHELVE': 'تعليق', 'UNSHELVE': 'إلغاء التعليق', 'START': 'تشغيل', 'STOP': 'إيقاف', 'RESET TRIP': 'إعادة ضبط الفصل', 'ARM': 'تفعيل', 'DISARM': 'تعطيل', 'CLOSE': 'إغلاق', 'Close': 'إغلاق',
    'No active alarms': 'لا توجد إنذارات', 'Event journal': 'سجل الأحداث', 'Journal': 'السجل', 'Alarm management (ISA-18.2)': 'إدارة الإنذارات (ISA-18.2)',
    'Training scenarios': 'سيناريوهات التدريب', 'Instructor: inject faults': 'المدرب: إدخال أعطال', 'Session': 'الجلسة', 'Operator': 'المشغل', 'Score history': 'سجل النتائج', 'TRAINING REPORT': 'تقرير التدريب', 'Training report': 'تقرير التدريب',
    'Clear history': 'مسح السجل', 'Save': 'حفظ', 'Load': 'تحميل', 'Reset to normal operation': 'العودة إلى التشغيل الطبيعي', 'Cold shutdown state': 'حالة الإيقاف البارد', 'Print': 'طباعة', 'Copy text': 'نسخ النص', 'COPY CSV': 'نسخ CSV',
    'No completed scenarios yet': 'لا توجد سيناريوهات مكتملة بعد', 'Clear faults': 'مسح الأعطال',
    '10 min': '10 دقائق', '30 min': '30 دقيقة', '2 h': 'ساعتان', '12 h': '12 ساعة', '24 h': '24 ساعة', 'Trends (tap a tag to add/remove, max 5)': 'الاتجاهات (اضغط على وسم للإضافة أو الإزالة، حتى 5)',
    'Procedures': 'الإجراءات', 'Permits': 'التصاريح', 'Field': 'الميدان', 'Shift log': 'سجل الوردية', 'HANDOVER': 'تسليم الوردية', 'Shift handover': 'تسليم الوردية', 'ADD NOTE': 'إضافة ملاحظة', 'ISSUE PERMIT': 'إصدار تصريح', 'CANCEL': 'إلغاء', 'CLOSE PERMIT': 'إغلاق التصريح', 'SEND': 'إرسال',
    'Operating procedures': 'إجراءات التشغيل', 'Field operator': 'مشغل الميدان', 'Issue a permit': 'إصدار تصريح', 'STOP PROCEDURE': 'إيقاف الإجراء', 'No open permits': 'لا توجد تصاريح مفتوحة',
    'Plant start-up after shutdown': 'تشغيل المصنع بعد الإيقاف', 'Planned shutdown': 'إيقاف مخطط', 'Transfer pump changeover P-101A to P-101B': 'تبديل مضخة النقل من P-101A إلى P-101B', 'Isolate P-101A for maintenance': 'عزل P-101A للصيانة', 'HO-1 light-up': 'إشعال سخان HO-1',
    'Level': 'المستوى', 'Pressure': 'الضغط', 'Temperature': 'الحرارة', 'Rotating': 'المعدات الدوارة', 'Valves': 'الصمامات', 'Flare': 'الشعلة', 'Heaters': 'السخانات', 'Lab': 'المختبر', 'LACT': 'قياس المبيعات', 'Chemicals': 'الكيماويات',
    'RUNNING': 'يعمل', 'STOPPED': 'متوقف', 'TRIPPED': 'فصل', 'ON': 'يعمل', 'OFF': 'مطفأ', 'ARMED': 'مفعّل', 'MANUAL': 'يدوي', 'AUTO': 'آلي', 'OPEN': 'مفتوح', 'SHUT-IN': 'مغلق',
    'Basic': 'أساسي', 'Intermediate': 'متوسط', 'Advanced': 'متقدم',
    'Free operation': 'تشغيل حر', 'Slug arrival at the slug catcher': 'وصول سدادة سائلة إلى مصيدة السدادات', 'High water cut upset': 'ارتفاع نسبة الماء', 'Transfer pump P-101A trip': 'فصل مضخة النقل P-101A', 'Hot oil heater HO-1 trip': 'فصل سخان الزيت الساخن HO-1',
    'Stripping column bypass left open': 'ترك تجاوز عمود التجريد مفتوحا', 'Instrument air failure': 'انقطاع هواء الأجهزة', 'FKOD high level and flare pilot out': 'ارتفاع مستوى FKOD وانطفاء شعلة الإشعال', 'Export pump trip / pipeline restriction': 'فصل مضخة التصدير وتقييد خط الأنابيب',
    'Gas leak — ESD-1 response': 'تسرب غاز: الاستجابة لـ ESD-1', 'Cold start-up after shutdown': 'التشغيل البارد بعد الإيقاف', 'Level transmitter LT-101 drifting': 'انحراف مرسل المستوى LT-101', 'Level control valve LCV-103 stuck': 'انحشار صمام التحكم LCV-103', 'Foaming in V-101': 'تكوّن الرغوة في V-101',
    'P-101A mechanical seal leak': 'تسرب الإحكام الميكانيكي للمضخة P-101A', 'Generator G-1 trip and load shed': 'فصل المولد G-1 وتخفيف الأحمال', 'LACT meter factor out of tolerance': 'خروج معامل عداد LACT عن الحد المسموح', 'Hydrocyclone fouling, oil in water high': 'انسداد الهيدروسايكلون وارتفاع الزيت في الماء',
    'KPIs (since start)': 'المؤشرات (منذ البدء)', 'Exported crude': 'النفط المصدّر', 'Gas to flare': 'الغاز إلى الشعلة', 'Unlit-flare venting': 'تنفيس بلا إشعال', 'Off-spec crude': 'نفط خارج المواصفات', 'P1 alarm time': 'زمن إنذارات الأولوية 1',
    'Session saved': 'تم حفظ الجلسة', 'Session loaded': 'تم تحميل الجلسة'
  };
  var PAT = [[/^Active alarms \((\d+)\)$/, 'الإنذارات النشطة ($1)'], [/^Shelved alarms \((\d+)\)$/, 'الإنذارات المعلّقة ($1)'], [/^Permits to work and isolations \((\d+)\)$/, 'تصاريح العمل والعزل ($1)']];
  var lang = 'en', origTxt = new WeakMap(), origAttr = new WeakMap(), obs = null, busy = false;
  try { lang = localStorage.getItem('nf_cpf_lang') || 'en'; } catch (e) {}
  function trans(k) { if (AR[k]) return AR[k]; for (var i = 0; i < PAT.length; i++) if (PAT[i][0].test(k)) return k.replace(PAT[i][0], PAT[i][1]); return null; }
  function inSvg(n) { var e = n.nodeType === 3 ? n.parentNode : n; while (e && e.nodeType === 1) { if (e.nodeName.toLowerCase() === 'svg') return true; e = e.parentNode; } return false; }
  function xNode(n) {
    if (n.nodeType !== 3 || inSvg(n)) return;
    var v = n.nodeValue, k = v.trim(); if (!k) return;
    if (lang === 'ar') { var t = trans(k); if (t) { if (!origTxt.has(n)) origTxt.set(n, v); n.nodeValue = v.replace(k, t); } }
    else if (origTxt.has(n)) { n.nodeValue = origTxt.get(n); origTxt.delete(n); }
  }
  function xTree(root) {
    if (!root) return;
    var w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null, false), n, list = [];
    while ((n = w.nextNode())) list.push(n);
    list.forEach(xNode);
    if (root.querySelectorAll) Array.prototype.forEach.call(root.querySelectorAll('[placeholder]'), function (el) {
      var ph = el.getAttribute('placeholder'); if (lang === 'ar') { var PH = { 'Trainee name (for the report)': 'اسم المتدرب (للتقرير)', 'Write a log entry (e.g. P-101A seal weeping, permit raised)': 'اكتب ملاحظة في السجل' }; if (PH[ph]) { origAttr.set(el, ph); el.setAttribute('placeholder', PH[ph]); } } else if (origAttr.has(el)) { el.setAttribute('placeholder', origAttr.get(el)); origAttr.delete(el); }
    });
  }
  function applyLang(root) { if (lang === 'ar' || true) { busy = true; try { xTree(root || document.body); } finally { busy = false; } } }
  function setDir() {
    var d = lang === 'ar' ? 'rtl' : 'ltr';
    ['v-control', 'v-alarms', 'v-trends', 'v-safety', 'v-train', 'v-ops', 'sheet', 'modal'].forEach(function (id) { var e = $(id); if (e) e.setAttribute('dir', d); });
    document.documentElement.setAttribute('lang', lang);
  }
  function startObs() {
    if (obs) return;
    obs = new MutationObserver(function (muts) {
      if (busy) return; busy = true;
      try { muts.forEach(function (m) { if (m.type === 'characterData') xNode(m.target); else Array.prototype.forEach.call(m.addedNodes, function (nd) { if (nd.nodeType === 3) xNode(nd); else if (nd.nodeType === 1 && !inSvg(nd)) xTree(nd); }); }); } finally { busy = false; }
    });
    obs.observe(document.body, { childList: true, subtree: true, characterData: true });
  }
  function setLang(l) {
    lang = l; try { localStorage.setItem('nf_cpf_lang', l); } catch (e) {}
    setDir(); if (l === 'ar') startObs(); else if (obs) { obs.disconnect(); obs = null; }
    applyLang(document.body);
    toast(l === 'ar' ? 'تم التبديل إلى العربية (الواجهة فقط)' : 'English');
    var cur = document.querySelector('#tabs button.on'); if (cur) UI.tabTo(cur.getAttribute('data-v'));
  }
  UI.toggleLang = function () { setLang(lang === 'ar' ? 'en' : 'ar'); };
  if (lang === 'ar') { setDir(); startObs(); applyLang(document.body); }
})();
