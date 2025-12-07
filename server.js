// server.js
const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const crypto = require("crypto");

const app = express();

// wichtig: rohen Body behalten (für spätere Signature-Checks)
app.use(bodyParser.json({
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));
app.use(cors());

let licenses = {}; // { key: { expires, player } }

// ======================================================
// ROOT – zum Testen im Browser
// ======================================================
app.get("/", (req, res) => {
  res.send("TheMob License Server is running.");
});

// ======================================================
// 1) TEBEX WEBHOOK: https://.../tebex
//    → in Tebex als Endpoint eintragen
// ======================================================
app.post("/tebex", (req, res) => {
  console.log("📬 Tebex Webhook:", req.body);

  const body = req.body || {};
  const id = body.id || null;
  const type = body.type || "unknown";

  // 1) VALIDATION WEBHOOK
  // --------------------------------------------------
  if (type === "validation.webhook") {
    console.log("✅ Validation Webhook erhalten:", id);
    // Tebex erwartet GENAU dieses JSON
    return res.json({ id: id });
  }

  // 2) PAYMENT WEBHOOK (z.B. payment.completed)
  // --------------------------------------------------
  if (type === "payment.completed") {
    const subject = body.subject || {};
    const customer = subject.customer || {};
    const usernameObj = customer.username || {};

    const playerName = usernameObj.username || "unknown";

    // 30 Tage Premium
    const durationDays = 30;
    const key = crypto.randomBytes(16).toString("hex");
    const expires = Date.now() + durationDays * 24 * 60 * 60 * 1000;

    licenses[key] = {
      expires,
      player: playerName,
      created: Date.now()
    };

    console.log("💎 Neue Premium-Lizenz:", key, "Player:", playerName, "Expires:", new Date(expires));

    // Antwort an Tebex – kann alles sein, 2xx reicht
    return res.json({
      id: id,
      success: true,
      license: key,
      player: playerName,
      expires
    });
  }

  // Fallback: unbekannter Typ
  console.log("ℹ Unbehandelter Webhook-Typ:", type);
  return res.json({ id: id, received: true });
});

// ======================================================
// 2) VALIDATE – vom Minecraft-Plugin aufgerufen
//    GET https://.../validate?key=XXXX
// ======================================================
app.get("/validate", (req, res) => {
  const key = req.query.key;
  if (!key) return res.json({ valid: false });

  const lic = licenses[key];
  if (!lic) return res.json({ valid: false });

  if (Date.now() > lic.expires) {
    return res.json({ valid: false });
  }

  return res.json({
    valid: true,
    player: lic.player,
    expires: lic.expires
  });
});

// ======================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("🚀 License server running on port", PORT);
});
