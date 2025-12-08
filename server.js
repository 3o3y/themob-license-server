// ======================================================
//  TheMob – License Server (MySQL + RESEND + SIGNED KEYS)
// ======================================================

const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const crypto = require("crypto");
const { Resend } = require("resend");
const mysql = require("mysql2/promise");
const jwt = require("jsonwebtoken");

const app = express();

// Tebex benötigt RAW JSON
app.use(bodyParser.json({
  verify: (req, res, buf) => req.rawBody = buf
}));
app.use(cors());

// ----------------------------------------------------------
//  ENV CHECKS
// ----------------------------------------------------------

if (!process.env.MYSQL_HOST ||
    !process.env.MYSQL_USER ||
    !process.env.MYSQL_PASS ||
    !process.env.MYSQL_DB) {
  console.warn("⚠ MYSQL ENV Variablen sind nicht vollständig gesetzt!");
}

if (!process.env.LICENSE_SECRET) {
  console.warn("⚠ LICENSE_SECRET ist nicht gesetzt! Signierte Keys sind dann unsicher.");
}

const LICENSE_SECRET = process.env.LICENSE_SECRET || "CHANGE_ME_NOW_IN_PRODUCTION";

// ----------------------------------------------------------
//  MYSQL CONNECTION (POOL – STABIL FÜR G-PORTAL)
// ----------------------------------------------------------

const db = mysql.createPool({
  host: process.env.MYSQL_HOST,     // z.B. db2.sql.g-portal.com
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASS,
  database: process.env.MYSQL_DB,
  port: 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// Testverbindung
db.getConnection()
  .then(conn => {
    console.log("✅ MySQL Pool: Verbindung hergestellt.");
    conn.release();
  })
  .catch(err => {
    console.error("❌ MySQL Pool Fehler:", err);
  });

// ----------------------------------------------------------
//  RESEND EMAIL SENDER
// ----------------------------------------------------------

const resend = new Resend(process.env.RESEND_API_KEY);

async function sendLicenseEmail(to, key, expires) {
  try {
    const expiresDate = new Date(expires).toUTCString();

    await resend.emails.send({
      from: "TheMob Store <noreply@resend.dev>",
      to,
      subject: "Your TheMob License Key",
      html: `
        <h2>Your License Key</h2>
        <p>Thank you for purchasing <b>The Mob</b>!</p>
        <p>Your personal license key:</p>
        <pre style="font-size:14px;background:#111;color:#0f0;padding:10px;border-radius:6px;white-space:pre-wrap;word-wrap:break-word;">
${key}
        </pre>
        <p><b>Expires:</b> ${expiresDate}</p>
        <p>Please keep this key safe and do not share it.</p>
      `
    });

    console.log("📧 Email sent to:", to);

  } catch (err) {
    console.error("❌ Email sending failed:", err);
  }
}

// ----------------------------------------------------------
//  MYSQL SAVE LICENSE
// ----------------------------------------------------------

async function saveLicense(key, player, email, expires) {
  try {
    await db.execute(
      "INSERT INTO licenses (license_key, player, email, expires, created) VALUES (?, ?, ?, ?, ?)",
      [key, player, email, expires, Date.now()]
    );

    console.log("💾 Lizenz gespeichert (MySQL):", key);

  } catch (err) {
    console.error("❌ FEHLER beim Speichern in MySQL:", err);
  }
}

// ----------------------------------------------------------
//  MYSQL GET LICENSE
// ----------------------------------------------------------

async function getLicense(key) {
  try {
    const [rows] = await db.execute(
      "SELECT * FROM licenses WHERE license_key = ? LIMIT 1",
      [key]
    );

    return rows.length > 0 ? rows[0] : null;

  } catch (err) {
    console.error("❌ FEHLER beim Lesen aus MySQL:", err);
    return null;
  }
}

// ----------------------------------------------------------
//  ROOT
// ----------------------------------------------------------

app.get("/", (req, res) => {
  res.send("TheMob License Server is running (MySQL + Signed Keys).");
});

// ----------------------------------------------------------
//  TEBEX WEBHOOK HANDLER
// ----------------------------------------------------------

const TARGET_PACKAGE_ID = 7156613; // dein Tebex-Paket

app.post("/tebex", async (req, res) => {
  console.log("📬 Tebex Webhook:", JSON.stringify(req.body, null, 2));

  const body = req.body || {};
  const id = body.id || null;
  const type = body.type || "unknown";

  // VALIDATION
  if (type === "validation.webhook") {
    return res.json({ id });
  }

  // PAYMENT COMPLETED
  if (type === "payment.completed") {

    const product = body.subject?.products?.[0] || {};
    const customer = body.subject?.customer || {};

    if (product.id !== TARGET_PACKAGE_ID) {
      console.log("⚠ Fremdes Paket – kein Key.");
      return res.json({ id, ignored: true });
    }

    const player = customer?.username?.username || "unknown";
    const email = customer?.email || null;

    // ======================================================
    //  SIGNIERTER LIZENZ-SCHLÜSSEL (JWT)
    // ======================================================
    // Payload: Spieler, Produkt, Random ID
    const payload = {
      player,
      product: product.id,
      jti: crypto.randomUUID()
    };

    // JWT mit Ablauf von 30 Tagen
    const token = jwt.sign(payload, LICENSE_SECRET, {
      algorithm: "HS256",
      expiresIn: "30d"
    });

    // exp aus Token lesen (Sekunden → Millisekunden)
    const decoded = jwt.decode(token);
    const expires = decoded && decoded.exp
      ? decoded.exp * 1000
      : Date.now() + 30 * 24 * 60 * 60 * 1000;

    console.log("💎 Lizenz erstellt (JWT):", token);

    // Save to MySQL
    await saveLicense(token, player, email, expires);

    // Antwort an Tebex
    res.json({
      id,
      success: true,
      license: token,
      player,
      expires
    });

    // Email mit Key
    if (email) {
      sendLicenseEmail(email, token, expires)
        .then(() => console.log("📧 Email sent async"))
        .catch(err => console.error("❌ Async Email Error:", err));
    }

    return;
  }

  res.json({ id, received: true });
});

// ----------------------------------------------------------
//  VALIDATE ENDPOINT (for Minecraft plugin)
// ----------------------------------------------------------
//
//  GET /validate?key=XYZ
//  Antwort:
//    { valid: true/false, player?: "...", expires?: 123456789 }
// ----------------------------------------------------------

app.get("/validate", async (req, res) => {
  const key = req.query.key;

  if (!key) {
    return res.json({ valid: false });
  }

  // 1) JWT Signatur + Ablauf prüfen
  let decoded;
  try {
    decoded = jwt.verify(key, LICENSE_SECRET); // wirft Error bei ungültig / abgelaufen
  } catch (err) {
    console.warn("❌ Ungültiger oder abgelaufener Token:", err.message);
    return res.json({ valid: false });
  }

  // 2) MySQL-Eintrag prüfen (Revokes möglich)
  const lic = await getLicense(key);
  if (!lic) {
    console.warn("❌ Lizenz nicht in DB gefunden:", key);
    return res.json({ valid: false });
  }

  // 3) (Optional) Ablauf mit DB gegenprüfen
  if (Date.now() > lic.expires) {
    console.warn("⌛ Lizenz in DB abgelaufen:", key);
    return res.json({ valid: false });
  }

  // Alles okay → Lizenz gültig
  return res.json({
    valid: true,
    player: lic.player,
    expires: lic.expires
  });
});

// ----------------------------------------------------------
//  START SERVER
// ----------------------------------------------------------

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("🚀 License server running on port", PORT);
});
