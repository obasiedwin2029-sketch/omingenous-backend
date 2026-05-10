import express from "express";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 8080;
const BASE_URL = process.env.BACKEND_URL || "https://omingenous-backend.onrender.com";

// In-memory preview store: id → { files, createdAt }
const previews = new Map();

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
  res.setHeader("X-Powered-By", "Omingenous API");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// ─── Project type detection ──────────────────────────────────────────────────
function detectProjectType(fm) {
  const names = Object.keys(fm);
  // Pure HTML project
  if (names.some(n => n.toLowerCase() === "index.html")) return "html";
  // Find the main JS entry
  const mainKey = names.find(n => n === "App.js" || n === "App.jsx" || n === "app.js" || n === "index.js" || n === "main.js");
  const code = mainKey ? (fm[mainKey].contents || fm[mainKey].content || "") : (Object.values(fm)[0] ? (Object.values(fm)[0].contents || Object.values(fm)[0].content || "") : "");
  if (/from\s+['"]react-native['"]/i.test(code) || /require\(['"]react-native['"]\)/.test(code)) return "react-native";
  return "react-web";
}

// ─── Regex helper ─────────────────────────────────────────────────────────────
function escapeRegExp(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

// ─── HTML project preview ─────────────────────────────────────────────────────
function generateHtmlPreview(fm) {
  const htmlKey = Object.keys(fm).find(n => n.toLowerCase() === "index.html");
  let html = htmlKey ? (fm[htmlKey].contents || fm[htmlKey].content || "") : "";

  // Collect extra CSS and JS from sibling files
  const cssFiles = Object.entries(fm).filter(([n]) => n.toLowerCase().endsWith(".css"));
  const jsFiles  = Object.entries(fm).filter(([n]) => n.toLowerCase().endsWith(".js") || n.toLowerCase().endsWith(".jsx"));

  if (!html) {
    const css = cssFiles.map(([, f]) => f.contents || f.content || "").join("\n");
    const js  = jsFiles .map(([, f]) => f.contents || f.content || "").join("\n;\n");
    return `<!DOCTYPE html><html><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:system-ui,sans-serif}\n${css}</style></head><body><script>\n${js}\n</script></body></html>`;
  }

  // Replace <link href="name.css"> with inline <style>
  cssFiles.forEach(([name, file]) => {
    const css = file.contents || file.content || "";
    html = html.replace(new RegExp(`<link[^>]+href=["'][./]*${escapeRegExp(name)}["'][^>]*/?>`, "gi"), `<style>${css}</style>`);
  });
  // Replace <script src="name.js"></script> with inline <script>
  jsFiles.forEach(([name, file]) => {
    const js = file.contents || file.content || "";
    html = html.replace(new RegExp(`<script[^>]+src=["'][./]*${escapeRegExp(name)}["'][^>]*></script>`, "gi"), `<script>${js}</script>`);
  });
  // Inject any CSS file not already inlined
  const extraCss = cssFiles.filter(([n]) => html.includes(n) === false).map(([, f]) => f.contents || f.content || "").join("\n");
  if (extraCss) html = html.replace("</head>", `<style>${extraCss}</style>\n</head>`);
  // Inject any JS file not already inlined
  const extraJs = jsFiles.filter(([n]) => html.includes(n) === false).map(([, f]) => f.contents || f.content || "").join("\n;\n");
  if (extraJs) html = html.replace("</body>", `<script>${extraJs}</script>\n</body>`);

  return html;
}

// ─── React web preview (React + Tailwind, no RN layer) ───────────────────────
function generateReactWebPreview(fm) {
  const names = Object.keys(fm);
  const mainKey = names.find(n => n === "App.js" || n === "App.jsx" || n === "app.js" || n === "index.js") || names.find(n => n.endsWith(".js") || n.endsWith(".jsx"));
  const mainCode = mainKey ? (fm[mainKey].contents || fm[mainKey].content || "") : "";

  // Concatenate helper JS files first (App.js last) so local names are in scope
  const helpers = Object.entries(fm)
    .filter(([n]) => (n.endsWith(".js") || n.endsWith(".jsx")) && n !== mainKey)
    .map(([, f]) => f.contents || f.content || "")
    .join("\n\n");
  const combined = helpers ? helpers + "\n\n" + mainCode : mainCode;
  const transformed = transformCodeForWeb(combined);
  const b64 = Buffer.from(transformed, "utf8").toString("base64");

  const extraCss = Object.entries(fm)
    .filter(([n]) => n.endsWith(".css"))
    .map(([, f]) => f.contents || f.content || "")
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1"/>
  <title>App Preview</title>
  <script crossorigin src="https://unpkg.com/react@18.2.0/umd/react.production.min.js"></script>
  <script crossorigin src="https://unpkg.com/react-dom@18.2.0/umd/react-dom.production.min.js"></script>
  <script src="https://unpkg.com/@babel/standalone@7.23.10/babel.min.js"></script>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    html,body,#root{height:100%}
    #loading{position:fixed;inset:0;background:#fff;display:flex;align-items:center;
      justify-content:center;z-index:9999;font-family:system-ui,sans-serif}
    #loading p{color:#6366f1;font-size:15px;animation:ld-p 1.2s ease-in-out infinite}
    @keyframes ld-p{0%,100%{opacity:.3}50%{opacity:1}}
    #err{display:none;padding:32px;background:#fff7f7;color:#ef4444;font-family:monospace;
      font-size:13px;white-space:pre-wrap;overflow:auto;min-height:100vh;line-height:1.6}
    #err h2{color:#dc2626;margin-bottom:12px}
    ${extraCss}
  </style>
</head>
<body>
  <div id="loading"><p>Loading preview...</p></div>
  <div id="root"></div>
  <div id="err"></div>
  <script>
    window.useState        = React.useState;
    window.useEffect       = React.useEffect;
    window.useRef          = React.useRef;
    window.useCallback     = React.useCallback;
    window.useMemo         = React.useMemo;
    window.useContext      = React.useContext;
    window.useReducer      = React.useReducer;
    window.useLayoutEffect = React.useLayoutEffect;
    window.createContext   = React.createContext;
    window.Fragment        = React.Fragment;
    window.memo            = React.memo;
    window.forwardRef      = React.forwardRef;
    (function () {
      var loading = document.getElementById('loading');
      var errDiv  = document.getElementById('err');
      function showError(title, detail) {
        loading.style.display = 'none';
        errDiv.style.display  = 'block';
        errDiv.innerHTML = '<h2>Preview Error: ' + esc(title) + '<\\/h2><pre>' + esc(detail || '') + '<\\/pre>';
      }
      function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
      try {
        var _b64 = "${b64}";
        var _bin = atob(_b64), _arr = new Uint8Array(_bin.length);
        for (var i = 0; i < _bin.length; i++) _arr[i] = _bin.charCodeAt(i);
        var _code = new TextDecoder('utf-8').decode(_arr);
        var _compiled = Babel.transform(_code, { presets: ['react'], filename: 'App.jsx', retainLines: true }).code;
        eval(_compiled);
        var _App = typeof App !== 'undefined' ? App : typeof window.__AppDefault !== 'undefined' ? window.__AppDefault : null;
        if (!_App) throw new Error('No default App export found. Make sure your code has: export default function App() { ... }');
        loading.style.display = 'none';
        ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(_App));
      } catch (e) {
        console.error('[preview]', e);
        showError(e.message, e.stack || '');
      }
    })();
  <\/script>
</body>
</html>`;
}

// ─── Smart dispatcher ─────────────────────────────────────────────────────────
function generateSmartPreview(fm) {
  const type = detectProjectType(fm);
  console.log(`[preview] project type: ${type} | files: ${Object.keys(fm).join(", ")}`);
  if (type === "html")         return generateHtmlPreview(fm);
  if (type === "react-web")    return generateReactWebPreview(fm);
  // react-native: extract main App.js code and use RN compat layer
  const mainKey = Object.keys(fm).find(n => n === "App.js" || n === "App.jsx" || n === "app.js" || n === "index.js") || Object.keys(fm)[0];
  const code = mainKey ? (fm[mainKey].contents || fm[mainKey].content || "") : "";
  return generatePreviewHtml(code);
}

// ─── Code transformer ────────────────────────────────────────────────────────
function transformCodeForWeb(code) {
  if (!code) return "";
  return code
    .replace(/^import\s+[\s\S]*?from\s+['"][^'"]+['"]\s*;?\s*$/gm, "")
    .replace(/^import\s+['"][^'"]+['"]\s*;?\s*$/gm, "")
    .replace(/export\s+default\s+function\s+(\w+)/g, "function $1")
    .replace(/export\s+default\s+class\s+(\w+)/g, "class $1")
    .replace(/export\s+default\s+/g, "window.__AppDefault = ")
    .replace(/export\s+\{[^}]+\}\s*;?/g, "")
    .replace(/export\s+(const|let|var)\s+/g, "$1 ")
    .replace(/export\s+function\s+/g, "function ");
}

// ─── Self-contained React-Native-Web compatibility layer ─────────────────────
// No CDN dependency — implemented in pure React DOM.
const RN_COMPAT_JS = `
(function () {
  'use strict';

  var h   = React.createElement;
  var fwd = React.forwardRef;

  // ── Expose React hooks as globals (removed by import-stripping) ────────────
  window.useState        = React.useState;
  window.useEffect       = React.useEffect;
  window.useRef          = React.useRef;
  window.useCallback     = React.useCallback;
  window.useMemo         = React.useMemo;
  window.useContext      = React.useContext;
  window.useReducer      = React.useReducer;
  window.useLayoutEffect = React.useLayoutEffect;
  window.createContext   = React.createContext;
  window.forwardRef      = React.forwardRef;
  window.memo            = React.memo;
  window.Fragment        = React.Fragment;

  // ── Style utilities ────────────────────────────────────────────────────────
  var SKIP_PROPS = {
    testID:1, accessible:1, accessibilityLabel:1, accessibilityRole:1,
    accessibilityState:1, accessibilityHint:1, accessibilityValue:1,
    hitSlop:1, onLayout:1, nativeID:1, collapsable:1, removeClippedSubviews:1,
    onAccessibilityAction:1, onAccessibilityTap:1, onAccessibilityEscape:1,
    importantForAccessibility:1, needsOffscreenAlphaCompositing:1,
    renderToHardwareTextureAndroid:1, shouldRasterizeIOS:1, focusable:1
  };

  function safeDomProps(p) {
    var out = {};
    for (var k in p) if (!SKIP_PROPS[k]) out[k] = p[k];
    return out;
  }

  function flatten(s) {
    if (!s) return {};
    if (Array.isArray(s)) {
      var r = {};
      for (var i = 0; i < s.length; i++) Object.assign(r, flatten(s[i]));
      return r;
    }
    if (typeof s === 'number') return {};
    return Object.assign({}, s);
  }

  function normalizeStyle(s) {
    var flat = flatten(s);
    // Convert RN transform array → CSS transform string
    if (flat.transform && Array.isArray(flat.transform)) {
      var t = flat.transform.map(function (item) {
        var k = Object.keys(item)[0];
        var v = item[k];
        if (k === 'rotate' || k === 'rotateX' || k === 'rotateY' ||
            k === 'skewX'  || k === 'skewY') {
          return k + '(' + (typeof v === 'number' ? v + 'rad' : v) + ')';
        }
        if (k === 'scale' || k === 'scaleX' || k === 'scaleY') {
          return k + '(' + v + ')';
        }
        return k + '(' + (typeof v === 'number' ? v + 'px' : v) + ')';
      }).join(' ');
      flat.transform = t;
    }
    return flat;
  }

  function viewStyle(s) {
    return Object.assign(
      { display: 'flex', flexDirection: 'column', boxSizing: 'border-box', position: 'relative' },
      normalizeStyle(s)
    );
  }

  // ── StyleSheet ─────────────────────────────────────────────────────────────
  window.StyleSheet = {
    create: function (styles) { return styles; },
    flatten: flatten,
    hairlineWidth: 1,
    absoluteFill: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 },
    absoluteFillObject: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }
  };

  // ── View ───────────────────────────────────────────────────────────────────
  window.View = fwd(function View(p, ref) {
    var s = viewStyle(p.style);
    var rest = safeDomProps(p);
    delete rest.style;
    return h('div', Object.assign({ ref: ref, style: s }, rest));
  });
  window.View.displayName = 'View';

  // ── Text ───────────────────────────────────────────────────────────────────
  window.Text = fwd(function Text(p, ref) {
    var s = Object.assign(
      { fontFamily: 'system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif',
        boxSizing: 'border-box' },
      normalizeStyle(p.style)
    );
    if (p.numberOfLines === 1) {
      s.overflow = 'hidden'; s.textOverflow = 'ellipsis'; s.whiteSpace = 'nowrap';
    }
    var rest = safeDomProps(p);
    delete rest.style; delete rest.numberOfLines;
    if (p.onPress && !rest.onClick) { rest.onClick = p.onPress; delete rest.onPress; }
    return h('span', Object.assign({ ref: ref, style: s }, rest));
  });
  window.Text.displayName = 'Text';

  // ── TouchableOpacity ───────────────────────────────────────────────────────
  window.TouchableOpacity = function TouchableOpacity(p) {
    var _s = React.useState(false);
    var pressed = _s[0], setPressed = _s[1];
    var ao  = p.activeOpacity !== undefined ? p.activeOpacity : 0.7;
    var dis = !!p.disabled;
    var s = Object.assign(
      { display: 'flex', flexDirection: 'column', boxSizing: 'border-box',
        cursor: dis ? 'default' : 'pointer', userSelect: 'none',
        WebkitUserSelect: 'none', opacity: pressed ? ao : 1,
        transition: 'opacity 0.15s ease' },
      normalizeStyle(p.style)
    );
    return h('div', {
      style: s,
      onClick:      !dis && p.onPress ? p.onPress : undefined,
      onMouseDown:  function () { setPressed(true); },
      onMouseUp:    function () { setPressed(false); },
      onMouseLeave: function () { setPressed(false); },
      onTouchStart: function (e) { e.preventDefault(); setPressed(true); },
      onTouchEnd:   function (e) {
        e.preventDefault(); setPressed(false);
        if (!dis && p.onPress) p.onPress();
      }
    }, p.children);
  };

  // ── Pressable ──────────────────────────────────────────────────────────────
  window.Pressable = function Pressable(p) {
    var _s = React.useState(false);
    var pressed = _s[0], setPressed = _s[1];
    var rawStyle = typeof p.style === 'function' ? p.style({ pressed: pressed }) : p.style;
    var s = Object.assign(
      { display: 'flex', flexDirection: 'column', boxSizing: 'border-box',
        cursor: p.disabled ? 'default' : 'pointer', userSelect: 'none' },
      normalizeStyle(rawStyle)
    );
    return h('div', {
      style: s,
      onClick:      !p.disabled && p.onPress ? p.onPress : undefined,
      onMouseDown:  function () { setPressed(true);  if (p.onPressIn)  p.onPressIn(); },
      onMouseUp:    function () { setPressed(false); if (p.onPressOut) p.onPressOut(); },
      onMouseLeave: function () { setPressed(false); if (p.onPressOut) p.onPressOut(); }
    }, p.children);
  };

  window.TouchableHighlight        = window.TouchableOpacity;
  window.TouchableNativeFeedback   = window.TouchableOpacity;
  window.TouchableWithoutFeedback  = function (p) {
    return h('div', { style: { boxSizing: 'border-box' }, onClick: p.onPress }, p.children);
  };

  // ── ScrollView ─────────────────────────────────────────────────────────────
  window.ScrollView = fwd(function ScrollView(p, ref) {
    var isH = !!p.horizontal;
    var s = Object.assign(
      { display: 'flex', flexDirection: isH ? 'row' : 'column', boxSizing: 'border-box',
        overflowX: isH ? 'auto' : 'hidden', overflowY: isH ? 'hidden' : 'auto',
        WebkitOverflowScrolling: 'touch' },
      normalizeStyle(p.contentContainerStyle || p.style)
    );
    var outerS = isH ? {} : normalizeStyle(p.style);
    var rest = safeDomProps(p);
    delete rest.style; delete rest.contentContainerStyle; delete rest.horizontal;
    delete rest.showsVerticalScrollIndicator; delete rest.showsHorizontalScrollIndicator;
    delete rest.keyboardShouldPersistTaps; delete rest.scrollEnabled;
    delete rest.refreshControl; delete rest.onScroll; delete rest.onScrollBeginDrag;
    delete rest.onScrollEndDrag; delete rest.onMomentumScrollBegin; delete rest.onMomentumScrollEnd;
    delete rest.scrollEventThrottle; delete rest.bounces; delete rest.alwaysBounceVertical;
    return h('div', Object.assign({ ref: ref, style: s }, rest));
  });
  window.ScrollView.displayName = 'ScrollView';

  // ── SafeAreaView ───────────────────────────────────────────────────────────
  window.SafeAreaView = fwd(function SafeAreaView(p, ref) {
    var s = Object.assign(
      { display: 'flex', flexDirection: 'column', boxSizing: 'border-box',
        paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)',
        paddingLeft: 'env(safe-area-inset-left)', paddingRight: 'env(safe-area-inset-right)' },
      normalizeStyle(p.style)
    );
    var rest = safeDomProps(p);
    delete rest.style;
    return h('div', Object.assign({ ref: ref, style: s }, rest));
  });

  window.KeyboardAvoidingView = window.View;

  // ── TextInput ──────────────────────────────────────────────────────────────
  window.TextInput = fwd(function TextInput(p, ref) {
    var s = Object.assign(
      { fontFamily: 'system-ui,-apple-system,sans-serif', boxSizing: 'border-box',
        outline: 'none', border: 'none', background: 'transparent', color: 'inherit' },
      normalizeStyle(p.style)
    );
    var onChange = p.onChangeText
      ? function (e) { p.onChangeText(e.target.value); }
      : p.onChange;
    var type = p.secureTextEntry ? 'password'
      : p.keyboardType === 'email-address' ? 'email'
      : (p.keyboardType === 'numeric' || p.keyboardType === 'number-pad') ? 'number'
      : 'text';
    var sharedProps = {
      ref: ref, style: s, value: p.value, defaultValue: p.defaultValue,
      placeholder: p.placeholder, readOnly: p.editable === false,
      autoFocus: p.autoFocus, maxLength: p.maxLength, onChange: onChange,
      onFocus: p.onFocus, onBlur: p.onBlur,
      onKeyPress: p.onSubmitEditing
        ? function (e) { if (e.key === 'Enter') p.onSubmitEditing(); }
        : p.onKeyPress
    };
    if (p.multiline) {
      s.resize = 'none';
      return h('textarea', Object.assign(sharedProps, { rows: p.numberOfLines || 3, type: undefined }));
    }
    return h('input', Object.assign(sharedProps, { type: type }));
  });

  // ── Image ──────────────────────────────────────────────────────────────────
  window.Image = fwd(function Image(p, ref) {
    var uri = p.source && typeof p.source === 'object' ? p.source.uri : p.source;
    if (typeof uri === 'number') uri = '';
    var s = Object.assign({ boxSizing: 'border-box' }, normalizeStyle(p.style));
    var rm = p.resizeMode || s.resizeMode || 'cover';
    delete s.resizeMode;
    s.objectFit = rm === 'contain' ? 'contain' : rm === 'stretch' ? 'fill'
      : rm === 'center' ? 'none' : 'cover';
    return h('img', { ref: ref, src: uri || '', style: s,
      alt: p.alt || '', onError: p.onError, onLoad: p.onLoad });
  });
  window.Image.getSize = function () {};
  window.Image.prefetch = function () { return Promise.resolve(true); };

  window.ImageBackground = function ImageBackground(p) {
    var uri = p.source && p.source.uri ? p.source.uri : '';
    var s = Object.assign(
      { backgroundImage: 'url(' + uri + ')', backgroundSize: 'cover',
        backgroundPosition: 'center', display: 'flex', flexDirection: 'column',
        boxSizing: 'border-box' },
      normalizeStyle(p.style)
    );
    return h('div', { style: s }, p.children);
  };

  // ── FlatList ───────────────────────────────────────────────────────────────
  window.FlatList = function FlatList(p) {
    var data = p.data || [];
    var isH  = !!p.horizontal;
    var s = Object.assign(
      { display: 'flex', flexDirection: isH ? 'row' : 'column', boxSizing: 'border-box',
        overflowX: isH ? 'auto' : 'hidden', overflowY: isH ? 'hidden' : 'auto' },
      normalizeStyle(p.style)
    );
    var headerEl = p.ListHeaderComponent
      ? (typeof p.ListHeaderComponent === 'function'
          ? h(p.ListHeaderComponent, p.ListHeaderComponentStyle ? { style: p.ListHeaderComponentStyle } : null)
          : p.ListHeaderComponent)
      : null;
    var footerEl = p.ListFooterComponent
      ? (typeof p.ListFooterComponent === 'function'
          ? h(p.ListFooterComponent, null) : p.ListFooterComponent)
      : null;
    var emptyEl = data.length === 0 && p.ListEmptyComponent
      ? (typeof p.ListEmptyComponent === 'function'
          ? h(p.ListEmptyComponent, null) : p.ListEmptyComponent)
      : null;
    var items = data.map(function (item, idx) {
      var key = p.keyExtractor ? p.keyExtractor(item, idx) : String(idx);
      return h(React.Fragment, { key: key },
        p.renderItem({ item: item, index: idx, separators: { highlight: function(){}, unhighlight: function(){}, updateProps: function(){} } })
      );
    });
    return h('div', { style: s }, headerEl, emptyEl || items, footerEl);
  };

  // ── SectionList ────────────────────────────────────────────────────────────
  window.SectionList = function SectionList(p) {
    var s = Object.assign(
      { display: 'flex', flexDirection: 'column', overflowY: 'auto', boxSizing: 'border-box' },
      normalizeStyle(p.style)
    );
    var sections = (p.sections || []).map(function (section, si) {
      var header = p.renderSectionHeader
        ? p.renderSectionHeader({ section: section }) : null;
      var footer = p.renderSectionFooter
        ? p.renderSectionFooter({ section: section }) : null;
      var items = (section.data || []).map(function (item, ii) {
        var key = p.keyExtractor ? p.keyExtractor(item, ii) : String(ii);
        return h(React.Fragment, { key: key },
          p.renderItem({ item: item, index: ii, section: section, separators: {} })
        );
      });
      return h(React.Fragment, { key: si }, header, items, footer);
    });
    return h('div', { style: s }, sections);
  };

  // ── VirtualizedList ────────────────────────────────────────────────────────
  window.VirtualizedList = window.FlatList;

  // ── Modal ──────────────────────────────────────────────────────────────────
  window.Modal = function Modal(p) {
    if (!p.visible && p.animationType !== 'none') return null;
    if (p.visible === false) return null;
    return h('div', {
      style: {
        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1000,
        backgroundColor: p.transparent ? 'transparent' : 'rgba(0,0,0,0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center'
      }
    }, p.children);
  };

  // ── ActivityIndicator ──────────────────────────────────────────────────────
  window.ActivityIndicator = function ActivityIndicator(p) {
    if (p.animating === false) return null;
    var sz    = p.size === 'large' ? 40 : 20;
    var color = p.color || '#00ff88';
    var bw    = Math.max(2, Math.round(sz / 6));
    var s     = Object.assign({ alignSelf: 'center' }, normalizeStyle(p.style));
    return h('div', { style: s },
      h('div', {
        style: {
          width: sz, height: sz, borderRadius: '50%',
          border: bw + 'px solid ' + color + '33',
          borderTopColor: color,
          animation: 'rn-spin 0.75s linear infinite',
          boxSizing: 'border-box'
        }
      })
    );
  };

  // ── Switch ─────────────────────────────────────────────────────────────────
  window.Switch = function Switch(p) {
    var on       = !!p.value;
    var onColor  = (p.trackColor && p.trackColor.true)  || '#00ff88';
    var offColor = (p.trackColor && p.trackColor.false) || '#767577';
    return h('div', {
      style: {
        position: 'relative', width: 51, height: 31, borderRadius: 16,
        backgroundColor: on ? onColor : offColor, flexShrink: 0,
        cursor: p.disabled ? 'default' : 'pointer',
        transition: 'background-color 0.2s', boxSizing: 'border-box'
      },
      onClick: !p.disabled && p.onValueChange ? function () { p.onValueChange(!on); } : undefined
    },
      h('div', {
        style: {
          position: 'absolute', top: 2, width: 27, height: 27,
          left: on ? 22 : 2, borderRadius: '50%',
          backgroundColor: p.thumbColor || '#fff',
          transition: 'left 0.2s', boxShadow: '0 1px 4px rgba(0,0,0,0.4)'
        }
      })
    );
  };

  // ── StatusBar ──────────────────────────────────────────────────────────────
  window.StatusBar = function () { return null; };
  window.StatusBar.setBarStyle          = function () {};
  window.StatusBar.setBackgroundColor   = function () {};
  window.StatusBar.setHidden            = function () {};
  window.StatusBar.setNetworkActivityIndicatorVisible = function () {};
  window.StatusBar.currentHeight        = 0;

  // ── RefreshControl ─────────────────────────────────────────────────────────
  window.RefreshControl = function () { return null; };

  // ── Dimensions ─────────────────────────────────────────────────────────────
  window.Dimensions = {
    get: function (dim) {
      return { width: window.innerWidth, height: window.innerHeight,
               scale: window.devicePixelRatio || 1, fontScale: 1 };
    },
    addEventListener: function () { return { remove: function () {} }; },
    removeEventListener: function () {}
  };
  window.useWindowDimensions = function () {
    return { width: window.innerWidth, height: window.innerHeight,
             scale: window.devicePixelRatio || 1, fontScale: 1 };
  };

  // ── Platform ───────────────────────────────────────────────────────────────
  window.Platform = {
    OS: 'web', Version: 1, isPad: false, isTVOS: false,
    select: function (spec) {
      return spec.web !== undefined ? spec.web
           : spec.default !== undefined ? spec.default : null;
    }
  };

  // ── PixelRatio ─────────────────────────────────────────────────────────────
  window.PixelRatio = {
    get: function () { return window.devicePixelRatio || 1; },
    getFontScale: function () { return 1; },
    getPixelSizeForLayoutSize: function (s) { return Math.round(s * (window.devicePixelRatio || 1)); },
    roundToNearestPixel: function (s) { return Math.round(s); }
  };

  // ── Keyboard ───────────────────────────────────────────────────────────────
  window.Keyboard = {
    dismiss: function () { if (document.activeElement) document.activeElement.blur(); },
    addListener: function () { return { remove: function () {} }; },
    removeAllListeners: function () {}
  };

  // ── BackHandler ────────────────────────────────────────────────────────────
  window.BackHandler = {
    addEventListener: function () { return { remove: function () {} }; },
    removeEventListener: function () {},
    exitApp: function () {}
  };

  // ── AppState ───────────────────────────────────────────────────────────────
  window.AppState = {
    currentState: 'active',
    addEventListener: function () { return { remove: function () {} }; }
  };

  // ── AsyncStorage ───────────────────────────────────────────────────────────
  window.AsyncStorage = {
    getItem:     function (k)    { return Promise.resolve(localStorage.getItem(k)); },
    setItem:     function (k, v) { localStorage.setItem(k, v); return Promise.resolve(); },
    removeItem:  function (k)    { localStorage.removeItem(k); return Promise.resolve(); },
    getAllKeys:   function ()     { return Promise.resolve(Object.keys(localStorage)); },
    multiGet:    function (keys) { return Promise.resolve(keys.map(function (k) { return [k, localStorage.getItem(k)]; })); },
    multiSet:    function (pairs){ pairs.forEach(function (p) { localStorage.setItem(p[0], p[1]); }); return Promise.resolve(); },
    multiRemove: function (keys) { keys.forEach(function (k) { localStorage.removeItem(k); }); return Promise.resolve(); },
    clear:       function ()     { localStorage.clear(); return Promise.resolve(); },
    mergeItem:   function (k, v) { localStorage.setItem(k, v); return Promise.resolve(); }
  };

  // ── Alert ──────────────────────────────────────────────────────────────────
  window.Alert = {
    alert: function (title, msg, buttons) {
      window.alert((title || '') + (msg ? '\\n\\n' + msg : ''));
      if (buttons && buttons[0] && buttons[0].onPress) buttons[0].onPress();
    },
    prompt: function (title, msg, cb) {
      var val = window.prompt((title || '') + (msg ? '\\n' + msg : ''));
      if (cb) cb(val || '');
    }
  };

  // ── Linking ────────────────────────────────────────────────────────────────
  window.Linking = {
    openURL:       function (url) { window.open(url, '_blank'); return Promise.resolve(); },
    canOpenURL:    function ()    { return Promise.resolve(true); },
    getInitialURL: function ()    { return Promise.resolve(null); },
    addEventListener: function () { return { remove: function () {} }; }
  };

  // ── Share ──────────────────────────────────────────────────────────────────
  window.Share = {
    share: function (c) {
      if (navigator.share) return navigator.share({ title: c.title, text: c.message, url: c.url });
      window.alert('Share: ' + (c.message || c.url || ''));
      return Promise.resolve({ action: 'sharedAction' });
    }
  };

  // ── Clipboard ──────────────────────────────────────────────────────────────
  window.Clipboard = {
    setString: function (s) { if (navigator.clipboard) navigator.clipboard.writeText(s); },
    getString:  function () { return Promise.resolve(''); }
  };

  // ── Vibration ──────────────────────────────────────────────────────────────
  window.Vibration = { vibrate: function () {}, cancel: function () {} };

  // ── Expo mocks ─────────────────────────────────────────────────────────────
  window.Haptics = {
    impactAsync:       function () { return Promise.resolve(); },
    selectionAsync:    function () { return Promise.resolve(); },
    notificationAsync: function () { return Promise.resolve(); },
    ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
    NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' }
  };
  window.ImagePicker    = { launchImageLibraryAsync: function () { return Promise.resolve({ canceled: true, assets: [] }); }, launchCameraAsync: function () { return Promise.resolve({ canceled: true, assets: [] }); }, MediaTypeOptions: { All: 'all', Images: 'images', Videos: 'videos' } };
  window.DocumentPicker = { getDocumentAsync: function () { return Promise.resolve({ canceled: true }); } };
  window.FileSystem     = { documentDirectory: '/', readAsStringAsync: function () { return Promise.resolve(''); }, writeAsStringAsync: function () { return Promise.resolve(); }, deleteAsync: function () { return Promise.resolve(); }, getInfoAsync: function () { return Promise.resolve({ exists: false, isDirectory: false }); }, makeDirectoryAsync: function () { return Promise.resolve(); } };
  window.SecureStore    = { getItemAsync: function (k) { return Promise.resolve(localStorage.getItem('__sec_' + k)); }, setItemAsync: function (k, v) { localStorage.setItem('__sec_' + k, v); return Promise.resolve(); }, deleteItemAsync: function (k) { localStorage.removeItem('__sec_' + k); return Promise.resolve(); } };
  window.Constants      = { manifest: { version: '1.0.0', name: 'Omingenous App' }, expoVersion: '51.0.0' };
  window.NetInfo        = { fetch: function () { return Promise.resolve({ isConnected: true, type: 'wifi' }); } };
  window.useNetInfo     = function () { return { isConnected: true, type: 'wifi' }; };

  // ── Navigation stubs ───────────────────────────────────────────────────────
  window.useNavigation = function () {
    return { navigate: function(){}, goBack: function(){}, push: function(){},
             replace: function(){}, reset: function(){}, setOptions: function(){},
             dispatch: function(){}, canGoBack: function(){ return false; } };
  };
  window.useRoute   = function () { return { params: {}, name: 'Screen', key: '0' }; };
  window.useIsFocused     = function () { return true; };
  window.useFocusEffect   = function (cb) { React.useEffect(cb, []); };
  window.NavigationContainer = function (p) { return p.children; };
  function _stubNav() {
    return {
      Navigator: function (p) { return h(React.Fragment, null, p.children); },
      Screen:    function ()   { return null; },
      Group:     function (p)  { return h(React.Fragment, null, p.children); }
    };
  }
  window.createNativeStackNavigator    = _stubNav;
  window.createStackNavigator          = _stubNav;
  window.createBottomTabNavigator      = _stubNav;
  window.createDrawerNavigator         = _stubNav;
  window.createMaterialTopTabNavigator = _stubNav;

  // ── LayoutAnimation ────────────────────────────────────────────────────────
  window.LayoutAnimation = {
    configureNext: function () {},
    spring: function () {},
    Presets: { spring: {}, linear: {}, easeInEaseOut: {} },
    Types:   { spring: 'spring', linear: 'linear', easeInEaseOut: 'easeInEaseOut' },
    Properties: { opacity: 'opacity', scaleX: 'scaleX', scaleY: 'scaleY' }
  };

  // ── PanResponder ───────────────────────────────────────────────────────────
  window.PanResponder = {
    create: function (cfg) {
      return {
        panHandlers: {
          onMouseDown:  function (e) { if (cfg.onStartShouldSetPanResponder && cfg.onStartShouldSetPanResponder()) { if (cfg.onPanResponderGrant)   cfg.onPanResponderGrant(e, {}); } },
          onMouseMove:  function (e) { if (cfg.onPanResponderMove)   cfg.onPanResponderMove(e, {}); },
          onMouseUp:    function (e) { if (cfg.onPanResponderRelease) cfg.onPanResponderRelease(e, {}); }
        }
      };
    }
  };

  // ── Animated ───────────────────────────────────────────────────────────────
  (function () {
    function AnimatedValue(v) {
      this._value = v; this._listeners = {}; this._id = 0;
    }
    AnimatedValue.prototype.setValue = function (v) {
      this._value = v; this._notify();
    };
    AnimatedValue.prototype._notify = function () {
      for (var id in this._listeners) this._listeners[id]({ value: this._value });
    };
    AnimatedValue.prototype.addListener = function (cb) {
      var id = String(++this._id); this._listeners[id] = cb; return id;
    };
    AnimatedValue.prototype.removeListener    = function (id) { delete this._listeners[id]; };
    AnimatedValue.prototype.removeAllListeners= function ()   { this._listeners = {}; };
    AnimatedValue.prototype.stopAnimation     = function (cb) { if (cb) cb(this._value); };
    AnimatedValue.prototype.interpolate = function (cfg) {
      var self = this;
      return {
        __isInterp: true, __parent: self, __cfg: cfg,
        _get: function () {
          var v = self._value, ir = cfg.inputRange, or = cfg.outputRange;
          if (v <= ir[0]) return or[0];
          if (v >= ir[ir.length - 1]) return or[or.length - 1];
          for (var i = 1; i < ir.length; i++) {
            if (v <= ir[i]) {
              var t  = (v - ir[i-1]) / (ir[i] - ir[i-1]);
              var a  = or[i-1], b = or[i];
              if (typeof a === 'number') return a + t * (b - a);
              var na = parseFloat(a), nb = parseFloat(b);
              var unit = String(a).replace(/^-?[0-9.]+/, '') || String(b).replace(/^-?[0-9.]+/, '');
              return (na + t * (nb - na)) + unit;
            }
          }
          return or[or.length - 1];
        },
        addListener: function (cb) { return self.addListener(function () { cb({ value: this._get() }); }.bind(this)); },
        removeListener: function (id) { self.removeListener(id); }
      };
    };

    function AnimatedValueXY(v) {
      v = v || { x: 0, y: 0 };
      this.x = new AnimatedValue(v.x || 0);
      this.y = new AnimatedValue(v.y || 0);
    }
    AnimatedValueXY.prototype.setValue = function (v) { this.x.setValue(v.x); this.y.setValue(v.y); };
    AnimatedValueXY.prototype.getLayout = function () { return { left: this.x, top: this.y }; };
    AnimatedValueXY.prototype.getTranslateTransform = function () {
      return [{ translateX: this.x }, { translateY: this.y }];
    };

    function easeOut(t) { return 1 - Math.pow(1 - t, 3); }

    function runTiming(val, cfg, cb) {
      if (val instanceof AnimatedValueXY) {
        var done = 0;
        function check(r) { if (++done === 2 && cb) cb(r); }
        runTiming(val.x, { toValue: cfg.toValue.x || 0, duration: cfg.duration }, check);
        runTiming(val.y, { toValue: cfg.toValue.y || 0, duration: cfg.duration }, check);
        return;
      }
      var from = val._value, to = cfg.toValue;
      var dur  = cfg.duration !== undefined ? cfg.duration : 500;
      var ease = cfg.easing || easeOut;
      if (dur === 0 || from === to) { val.setValue(to); if (cb) cb({ finished: true }); return; }
      var start = null;
      function tick(ts) {
        if (!start) start = ts;
        var t = Math.min((ts - start) / dur, 1);
        val.setValue(from + (to - from) * ease(t));
        if (t < 1) requestAnimationFrame(tick);
        else if (cb) cb({ finished: true });
      }
      requestAnimationFrame(tick);
    }

    function runSpring(val, cfg, cb) {
      runTiming(val, { toValue: cfg.toValue, duration: cfg.speed ? 1000 / cfg.speed : 400, easing: function (t) { return 1 - Math.pow(1 - t, 2.5); } }, cb);
    }

    function makeAnim(val, cfg, runner) {
      return { start: function (cb) { runner(val, cfg, cb); }, stop: function () {}, reset: function () {} };
    }

    // HOC: wraps a component to resolve animated values in its style prop
    function createAnimatedComponent(Comp) {
      return function AnimatedComp(p) {
        var tick = React.useState(0)[1];
        React.useEffect(function () {
          var ids = [];
          var styles = Array.isArray(p.style) ? p.style : [p.style];
          styles.forEach(function (st) {
            if (!st) return;
            var vals = Object.values(st);
            vals.forEach(function (v) {
              if (!v) return;
              if (v._value !== undefined) ids.push([v, v.addListener(function () { tick(function (n) { return n + 1; }); })]);
              if (v.__isInterp)           ids.push([v.__parent, v.__parent.addListener(function () { tick(function (n) { return n + 1; }); })]);
            });
          });
          return function () { ids.forEach(function (pair) { pair[0].removeListener(pair[1]); }); };
        });
        function resolveStyle(st) {
          if (!st) return {};
          if (Array.isArray(st)) { var r = {}; st.forEach(function (s) { Object.assign(r, resolveStyle(s)); }); return r; }
          if (typeof st === 'number') return {};
          var out = {};
          for (var k in st) {
            var v = st[k];
            if (!v) { out[k] = v; continue; }
            if (v._value !== undefined) { out[k] = v._value; continue; }
            if (v.__isInterp)           { out[k] = v._get();  continue; }
            if (k === 'transform' && Array.isArray(v)) {
              out[k] = v.map(function (item) {
                var res = {};
                for (var tk in item) {
                  var tv = item[tk];
                  res[tk] = (tv && tv._value !== undefined) ? tv._value : (tv && tv.__isInterp) ? tv._get() : tv;
                }
                return res;
              });
              continue;
            }
            out[k] = v;
          }
          return out;
        }
        return h(Comp, Object.assign({}, p, { style: resolveStyle(p.style) }));
      };
    }

    window.Animated = {
      Value:   AnimatedValue,
      ValueXY: AnimatedValueXY,
      timing:  function (val, cfg) { return makeAnim(val, cfg, runTiming); },
      spring:  function (val, cfg) { return makeAnim(val, cfg, runSpring); },
      decay:   function (val, cfg) { return makeAnim(val, cfg, function (v, c, cb) { if (cb) cb({ finished: true }); }); },
      delay:   function (ms) { return { start: function (cb) { setTimeout(function () { if (cb) cb({ finished: true }); }, ms); }, stop: function(){}, reset: function(){} }; },
      sequence: function (anims) {
        return {
          start: function (cb) {
            var i = 0;
            function next() { if (i >= anims.length) { if (cb) cb({ finished: true }); return; } anims[i++].start(next); }
            next();
          }, stop: function(){}, reset: function(){}
        };
      },
      parallel: function (anims, cfg) {
        return {
          start: function (cb) {
            if (!anims.length) { if (cb) cb({ finished: true }); return; }
            var done = 0;
            anims.forEach(function (a) { a.start(function () { if (++done === anims.length && cb) cb({ finished: true }); }); });
          }, stop: function(){}, reset: function(){}
        };
      },
      stagger: function (delay, anims) {
        return {
          start: function (cb) {
            if (!anims.length) { if (cb) cb({ finished: true }); return; }
            var done = 0;
            anims.forEach(function (a, i) {
              setTimeout(function () { a.start(function () { if (++done === anims.length && cb) cb({ finished: true }); }); }, i * delay);
            });
          }, stop: function(){}, reset: function(){}
        };
      },
      loop: function (anim, cfg) {
        var iterations = (cfg && cfg.iterations !== undefined) ? cfg.iterations : -1;
        var count = 0, stopped = false;
        function run(cb) {
          if (stopped || (iterations > 0 && count >= iterations)) { if (cb) cb({ finished: true }); return; }
          anim.reset && anim.reset(); count++;
          anim.start(function () { run(cb); });
        }
        return { start: function (cb) { stopped = false; run(cb); }, stop: function () { stopped = true; }, reset: function () { count = 0; } };
      },
      event:      function () { return function () {}; },
      add:        function (a, b) { var v = new AnimatedValue((a._value||0)+(b._value||0)); return v; },
      subtract:   function (a, b) { var v = new AnimatedValue((a._value||0)-(b._value||0)); return v; },
      multiply:   function (a, b) { var v = new AnimatedValue((a._value||0)*(b._value||0)); return v; },
      divide:     function (a, b) { var v = new AnimatedValue((a._value||0)/((b._value||b)||1)); return v; },
      modulo:     function (a, m) { var v = new AnimatedValue((a._value||0)%(m||1)); return v; },
      diffClamp:  function (a, l, u) { return a; },
      View:       createAnimatedComponent(window.View),
      Text:       createAnimatedComponent(window.Text),
      Image:      createAnimatedComponent(window.Image),
      ScrollView: createAnimatedComponent(window.ScrollView),
      FlatList:   createAnimatedComponent(window.FlatList)
    };
  })();

  // ── Easing ─────────────────────────────────────────────────────────────────
  window.Easing = {
    linear:  function (t) { return t; },
    ease:    function (t) { return t < 0.5 ? 2*t*t : -1+(4-2*t)*t; },
    quad:    function (t) { return t*t; },
    cubic:   function (t) { return t*t*t; },
    sin:     function (t) { return 1 - Math.cos(t * Math.PI / 2); },
    circle:  function (t) { return 1 - Math.sqrt(1 - t*t); },
    exp:     function (t) { return Math.pow(2, 10*(t-1)); },
    elastic: function (bounciness) { return function (t) { return Math.pow(2,-10*t)*Math.sin((t-0.075)*(2*Math.PI)/0.3)+1; }; },
    back:    function (s) { s = s === undefined ? 1.70158 : s; return function (t) { return t*t*((s+1)*t-s); }; },
    bounce:  function (t) {
      if (t < 1/2.75)       return 7.5625*t*t;
      if (t < 2/2.75)       return 7.5625*(t-=1.5/2.75)*t+0.75;
      if (t < 2.5/2.75)     return 7.5625*(t-=2.25/2.75)*t+0.9375;
      return 7.5625*(t-=2.625/2.75)*t+0.984375;
    },
    bezier:  function () { return function (t) { return t; }; },
    in:      function (e) { return e; },
    out:     function (e) { return function (t) { return 1-e(1-t); }; },
    inOut:   function (e) { return function (t) { return t<0.5 ? e(t*2)/2 : 1-e((1-t)*2)/2; }; }
  };

  // ── Inject global CSS ──────────────────────────────────────────────────────
  var style = document.createElement('style');
  style.textContent =
    '@keyframes rn-spin{to{transform:rotate(360deg)}}' +
    'html,body{margin:0;padding:0;height:100%;background:#000;overflow:hidden}' +
    '#root{display:flex;flex-direction:column;height:100vh;width:100vw;overflow:hidden}' +
    'input,textarea{background:transparent;color:inherit}' +
    'img{display:block}' +
    '*{-webkit-tap-highlight-color:transparent}';
  document.head.appendChild(style);

  // ── Validation log ─────────────────────────────────────────────────────────
  console.log('[RN-COMPAT] Loaded. StyleSheet:', typeof window.StyleSheet,
    '| StyleSheet.create:', typeof window.StyleSheet.create,
    '| View:', typeof window.View,
    '| Animated:', typeof window.Animated);
})();
`;

// ─── HTML preview generator ───────────────────────────────────────────────────
function generatePreviewHtml(appCode) {
  const transformed = transformCodeForWeb(appCode);
  const b64 = Buffer.from(transformed, "utf8").toString("base64");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1"/>
  <title>Omingenous App Preview</title>
  <!-- Only React & ReactDOM + Babel are needed — RN layer is self-contained below -->
  <script crossorigin src="https://unpkg.com/react@18.2.0/umd/react.production.min.js"></script>
  <script crossorigin src="https://unpkg.com/react-dom@18.2.0/umd/react-dom.production.min.js"></script>
  <script src="https://unpkg.com/@babel/standalone@7.23.10/babel.min.js"></script>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    html,body,#root{height:100%;background:#000}
    #loading{position:fixed;inset:0;background:#0f0f0f;display:flex;align-items:center;
      justify-content:center;z-index:9999}
    #loading p{color:#00ff88;font-family:monospace;font-size:15px;
      animation:ld-pulse 1.2s ease-in-out infinite}
    @keyframes ld-pulse{0%,100%{opacity:.3}50%{opacity:1}}
    #err{display:none;padding:32px;background:#0f0f0f;color:#ff6b6b;
      font-family:monospace;font-size:13px;white-space:pre-wrap;
      overflow:auto;min-height:100vh;line-height:1.6}
    #err h2{color:#ff4444;font-size:16px;margin-bottom:12px}
    #err .hint{color:#888;font-size:12px;margin-top:16px}
  </style>
</head>
<body>
  <div id="loading"><p>Building preview...</p></div>
  <div id="root"></div>
  <div id="err"></div>

  <!-- 1. React Native compatibility layer (no CDN dependency) -->
  <script>${RN_COMPAT_JS}<\/script>

  <!-- 2. Decode, compile and run user app -->
  <script>
    (function () {
      var loading = document.getElementById('loading');
      var errDiv  = document.getElementById('err');

      function showError(title, detail) {
        loading.style.display = 'none';
        errDiv.style.display  = 'block';
        errDiv.innerHTML =
          '<h2>Preview Error: ' + escHtml(title) + '<\\/h2>' +
          '<pre>' + escHtml(detail || '') + '<\\/pre>' +
          '<div class=\\"hint\\">Check the browser console for more details.<\\/div>';
      }

      function escHtml(s) {
        return String(s)
          .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      }

      try {
        // Validate runtime loaded correctly
        if (typeof window.StyleSheet === 'undefined' || typeof window.StyleSheet.create !== 'function') {
          throw new Error('RN runtime failed to load: StyleSheet.create is ' + typeof (window.StyleSheet && window.StyleSheet.create));
        }

        // UTF-8 safe base64 decode
        var _b64  = "${b64}";
        var _bin  = atob(_b64);
        var _arr  = new Uint8Array(_bin.length);
        for (var i = 0; i < _bin.length; i++) _arr[i] = _bin.charCodeAt(i);
        var _code = new TextDecoder('utf-8').decode(_arr);

        // Transpile JSX → JS
        var _compiled = Babel.transform(_code, {
          presets: ['react'], filename: 'App.js', retainLines: true
        }).code;

        // Execute compiled code (globals from compat layer are on window)
        eval(_compiled);

        // Locate App component
        var _App =
          typeof App !== 'undefined'                   ? App :
          typeof window.__AppDefault !== 'undefined'   ? window.__AppDefault : null;

        if (!_App) {
          throw new Error(
            'No default App component found.\\n\\n' +
            'Make sure your code contains:\\n  export default function App() { ... }\\n' +
            'or\\n  export default App;'
          );
        }

        loading.style.display = 'none';
        ReactDOM.createRoot(document.getElementById('root'))
          .render(React.createElement(_App));

      } catch (e) {
        console.error('[preview]', e);
        showError(e.message, e.stack || '');
      }
    })();
  <\/script>
</body>
</html>`;
}

