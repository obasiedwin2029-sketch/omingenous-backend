import express from "express";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 8080;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
  res.setHeader("X-Powered-By", "Omingenous API");
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
      max-width: 480px;
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
    <p>Node.js + Express backend</p>
    <span class="badge">● Online</span>
    <div>
      <div class="endpoint"><span class="method">GET</span><span class="path">/</span></div>
      <div class="endpoint"><span class="method">GET</span><span class="path">/health</span></div>
      <div class="endpoint"><span class="method">GET</span><span class="path">/api/status</span></div>
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
    version: "1.0.0",
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || "production",
  });
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
