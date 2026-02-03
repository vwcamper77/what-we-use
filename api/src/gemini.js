const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// For MVP, use a fast vision model.
// If you get a model not found error, change this to another available "flash" model.
const DEFAULT_MODEL = process.env.GEMINI_MODEL || "gemini-1.5-flash";

function assertEnv() {
  if (!GEMINI_API_KEY) {
    throw new Error("Missing GEMINI_API_KEY environment variable");
  }
}

function safeJsonParse(text) {
  // Gemini sometimes wraps JSON in code fences. Strip them.
  const cleaned = text
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    // Attempt to extract the first JSON object in the text
    const firstBrace = cleaned.indexOf("{");
    const lastBrace = cleaned.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      const slice = cleaned.slice(firstBrace, lastBrace + 1);
      return JSON.parse(slice);
    }
    throw new Error("Gemini response was not valid JSON");
  }
}

export async function analyzeWithGemini({ imageBase64, mimeType }) {
  assertEnv();

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${DEFAULT_MODEL}:generateContent?key=${encodeURIComponent(
    GEMINI_API_KEY
  )}`;

  const schemaHint = {
    products: [
      {
        name_guess: "string",
        brand_guess: "string|null",
        category_guess: "cleaner|laundry|dish|other",
        ingredients_raw: "string|null",
        ingredients_list: ["string"],
        warnings: ["string"],
        confidence: 0.0
      }
    ],
    notes_for_user_confirmation: ["string"]
  };

  const systemText =
    "You extract structured label data from household cleaning product photos. " +
    "Do not give medical advice. Do not claim health outcomes. " +
    "Return only valid JSON, no markdown, matching the schema. " +
    "If text is unclear, return low confidence and add a note asking user to retake photo.";

  const userText =
    "From this image, identify up to 5 cleaning products visible. " +
    "For each, extract the product name (best guess), brand (if visible), " +
    "category guess (cleaner, laundry, dish, other), ingredient list text, " +
    "warnings and safety statements (like 'Danger', 'Corrosive', 'Do not mix'), " +
    "and a confidence from 0.0 to 1.0. " +
    "Normalize ingredients_list to lowercase tokens where possible. " +
    `Schema: ${JSON.stringify(schemaHint)}`;

  const body = {
    systemInstruction: { parts: [{ text: systemText }] },
    contents: [
      {
        role: "user",
        parts: [
          { text: userText },
          { inlineData: { mimeType, data: imageBase64 } }
        ]
      }
    ],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 1200
    }
  };

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Gemini API error: ${resp.status} ${resp.statusText} :: ${errText}`);
  }

  const data = await resp.json();
  const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).filter(Boolean).join("\n") || "";

  const parsed = safeJsonParse(text);

  // Basic hardening
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Gemini returned empty output");
  }
  if (!Array.isArray(parsed.products)) parsed.products = [];

  // Ensure arrays exist
  parsed.products = parsed.products.map((p) => ({
    name_guess: p?.name_guess ?? "",
    brand_guess: p?.brand_guess ?? null,
    category_guess: p?.category_guess ?? "other",
    ingredients_raw: p?.ingredients_raw ?? null,
    ingredients_list: Array.isArray(p?.ingredients_list) ? p.ingredients_list : [],
    warnings: Array.isArray(p?.warnings) ? p.warnings : [],
    confidence: typeof p?.confidence === "number" ? p.confidence : 0.0
  }));

  parsed.notes_for_user_confirmation = Array.isArray(parsed.notes_for_user_confirmation)
    ? parsed.notes_for_user_confirmation
    : [];

  return parsed;
}