// ─── Routes ──────────────────────────────────────────────────────────────────

app.get("/", (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"/>
<title>Omingenous API</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;background:#0f0f0f;color:#f0f0f0;min-height:100vh;display:flex;align-items:center;justify-content:center}.card{background:#1a1a1a;border:1px solid #333;border-radius:12px;padding:48px;max-width:540px;width:100%;text-align:center}h1{font-size:2rem;margin-bottom:8px}p{color:#888;margin-bottom:24px}.badge{display:inline-block;background:#22c55e22;color:#22c55e;border:1px solid #22c55e44;border-radius:999px;padding:4px 14px;font-size:.85rem;margin-bottom:32px}.ep{background:#111;border:1px solid #2a2a2a;border-radius:8px;padding:12px 16px;margin:8px 0;text-align:left;font-family:monospace;font-size:.9rem}.m{color:#60a5fa;margin-right:10px}.p{color:#e2e8f0}</style>
</head><body><div class="card"><h1>Omingenous API</h1><p>Self-hosted browser preview · v2.1.0</p><span class="badge">&#9679; Online</span><div>
<div class="ep"><span class="m">GET</span><span class="p">/health</span></div>
<div class="ep"><span class="m">GET</span><span class="p">/api/status</span></div>
<div class="ep"><span class="m">POST</span><span class="p">/api/deploy</span></div>
<div class="ep"><span class="m">GET</span><span class="p">/preview/:id</span></div>
</div></div></body></html>`);
});

app.get("/health", (req, res) => {
  res.json({ status: "ok", uptime: process.uptime(), previews: previews.size });
});

app.get("/api/status", (req, res) => {
  res.json({
    status: "ok", name: "Omingenous API", version: "2.1.0",
    timestamp: new Date().toISOString(), previewCount: previews.size,
    environment: process.env.NODE_ENV || "production",
  });
});

// POST /api/deploy → store files, return /preview/:id URL
app.post("/api/deploy", (req, res) => {
  try {
    const { files } = req.body;
    if (!files || typeof files !== "object" || Object.keys(files).length === 0) {
      return res.status(400).json({ success: false, error: "files is required and must be non-empty" });
    }
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    previews.set(id, { files, createdAt: Date.now() });
    if (previews.size > 200) previews.delete(previews.keys().next().value);
    const url = `${BASE_URL}/preview/${id}`;
    console.log(`[deploy] preview ${id} created (${Object.keys(files).join(", ")})`);
    return res.json({ success: true, url });
  } catch (err) {
    console.error("[deploy] error:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// GET /preview/:id → serve self-contained HTML web preview
app.get("/preview/:id", (req, res) => {
  const preview = previews.get(req.params.id);
  if (!preview) {
    return res.status(404).send(`<!DOCTYPE html>
<html><head><meta charset="UTF-8"/><title>Preview Expired</title>
<style>body{background:#0f0f0f;color:#ff6b6b;font-family:monospace;padding:48px;text-align:center}</style>
</head><body><h2>Preview Expired</h2><p style="color:#888;margin-top:12px">Rebuild and tap Preview again for a fresh link.</p></body></html>`);
  }
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.send(generateSmartPreview(preview.files));
});

app.use((req, res) => res.status(404).json({ error: "Not found", path: req.path }));
app.use((err, req, res, next) => { console.error(err); res.status(500).json({ error: "Internal server error" }); });

app.listen(PORT, () => console.log(`Server v3.0.0 on port ${PORT} — ${BASE_URL}`));
export default app;

