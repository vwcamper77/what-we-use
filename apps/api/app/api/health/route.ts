import { corsPreflightResponse, jsonWithCors } from "@/lib/cors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function OPTIONS(): Promise<Response> {
  return corsPreflightResponse();
}

export async function GET(): Promise<Response> {
  return jsonWithCors({
    ok: true,
    service: "what-we-use-api"
  });
}
