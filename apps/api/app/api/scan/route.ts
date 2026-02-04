import { NextRequest } from "next/server";

import { corsPreflightResponse, jsonWithCors } from "@/lib/cors";
import { createScanResult } from "@/lib/scan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function OPTIONS(): Promise<Response> {
  return corsPreflightResponse();
}

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const body = (await request.json()) as {
      text?: unknown;
      ingredients?: unknown;
    };

    const text = typeof body?.text === "string" ? body.text.trim() : "";
    const ingredients = Array.isArray(body?.ingredients)
      ? body.ingredients.map((item) => String(item || "").trim()).filter(Boolean)
      : [];

    if (!text && ingredients.length === 0) {
      return jsonWithCors(
        {
          error: "Body must include either text:string or ingredients:string[]."
        },
        { status: 400 }
      );
    }

    const result = await createScanResult({
      text: text || undefined,
      ingredients: ingredients.length ? ingredients : undefined
    });

    return jsonWithCors(result);
  } catch (error) {
    if (error instanceof SyntaxError) {
      return jsonWithCors(
        {
          error: "Request body must be valid JSON."
        },
        { status: 400 }
      );
    }

    return jsonWithCors(
      {
        error: "Failed to process scan.",
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}
