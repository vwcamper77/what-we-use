export type IngredientRisk = "safe" | "caution" | "avoid";

export interface Ingredient {
  name: string;
  slug: string;
  risk: IngredientRisk;
  notes?: string;
}

export interface ScanResult {
  ingredients: Ingredient[];
  overallRisk: IngredientRisk;
  summary: string;
}

export const RISK_LABELS: Record<IngredientRisk, string> = {
  safe: "Safe",
  caution: "Caution",
  avoid: "Avoid"
};

const RISK_ORDER: Record<IngredientRisk, number> = {
  safe: 1,
  caution: 2,
  avoid: 3
};

export function slugify(value: string): string {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function normalizeRisk(value: string | null | undefined): IngredientRisk {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();

  if (["avoid", "high", "severe", "very high"].includes(normalized)) return "avoid";
  if (["caution", "moderate", "medium", "unknown"].includes(normalized)) return "caution";
  return "safe";
}

export function getOverallRisk(ingredients: Array<Pick<Ingredient, "risk">>): IngredientRisk {
  let top: IngredientRisk = "safe";

  for (const item of ingredients) {
    const risk = normalizeRisk(item?.risk);
    if (RISK_ORDER[risk] > RISK_ORDER[top]) {
      top = risk;
    }
  }

  return top;
}
