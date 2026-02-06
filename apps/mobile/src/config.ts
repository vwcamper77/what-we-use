import Constants from "expo-constants";

const rawBaseUrl =
  (Constants.expoConfig?.extra as { apiBaseUrl?: string } | undefined)?.apiBaseUrl ||
  process.env.EXPO_PUBLIC_API_URL ||
  "";

export const API_BASE_URL = rawBaseUrl.replace(/\/+$/, "");

export function requireApiBaseUrl(): string {
  if (!API_BASE_URL) {
    throw new Error(
      "Missing API base URL. Set EXPO_PUBLIC_API_URL or configure app.config.ts extra.apiBaseUrl."
    );
  }
  return API_BASE_URL;
}
