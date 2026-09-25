/* ==========================================================================
   AI Buildout Atlas: runtime (atlas.js)
   --------------------------------------------------------------------------
   No dependencies. Everything hangs off window.Atlas. Load after nav.js:

     <script src="../assets/js/nav.js" defer></script>
     <script src="../assets/js/atlas.js" defer></script>

   What it does on every page
     1. Theme: light/dark following the OS, plus a toggle persisted in
        localStorage ("atlas-theme"). Charts re-render on change.
     2. Shell: top bar, sidebar (from window.ATLAS_NAV), mobile drawer,
        footer, prev/next pager, skip link.
     3. Article: section anchors, "On this page" TOC with scroll-spy,
        reading progress bar, reading time, back-to-top button.
     4. Tables: numeric-column alignment and click-to-sort.
     5. Popovers: glossary terms, provenance badges, citation previews.
     6. Charts: SVG renderers driven by inline JSON (see CHART CONFIG).

   CHART CONFIG (put it inside, or right after, a <figure>)

     <figure class="wide">
       <script type="application/json" data-chart>
       { "type": "bar", "title": "...", "subtitle": "...", "unit": "USD bn",
         "source": "Company filings", "asOf": "2026-09-25", "provenance": "R",
         "xKey": "year", "series": [{"key": "nvda", "label": "NVIDIA"}],
         "data": [{"year": "2024", "nvda": 115}], "valueFormat": "$bn" }
       </script>
     </figure>

   Common keys (all optional except type and data/nodes/layers):
     type        bar | column | hbar | grouped-bar | stacked-bar | stacked-bar-100
                 | line | area | stacked-area | scatter | bubble | waterfall
                 | sankey | treemap | layers
     title, subtitle, source, asOf, unit, note, sample (true -> SAMPLE badge)
     provenance  "R" | "G" | "E" | "A" or an array of them
     xKey        category / x field in each data row (default "label")
     series      [{key, label, color}]  color = 1-8 categorical slot (keeps an
                 entity's color stable across charts). Default: order given.
     data        array of row objects
     stacked     true | "percent" (bar/area)
     horizontal  true (bar, waterfall). Bars with many categories flip to
                 horizontal automatically on narrow screens.
     valueFormat "$bn" "$tn" "$m" "$" "%" "x" "pp" "GW" "MW" "TWh" "$/hr" ...
                 or {prefix, suffix, decimals}
     yMin, yMax  value-axis domain overrides
     height      plot height in px
     labels      direct value labels (true/false); sensible defaults per type
     annotations [{x, label}] vertical marker at an x/category
                 [{y, label}] reference line at a value
     forecastFrom  (line/area) shade x >= this value as "Forecast"
     alt         full text alternative (otherwise generated)

   Type-specific
     scatter/bubble: xKey, yKey, rKey, groupKey ("series"), labelKey
                 ("label"), xFormat, yFormat, rFormat, xLabel, yLabel,
                 rLabel, labels: "all" | "none" | [labels]; rows with
                 highlight:true are labelled. Max 3 series.
     waterfall:  data [{label, value, kind: "total" | "delta"}]; a total
                 with no value shows the running total.
     sankey:     nodes [{id, label, column, group, note}], links [{source,
                 target, value, label}], columns ["Customers", ...],
                 groups [{key, label}] (node.group -> color slot),
                 minWidth (default 680; narrower screens scroll sideways)
     treemap:    data [{label, value, group}], groups [{key, label}]
     layers:     layers [{id, label, note, value, href, current}],
                 arrow {label, direction: "down" | "up"}
   ========================================================================== */
