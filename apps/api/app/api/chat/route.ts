import { NextRequest } from "next/server";

import { corsPreflightResponse, jsonWithCors } from "@/lib/cors";
import { answerQuestionWithContext } from "@/lib/gemini";

type SourceRef = {
  title?: string;
  url?: string;
};

type ScanIngredient = {
  name?: string;
  risk?: string;
  notes?: string;
  regulatoryNotes?: string;
  sources?: SourceRef[];
};

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function OPTIONS(): Promise<Response> {
  return corsPreflightResponse();
}

function normalizeSources(ingredients: ScanIngredient[]): SourceRef[] {
  const seen = new Set<string>();
  const sources: SourceRef[] = [];

  for (const ingredient of ingredients) {
    const list = Array.isArray(ingredient.sources) ? ingredient.sources : [];
    for (const source of list) {
      const title = String(source?.title || "").trim();
      const url = String(source?.url || "").trim();
      const key = `${title.toLowerCase()}|${url.toLowerCase()}`;
      if (!title && !url) continue;
      if (seen.has(key)) continue;
      seen.add(key);
      sources.push({
        ...(title ? { title } : {}),
        ...(url ? { url } : {})
      });
    }
  }

  return sources;
}

function buildContext(input: {
  summary?: string;
  overallRisk?: string;
  ingredients: ScanIngredient[];
}): string {
  const lines: string[] = [];
  if (input.summary) lines.push(`Summary: ${input.summary}`);
  if (input.overallRisk) lines.push(`Overall risk: ${input.overallRisk}`);

  if (input.ingredients.length) {
    lines.push("Ingredients:");
    for (const ingredient of input.ingredients) {
      const name = String(ingredient.name || "").trim();
      if (!name) continue;
      const risk = String(ingredient.risk || "").trim();
      const notes = String(ingredient.notes || "").trim();
      const regulatoryNotes = String(ingredient.regulatoryNotes || "").trim();
      const extras = [
        risk ? `risk: ${risk}` : "",
        notes ? `notes: ${notes}` : "",
        regulatoryNotes ? `regulatory: ${regulatoryNotes}` : ""
      ]
        .filter(Boolean)
        .join("; ");
      lines.push(`- ${name}${extras ? ` (${extras})` : ""}`);
    }
  }

  return lines.join("\n");
}

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const body = (await request.json()) as {
      question?: unknown;
      scan?: {
        summary?: unknown;
        overallRisk?: unknown;
        ingredients?: unknown;
      };
    };

    const question = typeof body?.question === "string" ? body.question.trim() : "";
    if (!question) {
      return jsonWithCors({ error: "Missing question." }, { status: 400 });
    }

    const ingredients = Array.isArray(body?.scan?.ingredients)
      ? (body.scan?.ingredients as ScanIngredient[])
      : [];
    const summary = typeof body?.scan?.summary === "string" ? body.scan?.summary.trim() : "";
    const overallRisk =
      typeof body?.scan?.overallRisk === "string" ? body.scan?.overallRisk.trim() : "";

    const sources = normalizeSources(ingredients);
    const context = buildContext({ summary, overallRisk, ingredients });

    const response = await answerQuestionWithContext({
      question,
      context,
      sourceTitles: sources.map((item) => item.title).filter(Boolean) as string[]
    });

    const sourceByTitle = new Map<string, SourceRef>();
    for (const source of sources) {
      const title = String(source.title || "").trim();
      if (!title) continue;
      const key = title.toLowerCase();
      if (!sourceByTitle.has(key)) {
        sourceByTitle.set(key, source);
      }
    }
    const matchedSources = response.sourceTitles
      ? response.sourceTitles
          .map((title) => title.trim())
          .map((title) => sourceByTitle.get(title.toLowerCase()))
          .filter((item): item is SourceRef => Boolean(item))
      : [];

    return jsonWithCors({
      answer: response.answer || "I don't have enough proof to answer that.",
      sources: matchedSources
    });
  } catch (error) {
    return jsonWithCors(
      {
        error: "Failed to answer question.",
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}
