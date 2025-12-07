// ======================================================
//  TheMob – License Server (Final Version, RESEND)
// ======================================================

const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const crypto = require("crypto");
const { Resend } = require("resend");

const app = express();

// Tebex benötigt RAW JSON
app.use(bodyParser.json({
  verify: (req, res, buf) => req.rawBody = buf
}));
app.use(cors());

// ----------------------------------------------------------
//  CONFIG
// ----------------------------------------------------------

const TARGET_PACKAGE_ID = 7156613;

// In-Memory Lizenzspeicher
let licenses = {}; 

// ----------------------------------------------------------
//  EMAIL SENDER – RESEND
// ----------------------------------------------------------

const resend = new Resend(process.env.RESEND_API_KEY);

async function sendLicenseEmail(to, key) {
  try {
    await resend.emails.send({
      from: "TheMob Store <noreply@themob.store>",
      to,
      subject: "Your TheMob License Key",
      html: `
        <h2>Your License Key</h2>
        <p>Thank you for purchasing The Mob!</p>
        <p>Your personal license key:</p>
        <h3 style="color:#0099ff">${key}</h3>
        <p>Please keep this key safe.</p>
      `
    });

    console.log("📧 Email sent to:", to);

  } catch (err) {
    console.error("❌ Email sending failed (Resend):", err);
  }
}

// ----------------------------------------------------------
//  ROOT
// ----------------------------------------------------------
app.get("/", (req, res) => {
  res.send("TheMob License Server is running.");
});

// ----------------------------------------------------------
//  TEBEX WEBHOOK HANDLER
// ----------------------------------------------------------
app.post("/tebex", async (req, res) => {
  console.log("📬 Tebex Webhook:", JSON.stringify(req.body, null, 2));

  const body = req.body || {};
  const id   = body.id   || null;
  const type = body.type || "unknown";

  if (type === "validation.webhook") {
    console.log("✅ Validation Webhook bestätigt:", id);
    return res.json({ id: id });
  }

  if (type === "payment.completed") {

    const subject  = body.subject  || {};
    const customer = subject.customer || {};
    const products = subject.products || [];
    const product  = products[0] || {};

    const packageId = product.id || 0;

    console.log("📦 Paket gekauft:", packageId);

    if (packageId !== TARGET_PACKAGE_ID) {
      console.log("⚠ Fremdes Paket – kein Lizenzkey erzeugt.");
      return res.json({ id, ignored: true });
    }

    const playerName = customer?.username?.username || "unknown";
    const email      = customer?.email || null;

    const key = crypto.randomBytes(16).toString("hex");
    const expires = Date.now() + 30 * 24 * 60 * 60 * 1000;

    licenses[key] = {
      expires,
      player: playerName,
      email,
      created: Date.now()
    };

    console.log("💎 Neue Lizenz erstellt:", key);
    console.log("📧 Käufer-Email:", email);

    // Erst an Tebex antworten
    res.json({
      id,
      success: true,
      note: `Your Premium License Key: ${key}`,
      license: key,
      player: playerName,
      expires
    });

    // Email senden (async)
    if (email) {
      sendLicenseEmail(email, key)
        .then(() => console.log("📧 Email sent asynchronously"))
        .catch(err => console.error("❌ Async email error:", err));
    }

    return;
  }

  res.json({ id, received: true });
});

// ----------------------------------------------------------
//  VALIDATE ENDPOINT
// ----------------------------------------------------------
app.get("/validate", (req, res) => {
  const key = req.query.key;

  if (!key) return res.json({ valid: false });

  const lic = licenses[key];
  if (!lic) return res.json({ valid: false });

  if (Date.now() > lic.expires) return res.json({ valid: false });

  return res.json({
    valid: true,
    player: lic.player,
    expires: lic.expires
  });
});

// ----------------------------------------------------------
// SERVER START
// ----------------------------------------------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("🚀 License server running on port", PORT);
});
