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

// ---- HTML preview generator ----
function transformCodeForWeb(code) {
  if (!code) return "";
  return code
    // Remove all import statements
    .replace(/^import\s+[\s\S]*?from\s+['"][^'"]+['"]\s*;?\s*$/gm, "")
    .replace(/^import\s+['"][^'"]+['"]\s*;?\s*$/gm, "")
    // export default function App → function App
    .replace(/export\s+default\s+function\s+(\w+)/g, "function $1")
    // export default class Foo → class Foo
    .replace(/export\s+default\s+class\s+(\w+)/g, "class $1")
    // export default <expr> → window.__AppDefault = <expr>
    .replace(/export\s+default\s+/g, "window.__AppDefault = ")
    // remove named exports
    .replace(/export\s+\{[^}]+\}\s*;?/g, "")
    .replace(/export\s+(const|let|var)\s+/g, "$1 ")
    .replace(/export\s+function\s+/g, "function ");
}

function generatePreviewHtml(appCode) {
  const transformed = transformCodeForWeb(appCode);
  // base64-encode to safely embed inside script tag (avoids </script> injection)
  const b64 = Buffer.from(transformed, "utf8").toString("base64");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Omingenous App Preview</title>
  <script crossorigin src="https://unpkg.com/react@18.2.0/umd/react.production.min.js"></script>
  <script crossorigin src="https://unpkg.com/react-dom@18.2.0/umd/react-dom.production.min.js"></script>
  <script src="https://unpkg.com/react-native-web@0.19.12/dist/react-native-web.min.js"></script>
  <script src="https://unpkg.com/@babel/standalone@7.23.10/babel.min.js"></script>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    html,body,#root{height:100%;background:#000}
    #err{display:none;padding:32px;background:#0f0f0f;color:#ff6b6b;font-family:monospace;min-height:100vh;white-space:pre-wrap}
    #loading{position:fixed;inset:0;background:#000;display:flex;align-items:center;justify-content:center;z-index:999}
    #loading p{color:#00ff88;font-family:monospace;font-size:16px;animation:pulse 1.2s ease-in-out infinite}
    @keyframes pulse{0%,100%{opacity:.4}50%{opacity:1}}
  </style>
</head>
<body>
  <div id="loading"><p>Building preview...</p></div>
  <div id="root"></div>
  <div id="err"></div>

  <script>
    // ---- Expose React Native Web components as globals ----
    (function(){
      var RN = ReactNativeWeb;
      [
        'View','Text','TextInput','TouchableOpacity','ScrollView','FlatList',
        'StyleSheet','Image','Modal','ActivityIndicator','Platform','Dimensions',
        'SafeAreaView','StatusBar','KeyboardAvoidingView','Pressable','Switch',
        'TouchableHighlight','TouchableWithoutFeedback','Animated','Easing',
        'SectionList','ImageBackground','RefreshControl','VirtualizedList',
        'TouchableNativeFeedback','AppState'
      ].forEach(function(k){ if(RN[k]) window[k]=RN[k]; });

      // React hooks as globals
      var R = window.React;
      ['useState','useEffect','useRef','useCallback','useMemo','useContext',
       'useReducer','useLayoutEffect','forwardRef','memo','createContext',
       'Children','cloneElement','Fragment','createRef','isValidElement'
      ].forEach(function(k){ if(R[k]) window[k]=R[k]; });

      // AsyncStorage → localStorage bridge
      window.AsyncStorage = {
        getItem:    function(k){ return Promise.resolve(localStorage.getItem(k)); },
        setItem:    function(k,v){ localStorage.setItem(k,v); return Promise.resolve(); },
        removeItem: function(k){ localStorage.removeItem(k); return Promise.resolve(); },
        getAllKeys:  function(){ return Promise.resolve(Object.keys(localStorage)); },
        multiGet:   function(ks){ return Promise.resolve(ks.map(function(k){return[k,localStorage.getItem(k)];})); },
        multiSet:   function(pairs){ pairs.forEach(function(p){localStorage.setItem(p[0],p[1]);}); return Promise.resolve(); },
        multiRemove:function(ks){ ks.forEach(function(k){localStorage.removeItem(k);}); return Promise.resolve(); },
        clear:      function(){ localStorage.clear(); return Promise.resolve(); }
      };

      // Alert → native browser dialog
      window.Alert = {
        alert: function(title, msg, btns){
          window.alert((title||'') + (msg ? '\\n\\n' + msg : ''));
          if(btns && btns.length>0 && btns[0].onPress) btns[0].onPress();
        }
      };

      // Linking → window.open
      window.Linking = {
        openURL: function(url){ window.open(url,'_blank'); return Promise.resolve(); },
        canOpenURL: function(){ return Promise.resolve(true); },
        getInitialURL: function(){ return Promise.resolve(null); }
      };

      // Navigation mocks (no-op stubs)
      window.useNavigation = function(){
        return { navigate:function(){}, goBack:function(){}, push:function(){},
                 replace:function(){}, setOptions:function(){}, reset:function(){} };
      };
      window.useRoute    = function(){ return { params:{} }; };
      window.useIsFocused= function(){ return true; };
      window.NavigationContainer = function(p){ return p.children; };
      function _stubNav(){ return {
        Navigator: function(p){ return p.children; },
        Screen:    function(p){ return null; }
      }; }
      window.createNativeStackNavigator   = _stubNav;
      window.createStackNavigator         = _stubNav;
      window.createBottomTabNavigator     = _stubNav;
      window.createDrawerNavigator        = _stubNav;
      window.createMaterialTopTabNavigator= _stubNav;

      // Misc Expo / RN mocks
      window.NetInfo = { fetch: function(){ return Promise.resolve({isConnected:true,type:'wifi'}); } };
      window.useNetInfo = function(){ return {isConnected:true}; };
      window.Vibration  = { vibrate:function(){}, cancel:function(){} };
      window.Haptics    = {
        impactAsync:      function(){ return Promise.resolve(); },
        selectionAsync:   function(){ return Promise.resolve(); },
        notificationAsync:function(){ return Promise.resolve(); }
      };
      window.Clipboard  = {
        setString: function(s){ if(navigator.clipboard) navigator.clipboard.writeText(s); },
        getString:  function(){ return Promise.resolve(''); }
      };
      window.Share = { share: function(c){ window.alert('Share: '+(c.message||'')); return Promise.resolve({action:'sharedAction'}); } };
      window.ImagePicker    = { launchImageLibraryAsync: function(){ return Promise.resolve({canceled:true,assets:[]}); } };
      window.DocumentPicker = { getDocumentAsync: function(){ return Promise.resolve({canceled:true}); } };
      window.FileSystem     = {
        documentDirectory: '/',
        readAsStringAsync: function(){ return Promise.resolve(''); },
        writeAsStringAsync:function(){ return Promise.resolve(); },
        deleteAsync:       function(){ return Promise.resolve(); },
        getInfoAsync:      function(){ return Promise.resolve({exists:false}); }
      };
      window.SecureStore = {
        getItemAsync:   function(k){ return Promise.resolve(localStorage.getItem('secure_'+k)); },
        setItemAsync:   function(k,v){ localStorage.setItem('secure_'+k,v); return Promise.resolve(); },
        deleteItemAsync:function(k){ localStorage.removeItem('secure_'+k); return Promise.resolve(); }
      };
      window.Constants  = { manifest:{ version:'1.0.0' }, expoVersion:'51.0.0' };
      window.Platform   = Object.assign({}, window.Platform||{}, { OS:'web', select:function(o){ return o.web||o.default||null; } });
    })();
  </script>

  <script>
    // ---- Load, compile and run user app ----
    (function(){
      var loading = document.getElementById('loading');
      var errDiv  = document.getElementById('err');

      function showError(msg){
        loading.style.display = 'none';
        errDiv.style.display  = 'block';
        errDiv.textContent    = 'Render Error:\\n\\n' + msg;
      }

      try {
        // Decode base64 user code
        var b64  = "${b64}";
        var code = decodeURIComponent(escape(atob(b64)));

        // Transpile JSX → JS via Babel standalone
        var compiled = Babel.transform(code, {
          presets: ['react'],
          filename: 'App.js'
        }).code;

        // Eval the compiled output (globals are already on window)
        eval(compiled);

        // Find the App component
        var AppCmp =
          (typeof App !== 'undefined'              ? App              :
           typeof window.__AppDefault !== 'undefined' ? window.__AppDefault :
           null);

        if(!AppCmp){
          return showError('Could not find an exported App component.\\n\\nMake sure your code exports a default App function.');
        }

        loading.style.display = 'none';
        ReactDOM.createRoot(document.getElementById('root'))
                .render(React.createElement(AppCmp));

      } catch(e){
        showError(e.message + (e.stack ? '\\n\\n' + e.stack : ''));
      }
    })();
  </script>
</body>
</html>`;
}

// ---- Routes ----

app.get("/", (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Omingenous API</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#0f0f0f;color:#f0f0f0;min-height:100vh;display:flex;align-items:center;justify-content:center}
    .card{background:#1a1a1a;border:1px solid #333;border-radius:12px;padding:48px;max-width:540px;width:100%;text-align:center}
    h1{font-size:2rem;margin-bottom:8px;color:#fff}
    p{color:#888;margin-bottom:24px}
    .badge{display:inline-block;background:#22c55e22;color:#22c55e;border:1px solid #22c55e44;border-radius:999px;padding:4px 14px;font-size:.85rem;margin-bottom:32px}
    .endpoint{background:#111;border:1px solid #2a2a2a;border-radius:8px;padding:12px 16px;margin:8px 0;text-align:left;font-family:monospace;font-size:.9rem}
    .method{color:#60a5fa;margin-right:10px}.path{color:#e2e8f0}
  </style>
</head>
<body>
  <div class="card">
    <h1>Omingenous API</h1>
    <p>Node.js + Express · Self-hosted web previews</p>
    <span class="badge">&#9679; Online</span>
    <div>
      <div class="endpoint"><span class="method">GET</span><span class="path">/health</span></div>
      <div class="endpoint"><span class="method">GET</span><span class="path">/api/status</span></div>
      <div class="endpoint"><span class="method">POST</span><span class="path">/api/deploy</span></div>
      <div class="endpoint"><span class="method">GET</span><span class="path">/preview/:id</span></div>
    </div>
  </div>
</body>
</html>`);
});

