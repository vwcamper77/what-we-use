import { NextResponse } from "next/server";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization"
};

export function corsPreflightResponse(): NextResponse {
  return new NextResponse(null, {
    status: 204,
    headers: CORS_HEADERS
  });
}

export function jsonWithCors<T>(
  body: T,
  init?: {
    status?: number;
    headers?: HeadersInit;
  }
): NextResponse {
  return NextResponse.json(body, {
    status: init?.status,
    headers: {
      ...CORS_HEADERS,
      ...(init?.headers || {})
    }
  });
}
