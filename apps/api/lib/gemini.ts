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

export interface GeminiChatOutput {
  answer: string;
  sourceTitles?: string[];
}

const DEFAULT_MODEL = process.env.GEMINI_MODEL || "gemini-2.0-flash";
const DEFAULT_VISION_MODEL = process.env.GEMINI_VISION_MODEL || DEFAULT_MODEL;

const RETRYABLE_STATUS = new Set([429]);
const MAX_RETRIES = 2;

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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getRetryDelayMs(attempt: number, retryAfter: string | null): number {
  const parsed = retryAfter ? Number(retryAfter) : Number.NaN;
  if (!Number.isNaN(parsed) && parsed > 0) {
    return parsed * 1000;
  }
  const base = 600;
  const jitter = Math.floor(Math.random() * 250);
  return base * 2 ** attempt + jitter;
}

async function fetchWithRetry(url: string, options: RequestInit): Promise<Response> {
  let attempt = 0;
  while (true) {
    const response = await fetch(url, options);
    if (!RETRYABLE_STATUS.has(response.status) || attempt >= MAX_RETRIES) {
      return response;
    }
    const delayMs = getRetryDelayMs(attempt, response.headers.get("retry-after"));
    await sleep(delayMs);
    attempt += 1;
  }
}

function toFriendlyGeminiError(status: number, details: string): string {
  const upper = details.toUpperCase();
  if (status === 429 || upper.includes("RESOURCE_EXHAUSTED")) {
    return "The analysis service is busy right now. Please try again in a moment.";
  }
  if (status >= 500) {
    return "The analysis service is temporarily unavailable. Please try again in a moment.";
  }
  return `Gemini API error ${status}: ${details}`;
}

async function callGeminiJson<T>(
  prompt: string,
  options?: { temperature?: number; maxOutputTokens?: number }
): Promise<T> {
  const apiKey = getGeminiApiKey();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${DEFAULT_MODEL}:generateContent`;

  const response = await fetchWithRetry(url, {
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
        temperature: options?.temperature ?? 0.1,
        maxOutputTokens: options?.maxOutputTokens ?? 1200
      }
    })
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(toFriendlyGeminiError(response.status, details));
  }

  const payload = await response.json();
  const text =
    payload?.candidates?.[0]?.content?.parts
      ?.map((part: { text?: string }) => part?.text)
      .filter(Boolean)
      .join("\n") || "";

  return safeJsonParse<T>(text);
}

async function callGeminiWithImages<T>(input: {
  prompt: string;
  images: Array<{ data: string; mimeType: string }>;
  maxOutputTokens?: number;
}): Promise<T> {
  const apiKey = getGeminiApiKey();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${DEFAULT_VISION_MODEL}:generateContent`;

  const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [
    { text: input.prompt }
  ];
  for (const image of input.images) {
    parts.push({
      inlineData: {
        mimeType: image.mimeType || "image/jpeg",
        data: image.data
      }
    });
  }

  const response = await fetchWithRetry(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-goog-api-key": apiKey
    },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts
        }
      ],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: input.maxOutputTokens ?? 1200
      }
    })
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(toFriendlyGeminiError(response.status, details));
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
        .map((item): GeminiIngredient | null => {
          const name = String(item?.name || "").trim();
          if (!name) return null;
          const notes = String(item?.notes || "").trim();
          return {
            name,
            slug: slugify(name),
            risk: normalizeRisk(item?.risk),
            ...(notes ? { notes } : {})
          };
        })
        .filter((item): item is GeminiIngredient => item !== null)
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

export async function analyzeImagesForScan(
  images: Array<{ data: string; mimeType: string; label?: string }>
): Promise<GeminiScanOutput> {
  const prompt =
    "You extract ingredient lists from product label photos for a household cleaner app. " +
    "Return only valid JSON with this schema: " +
    '{"ingredients":[{"name":"string","risk":"safe|caution|avoid","notes":"string"}],"summary":"string"}. ' +
    "Only include ingredients visible on the label. " +
    "Keep notes short. If none visible, return an empty ingredient list and a brief summary.";

  const output = await callGeminiWithImages<unknown>({
    prompt,
    images: images.map((image) => ({
      data: image.data,
      mimeType: image.mimeType || "image/jpeg"
    })),
    maxOutputTokens: 600
  });

  return normalizeGeminiOutput(output);
}

export async function answerQuestionWithContext(input: {
  question: string;
  context: string;
  sourceTitles: string[];
}): Promise<GeminiChatOutput> {
  const prompt =
    "You answer questions about household cleaner ingredients. " +
    "Use only the provided context. " +
    "If the answer is not supported by the context, say you don't have proof and suggest checking sources. " +
    "Return only valid JSON with this schema: " +
    '{"answer":"string","sourceTitles":["string"]}. ' +
    "Only include sourceTitles from the provided Sources list. " +
    "Keep the answer short and practical. " +
    `Context:\n${input.context}\n\nSources:\n${input.sourceTitles
      .map((title) => `- ${title}`)
      .join("\n")}\n\nQuestion: ${input.question}`;

  const output = await callGeminiJson<unknown>(prompt, {
    temperature: 0.2,
    maxOutputTokens: 600
  });

  const record = (output || {}) as { answer?: unknown; sourceTitles?: unknown };
  const answer = String(record.answer || "").trim();
  const sourceTitles = Array.isArray(record.sourceTitles)
    ? record.sourceTitles.map((item) => String(item || "").trim()).filter(Boolean)
    : [];

  return { answer, sourceTitles };
}