(function (window, document) {
  'use strict';

  var Atlas = window.Atlas = window.Atlas || {};
  Atlas.version = '1.0.0';
  var root = document.documentElement;
  var SVGNS = 'http://www.w3.org/2000/svg';

  /* ======================================================================
     1. UTILITIES
     ====================================================================== */
  function qs(sel, ctx) { return (ctx || document).querySelector(sel); }
  function qsa(sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); }

  /** Create an HTML element. attrs: class, text, on<event>, anything else -> attribute. */
  function h(tag, attrs, kids) {
    var n = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v == null || v === false) return;
        if (k === 'class') n.className = v;
        else if (k === 'text') n.textContent = v;
        else if (k === 'svg') n.innerHTML = v; // trusted, static icon markup only
        else if (k.indexOf('on') === 0 && typeof v === 'function') n.addEventListener(k.slice(2), v);
        else n.setAttribute(k, v === true ? '' : v);
      });
    }
    appendKids(n, kids);
    return n;
  }
  function appendKids(n, kids) {
    if (kids == null) return;
    if (!Array.isArray(kids)) kids = [kids];
    kids.forEach(function (k) {
      if (k == null || k === false) return;
      n.appendChild(typeof k === 'string' || typeof k === 'number' ? document.createTextNode(String(k)) : k);
    });
  }
  /** Create an SVG element and optionally append it. */
  function s(tag, attrs, parent) {
    var n = document.createElementNS(SVGNS, tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { if (attrs[k] != null) n.setAttribute(k, attrs[k]); });
    if (parent) parent.appendChild(n);
    return n;
  }
  function stext(parent, x, y, str, attrs) {
    var t = s('text', Object.assign({ x: x, y: y }, attrs || {}), parent);
    t.textContent = str;
    return t;
  }
  var store = {
    get: function (k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { window.localStorage.setItem(k, v); } catch (e) { /* private mode */ } },
    del: function (k) { try { window.localStorage.removeItem(k); } catch (e) { /* ignore */ } }
  };
  function slugify(str) {
    return String(str).toLowerCase().replace(/&/g, ' and ').replace(/[^\w\s-]/g, '').trim()
      .replace(/[\s_]+/g, '-').replace(/-+/g, '-').slice(0, 64) || 'section';
  }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function sum(arr, f) { var t = 0; arr.forEach(function (d, i) { var v = f ? f(d, i) : d; if (isFinite(v)) t += +v; }); return t; }
  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  function rafThrottle(fn) {
    var queued = false;
    return function () {
      if (queued) return;
      queued = true;
      window.requestAnimationFrame(function () { queued = false; fn(); });
    };
  }
  function emit(name, detail) {
    var ev;
    try { ev = new CustomEvent(name, { detail: detail }); } catch (e) { ev = document.createEvent('CustomEvent'); ev.initCustomEvent(name, false, false, detail); }
    document.dispatchEvent(ev);
  }
  function onReady(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

  var ICON = {
    menu: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M3 6h14M3 10h14M3 14h14"/></svg>',
    close: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15"/></svg>',
    moon: '<svg class="i-moon" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true"><path d="M16.5 12.3A7 7 0 0 1 7.7 3.5a7 7 0 1 0 8.8 8.8z"/></svg>',
    sun: '<svg class="i-sun" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><circle cx="10" cy="10" r="3.4"/><path d="M10 1.8v2M10 16.2v2M1.8 10h2M16.2 10h2M4.2 4.2l1.4 1.4M14.4 14.4l1.4 1.4M15.8 4.2l-1.4 1.4M5.6 14.4l-1.4 1.4"/></svg>',
    up: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 13V3M3.5 7.5L8 3l4.5 4.5"/></svg>',
    table: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="2" y="2.5" width="12" height="11" rx="1.5"/><path d="M2 6.5h12M2 10h12M6.5 6.5v7"/></svg>',
    chart: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M3 13V8M8 13V3M13 13V6"/></svg>',
    brand: '<svg class="brand-mark" viewBox="0 0 22 22" aria-hidden="true"><rect class="b3" x="6" y="3" width="10" height="4" rx="1"/><rect class="b2" x="3.5" y="9" width="15" height="4" rx="1"/><rect x="1" y="15" width="20" height="4" rx="1"/></svg>'
  };

  /* ======================================================================
     2. THEME
     ====================================================================== */
  var THEME_KEY = 'atlas-theme';
  var darkQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  function effectiveTheme() {
    var t = root.getAttribute('data-theme');
    if (t === 'light' || t === 'dark') return t;
    return darkQuery && darkQuery.matches ? 'dark' : 'light';
  }
  function syncToggles() {
    var next = effectiveTheme() === 'dark' ? 'light' : 'dark';
    qsa('[data-theme-toggle]').forEach(function (b) {
      b.setAttribute('aria-label', 'Switch to ' + next + ' theme');
      b.setAttribute('title', 'Switch to ' + next + ' theme');
    });
  }
  function setTheme(t, persist) {
    if (t === 'light' || t === 'dark') root.setAttribute('data-theme', t);
    else root.removeAttribute('data-theme');
    if (persist !== false) { if (t) store.set(THEME_KEY, t); else store.del(THEME_KEY); }
    syncToggles();
    emit('atlas:themechange', { theme: effectiveTheme() });
  }
  Atlas.theme = {
    get: effectiveTheme,
    set: setTheme,
    toggle: function () { setTheme(effectiveTheme() === 'dark' ? 'light' : 'dark'); },
    /** Forget the stored choice and follow the OS again. */
    reset: function () { setTheme(null); }
  };
  (function applyStoredTheme() { // pages also run a tiny inline preflight to avoid a flash
    var t = store.get(THEME_KEY);
    if ((t === 'light' || t === 'dark') && root.getAttribute('data-theme') !== t) root.setAttribute('data-theme', t);
  })();
  if (darkQuery) {
    var onScheme = function () { if (!root.getAttribute('data-theme')) { syncToggles(); emit('atlas:themechange', { theme: effectiveTheme() }); } };
    if (darkQuery.addEventListener) darkQuery.addEventListener('change', onScheme);
    else if (darkQuery.addListener) darkQuery.addListener(onScheme);
  }

  /* ======================================================================
     3. SHELL: nav model, top bar, sidebar, drawer, footer, pager
     ====================================================================== */
  function nav() { return window.ATLAS_NAV || { site: { title: 'AI Buildout Atlas', home: 'index.html' }, tracks: [], reference: { items: [] } }; }
  function rootPath() { var r = root.getAttribute('data-root'); return r == null ? '' : r; }
  function href(p) { return /^([a-z]+:|\/|#)/i.test(p) ? p : rootPath() + p; }

  /** Flat list of every nav item with its track attached. */
  function navItems() {
    var n = nav(), out = [];
    (n.tracks || []).forEach(function (t) { (t.items || []).forEach(function (it) { out.push({ item: it, track: t }); }); });
    ((n.reference && n.reference.items) || []).forEach(function (it) { out.push({ item: it, track: null }); });
    return out;
  }
  function currentEntry() {
    var id = root.getAttribute('data-page');
    var items = navItems(), i;
    if (id) for (i = 0; i < items.length; i++) if (items[i].item.id === id) return items[i];
    var path = decodeURIComponent(window.location.pathname);
    for (i = 0; i < items.length; i++) {
      if (path.slice(-items[i].item.href.length) === items[i].item.href) return items[i];
    }
    return null;
  }
  Atlas.nav = { items: navItems, current: currentEntry, href: href };

  function buildTopbar() {
    var bar = qs('.topbar');
    if (!bar || bar.children.length) { wireTopbar(bar); return; }
    var n = nav(), cur = currentEntry();
    var crumb = null;
    if (cur) {
      crumb = h('div', { class: 'topbar-crumb' }, [
        h('span', { text: cur.track ? cur.track.title : ((n.reference && n.reference.title) || 'Reference') }),
        cur.track ? h('span', { text: '/ ' + cur.item.id + ' ' + cur.item.title }) : h('span', { text: '/ ' + cur.item.title })
      ]);
    }
    appendKids(bar, [
      h('button', { class: 'icon-btn nav-toggle', type: 'button', 'aria-label': 'Open navigation', 'aria-controls': 'atlas-sidebar', 'aria-expanded': 'false', svg: ICON.menu }),
      h('a', { class: 'brand', href: href(n.site.home || 'index.html') }, [svgFrag(ICON.brand), h('span', { text: n.site.title })]),
      crumb,
      h('span', { class: 'topbar-spacer' }),
      h('button', { class: 'icon-btn theme-toggle', type: 'button', 'data-theme-toggle': true, svg: ICON.moon + ICON.sun })
    ]);
    wireTopbar(bar);
  }
  function svgFrag(markup) { var d = document.createElement('div'); d.innerHTML = markup; return d.firstChild; }
  function wireTopbar(bar) {
    qsa('[data-theme-toggle]').forEach(function (b) {
      if (b._atlas) return; b._atlas = true;
      b.addEventListener('click', function () { Atlas.theme.toggle(); });
    });
    syncToggles();
    var t = bar && qs('.nav-toggle', bar);
    if (t && !t._atlas) { t._atlas = true; t.addEventListener('click', function () { toggleDrawer(true); }); }
  }

  function navLink(it, isCurrent, plain) {
    var kids = [];
    if (!plain) kids.push(h('span', { class: 'nav-id', text: it.id }));
    kids.push(h('span', { class: 'nav-title', text: it.title }));
    if (it.status === 'planned') kids.push(h('span', { class: 'nav-tag', text: 'Soon' }));
    else if (it.status === 'draft') kids.push(h('span', { class: 'nav-dot', title: 'Draft' }, h('span', { class: 'sr-only', text: '(draft)' })));
    var cls = 'nav-link' + (plain ? ' is-plain' : '');
    if (it.status === 'planned') {
      return h('span', { class: cls + ' is-planned', 'aria-disabled': 'true', title: it.dek || null }, kids);
    }
    return h('a', { class: cls, href: href(it.href), 'aria-current': isCurrent ? 'page' : null, title: it.dek || null }, kids);
  }

  function buildSidebar() {
    var side = qs('.sidebar');
    if (!side || side.getAttribute('data-static') != null) return;
    var n = nav(), cur = currentEntry();
    side.id = side.id || 'atlas-sidebar';
    side.innerHTML = '';
    side.appendChild(h('div', { class: 'sidebar-head' }, [
      h('a', { class: 'brand', href: href(n.site.home || 'index.html') }, [svgFrag(ICON.brand), h('span', { text: n.site.title })]),
      h('button', { class: 'icon-btn sidebar-close', type: 'button', 'aria-label': 'Close navigation', svg: ICON.close, onclick: function () { toggleDrawer(false); } })
    ]));
    var homeList = h('ul', { class: 'nav-list' }, [h('li', null, navLink({ id: 'home', title: 'Atlas home', href: n.site.home || 'index.html' }, root.getAttribute('data-page') === 'home', true))]);
    side.appendChild(h('div', { class: 'nav-group' }, homeList));

    (n.tracks || []).forEach(function (t, ti) {
      var hasCurrent = cur && cur.track === t;
      var allPlanned = (t.items || []).every(function (it) { return it.status === 'planned'; });
      var open = hasCurrent || (ti === 0 && !(cur && cur.track && cur.track !== t)) || (!allPlanned && !cur);
      var list = h('ul', { class: 'nav-list' }, (t.items || []).map(function (it) {
        return h('li', null, navLink(it, cur && cur.item === it));
      }));
      side.appendChild(h('details', { class: 'nav-group', open: open }, [
        h('summary', null, [h('span', { text: t.title })]),
        t.note ? h('p', { class: 'nav-note', text: t.note }) : null,
        list
      ]));
    });
    if (n.reference && n.reference.items && n.reference.items.length) {
      side.appendChild(h('div', { class: 'nav-group' }, [
        h('p', { class: 'nav-heading', text: n.reference.title || 'Reference' }),
        h('ul', { class: 'nav-list' }, n.reference.items.map(function (it) { return h('li', null, navLink(it, cur && cur.item === it, true)); }))
      ]));
    }
    side.appendChild(h('div', { class: 'sidebar-foot' }, [
      h('div', { class: 'prov-legend', style: 'margin:0;font-size:0.75rem' }, ['R', 'G', 'E', 'A'].map(function (p) {
        return h('span', null, [h('span', { class: 'prov', 'data-prov': p, text: p }), PROV[p].short]);
      }))
    ]));
    if (!qs('.nav-scrim')) document.body.appendChild(h('div', { class: 'nav-scrim', onclick: function () { toggleDrawer(false); } }));
    side.addEventListener('click', function (e) { if (e.target.closest && e.target.closest('a')) toggleDrawer(false); });
  }

  var lastFocus = null;
  function toggleDrawer(open) {
    var body = document.body, btn = qs('.nav-toggle'), side = qs('.sidebar');
    if (!side) return;
    if (open) {
      lastFocus = document.activeElement;
      body.classList.add('nav-open');
      if (btn) btn.setAttribute('aria-expanded', 'true');
      var first = qs('[aria-current="page"]', side) || qs('a, button', side);
      if (first) window.setTimeout(function () { first.focus(); }, 60);
    } else if (body.classList.contains('nav-open')) {
      body.classList.remove('nav-open');
      if (btn) btn.setAttribute('aria-expanded', 'false');
      if (lastFocus && lastFocus.focus) lastFocus.focus();
    }
  }
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { toggleDrawer(false); hidePop(); } });

  function buildFooter() {
    var f = qs('.site-footer');
    if (!f || f.children.length) return;
    var n = nav();
    appendKids(f, [
      h('p', null, [h('strong', { text: n.site.title }), ' · Independent analysis, not investment advice.']),
      h('p', null, ['Every figure is dated and tagged: ',
        h('span', { class: 'prov', 'data-prov': 'R', text: 'R' }), ' reported, ',
        h('span', { class: 'prov', 'data-prov': 'G', text: 'G' }), ' guidance, ',
        h('span', { class: 'prov', 'data-prov': 'E', text: 'E' }), ' third-party estimate, ',
        h('span', { class: 'prov', 'data-prov': 'A', text: 'A' }), ' Atlas estimate.']),
      h('p', null, [h('a', { href: href('methodology.html'), text: 'Methodology' }), ' · ', h('a', { href: href('sources.html'), text: 'Sources' })])
    ]);
  }

  function buildPager() {
    qsa('[data-pager]').forEach(function (p) {
      var cur = currentEntry();
      if (!cur || !cur.track) { p.hidden = true; return; }
      var items = cur.track.items.filter(function (it) { return it.status !== 'planned' || it === cur.item; });
      var i = items.indexOf(cur.item);
      var prev = items[i - 1], next = items[i + 1];
      p.innerHTML = '';
      p.classList.add('pager');
      p.setAttribute('aria-label', p.getAttribute('aria-label') || 'Previous and next layer');
      function card(it, dir) {
        if (!it) return h('span', { class: 'pg-empty' });
        return h('a', { href: href(it.href), class: dir === 'next' ? 'pg-next' : 'pg-prev', rel: dir }, [
          h('span', { class: 'pg-dir', text: dir === 'next' ? 'Next layer →' : '← Previous layer' }),
          h('span', { class: 'pg-title' }, [h('span', { class: 'nav-id', text: it.id }), it.title])
        ]);
      }
      appendKids(p, [card(prev, 'prev'), card(next, 'next')]);
    });
  }

  function addSkipLink() {
    var main = qs('main');
    if (!main || qs('.skip-link')) return;
    if (!main.id) main.id = 'main';
    document.body.insertBefore(h('a', { class: 'skip-link', href: '#' + main.id, text: 'Skip to content' }), document.body.firstChild);
  }

  /* ======================================================================
     4. ARTICLE: reading time, anchors, TOC, scroll-spy, progress, to-top
     ====================================================================== */
  function article() { return qs('.article') || qs('main'); }

  function readingTime() {
    var a = article();
    if (!a) return;
    var words = 0;
    qsa('p, li, dd, dt, h2, h3, h4, blockquote, td, th, figcaption', a).forEach(function (n) {
      if (n.closest('.chart-table')) return;
      words += (n.textContent.match(/\S+/g) || []).length;
    });
    var mins = Math.max(1, Math.round(words / 230));
    qsa('[data-reading-time]').forEach(function (n) { if (!n.textContent.trim() || n.textContent.trim() === '—') n.textContent = mins + ' min read'; });
  }

  function headingLabel(hd) {
    if (hd.getAttribute('data-toc-label')) return hd.getAttribute('data-toc-label');
    var c = hd.cloneNode(true);
    qsa('.kicker, .anchor, .prov, .cite, .sample', c).forEach(function (n) { n.remove(); });
    return c.textContent.replace(/\s+/g, ' ').trim();
  }

  var tocLinks = [], tocHeads = [];
  function buildAnchorsAndToc() {
    var a = article();
    if (!a) return;
    var used = {};
    qsa('[id]').forEach(function (n) { used[n.id] = true; });
    var heads = qsa('h2, h3', a).filter(function (hd) {
      return !hd.closest('.chart, .callout, .company-card, .summary, .eli5, [data-toc-skip], .bullbear, .kpis') && hd.getAttribute('data-toc') !== 'false';
    });
    heads.forEach(function (hd) {
      if (!hd.id) {
        var base = slugify(headingLabel(hd)), id = base, k = 2;
        while (used[id]) id = base + '-' + (k++);
        hd.id = id; used[id] = true;
      }
      if (!qs('.anchor', hd)) hd.appendChild(h('a', { class: 'anchor', href: '#' + hd.id, 'aria-label': 'Link to this section: ' + headingLabel(hd), text: '#' }));
    });
    var toc = qs('.toc');
    if (!toc || toc.getAttribute('data-static') != null) return;
    toc.innerHTML = '';
    var h2s = heads.filter(function (hd) { return hd.tagName === 'H2'; });
    if (h2s.length < 2) { toc.hidden = true; return; }
    var ol = h('ol');
    heads.forEach(function (hd) {
      var link = h('a', { href: '#' + hd.id, class: hd.tagName === 'H3' ? 'is-sub' : null, text: headingLabel(hd) });
      ol.appendChild(h('li', null, link));
      tocLinks.push(link); tocHeads.push(hd);
    });
    appendKids(toc, [
      h('p', { class: 'toc-title', text: 'On this page' }),
      h('nav', { 'aria-label': 'On this page' }, ol),
      h('p', { class: 'toc-actions' }, h('a', { href: '#', text: 'Back to top ↑', onclick: function (e) { e.preventDefault(); window.scrollTo(0, 0); } }))
    ]);
    toc.removeAttribute('aria-label');
  }

  function scrollSpy() {
    if (!tocHeads.length) return;
    var line = (parseFloat(getComputedStyle(root).getPropertyValue('--topbar-h')) || 52) + 90;
    var active = 0;
    for (var i = 0; i < tocHeads.length; i++) {
      if (tocHeads[i].getBoundingClientRect().top <= line) active = i; else break;
    }
    // at the very bottom, light up the last heading
    if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) active = tocHeads.length - 1;
    tocLinks.forEach(function (l, j) {
      var on = j === active;
      l.classList.toggle('is-active', on);
      if (on) l.setAttribute('aria-current', 'location'); else l.removeAttribute('aria-current');
    });
  }

  var progressBar, toTop;
  function buildProgressAndTop() {
    if (!qs('.progress')) {
      progressBar = h('span');
      document.body.appendChild(h('div', { class: 'progress', 'aria-hidden': 'true' }, progressBar));
    } else {
      progressBar = qs('.progress > span') || qs('.progress').appendChild(h('span'));
    }
    toTop = h('button', { class: 'to-top', type: 'button', 'aria-label': 'Back to top', svg: ICON.up, onclick: function () { window.scrollTo(0, 0); var m = qs('main'); if (m) m.focus({ preventScroll: true }); } });
    document.body.appendChild(toTop);
  }
  function onScroll() {
    var a = article();
    if (a && progressBar) {
      var r = a.getBoundingClientRect();
      var total = r.height - window.innerHeight;
      var p = total > 0 ? clamp(-r.top / total, 0, 1) : 1;
      progressBar.style.transform = 'scaleX(' + p.toFixed(4) + ')';
    }
    if (toTop) toTop.classList.toggle('is-on', window.scrollY > 900);
    scrollSpy();
  }

  /* ======================================================================
     5. TABLES: numeric alignment + sorting
     ====================================================================== */
  function parseSortValue(cell) {
    var raw = cell.getAttribute('data-sort');
    var txt = raw != null ? raw : cell.textContent;
    var clean = String(txt).replace(/[−–]/g, '-').replace(/[,$%\s]|[a-zA-Z]+$/g, '').replace(/^[^\d.-]+/, '');
    var num = parseFloat(clean);
    if (raw != null && !isNaN(parseFloat(raw))) return { n: parseFloat(raw), t: txt };
    if (/^-?\d*\.?\d+$/.test(clean) && !isNaN(num)) return { n: num, t: txt };
    return { n: null, t: String(txt).trim().toLowerCase() };
  }
  function enhanceTables() {
    qsa('.article table, table[data-sortable]').forEach(function (table) {
      if (table._atlas) return; table._atlas = true;
      // wrap loose tables so they scroll inside their own box on phones
      if (!table.closest('.table-wrap') && !table.closest('.chart-table')) {
        var w = h('div', { class: 'table-wrap' });
        table.parentNode.insertBefore(w, table); w.appendChild(table);
      }
      var headRow = table.tHead && table.tHead.rows[table.tHead.rows.length - 1];
      if (!headRow) return;
      var numCols = [];
      Array.prototype.forEach.call(headRow.cells, function (th, i) { if (th.classList.contains('num')) numCols.push(i); });
      var bodyRows = [];
      Array.prototype.forEach.call(table.tBodies, function (tb) { bodyRows = bodyRows.concat(Array.prototype.slice.call(tb.rows)); });
      var footRows = table.tFoot ? Array.prototype.slice.call(table.tFoot.rows) : [];
      bodyRows.concat(footRows).forEach(function (tr) {
        numCols.forEach(function (i) { if (tr.cells[i]) tr.cells[i].classList.add('num'); });
      });
      if (table.getAttribute('data-sortable') == null && !table.classList.contains('sortable')) return;
      Array.prototype.forEach.call(headRow.cells, function (th, col) {
        if (th.getAttribute('data-nosort') != null) return;
        var btn = h('button', { class: 'th-sort', type: 'button' });
        while (th.firstChild) btn.appendChild(th.firstChild);
        th.appendChild(btn);
        btn.addEventListener('click', function () {
          var dir = th.getAttribute('aria-sort') === 'descending' ? 'ascending' : 'descending';
          if (!th.getAttribute('aria-sort') && !th.classList.contains('num')) dir = 'ascending';
          Array.prototype.forEach.call(headRow.cells, function (o) { o.removeAttribute('aria-sort'); });
          th.setAttribute('aria-sort', dir);
          var tb = table.tBodies[0];
          var rows = Array.prototype.slice.call(tb.rows);
          var sign = dir === 'ascending' ? 1 : -1;
          rows.sort(function (ra, rb) {
            var a = parseSortValue(ra.cells[col] || ra), b = parseSortValue(rb.cells[col] || rb);
            if (a.n != null && b.n != null) return (a.n - b.n) * sign;
            if (a.n != null) return -1;
            if (b.n != null) return 1;
            return a.t.localeCompare(b.t) * sign;
          });
          rows.forEach(function (r) { tb.appendChild(r); });
        });
      });
    });
  }

  /* ======================================================================
     6. POPOVERS: glossary terms, provenance, citations, [data-tip]
     ====================================================================== */
  var PROV = {
    R: { short: 'reported', title: 'Reported [R]', body: 'Taken from a filing, earnings release or official dataset for a named period.' },
    G: { short: 'guidance', title: 'Guidance [G]', body: 'The company’s own forward-looking guidance or target. Not yet reported.' },
    E: { short: 'estimate', title: 'Third-party estimate [E]', body: 'An estimate by an analyst, research firm or credible press report.' },
    A: { short: 'Atlas est.', title: 'Atlas estimate [A]', body: 'Our own estimate. The arithmetic is shown in the text or the figure notes.' }
  };
  Atlas.provenance = PROV;
  var glossary = null;
  function glossaryData() {
    if (glossary) return glossary;
    glossary = {};
    var src = window.ATLAS_GLOSSARY || {};
    Object.keys(src).forEach(function (k) { glossary[k.toLowerCase()] = src[k]; });
    qsa('script[type="application/json"][data-glossary], #atlas-glossary').forEach(function (sc) {
      try { var d = JSON.parse(sc.textContent); Object.keys(d).forEach(function (k) { glossary[k.toLowerCase()] = d[k]; }); }
      catch (e) { console.warn('[Atlas] glossary JSON is invalid', e); }
    });
    return glossary;
  }
  var pop = null, popTarget = null;
  function popContent(t) {
    if (t.classList.contains('prov')) {
      var p = PROV[(t.getAttribute('data-prov') || t.textContent).trim().toUpperCase()];
      return p ? { title: p.title, body: p.body } : null;
    }
    if (t.hasAttribute('data-term') || t.classList.contains('term')) {
      var key = t.getAttribute('data-term') || t.textContent.trim();
      var def = t.getAttribute('data-def') || glossaryData()[key.toLowerCase()];
      return def ? { title: key, body: def } : null;
    }
    if (t.classList.contains('cite')) {
      var id = (t.getAttribute('href') || '').replace(/^#/, '');
      var li = id && document.getElementById(id);
      if (!li) return null;
      var txt = li.textContent.replace(/\s+/g, ' ').trim();
      return { title: 'Source ' + t.textContent.replace(/[\[\]]/g, ''), body: txt.length > 240 ? txt.slice(0, 237) + '…' : txt };
    }
    if (t.hasAttribute('data-tip')) return { title: t.getAttribute('data-tip-title'), body: t.getAttribute('data-tip') };
    return null;
  }
  function showPop(t) {
    var c = popContent(t);
    if (!c) return;
    if (!pop) {
      pop = h('div', { class: 'atlas-pop', id: 'atlas-pop', role: 'tooltip' });
      document.body.appendChild(pop);
    }
    pop.innerHTML = '';
    if (c.title) pop.appendChild(h('span', { class: 'pop-title', text: c.title }));
    pop.appendChild(h('span', { class: 'pop-body', text: c.body }));
    popTarget = t;
    t.setAttribute('aria-describedby', 'atlas-pop');
    pop.classList.add('is-on');
    var r = t.getBoundingClientRect(), pw = pop.offsetWidth, ph = pop.offsetHeight;
    var left = clamp(r.left + r.width / 2 - pw / 2, 12, window.innerWidth - pw - 12);
    var top = r.bottom + 8;
    if (top + ph > window.innerHeight - 8) top = r.top - ph - 8;
    pop.style.left = left + 'px';
    pop.style.top = Math.max(8, top) + 'px';
  }
  function hidePop() {
    if (pop) pop.classList.remove('is-on');
    if (popTarget) popTarget.removeAttribute('aria-describedby');
    popTarget = null;
  }
  var POP_SEL = '.prov, .term, [data-term], .cite, [data-tip]';
  function enhancePopovers() {
    qsa(POP_SEL).forEach(function (t) {
      if (t._atlas) return; t._atlas = true;
      if (!/^(A|BUTTON|INPUT|SELECT|TEXTAREA)$/.test(t.tagName) && !t.hasAttribute('tabindex')) t.setAttribute('tabindex', '0');
      if (t.classList.contains('prov')) {
        var p = PROV[(t.getAttribute('data-prov') || t.textContent).trim().toUpperCase()];
        if (p && !qs('.sr-only', t)) t.appendChild(h('span', { class: 'sr-only', text: ' (' + p.title.replace(/ \[.\]/, '').toLowerCase() + ')' }));
        t.removeAttribute('title');
      }
    });
    document.addEventListener('mouseover', function (e) {
      var t = e.target.closest && e.target.closest(POP_SEL);
      if (t && t !== popTarget) showPop(t);
    });
    document.addEventListener('mouseout', function (e) {
      var t = e.target.closest && e.target.closest(POP_SEL);
      if (t && (!e.relatedTarget || !t.contains(e.relatedTarget))) hidePop();
    });
    document.addEventListener('focusin', function (e) {
      var t = e.target.closest && e.target.closest(POP_SEL);
      if (t) showPop(t);
    });
    document.addEventListener('focusout', function (e) { if (e.target === popTarget) hidePop(); });
    document.addEventListener('click', function (e) {
      var t = e.target.closest && e.target.closest('.term, [data-term], .prov');
      if (t) { if (popTarget === t) hidePop(); else showPop(t); }
      else if (popTarget && !(e.target.closest && e.target.closest(POP_SEL))) hidePop();
    });
    window.addEventListener('scroll', function () { if (popTarget) hidePop(); }, { passive: true });
  }

  /* ======================================================================
     7. CHARTS
     ====================================================================== */
  var Charts = Atlas.charts = { renderers: {}, instances: [] };

  /** Register a renderer for one or more type names. fn(chart, cfg) */
  Charts.register = function (types, fn) { types.split(/[\s,]+/).forEach(function (t) { Charts.renderers[t] = fn; }); };

  /* ---- 7.1 colors (read from CSS so the theme toggle re-colors) ---- */
  function readColors(el) {
    var cs = getComputedStyle(el);
    function v(n) { return cs.getPropertyValue(n).trim(); }
    var c = {
      surface: v('--c-surface'), ink: v('--c-ink'), ink2: v('--c-ink-2'), muted: v('--c-muted'),
      grid: v('--c-grid'), base: v('--c-base'), total: v('--c-total'),
      pos: v('--div-pos-2'), neg: v('--div-neg-2'), mid: v('--div-mid'),
      cat: [], seq: [], dark: effectiveTheme() === 'dark'
    };
    for (var i = 1; i <= 8; i++) c.cat.push(v('--cat-' + i));
    for (var j = 1; j <= 10; j++) c.seq.push(v('--seq-' + j));
    return c;
  }
  /** Color for series i. series.color may be a 1-8 slot number, a CSS var name or a hex. Never cycles. */
  function seriesColor(c, ser, i) {
    var slot = ser && ser.color;
    if (typeof slot === 'number' && slot >= 1 && slot <= 8) return c.cat[slot - 1];
    if (typeof slot === 'string' && slot) {
      if (slot.indexOf('--') === 0) return getComputedStyle(root).getPropertyValue(slot).trim() || c.muted;
      return slot;
    }
    if (i < 8) return c.cat[i];
    return c.muted; // 9th+ series: fold into a neutral "other" rather than invent a hue
  }
  function hexToRgb(hex) {
    var m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(String(hex).trim());
    if (!m) return null;
    return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
  }
  function luminance(hex) {
    var rgb = hexToRgb(hex); if (!rgb) return 0.5;
    var a = rgb.map(function (x) { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); });
    return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
  }
  /** Text color for a label set inside a colored fill: white unless dark ink is clearly more legible. */
  function inkOn(fill) {
    var L = luminance(fill), cw = 1.05 / (L + 0.05), cb = (L + 0.05) / (0.0038 + 0.05);
    return cw >= 3 && cw * 1.45 >= cb ? '#ffffff' : '#0b0b0b';
  }

  /* ---- 7.2 number formatting ---- */
  var UNITS = { '$bn': ['$', 'bn'], '$tn': ['$', 'tn'], '$m': ['$', 'm'], '$k': ['$', 'k'], '$': ['$', ''], '%': ['', '%'], 'x': ['', 'x'], 'pp': ['', 'pp'], 'num': ['', ''], 'number': ['', ''], '': ['', ''] };
  function autoDecimals(v) { var a = Math.abs(v); if (a >= 100 || a === 0) return 0; if (a >= 10) return 1; return 2; }
  /** Returns fmt(value, decimals?) -> string. */
  function makeFormat(spec) {
    if (typeof spec === 'function') return spec;
    var pre = '', suf = '', dec = null;
    if (spec && typeof spec === 'object') { pre = spec.prefix || ''; suf = spec.suffix || ''; dec = spec.decimals != null ? spec.decimals : null; }
    else if (typeof spec === 'string') {
      if (UNITS[spec]) { pre = UNITS[spec][0]; suf = UNITS[spec][1]; }
      else if (spec.charAt(0) === '$') { pre = '$'; suf = spec.slice(1); }
      else suf = ' ' + spec; // thin space before units like GW, TWh
    }
    return function (v, d) {
      if (v == null || v === '' || !isFinite(v)) return '—';
      var dd = d != null ? d : (dec != null ? dec : autoDecimals(v));
      var minD = d != null ? d : (dec != null ? dec : 0);
      var str = Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: dd, minimumFractionDigits: Math.min(minD, dd) });
      return (v < 0 ? '−' : '') + pre + str + suf;
    };
  }
  function signed(fmt) { return function (v, d) { return (v > 0 ? '+' : '') + fmt(v, d); }; }
  function stepDecimals(step) { return Math.max(0, Math.min(4, -Math.floor(Math.log10(step) + 1e-9))); }
  Atlas.format = makeFormat;

  /* ---- 7.3 scales ---- */
  function niceNum(x, round) {
    var e = Math.floor(Math.log10(x)), f = x / Math.pow(10, e), nf;
    if (round) nf = f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10;
    else nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
    return nf * Math.pow(10, e);
  }
  /** Nice axis ticks. Tries a few tick counts and keeps the one that wastes the least range. */
  function niceTicks(min, max, count) {
    if (!isFinite(min) || !isFinite(max)) { min = 0; max = 1; }
    if (min === max) { if (min === 0) max = 1; else if (min > 0) min = 0; else max = 0; }
    var best = null;
    [count, count + 1, count + 2].forEach(function (c) {
      var t = niceTicksN(min, max, c);
      var waste = (t.max - t.min) / (max - min);
      if (!best || waste < best.waste - 0.08) { best = t; best.waste = waste; }
    });
    return best;
  }
  function niceTicksN(min, max, count) {
    var range = niceNum(max - min, false);
    var step = niceNum(range / Math.max(1, count - 1), true);
    var lo = Math.floor(min / step + 1e-9) * step, hi = Math.ceil(max / step - 1e-9) * step;
    var ticks = [];
    for (var v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v / step) * step);
    ticks = ticks.map(function (t) { return +t.toFixed(10); });
    return { min: lo, max: hi, step: step, ticks: ticks };
  }
  function linear(d0, d1, r0, r1) {
    var k = (r1 - r0) / ((d1 - d0) || 1);
    var f = function (v) { return r0 + (v - d0) * k; };
    f.invert = function (p) { return d0 + (p - r0) / k; };
    return f;
  }

  /* ---- 7.4 text measuring & fitting ---- */
  var measureCtx = null, fontFamily = null;
  function textW(str, size, weight) {
    if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
    if (!fontFamily) fontFamily = getComputedStyle(root).getPropertyValue('--font-sans').trim() || 'system-ui, sans-serif';
    measureCtx.font = (weight || 400) + ' ' + (size || 12) + 'px ' + fontFamily;
    return measureCtx.measureText(String(str)).width;
  }
  function ellipsize(str, maxW, size, weight) {
    str = String(str);
    if (textW(str, size, weight) <= maxW) return str;
    var lo = 0, hi = str.length;
    while (lo < hi) { var mid = (lo + hi + 1) >> 1; if (textW(str.slice(0, mid) + '…', size, weight) <= maxW) lo = mid; else hi = mid - 1; }
    return lo > 0 ? str.slice(0, lo).replace(/\s+$/, '') + '…' : '';
  }
  /** Word-wrap into at most maxLines; returns {lines, clipped}. */
  function wrap(str, maxW, size, maxLines, weight) {
    var words = String(str).split(/\s+/), lines = [], cur = '', clipped = false;
    words.forEach(function (w) {
      var t = cur ? cur + ' ' + w : w;
      if (!cur || textW(t, size, weight) <= maxW) cur = t; else { lines.push(cur); cur = w; }
    });
    if (cur) lines.push(cur);
    if (lines.length > maxLines) { lines = lines.slice(0, maxLines); lines[maxLines - 1] += ' …'; clipped = true; }
    lines = lines.map(function (l) { var e = ellipsize(l, maxW, size, weight); if (e !== l) clipped = true; return e; });
    return { lines: lines, clipped: clipped };
  }

  /* ---- 7.5 bar geometry: 4px rounded data end, square at the baseline ---- */
  function barPath(x, y, w, hgt, side, r) {
    if (w <= 0 || hgt <= 0) return '';
    r = Math.min(r == null ? 4 : r, side === 'top' || side === 'bottom' ? w / 2 : hgt / 2, side === 'top' || side === 'bottom' ? hgt : w);
    if (!side || r <= 0) return 'M' + x + ',' + y + 'h' + w + 'v' + hgt + 'h' + (-w) + 'Z';
    var X = x + w, Y = y + hgt;
    switch (side) {
      case 'top': return 'M' + x + ',' + Y + 'V' + (y + r) + 'Q' + x + ',' + y + ' ' + (x + r) + ',' + y + 'H' + (X - r) + 'Q' + X + ',' + y + ' ' + X + ',' + (y + r) + 'V' + Y + 'Z';
      case 'bottom': return 'M' + x + ',' + y + 'V' + (Y - r) + 'Q' + x + ',' + Y + ' ' + (x + r) + ',' + Y + 'H' + (X - r) + 'Q' + X + ',' + Y + ' ' + X + ',' + (Y - r) + 'V' + y + 'Z';
      case 'right': return 'M' + x + ',' + y + 'H' + (X - r) + 'Q' + X + ',' + y + ' ' + X + ',' + (y + r) + 'V' + (Y - r) + 'Q' + X + ',' + Y + ' ' + (X - r) + ',' + Y + 'H' + x + 'Z';
      case 'left': return 'M' + X + ',' + y + 'H' + (x + r) + 'Q' + x + ',' + y + ' ' + x + ',' + (y + r) + 'V' + (Y - r) + 'Q' + x + ',' + Y + ' ' + (x + r) + ',' + Y + 'H' + X + 'Z';
    }
    return '';
  }
  function crisp(v) { return Math.round(v) + 0.5; }

  /* ---- 7.6 the Chart object: DOM chrome, legend, tooltip, table, keyboard ---- */
  function Chart(script) {
    var cfg;
    try { cfg = JSON.parse(script.textContent); }
    catch (e) {
      var err = h('p', { class: 'chart-error', text: 'Chart JSON is invalid: ' + e.message });
      script.parentNode.insertBefore(err, script.nextSibling);
      console.error('[Atlas] invalid chart JSON', script, e);
      return;
    }
    this.cfg = cfg;
    this.script = script;
    var fig = script.closest('figure');
    if (!fig) {
      var prev = script.previousElementSibling;
      if (prev && prev.tagName === 'FIGURE' && !qs('script[data-chart]', prev)) fig = prev;
      else { fig = h('figure'); script.parentNode.insertBefore(fig, script); }
    }
    this.fig = fig;
    fig.classList.add('chart');
    fig.setAttribute('data-chart-type', cfg.type || 'bar');
    this.uid = 'chart-' + (Charts.instances.length + 1);
    this.build();
    Charts.instances.push(this);
    var self = this;
    this.lastW = 0;
    if (window.ResizeObserver) {
      this.ro = new ResizeObserver(rafThrottle(function () {
        var w = self.body.clientWidth;
        if (w && Math.abs(w - self.lastW) > 1) self.render();
      }));
      this.ro.observe(this.body);
    } else {
      window.addEventListener('resize', rafThrottle(function () { self.render(); }));
    }
    this.render();
  }

  Chart.prototype.build = function () {
    var cfg = this.cfg, fig = this.fig, self = this;
    // head: title, subtitle, Table toggle
    var titleEl = qs('.chart-title', fig), subEl = qs('.chart-sub', fig);
    var titles = h('div', { class: 'chart-titles' });
    if (!titleEl && cfg.title) titleEl = h('p', { class: 'chart-title', text: cfg.title });
    if (titleEl) { titleEl.id = titleEl.id || this.uid + '-title'; titles.appendChild(titleEl); }
    if (cfg.sample && titleEl) titleEl.appendChild(h('span', { class: 'sample', style: 'margin-left:0.5rem', text: 'Sample' }));
    if (!subEl && cfg.subtitle) subEl = h('p', { class: 'chart-sub', text: cfg.subtitle });
    if (subEl) titles.appendChild(subEl);
    this.btn = h('button', { class: 'chart-btn', type: 'button', 'aria-pressed': 'false', 'aria-controls': this.uid + '-table' });
    this.setBtn(false);
    this.btn.addEventListener('click', function () { self.toggleTable(); });
    this.head = h('div', { class: 'chart-head' }, [titles, this.btn]);
    this.legendEl = h('ul', { class: 'chart-legend', 'aria-label': 'Legend' });
    this.plot = h('div', { class: 'chart-plot' });
    this.tip = h('div', { class: 'chart-tip', 'aria-hidden': 'true' });
    this.live = h('div', { class: 'chart-live', 'aria-live': 'polite' });
    this.body = h('div', { class: 'chart-body' }, [this.plot, this.tip, this.live]);
    this.hint = h('p', { class: 'chart-scroll-hint', text: 'Scroll sideways to see the whole chart →' });
    this.tableEl = h('div', { class: 'chart-table', id: this.uid + '-table' });
    var foot = qs('figcaption', fig);
    if (!foot) foot = h('figcaption');
    foot.classList.add('chart-foot');
    this.fillFoot(foot);
    // assemble (keep the JSON script where it is, invisible)
    fig.insertBefore(this.head, fig.firstChild);
    fig.insertBefore(this.legendEl, this.head.nextSibling);
    fig.insertBefore(this.body, this.legendEl.nextSibling);
    fig.insertBefore(this.hint, this.body.nextSibling);
    fig.insertBefore(this.tableEl, this.hint.nextSibling);
    fig.appendChild(foot);
    if (titleEl) fig.setAttribute('aria-labelledby', titleEl.id);
    this.plot.addEventListener('scroll', function () { self.hideTip(); }, { passive: true });
  };

  Chart.prototype.fillFoot = function (foot) {
    var cfg = this.cfg, items = [];
    if (cfg.source) items.push(h('span', { class: 'cf-item' }, [h('span', { text: 'Source: ' + cfg.source })]));
    if (cfg.asOf) items.push(h('span', { class: 'cf-item', text: 'As of ' + cfg.asOf }));
    if (cfg.unit) items.push(h('span', { class: 'cf-item', text: 'Unit: ' + cfg.unit }));
    var prov = cfg.provenance ? [].concat(cfg.provenance) : [];
    if (prov.length) items.push(h('span', { class: 'cf-item' }, prov.map(function (p) { return h('span', { class: 'prov', 'data-prov': p, text: p }); })));
    if (cfg.note) items.push(h('span', { class: 'cf-item cf-note', text: cfg.note }));
    if (!items.length) return;
    if (foot.childNodes.length) foot.insertBefore(h('span', { class: 'cf-item cf-note' }, Array.prototype.slice.call(foot.childNodes)), null);
    items.forEach(function (i) { foot.appendChild(i); });
  };

  Chart.prototype.setBtn = function (isTable) {
    this.btn.innerHTML = '';
    this.btn.appendChild(svgFrag(isTable ? ICON.chart : ICON.table));
    this.btn.appendChild(document.createTextNode(isTable ? 'Chart' : 'Table'));
    this.btn.setAttribute('aria-pressed', isTable ? 'true' : 'false');
    this.btn.setAttribute('aria-label', isTable ? 'Show chart' : 'Show data table');
  };
  Chart.prototype.toggleTable = function (force) {
    var on = force != null ? force : !this.fig.classList.contains('is-table');
    this.fig.classList.toggle('is-table', on);
    this.setBtn(on);
    if (!on) this.render();
  };

  /** Main render: measure, clear, call the renderer. */
  Chart.prototype.render = function () {
    var w = this.body.clientWidth;
    if (!w) return;
    this.lastW = w;
    this.W = w;
    this.C = readColors(this.fig);
    this.points = [];
    this.active = -1;
    this.onActivate = null;
    this.plot.innerHTML = '';
    this.fig.classList.remove('is-scrollable');
    this.hideTip();
    var type = this.cfg.type || 'bar';
    var R = Charts.renderers[type];
    if (!R) { this.plot.appendChild(h('p', { class: 'chart-error', text: 'Unknown chart type: ' + type })); return; }
    try { R(this, this.cfg); }
    catch (e) {
      console.error('[Atlas] chart render failed', this.cfg, e);
      this.plot.innerHTML = '';
      this.plot.appendChild(h('p', { class: 'chart-error', text: 'Chart failed to render: ' + e.message }));
    }
  };

  /** Create the root <svg>. minWidth makes the plot scroll sideways on phones. */
  Chart.prototype.svg = function (width, height, summary) {
    var cfg = this.cfg;
    var label = cfg.alt || [cfg.title, cfg.subtitle, summary].filter(Boolean).join('. ');
    var root_ = s('svg', {
      width: width, height: height, viewBox: '0 0 ' + width + ' ' + height, role: 'img', tabindex: '0',
      'aria-label': label + '. Use the arrow keys to step through values, or the Table button for the data.'
    });
    this.plot.appendChild(root_);
    this.svgEl = root_;
    if (width > this.W + 1) this.fig.classList.add('is-scrollable');
    this.wireKeys(root_);
    return root_;
  };

  /** Legend: items [{label, color, shape: rect|line|dot|ring}]. Hidden for a single series unless force. */
  Chart.prototype.legend = function (items, force) {
    var el = this.legendEl;
    el.innerHTML = '';
    if (!items || (items.length < 2 && !force)) { el.hidden = true; return; }
    el.hidden = false;
    items.forEach(function (it) {
      var sw = h('span', { class: 'lg-sw is-' + (it.shape || 'rect'), 'aria-hidden': 'true' });
      sw.style.setProperty('--sw', it.color);
      if (it.shape === 'ring') { sw.className = 'lg-sw is-dot'; sw.style.background = 'transparent'; sw.style.border = '1.5px solid ' + it.color; }
      el.appendChild(h('li', null, [sw, h('span', { text: it.label })]));
    });
  };

  /** Data table: columns [{label, num}], rows [[cell...]]. Cells are strings. */
  Chart.prototype.table = function (columns, rows) {
    var t = h('table');
    var cap = h('caption', { text: (this.cfg.title || 'Chart data') });
    if (this.cfg.unit) cap.appendChild(h('small', { text: 'Unit: ' + this.cfg.unit }));
    t.appendChild(cap);
    var thead = h('thead'), tr = h('tr');
    columns.forEach(function (c) { tr.appendChild(h('th', { scope: 'col', class: c.num ? 'num' : null, text: c.label })); });
    thead.appendChild(tr); t.appendChild(thead);
    var tb = h('tbody');
    rows.forEach(function (r) {
      var row = h('tr');
      r.forEach(function (cell, i) {
        row.appendChild(i === 0 ? h('th', { scope: 'row', text: cell }) : h('td', { class: columns[i] && columns[i].num ? 'num' : null, text: cell }));
      });
      tb.appendChild(row);
    });
    t.appendChild(tb);
    this.tableEl.innerHTML = '';
    this.tableEl.appendChild(h('div', { class: 'table-wrap' }, t));
  };

  /** Tooltip. content = {head, rows:[{color, value, label, dim, shape}], total:{value,label}, note} */
  Chart.prototype.showTip = function (content, clientX, clientY) {
    var tip = this.tip;
    tip.innerHTML = '';
    if (content.head) tip.appendChild(h('div', { class: 'tt-head', text: content.head }));
    (content.rows || []).forEach(function (r) {
      var key = h('span', { class: 'tt-key' });
      if (r.color) key.style.setProperty('--sw', r.color); else key.style.visibility = 'hidden';
      tip.appendChild(h('div', { class: 'tt-row' + (r.dim ? ' is-dim' : '') }, [key, h('span', { class: 'tt-val', text: r.value }), h('span', { class: 'tt-lab', text: r.label || '' })]));
    });
    if (content.total) {
      tip.appendChild(h('div', { class: 'tt-row tt-total' }, [h('span'), h('span', { class: 'tt-val', text: content.total.value }), h('span', { class: 'tt-lab', text: content.total.label || 'Total' })]));
    }
    if (content.note) tip.appendChild(h('div', { class: 'tt-note', text: content.note }));
    tip.classList.add('is-on');
    var br = this.body.getBoundingClientRect();
    var x = clientX - br.left, y = clientY - br.top;
    var tw = tip.offsetWidth, th = tip.offsetHeight, bw = this.body.clientWidth;
    var left = x + 16;
    if (left + tw > bw) left = x - 16 - tw;
    if (left < 0) left = clamp(x - tw / 2, 0, Math.max(0, bw - tw));
    var top = y - th - 12;
    if (top < -8) top = y + 18;
    tip.style.transform = 'translate(' + Math.round(left) + 'px,' + Math.round(top) + 'px)';
    this.live.textContent = [content.head].concat((content.rows || []).map(function (r) { return (r.label ? r.label + ': ' : '') + r.value; })).concat(content.total ? [(content.total.label || 'Total') + ': ' + content.total.value] : []).filter(Boolean).join(', ');
  };
  Chart.prototype.hideTip = function () { this.tip.classList.remove('is-on'); };

  /**
   * Hover/focus points. Each renderer calls addPoint({x, y, on, off, tip}) with
   * x/y in SVG coordinates (the tooltip anchor for keyboard use), on()/off()
   * to highlight, and tip() returning tooltip content.
   */
  Chart.prototype.addPoint = function (p) { this.points.push(p); return this.points.length - 1; };
  Chart.prototype.activate = function (i, clientX, clientY) {
    var p = this.points[i];
    if (!p) return;
    if (this.active !== i && this.active >= 0 && this.points[this.active].off) this.points[this.active].off();
    this.active = i;
    if (p.on) p.on();
    if (clientX == null) {
      var r = this.svgEl.getBoundingClientRect();
      clientX = r.left + p.x; clientY = r.top + p.y;
    }
    this.showTip(p.tip(), clientX, clientY);
  };
  Chart.prototype.deactivate = function () {
    if (this.active >= 0 && this.points[this.active] && this.points[this.active].off) this.points[this.active].off();
    this.active = -1;
    this.hideTip();
    if (this.onClear) this.onClear();
  };
  Chart.prototype.wireKeys = function (svgEl) {
    var self = this;
    svgEl.addEventListener('keydown', function (e) {
      var n = self.points.length; if (!n) return;
      var i = self.active, handled = true;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') i = i < 0 ? 0 : (i + 1) % n;
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') i = i < 0 ? n - 1 : (i - 1 + n) % n;
      else if (e.key === 'Home') i = 0;
      else if (e.key === 'End') i = n - 1;
      else if (e.key === 'Escape') { self.deactivate(); return; }
      else handled = false;
      if (handled) { e.preventDefault(); self.activate(i); }
    });
    svgEl.addEventListener('blur', function () { self.deactivate(); });
    svgEl.addEventListener('pointerleave', function () { self.deactivate(); });
  };

  /* ---- 7.7 shared axis helpers ---- */
  var FS = 12; // tick font size
  function tickCount(len, per) { return Math.max(3, Math.min(8, Math.round(len / (per || 56)))); }

  /** Value gridlines + tick labels. vertical: gridlines horizontal (value on y). */
  function valueAxis(g, C, scale, ticks, fmt, dec, o) {
    ticks.forEach(function (t) {
      var p = crisp(scale(t));
      if (o.vertical) {
        s('line', { x1: o.x0, x2: o.x1, y1: p, y2: p, stroke: t === 0 ? C.base : C.grid, 'stroke-width': 1, 'shape-rendering': 'crispEdges' }, g);
        stext(g, o.x0 - 8, p, t === 0 ? '0' : fmt(t, dec), { 'text-anchor': 'end', dy: '0.32em', fill: C.muted, 'font-size': FS, 'font-variant-numeric': 'tabular-nums' });
      } else {
        s('line', { y1: o.y0, y2: o.y1, x1: p, x2: p, stroke: t === 0 ? C.base : C.grid, 'stroke-width': 1, 'shape-rendering': 'crispEdges' }, g);
        stext(g, p, o.y1 + 16, t === 0 ? '0' : fmt(t, dec), { 'text-anchor': 'middle', fill: C.muted, 'font-size': FS, 'font-variant-numeric': 'tabular-nums' });
      }
    });
  }
  function maxTickW(ticks, fmt, dec) { return Math.max.apply(null, ticks.map(function (t) { return textW(fmt(t, dec), FS); })); }

  /** Decide how x (category) labels fit a band: single line, 2-line wrap, or thinned. */
  function fitBandLabels(labels, band) {
    var avail = band - 6;
    var widths = labels.map(function (l) { return textW(l, FS); });
    var maxW = Math.max.apply(null, widths.concat([0]));
    if (maxW <= avail) return { mode: 'one', step: 1, lines: labels.map(function (l) { return [String(l)]; }), rows: 1 };
    var wrapped = labels.map(function (l) { return wrap(l, avail, FS, 2); });
    if (!wrapped.some(function (w) { return w.clipped; }) && avail > 30) return { mode: 'wrap', step: 1, lines: wrapped.map(function (w) { return w.lines; }), rows: Math.max.apply(null, wrapped.map(function (w) { return w.lines.length; })) };
    var step = Math.ceil((maxW + 12) / band);
    return { mode: 'thin', step: step, lines: labels.map(function (l, i) { return i % step === 0 ? [String(l)] : []; }), rows: 1 };
  }

  /** Annotation layer for cartesian charts. pos(x) -> px along category/x axis; val(y) -> px along value axis. */
  function drawAnnotations(g, C, anns, o) {
    (anns || []).forEach(function (a) {
      if (a.y != null && o.val) {
        var p = crisp(o.val(a.y));
        if (o.vertical) {
          s('line', { x1: o.x0, x2: o.x1, y1: p, y2: p, stroke: C.ink2, 'stroke-width': 1, 'stroke-dasharray': '4 3', 'shape-rendering': 'crispEdges' }, g);
          if (a.label) stext(g, o.x1, p - 6, a.label, { 'text-anchor': 'end', fill: C.ink2, 'font-size': 11.5, class: 'halo' });
        } else {
          s('line', { y1: o.y0, y2: o.y1, x1: p, x2: p, stroke: C.ink2, 'stroke-width': 1, 'stroke-dasharray': '4 3', 'shape-rendering': 'crispEdges' }, g);
          if (a.label) stext(g, p + 5, o.y0 + 10, a.label, { fill: C.ink2, 'font-size': 11.5, class: 'halo' });
        }
      } else if (a.x != null && o.pos) {
        var q = o.pos(a.x);
        if (q == null || !isFinite(q)) return;
        q = crisp(q);
        if (o.vertical) {
          s('line', { x1: q, x2: q, y1: o.y0 - 12, y2: o.y1, stroke: C.muted, 'stroke-width': 1, 'shape-rendering': 'crispEdges' }, g);
          if (a.label) {
            var anchor = q > (o.x0 + o.x1) / 2 ? 'end' : 'start';
            stext(g, q + (anchor === 'end' ? -5 : 5), o.y0 - 4, a.label, { 'text-anchor': anchor, fill: C.ink2, 'font-size': 11.5, class: 'halo' });
          }
        } else {
          s('line', { y1: q, y2: q, x1: o.x0, x2: o.x1, stroke: C.muted, 'stroke-width': 1, 'shape-rendering': 'crispEdges' }, g);
          if (a.label) stext(g, o.x1, q - 5, a.label, { 'text-anchor': 'end', fill: C.ink2, 'font-size': 11.5, class: 'halo' });
        }
      }
    });
  }

  /* ---- 7.8 BAR family: bar, column, hbar, grouped, stacked, 100% stacked ---- */
  function seriesOf(cfg) {
    if (cfg.series && cfg.series.length) return cfg.series;
    return [{ key: cfg.yKey || cfg.valueKey || 'value', label: cfg.valueLabel || cfg.unit || 'Value' }];
  }

  /**
   * Band/value core used by bar and waterfall.
   * spec: {cats, horizontal, marks:[{cat, slot, slots, from, to, color, round, gapFrom}],
   *        domain:[min,max], fmt, labels:[{cat, at, text, slot, slots}], connectors:[{cat, v}],
   *        tip(catIndex), legend, summary, anns}
   */
  function bandChart(chart, spec) {
    var cfg = chart.cfg, C = chart.C, W = chart.W;
    var n = spec.cats.length, horiz = spec.horizontal;
    var fmt = spec.fmt;
    var dmin = Math.min(0, spec.domain[0]), dmax = Math.max(0, spec.domain[1]);
    if (cfg.yMin != null) dmin = cfg.yMin;
    if (cfg.yMax != null) dmax = cfg.yMax;
    var slotsMax = Math.max.apply(null, spec.marks.map(function (m) { return m.slots || 1; }).concat([1]));
    var root_, g, val, catStart, band, barW, plotLen, x0, x1, y0, y1, H, nt;
    var labelSize = 12;

    if (!horiz) {
      H = cfg.height || (W < 560 ? 280 : 320);
      var mt = 8 + (spec.labels && spec.labels.length ? 14 : 0) + (cfg.annotations && cfg.annotations.some(function (a) { return a.x != null; }) ? 12 : 0);
      nt = niceTicks(dmin, dmax, tickCount(H - 60));
      var dec = stepDecimals(nt.step);
      var ml = Math.ceil(maxTickW(nt.ticks, fmt, dec)) + 12;
      var mr = 6;
      plotLen = W - ml - mr;
      band = plotLen / Math.max(1, n);
      var fit = fitBandLabels(spec.cats, band);
      var mb = 12 + fit.rows * 14;
      x0 = ml; x1 = W - mr; y0 = mt; y1 = H - mb;
      val = linear(nt.min, nt.max, y1, y0);
      root_ = chart.svg(W, H, spec.summary);
      g = s('g', null, root_);
      valueAxis(g, C, val, nt.ticks, fmt, dec, { vertical: true, x0: x0, x1: x1 });
      catStart = function (i) { return x0 + i * band; };
      // x labels
      spec.cats.forEach(function (c, i) {
        fit.lines[i].forEach(function (line, li) {
          stext(g, catStart(i) + band / 2, y1 + 16 + li * 14, line, { 'text-anchor': 'middle', fill: C.ink2, 'font-size': FS });
        });
      });
    } else {
      var rowPad = slotsMax > 1 ? 14 : 12;
      barW = slotsMax > 1 ? Math.min(14, Math.max(8, Math.floor(28 / slotsMax) + 4)) : Math.min(24, cfg.barWidth || 20);
      band = cfg.rowHeight || (slotsMax * barW + (slotsMax - 1) * 2 + rowPad);
      var catW = Math.min(Math.max.apply(null, spec.cats.map(function (c) { return textW(c, FS); })) + 14, W * 0.38);
      var valLabW = spec.labels && spec.labels.length ? Math.max.apply(null, spec.labels.map(function (l) { return textW(l.text, labelSize, 600); })) + 10 : 12;
      x0 = catW; x1 = W - Math.max(valLabW, 12);
      nt = niceTicks(dmin, dmax, tickCount(x1 - x0, 90));
      var dec2 = stepDecimals(nt.step);
      // make room for the last tick label
      x1 = Math.min(x1, W - maxTickW(nt.ticks, fmt, dec2) / 2 - 2);
      y0 = 4; y1 = y0 + n * band;
      H = y1 + 24;
      val = linear(nt.min, nt.max, x0, x1);
      root_ = chart.svg(W, H, spec.summary);
      g = s('g', null, root_);
      valueAxis(g, C, val, nt.ticks, fmt, dec2, { vertical: false, y0: y0, y1: y1 });
      catStart = function (i) { return y0 + i * band; };
      spec.cats.forEach(function (c, i) {
        stext(g, x0 - 10, catStart(i) + band / 2, ellipsize(c, catW - 14, FS), { 'text-anchor': 'end', dy: '0.32em', fill: C.ink2, 'font-size': FS });
      });
    }

    // bar thickness for vertical
    function thick(slots) {
      if (horiz) return barW;
      if (slots > 1) return Math.max(2, Math.min(24, (band * 0.8 - (slots - 1) * 2) / slots));
      return Math.max(2, Math.min(cfg.barWidth || 24, band * 0.62));
    }
    function slotOffset(slot, slots) {
      var t = thick(slots), groupW = slots * t + (slots - 1) * 2;
      return band / 2 - groupW / 2 + slot * (t + 2);
    }

    // annotations and connectors (waterfall) go under the bars
    var annG = s('g', null, g);
    var base = val(0);
    (spec.connectors || []).forEach(function (cn) {
      var p = crisp(val(cn.v));
      var t = thick(1), a = catStart(cn.cat) + slotOffset(0, 1) + t, b = catStart(cn.cat + 1) + slotOffset(0, 1);
      if (!horiz) s('line', { x1: a, x2: b, y1: p, y2: p, stroke: C.base, 'stroke-width': 1, 'shape-rendering': 'crispEdges' }, g);
      else s('line', { y1: a, y2: b, x1: p, x2: p, stroke: C.base, 'stroke-width': 1, 'shape-rendering': 'crispEdges' }, g);
    });

    // marks, grouped per category so hover can dim the rest
    var groups = [];
    for (var ci = 0; ci < n; ci++) groups.push(s('g', { class: 'mark' }, g));
    spec.marks.forEach(function (m) {
      var slots = m.slots || 1, t = thick(slots);
      var off = catStart(m.cat) + slotOffset(m.slot || 0, slots);
      var p0 = val(m.from), p1 = val(m.to);
      if (m.gapFrom) { var dir = p1 > p0 ? 1 : -1; if (Math.abs(p1 - p0) > 2.5) p0 += 2 * dir; }
      var lo = Math.min(p0, p1), len = Math.abs(p1 - p0);
      if (len < 0.5) len = 0.5;
      var side = null;
      if (m.round !== false) side = horiz ? (p1 >= p0 ? 'right' : 'left') : (p1 <= p0 ? 'top' : 'bottom');
      var d = horiz ? barPath(lo, off, len, t, side) : barPath(off, lo, t, len, side);
      if (d) s('path', { d: d, fill: m.color }, groups[m.cat]);
    });

    // zero baseline on top of bars
    if (!horiz) s('line', { x1: x0, x2: x1, y1: crisp(base), y2: crisp(base), stroke: C.base, 'stroke-width': 1, 'shape-rendering': 'crispEdges' }, g);
    else s('line', { y1: y0, y2: y1, x1: crisp(base), x2: crisp(base), stroke: C.base, 'stroke-width': 1, 'shape-rendering': 'crispEdges' }, g);

    // direct labels (only when they fit)
    (spec.labels || []).forEach(function (l) {
      var slots = l.slots || 1, t = thick(slots);
      var center = catStart(l.cat) + slotOffset(l.slot || 0, slots) + t / 2;
      var p = val(l.at), tw = textW(l.text, labelSize, 600);
      if (!horiz) {
        if (tw > (slots > 1 ? t + 8 : band - 4)) return;
        var below = l.below;
        stext(groups[l.cat], center, below ? p + 15 : p - 6, l.text, { 'text-anchor': 'middle', fill: C.ink, 'font-size': labelSize, 'font-weight': 600, 'font-variant-numeric': 'tabular-nums', class: 'halo' });
      } else {
        var neg = l.left;
        stext(groups[l.cat], neg ? p - 6 : p + 6, center, l.text, { 'text-anchor': neg ? 'end' : 'start', dy: '0.32em', fill: C.ink, 'font-size': labelSize, 'font-weight': 600, 'font-variant-numeric': 'tabular-nums' });
      }
    });

    drawAnnotations(annG, C, cfg.annotations, {
      vertical: !horiz, x0: x0, x1: x1, y0: y0, y1: y1,
      val: val,
      pos: function (x) { var i = spec.cats.map(String).indexOf(String(x)); return i < 0 ? null : catStart(i) + band / 2; }
    });
    // annotation labels must sit above the bars: move label texts to the top layer
    Array.prototype.slice.call(annG.querySelectorAll('text')).forEach(function (t) { g.appendChild(t); });

    // hit targets: the whole category band
    var hits = s('g', null, root_);
    spec.cats.forEach(function (c, i) {
      var r = horiz ? { x: 0, y: catStart(i), width: W, height: band } : { x: catStart(i), y: y0 - 8, width: band, height: y1 - y0 + 8 };
      r.fill = 'transparent';
      var hit = s('rect', r, hits);
      var anchor = horiz ? { x: x1, y: catStart(i) + band / 2 } : { x: catStart(i) + band / 2, y: y0 + 20 };
      var idx = chart.addPoint({
        x: anchor.x, y: anchor.y,
        on: function () { groups.forEach(function (gg, j) { gg.classList.toggle('is-dim', j !== i); }); },
        off: function () { groups.forEach(function (gg) { gg.classList.remove('is-dim'); }); },
        tip: function () { return spec.tip(i); }
      });
      hit.addEventListener('pointermove', function (e) { chart.activate(idx, e.clientX, e.clientY); });
      hit.addEventListener('pointerdown', function (e) { chart.activate(idx, e.clientX, e.clientY); });
    });
  }

  function renderBar(chart, cfg) {
    var C = chart.C, data = cfg.data || [];
    var xKey = cfg.xKey || 'label';
    var series = seriesOf(cfg);
    var t = cfg.type;
    var stacked = cfg.stacked || t === 'stacked-bar' || t === 'stacked-bar-100' ? (cfg.stacked === 'percent' || t === 'stacked-bar-100' ? 'percent' : true) : false;
    var horizontal = cfg.horizontal || t === 'hbar';
    // auto-flip crowded column charts on phones
    if (!horizontal && cfg.horizontal !== false && chart.W < 520 && data.length > 6) horizontal = true;
    var fmt = makeFormat(stacked === 'percent' ? '%' : cfg.valueFormat);
    var rawFmt = makeFormat(cfg.valueFormat);
    var cats = data.map(function (d) { return String(d[xKey]); });
    var colors = series.map(function (sr, i) { return seriesColor(C, sr, i); });
    var marks = [], labels = [], lo = 0, hi = 0;
    var ns = series.length;

    data.forEach(function (d, ci) {
      if (stacked) {
        var total = sum(series, function (sr) { return Math.abs(+d[sr.key] || 0); });
        var pos = 0, neg = 0, lastPos = -1, lastNeg = -1, segs = [];
        series.forEach(function (sr, si) {
          var v = +d[sr.key]; if (!isFinite(v) || v === 0) return;
          if (stacked === 'percent') v = total ? (v / total) * 100 : 0;
          var m;
          if (v >= 0) { m = { cat: ci, from: pos, to: pos + v, color: colors[si], gapFrom: pos !== 0, round: false }; pos += v; lastPos = segs.length; }
          else { m = { cat: ci, from: neg, to: neg + v, color: colors[si], gapFrom: neg !== 0, round: false }; neg += v; lastNeg = segs.length; }
          segs.push(m);
        });
        if (lastPos >= 0) segs[lastPos].round = true;
        if (lastNeg >= 0) segs[lastNeg].round = true;
        marks = marks.concat(segs);
        lo = Math.min(lo, neg); hi = Math.max(hi, pos);
        if (stacked !== 'percent' && cfg.totals !== false && data.length <= 16) {
          var tot = sum(series, function (sr) { return +d[sr.key] || 0; });
          labels.push({ cat: ci, at: tot >= 0 ? pos : neg, text: rawFmt(tot), below: tot < 0, left: tot < 0 });
        }
      } else {
        series.forEach(function (sr, si) {
          var v = +d[sr.key]; if (!isFinite(v)) return;
          marks.push({ cat: ci, slot: si, slots: ns, from: 0, to: v, color: colors[si] });
          lo = Math.min(lo, v); hi = Math.max(hi, v);
          var showLab = cfg.labels != null ? cfg.labels : (ns === 1 && data.length <= 16);
          if (showLab) labels.push({ cat: ci, slot: si, slots: ns, at: v, text: fmt(v), below: v < 0, left: v < 0 });
        });
      }
    });
    if (stacked === 'percent') { lo = 0; hi = 100; }

    chart.legend(series.map(function (sr, i) { return { label: sr.label || sr.key, color: colors[i], shape: 'rect' }; }));
    bandChart(chart, {
      cats: cats, horizontal: horizontal, marks: marks, labels: labels, domain: [lo, hi], fmt: fmt,
      summary: (horizontal ? 'Horizontal bar' : 'Bar') + ' chart, ' + cats.length + ' categories' + (ns > 1 ? ', ' + ns + ' series' + (stacked ? ' stacked' : '') : ''),
      tip: function (ci) {
        var d = data[ci], total = sum(series, function (sr) { return +d[sr.key] || 0; });
        var rows = series.map(function (sr, si) {
          var v = +d[sr.key];
          var shown = stacked === 'percent' ? fmt(total ? v / total * 100 : 0, 1) + '' : rawFmt(v);
          return { color: colors[si], value: shown, label: (sr.label || sr.key) + (stacked === 'percent' ? ' (' + rawFmt(v) + ')' : '') };
        });
        if (stacked !== 'percent') rows.reverse(); // top segment first, matching the stack
        return { head: cats[ci], rows: rows, total: stacked && ns > 1 ? { value: rawFmt(total), label: 'Total' } : null, note: d.note };
      }
    });
    chart.table([{ label: cfg.xLabel || xKey }].concat(series.map(function (sr) { return { label: sr.label || sr.key, num: true }; })).concat(stacked && ns > 1 ? [{ label: 'Total', num: true }] : []),
      data.map(function (d) {
        var row = [String(d[xKey])].concat(series.map(function (sr) { return rawFmt(+d[sr.key]); }));
        if (stacked && ns > 1) row.push(rawFmt(sum(series, function (sr) { return +d[sr.key] || 0; })));
        return row;
      }));
  }
  Charts.register('bar column hbar grouped-bar stacked-bar stacked-bar-100', renderBar);

  /* ---- 7.9 WATERFALL ("where does $1 go") ---- */
  function renderWaterfall(chart, cfg) {
    var C = chart.C, data = cfg.data || [];
    var xKey = cfg.xKey || 'label', vKey = cfg.valueKey || 'value';
    var fmt = makeFormat(cfg.valueFormat), sfmt = signed(fmt);
    var horizontal = cfg.horizontal != null ? cfg.horizontal : chart.W < 560;
    var run = 0, lo = 0, hi = 0, marks = [], labels = [], conns = [], steps = [];
    data.forEach(function (d, i) {
      var kind = d.kind || (i === 0 ? 'total' : 'delta');
      var v = d[vKey], from, to, color;
      if (kind === 'total') { from = 0; to = isNum(v) ? v : run; run = to; color = C.total; }
      else { v = +v || 0; from = run; to = run + v; run = to; color = v >= 0 ? C.pos : C.neg; }
      steps.push({ label: String(d[xKey]), kind: kind, from: from, to: to, delta: to - from, note: d.note });
      marks.push({ cat: i, from: from, to: to, color: color, gapFrom: false });
      lo = Math.min(lo, from, to); hi = Math.max(hi, from, to);
      if (cfg.labels !== false) {
        var up = to >= from;
        labels.push({ cat: i, at: horizontal ? Math.max(from, to) : (up ? to : to), text: kind === 'total' ? fmt(to) : sfmt(to - from), below: !horizontal && !up, left: false });
      }
      if (i < data.length - 1) conns.push({ cat: i, v: to });
    });
    var hasUp = steps.some(function (s_) { return s_.kind !== 'total' && s_.delta >= 0; });
    var hasDown = steps.some(function (s_) { return s_.kind !== 'total' && s_.delta < 0; });
    chart.legend([{ label: cfg.totalLabel || 'Total', color: C.total }].concat(hasUp ? [{ label: cfg.increaseLabel || 'Increase', color: C.pos }] : []).concat(hasDown ? [{ label: cfg.decreaseLabel || 'Decrease', color: C.neg }] : []));
    bandChart(chart, {
      cats: steps.map(function (s_) { return s_.label; }), horizontal: horizontal, marks: marks, labels: labels, connectors: conns,
      domain: [lo, hi], fmt: fmt, summary: 'Waterfall chart with ' + steps.length + ' steps',
      tip: function (i) {
        var st = steps[i];
        var rows = st.kind === 'total' ? [{ color: C.total, value: fmt(st.to), label: 'Total' }]
          : [{ color: st.delta >= 0 ? C.pos : C.neg, value: sfmt(st.delta), label: st.delta >= 0 ? 'Increase' : 'Decrease' }, { value: fmt(st.to), label: 'Running total' }];
        return { head: st.label, rows: rows, note: st.note };
      }
    });
    chart.table([{ label: 'Step' }, { label: 'Change', num: true }, { label: 'Running total', num: true }],
      steps.map(function (st) { return [st.label, st.kind === 'total' ? '—' : sfmt(st.delta), fmt(st.to)]; }));
  }
  Charts.register('waterfall', renderWaterfall);

  /* ---- 7.10 LINE / AREA / STACKED AREA ---- */
  function renderLine(chart, cfg) {
    var C = chart.C, W = chart.W, data = cfg.data || [];
    var isArea = cfg.type === 'area' || cfg.type === 'stacked-area';
    var stacked = isArea && (cfg.stacked || cfg.type === 'stacked-area');
    var xKey = cfg.xKey || 'label';
    var series = seriesOf(cfg);
    var fmt = makeFormat(cfg.valueFormat);
    var xs = data.map(function (d) { return d[xKey]; });
    var numericX = cfg.xType !== 'category' && xs.length > 1 && xs.every(isNum);
    var colors = series.map(function (sr, i) { return seriesColor(C, sr, i); });
    var n = data.length;
    var vals = series.map(function (sr) { return data.map(function (d) { var v = d[sr.key]; return v == null || v === '' || !isFinite(v) ? null : +v; }); });
    var lows = [], highs = [];
    if (stacked) {
      var acc = data.map(function () { return 0; });
      vals.forEach(function (arr) {
        lows.push(acc.slice());
        arr.forEach(function (v, i) { acc[i] += v || 0; });
        highs.push(acc.slice());
      });
    }
    var all = [];
    (stacked ? highs : vals).forEach(function (a) { a.forEach(function (v) { if (v != null) all.push(v); }); });
    var dmin = cfg.yMin != null ? cfg.yMin : Math.min(0, Math.min.apply(null, all.concat([0])));
    var dmax = cfg.yMax != null ? cfg.yMax : Math.max.apply(null, all.concat([0]));
    var H = cfg.height || (W < 560 ? 260 : 320);
    var hasXAnn = (cfg.annotations || []).some(function (a) { return a.x != null; }) || cfg.forecastFrom != null;
    var mt = 12 + (hasXAnn ? 18 : 0), mb = 28;
    var nt = niceTicks(dmin, dmax, tickCount(H - mt - mb));
    var dec = stepDecimals(nt.step);
    var ml = Math.ceil(maxTickW(nt.ticks, fmt, dec)) + 12;
    // end labels: value for one series, series name for 2-4
    var endLabels = cfg.endLabels !== false && series.length <= 4 && W >= 520;
    var y0 = mt, y1 = H - mb;
    var y = linear(nt.min, nt.max, y1, y0);
    var lastIdx = vals.map(function (arr) { for (var i = arr.length - 1; i >= 0; i--) if (arr[i] != null) return i; return -1; });
    var endText = series.map(function (sr, si) {
      var li = lastIdx[si]; if (li < 0) return '';
      return series.length === 1 ? fmt(stacked ? highs[si][li] : vals[si][li]) : (sr.label || sr.key);
    });
    if (endLabels) { // skip end labels if any two would collide; the legend carries identity
      var endYs = series.map(function (sr, si) { var li = lastIdx[si]; return li < 0 ? null : y(stacked ? highs[si][li] : vals[si][li]); }).filter(function (v) { return v != null; }).sort(function (a, b) { return a - b; });
      if (endYs.some(function (v, i) { return i > 0 && v - endYs[i - 1] < 14; })) endLabels = false;
    }
    var mr = endLabels ? Math.min(160, Math.max.apply(null, endText.map(function (t) { return textW(t, FS, 600); })) + 16) : 14;
    var x0 = ml, x1 = W - mr;
    var xmin = numericX ? Math.min.apply(null, xs) : 0, xmax = numericX ? Math.max.apply(null, xs) : n - 1;
    var xsc = linear(xmin, xmax === xmin ? xmin + 1 : xmax, x0, x1);
    function X(i) { return n === 1 ? (x0 + x1) / 2 : xsc(numericX ? xs[i] : i); }
    function posOf(xv) { for (var i = 0; i < n; i++) if (String(xs[i]) === String(xv)) return X(i); return numericX && isNum(xv) ? xsc(xv) : null; }

    var svg_ = chart.svg(W, H, (isArea ? (stacked ? 'Stacked area' : 'Area') : 'Line') + ' chart, ' + series.length + ' series, ' + n + ' points');
    var g = s('g', null, svg_);
    // forecast shading
    if (cfg.forecastFrom != null) {
      var fi = xs.map(String).indexOf(String(cfg.forecastFrom));
      var fx = fi > 0 ? (X(fi - 1) + X(fi)) / 2 : posOf(cfg.forecastFrom); // start half-way from the last actual
      if (fx != null) {
        var fEnd = x1 + (n > 1 ? Math.min(12, (X(1) - X(0)) / 2) : 0);
        s('rect', { x: fx, y: y0, width: Math.max(0, fEnd - fx), height: y1 - y0, fill: C.grid, opacity: C.dark ? 0.5 : 0.45 }, g);
        var fl = cfg.forecastLabel || 'Forecast', flx = fx + 6, fla = 'start';
        if (flx + textW(fl, 11.5) > W - 1) { flx = W - 1; fla = 'end'; }
        stext(g, flx, y0 - 8, fl, { fill: C.ink2, 'font-size': 11.5, 'text-anchor': fla });
      }
    }
    valueAxis(g, C, y, nt.ticks, fmt, dec, { vertical: true, x0: x0, x1: x1 });
    // x labels
    if (numericX && !cfg.xTicks) {
      var xt = niceTicks(xmin, xmax, tickCount(x1 - x0, 80));
      var isYear = xs.every(function (v) { return v % 1 === 0 && v > 1800 && v < 2200; });
      var step = isYear ? Math.max(1, Math.round(xt.step)) : xt.step;
      var xfmt = cfg.xFormat ? makeFormat(cfg.xFormat) : function (v) { return isYear ? String(v) : makeFormat('')(v); };
      for (var tv = Math.ceil(xmin / step) * step; tv <= xmax + 1e-9; tv += step) {
        var tl = xfmt(+tv.toFixed(6)), tx = xsc(tv), tw = textW(tl, FS), ta = 'middle';
        if (tx + tw / 2 > W - 1) { ta = 'end'; tx = W - 1; } else if (tx - tw / 2 < 0) { ta = 'start'; tx = 0; }
        stext(g, tx, y1 + 18, tl, { 'text-anchor': ta, fill: C.ink2, 'font-size': FS });
      }
    } else {
      var labs = xs.map(String);
      var maxLW = Math.max.apply(null, labs.map(function (l) { return textW(l, FS); }).concat([0]));
      var gap = n > 1 ? (x1 - x0) / (n - 1) : x1 - x0;
      var every = Math.max(1, Math.ceil((maxLW + 14) / gap));
      labs.forEach(function (l, i) {
        if (i % every !== 0) return;
        var px = X(i), lw = textW(l, FS), anchor = 'middle';
        if (px - lw / 2 < 0) { anchor = 'start'; px = Math.max(0, px - lw / 2); }
        else if (px + lw / 2 > W - 1) { anchor = 'end'; px = W - 1; }
        stext(g, px, y1 + 18, l, { 'text-anchor': anchor, fill: C.ink2, 'font-size': FS });
      });
    }
    s('line', { x1: x0, x2: x1, y1: crisp(y(Math.max(nt.min, 0))), y2: crisp(y(Math.max(nt.min, 0))), stroke: C.base, 'stroke-width': 1, 'shape-rendering': 'crispEdges' }, g);

    function linePath(arr) {
      var d = '', pen = false;
      arr.forEach(function (v, i) {
        if (v == null) { pen = false; return; }
        d += (pen ? 'L' : 'M') + X(i).toFixed(1) + ',' + y(v).toFixed(1);
        pen = true;
      });
      return d;
    }
    function areaPath(top, bot) {
      // contiguous runs only
      var d = '', i = 0;
      while (i < n) {
        while (i < n && top[i] == null) i++;
        var start = i;
        while (i < n && top[i] != null) i++;
        var end = i - 1;
        if (end < start) continue;
        var seg = '';
        for (var k = start; k <= end; k++) seg += (k === start ? 'M' : 'L') + X(k).toFixed(1) + ',' + y(top[k]).toFixed(1);
        for (var k2 = end; k2 >= start; k2--) seg += 'L' + X(k2).toFixed(1) + ',' + y(bot[k2]).toFixed(1);
        d += seg + 'Z';
      }
      return d;
    }
    var baseArr = data.map(function () { return Math.max(nt.min, 0); });
    var layer = s('g', null, g);
    var lines = [];
    series.forEach(function (sr, si) {
      var top = stacked ? highs[si].map(function (v, i) { return vals[si][i] == null ? null : v; }) : vals[si];
      if (isArea) {
        s('path', { d: areaPath(top, stacked ? lows[si] : baseArr), fill: colors[si], 'fill-opacity': stacked ? (C.dark ? 0.42 : 0.34) : 0.1, stroke: 'none' }, layer);
      }
      lines.push(s('path', { d: linePath(top), fill: 'none', stroke: colors[si], 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', class: 'mark' }, layer));
    });
    // end markers + end labels
    var ends = series.map(function (sr, si) {
      var li = lastIdx[si]; if (li < 0) return null;
      var v = stacked ? highs[si][li] : vals[si][li];
      s('circle', { cx: X(li), cy: y(v), r: 4, fill: colors[si], stroke: C.surface, 'stroke-width': 2 }, layer);
      return { si: si, x: X(li), y: y(v) };
    }).filter(Boolean);
    if (endLabels) {
      var sorted = ends.slice().sort(function (a, b) { return a.y - b.y; });
      var collide = sorted.some(function (e, i) { return i > 0 && e.y - sorted[i - 1].y < 14; });
      if (!collide) ends.forEach(function (e) {
        stext(g, e.x + 9, e.y, endText[e.si], { dy: '0.32em', fill: series.length === 1 ? C.ink : C.ink2, 'font-size': FS, 'font-weight': series.length === 1 ? 600 : 500, class: 'halo' });
      });
    }
    drawAnnotations(g, C, cfg.annotations, { vertical: true, x0: x0, x1: x1, y0: y0, y1: y1, val: y, pos: posOf });

    // crosshair + tooltip
    var cross = s('line', { y1: y0, y2: y1, stroke: C.muted, 'stroke-width': 1, visibility: 'hidden', 'shape-rendering': 'crispEdges' }, g);
    var dots = series.map(function (sr, si) { return s('circle', { r: 4.5, fill: colors[si], stroke: C.surface, 'stroke-width': 2, visibility: 'hidden' }, g); });
    var overlay = s('rect', { x: x0 - 6, y: y0, width: x1 - x0 + 12, height: y1 - y0, fill: 'transparent' }, svg_);
    function tipFor(i) {
      var rows = series.map(function (sr, si) { return { color: colors[si], value: fmt(vals[si][i]), label: sr.label || sr.key }; });
      if (stacked) rows.reverse();
      var tot = stacked && series.length > 1 ? { value: fmt(sum(vals.map(function (a) { return a[i] || 0; }))), label: 'Total' } : null;
      var fIdx = cfg.forecastFrom != null ? xs.map(String).indexOf(String(cfg.forecastFrom)) : -1;
      return { head: String(xs[i]) + (fIdx >= 0 && i >= fIdx ? ' (forecast)' : ''), rows: rows, total: tot, note: data[i].note };
    }
    for (var pi = 0; pi < n; pi++) (function (i) {
      chart.addPoint({
        x: X(i), y: y0 + 12,
        on: function () {
          cross.setAttribute('x1', crisp(X(i))); cross.setAttribute('x2', crisp(X(i))); cross.setAttribute('visibility', 'visible');
          dots.forEach(function (dt, si) {
            var v = stacked ? (vals[si][i] == null ? null : highs[si][i]) : vals[si][i];
            if (v == null) { dt.setAttribute('visibility', 'hidden'); return; }
            dt.setAttribute('cx', X(i)); dt.setAttribute('cy', y(v)); dt.setAttribute('visibility', 'visible');
          });
        },
        off: function () { cross.setAttribute('visibility', 'hidden'); dots.forEach(function (dt) { dt.setAttribute('visibility', 'hidden'); }); },
        tip: function () { return tipFor(i); }
      });
    })(pi);
    function nearest(e) {
      var r = svg_.getBoundingClientRect(), px = e.clientX - r.left, best = 0, bd = Infinity;
      for (var i = 0; i < n; i++) { var dd = Math.abs(X(i) - px); if (dd < bd) { bd = dd; best = i; } }
      return best;
    }
    overlay.addEventListener('pointermove', function (e) { chart.activate(nearest(e), e.clientX, e.clientY); });
    overlay.addEventListener('pointerdown', function (e) { chart.activate(nearest(e), e.clientX, e.clientY); });

    chart.legend(series.map(function (sr, i) { return { label: sr.label || sr.key, color: colors[i], shape: isArea ? 'rect' : 'line' }; }));
    chart.table([{ label: cfg.xLabel || xKey }].concat(series.map(function (sr) { return { label: sr.label || sr.key, num: true }; })).concat(stacked && series.length > 1 ? [{ label: 'Total', num: true }] : []),
      data.map(function (d, i) {
        var row = [String(xs[i])].concat(series.map(function (sr, si) { return fmt(vals[si][i]); }));
        if (stacked && series.length > 1) row.push(fmt(sum(vals.map(function (a) { return a[i] || 0; }))));
        return row;
      }));
  }
  Charts.register('line area stacked-area', renderLine);

  /* ---- 7.11 SCATTER / BUBBLE (max 3 series) ---- */
  function renderScatter(chart, cfg) {
    var C = chart.C, W = chart.W, data = (cfg.data || []).slice();
    var xKey = cfg.xKey || 'x', yKey = cfg.yKey || 'y', rKey = cfg.rKey || (cfg.type === 'bubble' ? 'r' : null);
    var gKey = cfg.groupKey || 'series', lKey = cfg.labelKey || 'label';
    var series = cfg.series && cfg.series.length ? cfg.series : [{ key: null, label: cfg.valueLabel || 'Values' }];
    if (series.length > 3) console.warn('[Atlas] scatter/bubble: more than 3 series is not colorblind-safe; extra series are shown in gray. Fold them into "Other" or use small multiples.');
    var colors = series.map(function (sr, i) { return i < 3 ? seriesColor(C, sr, i) : C.muted; });
    function sIdx(d) { if (series.length === 1) return 0; for (var i = 0; i < series.length; i++) if (series[i].key === d[gKey]) return i; return series.length - 1; }
    var xf = makeFormat(cfg.xFormat), yf = makeFormat(cfg.yFormat || cfg.valueFormat), rf = makeFormat(cfg.rFormat);
    var xsV = data.map(function (d) { return +d[xKey]; }), ysV = data.map(function (d) { return +d[yKey]; });
    var H0 = cfg.height || (W < 560 ? 300 : 380);
    var maxR0 = rKey ? (cfg.maxRadius || clamp(W / 22, 12, 34)) : 4.5;
    // pad each domain by the largest radius (in data units) so circles stay inside the plot
    function pad(lo, hi, px) { var span = (hi - lo) || Math.abs(hi) || 1; var p = span * (0.04 + 1.3 * maxR0 / Math.max(80, px)); return [lo - p, hi + p]; }
    var xd = pad(Math.min.apply(null, xsV), Math.max.apply(null, xsV), W - 90), yd = pad(Math.min.apply(null, ysV), Math.max.apply(null, ysV), H0 - 60);
    if (cfg.xZero !== false && Math.min.apply(null, xsV) >= 0 && cfg.xZero) xd[0] = 0;
    if (cfg.yZero !== false && Math.min.apply(null, ysV) >= 0 && cfg.yZero) yd[0] = 0;
    if (cfg.xMin != null) xd[0] = cfg.xMin; if (cfg.xMax != null) xd[1] = cfg.xMax;
    if (cfg.yMin != null) yd[0] = cfg.yMin; if (cfg.yMax != null) yd[1] = cfg.yMax;
    var H = H0, maxR = maxR0;
    var yt = niceTicks(yd[0], yd[1], tickCount(H - 70)), ydec = stepDecimals(yt.step);
    var ml = Math.ceil(maxTickW(yt.ticks, yf, ydec)) + 12 + (cfg.yLabel ? 18 : 0);
    var mt = 14, mb = 30 + (cfg.xLabel ? 18 : 0), mr = 18;
    var x0 = ml, x1 = W - mr, y0 = mt, y1 = H - mb;
    var xt = niceTicks(xd[0], xd[1], tickCount(x1 - x0, 90)), xdec = stepDecimals(xt.step);
    var X = linear(xt.min, xt.max, x0, x1), Y = linear(yt.min, yt.max, y1, y0);
    var rMax = rKey ? Math.max.apply(null, data.map(function (d) { return +d[rKey] || 0; })) : 1;
    function R(d) { return rKey ? Math.max(4, Math.sqrt((+d[rKey] || 0) / (rMax || 1)) * maxR) : 4.5; }

    var svg_ = chart.svg(W, H, (rKey ? 'Bubble' : 'Scatter') + ' chart with ' + data.length + ' points');
    var g = s('g', null, svg_);
    valueAxis(g, C, Y, yt.ticks, yf, ydec, { vertical: true, x0: x0, x1: x1 });
    xt.ticks.forEach(function (t) {
      var p = crisp(X(t));
      s('line', { x1: p, x2: p, y1: y0, y2: y1, stroke: t === 0 ? C.base : C.grid, 'stroke-width': 1, 'shape-rendering': 'crispEdges' }, g);
      stext(g, p, y1 + 17, t === 0 ? '0' : xf(t, xdec), { 'text-anchor': 'middle', fill: C.muted, 'font-size': FS });
    });
    if (cfg.xLabel) stext(g, (x0 + x1) / 2, H - 4, cfg.xLabel, { 'text-anchor': 'middle', fill: C.ink2, 'font-size': FS });
    if (cfg.yLabel) stext(g, 0, 0, cfg.yLabel, { 'text-anchor': 'middle', fill: C.ink2, 'font-size': FS, transform: 'translate(' + 11 + ',' + ((y0 + y1) / 2) + ') rotate(-90)' });
    drawAnnotations(g, C, cfg.annotations, { vertical: true, x0: x0, x1: x1, y0: y0, y1: y1, val: Y, pos: function (v) { return isNum(v) ? X(v) : null; } });

    var pts = data.map(function (d, i) { return { d: d, i: i, x: X(+d[xKey]), y: Y(+d[yKey]), r: R(d), si: sIdx(d) }; });
    var drawOrder = pts.slice().sort(function (a, b) { return b.r - a.r; });
    var layer = s('g', null, g);
    drawOrder.forEach(function (p) {
      p.el = s('circle', { cx: p.x, cy: p.y, r: p.r, fill: colors[p.si], 'fill-opacity': rKey ? 0.78 : 1, stroke: C.surface, 'stroke-width': 2, class: 'mark' }, layer);
    });
    // selective direct labels, skipping collisions
    var labelSet = cfg.labels;
    var placed = [];
    pts.forEach(function (p) {
      var name = p.d[lKey]; if (name == null) return;
      var want = labelSet === 'all' || (Array.isArray(labelSet) && labelSet.indexOf(name) >= 0) || p.d.highlight || (labelSet == null && data.length <= 8);
      if (!want || labelSet === 'none') return;
      var tw = textW(name, 11.5, 500), lx = p.x + p.r + 4, ly = p.y;
      var anchor = 'start';
      if (lx + tw > x1 + mr - 2) { lx = p.x - p.r - 4; anchor = 'end'; }
      var box = anchor === 'start' ? [lx, ly - 7, lx + tw, ly + 7] : [lx - tw, ly - 7, lx, ly + 7];
      if (placed.some(function (b) { return !(box[2] < b[0] || box[0] > b[2] || box[3] < b[1] || box[1] > b[3]); })) return;
      placed.push(box);
      stext(g, lx, ly, name, { 'text-anchor': anchor, dy: '0.32em', fill: C.ink, 'font-size': 11.5, 'font-weight': 500, class: 'halo' });
    });
    var ring = s('circle', { fill: 'none', stroke: C.ink, 'stroke-width': 1.5, visibility: 'hidden' }, g);
    var byX = pts.slice().sort(function (a, b) { return a.x - b.x; });
    byX.forEach(function (p) {
      p.idx = chart.addPoint({
        x: p.x, y: p.y - p.r,
        on: function () { ring.setAttribute('cx', p.x); ring.setAttribute('cy', p.y); ring.setAttribute('r', p.r + 3); ring.setAttribute('visibility', 'visible'); },
        off: function () { ring.setAttribute('visibility', 'hidden'); },
        tip: function () {
          var rows = [{ color: colors[p.si], value: xf(+p.d[xKey]), label: cfg.xLabel || xKey }, { value: yf(+p.d[yKey]), label: cfg.yLabel || yKey }];
          if (rKey) rows.push({ value: rf(+p.d[rKey]), label: cfg.rLabel || rKey });
          return { head: (p.d[lKey] != null ? p.d[lKey] : 'Point') + (series.length > 1 ? ' · ' + (series[p.si].label || series[p.si].key) : ''), rows: rows, note: p.d.note };
        }
      });
    });
    // nearest-point hit layer (the pointer only has to be closest)
    var overlay = s('rect', { x: x0, y: y0, width: x1 - x0, height: y1 - y0, fill: 'transparent' }, svg_);
    function pick(e) {
      var r = svg_.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top, best = null, bd = Infinity;
      pts.forEach(function (p) { var dd = Math.hypot(p.x - px, p.y - py) - p.r; if (dd < bd) { bd = dd; best = p; } });
      if (best && bd < 28) chart.activate(best.idx, e.clientX, e.clientY); else chart.deactivate();
    }
    overlay.addEventListener('pointermove', pick);
    overlay.addEventListener('pointerdown', pick);

    var lg = series.length > 1 ? series.map(function (sr, i) { return { label: sr.label || sr.key, color: colors[i], shape: 'dot' }; }) : [];
    if (rKey && cfg.rLabel) lg.push({ label: 'Circle area = ' + cfg.rLabel, color: C.ink2, shape: 'ring' });
    chart.legend(lg, lg.length > 0);
    var cols = [{ label: cfg.labelTitle || 'Name' }];
    if (series.length > 1) cols.push({ label: 'Series' });
    cols.push({ label: cfg.xLabel || xKey, num: true }, { label: cfg.yLabel || yKey, num: true });
    if (rKey) cols.push({ label: cfg.rLabel || rKey, num: true });
    chart.table(cols, pts.map(function (p) {
      var row = [p.d[lKey] != null ? String(p.d[lKey]) : '#' + (p.i + 1)];
      if (series.length > 1) row.push(series[p.si].label || series[p.si].key);
      row.push(xf(+p.d[xKey]), yf(+p.d[yKey]));
      if (rKey) row.push(rf(+p.d[rKey]));
      return row;
    }));
  }
  Charts.register('scatter bubble', renderScatter);

  /* ---- 7.12 SANKEY (money flowing through the layers) ---- */
  function renderSankey(chart, cfg) {
    var C = chart.C, fmt = makeFormat(cfg.valueFormat || '$bn');
    var nodes = (cfg.nodes || []).map(function (n, i) { return Object.assign({ index: i, ins: [], outs: [] }, n); });
    var byId = {};
    nodes.forEach(function (n) { byId[n.id] = n; });
    var links = (cfg.links || []).map(function (l, i) {
      var L = Object.assign({ index: i }, l);
      L.s = byId[l.source]; L.t = byId[l.target];
      if (!L.s || !L.t) throw new Error('sankey link ' + i + ' refers to an unknown node');
      L.s.outs.push(L); L.t.ins.push(L);
      return L;
    });
    // columns: explicit, else longest path from sources
    nodes.forEach(function (n) {
      if (n.column == null) {
        var depth = 0, frontier = [n], guard = 0;
        while (frontier.length && guard++ < 50) {
          var next = [];
          frontier.forEach(function (f) { f.ins.forEach(function (l) { next.push(l.s); }); });
          if (next.length) depth++;
          frontier = next;
        }
        n.column = depth;
      }
      n.value = n.value != null ? n.value : Math.max(sum(n.ins, function (l) { return l.value; }), sum(n.outs, function (l) { return l.value; }));
    });
    var nCols = Math.max.apply(null, nodes.map(function (n) { return n.column; })) + 1;
    var cols = [];
    for (var c = 0; c < nCols; c++) cols.push(nodes.filter(function (n) { return n.column === c; }));

    var minW = cfg.minWidth || 680;
    var W = Math.max(chart.W, minW);
    var H = cfg.height || 440;
    var headH = cfg.columns ? 22 : 0;
    var nodeW = 12, pad = cfg.nodePadding || 16;
    // reserve room on the right for the last column's labels
    var lastLabelW = Math.max.apply(null, cols[nCols - 1].map(function (n) { return Math.max(textW(n.label || n.id, 12.5, 600), textW(fmt(n.value), 12)); }).concat([40]));
    var x0 = 2, x1 = W - lastLabelW - 12 - nodeW, y0 = headH + 4, y1 = H - 4;
    var colX = function (ci) { return nCols === 1 ? x0 : x0 + ci * (x1 - x0) / (nCols - 1); };
    var ky = Math.min.apply(null, cols.map(function (col) { return (y1 - y0 - (col.length - 1) * pad) / (sum(col, function (n) { return n.value; }) || 1); }));
    cols.forEach(function (col, ci) {
      var used = sum(col, function (n) { return n.value * ky; }) + (col.length - 1) * pad;
      var yy = y0 + (y1 - y0 - used) / 2;
      col.forEach(function (n) { n.x = colX(ci); n.y = yy; n.h = Math.max(1, n.value * ky); yy += n.h + pad; });
    });
    // stack link ends on each node, ordered to minimise crossings
    nodes.forEach(function (n) {
      n.outs.sort(function (a, b) { return a.t.y - b.t.y; });
      n.ins.sort(function (a, b) { return a.s.y - b.s.y; });
      var oy = n.y; n.outs.forEach(function (l) { l.sy = oy; l.w = Math.max(1, l.value * ky); oy += l.w; });
      var iy = n.y; n.ins.forEach(function (l) { l.ty = iy; iy += Math.max(1, l.value * ky); });
    });
    // node colors: group slot, else column slot (fixed order)
    var groupKeys = (cfg.groups || []).map(function (g_) { return g_.key; });
    function nodeColor(n) {
      if (typeof n.color === 'number') return C.cat[n.color - 1] || C.muted;
      if (n.group != null && groupKeys.length) { var gi = groupKeys.indexOf(n.group); return gi >= 0 && gi < 8 ? C.cat[gi] : C.muted; }
      return n.column < 8 ? C.cat[n.column] : C.muted;
    }
    nodes.forEach(function (n) { n.color = nodeColor(n); });

    var svg_ = chart.svg(W, H, 'Flow diagram with ' + nodes.length + ' nodes and ' + links.length + ' flows');
    var g = s('g', null, svg_);
    if (cfg.columns) cfg.columns.forEach(function (label, ci) {
      if (ci >= nCols) return;
      var anchor = ci === 0 ? 'start' : 'start';
      stext(g, colX(ci), 12, String(label).toUpperCase(), { 'text-anchor': anchor, fill: C.muted, 'font-size': 10.5, 'font-weight': 650, 'letter-spacing': '0.06em' });
    });
    var linkG = s('g', { fill: 'none' }, g);
    var baseOp = C.dark ? 0.36 : 0.32;
    links.forEach(function (l) {
      var sx = l.s.x + nodeW, tx = l.t.x, mx = (sx + tx) / 2;
      var w = l.w;
      var d = 'M' + sx + ',' + l.sy + 'C' + mx + ',' + l.sy + ' ' + mx + ',' + l.ty + ' ' + tx + ',' + l.ty +
        'L' + tx + ',' + (l.ty + w) + 'C' + mx + ',' + (l.ty + w) + ' ' + mx + ',' + (l.sy + w) + ' ' + sx + ',' + (l.sy + w) + 'Z';
      l.el = s('path', { d: d, fill: l.s.color, 'fill-opacity': baseOp, stroke: 'none' }, linkG);
    });
    var nodeG = s('g', null, g);
    nodes.forEach(function (n) {
      n.el = s('rect', { x: n.x, y: n.y, width: nodeW, height: n.h, rx: 2, fill: n.color }, nodeG);
    });
    // labels to the right of each node (halo keeps them legible over links)
    var labG = s('g', null, g);
    var gapW = nCols > 1 ? (x1 - x0) / (nCols - 1) - nodeW - 14 : lastLabelW;
    nodes.forEach(function (n) {
      if (n.h < 9 && !cfg.labelSmall) return;
      var lx = n.x + nodeW + 6, cy = n.y + n.h / 2;
      var maxW = n.column === nCols - 1 ? lastLabelW + 4 : gapW;
      // wrap long names so they never run into the next column
      var lines = wrap(n.label || n.id, maxW, 12.5, n.h >= 40 ? 2 : 1, 600).lines;
      var showVal = n.h >= 14 * lines.length + 12;
      var rows = lines.length + (showVal ? 1 : 0);
      var top = cy - (rows - 1) * 7.5;
      lines.forEach(function (ln, li) { stext(labG, lx, top + li * 15, ln, { dy: '0.32em', fill: C.ink, 'font-size': 12.5, 'font-weight': 600, class: 'halo' }); });
      if (showVal) stext(labG, lx, top + lines.length * 15, fmt(n.value), { dy: '0.32em', fill: C.ink2, 'font-size': 12, class: 'halo', 'font-variant-numeric': 'tabular-nums' });
    });
    // path highlighting: everything upstream and downstream of the hovered element
    function trace(startNodes, startLinks) {
      var ln = {}, nd = {};
      function up(n) { if (nd['u' + n.index]) return; nd['u' + n.index] = 1; nd[n.index] = 1; n.ins.forEach(function (l) { ln[l.index] = 1; up(l.s); }); }
      function down(n) { if (nd['d' + n.index]) return; nd['d' + n.index] = 1; nd[n.index] = 1; n.outs.forEach(function (l) { ln[l.index] = 1; down(l.t); }); }
      startNodes.forEach(function (n) { up(n); down(n); });
      startLinks.forEach(function (l) { ln[l.index] = 1; nd[l.s.index] = 1; nd[l.t.index] = 1; up(l.s); down(l.t); });
      return { ln: ln, nd: nd };
    }
    function highlight(set) {
      links.forEach(function (l) { l.el.setAttribute('fill-opacity', set ? (set.ln[l.index] ? Math.min(0.75, baseOp + 0.3) : 0.08) : baseOp); });
      nodes.forEach(function (n) { n.el.setAttribute('opacity', set && !set.nd[n.index] ? 0.3 : 1); });
    }
    var total = sum(cols[0], function (n) { return n.value; });
    function bind(el, idx) {
      el.addEventListener('pointermove', function (e) { chart.activate(idx, e.clientX, e.clientY); });
      el.addEventListener('pointerdown', function (e) { chart.activate(idx, e.clientX, e.clientY); });
    }
    function addLink(l) {
      bind(l.el, chart.addPoint({
        x: (l.s.x + nodeW + l.t.x) / 2, y: (l.sy + l.ty) / 2 + l.w / 2,
        on: function () { highlight(trace([], [l])); },
        off: function () { highlight(null); },
        tip: function () {
          return { head: (l.s.label || l.s.id) + ' \u2192 ' + (l.t.label || l.t.id), rows: [{ color: l.s.color, value: fmt(l.value), label: l.label || 'Flow' }, { value: total ? Math.round(l.value / total * 100) + '%' : '\u2014', label: 'of first-column total' }], note: l.note };
        }
      }));
    }
    function addNode(n) {
      var hit = s('rect', { x: n.x - 4, y: n.y - 2, width: nodeW + 8, height: n.h + 4, fill: 'transparent' }, g);
      bind(hit, chart.addPoint({
        x: n.x + nodeW, y: n.y,
        on: function () { highlight(trace([n], [])); },
        off: function () { highlight(null); },
        tip: function () {
          var inV = sum(n.ins, function (l) { return l.value; }), outV = sum(n.outs, function (l) { return l.value; });
          var rows = [];
          if (n.ins.length) rows.push({ color: n.color, value: fmt(inV), label: 'In' });
          if (n.outs.length) rows.push({ color: n.color, value: fmt(outV), label: 'Out' });
          if (!rows.length) rows.push({ color: n.color, value: fmt(n.value), label: 'Value' });
          return { head: n.label || n.id, rows: rows, note: n.note };
        }
      }));
    }
    // keyboard order: column by column, each node followed by its outgoing flows
    cols.forEach(function (col) { col.forEach(function (n) { addNode(n); n.outs.forEach(addLink); }); });

    if (cfg.groups) chart.legend(cfg.groups.map(function (g_, i) { return { label: g_.label || g_.key, color: i < 8 ? C.cat[i] : C.muted }; }));
    else chart.legend([]);
    chart.table([{ label: 'From' }, { label: 'To' }, { label: 'Flow', num: true }, { label: 'What it pays for' }],
      links.map(function (l) { return [l.s.label || l.s.id, l.t.label || l.t.id, fmt(l.value), l.label || '']; }));
  }
  Charts.register('sankey flow', renderSankey);

  /* ---- 7.13 TREEMAP (market share, profit pools) ---- */
  function squarify(items, rect) {
    var out = [], row = [], i = 0;
    var r = { x: rect.x, y: rect.y, w: rect.w, h: rect.h };
    function worst(rw, side) {
      var s_ = sum(rw, function (n) { return n.a; }), mx = 0, mn = Infinity;
      rw.forEach(function (n) { mx = Math.max(mx, n.a); mn = Math.min(mn, n.a); });
      return Math.max(side * side * mx / (s_ * s_), (s_ * s_) / (side * side * mn));
    }
    function layRow(rw) {
      var s_ = sum(rw, function (n) { return n.a; });
      if (r.w >= r.h) {
        var cw = s_ / r.h, yy = r.y;
        rw.forEach(function (n) { var hh = n.a / cw; out.push(Object.assign({}, n, { x: r.x, y: yy, w: cw, h: hh })); yy += hh; });
        r.x += cw; r.w -= cw;
      } else {
        var rh = s_ / r.w, xx = r.x;
        rw.forEach(function (n) { var ww = n.a / rh; out.push(Object.assign({}, n, { x: xx, y: r.y, w: ww, h: rh })); xx += ww; });
        r.y += rh; r.h -= rh;
      }
    }
    var total = sum(items, function (n) { return n.value; });
    var scale = total ? (rect.w * rect.h) / total : 0;
    var nodes = items.filter(function (n) { return n.value > 0; }).map(function (n) { return Object.assign({}, n, { a: n.value * scale }); });
    while (i < nodes.length) {
      var side = Math.min(r.w, r.h);
      if (!row.length || worst(row.concat([nodes[i]]), side) <= worst(row, side)) { row.push(nodes[i]); i++; }
      else { layRow(row); row = []; }
    }
    if (row.length) layRow(row);
    return out;
  }
  function renderTreemap(chart, cfg) {
    var C = chart.C, W = chart.W, data = cfg.data || [];
    var lKey = cfg.labelKey || 'label', vKey = cfg.valueKey || 'value', gKey = cfg.groupKey || 'group';
    var fmt = makeFormat(cfg.valueFormat);
    var H = cfg.height || (W < 560 ? 320 : 380);
    var groups = cfg.groups ? cfg.groups.map(function (g_) { return { key: g_.key, label: g_.label || g_.key }; }) : [];
    data.forEach(function (d) { var k = d[gKey]; if (k != null && !groups.some(function (g_) { return g_.key === k; })) groups.push({ key: k, label: k }); });
    var total = sum(data, function (d) { return +d[vKey] || 0; });
    var svg_ = chart.svg(W, H, 'Treemap with ' + data.length + ' items');
    var g = s('g', null, svg_);
    var tiles = [];
    var items = data.map(function (d) { return { d: d, value: +d[vKey] || 0 }; });
    if (groups.length) {
      var gItems = groups.map(function (g_, gi) {
        var members = items.filter(function (it) { return it.d[gKey] === g_.key; }).sort(function (a, b) { return b.value - a.value; });
        return { g: g_, gi: gi, members: members, value: sum(members, function (m) { return m.value; }) };
      }).sort(function (a, b) { return b.value - a.value; });
      squarify(gItems, { x: 0, y: 0, w: W, h: H }).forEach(function (gr) {
        squarify(gr.members, { x: gr.x, y: gr.y, w: gr.w, h: gr.h }).forEach(function (t) { t.gi = gr.gi; tiles.push(t); });
      });
    } else {
      tiles = squarify(items.sort(function (a, b) { return b.value - a.value; }), { x: 0, y: 0, w: W, h: H }).map(function (t) { t.gi = 0; return t; });
    }
    var els = [];
    tiles.forEach(function (t, ti) {
      var color = t.gi < 8 ? C.cat[t.gi] : C.muted;
      var x = t.x + 1, y = t.y + 1, w = Math.max(0, t.w - 2), hh = Math.max(0, t.h - 2);
      var tg = s('g', { class: 'mark' }, g);
      s('rect', { x: x, y: y, width: w, height: hh, rx: 3, fill: color }, tg);
      var ink = inkOn(color);
      if (w > 46 && hh > 24) {
        var full = String(t.d[lKey]), name = ellipsize(full, w - 14, 12.5, 600);
        // a label cut to a stub is noise: show it only if most of it fits (the tooltip has the rest)
        if (name && (name === full || name.length - 1 >= full.length * 0.7)) {
          stext(tg, x + 7, y + 17, name, { fill: ink, 'font-size': 12.5, 'font-weight': 600 });
          var sub = fmt(t.value) + (total ? ' \u00b7 ' + (t.value / total * 100).toFixed(t.value / total < 0.1 ? 1 : 0) + '%' : '');
          if (hh > 42 && textW(sub, 12) <= w - 14) stext(tg, x + 7, y + 33, sub, { fill: ink, 'font-size': 12, opacity: 0.9, 'font-variant-numeric': 'tabular-nums' });
        }
      }
      els.push(tg);
      var idx = chart.addPoint({
        x: x + w / 2, y: y + 4,
        on: function () { els.forEach(function (e, j) { e.classList.toggle('is-dim', j !== ti); }); },
        off: function () { els.forEach(function (e) { e.classList.remove('is-dim'); }); },
        tip: function () {
          var gl = groups.length ? groups[t.gi].label : null;
          return { head: String(t.d[lKey]) + (gl ? ' · ' + gl : ''), rows: [{ color: color, value: fmt(t.value), label: cfg.valueLabel || 'Value' }, { value: total ? (t.value / total * 100).toFixed(1) + '%' : '—', label: 'Share of total' }], note: t.d.note };
        }
      });
      tg.addEventListener('pointermove', function (e) { chart.activate(idx, e.clientX, e.clientY); });
      tg.addEventListener('pointerdown', function (e) { chart.activate(idx, e.clientX, e.clientY); });
    });
    chart.legend(groups.map(function (g_, i) { return { label: g_.label, color: i < 8 ? C.cat[i] : C.muted }; }));
    var cols = [{ label: cfg.labelTitle || 'Name' }].concat(groups.length ? [{ label: 'Group' }] : []).concat([{ label: cfg.valueLabel || 'Value', num: true }, { label: 'Share', num: true }]);
    chart.table(cols, data.slice().sort(function (a, b) { return (+b[vKey] || 0) - (+a[vKey] || 0); }).map(function (d) {
      var row = [String(d[lKey])];
      if (groups.length) { var gg = groups.filter(function (g_) { return g_.key === d[gKey]; })[0]; row.push(gg ? gg.label : ''); }
      row.push(fmt(+d[vKey]), total ? ((+d[vKey] || 0) / total * 100).toFixed(1) + '%' : '—');
      return row;
    }));
  }
  Charts.register('treemap', renderTreemap);

  /* ---- 7.14 LAYER STACK (HTML, not SVG: wraps text and is screen-reader friendly) ---- */
  function renderLayers(chart, cfg) {
    var layers = cfg.layers || [];
    var ol = h('ol', { class: 'layer-stack' + (cfg.arrow ? ' has-arrow' : '') });
    var cur = root.getAttribute('data-page');
    layers.forEach(function (L) {
      var inner = [
        h('span', { class: 'l-id', text: L.id || '' }),
        h('span', { class: 'l-name' }, [L.label || '', L.note ? h('span', { class: 'l-note', text: L.note }) : null]),
        h('span', { class: 'l-value', text: L.value || '' })
      ];
      var isCur = L.current || (cur && L.id === cur);
      var li = h('li', { class: (isCur ? 'is-current' : '') + (L.groupTop ? ' is-group-top' : '') || null, 'aria-current': isCur ? 'true' : null },
        L.href ? h('a', { href: href(L.href) }, inner) : inner);
      ol.appendChild(li);
    });
    if (cfg.arrow) {
      ol.appendChild(h('li', { class: 'layer-arrow' + (cfg.arrow.direction === 'up' ? ' is-up' : ''), 'aria-hidden': 'true', style: 'display:flex;padding:0;background:none;border:0' }, h('span', { text: cfg.arrow.label || '' })));
    }
    chart.plot.appendChild(ol);
    chart.legend([]);
    chart.table([{ label: 'ID' }, { label: 'Layer' }, { label: 'Note' }, { label: cfg.valueTitle || 'Value' }],
      layers.map(function (L) { return [L.id || '', L.label || '', L.note || '', L.value || '']; }));
  }
  Charts.register('layers layer-stack', renderLayers);

  /** Render (or re-render) every chart on the page. */
  Charts.renderAll = function () {
    qsa('script[type="application/json"][data-chart]').forEach(function (sc) {
      if (sc._atlasChart) return;
      sc._atlasChart = true;
      new Chart(sc);
    });
  };
  Charts.refresh = function () { Charts.instances.forEach(function (c) { if (!c.fig.classList.contains('is-table')) c.render(); }); };
  Charts.Chart = Chart;
  document.addEventListener('atlas:themechange', function () { Charts.refresh(); });

  /* ======================================================================
     8. INIT
     ====================================================================== */
  function openDetailsForPrint() {
    var closed = [];
    window.addEventListener('beforeprint', function () {
      qsa('details:not([open])').forEach(function (d) { closed.push(d); d.open = true; });
    });
    window.addEventListener('afterprint', function () { closed.forEach(function (d) { d.open = false; }); closed = []; });
  }

  Atlas.init = function () {
    if (Atlas._inited) return; Atlas._inited = true;
    addSkipLink();
    buildTopbar();
    buildSidebar();
    buildFooter();
    buildPager();
    readingTime();
    buildAnchorsAndToc();
    enhanceTables();
    enhancePopovers();
    buildProgressAndTop();
    Charts.renderAll();
    openDetailsForPrint();
    var onS = rafThrottle(onScroll);
    window.addEventListener('scroll', onS, { passive: true });
    window.addEventListener('resize', onS);
    onScroll();
    root.classList.add('atlas-ready');
  };
  onReady(Atlas.init);
})(window, document);
