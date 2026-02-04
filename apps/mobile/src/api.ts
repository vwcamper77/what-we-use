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
