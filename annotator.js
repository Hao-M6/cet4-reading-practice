/* 原文标注笔 v2 —— 自由画笔 + 划词高亮 + 橡皮 + 撤销
 * 画笔：在原文上按住拖动随手画（画圈、划线、打钩都行），松手自动保存
 * 高亮：选中一句话 → 点色板 → 整句涂色（适合标答案出处）
 * 橡皮：点一下就擦掉——画过的笔迹、涂过的高亮都能擦
 * 数据存在本机浏览器 localStorage，刷新/重开都还在
 */
(function () {
  'use strict';
  if (window.__umInit) return;
  window.__umInit = true;

  var PARA_SEL = 'p.para, p.txt';
  var HL = { y: ['#f6e27a', '#4a3a00'], g: ['#9ee493', '#123d12'], b: ['#9ec8f7', '#0b2b55'], p: ['#f7a8c8', '#4d0f28'] };
  var PEN = { y: '#ffd84d', g: '#6ee7a8', b: '#7cc4ff' };
  var KEY = 'cet4-marks::' + location.pathname;
  var PKEY = 'cet4-pen::' + location.pathname;

  var mode = 'select';   // select | pen | erase
  var color = 'y';
  var marks = [];        // [{p,s,e,c}]
  var strokes = [];      // [{p,c,w,pts:[[x,y]]}]
  var secs = [];         // [{el, cv, ctx, idx}]
  var pal = null, bar = null;
  var cur = null;        // 正在画的笔画
  var saveTimer = null;
  var armed = false, armTimer = null;

  /* ---------- 基础工具 ---------- */
  function paras() { return Array.prototype.slice.call(document.querySelectorAll(PARA_SEL)); }
  function uid(k) { return k === 'pen' ? PKEY : KEY; }
  function readJSON(k) {
    try { var raw = localStorage.getItem(k); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
  }
  function writeJSON(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {}
  }
  function saveMarks() { writeJSON(KEY, marks); }
  function saveStrokes() { clearTimeout(saveTimer); saveTimer = setTimeout(function () { writeJSON(PKEY, strokes); }, 250); }

  /* ---------- 高亮：字符偏移 ---------- */
  function offsetIn(root, node, offset) {
    var r = document.createRange();
    try { r.selectNodeContents(root); r.setEnd(node, offset); return r.toString().length; }
    catch (e) { return -1; }
  }

  function wrapRange(root, start, end, cid) {
    if (!(end > start)) return null;
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null, false);
    var pos = 0, node, startNode = null, endNode = null, so = 0, eo = 0;
    while ((node = walker.nextNode())) {
      var len = node.data.length;
      if (startNode === null && start < pos + len) { startNode = node; so = start - pos; }
      if (startNode !== null && pos + len >= end) { endNode = node; eo = end - pos; break; }
      pos += len;
    }
    if (!startNode || !endNode) return null;
    if (so < 0) so = 0;
    if (eo > endNode.data.length) eo = endNode.data.length;
    var range = document.createRange();
    try { range.setStart(startNode, so); range.setEnd(endNode, eo); } catch (e) { return null; }
    var span = document.createElement('span');
    span.className = 'um';
    span.setAttribute('data-c', cid);
    var col = HL[cid] || HL.y;
    span.style.backgroundColor = col[0];
    span.style.color = col[1];
    try { range.surroundContents(span); }
    catch (e1) {
      try { span.appendChild(range.extractContents()); range.insertNode(span); }
      catch (e2) { return null; }
    }
    return span;
  }

  function closestPara(node) {
    var el = node && node.nodeType === 1 ? node : (node ? node.parentElement : null);
    return el && el.closest ? el.closest(PARA_SEL) : null;
  }
  function nearestUm(node) {
    var el = node && node.nodeType === 1 ? node : (node ? node.parentElement : null);
    return el && el.closest ? el.closest('.um') : null;
  }
  function unwrap(el) {
    var parent = el.parentNode;
    if (!parent) return;
    while (el.firstChild) parent.insertBefore(el.firstChild, el);
    parent.removeChild(el);
    if (parent.normalize) parent.normalize();
  }

  function reserialize() {
    var arr = paras(), out = [];
    arr.forEach(function (p, pi) {
      var spans = p.querySelectorAll('.um');
      Array.prototype.forEach.call(spans, function (sp) {
        var text = sp.textContent;
        if (!text) return;
        var start = offsetIn(p, sp, 0);
        if (start < 0) { start = 0; }
        out.push({ p: pi, s: start, e: start + text.length, c: sp.getAttribute('data-c') || 'y' });
      });
    });
    marks = out;
    saveMarks();
  }

  function restoreMarks() {
    if (!marks.length) return;
    var arr = paras();
    marks.slice().sort(function (a, b) { return (a.p - b.p) || (a.s - b.s); }).forEach(function (m) {
      var p = arr[m.p];
      if (!p) return;
      var len = p.textContent.length;
      if (m.e > len || m.s >= len) return;
      wrapRange(p, m.s, Math.min(m.e, len), m.c);
    });
  }

  /* ---------- 画笔：每段一个画布 ---------- */
  function buildCanvases() {
    var map = new Map();
    paras().forEach(function (p) {
      var sec = p.parentElement;
      if (!sec || sec === document.body) return;
      if (!map.has(sec)) map.set(sec, map.size);
    });
    map.forEach(function (idx, sec) {
      if (getComputedStyle(sec).position === 'static') sec.style.position = 'relative';
      sec.classList.add('um-sec');
      var cv = document.createElement('canvas');
      cv.className = 'um-canvas';
      cv.setAttribute('data-i', idx);
      sec.appendChild(cv);
      var rec = { el: sec, cv: cv, ctx: cv.getContext('2d'), idx: idx };
      secs.push(rec);
      bindPen(rec);
      fit(rec);
    });
  }

  function fit(rec) {
    var r = rec.el.getBoundingClientRect();
    var dpr = window.devicePixelRatio || 1;
    rec.cv.width = Math.max(1, Math.round(r.width * dpr));
    rec.cv.height = Math.max(1, Math.round(r.height * dpr));
    rec.cv.style.width = Math.round(r.width) + 'px';
    rec.cv.style.height = Math.round(r.height) + 'px';
    rec.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    rec.ctx.lineCap = 'round';
    rec.ctx.lineJoin = 'round';
    drawSection(rec);
  }

  function fitAll() { secs.forEach(fit); }

  function ptsOf(s) { return s.pts || s.p || []; }

  function drawSection(rec) {
    var ctx = rec.ctx;
    ctx.clearRect(0, 0, rec.cv.width, rec.cv.height);
    strokes.forEach(function (s) {
      if (s.p !== rec.idx) return;
      var pts = s.pts;
      if (!pts || !pts.length) return;
      ctx.beginPath();
      ctx.lineWidth = s.w || 3;
      ctx.strokeStyle = PEN[s.c] || PEN.y;
      if (pts.length === 1) {
        ctx.arc(pts[0][0], pts[0][1], (s.w || 3) / 2, 0, Math.PI * 2);
        ctx.fillStyle = PEN[s.c] || PEN.y;
        ctx.fill();
        return;
      }
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
      ctx.stroke();
    });
    if (cur && cur.p === rec.idx && cur.pts.length) {
      ctx.beginPath();
      ctx.lineWidth = cur.w;
      ctx.strokeStyle = PEN[cur.c] || PEN.y;
      ctx.moveTo(cur.pts[0][0], cur.pts[0][1]);
      for (var j = 1; j < cur.pts.length; j++) ctx.lineTo(cur.pts[j][0], cur.pts[j][1]);
      ctx.stroke();
    }
  }

  function toLocal(rec, e) {
    var r = rec.cv.getBoundingClientRect();
    return [Math.round((e.clientX - r.left) * 10) / 10, Math.round((e.clientY - r.top) * 10) / 10];
  }

  function bindPen(rec) {
    rec.cv.addEventListener('pointerdown', function (e) {
      if (mode !== 'pen') return;
      e.preventDefault();
      e.stopPropagation();
      try { rec.cv.setPointerCapture(e.pointerId); } catch (err) {}
      cur = { p: rec.idx, c: color, w: 3, pts: [toLocal(rec, e)] };
      drawSection(rec);
    });
    rec.cv.addEventListener('pointermove', function (e) {
      if (!cur || mode !== 'pen') return;
      e.preventDefault();
      e.stopPropagation();
      var p = toLocal(rec, e);
      var last = cur.pts[cur.pts.length - 1];
      if (Math.abs(p[0] - last[0]) + Math.abs(p[1] - last[1]) < 1.2) return;
      cur.pts.push(p);
      drawSection(rec);
    });
    function finish(e) {
      if (!cur || mode !== 'pen') return;
      if (e) { try { rec.cv.releasePointerCapture(e.pointerId); } catch (err) {} }
      if (cur.pts.length) { strokes.push(cur); writeJSON(PKEY, strokes); }
      cur = null;
      drawSection(rec);
    }
    rec.cv.addEventListener('pointerup', finish);
    rec.cv.addEventListener('pointercancel', finish);
    rec.cv.addEventListener('pointerleave', function (e) { if (cur && e.buttons === 0) finish(e); });
  }

  /* ---------- 橡皮 ---------- */
  function distToSeg(px, py, a, b) {
    var vx = b[0] - a[0], vy = b[1] - a[1];
    var wx = px - a[0], wy = py - a[1];
    var len2 = vx * vx + vy * vy;
    var t = len2 ? (wx * vx + wy * vy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    var dx = px - (a[0] + t * vx), dy = py - (a[1] + t * vy);
    return Math.sqrt(dx * dx + dy * dy);
  }

  function eraseAt(rec, pt) {
    for (var i = strokes.length - 1; i >= 0; i--) {
      var s = strokes[i];
      if (s.p !== rec.idx) continue;
      var pts = s.pts, hit = false;
      var tol = Math.max(9, (s.w || 3) + 6);
      if (pts.length === 1) {
        hit = Math.hypot(pt[0] - pts[0][0], pt[1] - pts[0][1]) < tol;
      } else {
        for (var k = 1; k < pts.length; k++) {
          if (distToSeg(pt[0], pt[1], pts[k - 1], pts[k]) < tol) { hit = true; break; }
        }
      }
      if (hit) {
        strokes.splice(i, 1);
        writeJSON(PKEY, strokes);
        drawSection(rec);
        return true;
      }
    }
    return false;
  }

  /* ---------- 划词高亮 ---------- */
  function selectionInfo() {
    var sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
    var range = sel.getRangeAt(0);
    var text = sel.toString();
    if (!text || !text.trim()) return null;
    var p = closestPara(range.commonAncestorContainer);
    if (!p) return null;
    try {
      var frag = range.cloneContents();
      if (frag.querySelector && frag.querySelector('select, input, button, canvas')) return null;
    } catch (e) {}
    return { sel: sel, range: range, text: text, p: p };
  }

  function hidePalette() { if (pal) pal.style.display = 'none'; }

  function placePalette(rect) {
    if (!pal) return;
    pal.style.display = 'flex';
    var pw = pal.offsetWidth || 170, ph = pal.offsetHeight || 44;
    var top = rect.top - ph - 10;
    if (top < 8) top = rect.bottom + 10;
    if (top + ph > window.innerHeight - 8) top = window.innerHeight - ph - 8;
    var left = rect.left + rect.width / 2 - pw / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - pw - 8));
    pal.style.top = top + 'px';
    pal.style.left = left + 'px';
  }

  function applyColor(cid) {
    var info = selectionInfo();
    if (!info) { hidePalette(); return; }
    var arr = paras(), pi = arr.indexOf(info.p);
    if (pi < 0) { hidePalette(); return; }
    var start = offsetIn(info.p, info.range.startContainer, info.range.startOffset);
    var end = offsetIn(info.p, info.range.endContainer, info.range.endOffset);
    if (start < 0) { hidePalette(); return; }
    if (!(end > start)) end = start + info.text.length;
    var len = info.p.textContent.length;
    if (end > len) end = len;
    if (!(end > start)) { hidePalette(); return; }
    if (wrapRange(info.p, start, end, cid)) {
      marks.push({ p: pi, s: start, e: end, c: cid });
      saveMarks();
    }
    info.sel.removeAllRanges();
    hidePalette();
  }

  /* ---------- 清空 / 撤销 ---------- */
  function clearAll() {
    var spans = Array.prototype.slice.call(document.querySelectorAll('.um'));
    spans.forEach(function (sp) { if (sp.parentNode) unwrap(sp); });
    marks = [];
    writeJSON(KEY, marks);
    strokes = [];
    writeJSON(PKEY, strokes);
    secs.forEach(drawSection);
    cur = null;
  }

  function undo() {
    if (cur) return;
    if (!strokes.length) return;
    var last = strokes.pop();
    writeJSON(PKEY, strokes);
    var rec = secs[last.p];
    if (rec) drawSection(rec);
  }

  /* ---------- UI ---------- */
  function buildUI() {
    var style = document.createElement('style');
    style.id = 'um-style';
    style.textContent = [
      '.um{border-radius:2px;padding:0 1px;-webkit-box-decoration-break:clone;box-decoration-break:clone}',
      '.um-canvas{position:absolute;left:0;top:0;pointer-events:none;z-index:3;touch-action:none}',
      'html.um-pen .um-canvas{pointer-events:auto;cursor:crosshair}',
      'html.um-erase .um-canvas{pointer-events:none}',
      'html.um-erase .um-sec{cursor:cell}',
      'html.um-off .um{background:transparent!important;color:inherit!important}',
      'html.um-off .um-canvas{display:none}',
      '#umBar{position:fixed;top:10px;right:10px;z-index:9998;display:flex;flex-wrap:wrap;justify-content:flex-end;gap:5px;max-width:260px;font-family:inherit}',
      '#umBar button{font:600 12px/1 system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;color:#e3e7ee;background:#1b2130;border:1px solid #313a4d;border-radius:999px;min-width:32px;height:32px;padding:0 9px;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.35)}',
      '#umBar button.on{background:#2b3a55;border-color:#5b9dff;color:#cfe3ff}',
      '#umBar button.arm{background:#7d2b2b;border-color:#f85149;color:#ffd7d3}',
      '#umBar button.um-dot{min-width:22px;width:22px;height:22px;border-radius:50%;border:2px solid #0f1216;padding:0;margin-top:5px}',
      '#umBar button.um-dot.on{outline:2px solid #cfe3ff;outline-offset:1px}',
      '#umPal{position:fixed;z-index:9999;display:none;align-items:center;gap:8px;background:#1b2130;border:1px solid #313a4d;border-radius:999px;padding:7px 10px;box-shadow:0 10px 28px rgba(0,0,0,.55)}',
      '#umPal button{width:26px;height:26px;border-radius:50%;border:2px solid #0f1216;cursor:pointer;padding:0}',
      '@media (max-width:640px){#umBar{max-width:200px}#umBar button{height:30px;min-width:30px}}'
    ].join('\n');
    (document.head || document.documentElement).appendChild(style);

    bar = document.createElement('div');
    bar.id = 'umBar';
    bar.innerHTML =
      '<button type="button" data-act="pen" title="画笔：按住拖动随手画">✏️</button>' +
      '<button type="button" data-act="erase" title="橡皮：点一下擦掉笔迹或高亮">🧽</button>' +
      '<button type="button" class="um-dot" data-color="y" title="黄色" style="background:' + PEN.y + '"></button>' +
      '<button type="button" class="um-dot" data-color="g" title="绿色" style="background:' + PEN.g + '"></button>' +
      '<button type="button" class="um-dot" data-color="b" title="蓝色" style="background:' + PEN.b + '"></button>' +
      '<button type="button" data-act="undo" title="撤销上一笔">↶</button>' +
      '<button type="button" data-act="clear" title="清空本页全部标记">🗑</button>' +
      '<button type="button" data-act="hide" title="显示/隐藏全部标记">👁</button>';
    (document.body || document.documentElement).appendChild(bar);

    bar.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || t.tagName !== 'BUTTON') return;
      e.preventDefault();
      e.stopPropagation();
      var act = t.getAttribute('data-act');
      var c = t.getAttribute('data-color');

      if (c) {
        color = c;
        Array.prototype.forEach.call(bar.querySelectorAll('.um-dot'), function (d) {
          d.classList.toggle('on', d.getAttribute('data-color') === c);
        });
        if (mode === 'erase') setMode('pen');
        return;
      }
      if (act === 'pen') setMode(mode === 'pen' ? 'select' : 'pen');
      else if (act === 'erase') setMode(mode === 'erase' ? 'select' : 'erase');
      else if (act === 'undo') undo();
      else if (act === 'clear') armClear(t);
      else if (act === 'hide') {
        var off = document.documentElement.classList.toggle('um-off');
        t.classList.toggle('on', off);
        t.textContent = off ? '🚫' : '👁';
      }
    });

    var dots = bar.querySelectorAll('.um-dot');
    Array.prototype.forEach.call(dots, function (d) { d.classList.toggle('on', d.getAttribute('data-color') === color); });

    pal = document.createElement('div');
    pal.id = 'umPal';
    ['y', 'g', 'b', 'p'].forEach(function (cid) {
      var b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('data-c', cid);
      b.style.background = HL[cid][0];
      b.title = '把这句话涂色';
      pal.appendChild(b);
    });
    (document.body || document.documentElement).appendChild(pal);

    pal.addEventListener('mousedown', function (e) { e.preventDefault(); e.stopPropagation(); });
    pal.addEventListener('touchstart', function (e) { e.stopPropagation(); }, { passive: true });
    pal.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      var t = e.target;
      if (t && t.getAttribute && t.getAttribute('data-c')) applyColor(t.getAttribute('data-c'));
    });

    var timer = null, lastTouch = 0;
    document.addEventListener('touchstart', function () { lastTouch = Date.now(); }, { passive: true, capture: true });
    document.addEventListener('touchend', function () { lastTouch = Date.now(); }, { passive: true, capture: true });

    function schedule() {
      clearTimeout(timer);
      timer = setTimeout(function () {
        if (mode !== 'select') { hidePalette(); return; }
        var info = selectionInfo();
        if (!info) { hidePalette(); return; }
        placePalette(info.range.getBoundingClientRect());
      }, 160);
    }

    document.addEventListener('selectionchange', schedule);
    document.addEventListener('mouseup', schedule);
    document.addEventListener('touchend', function () { setTimeout(schedule, 80); }, { passive: true });
    window.addEventListener('scroll', hidePalette, { passive: true });
    window.addEventListener('resize', function () { hidePalette(); clearTimeout(window.__umFit); window.__umFit = setTimeout(fitAll, 200); });
    document.addEventListener('mousedown', function (e) {
      if (pal.contains(e.target) || bar.contains(e.target)) return;
      if (Date.now() - lastTouch < 700) return;
      var sel = window.getSelection();
      if (sel && !sel.isCollapsed) return;
      hidePalette();
    });

    /* 橡皮：点高亮直接去掉，点笔迹按坐标命中 */
    document.addEventListener('pointerdown', function (e) {
      if (mode !== 'erase') return;
      var t = e.target;
      if (!t || !t.closest) return;
      if (bar.contains(t) || pal.contains(t)) return;
      var um = t.closest('.um');
      if (um) {
        e.preventDefault();
        e.stopPropagation();
        unwrap(um);
        reserialize();
        return;
      }
      var sec = t.closest('.um-sec');
      if (!sec) return;
      var rec = null;
      for (var i = 0; i < secs.length; i++) if (secs[i].el === sec) { rec = secs[i]; break; }
      if (!rec) return;
      var r = rec.cv.getBoundingClientRect();
      if (eraseAt(rec, [e.clientX - r.left, e.clientY - r.top])) {
        e.preventDefault();
        e.stopPropagation();
      }
    }, true);
  }

  function setMode(m) {
    mode = m;
    document.documentElement.classList.toggle('um-pen', m === 'pen');
    document.documentElement.classList.toggle('um-erase', m === 'erase');
    if (bar) {
      bar.querySelector('[data-act="pen"]').classList.toggle('on', m === 'pen');
      bar.querySelector('[data-act="erase"]').classList.toggle('on', m === 'erase');
    }
    if (m !== 'select') {
      hidePalette();
      var sel = window.getSelection();
      if (sel) sel.removeAllRanges();
    }
    if (m !== 'pen' && cur) { cur = null; secs.forEach(drawSection); }
  }

  function armClear(btn) {
    if (!armed) {
      armed = true;
      btn.classList.add('arm');
      btn.textContent = '确认?';
      clearTimeout(armTimer);
      armTimer = setTimeout(function () {
        armed = false;
        btn.classList.remove('arm');
        btn.textContent = '🗑';
      }, 2600);
      return;
    }
    armed = false;
    clearTimeout(armTimer);
    btn.classList.remove('arm');
    btn.textContent = '🗑';
    clearAll();
  }

  /* ---------- 启动 ---------- */
  function init() {
    var m = readJSON(KEY);
    marks = Array.isArray(m) ? m.filter(function (x) {
      return x && typeof x.p === 'number' && typeof x.s === 'number' && typeof x.e === 'number' && x.e > x.s;
    }) : [];
    var s = readJSON(PKEY);
    strokes = Array.isArray(s) ? s.filter(function (x) {
      return x && typeof x.p === 'number' && Array.isArray(x.pts) && x.pts.length;
    }) : [];

    buildCanvases();
    restoreMarks();
  }

  function boot() {
    init();
    buildUI();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  window.addEventListener('load', function () { setTimeout(fitAll, 120); });
})();
