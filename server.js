// ======================================================
//  TheMob – License Server (Final Version, FIXED)
// ======================================================

const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const crypto = require("crypto");
const nodemailer = require("nodemailer");

const app = express();

// Tebex benötigt RAW JSON
app.use(bodyParser.json({
  verify: (req, res, buf) => req.rawBody = buf
}));
app.use(cors());

// ----------------------------------------------------------
//  CONFIG
// ----------------------------------------------------------

// ✔️ DIE KORREKTE TEBEX PRODUCT ID
const TARGET_PACKAGE_ID = 7156613;

// In-Memory Lizenzspeicher
let licenses = {}; 
// { key: { expires, player, email, created } }

// ----------------------------------------------------------
//  EMAIL SENDER – GMail SMTP
// ----------------------------------------------------------
async function sendLicenseEmail(to, key) {
  try {
    let transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 587,
      secure: false,
      auth: {
        user: "3o3y87@gmail.com",
        pass: "hyax xjsj lvpi wryw"
      }

    });

    let msg = {
      from: '"TheMob Store" <3o3y87@gmail.com>',
      to: to,
      subject: "Your TheMob License Key",
      html: `
        <h2>Your License Key</h2>
        <p>Thank you for purchasing The Mob!</p>
        <p>Your personal license key:</p>
        <h3 style="color:#0099ff">${key}</h3>
        <p>Please keep this key safe and enter it in your plugin config.</p>
      `
    };

    await transporter.sendMail(msg);
    console.log("📧 Email sent to:", to);

  } catch (err) {
    console.error("❌ Email sending failed:", err);
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

  // ------------------------------------------------------
  // 1) WEBHOOK VALIDATION
  // ------------------------------------------------------
  if (type === "validation.webhook") {
    console.log("✅ Validation Webhook bestätigt:", id);
    return res.json({ id: id });
  }

  // ------------------------------------------------------
  // 2) PAYMENT COMPLETED
  // ------------------------------------------------------
  if (type === "payment.completed") {

    const subject  = body.subject  || {};
    const customer = subject.customer || {};

    // WICHTIG: Produkte kommen aus subject.products[]
    const products = subject.products || [];
    const product  = products[0] || {};

    const packageId   = product.id   || 0;
    const packageName = product.name || "unknown";

    console.log("📦 Paket gekauft:", packageId, packageName);

    // Nur unser Paket erlaubt
    if (packageId !== 7156613) {
      console.log("⚠ Fremdes Paket – kein Lizenzkey erzeugt.");
      return res.json({ id: id, ignored: true });
    }

    // Käuferdaten
    const usernameObj = customer.username || {};
    const playerName  = usernameObj.username || "unknown";
    const email       = customer.email || null;

    // Lizenzkey generieren
    const key         = crypto.randomBytes(16).toString("hex");
    const durationDay = 30;
    const expires     = Date.now() + durationDay * 24 * 60 * 60 * 1000;

    // Speichern
    licenses[key] = {
      expires,
      player: playerName,
      email,
      created: Date.now()
    };

    console.log("💎 Neue Lizenz erstellt:", key);
    console.log("📧 Käufer-Email:", email);

    // Email direkt senden
    if (email) {
      await sendLicenseEmail(email, key);
    } else {
      console.log("⚠ Käufer hat keine Email – keine Nachricht möglich.");
    }

    // Antwort an Tebex
    return res.json({
      id: id,
      success: true,
      note: `Your Premium License Key: ${key}`,
      license: key,
      player: playerName,
      expires
    });
  }

  console.log("ℹ Unbekannter Webhook-Typ:", type);
  return res.json({ id: id, received: true });
});

// ----------------------------------------------------------
//  VALIDATE ENDPOINT (für dein Minecraft Plugin)
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
