import { NextRequest } from "next/server";

import { slugify } from "@what-we-use/shared";

import { corsPreflightResponse, jsonWithCors } from "@/lib/cors";
import { getIngredientBySlug, isFirestoreConfigured } from "@/lib/firestore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function OPTIONS(): Promise<Response> {
  return corsPreflightResponse();
}

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const slugParam = request.nextUrl.searchParams.get("slug");
    const slug = slugify(String(slugParam || ""));

    if (!slug) {
      return jsonWithCors(
        {
          error: "Missing slug query parameter."
        },
        { status: 400 }
      );
    }

    if (!isFirestoreConfigured()) {
      return jsonWithCors(
        {
          error:
            "Firestore is not configured. Set FIREBASE_SERVICE_ACCOUNT_JSON or FIREBASE_SERVICE_ACCOUNT_PATH."
        },
        { status: 503 }
      );
    }

    const ingredient = await getIngredientBySlug(slug);
    if (!ingredient) {
      return jsonWithCors(
        {
          error: "Ingredient not found."
        },
        { status: 404 }
      );
    }

    return jsonWithCors({
      ok: true,
      ingredient
    });
  } catch (error) {
    return jsonWithCors(
      {
        error: "Failed to fetch ingredient.",
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}
