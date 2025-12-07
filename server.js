const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const crypto = require("crypto");
const nodemailer = require("nodemailer");

const app = express();

app.use(bodyParser.json({
  verify: (req, res, buf) => req.rawBody = buf
}));
app.use(cors());

// In-Memory Lizenzspeicher
let licenses = {}; // { key: { expires, player, email, created } }

// ----------------------------------------------------------
// EMAIL SENDER – direkt nach Zahlung wird eine Email geschickt
// ----------------------------------------------------------
async function sendLicenseEmail(to, key) {
  try {
    let transporter = nodemailer.createTransport({
      host: "smtp.gmx.com",    // ODER GMX: mail.gmx.net, Outlook: smtp.office365.com
      port: 587,
      secure: false,
      auth: {
        user: "3o3y@gmx.net",     // << HIER EINTRAGEN
        pass: "Alpha8408?!"          // << HIER EINTRAGEN
      }
    });

    let msg = {
      from: '"TheMob Store" <DEINE_EMAIL@gmail.com>',
      to: to,
      subject: "Your TheMob License Key",
      html: `
        <h2>Your License Key</h2>
        <p>Thank you for your purchase!</p>
        <p>Your license key:</p>
        <h3>${key}</h3>
        <p>Keep this key safe.</p>
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

  // Validation Webhook
  if (type === "validation.webhook") {
    console.log("✅ Validation Webhook erhalten:", id);
    return res.json({ id: id });
  }

  // PAYMENT COMPLETED
  if (type === "payment.completed") {

    const subject = body.subject || {};
    const customer = subject.customer || {};

    const usernameObj = customer.username || {};
    const playerName = usernameObj.username || "unknown";

    const email = customer.email || null;   // << WICHTIG! Email vom Käufer

    const durationDays = 30;
    const key = crypto.randomBytes(16).toString("hex");
    const expires = Date.now() + durationDays * 24 * 60 * 60 * 1000;

    licenses[key] = {
      expires,
      player: playerName,
      email: email,
      created: Date.now()
    };

    console.log("💎 Neue Premium-Lizenz:", key);
    console.log("📧 Email des Käufers:", email);

    // -----------------------------
    //  E-MAIL SOFORT ABSCHICKEN
    // -----------------------------
    if (email) {
      sendLicenseEmail(email, key);
    } else {
      console.log("⚠ Kein Email-Feld – kann keine Email senden.");
    }

    // -----------------------------
    // Antwort an Tebex (nicht wichtig)
    // -----------------------------
    return res.json({
      id: id,
      success: true,
      note: `Your Premium License Key: ${key}`, // falls Tebex es später anzeigt
      license: key,
      player: playerName,
      expires
    });
  }

  return res.json({ id: id, received: true });
});

// ----------------------------------------------------------
// Lizenz prüfen (Plugin)
// ----------------------------------------------------------
app.get("/validate", (req, res) => {
  const key = req.query.key;

  if (!key) {
    return res.json({ valid: false });
  }

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
