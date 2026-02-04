export const API_BASE_URL = (process.env.EXPO_PUBLIC_API_URL || "").replace(/\/+$/, "");

export function requireApiBaseUrl(): string {
  if (!API_BASE_URL) {
    throw new Error("Missing EXPO_PUBLIC_API_URL.");
  }
  return API_BASE_URL;
}
