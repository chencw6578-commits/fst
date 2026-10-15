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
        },
        {
          id: 'rule_medium', name: 'Medium 文章编辑器（示例，可用拾取器校正）', pattern: 'medium.com', pathIncludes: 'edit',
          mode: 'selector', enabled: true, updatedAt: t + 4,
          sel: { title: 'textarea[aria-label="Title"], textarea[placeholder="Title"]', body: 'div[role="textbox"][contenteditable="true"]', link: '', tags: '' }
        },
        {
          id: 'rule_reddit', name: 'Reddit 发帖（old/new 版，示例）', pattern: '*.reddit.com', pathIncludes: 'submit',
          mode: 'selector', enabled: true, updatedAt: t + 5,
          sel: { title: 'input[name="title"], textarea[name="title"], input[placeholder*="Title"]', body: 'textarea[name="text"], div[role="textbox"][contenteditable="true"]', link: '', tags: '' }
        },
        {
          id: 'rule_pinterest', name: 'Pinterest 建图页（示例，可用拾取器校正）', pattern: '*.pinterest.com', pathIncludes: 'builder',
          mode: 'selector', enabled: true, updatedAt: t + 6,
          sel: { title: 'input[aria-label*="Title" i], input[name="title"]', body: 'textarea[aria-label*="Description" i], textarea[name="description"]', link: 'input[type="url"], input[name="website_url"]', tags: '' }
        },
        {
          id: 'rule_wpcom', name: 'WordPress.com 区块编辑器（标题自动填，正文请用复制粘贴）', pattern: '*.wordpress.com', pathIncludes: '',
          mode: 'selector', enabled: true, updatedAt: t + 7,
          sel: { title: 'textarea.post-title__input, textarea[placeholder*="Title"], textarea[placeholder*="标题"]', body: '', link: '', tags: '' }
        },
        {
          id: 'rule_tumblr', name: 'Tumblr 文字帖（示例，可用拾取器校正）', pattern: '*.tumblr.com', pathIncludes: 'new',
          mode: 'selector', enabled: true, updatedAt: t + 8,
          sel: { title: 'input[name="title"], input[placeholder*="Title"]', body: 'div[role="textbox"][contenteditable="true"], div[contenteditable="true"].editor-plaintext', link: '', tags: '' }
        },
        {
          id: 'rule_livejournal', name: 'LiveJournal 写日志（示例，可用拾取器校正）', pattern: '*.livejournal.com', pathIncludes: 'update',
          mode: 'selector', enabled: true, updatedAt: t + 9,
          sel: { title: 'input[name="subject"], #subject', body: 'textarea[name="event"], textarea#draft, div[role="textbox"][contenteditable="true"]', link: '', tags: '' }
        },
        {
          id: 'rule_telegraph', name: 'Telegra.ph 快速发文', pattern: 'telegra.ph', pathIncludes: '',
          mode: 'selector', enabled: true, updatedAt: t + 10,
          sel: { title: 'input[placeholder="Title"], input[placeholder="标题"], input[name="title"]', body: 'div[contenteditable="true"]', link: '', tags: '' }
        }
      ];
    })(),
    recentVariants: {},
    settings: {
      aiEnabled: false,
      aiBaseUrl: 'https://api.deepseek.com/v1',
      aiApiKey: '',
      aiModel: 'deepseek-chat',
      aiTemperature: 0.9,
      siteProfile: '',
      siteNiches: []
    }
  };
}
function loadDb() {
  try {
    db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    const d = defaultDb();
    for (const k of ['tasks', 'templates', 'rules', 'recentVariants']) if (db[k] == null) db[k] = d[k];
    if (!db.settings) db.settings = d.settings;
    for (const k of ['aiEnabled', 'aiBaseUrl', 'aiApiKey', 'aiModel', 'aiTemperature', 'siteProfile', 'siteNiches']) if (db.settings[k] == null) db.settings[k] = d.settings[k];
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
// 书签/目录站需要短描述与标签：Spin 路径自动从正文与锚文本派生（免费、离线）
function deriveDesc(bodyText) {
  const p = (bodyText.split(/\n{2,}/)[0] || bodyText).trim();
  const words = p.split(/\s+/);
  let out = '';
  for (const w of words) { if ((out + ' ' + w).trim().length > 180) break; out = (out + ' ' + w).trim(); }
  return out || p.slice(0, 180);
}
function deriveTags(anchor) {
  const stop = new Set(['best', 'top', 'how', 'the', 'a', 'an', 'for', 'to', 'of', 'and', 'in', 'on', 'with', 'guide', 'tips', 'review']);
  const tags = String(anchor).toLowerCase().split(/[^a-z0-9\u4e00-\u9fa5]+/).filter(w => w.length > 2 && !stop.has(w));
  return [...new Set(tags)].slice(0, 5).join(', ');
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
    const desc = deriveDesc(bodyText);
    const tags = deriveTags(task.anchor);
    const hash = crypto.createHash('sha1').update(title + '\u0000' + bodyText + '\u0000' + desc).digest('hex');
    if (!recent.includes(hash)) {
      variant = { title, bodyText, desc, tags, bodyHtml: bodyToHtml(bodyText, task.anchor, task.targetUrl), hash, templateId: tpl.id, source: 'spin', generatedAt: Date.now() };
      break;
    }
    if (attempt === 49) { dedupWarning = true; variant = { title, bodyText, desc, tags, bodyHtml: bodyToHtml(bodyText, task.anchor, task.targetUrl), hash, templateId: tpl.id, source: 'spin', generatedAt: Date.now() }; }
  }
  if (!opts.dryRun) {
    recent.push(variant.hash);
    while (recent.length > 20) recent.shift();
    saveDb();
  }
  return { variant, dedupWarning };
}

/* ================= AI 内容生成（OpenAI 兼容接口） ================= */
const AI_ANGLES = ["a beginner's guide", 'a personal experience share', 'a resource recommendation', 'common mistakes to avoid', 'quick practical tips', 'a roundup of useful tools'];
async function aiChat(settings, messages, timeoutMs) {
  const url = settings.aiBaseUrl.replace(/\/+$/, '') + '/chat/completions';
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs || 60000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + settings.aiApiKey },
      body: JSON.stringify({ model: settings.aiModel, messages, temperature: Number(settings.aiTemperature) || 0.9 }),
      signal: ctl.signal
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((data.error && data.error.message) || 'HTTP ' + res.status);
    return (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
  } finally { clearTimeout(timer); }
}
// 生成一次 AI 变体：正文自然包含锚文本，链接由 bodyToHtml 强制插入
async function aiGenVariant(task) {
  const s = db.settings;
  if (!s.aiEnabled || !s.aiApiKey || !s.aiBaseUrl || !s.aiModel) throw new Error('AI 配置不完整，请到「设置」页配置');
  const recent = db.recentVariants['_ai'] || (db.recentVariants['_ai'] = []);
  let variant = null, anchorMissing = false;
  for (let attempt = 0; attempt < 2; attempt++) {
    const angle = AI_ANGLES[Math.floor(Math.random() * AI_ANGLES.length)];
    const profile = (db.settings.siteProfile || '').trim();
    const ctx = (task.context || '').trim();
    const sys = [
      'You are an SEO content writer. Generate content for a link submission that will be published on a third-party website (blog, bookmark or directory).',
      'Respond with ONLY a JSON object: {"title": "...", "body": "...", "desc": "...", "tags": ["...", "..."]} — no markdown fences, no extra text.',
      'Requirements:',
      '1. title: 8-14 English words, natural and specific.',
      '2. body: 120-220 English words, 2-3 paragraphs separated by \\n\\n, plain text only (no markdown, no URLs).',
      '3. desc: 25-40 word plain summary of the body, suitable for a bookmark/directory description field.',
      '4. tags: 3-5 lowercase keyword tags related to the topic.',
      `5. The anchor phrase "${task.anchor}" must appear naturally in the body 1-2 times (it will be hyperlinked to the target page by the system).`,
      `6. Topic: ${task.anchor}. Mention the value of the resource found at the target page without spelling out the URL.`,
      `7. Writing angle for this round: ${angle}.`,
      '8. Do not mention being an AI.'
    ];
    if (profile) sys.push(`9. The target page belongs to the following website. Keep the content topically relevant to this site, and write as if you genuinely find the resource useful:\n${profile}`);
    if (ctx) sys.push(`10. Extra context for this task from the site owner:\n${ctx}`);
    const content = await aiChat(s, [{ role: 'system', content: sys.join('\n') }, { role: 'user', content: `Anchor phrase: ${task.anchor}\nTarget page: ${task.targetUrl}\nGenerate the JSON now.` }]);
    const m = content.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('AI 返回内容无法解析');
    let parsed; try { parsed = JSON.parse(m[0]); } catch (e) { throw new Error('AI 返回 JSON 解析失败'); }
    const title = String(parsed.title || '').trim();
    const bodyText = String(parsed.body || '').trim();
    if (!title || !bodyText) throw new Error('AI 返回内容为空');
    let desc = String(parsed.desc || '').trim();
    let tags = Array.isArray(parsed.tags) ? parsed.tags.map(x => String(x).trim().toLowerCase()).filter(Boolean).slice(0, 5).join(', ') : String(parsed.tags || '').trim();
    if (!desc) desc = deriveDesc(bodyText);
    if (!tags) tags = deriveTags(task.anchor);
    anchorMissing = !bodyText.includes(task.anchor);
    const hash = crypto.createHash('sha1').update(title + '\u0000' + bodyText + '\u0000' + desc).digest('hex');
    if (!recent.includes(hash)) {
      variant = { title, bodyText, desc, tags, bodyHtml: bodyToHtml(bodyText, task.anchor, task.targetUrl), hash, templateId: task.templateId || null, source: 'ai', anchorMissing, generatedAt: Date.now() };
      break;
    }
    if (attempt === 1) variant = { title, bodyText, desc, tags, bodyHtml: bodyToHtml(bodyText, task.anchor, task.targetUrl), hash, templateId: task.templateId || null, source: 'ai', anchorMissing, generatedAt: Date.now() };
  }
  recent.push(variant.hash);
  while (recent.length > 20) recent.shift();
  saveDb();
  return { variant, anchorMissing };
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

/* ================= 外链来源库（只收录运营多年、有真实用户的正规平台，按网站类型推荐） ================= */
const NICHES = [
  ['general', '通用'], ['tech', '科技/软件'], ['design', '设计/创意'], ['ecommerce', '电商/购物'],
  ['fitness', '健康/健身'], ['finance', '金融/理财'], ['travel', '旅游'], ['food', '美食'],
  ['gaming', '游戏'], ['education', '教育'], ['photo', '摄影'], ['music', '音乐'],
  ['books', '书籍/文学'], ['chinese', '中文站']
];
const LINK_SOURCES = [
  { id: 'src_medium', name: 'Medium', home: 'https://medium.com', post: 'https://medium.com/new-story', category: '博客平台', niches: ['general', 'tech', 'design', 'fitness', 'finance', 'travel', 'food'], quality: 'A', approval: '即时发布（内容审核严）', linkAttr: '混合', fields: '标题+正文', auto: true, ruleId: 'rule_medium', note: '权重高、读者真实。文章要有信息量，外链 1 条自然出现，广告味重会被封号' },
  { id: 'src_devto', name: 'DEV Community', home: 'https://dev.to', post: 'https://dev.to/enter', category: '博客平台', niches: ['tech', 'general'], quality: 'A', approval: '即时发布', linkAttr: '混合', fields: '标题+正文+标签', auto: true, ruleId: null, note: '开发者社区，技术类内容效果最好，标签必填（已自动生成）' },
  { id: 'src_hashnode', name: 'Hashnode', home: 'https://hashnode.com', post: 'https://hashnode.com/draft', category: '博客平台', niches: ['tech'], quality: 'A', approval: '即时发布', linkAttr: 'dofollow', fields: '标题+正文', auto: true, ruleId: null, note: '技术博客平台，对技术站是高质量相关外链' },
  { id: 'src_substack', name: 'Substack', home: 'https://substack.com', post: 'https://substack.com/signup?publish=true', category: '博客平台', niches: ['general', 'finance', 'books', 'food'], quality: 'A', approval: '即时发布', linkAttr: '混合', fields: '标题+正文', auto: true, ruleId: null, note: 'Newsletter 平台，公开文章可被索引' },
  { id: 'src_blogger', name: 'Blogger', home: 'https://www.blogger.com', post: 'https://www.blogger.com/blog/post/create', category: '博客平台', niches: ['general', 'travel', 'food', 'books'], quality: 'A', approval: '即时发布', linkAttr: 'dofollow', fields: '标题+正文', auto: true, ruleId: 'rule_blogger', note: 'Google 自家博客平台，收录快，可养主题相关的免费小站' },
  { id: 'src_wpcom', name: 'WordPress.com', home: 'https://wordpress.com', post: 'https://wordpress.com/post', category: '博客平台', niches: ['general', 'fitness', 'finance', 'education'], quality: 'A', approval: '即时发布', linkAttr: 'dofollow', fields: '标题+正文', auto: true, ruleId: 'rule_wpcom', note: '免费建站写文，正文建议用面板「复制内容」粘贴' },
  { id: 'src_tumblr', name: 'Tumblr', home: 'https://www.tumblr.com', post: 'https://www.tumblr.com/new/text', category: '博客平台', niches: ['general', 'design', 'photo', 'music', 'gaming'], quality: 'B', approval: '即时发布', linkAttr: '混合', fields: '标题+正文', auto: true, ruleId: 'rule_tumblr', note: '社区活跃，适合短图文，设计/摄影/流行文化类效果好' },
  { id: 'src_telegraph', name: 'Telegra.ph', home: 'https://telegra.ph', post: 'https://telegra.ph', category: '博客平台', niches: ['general'], quality: 'B', approval: '即时发布', linkAttr: '混合', fields: '标题+正文', auto: true, ruleId: 'rule_telegraph', note: '免注册即发、最省时，页面权重一般，适合铺量补充' },
  { id: 'src_livejournal', name: 'LiveJournal', home: 'https://www.livejournal.com', post: 'https://www.livejournal.com/update.bml', category: '博客平台', niches: ['general', 'books', 'music'], quality: 'B', approval: '即时发布', linkAttr: '混合', fields: '标题+正文', auto: true, ruleId: 'rule_livejournal', note: '老牌博客社区，收录稳定' },
  { id: 'src_reddit', name: 'Reddit', home: 'https://www.reddit.com', post: 'https://www.reddit.com/submit', category: '社区问答', niches: ['general', 'tech', 'gaming', 'fitness', 'finance', 'food', 'travel'], quality: 'A', approval: '社区投票监督', linkAttr: 'nofollow', fields: '标题+正文', auto: true, ruleId: 'rule_reddit', note: '流量大但反感营销：先在相关 subreddit 参与，分享价值内容，硬广会被删' },
  { id: 'src_quora', name: 'Quora', home: 'https://www.quora.com', post: 'https://www.quora.com/ask', category: '社区问答', niches: ['general', 'education', 'finance', 'tech', 'fitness'], quality: 'A', approval: '需养号后回答', linkAttr: 'nofollow', fields: '回答正文', auto: false, ruleId: null, note: '回答相关问题并自然带链接，新号直接发链接容易被折叠' },
  { id: 'src_github', name: 'GitHub', home: 'https://github.com', post: 'https://github.com/new', category: '社区问答', niches: ['tech'], quality: 'A', approval: '即时发布', linkAttr: 'dofollow', fields: 'README 正文', auto: false, ruleId: null, note: '技术站可建开源仓库/awesome 清单，README 带站链接，权重极高' },
  { id: 'src_diigo', name: 'Diigo', home: 'https://www.diigo.com', post: 'https://www.diigo.com/item/new/bookmark', category: '书签收藏', niches: ['general', 'education', 'books'], quality: 'B', approval: '即时发布', linkAttr: '混合', fields: '标题+描述+标签+链接', auto: true, ruleId: 'rule_diigo', note: '经典书签站，公开书签可被索引，描述和标签会自动生成填充' },
  { id: 'src_pinterest', name: 'Pinterest', home: 'https://www.pinterest.com', post: 'https://www.pinterest.com/pin-builder/', category: '书签收藏', niches: ['design', 'ecommerce', 'food', 'travel', 'photo', 'fitness'], quality: 'A', approval: '即时发布', linkAttr: 'nofollow', fields: '标题+描述+链接', auto: true, ruleId: 'rule_pinterest', note: '电商/设计/生活类流量巨大，需配图，引流效果大于权重' },
  { id: 'src_mix', name: 'Mix', home: 'https://mix.com', post: 'https://mix.com/submit', category: '书签收藏', niches: ['general', 'photo', 'food', 'travel'], quality: 'B', approval: '即时发布', linkAttr: 'nofollow', fields: '链接+描述', auto: true, ruleId: null, note: 'StumbleUpon 继承者，提交 URL 即可' },
  { id: 'src_flipboard', name: 'Flipboard', home: 'https://flipboard.com', post: 'https://flipboard.com', category: '书签收藏', niches: ['general', 'travel', 'food', 'photo', 'finance'], quality: 'B', approval: '即时发布', linkAttr: 'nofollow', fields: '链接+描述', auto: true, ruleId: null, note: '杂志式收藏，建主题杂志收录自己的文章' },
  { id: 'src_wakelet', name: 'Wakelet', home: 'https://wakelet.com', post: 'https://wakelet.com/explore', category: '书签收藏', niches: ['education', 'general', 'books'], quality: 'B', approval: '即时发布', linkAttr: '混合', fields: '链接+描述', auto: true, ruleId: null, note: '教育类收藏夹流行，适合教育站' },
  { id: 'src_behance', name: 'Behance', home: 'https://www.behance.net', post: 'https://www.behance.net/portfolio/editor', category: '设计创意', niches: ['design', 'photo'], quality: 'A', approval: '即时发布', linkAttr: 'nofollow', fields: '作品项目+描述', auto: false, ruleId: null, note: 'Adobe 旗下，设计作品集带站链接，设计站必备' },
  { id: 'src_dribbble', name: 'Dribbble', home: 'https://dribbble.com', post: 'https://dribbble.com/shots/new', category: '设计创意', niches: ['design', 'photo'], quality: 'A', approval: '即时发布', linkAttr: 'nofollow', fields: '作品+描述', auto: false, ruleId: null, note: '设计师社区，作品描述里可带个人站' },
  { id: 'src_slideshare', name: 'SlideShare', home: 'https://www.slideshare.net', post: 'https://www.slideshare.net/upload', category: '文档分享', niches: ['education', 'finance', 'tech'], quality: 'B', approval: '即时发布', linkAttr: 'nofollow', fields: '文档+描述', auto: false, ruleId: null, note: '上传 PPT/PDF，简介里带链接，适合知识类内容' },
  { id: 'src_zhihu', name: '知乎专栏', home: 'https://zhuanlan.zhihu.com', post: 'https://zhuanlan.zhihu.com/write', category: '中文平台', niches: ['chinese', 'general', 'tech', 'fitness', 'finance'], quality: 'A', approval: '内容审核严', linkAttr: 'nofollow', fields: '标题+正文', auto: true, ruleId: null, note: '中文站首选：写干货回答/专栏，链接别放正文开头' },
  { id: 'src_csdn', name: 'CSDN 博客', home: 'https://www.csdn.net', post: 'https://editor.csdn.net/md/', category: '中文平台', niches: ['chinese', 'tech'], quality: 'B', approval: '即时发布', linkAttr: '混合', fields: '标题+正文+标签', auto: true, ruleId: null, note: '中文技术博客，收录快，适合程序员向内容' },
  { id: 'src_jianshu', name: '简书', home: 'https://www.jianshu.com', post: 'https://www.jianshu.com/writer', category: '中文平台', niches: ['chinese', 'general', 'books'], quality: 'B', approval: '即时发布', linkAttr: '混合', fields: '标题+正文', auto: true, ruleId: null, note: '中文写作社区，生活方式类内容适合' }
];

/* ================= API 路由 ================= */
async function api(req, res, url) {
  const p = url.pathname, m = req.method;

  if (m === 'GET' && p === '/api/state') return json(res, 200, db);

  if (m === 'GET' && p === '/api/sources') {
    const sel = Array.isArray(db.settings.siteNiches) ? db.settings.siteNiches : [];
    const sources = LINK_SOURCES
      .map(s => ({ ...s, match: s.niches.filter(n => sel.includes(n)).length }))
      .sort((a, b) => b.match - a.match || (a.quality < b.quality ? -1 : a.quality > b.quality ? 1 : 0) || a.name.localeCompare(b.name));
    return json(res, 200, { niches: NICHES, selected: sel, sources });
  }

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
    let dedupWarning = false, aiNote = null;
    if (!task.variant) {
      let r = null;
      if (db.settings.aiEnabled && db.settings.aiApiKey && db.settings.aiBaseUrl && db.settings.aiModel) {
        try { r = await aiGenVariant(task); } catch (e) { aiNote = 'AI 生成失败，已回退模板：' + e.message; }
      }
      if (!r) {
        const tpl = db.templates.find(t => t.id === (task.templateId || 'tpl_default'));
        r = generateVariant(task, tpl || db.templates[0]);
      }
      task.variant = r.variant; dedupWarning = r.dedupWarning; saveDb();
    }
    return json(res, 200, { rule, task: taskOut(task), dedupWarning, aiNote });
  }

  if (m === 'POST' && p === '/api/tasks') {
    const b = await readBody(req);
    const targetUrl = (b.targetUrl || '').trim(), anchor = (b.anchor || '').trim();
    if (!/^https?:\/\//.test(targetUrl)) return json(res, 400, { error: '目标 URL 需以 http(s):// 开头' });
    if (!anchor || anchor.length > 100) return json(res, 400, { error: '锚文本不能为空且不超过 100 字符' });
    const task = {
      id: uid('t'), targetUrl, anchor,
      templateId: b.templateId || null, platform: b.platform || '', status: '待发',
      context: String(b.context || '').trim().slice(0, 500),
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
    for (const k of ['targetUrl', 'anchor', 'templateId', 'platform', 'landingUrl', 'context']) {
      if (k in b) {
        if (k === 'targetUrl' && b.targetUrl && !/^https?:\/\//.test(b.targetUrl.trim())) return json(res, 400, { error: '目标 URL 需以 http(s):// 开头' });
        if (k === 'landingUrl' && b.landingUrl && !/^https?:\/\//.test(String(b.landingUrl).trim())) return json(res, 400, { error: '落地 URL 需以 http(s):// 开头' });
        if (k === 'anchor' && (!String(b.anchor).trim() || String(b.anchor).trim().length > 100)) return json(res, 400, { error: '锚文本不能为空且不超过 100 字符' });
        task[k] = k === 'targetUrl' || k === 'anchor' ? String(b[k]).trim() : k === 'context' ? String(b[k] || '').trim().slice(0, 500) : b[k];
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

  if (m === 'POST' && p === '/api/settings/test') {
    const s = db.settings;
    try {
      const reply = await aiChat(s, [{ role: 'user', content: 'Reply with exactly: OK' }], 20000);
      return json(res, 200, { ok: true, message: '连接成功，模型响应：' + String(reply).trim().slice(0, 60) });
    } catch (e) { return json(res, 200, { ok: false, message: '连接失败：' + e.message }); }
  }
  if (m === 'GET' && p === '/api/settings') {
    const s = db.settings;
    return json(res, 200, { aiEnabled: s.aiEnabled, aiBaseUrl: s.aiBaseUrl, aiModel: s.aiModel, aiTemperature: s.aiTemperature, siteProfile: s.siteProfile || '', siteNiches: s.siteNiches || [], hasKey: !!s.aiApiKey });
  }
  if (m === 'PUT' && p === '/api/settings') {
    const b = await readBody(req);
    for (const k of ['aiEnabled', 'aiBaseUrl', 'aiModel']) if (k in b) db.settings[k] = k === 'aiEnabled' ? !!b[k] : String(b[k]).trim();
    if ('aiTemperature' in b) { const v = Number(b.aiTemperature); db.settings.aiTemperature = isNaN(v) ? 0.9 : Math.min(1.2, Math.max(0, v)); }
    if ('siteProfile' in b) db.settings.siteProfile = String(b.siteProfile || '').trim().slice(0, 2000);
    if ('siteNiches' in b) db.settings.siteNiches = Array.isArray(b.siteNiches) ? b.siteNiches.filter(x => NICHES.some(n => n[0] === x)).slice(0, 14) : [];
    if (b.aiApiKey === null) db.settings.aiApiKey = '';
    else if (typeof b.aiApiKey === 'string' && b.aiApiKey.trim()) db.settings.aiApiKey = b.aiApiKey.trim();
    saveDb();
    return json(res, 200, { aiEnabled: db.settings.aiEnabled, aiBaseUrl: db.settings.aiBaseUrl, aiModel: db.settings.aiModel, aiTemperature: db.settings.aiTemperature, siteProfile: db.settings.siteProfile, siteNiches: db.settings.siteNiches || [], hasKey: !!db.settings.aiApiKey });
  }

  if (m === 'POST' && p.startsWith('/api/tasks/') && p.endsWith('/generate')) {
    const task = db.tasks.find(t => t.id === p.split('/')[3]);
    if (!task) return json(res, 404, { error: '任务不存在' });
    if (task.status !== '待发') return json(res, 400, { error: '只有待发任务可生成内容（已发布任务请先标记失败并重置）' });
    try {
      const r = await aiGenVariant(task);
      task.variant = r.variant; saveDb();
      return json(res, 200, { task, anchorMissing: r.anchorMissing });
    } catch (e) { return json(res, 502, { error: e.message }); }
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
      sel: { title: (b.sel && b.sel.title) || '', body: (b.sel && b.sel.body) || '', desc: (b.sel && b.sel.desc) || '', link: (b.sel && b.sel.link) || '', tags: (b.sel && b.sel.tags) || '' },
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
