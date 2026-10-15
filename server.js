/**
 * fst 外链发射台 - 本地服务端（零依赖，Node >= 18）
 * 启动：node server.js   管理台：http://127.0.0.1:3456
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.FST_PORT || 3456;
const HOST = '127.0.0.1';
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

/* ================= 数据存储 ================= */
let db;
function defaultDb() {
  return {
    tasks: [],
    templates: [
      {
        id: 'tpl_default', name: '通用模板（默认）', isDefault: true,
        titleTpl: 'Check this {guide|article|post} about {锚文本}',
        bodyTpl: 'I {recently|just} found a {great|useful|helpful} {article|page|resource} about {锚文本}: {目标URL}\n\nIt {covers|explains} {a lot about|the basics of} {锚文本} and is {worth reading|definitely worth a visit}. {Highly recommended|Check it out!}',
        createdAt: Date.now()
      },
      {
        id: 'tpl_review', name: '测评长文模板',
        titleTpl: '{My honest|An in-depth|A detailed} {review|look} at {锚文本}',
        bodyTpl: 'Today I want to share my {thoughts|experience|findings} on {锚文本}.\n\n{First of all|To start with}, the {content|information} on {目标URL} is {well organized|easy to follow|practical}.\n\n{If you are|If you happen to be} {interested in|searching for} {锚文本}, this {page|site} is {a good starting point|worth bookmarking}.',
        createdAt: Date.now()
      },
      {
        id: 'tpl_bookmark', name: '书签短描述模板',
        titleTpl: '{锚文本} — {useful|handy} {resource|link}',
        bodyTpl: '{Quick note|Bookmarking this}: a {short|nice} {guide|intro} on {锚文本} at {目标URL}.',
        createdAt: Date.now()
      }
    ],
    rules: (() => {
      const t = Date.now(); // updatedAt 递增：路径/站点专属规则在与兜底规则同域名命中时优先生效
      return [
        {
          id: 'rule_heuristic', name: '通用启发式（兜底）', pattern: '*', pathIncludes: '',
          mode: 'heuristic', enabled: true, updatedAt: t,
          sel: { title: '', body: '', link: '', tags: '' }
        },
        {
          id: 'rule_wp', name: 'WordPress 经典编辑器', pattern: '*', pathIncludes: 'post-new.php',
          mode: 'selector', enabled: true, updatedAt: t + 1,
          sel: { title: 'input#title, input[name="post_title"]', body: 'textarea#content, textarea.wp-editor-area', link: '', tags: '#new-tag-post_tag' }
        },
        {
          id: 'rule_blogger', name: 'Blogger 发帖页（示例，可用拾取器校正）', pattern: '*.blogspot.com', pathIncludes: '',
          mode: 'selector', enabled: true, updatedAt: t + 2,
          sel: { title: 'input[aria-label="Title"], input[aria-label="标题"]', body: 'div.editable[contenteditable="true"], iframe.editable', link: '', tags: '' }
        },
        {
          id: 'rule_diigo', name: 'Diigo 书签（示例，可用拾取器校正）', pattern: 'www.diigo.com', pathIncludes: '',
          mode: 'selector', enabled: true, updatedAt: t + 3,
          sel: { title: 'input[name="title"]', body: 'textarea[name="desc"]', link: 'input[name="url"]', tags: 'input[name="tags"]' }
        }
      ];
    })(),
    recentVariants: {}
  };
}
function loadDb() {
  try {
    db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    const d = defaultDb();
    for (const k of ['tasks', 'templates', 'rules', 'recentVariants']) if (db[k] == null) db[k] = d[k];
  } catch (e) { db = defaultDb(); saveDb(); }
}
function saveDb() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}
const uid = p => p + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

