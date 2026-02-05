import { ScanResult } from "@what-we-use/shared";

import { requireApiBaseUrl } from "./config";

export async function scanFromText(text: string): Promise<ScanResult> {
  const baseUrl = requireApiBaseUrl();
  const response = await fetch(`${baseUrl}/api/scan`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ text })
  });

  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload?.error || "Scan request failed.");
  }

  return payload as ScanResult;
}

export async function scanFromPhotos(input: {
  frontUri: string;
  backUri: string;
}): Promise<ScanResult> {
  const baseUrl = requireApiBaseUrl();
  const formData = new FormData();

  formData.append("image_front", {
    uri: input.frontUri,
    name: "front.jpg",
    type: "image/jpeg"
  } as any);
  formData.append("image_back", {
    uri: input.backUri,
    name: "back.jpg",
    type: "image/jpeg"
  } as any);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/api/analyze`, {
      method: "POST",
      headers: {
        Accept: "application/json"
      },
      body: formData,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }

  let payload: any = null;
  let rawText = "";
  try {
    rawText = await response.text();
    payload = rawText ? JSON.parse(rawText) : null;
  } catch {
    payload = rawText ? { raw: rawText } : null;
  }

  if (!response.ok) {
    const detail =
      payload?.error ||
      payload?.details ||
      `Image scan failed (${response.status}).`;
    throw new Error(detail);
  }

  if (!payload || !payload.ingredients || !payload.overallRisk) {
    throw new Error(
      payload?.raw
        ? `Unexpected API response: ${payload.raw}`
        : "Unexpected API response (empty)."
    );
  }

  return payload as ScanResult;
}