app.get("/health", (req, res) => {
  res.json({ status: "ok", uptime: process.uptime(), previews: previews.size });
});

app.get("/api/status", (req, res) => {
  res.json({
    status: "ok",
    name: "Omingenous API",
    version: "2.0.0",
    timestamp: new Date().toISOString(),
    previewCount: previews.size,
    environment: process.env.NODE_ENV || "production",
  });
});

// POST /api/deploy — store files and return direct browser URL
app.post("/api/deploy", (req, res) => {
  try {
    const { files } = req.body;

    if (!files || typeof files !== "object" || Object.keys(files).length === 0) {
      return res.status(400).json({ success: false, error: "files is required and must be non-empty" });
    }

    // Generate a short unique ID
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    previews.set(id, { files, createdAt: Date.now() });

    // Keep at most 200 previews in memory (LRU: drop oldest)
    if (previews.size > 200) {
      const oldestKey = previews.keys().next().value;
      previews.delete(oldestKey);
    }

    const url = `${BASE_URL}/preview/${id}`;
    console.log(`[deploy] preview created: ${url} (files: ${Object.keys(files).join(", ")})`);
    return res.json({ success: true, url });

  } catch (err) {
    console.error("[deploy] error:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// GET /preview/:id — serve self-contained HTML web preview
app.get("/preview/:id", (req, res) => {
  const preview = previews.get(req.params.id);

  if (!preview) {
    return res.status(404).send(`<!DOCTYPE html>
<html><head><meta charset="UTF-8"/><title>Preview Expired</title>
<style>body{background:#0f0f0f;color:#ff6b6b;font-family:monospace;padding:48px;text-align:center}h2{margin-bottom:12px}p{color:#888}</style>
</head><body>
<h2>Preview Not Found</h2>
<p>This preview may have expired (server restarted) or the ID is invalid.</p>
<p style="margin-top:24px">Rebuild your app and tap Preview again to get a fresh link.</p>
</body></html>`);
  }

  // Find App.js (or first .js file with code)
  const fileMap = preview.files;
  const appEntry =
    fileMap["App.js"]   ||
    fileMap["app.js"]   ||
    fileMap["index.js"] ||
    Object.values(fileMap).find(f => f && (f.contents || f.content));

  const appCode = (appEntry && (appEntry.contents || appEntry.content)) || "";

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.send(generatePreviewHtml(appCode));
});

app.use((req, res) => {
  res.status(404).json({ error: "Not found", path: req.path });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT} — preview base: ${BASE_URL}`);
});

export default app;