/* ================= Spin 引擎（唯一实现，前端预览也走这里） ================= */
function validateTpl(tpl) {
  let depth = 0;
  for (let i = 0; i < tpl.length; i++) {
    const c = tpl[i];
    if (c === '{') { depth++; if (depth > 2) return `嵌套超过一层（位置 ${i}）`; }
    else if (c === '}') { depth--; if (depth < 0) return `多余的右括号 }（位置 ${i}）`; }
  }
  if (depth !== 0) return `括号不配对：缺少 ${depth} 个右括号 }`;
  return null;
}
// 渲染 {a|b|c}，支持一层嵌套（验证层已限制深度 ≤ 2）
function spinRender(tpl, rand) {
  rand = rand || Math.random;
  let i = 0;
  function parseGroup() { // 调用时 i 已越过 '{'
    const opts = [''];
    while (i < tpl.length) {
      const c = tpl[i];
      if (c === '{') { i++; opts[opts.length - 1] += parseGroup(); }
      else if (c === '|') { opts.push(''); i++; }
      else if (c === '}') { i++; return opts[Math.floor(rand() * opts.length)]; }
      else { opts[opts.length - 1] += c; i++; }
    }
    return opts[0];
  }
  let out = '';
  while (i < tpl.length) {
    if (tpl[i] === '{') { i++; out += parseGroup(); }
    else { out += tpl[i]; i++; }
  }
  return out;
}
function fillVars(text, vars) {
  return text
    .replace(/\{锚文本\}/g, vars.anchor)
    .replace(/\{目标URL\}/g, vars.targetUrl)
    .replace(/\{日期\}/g, vars.date);
}
const escHtml = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = s => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
// 正文 HTML：锚文本出现处渲染为超链接，空行分段
function bodyToHtml(text, anchor, targetUrl) {
  const link = `<a href="${escAttr(targetUrl)}" rel="nofollow noopener">${escHtml(anchor)}</a>`;
  const withLinks = text.split(anchor).map(escHtml).join(link);
  return withLinks.split(/\n{2,}/).map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('\n');
}
function generateVariant(task, tpl, opts) {
  opts = opts || {};
  const vars = {
    anchor: task.anchor, targetUrl: task.targetUrl,
    date: new Date().toISOString().slice(0, 10)
  };
  const key = tpl.id;
  const recent = db.recentVariants[key] || (db.recentVariants[key] = []);
  let variant = null, dedupWarning = false;
  for (let attempt = 0; attempt < 50; attempt++) {
    // 先替换变量再渲染 Spin（Spin 引擎会把 {} 当作选项组消费掉）
    const title = spinRender(fillVars(tpl.titleTpl, vars));
    const bodyText = spinRender(fillVars(tpl.bodyTpl, vars));
    const hash = crypto.createHash('sha1').update(title + '\u0000' + bodyText).digest('hex');
    if (!recent.includes(hash)) {
      variant = { title, bodyText, bodyHtml: bodyToHtml(bodyText, task.anchor, task.targetUrl), hash, templateId: tpl.id, generatedAt: Date.now() };
      break;
    }
    if (attempt === 49) { dedupWarning = true; variant = { title, bodyText, bodyHtml: bodyToHtml(bodyText, task.anchor, task.targetUrl), hash, templateId: tpl.id, generatedAt: Date.now() }; }
  }
  if (!opts.dryRun) {
    recent.push(variant.hash);
    while (recent.length > 20) recent.shift();
    saveDb();
  }
  return { variant, dedupWarning };
}

