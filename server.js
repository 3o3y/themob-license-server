// ======================================================
//  TheMob – License Server (Final Version)
// ======================================================

const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const crypto = require("crypto");
const nodemailer = require("nodemailer");

const app = express();

// Raw JSON speichern (Tebex braucht das)
app.use(bodyParser.json({
  verify: (req, res, buf) => req.rawBody = buf
}));
app.use(cors());

// ----------------------------------------------------------
//  CONFIG
// ----------------------------------------------------------

// >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
// TRAGE HIER DEINE TEBEX-PACKAGE-ID EIN !!
const TARGET_PACKAGE_ID = 1234567;
// <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<


// In-Memory Lizenzspeicher
let licenses = {}; 
// { key: { expires, player, email, created } }

// ----------------------------------------------------------
//  EMAIL-SYSTEM – GMX SMTP
// ----------------------------------------------------------
async function sendLicenseEmail(to, key) {
  try {
    let transporter = nodemailer.createTransport({
      host: "mail.gmx.net",
      port: 587,
      secure: false,
      auth: {
        user: "3o3y@gmx.net",      // <<< HIER DEINE EMAIL
        pass: "Alpha8408?!"        // <<< HIER DEIN GMX PASSWORT
      }
    });

    let msg = {
      from: '"TheMob Store" <3o3y@gmx.net>', // MUSS zur GMX-Adresse passen!
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
//  TEBEX WEBHOOK
// ----------------------------------------------------------
app.post("/tebex", async (req, res) => {
  console.log("📬 Tebex Webhook:", JSON.stringify(req.body, null, 2));

  const body = req.body || {};
  const id = body.id || null;
  const type = body.type || "unknown";

  // Tebex Validation (einmalig)
  if (type === "validation.webhook") {
    console.log("✅ Validation Webhook bestätigt:", id);
    return res.json({ id: id });
  }

  // Zahlung abgeschlossen
  if (type === "payment.completed") {

    const subject = body.subject || {};
    const customer = subject.customer || {};
    const packageObj = subject.package || {};

    const packageId = packageObj.id || 0;
    const packageName = packageObj.name || "unknown";

    console.log("📦 Paket gekauft:", packageId, packageName);

    // ------------------------------------------------------
    //   NUR „The Mob“ soll eine Lizenz erzeugen
    // ------------------------------------------------------
    if (packageId !== 7156613) {
      console.log("⚠ Anderes Paket – kein Lizenzkey wird erstellt.");
      return res.json({ id: id, ignored: true });
    }

    // Käuferdaten
    const usernameObj = customer.username || {};
    const playerName = usernameObj.username || "unknown";
    const email = customer.email || null;

    // Lizenz generieren
    const key = crypto.randomBytes(16).toString("hex");
    const durationDays = 30;
    const expires = Date.now() + durationDays * 24 * 60 * 60 * 1000;

    // speichern
    licenses[key] = {
      expires,
      player: playerName,
      email: email,
      created: Date.now()
    };

    console.log("💎 Neue Premium-Lizenz erstellt:", key);
    console.log("📧 Käufer-E-Mail:", email);

    // -------------------------
    //  E-Mail sofort abschicken
    // -------------------------
    if (email) {
      await sendLicenseEmail(email, key);
    } else {
      console.log("⚠ Käufer hat keine Email – kann keine Nachricht senden.");
    }

    // Rückmeldung an Tebex
    return res.json({
      id: id,
      success: true,
      note: `Your Premium License Key: ${key}`,
      license: key,
      player: playerName,
      expires
    });
  }

  console.log("ℹ Unbehandelter Webhook:", type);
  return res.json({ id: id, received: true });
});

// ----------------------------------------------------------
//  VALIDATE (Plugin ruft dies auf)
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