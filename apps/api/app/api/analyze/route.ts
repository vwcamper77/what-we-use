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
      productName?: unknown;
      warningText?: unknown;
    };

    const text = typeof body?.text === "string" ? body.text.trim() : "";
    const ingredients = Array.isArray(body?.ingredients)
      ? body.ingredients.map((item) => String(item || "").trim()).filter(Boolean)
      : [];
    const productName = typeof body?.productName === "string" ? body.productName.trim() : "";
    const warningText = typeof body?.warningText === "string" ? body.warningText.trim() : "";

    const combinedText = [
      productName ? `Product name: ${productName}` : "",
      text ? `Ingredients label text:\n${text}` : "",
      warningText ? `Warnings or cautions:\n${warningText}` : ""
    ]
      .filter(Boolean)
      .join("\n\n");

    if (!combinedText && ingredients.length === 0) {
      return jsonWithCors(
        {
          error: "Body must include either text:string or ingredients:string[]."
        },
        { status: 400 }
      );
    }

    const result = await createScanResult({
      text: combinedText || undefined,
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
        error: "Failed to analyze text.",
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}
