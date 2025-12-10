"use strict";

// ======================================================
//  TheMob – License Server (MySQL + RESEND + SIGNED KEYS)
//  10/10 gehärtete Version
// ======================================================

const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const crypto = require("crypto");
const { Resend } = require("resend");
const mysql = require("mysql2/promise");
const jwt = require("jsonwebtoken");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

const app = express();

// Render / Proxy Setup – wichtig für X-Forwarded-For & HTTPS
app.set("trust proxy", 1);

// ----------------------------------------------------------
//  HTTPS ERZWINGEN
// ----------------------------------------------------------

app.use((req, res, next) => {
  const proto = req.headers["x-forwarded-proto"] || req.protocol;
  if (proto !== "https") {
    return res.status(400).json({ error: "https_required" });
  }
  next();
});

// ----------------------------------------------------------
//  BODY-PARSER (mit RAW BODY für Tebex-Signatur)
// ----------------------------------------------------------

app.use(bodyParser.json({
  limit: "1mb",
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));

// ----------------------------------------------------------
//  SECURITY MIDDLEWARE
// ----------------------------------------------------------

app.use(helmet({
  // wir sind eine reine JSON-API, kein HTML
  contentSecurityPolicy: false
}));

// CORS: praktisch deaktiviert, da Server-zu-Server
app.use(cors({ origin: false }));

// Globales Rate-Limit (zusätzlich zum /validate-Limit)
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 Minuten
  max: 300,                 // 300 Requests pro IP / 15min
  standardHeaders: true,
  legacyHeaders: false
});

app.use(globalLimiter);

// ----------------------------------------------------------
//  ENV CHECKS
// ----------------------------------------------------------

function requireEnv(name) {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    console.error(`❌ ENV-Variable ${name} ist NICHT gesetzt!`);
    return false;
  }
  return true;
}

let envOk = true;

envOk &= requireEnv("MYSQL_HOST");
envOk &= requireEnv("MYSQL_USER");
envOk &= requireEnv("MYSQL_PASS");
envOk &= requireEnv("MYSQL_DB");
envOk &= requireEnv("RESEND_API_KEY");
envOk &= requireEnv("LICENSE_SECRET");
envOk &= requireEnv("TEBEX_SECRET");
// Tebex-IP-Whitelist optional, daher kein requireEnv

if (!envOk) {
  console.error("❌ Kritische ENV-Variablen fehlen. Server wird NICHT gestartet.");
  process.exit(1);
}

const LICENSE_SECRET = process.env.LICENSE_SECRET;
const TEBEX_SECRET   = process.env.TEBEX_SECRET;

// Optional: IP-Whitelist für Tebex, z.B.
// TEBEX_IP_WHITELIST="51.89.153.0/24,51.89.152.10,1.2.3."
const TEBEX_IP_WHITELIST = (process.env.TEBEX_IP_WHITELIST || "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

if (TEBEX_IP_WHITELIST.length === 0) {
  console.warn("⚠ TEBEX_IP_WHITELIST ist leer – IP-Whitelisting ist deaktiviert.");
}

// Sanity-Check: LICENSE_SECRET darf nicht mein Default-String sein
if (LICENSE_SECRET === "CHANGE_ME_NOW_IN_PRODUCTION") {
  console.error("❌ LICENSE_SECRET ist noch auf dem Default-Wert. Bitte in der Umgebung setzen!");
  process.exit(1);
}

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
  queueLimit: 0,
  // ssl: { rejectUnauthorized: true } // falls Hoster das verlangt
});

// Testverbindung
db.getConnection()
  .then(conn => {
    console.log("✅ MySQL Pool: Verbindung hergestellt.");
    conn.release();
  })
  .catch(err => {
    console.error("❌ MySQL Pool Fehler:", err.message);
  });

// ----------------------------------------------------------
//  RESEND EMAIL SENDER
// ----------------------------------------------------------

const resend = new Resend(process.env.RESEND_API_KEY);

async function sendLicenseEmail(to, key, expires) {
  if (!to) {
    console.warn("⚠ Kein E-Mail-Empfänger angegeben – skip Mail.");
    return;
  }

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

    console.log("📧 License-E-Mail gesendet an:", maskEmail(to));

  } catch (err) {
    console.error("❌ Email sending failed:", err.message);
  }
}

// ----------------------------------------------------------
//  HILFSFUNKTIONEN (Sicherheit / Logging)
// ----------------------------------------------------------

