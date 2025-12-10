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

const { Resend } = require("resend");
const resend = new Resend(process.env.RESEND_API_KEY);

async function sendLicenseEmail(to, key, expires) {
  try {
    const expiresDate = new Date(expires).toUTCString();

    await resend.emails.send({
      from: "TheMob Store <noreply@resend.dev>",
      to,
      subject: "Your TheMob License Key",
      html: `
  <div style="font-family:Arial,Helvetica,sans-serif;background:#0d0d0d;padding:25px;color:#e6e6e6;">
    
    <div style="max-width:560px;margin:auto;background:#1a1a1a;border-radius:14px;padding:25px;
                box-shadow:0 0 20px rgba(0,0,0,0.35);border:1px solid #262626;">
      
      <!-- LOGO -->
      <div style="text-align:center;margin-bottom:25px;">
        <img src="https://dunb17ur4ymx4.cloudfront.net/packages/images/69849ebfdf339bc7ec4a317bdb34c87ac3a54a05.png" alt="TheMob Logo" 
             style="width:160px;height:auto;margin-bottom:10px;" />
      </div>

      <h2 style="color:#f1c40f;text-align:center;margin-top:0;font-size:26px;">
        Your TheMob License Key
      </h2>

      <p style="font-size:15px;color:#dcdcdc;">
        Thank you for purchasing <b style="color:#fff;">The Mob</b>!  
        Below you will find your personal license key.  
        <br><br>
        Please keep it safe and do not share it with anyone.
      </p>

      <div style="
        background:#111;
        padding:14px;
        margin:18px 0;
        border-radius:8px;
        font-size:14px;
        color:#0f0;
        border:1px solid #333;
        white-space:pre-wrap;
        word-wrap:break-word;
        font-family:Consolas,monospace;
      ">
${key}
      </div>

      <p style="font-size:15px;color:#bfbfbf;margin-bottom:6px;">
        <b>Expires:</b> ${expiresDate}
      </p>

      <hr style="border:0;border-top:1px solid #333;margin:25px 0;">

      <p style="font-size:13px;color:#777;text-align:center;line-height:1.5;">
        This key can only be used on <b>one server installation</b> unless you purchased
        a multi-server license.  
        <br>
        If you need additional activations, contact support anytime.
      </p>

      <p style="font-size:12px;color:#5e5e5e;text-align:center;margin-top:30px;">
        © TheMob — Premium Minecraft Boss & Mob System
      </p>

    </div>
  </div>
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
