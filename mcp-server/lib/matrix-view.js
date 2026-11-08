// The X-Matrix shown in the conversation, as an MCP App (extension
// io.modelcontextprotocol/ui, SEP-1865, specification 2026-01-26):
// docs/sprint-pages-de-repli.md, lot C. One more fallback view in the sense of
// "Hoshin garantit, l'agent présente": drawn from the same data an agent reads,
// never a presentation an agent wrote.
//
// The tool show_matrix names the resource ui://hoshin/matrix in _meta.ui. A host
// that supports MCP Apps (claude.ai on the web) renders the HTML below in a
// sandboxed iframe on its own origin and posts it the tool result; any other host
// ignores _meta and the model gets the same content as text. The page loads
// nothing from anywhere (the host's default CSP blocks it anyway), writes text
// with textContent only, and inserts one SVG drawn by our own renderer, parsed as
// XML.

export const VIEW_URI = 'ui://hoshin/matrix';
export const VIEW_MIME = 'text/html;profile=mcp-app';
const PROTOCOL_VERSION = '2026-01-26';

export const VIEW_RESOURCE = {
  uri: VIEW_URI,
  name: 'matrix-view',
  title: 'X-Matrix view',
  description: 'The X-Matrix and its initiative sheets, displayed in the conversation by hosts that support MCP Apps (show_matrix).',
  mimeType: VIEW_MIME,
  _meta: { ui: { prefersBorder: true } },
};

/** The payload the view draws, built the same way by both transports. */
export function viewPayload({ matrix, svg, elements, score, lang, audience, hiddenElements }) {
  const west = new Map((elements?.west || []).map((e) => [e.id, e]));
  const initiatives = (elements?.south || []).map((e) => {
    const sheet = e.sheet || {};
    const kpi = sheet.measuredBy ? west.get(sheet.measuredBy) : null;
    return {
      id: e.id,
      title: e.title,
      status: e.status || 'active',
      progress: typeof e.progress === 'number' ? e.progress : null,
      ownerName: e.ownerName ?? null,
      sheet,
      pageUrl: e.pageUrl ?? null,
      kpi: kpi ? { title: kpi.title, currentValue: kpi.currentValue ?? null, targetValue: kpi.targetValue ?? null, unit: kpi.unit ?? null } : null,
    };
  });
  return {
    lang: lang === 'en' ? 'en' : 'fr',
    audience,
    matrix: { id: matrix.id, name: matrix.name },
    score: typeof score === 'number' ? score : null,
    hiddenElements: hiddenElements ?? 0,
    svg,
    initiatives,
  };
}

/**
 * The tools/call result. A tool that answers { view, summary } is shown by the
 * app; the model reads the summary and the initiatives as text, so a host
 * without MCP Apps loses nothing but the drawing.
 */
export function toolResult(result) {
  const failed = Boolean(result && typeof result === 'object' && !Array.isArray(result) && result.error);
  // export_matrix_image with format "png": the description as text, then each picture as an image.
  if (!failed && result && Array.isArray(result.images)) {
    const { images, ...readable } = result;
    return {
      content: [
        { type: 'text', text: JSON.stringify(readable, null, 2) },
        ...images.map((i) => ({ type: 'image', data: i.data, mimeType: 'image/png' })),
      ],
    };
  }
  if (!failed && result && result.view) {
    const { svg, ...readable } = result.view;
    return {
      content: [{ type: 'text', text: JSON.stringify({ ...result.summary, ...readable }, null, 2) }],
      structuredContent: result.view,
    };
  }
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], isError: failed };
}