function maskEmail(email) {
  if (!email) return "";
  const [user, domain] = email.split("@");
  if (!domain) return email;
  const maskUser = user.length <= 2 ? user[0] + "*" : user[0] + "***" + user[user.length - 1];
  return `${maskUser}@${domain}`;
}

function shortKeyHash(key) {
  // Kein Klartext-Key im Log, nur gekürzter Hash
  return crypto
    .createHash("sha256")
    .update(key)
    .digest("hex")
    .slice(0, 16);
}

// Tebex-Signatur prüfen (HMAC-SHA256 über RAW Body)
function verifyTebexSignature(req) {
  const signature = req.header("x-signature");
  if (!signature || typeof signature !== "string") {
    console.warn("❌ Tebex-Signatur fehlt.");
    return false;
  }

  if (!req.rawBody) {
    console.warn("❌ Kein rawBody für Tebex-Signaturprüfung vorhanden.");
    return false;
  }

  const expected = crypto
    .createHmac("sha256", TEBEX_SECRET)
    .update(req.rawBody)
    .digest("hex");

  try {
    const sigBuf = Buffer.from(signature, "hex");
    const expBuf = Buffer.from(expected, "hex");
    if (sigBuf.length !== expBuf.length) return false;
    return crypto.timingSafeEqual(sigBuf, expBuf);
  } catch (err) {
    console.warn("❌ Fehler bei Tebex-Signaturvergleich:", err.message);
    return false;
  }
}

// IP-Ermittlung (für Tebex-Whitelist)
function getClientIp(req) {
  // durch trust proxy liefert req.ip schon den richtigen Client
  return (req.ip || "").replace("::ffff:", "");
}

// ----------------------------------------------------------
//  MYSQL SAVE LICENSE (mit Retry & extra Logging)
// ----------------------------------------------------------

async function saveLicense(key, player, email, expires, attempt = 1) {
  try {
    await db.execute(
      "INSERT INTO licenses (license_key, player, email, expires, created) VALUES (?, ?, ?, ?, ?)",
      [key, player, email || "", expires, Date.now()]
    );

    console.log("💾 Lizenz gespeichert (MySQL):", shortKeyHash(key));

  } catch (err) {
    console.error("❌ FEHLER beim Speichern in MySQL (Versuch " + attempt + "):", {
      message: err.message,
      code: err.code,
      errno: err.errno,
      sqlState: err.sqlState
    });

    // Bei ECONNRESET einmal neu versuchen
    if (err.code === "ECONNRESET" && attempt < 2) {
      console.warn("⚠ ECONNRESET → versuche Save erneut …");
      return saveLicense(key, player, email, expires, attempt + 1);
    }
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
    console.error("❌ FEHLER beim Lesen aus MySQL:", err.message);
    return null;
  }
}

// ----------------------------------------------------------
//  ROOT + HEALTHCHECK
// ----------------------------------------------------------

app.get("/", (req, res) => {
  res.send("TheMob License Server is running (MySQL + Signed Keys + Hardened).");
});

app.get("/health", async (req, res) => {
  try {
    await db.query("SELECT 1");
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false });
  }
});

// ----------------------------------------------------------
//  TEBEX WEBHOOK HANDLER
// ----------------------------------------------------------

const TARGET_PACKAGE_ID = 7156613; // dein Tebex-Paket

