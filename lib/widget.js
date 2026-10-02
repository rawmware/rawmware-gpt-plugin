// ChatGPT Apps SDK widget: one small, generic card that renders the
// structuredContent of research / trends / design_audit / github audit / about.
// Served as an MCP resource (text/html+skybridge); ChatGPT injects window.openai.
export const WIDGET_URI = 'ui://widget/operator-card.v2.html';

export const WIDGET_HTML = `<div id="root"></div>
<style>
  :root { --bg:#fff; --fg:#0b0b0c; --muted:#6b6b72; --line:#e7e7ea; --chip:#f4f4f5; --accent:#ff4d00; }
  .dark { --bg:#111113; --fg:#f2f2f3; --muted:#9a9aa3; --line:#26262b; --chip:#1c1c20; }
  #root { font: 14px/1.45 ui-sans-serif, system-ui, -apple-system, "Inter", sans-serif; color: var(--fg); background: var(--bg); padding: 14px 16px; border-radius: 14px; }
  h3 { font-size: 15px; margin: 0 0 8px; letter-spacing: -0.01em; display:flex; gap:8px; align-items:center; }
  .k { font: 600 11px/1 ui-monospace, SFMono-Regular, Menlo, monospace; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); margin: 12px 0 6px; }
  .row { padding: 8px 0; border-top: 1px solid var(--line); }
  .row:first-of-type { border-top: 0; }
  a { color: inherit; text-decoration: none; border-bottom: 1px solid var(--line); }
  a:hover { border-color: var(--accent); }
  .m { color: var(--muted); font-size: 12.5px; }
  .chips { display:flex; flex-wrap:wrap; gap:6px; }
  .chip { background: var(--chip); border-radius: 999px; padding: 3px 9px; font-size: 12px; }
  .sw { width: 28px; height: 28px; border-radius: 8px; border: 1px solid var(--line); display:inline-block; }
  .grade { font: 700 22px/1 ui-monospace, monospace; color: var(--accent); }
  .brand { margin-top: 12px; font-size: 11px; color: var(--muted); }
</style>
<script>
(function () {
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]; }); };
  var link = function (u, t) { return /^https?:/.test(u) ? '<a href="' + esc(u) + '" target="_blank" rel="noopener">' + esc(t || u) + '</a>' : esc(t || u); };
  function rows(list, fn) { return (list || []).map(function (x) { return '<div class="row">' + fn(x) + '</div>'; }).join(''); }
  function render() {
    var o = (window.openai && window.openai.toolOutput) || {};
    var root = document.getElementById('root');
    if (window.openai && window.openai.theme === 'dark') root.classList.add('dark');
    var h = '';
    if (o.sources) {
      h += '<h3>Research · ' + esc(o.query) + '</h3>' + rows(o.sources, function (s) { return link(s.url, s.title) + '<div class="m">' + esc((s.notes || '').slice(0, 220)) + '…</div>'; });
    } else if (o.score != null && o.tokens) {
      h += '<h3><span class="grade">' + esc(o.grade) + '</span> ' + esc(o.title || o.url) + ' <span class="m">' + esc(o.score) + '/100</span></h3>';
      h += '<div class="k">Palette</div><div class="chips">' + (o.tokens.palette || []).filter(function (c) { return c[0] === '#'; }).map(function (c) { return '<span class="sw" title="' + esc(c) + '" style="background:' + esc(c) + '"></span>'; }).join('') + '</div>';
      if (o.tokens.fonts) h += '<div class="k">Type</div><div class="chips">' + o.tokens.fonts.map(function (f) { return '<span class="chip">' + esc(f) + '</span>'; }).join('') + '</div>';
      h += '<div class="k">Top fixes</div>' + rows(o.fixes, esc);
    } else if (o.hn || o.github || o.devto || o.items) {
      h += '<h3>Trending' + (o.topic ? ' · ' + esc(o.topic) : '') + '</h3>';
      ['hn', 'github', 'devto', 'items'].forEach(function (k) {
        if (!Array.isArray(o[k])) return;
        h += '<div class="k">' + esc(k) + '</div>' + rows(o[k].slice(0, 6), function (x) { return x.repo ? link('https://github.com/' + x.repo, x.repo) + ' <span class="m">' + esc(x.today ? '★' + x.today + ' today' : '') + '</span><div class="m">' + esc(x.desc) + '</div>' : link(x.url, x.title || x.name) + ' <span class="m">' + esc(x.points || x.reactions || x.score || '') + '</span>'; });
      });
    } else if (o.signals) {
      h += '<h3>' + esc(o.full_name) + '</h3><div class="chips">' + (o.stack || []).map(function (s) { return '<span class="chip">' + esc(s) + '</span>'; }).join('') + '</div>';
      h += '<div class="k">Gaps</div>' + rows(o.gaps && o.gaps.length ? o.gaps : ['None found. Solid.'], esc);
    } else if (o.built_by) {
      h += '<h3>' + esc(o.name || o.built_by) + '</h3><div class="m">' + esc(o.business) + '</div>';
      h += '<div class="k">Live work</div>' + rows(o.live, function (x) { return link(x.url, x.name) + '<div class="m">' + esc(x.desc) + '</div>'; });
      h += '<div class="k">Hire</div><div class="row">' + link(o.hire, 'Start a project →') + '</div>';
    } else {
      h += '<pre style="white-space:pre-wrap;margin:0">' + esc(JSON.stringify(o, null, 2).slice(0, 3000)) + '</pre>';
    }
    root.innerHTML = h + '<div class="brand">rawmware Operator · github.com/rawmware</div>';
  }
  window.addEventListener('openai:set_globals', render);
  render();
})();
</script>`;
