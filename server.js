const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");

const app = express();
app.use(bodyParser.json());
app.use(cors());

// In-Memory Lizenzspeicher (für Render perfekt)
let licenses = {};

// Health Check für Render
app.get("/", (req, res) => {
    res.send("TheMob License Server is running.");
});

// ======================================================
// 1) Lizenz erzeugen (vom Webhook aufgerufen)
// ======================================================
app.post("/create-license", (req, res) => {
    const { key, duration } = req.body;

    if (!key || !duration)
        return res.status(400).json({ error: "Missing key or duration" });

    const expires = Date.now() + duration * 24 * 60 * 60 * 1000;

    licenses[key] = { expires };

    console.log("Generated License:", key, "expires:", new Date(expires));
    res.json({ success: true });
});

// ======================================================
// 2) Lizenz prüfen (vom Plugin aufgerufen)
// ======================================================
app.post("/validate", (req, res) => {
    const { key } = req.body;

    if (!key)
        return res.status(400).json({ valid: false });

    const lic = licenses[key];
    if (!lic)
        return res.json({ valid: false });

    // Abgelaufen?
    if (Date.now() > lic.expires)
        return res.json({ valid: false });

    return res.json({ valid: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log("License server running on port", PORT);
});