app.post("/tebex", async (req, res) => {
  const body = req.body || {};
  const id   = body.id   || null;
  const type = body.type || "unknown";

  // Minimales Logging, ohne persönliche Daten
  console.log("📬 Tebex Webhook:", { id, type });

  // IP-Whitelist: nur Tebex-IPs zulassen, falls gesetzt
  if (TEBEX_IP_WHITELIST.length > 0) {
    const clientIp = getClientIp(req);
    const allowed = TEBEX_IP_WHITELIST.some(entry => {
      // exakte IP oder Prefix
      return clientIp === entry || clientIp.startsWith(entry);
    });

    if (!allowed) {
      console.warn("❌ Tebex-Webhook von nicht erlaubter IP:", clientIp);
      return res.status(403).json({ id, error: "ip_not_allowed" });
    }
  }

  // VALIDATION – laut Tebex muss hier nur { id } zurück
  if (type === "validation.webhook") {
    return res.json({ id });
  }

  // TEST PAYMENT ERKENNEN
  const isTestPayment = body.subject?.payment_method?.name === "Test Payments";

  if (isTestPayment) {
    console.log("⚠ Test Payment erkannt → Signaturprüfung übersprungen.");
  } else {
    // Ab hier: echte Zahlung, also Signatur Pflicht
    if (!verifyTebexSignature(req)) {
      console.warn("❌ Ungültige Tebex-Signatur – Request blockiert.");
      return res.status(401).json({ id, error: "invalid_signature" });
    }
  }

  // PAYMENT COMPLETED
  if (type === "payment.completed") {
    try {
      const product  = body.subject?.products?.[0] || {};
      const customer = body.subject?.customer       || {};

      if (!product.id) {
        console.warn("⚠ Kein Produkt in Tebex-Payload gefunden.");
        return res.json({ id, ignored: true });
      }

      if (product.id !== TARGET_PACKAGE_ID) {
        console.log("⚠ Fremdes Paket – kein Key. product.id:", product.id);
        return res.json({ id, ignored: true });
      }

      const player = customer?.username?.username || "unknown";
      const email  = customer?.email || null;

      // ======================================================
      //  SIGNIERTER LIZENZ-SCHLÜSSEL (JWT)
      // ======================================================
      const payload = {
        player,
        product: product.id,
        jti: crypto.randomUUID()
      };

      // JWT mit Ablauf von 30 Tagen
      const token = jwt.sign(payload, LICENSE_SECRET, {
        algorithm: "HS256",
        expiresIn: "60s"
      });

      // exp aus Token lesen (Sekunden → Millisekunden)
      const decoded = jwt.decode(token);
      const expires = decoded && decoded.exp
        ? decoded.exp * 1000
        : Date.now() + 30 * 24 * 60 * 60 * 1000;

      console.log("💎 Lizenz erstellt (JWT):", shortKeyHash(token));

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

      // Email mit Key (async, Fehler werden geloggt)
      if (email) {
        sendLicenseEmail(email, token, expires)
          .then(() => console.log("📧 Email async versendet an:", maskEmail(email)))
          .catch(err => console.error("❌ Async Email Error:", err.message));
      }

      return;

    } catch (err) {
      console.error("❌ Fehler im Tebex payment.completed Handler:", err.message);
      return res.status(500).json({ id, error: "internal_error" });
    }
  }

  // Andere Webhook-Typen
  res.json({ id, received: true });
});

// ----------------------------------------------------------
//  RATE LIMIT FÜR VALIDATE (Minecraft Plugin Endpoint)
// ----------------------------------------------------------

const validateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 Minute
  max: 60,             // 60 Checks / Min / IP
  standardHeaders: true,
  legacyHeaders: false
});

// ----------------------------------------------------------
//  VALIDATE ENDPOINT (for Minecraft plugin)
// ----------------------------------------------------------
//
//  GET /validate?key=XYZ
//  Antwort:
//    { valid: true/false, player?: "...", expires?: 123456789 }
// ----------------------------------------------------------

app.get("/validate", validateLimiter, async (req, res) => {
  const key = req.query.key;

  if (!key || typeof key !== "string" || key.length < 20) {
    return res.json({ valid: false });
  }

  // 1) JWT Signatur + Ablauf prüfen
  try {
    jwt.verify(key, LICENSE_SECRET); // wirft Error bei ungültig / abgelaufen
  } catch (err) {
    console.warn("❌ Ungültiger oder abgelaufener Token:", err.message, "Hash:", shortKeyHash(key));
    return res.json({ valid: false });
  }

  // 2) MySQL-Eintrag prüfen (Revokes möglich)
  const lic = await getLicense(key);
  if (!lic) {
    console.warn("❌ Lizenz nicht in DB gefunden. Hash:", shortKeyHash(key));
    return res.json({ valid: false });
  }

  // 3) Ablauf mit DB gegenprüfen
  if (Date.now() > Number(lic.expires || 0)) {
    console.warn("⌛ Lizenz in DB abgelaufen. Hash:", shortKeyHash(key));
    return res.json({ valid: false });
  }

  // Alles okay → Lizenz gültig
  return res.json({
    valid: true,
    player: lic.player,
    expires: Number(lic.expires)
  });
});

// ----------------------------------------------------------
//  GLOBALER ERROR-HANDLER (fängt unerwartete Fehler ab)
// ----------------------------------------------------------

app.use((err, req, res, next) => {
  console.error("❌ Unhandled Error:", err.message);
  res.status(500).json({ error: "internal_error" });
});

// ----------------------------------------------------------
//  START SERVER
// ----------------------------------------------------------

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("🚀 License server running on port", PORT);
});
