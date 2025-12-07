const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const crypto = require("crypto");
const fetch = require("node-fetch");

const app = express();

app.use(bodyParser.json());
app.use(cors());

// Hier DEIN Tebex Secret Key!
const TEBEX_SECRET = "xxxxxxxxxxxxxxxxxxxxxxxx";

// Speicher
let licenses = {};

// ROOT
app.get("/", (req, res) => {
  res.send("TheMob License Server is running.");
});

// WEBHOOK
app.post("/tebex", async (req, res) => {

  const body = req.body;
  const id = body.id;
  const type = body.type;

  console.log("📬 Tebex webhook", type, id);

  if (type === "validation.webhook") {
    return res.json({ id });
  }

  if (type === "payment.completed") {

    const player = body.subject.customer.username.username;

    const key = crypto.randomBytes(16).toString("hex");
    const expires = Date.now() + 30 * 24 * 60 * 60 * 1000;

    licenses[key] = { player, expires };

    console.log("💎 KEY GENERATED:", key);

    // ==========================================
    //  **SCHRITT 1: LICENSE KEY IN TEBEX SPEICHERN**
    // ==========================================
    await fetch(`https://plugin.tebex.io/payments/${id}/variables`, {
      method: "POST",
      headers: {
        "X-Tebex-Secret": TEBEX_SECRET,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        license_key: key
      })
    });

    console.log("📦 KEY stored in Tebex order");

    // ==========================================
    // Rückgabe an Tebex
    // ==========================================
    return res.json({
      id,
      success: true
    });
  }

  return res.json({ id, received: true });
});

// VALIDATE
app.get("/validate", (req, res) => {
  const key = req.query.key;

  if (!licenses[key]) return res.json({ valid: false });
  if (Date.now() > licenses[key].expires) return res.json({ valid: false });

  return res.json({
    valid: true,
    player: licenses[key].player,
    expires: licenses[key].expires
  });
});

app.listen(3000, () => {
  console.log("🚀 License Server running");
});