/* ================= 平台规则匹配 ================= */
function hostMatches(host, pattern) {
  host = (host || '').toLowerCase();
  pattern = (pattern || '*').toLowerCase();
  if (pattern === '*' || pattern === '') return true;
  const re = new RegExp('^' + pattern.split('.').map(s => s === '*' ? '[^.]*' : s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\.') + '$');
  return re.test(host);
}
function matchRule(host, urlPath) {
  const hits = db.rules.filter(r => r.enabled && hostMatches(host, r.pattern)
    && (!r.pathIncludes || (urlPath || '').includes(r.pathIncludes)));
  if (!hits.length) return null;
  hits.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  return hits[0];
}

/* ================= 收录检测（Bing 通道，三态结果） ================= */
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
function normalizeUrl(u) {
  if (!u) return '';
  let s = String(u).toLowerCase().trim()
    .replace(/^https?:\/\//, '').replace(/^www\./, '')
    .replace(/&amp;/g, '&').replace(/&#47;/g, '/').replace(/&quot;/g, '"')
    .replace(/%2f/g, '/').replace(/%3a/g, ':')
    .replace(/\s+/g, '').replace(/\/+$/, '');
  return s;
}
function fetchHtml(url, timeoutMs) {
  return new Promise((resolve) => {
    const mod = url.startsWith('https') ? require('https') : require('http');
    const req = mod.get(url, {
      headers: {
        'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    }, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        const next = new URL(res.headers.location, url).href;
        return fetchHtml(next, timeoutMs).then(resolve);
      }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', c => { if (data.length < 3e6) data += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
      res.on('error', () => resolve(null));
    });
    req.on('error', () => resolve(null));
    req.setTimeout(timeoutMs || 10000, () => { req.destroy(); resolve(null); });
  });
}
async function bingCheck(landingUrl) {
  const needle = normalizeUrl(landingUrl);
  if (!needle) return { result: 'unknown', detail: '落地 URL 无效' };
  const url = 'https://www.bing.com/search?q=' + encodeURIComponent('"' + landingUrl + '"') + '&setlang=en&count=20';
  const res = await fetchHtml(url, 10000);
  if (!res) return { result: 'unknown', detail: '网络请求失败（本机需可访问 Bing，或用人工复核）' };
  if (res.status !== 200) return { result: 'unknown', detail: 'HTTP ' + res.status };
  const body = res.body;
  if (/captcha|verify you are human|unusual traffic/i.test(body)) return { result: 'unknown', detail: '触发反爬/验证页' };
  const hay = normalizeUrl(body);
  if (hay.includes(needle)) return { result: 'indexed' };
  return { result: 'not_indexed', detail: '结果页未出现该 URL' };
}

/* ================= 状态机 ================= */
const STATUSES = ['待发', '已发布', '失败', '已收录', '未收录', '未确认'];
function applyTransition(task, action, payload) {
  payload = payload || {};
  if (action === 'publish') {
    const landing = (payload.landingUrl || '').trim();
    if (!/^https?:\/\//.test(landing)) throw new Error('落地 URL 需以 http(s):// 开头');
    if (!['待发', '已发布'].includes(task.status)) throw new Error(`状态 ${task.status} 不允许标记发布`);
    task.status = '已发布';
    task.landingUrl = landing;
    task.publishedAt = Date.now();
    if (payload.platform) task.platform = payload.platform;
  } else if (action === 'fail') {
    if (task.status === '失败') throw new Error('任务已是失败状态');
    task.status = '失败';
  } else if (action === 'reset') {
    if (task.status !== '失败') throw new Error('只有失败任务可重置');
    task.status = '待发';
    task.landingUrl = ''; task.publishedAt = null;
    if (payload.regenerate) task.variant = null;
  } else throw new Error('未知状态动作: ' + action);
}

/* ================= HTTP 工具 ================= */
function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-store'
  });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '', size = 0;
    req.on('data', c => { size += c.length; if (size > 1e6) { reject(new Error('body too large')); req.destroy(); } else data += c; });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(new Error('JSON 解析失败')); } });
    req.on('error', reject);
  });
}
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml' };
function serveStatic(res, file) {
  const full = path.join(PUBLIC_DIR, file);
  if (!full.startsWith(PUBLIC_DIR) || !fs.existsSync(full) || !fs.statSync(full).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Not Found');
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream', 'Access-Control-Allow-Origin': '*' });
  fs.createReadStream(full).pipe(res);
}
const taskOut = t => ({ ...t });

/* ================= API 路由 ================= */
async function api(req, res, url) {
  const p = url.pathname, m = req.method;

  if (m === 'GET' && p === '/api/state') return json(res, 200, db);

  if (m === 'GET' && p === '/api/match') {
    const rule = matchRule(url.searchParams.get('host'), url.searchParams.get('path') || '');
    return json(res, 200, { rule });
  }

  if (m === 'POST' && p === '/api/claim') {
    const { host, path: urlPath, ruleId } = await readBody(req);
    const rule = ruleId ? db.rules.find(r => r.id === ruleId) : matchRule(host, urlPath);
    if (!rule) return json(res, 404, { error: '当前站点无匹配规则' });
    const pending = db.tasks.filter(t => t.status === '待发');
    // 优先级：手动指定了当前平台 > 已有固定变体（续发） > 最早创建
    pending.sort((a, b) => {
      const score = t => (t.platform === rule.name ? 0 : 1) * 10 + (t.variant ? 1 : 2) * 5;
      return score(a) - score(b) || a.createdAt - b.createdAt;
    });
    if (!pending.length) return json(res, 200, { rule, task: null, message: '队列为空，没有待发任务' });
    const task = pending[0];
    let dedupWarning = false;
    if (!task.variant) {
      const tpl = db.templates.find(t => t.id === (task.templateId || 'tpl_default'));
      const r = generateVariant(task, tpl || db.templates[0]);
      task.variant = r.variant; dedupWarning = r.dedupWarning; saveDb();
    }
    return json(res, 200, { rule, task: taskOut(task), dedupWarning });
  }

  if (m === 'POST' && p === '/api/tasks') {
    const b = await readBody(req);
    const targetUrl = (b.targetUrl || '').trim(), anchor = (b.anchor || '').trim();
    if (!/^https?:\/\//.test(targetUrl)) return json(res, 400, { error: '目标 URL 需以 http(s):// 开头' });
    if (!anchor || anchor.length > 100) return json(res, 400, { error: '锚文本不能为空且不超过 100 字符' });
    const task = {
      id: uid('t'), targetUrl, anchor,
      templateId: b.templateId || null, platform: b.platform || '', status: '待发',
      landingUrl: '', variant: null, checkHistory: [],
      createdAt: Date.now(), publishedAt: null, lastCheckAt: 0
    };
    db.tasks.unshift(task); saveDb();
    return json(res, 200, { task });
  }

  if (m === 'PUT' && p.startsWith('/api/tasks/')) {
    const task = db.tasks.find(t => t.id === p.split('/')[3]);
    if (!task) return json(res, 404, { error: '任务不存在' });
    const b = await readBody(req);
    for (const k of ['targetUrl', 'anchor', 'templateId', 'platform', 'landingUrl']) {
      if (k in b) {
        if (k === 'targetUrl' && b.targetUrl && !/^https?:\/\//.test(b.targetUrl.trim())) return json(res, 400, { error: '目标 URL 需以 http(s):// 开头' });
        if (k === 'landingUrl' && b.landingUrl && !/^https?:\/\//.test(String(b.landingUrl).trim())) return json(res, 400, { error: '落地 URL 需以 http(s):// 开头' });
        if (k === 'anchor' && (!String(b.anchor).trim() || String(b.anchor).trim().length > 100)) return json(res, 400, { error: '锚文本不能为空且不超过 100 字符' });
        task[k] = k === 'targetUrl' || k === 'anchor' ? String(b[k]).trim() : b[k];
        if ((k === 'targetUrl' || k === 'anchor') && task.variant) {
          // 内容参数变化后，固定变体中的链接/锚文本同步刷新
          task.variant.bodyHtml = bodyToHtml(task.variant.bodyText, task.anchor, task.targetUrl);
        }
      }
    }
    saveDb(); return json(res, 200, { task });
  }

  if (m === 'DELETE' && p.startsWith('/api/tasks/')) {
    const i = db.tasks.findIndex(t => t.id === p.split('/')[3]);
    if (i < 0) return json(res, 404, { error: '任务不存在' });
    db.tasks.splice(i, 1); saveDb();
    return json(res, 200, { ok: true });
  }

  if (m === 'POST' && p.startsWith('/api/tasks/') && p.endsWith('/status')) {
    const task = db.tasks.find(t => t.id === p.split('/')[3]);
    if (!task) return json(res, 404, { error: '任务不存在' });
    const b = await readBody(req);
    try { applyTransition(task, b.action, b); } catch (e) { return json(res, 400, { error: e.message }); }
    saveDb(); return json(res, 200, { task });
  }

  if (m === 'POST' && p.startsWith('/api/tasks/') && p.endsWith('/check')) {
    const task = db.tasks.find(t => t.id === p.split('/')[3]);
    if (!task) return json(res, 404, { error: '任务不存在' });
    if (!['已发布', '已收录', '未收录', '未确认'].includes(task.status)) return json(res, 400, { error: '只有已发布的任务可检测收录' });
    if (Date.now() - (task.lastCheckAt || 0) < 10 * 60 * 1000) return json(res, 429, { error: '距上次检测不足 10 分钟，可先用「打开检测页」人工复核' });
    const r = await bingCheck(task.landingUrl);
    task.lastCheckAt = Date.now();
    task.checkHistory = [{ at: task.lastCheckAt, result: r.result, detail: r.detail || '' }, ...(task.checkHistory || [])].slice(0, 3);
    task.status = { indexed: '已收录', not_indexed: '未收录', unknown: '未确认' }[r.result];
    saveDb();
    return json(res, 200, { task, result: r });
  }

  if (m === 'POST' && p === '/api/spin-preview') {
    const b = await readBody(req);
    const err1 = validateTpl(b.titleTpl || ''), err2 = validateTpl(b.bodyTpl || '');
    if (err1) return json(res, 400, { error: '标题模板：' + err1 });
    if (err2) return json(res, 400, { error: '正文模板：' + err2 });
    const vars = {
      anchor: b.anchor || '示例锚文本', targetUrl: b.targetUrl || 'https://example.com/page',
      date: new Date().toISOString().slice(0, 10)
    };
    const title = spinRender(fillVars(b.titleTpl || '', vars));
    const bodyText = spinRender(fillVars(b.bodyTpl || '', vars));
    return json(res, 200, { title, bodyText, bodyHtml: bodyToHtml(bodyText, vars.anchor, vars.targetUrl) });
  }

  /* ---- 模板 ---- */
  if (m === 'POST' && p === '/api/templates') {
    const b = await readBody(req);
    const name = (b.name || '').trim();
    if (!name) return json(res, 400, { error: '模板名称不能为空' });
    for (const [k, label] of [['titleTpl', '标题模板'], ['bodyTpl', '正文模板']]) {
      const err = validateTpl(b[k] || '');
      if (err) return json(res, 400, { error: `${label}：${err}` });
    }
    const tpl = { id: uid('tpl'), name, titleTpl: b.titleTpl, bodyTpl: b.bodyTpl, createdAt: Date.now() };
    db.templates.push(tpl); saveDb();
    return json(res, 200, { template: tpl });
  }
  if (m === 'PUT' && p.startsWith('/api/templates/')) {
    const tpl = db.templates.find(t => t.id === p.split('/')[3]);
    if (!tpl) return json(res, 404, { error: '模板不存在' });
    const b = await readBody(req);
    if (b.name != null) { if (!b.name.trim()) return json(res, 400, { error: '模板名称不能为空' }); tpl.name = b.name.trim(); }
    for (const [k, label] of [['titleTpl', '标题模板'], ['bodyTpl', '正文模板']]) {
      if (b[k] != null) { const err = validateTpl(b[k]); if (err) return json(res, 400, { error: `${label}：${err}` }); tpl[k] = b[k]; }
    }
    saveDb(); return json(res, 200, { template: tpl });
  }
  if (m === 'DELETE' && p.startsWith('/api/templates/')) {
    const tpl = db.templates.find(t => t.id === p.split('/')[3]);
    if (!tpl) return json(res, 404, { error: '模板不存在' });
    if (tpl.isDefault) return json(res, 400, { error: '默认模板不可删除' });
    const refs = db.tasks.filter(t => t.templateId === tpl.id).length;
    if (refs > 0 && !url.searchParams.get('force')) {
      return json(res, 409, { error: `仍有 ${refs} 个任务引用此模板，删除后这些任务将回退到通用模板`, needForce: true });
    }
    db.templates = db.templates.filter(t => t.id !== tpl.id);
    db.tasks.forEach(t => { if (t.templateId === tpl.id) t.templateId = null; });
    delete db.recentVariants[tpl.id];
    saveDb(); return json(res, 200, { ok: true });
  }

  /* ---- 规则 ---- */
  if (m === 'POST' && p === '/api/rules') {
    const b = await readBody(req);
    const name = (b.name || '').trim();
    if (!name) return json(res, 400, { error: '规则名称不能为空' });
    if (!b.pattern || !b.pattern.trim()) return json(res, 400, { error: '域名匹配不能为空' });
    const rule = {
      id: uid('rule'), name, pattern: b.pattern.trim(), pathIncludes: (b.pathIncludes || '').trim(),
      mode: b.mode === 'heuristic' ? 'heuristic' : 'selector', enabled: b.enabled !== false,
      sel: { title: (b.sel && b.sel.title) || '', body: (b.sel && b.sel.body) || '', link: (b.sel && b.sel.link) || '', tags: (b.sel && b.sel.tags) || '' },
      updatedAt: Date.now()
    };
    db.rules.push(rule); saveDb();
    return json(res, 200, { rule });
  }
  if (m === 'PUT' && p.startsWith('/api/rules/')) {
    const rule = db.rules.find(r => r.id === p.split('/')[3]);
    if (!rule) return json(res, 404, { error: '规则不存在' });
    const b = await readBody(req);
    for (const k of ['name', 'pattern', 'pathIncludes', 'mode', 'enabled', 'sel']) if (k in b) rule[k] = b[k];
    rule.updatedAt = Date.now(); saveDb();
    return json(res, 200, { rule });
  }
  if (m === 'DELETE' && p.startsWith('/api/rules/')) {
    const rule = db.rules.find(r => r.id === p.split('/')[3]);
    if (!rule) return json(res, 404, { error: '规则不存在' });
    if (rule.id === 'rule_heuristic') return json(res, 400, { error: '兜底规则不可删除，可停用' });
    db.rules = db.rules.filter(r => r.id !== rule.id); saveDb();
    return json(res, 200, { ok: true });
  }

  return json(res, 404, { error: '接口不存在: ' + m + ' ' + p });
}

/* ================= 服务器 ================= */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  try {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      });
      return res.end();
    }
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    if (url.pathname === '/' || url.pathname === '/index.html') return serveStatic(res, 'index.html');
    if (url.pathname === '/fst-helper.user.js') return serveStatic(res, 'fst-helper.user.js');
    if (url.pathname.startsWith('/public/')) return serveStatic(res, url.pathname.slice('/public/'.length));
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Not Found');
  } catch (e) {
    json(res, 500, { error: e.message });
  }
});
loadDb();
server.listen(PORT, HOST, () => {
  console.log(`\n  fst 外链发射台已启动`);
  console.log(`  ▸ 管理台:  http://127.0.0.1:${PORT}`);
  console.log(`  ▸ 油猴脚本安装地址: http://127.0.0.1:${PORT}/fst-helper.user.js`);
  console.log(`  ▸ 数据文件: ${DB_FILE}\n`);
});
