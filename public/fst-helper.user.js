// ==UserScript==
// @name         fst 外链发射台助手
// @namespace    fst.local.helper
// @version      0.1.0
// @description  半自动外链发布：拉取任务、一键填充表单、回填落地 URL。提交/验证码永远由人工完成。
// @match        *://*/*
// @exclude      *://127.0.0.1:3456/*
// @exclude      *://localhost:3456/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setClipboard
// @connect      127.0.0.1
// @connect      localhost
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';
  const API = 'http://127.0.0.1:3456';

  /* ---------- 网络层：fetch 优先，GM_xmlhttpRequest 兜底 ---------- */
  function request(path, opts) {
    opts = opts || {};
    return new Promise((resolve, reject) => {
      const gm = typeof GM_xmlhttpRequest === 'function' ? GM_xmlhttpRequest : null;
      const doFetch = () => fetch(API + path, {
        method: opts.method || 'GET',
        headers: opts.body ? { 'Content-Type': 'application/json' } : {},
        body: opts.body || undefined
      }).then(r => r.json().then(d => ({ ok: r.ok, status: r.status, data: d })))
        .then(resolve).catch(reject);
      if (gm) {
        gm({
          method: opts.method || 'GET', url: API + path,
          headers: opts.body ? { 'Content-Type': 'application/json' } : {},
          data: opts.body || undefined, timeout: 8000,
          onload: r => { try { resolve({ ok: r.status >= 200 && r.status < 300, status: r.status, data: JSON.parse(r.responseText) }); } catch (e) { reject(e); } },
          onerror: () => { try { doFetch(); } catch (e) { reject(e); } },
          ontimeout: () => reject(new Error('管理台连接超时（未启动？）'))
        });
      } else doFetch();
    });
  }

  /* ---------- 域名匹配：未命中则完全静默 ---------- */
  request('/api/match?host=' + encodeURIComponent(location.hostname) + '&path=' + encodeURIComponent(location.pathname))
    .then(r => { if (r.ok && r.data.rule) boot(r.data.rule); })
    .catch(() => { /* 管理台未启动或未匹配，保持静默 */ });

  /* ---------- 启动面板 ---------- */
  function boot(rule) {
    if (document.getElementById('fst-panel')) return;
    let current = null;   // { task, rule }
    let filled = false;
    let picker = false;

    const css = `
      #fst-panel{position:fixed;right:20px;bottom:20px;z-index:2147483647;width:320px;background:#fff;
        border:1px solid #e4e7ec;border-radius:12px;box-shadow:0 10px 30px rgba(28,35,48,.2);
        font-family:system-ui,"PingFang SC","Microsoft YaHei",sans-serif;font-size:13.5px;color:#1c2330;line-height:1.6}
      #fst-head{display:flex;justify-content:space-between;align-items:center;padding:9px 14px;cursor:move;
        background:#2456e6;color:#fff;border-radius:12px 12px 0 0;font-weight:600;user-select:none}
      #fst-head .x{cursor:pointer;font-weight:normal;opacity:.85;padding:0 4px}
      #fst-body{padding:12px 14px 14px}
      .fst-badge{font-size:11.5px;background:#eef3ff;color:#2456e6;border-radius:999px;padding:2px 10px;font-weight:normal}
      .fst-card{border:1px solid #e4e7ec;border-radius:8px;padding:8px 10px;background:#f6f7f9;margin:10px 0;word-break:break-word}
      .fst-status{margin-top:8px;color:#5b6472;font-size:12.5px;min-height:18px}
      .fst-acts{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px}
      .fst-btn{border:1px solid #2456e6;background:#2456e6;color:#fff;border-radius:7px;padding:5px 12px;font-size:12.5px;cursor:pointer;font-family:inherit}
      .fst-btn.ghost{background:#fff;color:#2456e6}
      .fst-btn.gray{border-color:#e4e7ec;background:#fff;color:#1c2330}
      .fst-btn.warn{border-color:#d92d20;background:#fff;color:#d92d20}
      .fst-mini{position:fixed;right:20px;bottom:20px;z-index:2147483647;width:44px;height:44px;border-radius:50%;
        background:#2456e6;color:#fff;border:none;font-size:18px;cursor:pointer;box-shadow:0 6px 18px rgba(36,86,230,.4);display:none}
      body.fst-picking *{cursor:crosshair !important}
      body.fst-picking *:hover{outline:2px solid #2456e6 !important;outline-offset:1px}
    `;
    const style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);

    const wrap = document.createElement('div'); wrap.id = 'fst-panel';
    wrap.innerHTML = `
      <div id="fst-head">⚡ fst 助手 <span class="fst-badge">${rule.name.replace(/</g, '&lt;')}</span><span class="x" id="fst-min">—</span></div>
      <div id="fst-body">
        <div class="fst-card" id="fst-task"><span style="color:#8a93a3">尚未拉取任务</span></div>
        <div class="fst-acts">
          <button class="fst-btn" id="fst-pull">拉取下一个任务</button>
          <button class="fst-btn ghost" id="fst-fill">一键填充</button>
          <button class="fst-btn gray" id="fst-copy">复制内容</button>
        </div>
        <div class="fst-acts">
          <button class="fst-btn" id="fst-done" style="background:#0e9f6e;border-color:#0e9f6e">标记已发布 ✓</button>
          <button class="fst-btn warn" id="fst-fail">标记失败</button>
          <button class="fst-btn gray" id="fst-pick">拾取选择器</button>
        </div>
        <div class="fst-status" id="fst-status">脚本已激活，请先登录本站并进入发帖页</div>
      </div>`;
    const mini = document.createElement('button'); mini.className = 'fst-mini'; mini.textContent = '⚡'; mini.title = '展开 fst 助手';
    document.body.appendChild(wrap); document.body.appendChild(mini);

    const $id = id => wrap.querySelector('#' + id);
    const status = (msg, isErr) => { $id('fst-status').textContent = msg; $id('fst-status').style.color = isErr ? '#d92d20' : '#5b6472'; };

    /* 拖动 */
    (function () {
      let sx, sy, ox, oy, drag = false;
      const head = $id('fst-head');
      head.addEventListener('mousedown', e => {
        if (e.target.classList.contains('x')) return;
        drag = true; sx = e.clientX; sy = e.clientY;
        const r = wrap.getBoundingClientRect(); ox = r.left; oy = r.top;
        e.preventDefault();
      });
      document.addEventListener('mousemove', e => {
        if (!drag) return;
        wrap.style.left = (ox + e.clientX - sx) + 'px'; wrap.style.top = (oy + e.clientY - sy) + 'px';
        wrap.style.right = 'auto'; wrap.style.bottom = 'auto';
      });
      document.addEventListener('mouseup', () => drag = false);
    })();
    $id('fst-min').onclick = () => { wrap.style.display = 'none'; mini.style.display = 'block'; };
    mini.onclick = () => { wrap.style.display = 'block'; mini.style.display = 'none'; };

    /* 拉取任务 */
    $id('fst-pull').onclick = async () => {
      try {
        status('正在拉取任务…');
        const r = await request('/api/claim', { method: 'POST', body: JSON.stringify({ host: location.hostname, path: location.pathname, ruleId: rule.id }) });
        if (!r.ok) { status(r.data.error || '拉取失败', true); return; }
        if (!r.data.task) { current = null; $id('fst-task').innerHTML = '<span style="color:#8a93a3">队列为空：管理台没有待发任务</span>'; status('队列为空，请先在管理台创建任务'); return; }
        current = { task: r.data.task, rule: r.data.rule || rule };
        filled = false;
        const v = current.task.variant;
        $id('fst-task').innerHTML = `
          <div>锚文本：<b>${esc2(current.task.anchor)}</b></div>
          <div style="margin:4px 0">目标：${esc2(current.task.targetUrl)}</div>
          <div style="color:#5b6472">标题：${esc2(v.title)}</div>
          <div style="color:#5b6472;margin-top:4px">正文预览：${esc2(v.bodyText.slice(0, 80))}…</div>
          ${r.data.dedupWarning ? '<div style="color:#c2780a;margin-top:4px">⚠ 模板变化组合不足，可能与近期内容重复</div>' : ''}`;
        status('已取定任务并固定变体（多次填充使用同一份内容）');
      } catch (e) { status('连接管理台失败：' + e.message + '。可先用「复制内容」手动粘贴（需先拉取过任务）', true); }
    };

    /* 一键填充 */
    $id('fst-fill').onclick = () => {
      if (!current) { status('请先拉取任务', true); return; }
      const v = current.task.variant, sel = current.rule.sel || {};
      const report = { title: false, body: false, link: false, missing: [] };
      if (current.rule.mode === 'heuristic') fillHeuristic(v, report);
      else {
        report.title = sel.title ? fillField(selectOne(sel.title), v.title) : (report.missing.push('标题选择器未配置'), false);
        report.body = sel.body ? fillField(selectOne(sel.body), v.bodyText, v.bodyHtml) : (report.missing.push('正文选择器未配置'), false);
        if (sel.link) report.link = fillField(selectOne(sel.link), current.task.targetUrl);
      }
      filled = report.title || report.body;
      let msg = [];
      msg.push((report.title ? '✓ 标题' : '✗ 标题') + ' ' + (report.body ? '✓ 正文' : '✗ 正文'));
      if (sel.link || current.rule.mode === 'heuristic') msg.push(report.link ? '✓ 链接' : '— 链接');
      if (!filled || report.missing.length || (!report.title || !report.body)) {
        status(msg.join('　') + '。部分字段未找到：' + (report.missing.join('、') || '请检查页面结构') + '，可用「复制内容」手动粘贴，或用「拾取选择器」校正规则', true);
      } else {
        status('已填充。请人工检查内容、过验证码后自己点击提交（脚本不碰提交按钮）');
      }
    };

    function selectOne(sel) {
      for (const s of sel.split(',').map(x => x.trim()).filter(Boolean)) {
        try { const el = document.querySelector(s); if (el) return el; } catch (e) { }
      }
      return null;
    }
    function fillField(el, text, html) {
      if (!el) return false;
      try {
        if (el.isContentEditable) {
          el.focus();
          if (html) { el.innerHTML = html; } else { el.textContent = text; }
          el.dispatchEvent(new InputEvent('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        } else if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
          el.focus();
          const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
          const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
          setter.call(el, text);
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        } else if (el.tagName === 'IFRAME') {
          try {
            const idoc = el.contentDocument;
            if (idoc && idoc.body && idoc.body.isContentEditable) {
              idoc.body.focus(); idoc.body.innerHTML = html || esc2(text);
              el.dispatchEvent(new InputEvent('input', { bubbles: true }));
            } else return false;
          } catch (e) { return false; } // 跨域 iframe 无法写入
        } else return false;
        return true;
      } catch (e) { return false; }
    }
    function visible(el) {
      const r = el.getBoundingClientRect();
      return r.width > 30 && r.height > 10 && !el.disabled && el.offsetParent !== null;
    }
    function fillHeuristic(v, report) {
      // 标题：优先 name/id/placeholder/aria 含 title 的文本框，其次第一个可见大文本框
      const inputs = [...document.querySelectorAll('input[type="text"], input:not([type])')].filter(visible);
      const titleEl = inputs.find(el => /title|标题/i.test([el.name, el.id, el.placeholder, el.getAttribute('aria-label')].join(' ')))
        || inputs.filter(el => el.getBoundingClientRect().width > 250).sort((a, b) => a.tabIndex - b.tabIndex)[0];
      report.title = fillField(titleEl, v.title);
      if (!report.title) report.missing.push('标题（未找到合适输入框）');
      // 正文：可见 textarea + contenteditable，优先 name/id 含 content/body/desc，其次面积最大
      const bodies = [...document.querySelectorAll('textarea, [contenteditable="true"]')].filter(visible)
        .sort((a, b) => (b.getBoundingClientRect().width * b.getBoundingClientRect().height) - (a.getBoundingClientRect().width * a.getBoundingClientRect().height));
      const bodyEl = bodies.find(el => /content|body|desc|正文|内容/i.test([el.name, el.id, el.placeholder].join(' '))) || bodies[0];
      report.body = fillField(bodyEl, v.bodyText, v.bodyHtml);
      if (!report.body) report.missing.push('正文（未找到合适输入框）');
      // 链接：url 类型输入框或 name/placeholder 含 url/link/source
      const linkEl = document.querySelector('input[type="url"]') ||
        [...document.querySelectorAll('input[type="text"], input:not([type])')].filter(visible)
          .find(el => /url|link|source|网址|链接/i.test([el.name, el.id, el.placeholder].join(' ')));
      report.link = linkEl ? fillField(linkEl, current.task.targetUrl) : false;
    }

    /* 复制兜底 */
    $id('fst-copy').onclick = () => {
      if (!current) { status('请先拉取任务', true); return; }
      const v = current.task.variant;
      const text = v.title + '\n\n' + v.bodyText + '\n\n' + current.task.targetUrl;
      if (typeof GM_setClipboard === 'function') { GM_setClipboard(text, 'text'); status('已复制标题+正文+链接到剪贴板，可手动粘贴'); }
      else if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => status('已复制到剪贴板')).catch(() => status('复制失败，请手动复制', true));
    };

    /* 标记已发布 / 失败 */
    $id('fst-done').onclick = async () => {
      if (!current) { status('请先拉取任务', true); return; }
      if (!filled) { if (!confirm('尚未一键填充（或未检测到填充成功），确定已人工完成发布吗？')) return; }
      const def = location.href !== 'about:blank' && /\/(p|post|new|item|bookmark)/.test(location.pathname) ? location.href : '';
      const url = prompt('粘贴发布后的落地 URL（帖子/文章链接）：', def || current.task.targetUrl);
      if (url === null) return;
      if (!/^https?:\/\//.test(url.trim())) { status('落地 URL 需以 http(s):// 开头', true); return; }
      try {
        const r = await request(`/api/tasks/${current.task.id}/status`, { method: 'POST', body: JSON.stringify({ action: 'publish', landingUrl: url.trim(), platform: current.rule.name }) });
        if (!r.ok) { status(r.data.error || '回写失败', true); return; }
        status('已回填落地 URL，任务状态 → 已发布 ✓ 回管理台可继续「检测收录」');
        $id('fst-task').innerHTML = '<span style="color:#0e9f6e">✓ 本任务已完成发布</span>';
        current = null; filled = false;
      } catch (e) { status('连接管理台失败：' + e.message, true); }
    };
    $id('fst-fail').onclick = async () => {
      if (!current) { status('请先拉取任务', true); return; }
      if (!confirm('确认将当前任务标记为失败？（可回管理台重置）')) return;
      try {
        const r = await request(`/api/tasks/${current.task.id}/status`, { method: 'POST', body: JSON.stringify({ action: 'fail' }) });
        if (!r.ok) { status(r.data.error || '回写失败', true); return; }
        status('已标记为失败。可回管理台「重置为待发」再战');
        current = null; filled = false;
        $id('fst-task').innerHTML = '<span style="color:#8a93a3">尚未拉取任务</span>';
      } catch (e) { status('连接管理台失败：' + e.message, true); }
    };

    /* 拾取选择器 */
    $id('fst-pick').onclick = () => {
      picker = !picker;
      document.body.classList.toggle('fst-picking', picker);
      $id('fst-pick').textContent = picker ? '退出拾取' : '拾取选择器';
      status(picker ? '拾取模式：点击页面上的目标输入框，将生成 CSS 选择器供复制' : '已退出拾取模式');
      if (picker) {
        const handler = e => {
          if (!picker) return;
          e.preventDefault(); e.stopPropagation();
          picker = false;
          document.body.classList.remove('fst-picking');
          $id('fst-pick').textContent = '拾取选择器';
          const sel = buildSelector(e.target);
          prompt('该元素的选择器（Ctrl+C 复制后填入对应平台规则）：', sel);
          status('拾取完成。把选择器填入管理台「平台规则」的对应槽位');
          document.removeEventListener('click', handler, true);
        };
        setTimeout(() => document.addEventListener('click', handler, true), 100);
      }
    };
    function buildSelector(el) {
      if (el.id) return '#' + CSS.escape(el.id);
      const name = el.getAttribute('name');
      if (name) return el.tagName.toLowerCase() + '[name="' + name + '"]';
      let path = [];
      let node = el;
      while (node && node !== document.body && path.length < 4) {
        let part = node.tagName.toLowerCase();
        if (node.classList.length) part += '.' + [...node.classList].slice(0, 2).map(c => CSS.escape(c)).join('.');
        const parent = node.parentElement;
        if (parent) {
          const sibs = [...parent.children].filter(c => c.tagName === node.tagName);
          if (sibs.length > 1) part += `:nth-of-type(${sibs.indexOf(node) + 1})`;
        }
        path.unshift(part); node = node.parentElement;
      }
      return path.join(' > ');
    }
  }
  function esc2(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
})();
