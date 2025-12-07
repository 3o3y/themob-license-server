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
// 1) TEBEX VALIDATION ENDPOINT (MUST RETURN 200)
// Tebex calls *GET* first, before accepting the webhook!
// ======================================================
app.get("/tebex", (req, res) => {
    console.log("✔ GET Tebex Validation Ping");
    res.status(200).json({ status: "ok" });
});

// Backup for Tebex POST validation (some stores use POST)
app.post("/tebex", (req, res) => {
    console.log("✔ POST Tebex Validation Ping");
    res.status(200).json({ status: "ok" });
});


// ======================================================
// 2) PAYMENT WEBHOOK (transaction.completed)
// ======================================================
app.post("/tebex/webhook", (req, res) => {

    console.log("📬 Tebex Webhook Received:", JSON.stringify(req.body, null, 2));

    if (!req.body || req.body.type !== "transaction.completed") {
        return res.status(400).json({ error: "Not a transaction.completed event" });
    }

    const tx = req.body.data?.transaction;
    if (!tx) {
        return res.status(400).json({ error: "Missing transaction data" });
    }

    const playerName = tx.user?.username || "unknown";

    const durationDays = 30; // Premium duration
    const key = crypto.randomBytes(16).toString("hex");
    const expires = Date.now() + durationDays * 24 * 60 * 60 * 1000;

    licenses[key] = {
        expires,
        player: playerName,
        created: Date.now()
    };

    console.log("✅ Created License:", key);
    console.log("⏳ Expires:", new Date(expires).toISOString());
    console.log("👤 Player:", playerName);

    res.json({
        success: true,
        license: key,
        expires,
        player: playerName
    });
});


// ======================================================
// 3) PLUGIN LICENSE VALIDATION ENDPOINT
// ======================================================
app.get("/validate", (req, res) => {
    const key = req.query.key;

    if (!key) return res.status(400).json({ valid: false });

    const license = licenses[key];
    if (!license) return res.json({ valid: false });

    if (Date.now() > license.expires)
        return res.json({ valid: false });

    return res.json({
        valid: true,
        player: license.player,
        expires: license.expires
    });
});


// ======================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log("🚀 License server running on port", PORT);
});
