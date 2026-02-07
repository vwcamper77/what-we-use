import { corsPreflightResponse, jsonWithCors } from "@/lib/cors";
import { analyzeImagesForScan } from "@/lib/gemini";
import { createScanResult } from "@/lib/scan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function OPTIONS(): Promise<Response> {
  return corsPreflightResponse();
}

function toBase64(buffer: ArrayBuffer): string {
  return Buffer.from(buffer).toString("base64");
}

export async function POST(request: Request): Promise<Response> {
  try {
    const formData = await request.formData();
    const frontFile = formData.get("image_front");
    const backFile = formData.get("image_back");

    if (!(frontFile instanceof File) || !(backFile instanceof File)) {
      return jsonWithCors(
        {
          error: "Missing images. Provide image_front and image_back."
        },
        { status: 400 }
      );
    }

    const [frontBuffer, backBuffer] = await Promise.all([
      frontFile.arrayBuffer(),
      backFile.arrayBuffer()
    ]);

    const geminiData = await analyzeImagesForScan([
      {
        label: "front",
        mimeType: frontFile.type || "image/jpeg",
        data: toBase64(frontBuffer)
      },
      {
        label: "back",
        mimeType: backFile.type || "image/jpeg",
        data: toBase64(backBuffer)
      }
    ]);

    const result = await createScanResult({
      ingredients: geminiData.ingredients.map((item) => item.name),
      geminiData
    });

    return jsonWithCors(result);
  } catch (error) {
    return jsonWithCors(
      {
        error: "Failed to analyze images.",
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}
