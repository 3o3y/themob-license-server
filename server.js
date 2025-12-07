// server.js
const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const crypto = require("crypto");

const app = express();

// Body als JSON parsen + rohen Body behalten (falls du später Signaturen prüfen willst)
app.use(bodyParser.json({
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));
app.use(cors());

// In-Memory Lizenzspeicher
// ACHTUNG: Bei Render Free-Tier gehen diese Daten bei jedem Neustart verloren.
// Für echte Produktion später z.B. eine kleine DB (SQLite, Mongo, etc.) nutzen.
let licenses = {}; // { key: { expires, player, created } }

// ======================================================
// ROOT – zum Testen im Browser
// ======================================================
app.get("/", (req, res) => {
  res.send("TheMob License Server is running.");
});

// ======================================================
// 1) TEBEX WEBHOOK: POST https://<dein-render>.onrender.com/tebex
//    → in Tebex als Checkout Webhook Endpoint eintragen
// ======================================================
app.post("/tebex", (req, res) => {
  console.log("📬 Tebex Webhook:", JSON.stringify(req.body, null, 2));

  const body = req.body || {};
  const id = body.id || null;
  const type = body.type || "unknown";

  if (type === "validation.webhook") {
    console.log("✅ Validation Webhook erhalten:", id);
    return res.json({ id: id });
  }

  if (type === "payment.completed") {

    const subject = body.subject || {};
    const customer = subject.customer || {};
    const usernameObj = customer.username || {};

    const playerName = usernameObj.username || "unknown";

    const durationDays = 30;
    const key = crypto.randomBytes(16).toString("hex");
    const expires = Date.now() + durationDays * 24 * 60 * 60 * 1000;

    licenses[key] = {
      expires,
      player: playerName,
      created: Date.now()
    };

    console.log("💎 Neue Premium-Lizenz erstellt:", key);

    return res.json({
      id: id,
      success: true,

      // 👇 Käufer sieht es in der Email + Checkout-Seite
      note: `Your Premium License Key: ${key}`,

      license: key,
      player: playerName,
      expires
    });
  }
  // Unbekannter Webhook-Typ
  console.log("ℹ Unbehandelter Webhook-Typ:", type);
  return res.json({ id: id, received: true });
});

// ======================================================
// 2) VALIDATE – vom Minecraft-Plugin aufgerufen
//    GET https://<dein-render>.onrender.com/validate?key=XXXX
// ======================================================
app.get("/validate", (req, res) => {
  const key = req.query.key;

  if (!key) {
    console.log("❌ Validate ohne Key aufgerufen.");
    return res.json({ valid: false });
  }

  const lic = licenses[key];
  if (!lic) {
    console.log("❌ Unknown license key:", key);
    return res.json({ valid: false });
  }

  // Abgelaufen?
  if (Date.now() > lic.expires) {
    console.log("⌛ License expired:", key);
    return res.json({ valid: false });
  }

  console.log("✅ License valid:", key, "Player:", lic.player);
  return res.json({
    valid: true,
    player: lic.player,
    expires: lic.expires
  });
});

// ======================================================
// SERVER STARTEN
// ======================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("🚀 License server running on port", PORT);
});
