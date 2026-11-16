/* 原文标注笔 —— 划词高亮 · 本地持久化 · 桌面/移动端通用
 * 适合 cet4 系列练习页（段落选择器 p.para / p.txt）
 * 用法：选中原文中的任意一句 → 点浮动色板 → 高亮记下答案出处
 */
(function () {
  'use strict';
  if (window.__umInit) return;
  window.__umInit = true;

  var PARA_SEL = 'p.para, p.txt';
  var COLORS = {
    y: { bg: '#f6e27a', ink: '#4a3a00' },
    g: { bg: '#9ee493', ink: '#123d12' },
    b: { bg: '#9ec8f7', ink: '#0b2b55' },
    p: { bg: '#f7a8c8', ink: '#4d0f28' }
  };
  var KEY = 'cet4-marks::' + location.pathname;
  var marks = [];   // [{p:段落序号, s:起始字符, e:结束字符, c:颜色}]
  var pal = null;
  var bar = null;

  function paras() {
    return Array.prototype.slice.call(document.querySelectorAll(PARA_SEL));
  }

  function loadMarks() {
    var raw = null;
    try { raw = localStorage.getItem(KEY); } catch (e) {}
    var arr = [];
    try { arr = raw ? JSON.parse(raw) : []; } catch (e) { arr = []; }
    if (!Array.isArray(arr)) arr = [];
    marks = arr.filter(function (m) {
      return m && typeof m.p === 'number' && typeof m.s === 'number' &&
             typeof m.e === 'number' && m.e > m.s;
    });
  }

  function saveMarks() {
    try { localStorage.setItem(KEY, JSON.stringify(marks)); } catch (e) {}
  }

  /* 把范围节点位置换算成「段落纯文本中的字符序号」 */
  function offsetIn(root, node, offset) {
    var r = document.createRange();
    try {
      r.selectNodeContents(root);
      r.setEnd(node, offset);
      return r.toString().length;
    } catch (e) { return -1; }
  }

  /* 在段落的纯文本坐标 [start,end) 上包一层高亮 span */
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
    try {
      range.setStart(startNode, so);
      range.setEnd(endNode, eo);
    } catch (e) { return null; }
    var span = document.createElement('span');
    span.className = 'um';
    span.setAttribute('data-c', cid);
    var c = COLORS[cid] || COLORS.y;
    span.style.backgroundColor = c.bg;
    span.style.color = c.ink;
    try {
      range.surroundContents(span);
    } catch (e1) {
      try {
        span.appendChild(range.extractContents());
        range.insertNode(span);
      } catch (e2) { return null; }
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

  /* 从 DOM 反推 marks（删除某处标记后重新保存） */
  function reserialize() {
    var arr = paras(), out = [];
    arr.forEach(function (p, pi) {
      var spans = p.querySelectorAll('.um');
      Array.prototype.forEach.call(spans, function (sp) {
        var text = sp.textContent;
        if (!text) return;
        var start = offsetIn(p, sp, 0);
        if (start < 0) {
          var r = document.createRange();
          try {
            r.selectNodeContents(p);
            r.setStartBefore(sp);
            start = r.toString().length;
          } catch (e) { return; }
        }
        out.push({ p: pi, s: start, e: start + text.length, c: sp.getAttribute('data-c') || 'y' });
      });
    });
    marks = out;
    saveMarks();
  }

  function restore() {
    if (!marks.length) return;
    var arr = paras();
    marks.slice().sort(function (a, b) { return (a.p - b.p) || (a.s - b.s); })
      .forEach(function (m) {
        var p = arr[m.p];
        if (p && p.textContent.length >= m.e) wrapRange(p, m.s, m.e, m.c);
      });
  }

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
      if (frag.querySelector && frag.querySelector('select, input, button')) return null;
    } catch (e) {}
    return { sel: sel, range: range, text: text, p: p };
  }

  function hidePalette() {
    if (pal) pal.style.display = 'none';
  }

  function placePalette(rect) {
    if (!pal) return;
    pal.style.display = 'flex';
    var pw = pal.offsetWidth || 200;
    var ph = pal.offsetHeight || 44;
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
    var arr = paras();
    var pi = arr.indexOf(info.p);
    if (pi < 0) return;
    var start = offsetIn(info.p, info.range.startContainer, info.range.startOffset);
    var end = offsetIn(info.p, info.range.endContainer, info.range.endOffset);
    if (start < 0) return;
    if (!(end > start)) end = start + info.text.length;
    if (end > info.p.textContent.length) end = info.p.textContent.length;
    if (!(end > start)) { hidePalette(); return; }
    if (wrapRange(info.p, start, end, cid)) {
      marks.push({ p: pi, s: start, e: end, c: cid });
      saveMarks();
    }
    info.sel.removeAllRanges();
    hidePalette();
  }

  function removeMark() {
    var info = selectionInfo();
    if (!info) { hidePalette(); return; }
    var um = nearestUm(info.range.startContainer) || nearestUm(info.range.endContainer);
    if (um) { unwrap(um); reserialize(); }
    info.sel.removeAllRanges();
    hidePalette();
  }

  function clearAll() {
    var spans = Array.prototype.slice.call(document.querySelectorAll('.um'));
    spans.forEach(function (sp) { if (sp.parentNode) unwrap(sp); });
    marks = [];
    saveMarks();
  }

  function buildUI() {
    var style = document.createElement('style');
    style.id = 'um-style';
    style.textContent = [
      '.um{border-radius:2px;padding:0 1px;-webkit-box-decoration-break:clone;box-decoration-break:clone}',
      'html.um-off .um{background:transparent!important;color:inherit!important}',
      '#umBar{position:fixed;top:12px;right:12px;z-index:9998;display:flex;gap:6px;font-family:inherit}',
      '#umBar button{font:600 12px/1 system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;color:#e3e7ee;background:#1b2130;border:1px solid #313a4d;border-radius:999px;padding:7px 11px;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.35)}',
      '#umBar button.on{background:#2b3a55;border-color:#5b9dff;color:#cfe3ff}',
      '#umBar button:active{transform:translateY(1px)}',
      '#umPal{position:fixed;z-index:9999;display:none;align-items:center;gap:8px;background:#1b2130;border:1px solid #313a4d;border-radius:999px;padding:7px 10px;box-shadow:0 10px 28px rgba(0,0,0,.55)}',
      '#umPal button{width:26px;height:26px;border-radius:50%;border:2px solid #0f1216;cursor:pointer;padding:0;line-height:0}',
      '#umPal button[data-act="del"]{width:28px;height:28px;background:#2a3244;color:#e3e7ee;font-size:13px;font-weight:700;border:2px solid #3a4560}',
      '@media (max-width:640px){#umBar{top:8px;right:8px}#umBar button{padding:8px 10px}#umPal button{width:32px;height:32px}#umPal button[data-act="del"]{width:34px;height:34px}}'
    ].join('\n');
    (document.head || document.documentElement).appendChild(style);

    bar = document.createElement('div');
    bar.id = 'umBar';
    bar.innerHTML = '<button type="button" id="umToggle" title="显示 / 隐藏我的标记">👁 标记</button>' +
                    '<button type="button" id="umClear" title="清除本页所有标记">🗑 清空</button>';
    (document.body || document.documentElement).appendChild(bar);

    bar.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || t.tagName !== 'BUTTON') return;
      e.preventDefault();
      e.stopPropagation();
      if (t.id === 'umToggle') {
        var off = document.documentElement.classList.toggle('um-off');
        t.classList.toggle('on', off);
        t.textContent = off ? '🚫 标记' : '👁 标记';
      } else if (t.id === 'umClear') {
        var n = document.querySelectorAll('.um').length;
        if (n && window.confirm('清除本页全部 ' + n + ' 处标记？此操作不可撤销。')) clearAll();
      }
    });

    pal = document.createElement('div');
    pal.id = 'umPal';
    ['y', 'g', 'b', 'p'].forEach(function (cid) {
      var b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('data-c', cid);
      b.style.background = COLORS[cid].bg;
      b.title = '标记这句话';
      pal.appendChild(b);
    });
    var del = document.createElement('button');
    del.type = 'button';
    del.setAttribute('data-act', 'del');
    del.textContent = '✕';
    del.title = '取消这处标记';
    pal.appendChild(del);
    (document.body || document.documentElement).appendChild(pal);

    pal.addEventListener('mousedown', function (e) { e.preventDefault(); e.stopPropagation(); });
    pal.addEventListener('touchstart', function (e) { e.stopPropagation(); }, { passive: true });
    pal.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      var t = e.target;
      if (!t || t.tagName !== 'BUTTON') return;
      if (t.getAttribute('data-act') === 'del') removeMark();
      else if (t.getAttribute('data-c')) applyColor(t.getAttribute('data-c'));
    });

    var timer = null, lastTouch = 0;
    document.addEventListener('touchstart', function () { lastTouch = Date.now(); }, { passive: true, capture: true });
    document.addEventListener('touchend', function () { lastTouch = Date.now(); }, { passive: true, capture: true });

    function schedule() {
      clearTimeout(timer);
      timer = setTimeout(function () {
        var info = selectionInfo();
        if (!info) { hidePalette(); return; }
        placePalette(info.range.getBoundingClientRect());
      }, 150);
    }

    document.addEventListener('selectionchange', schedule);
    document.addEventListener('mouseup', schedule);
    document.addEventListener('touchend', function () { setTimeout(schedule, 80); }, { passive: true });
    window.addEventListener('scroll', hidePalette, { passive: true });
    window.addEventListener('resize', hidePalette);
    document.addEventListener('mousedown', function (e) {
      if (pal.contains(e.target) || bar.contains(e.target)) return;
      if (Date.now() - lastTouch < 700) return;
      var sel = window.getSelection();
      if (sel && !sel.isCollapsed) return;
      hidePalette();
    });
  }

  function init() {
    loadMarks();
    buildUI();
    restore();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
