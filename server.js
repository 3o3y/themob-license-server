// ======================================================
//  TheMob – License Server (MySQL + RESEND Version)
// ======================================================

const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const crypto = require("crypto");
const { Resend } = require("resend");
const mysql = require("mysql2/promise");

const app = express();

// Tebex benötigt RAW JSON
app.use(bodyParser.json({
  verify: (req, res, buf) => req.rawBody = buf
}));
app.use(cors());

// ----------------------------------------------------------
//  MYSQL CONNECTION (with Auto-Reconnect)
// ----------------------------------------------------------

let db;

async function connectDB() {
  try {
    const connection = await mysql.createConnection({
      host: process.env.db2.sql.g-portal.com,      	// z. B. db2.sql.g-portal.com
      user: process.env.db_17972439_1,      		// z. B. db_17972439_1
      password: process.env.slosRq53,  			// z. B. slosRq53
      database: process.env.db_17972439_1,    		// z. B. db_17972439_1
      port: 3306
    });

    console.log("✅ MySQL: Verbindung hergestellt.");
    return connection;

  } catch (err) {
    console.error("❌ MySQL Verbindung fehlgeschlagen:", err);
    setTimeout(connectDB, 2000); // retry
  }
}

(async () => {
  db = await connectDB();

  if (db) {
    db.on("error", async (err) => {
      console.error("❌ MySQL Fehler:", err);

      if (err.code === "PROTOCOL_CONNECTION_LOST") {
        console.log("🔄 MySQL wird neu verbunden...");
        db = await connectDB();
      }
    });
  }
})();
// ----------------------------------------------------------
//  RESEND EMAIL SENDER
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
  res.send("TheMob License Server is running (MySQL mode).");
});

// ----------------------------------------------------------
//  TEBEX WEBHOOK HANDLER
// ----------------------------------------------------------

const TARGET_PACKAGE_ID = 7156613;

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

    const key = crypto.randomBytes(16).toString("hex");
    const expires = Date.now() + 30 * 24 * 60 * 60 * 1000;

    console.log("💎 Lizenz erstellt:", key);

    // Save to MySQL
    await saveLicense(key, player, email, expires);

    // Answer Tebex
    res.json({
      id,
      success: true,
      license: key,
      player,
      expires
    });

    // Send email
    if (email) {
      sendLicenseEmail(email, key)
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

app.get("/validate", async (req, res) => {
  const key = req.query.key;

  if (!key) return res.json({ valid: false });

  const lic = await getLicense(key);
  if (!lic) return res.json({ valid: false });

  if (Date.now() > lic.expires) return res.json({ valid: false });

  res.json({
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
