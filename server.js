import express from "express";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 8080;

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

app.get("/", (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Omingenous API</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #0f0f0f;
      color: #f0f0f0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .card {
      background: #1a1a1a;
      border: 1px solid #333;
      border-radius: 12px;
      padding: 48px;
      max-width: 520px;
      width: 100%;
      text-align: center;
    }
    h1 { font-size: 2rem; margin-bottom: 8px; color: #fff; }
    p  { color: #888; margin-bottom: 24px; }
    .badge {
      display: inline-block;
      background: #22c55e22;
      color: #22c55e;
      border: 1px solid #22c55e44;
      border-radius: 999px;
      padding: 4px 14px;
      font-size: 0.85rem;
      margin-bottom: 32px;
    }
    .endpoint {
      background: #111;
      border: 1px solid #2a2a2a;
      border-radius: 8px;
      padding: 12px 16px;
      margin: 8px 0;
      text-align: left;
      font-family: monospace;
      font-size: 0.9rem;
    }
    .method { color: #60a5fa; margin-right: 10px; }
    .path   { color: #e2e8f0; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Omingenous API</h1>
    <p>Node.js + Express backend · Render</p>
    <span class="badge">● Online</span>
    <div>
      <div class="endpoint"><span class="method">GET</span><span class="path">/</span></div>
      <div class="endpoint"><span class="method">GET</span><span class="path">/health</span></div>
      <div class="endpoint"><span class="method">GET</span><span class="path">/api/status</span></div>
      <div class="endpoint"><span class="method">POST</span><span class="path">/api/deploy</span></div>
    </div>
  </div>
</body>
</html>`);
});

app.get("/health", (req, res) => {
  res.json({ status: "ok", uptime: process.uptime() });
});

app.get("/api/status", (req, res) => {
  res.json({
    status: "ok",
    name: "Omingenous API",
    version: "1.1.0",
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || "production",
  });
});

app.post("/api/deploy", async (req, res) => {
  try {
    const { files, dependencies } = req.body;

    if (!files || typeof files !== "object") {
      return res.status(400).json({ success: false, error: "files is required" });
    }

    const payload = {
      files,
      dependencies: dependencies || {
        react: "18.2.0",
        "react-native": "0.74.0",
        expo: "~51.0.0",
        "@react-navigation/native": "^6.1.17",
        "@react-navigation/stack": "^6.3.29",
        "react-native-screens": "~3.31.1",
        "react-native-safe-area-context": "4.10.5",
        "@react-native-async-storage/async-storage": "1.23.1",
        "expo-image-picker": "~15.0.0",
        "expo-document-picker": "~12.0.0",
      },
    };

    const snackRes = await fetch("https://snack.expo.dev/api/snack/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await snackRes.json();

    if (data && data.id) {
      const url = `https://snack.expo.dev/${data.id}`;
      console.log(`Deployed: ${url}`);
      return res.json({ success: true, url, id: data.id });
    }

    return res.status(502).json({
      success: false,
      error: "Snack save failed",
      detail: data,
    });
  } catch (err) {
    console.error("Deploy error:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.use((req, res) => {
  res.status(404).json({ error: "Not found", path: req.path });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

export default app;
