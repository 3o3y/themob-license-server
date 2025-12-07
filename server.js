const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const crypto = require("crypto");

const app = express();
app.use(bodyParser.json());
app.use(cors());

// Temporary storage – good enough for Render Free Tier
let licenses = {};

// ======================================================
// ROOT ENDPOINT (For debugging on Render)
// ======================================================
app.get("/", (req, res) => {
    res.send("TheMob License Server is running ✔");
});


// ======================================================
// 1) TEBEX VALIDATION ENDPOINT (MUST EXIST!)
// Tebex calls this BEFORE accepting any webhook.
// If this endpoint does not return 200 → Webhook FAILS
// ======================================================
app.post("/tebex", (req, res) => {
    console.log("✔ Tebex Validation Webhook Ping Received");
    res.status(200).json({ ok: true });
});


// ======================================================
// 2) TEBEX PAYMENT WEBHOOK (transaction.completed)
// This is triggered when the purchase succeeds
// ======================================================
app.post("/tebex/webhook", (req, res) => {

    console.log("📬 Tebex Webhook Received:", JSON.stringify(req.body, null, 2));

    // Tebex Checkout sends: type = "transaction.completed"
    if (!req.body || req.body.type !== "transaction.completed") {
        return res.status(400).json({ error: "Not a transaction.completed event" });
    }

    const tx = req.body.data?.transaction;
    if (!tx) {
        return res.status(400).json({ error: "Missing transaction data" });
    }

    const playerName = tx.user?.username || "unknown";

    // Default duration: 30 days
    const durationDays = 30;

    // Generate license key
    const key = crypto.randomBytes(16).toString("hex");
    const expires = Date.now() + durationDays * 24 * 60 * 60 * 1000;

    licenses[key] = {
        expires,
        player: playerName,
        created: Date.now()
    };

    console.log("✅ Created Premium License:", key);
    console.log("⏳ Expires:", new Date(expires).toISOString());
    console.log("👤 Player:", playerName);

    // Send response back to Tebex
    res.json({
        success: true,
        license: key,
        expires,
        player: playerName
    });
});


// ======================================================
// 3) PLUGIN LICENSE VALIDATION ENDPOINT
// Java plugin: GET /validate?key=XXXX
// ======================================================
app.get("/validate", (req, res) => {
    const key = req.query.key;

    if (!key) return res.status(400).json({ valid: false });

    const license = licenses[key];
    if (!license) return res.json({ valid: false });

    // Expired?
    if (Date.now() > license.expires) {
        return res.json({ valid: false });
    }

    // License valid
    return res.json({
        valid: true,
        player: license.player,
        expires: license.expires
    });
});


// ======================================================
// START SERVER
// ======================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log("🚀 License server running on port", PORT);
});
