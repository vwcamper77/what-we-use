import express from "express";
import cors from "cors";
import multer from "multer";
import { analyzeWithGemini } from "./gemini.js";
import { scoreCleaningProduct } from "./rules.js";
import { getSwapSuggestions } from "./swaps.js";
import { initFirestore, saveScan } from "./store.js";

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

app.use(cors({ origin: process.env.ALLOWED_ORIGIN || "*" }));
app.use(express.json({ limit: "2mb" }));

app.get("/health", (req, res) => {
  res.json({ ok: true, service: "home-detox-api", time: new Date().toISOString() });
});

/**
 * POST /analyze
 * multipart/form-data
 * - image: file (jpg/png)
 * - uid: optional string (for Firestore)
 * - room: optional string (default: cleaning_cupboard)
 * - preferences: optional JSON string (e.g. {"fragranceFree":true})
 */
app.post("/analyze", upload.single("image"), async (req, res) => {
  try {
    if (!req.file?.buffer) {
      return res.status(400).json({ error: "Missing image file. Attach as form field: image" });
    }

    const uid = (req.body.uid || "").trim() || null;
    const room = (req.body.room || "cleaning_cupboard").trim();

    let preferences = {};
    if (req.body.preferences) {
      try {
        preferences = JSON.parse(req.body.preferences);
      } catch {
        return res.status(400).json({ error: "preferences must be valid JSON string" });
      }
    }

    const mimeType = req.file.mimetype || "image/jpeg";
    const imageBase64 = req.file.buffer.toString("base64");

    const extracted = await analyzeWithGemini({ imageBase64, mimeType });

    // We keep the MVP simple: analyze first detected item.
    // If Gemini returns multiple products, you can show a confirm list in the app later.
    const products = Array.isArray(extracted.products) ? extracted.products : [];
    if (products.length === 0) {
      return res.status(200).json({
        ok: true,
        room,
        message: "No products detected with confidence. Try closer photo of one label.",
        extracted
      });
    }

    const enriched = products.slice(0, 5).map((p) => {
      const scored = scoreCleaningProduct(p, preferences);
      const swaps = getSwapSuggestions(scored, preferences);

      return {
        ...p,
        flags: scored.flags,
        handlingTips: scored.handlingTips,
        overall: scored.overall,
        swapSuggestions: swaps
      };
    });

    // Optional Firestore write
    let scanId = null;
    if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
      const db = initFirestore();
      const saved = await saveScan(db, {
        uid,
        room,
        preferences,
        extracted,
        results: enriched
      });
      scanId = saved.scanId;
    }

    return res.json({
      ok: true,
      room,
      scanId,
      results: enriched
    });
  } catch (err) {
    console.error("ANALYZE_ERROR:", err);
    return res.status(500).json({
      error: "Server error",
      details: err?.message || String(err)
    });
  }
});

const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
  console.log(`API listening on port ${port}`);
});