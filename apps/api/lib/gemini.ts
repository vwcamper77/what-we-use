import { normalizeRisk, slugify } from "@what-we-use/shared";

export interface GeminiIngredient {
  name: string;
  slug: string;
  risk: "safe" | "caution" | "avoid";
  notes?: string;
}

export interface GeminiScanOutput {
  ingredients: GeminiIngredient[];
  summary: string;
}

const DEFAULT_MODEL = process.env.GEMINI_MODEL || "gemini-2.0-flash";

function getGeminiApiKey(): string {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    throw new Error("Missing GEMINI_API_KEY.");
  }
  return key;
}

function safeJsonParse<T>(text: string): T {
  const cleaned = String(text || "")
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();

  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const firstBrace = cleaned.indexOf("{");
    const lastBrace = cleaned.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1)) as T;
    }
    throw new Error("Gemini returned invalid JSON.");
  }
}

async function callGeminiJson<T>(prompt: string): Promise<T> {
  const apiKey = getGeminiApiKey();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${DEFAULT_MODEL}:generateContent`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-goog-api-key": apiKey
    },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [{ text: prompt }]
        }
      ],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 1200
      }
    })
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Gemini API error ${response.status}: ${details}`);
  }

  const payload = await response.json();
  const text =
    payload?.candidates?.[0]?.content?.parts
      ?.map((part: { text?: string }) => part?.text)
      .filter(Boolean)
      .join("\n") || "";

  return safeJsonParse<T>(text);
}

function normalizeGeminiOutput(value: unknown): GeminiScanOutput {
  const record = (value || {}) as {
    ingredients?: Array<{ name?: string; risk?: string; notes?: string }>;
    summary?: string;
  };

  const ingredients = Array.isArray(record.ingredients)
    ? record.ingredients
        .map((item) => {
          const name = String(item?.name || "").trim();
          if (!name) return null;
          return {
            name,
            slug: slugify(name),
            risk: normalizeRisk(item?.risk),
            notes: String(item?.notes || "").trim() || undefined
          };
        })
        .filter((item): item is GeminiIngredient => Boolean(item))
    : [];

  return {
    ingredients,
    summary: String(record.summary || "").trim()
  };
}

export async function analyzeWithGemini(input: {
  text?: string;
  ingredients?: string[];
}): Promise<GeminiScanOutput> {
  const text = String(input.text || "").trim();
  const ingredientList = Array.isArray(input.ingredients)
    ? input.ingredients.map((item) => String(item || "").trim()).filter(Boolean)
    : [];

  const prompt =
    "You analyze household cleaner ingredients for app users. " +
    "Return only valid JSON with this schema: " +
    '{"ingredients":[{"name":"string","risk":"safe|caution|avoid","notes":"string"}],"summary":"string"}. ' +
    "Keep notes short and practical. " +
    "Never provide medical diagnosis. " +
    (text
      ? `Input text to parse: ${text}`
      : `Ingredient list to classify: ${JSON.stringify(ingredientList)}`);

  const output = await callGeminiJson<unknown>(prompt);
  return normalizeGeminiOutput(output);
}