export const VIEW_HTML = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>X-Matrix</title>
<style>
  :root { --ink:#0f172a; --muted:#64748b; --line:#e2e8f0; --brand:#0f4c5c; --bg:#ffffff; --card:#f8fafc; }
  :root[data-theme="dark"] { --ink:#e2e8f0; --muted:#94a3b8; --line:#334155; --brand:#7cc4d4; --bg:#0b1220; --card:#111a2b; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 12px; font: 14px/1.45 Helvetica, Arial, sans-serif; color: var(--ink); background: var(--bg); }
  h1 { margin: 0; font-size: 18px; color: var(--brand); }
  .meta { color: var(--muted); font-size: 12px; margin-top: 2px; }
  .matrix { margin-top: 10px; border: 1px solid var(--line); border-radius: 8px; background: #fff; overflow: auto; }
  .matrix svg { display: block; width: 100%; height: auto; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .04em; color: var(--brand); margin: 16px 0 8px; }
  .cards { display: grid; gap: 8px; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); }
  .card { border: 1px solid var(--line); border-radius: 8px; padding: 10px; background: var(--card); }
  .card h3 { margin: 0 0 4px; font-size: 14px; }
  .row { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--muted); }
  .dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
  .green { background: #15803d; } .amber { background: #d97706; } .red { background: #b91c1c; }
  .field { margin-top: 6px; font-size: 13px; }
  .field b { display: block; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); font-weight: 600; }
  ul { margin: 2px 0 0; padding-left: 16px; }
  button { margin-top: 8px; font: inherit; font-size: 12px; padding: 4px 10px; border: 1px solid var(--line); border-radius: 6px; background: var(--bg); color: var(--ink); cursor: pointer; }
  .empty { color: var(--muted); }
</style>
</head>
<body>
<div id="app"><p class="empty">…</p></div>
<script>
(function () {
  var L = {
    fr: { score: 'Complétude', initiatives: 'Chantiers', why: 'Pourquoi', result: 'Résultat attendu', measuredBy: 'Mesuré par', milestones: 'Jalons', next: 'Prochaine action', open: 'Ouvrir la page', hidden: ' élément(s) interne(s) retiré(s)', external: 'Version externe', none: 'Aucun chantier.', health: { green: 'En bonne voie', amber: 'À surveiller', red: 'En difficulté' }, ms: { planned: 'prévu', done: 'atteint', late: 'en retard' } },
    en: { score: 'Completeness', initiatives: 'Initiatives', why: 'Why', result: 'Expected result', measuredBy: 'Measured by', milestones: 'Milestones', next: 'Next action', open: 'Open the page', hidden: ' internal element(s) left out', external: 'External version', none: 'No initiative.', health: { green: 'On track', amber: 'At risk', red: 'Off track' }, ms: { planned: 'planned', done: 'done', late: 'late' } }
  };
  var nextId = 1, pending = {};
  function send(msg) { window.parent.postMessage(msg, '*'); }
  function request(method, params) {
    var id = nextId++;
    send({ jsonrpc: '2.0', id: id, method: method, params: params || {} });
    return new Promise(function (resolve, reject) { pending[id] = { resolve: resolve, reject: reject }; });
  }
  function notify(method, params) { send({ jsonrpc: '2.0', method: method, params: params || {} }); }
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = String(text); return n; }
  function theme(ctx) { if (ctx && (ctx.theme === 'dark' || ctx.theme === 'light')) document.documentElement.setAttribute('data-theme', ctx.theme); }
  function field(card, label, value) { if (!value) return; var f = el('div', 'field'); f.appendChild(el('b', null, label)); f.appendChild(el('span', null, value)); card.appendChild(f); }

  function failure(result) {
    var root = document.getElementById('app');
    root.textContent = '';
    var text = result && result.content && result.content[0] && result.content[0].text;
    var message = '';
    try { message = JSON.parse(text).error || text; } catch (e) { message = text || ''; }
    root.appendChild(el('p', 'empty', message || 'Hoshin Kanri: nothing to show.'));
    resized();
  }

  function render(data) {
    if (!data || !data.matrix) return;
    var t = L[data.lang] || L.fr;
    var root = document.getElementById('app');
    root.textContent = '';
    root.appendChild(el('h1', null, data.matrix.name));
    var meta = [];
    if (typeof data.score === 'number') meta.push(t.score + ' ' + Math.round(data.score) + '/100');
    if (data.audience === 'external') meta.push(t.external);
    if (data.hiddenElements > 0) meta.push(data.hiddenElements + t.hidden);
    if (meta.length) root.appendChild(el('div', 'meta', meta.join(' · ')));
    if (typeof data.svg === 'string' && data.svg.indexOf('<svg') === 0) {
      var doc = new DOMParser().parseFromString(data.svg, 'image/svg+xml');
      var svg = doc.documentElement;
      if (svg && svg.nodeName === 'svg' && !doc.getElementsByTagName('parsererror').length) {
        // Our renderer writes no script; drop anything executable all the same.
        var bad = svg.querySelectorAll('script, foreignObject, a, animate, set, iframe');
        for (var i = 0; i < bad.length; i++) bad[i].remove();
        var all = [svg].concat(Array.prototype.slice.call(svg.querySelectorAll('*')));
        all.forEach(function (n) {
          Array.prototype.slice.call(n.attributes || []).forEach(function (a) {
            if (/^on/i.test(a.name) || /href$/i.test(a.name)) n.removeAttribute(a.name);
          });
        });
        svg.removeAttribute('width'); svg.removeAttribute('height');
        var box = el('div', 'matrix'); box.appendChild(document.importNode(svg, true)); root.appendChild(box);
      }
    }
    root.appendChild(el('h2', null, t.initiatives));
    var list = data.initiatives || [];
    if (!list.length) root.appendChild(el('p', 'empty', t.none));
    var cards = el('div', 'cards');
    list.forEach(function (it) {
      var s = it.sheet || {};
      var card = el('div', 'card');
      card.appendChild(el('h3', null, it.title));
      var row = el('div', 'row');
      if (s.health && t.health[s.health]) { row.appendChild(el('span', 'dot ' + s.health)); row.appendChild(el('span', null, t.health[s.health])); }
      if (typeof it.progress === 'number') row.appendChild(el('span', null, (row.childNodes.length ? '· ' : '') + it.progress + ' %'));
      if (it.ownerName) row.appendChild(el('span', null, '· ' + it.ownerName));
      if (row.childNodes.length) card.appendChild(row);
      if (s.healthNote) card.appendChild(el('div', 'field', s.healthNote));
      field(card, t.why, s.why);
      var kpi = it.kpi ? it.kpi.title + (it.kpi.currentValue || it.kpi.targetValue ? ' (' + [it.kpi.currentValue, it.kpi.targetValue].filter(Boolean).join(' / ') + (it.kpi.unit ? ' ' + it.kpi.unit : '') + ')' : '') : '';
      field(card, t.result, [s.expectedResult, kpi ? t.measuredBy + ' ' + kpi : ''].filter(Boolean).join(' — '));
      if (s.milestones && s.milestones.length) {
        var f = el('div', 'field'); f.appendChild(el('b', null, t.milestones)); var ul = el('ul');
        s.milestones.forEach(function (m) { ul.appendChild(el('li', null, m.title + ' — ' + [m.date, t.ms[m.status] || m.status].filter(Boolean).join(' · '))); });
        f.appendChild(ul); card.appendChild(f);
      }
      if (s.nextAction) field(card, t.next, [s.nextAction.title, s.nextAction.owner, s.nextAction.due].filter(Boolean).join(' — '));
      if (it.pageUrl && /^https:\\/\\//.test(it.pageUrl)) {
        var b = el('button', null, t.open);
        b.addEventListener('click', function () { request('ui/open-link', { url: it.pageUrl }).catch(function () {}); });
        card.appendChild(b);
      }
      cards.appendChild(card);
    });
    root.appendChild(cards);
    resized();
  }

  // Sizes go to the host only once connected (after ui/initialize), measured on the
  // content rather than the viewport, so the view can shrink as well as grow.
  var lastH = 0, connected = false;
  function resized() {
    if (!connected) return;
    var rect = document.body.getBoundingClientRect ? document.body.getBoundingClientRect() : { height: document.documentElement.scrollHeight, width: document.documentElement.scrollWidth };
    var h = Math.ceil(rect.height + 24);
    if (h !== lastH) { lastH = h; notify('ui/notifications/size-changed', { width: Math.ceil(rect.width + 24), height: h }); }
  }

  window.addEventListener('message', function (event) {
    if (event.source !== window.parent) return;
    var msg = event.data;
    if (!msg || msg.jsonrpc !== '2.0') return;
    if (msg.id != null && !msg.method && pending[msg.id]) {
      var p = pending[msg.id]; delete pending[msg.id];
      if (msg.error) p.reject(msg.error); else p.resolve(msg.result);
      return;
    }
    if (msg.method === 'ui/notifications/tool-result') {
      var r = msg.params || {};
      if (r.isError || !r.structuredContent) failure(r); else render(r.structuredContent);
      return;
    }
    if (msg.method === 'ui/notifications/host-context-changed') { theme(msg.params); return; }
    if (msg.id != null && msg.method) {
      // ui/resource-teardown, ping: nothing to keep; anything else is not ours.
      var known = msg.method === 'ui/resource-teardown' || msg.method === 'ping';
      send(known ? { jsonrpc: '2.0', id: msg.id, result: {} } : { jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'Method not found' } });
    }
  });

  request('ui/initialize', { appInfo: { name: 'Hoshin Kanri', version: '1' }, appCapabilities: {}, protocolVersion: '${PROTOCOL_VERSION}' })
    .then(function (res) { theme(res && res.hostContext); }, function () {})
    .then(function () {
      notify('ui/notifications/initialized');
      connected = true;
      resized();
      if (window.ResizeObserver) new ResizeObserver(resized).observe(document.body);
    });
})();
</script>
</body>
</html>
`;
