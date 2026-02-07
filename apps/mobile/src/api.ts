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

  let payload: any = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const message = payload?.error || payload?.details || "Scan request failed.";
    throw new Error(message);
  }

  return payload as ScanResult;
}
