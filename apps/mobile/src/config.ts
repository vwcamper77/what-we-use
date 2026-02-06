import Constants from "expo-constants";

type ExtraConfig = { apiBaseUrl?: string } | undefined;

function resolveApiBaseUrl(): string {
  const extraFromExpoConfig = (Constants.expoConfig?.extra as ExtraConfig)?.apiBaseUrl;
  const extraFromManifest = ((Constants as { manifest?: { extra?: ExtraConfig } }).manifest?.extra as ExtraConfig)
    ?.apiBaseUrl;
  const extraFromManifest2 = (
    (Constants as { manifest2?: { extra?: ExtraConfig } }).manifest2?.extra as ExtraConfig
  )?.apiBaseUrl;

  return (
    extraFromExpoConfig ||
    extraFromManifest ||
    extraFromManifest2 ||
    process.env.EXPO_PUBLIC_API_URL ||
    ""
  );
}

export const API_BASE_URL = resolveApiBaseUrl().replace(/\/+$/, "");

export function requireApiBaseUrl(): string {
  if (!API_BASE_URL) {
    throw new Error(
      "Missing API base URL. Set EXPO_PUBLIC_API_URL or configure app.config.ts extra.apiBaseUrl."
    );
  }
  return API_BASE_URL;
}
