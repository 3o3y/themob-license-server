const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const crypto = require("crypto");

const app = express();
app.use(bodyParser.json());
app.use(cors());

let licenses = {}; // Memory-Storage

// ======================================================
// Root Endpoint
// ======================================================
app.get("/", (req, res) => {
    res.send("TheMob License Server running with Tebex Checkout Webhooks.");
});

// ======================================================
// Tebex Webhook Endpoint
// ======================================================
app.post("/tebex/webhook", (req, res) => {

    console.log("📬 Tebex Webhook Received:", req.body);

    if (!req.body || req.body.type !== "transaction.completed") {
        return res.status(400).json({ error: "Not a transaction.completed event" });
    }

    const tx = req.body.data?.transaction;
    if (!tx) return res.status(400).json({ error: "Missing transaction data" });

    const playerName = tx.user?.username || "unknown";

    // Dauer: 30 Tage Premium
    const durationDays = 30;

    const key = crypto.randomBytes(16).toString("hex");
    const expires = Date.now() + durationDays * 24 * 60 * 60 * 1000;

    licenses[key] = {
        expires,
        player: playerName,
        created: Date.now()
    };

    console.log("✅ Premium License Created:", key, "expires:", new Date(expires));

    // Antwort an Tebex
    res.json({
        success: true,
        license: key,
        player: playerName,
        expires
    });
});

// ======================================================
// Validate License (Plugin calls this)
// ======================================================
app.get("/validate", (req, res) => {
    const key = req.query.key;
    if (!key) return res.status(400).json({ valid: false });

    const lic = licenses[key];
    if (!lic) return res.json({ valid: false });

    if (Date.now() > lic.expires)
        return res.json({ valid: false });

    return res.json({
        valid: true,
        player: lic.player,
        expires: lic.expires
    });
});

// ======================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log("License server running on port", PORT);
});
