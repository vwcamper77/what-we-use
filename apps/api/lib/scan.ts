import {
  Ingredient,
  ScanResult,
  getOverallRisk,
  normalizeRisk,
  slugify
} from "@what-we-use/shared";
import { GeminiScanOutput, analyzeWithGemini } from "./gemini";
import { getIngredientBySlug, isFirestoreConfigured } from "./firestore";

function summarizeFromIngredients(ingredients: Ingredient[]): string {
  if (ingredients.length === 0) {
    return "No recognizable ingredients were found in this scan.";
  }

  const counts = ingredients.reduce(
    (acc, item) => {
      acc[item.risk] = (acc[item.risk] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  return `Detected ${ingredients.length} ingredient(s): ${counts.avoid || 0} avoid, ${
    counts.caution || 0
  } caution, ${counts.safe || 0} safe.`;
}

export async function createScanResult(input: {
  text?: string;
  ingredients?: string[];
  geminiData?: GeminiScanOutput;
  skipAi?: boolean;
}): Promise<ScanResult> {
  const text = String(input.text || "").trim();
  const directIngredients = Array.isArray(input.ingredients)
    ? input.ingredients.map((item) => String(item || "").trim()).filter(Boolean)
    : [];

  let geminiData: GeminiScanOutput =
    input.geminiData || {
      ingredients: [],
      summary: ""
    };
  const shouldCallGemini = !input.geminiData && !input.skipAi;

  if (shouldCallGemini && text) {
    try {
      geminiData = await analyzeWithGemini({ text });
    } catch {
      geminiData = {
        ingredients: text
          .split(/[,;\n]/g)
          .map((item) => item.trim())
          .filter(Boolean)
          .map((name) => ({
            name,
            slug: slugify(name),
            risk: "caution"
          })),
        summary: "Fallback parser used because AI extraction was unavailable."
      };
    }
  } else if (shouldCallGemini && directIngredients.length > 0 && process.env.GEMINI_API_KEY) {
    try {
      geminiData = await analyzeWithGemini({ ingredients: directIngredients });
    } catch {
      geminiData = { ingredients: [], summary: "" };
    }
  }

  const sourceNames =
    geminiData.ingredients.length > 0
      ? geminiData.ingredients.map((item) => item.name)
      : directIngredients;

  const seen = new Set<string>();
  const uniqueNames = sourceNames.filter((name) => {
    const slug = slugify(name);
    if (!slug || seen.has(slug)) return false;
    seen.add(slug);
    return true;
  });

  const aiBySlug = new Map(geminiData.ingredients.map((item) => [item.slug, item]));
  const canUseFirestore = isFirestoreConfigured();

  const ingredients: Ingredient[] = await Promise.all(
    uniqueNames.map(async (name) => {
      const slug = slugify(name);
      const ai = aiBySlug.get(slug);

      if (canUseFirestore) {
        try {
          const fromStore = await getIngredientBySlug(slug);
          if (fromStore) {
            return {
              name: fromStore.name,
              slug: fromStore.slug,
              risk: normalizeRisk(fromStore.risk),
              notes: fromStore.notes || ai?.notes
            };
          }
        } catch {
          // Continue with AI fallback when Firestore read fails.
        }
      }

      return {
        name,
        slug,
        risk: normalizeRisk(ai?.risk || "caution"),
        notes: ai?.notes
      };
    })
  );

  const summary = geminiData.summary || summarizeFromIngredients(ingredients);

  return {
    ingredients,
    overallRisk: getOverallRisk(ingredients),
    summary
  };
}
