const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const crypto = require("crypto");

const app = express();
app.use(bodyParser.json());
app.use(cors());

// In-Memory Licensing (Render FREE TIER friendly)
let licenses = {};

// ======================================================
// Root
// ======================================================
app.get("/", (req, res) => {
    res.send("TheMob License Server is running with Tebex Webhooks.");
});

// ======================================================
// 1) Tebex Webhook → kauft Premium-Lizenz
// ======================================================
app.post("/tebex/webhook", (req, res) => {

    console.log("📬 Tebex Webhook Received:", req.body);

    // Prüfen ob es ein Payment war
    if (!req.body || req.body.type !== "payment.completed") {
        return res.status(400).json({ error: "Invalid event type" });
    }

    const purchase = req.body.data;
    if (!purchase) return res.status(400).json({ error: "Missing data" });

    const playerName = purchase.player ? purchase.player.username : "unknown";
    const durationDays = 30; // Standard: 30 Tage Premium

    // 🔥 License Key generieren
    const key = crypto.randomBytes(16).toString("hex");

    const expires = Date.now() + durationDays * 24 * 60 * 60 * 1000;

    licenses[key] = {
        expires,
        player: playerName,
        created: Date.now()
    };

    console.log("✅ Created Premium License:", key, "expires:", new Date(expires));

    // ➜ Optional: Zeige dem Spieler seinen Key im Tebex-Panel
    res.json({
        success: true,
        license: key,
        expires
    });
});

// ======================================================
// 2) Plugin → Lizenz prüfen
// ======================================================
app.get("/validate", (req, res) => {

    const key = req.query.key;
    if (!key) return res.status(400).json({ valid: false });

    const lic = licenses[key];
    if (!lic) return res.json({ valid: false });

    // Abgelaufen?
    if (Date.now() > lic.expires) {
        return res.json({ valid: false });
    }

    return res.json({
        valid: true,
        expires: lic.expires,
        player: lic.player
    });
});

// ======================================================
// PORT
// ======================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log("License server running on port", PORT);
});
