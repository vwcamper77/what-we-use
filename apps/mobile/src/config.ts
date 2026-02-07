import Constants from "expo-constants";

type ExpoExtra = {
  apiBaseUrl?: string;
  expoClient?: { hostUri?: string; extra?: { apiBaseUrl?: string } };
};

type ExpoConstantsWithManifests = typeof Constants & {
  manifest?: { extra?: ExpoExtra; hostUri?: string } | null;
  manifest2?: { extra?: ExpoExtra } | null;
  expoConfig?: { extra?: ExpoExtra; hostUri?: string } | null;
};

const constants = Constants as ExpoConstantsWithManifests;

const extraConfig: ExpoExtra | undefined =
  (constants.expoConfig?.extra as ExpoExtra | undefined) ||
  constants.manifest?.extra ||
  constants.manifest2?.extra;

const extraApiBaseUrlCandidates = [
  extraConfig?.apiBaseUrl,
  constants.manifest2?.extra?.expoClient?.extra?.apiBaseUrl
];

function normalizeBaseUrl(value: string | undefined): string {
  if (!value) return "";
  const trimmed = value.trim();
  if (!trimmed || trimmed.includes("YOUR-API")) return "";
  return trimmed.replace(/\/+$/, "");
}

function extractHost(hostUri: string): string {
  const trimmed = hostUri.trim();
  if (!trimmed) return "";

  if (trimmed.includes("//")) {
    try {
      return new URL(trimmed).hostname;
    } catch {
      return "";
    }
  }

  return trimmed.split(":")[0];
}

function deriveDevApiBaseUrl(): string {
  if (!__DEV__) return "";

  const hostUri =
    constants.expoConfig?.hostUri ||
    constants.manifest?.hostUri ||
    constants.manifest2?.extra?.expoClient?.hostUri;

  const host = hostUri ? extractHost(hostUri) : "";
  if (!host) return "";

  return `http://${host}:3000`;
}

const explicitBaseUrl = extraApiBaseUrlCandidates
  .map((value) => normalizeBaseUrl(value))
  .find(Boolean);

const envBaseUrl = normalizeBaseUrl(process.env.EXPO_PUBLIC_API_URL || "");
const devFallbackBaseUrl = normalizeBaseUrl(deriveDevApiBaseUrl());

export const API_BASE_URL = explicitBaseUrl || envBaseUrl || devFallbackBaseUrl;

export function requireApiBaseUrl(): string {
  if (!API_BASE_URL) {
    throw new Error(
      "Missing API base URL. Set EXPO_PUBLIC_API_URL or configure app.config.ts extra.apiBaseUrl."
    );
  }
  return API_BASE_URL;
}
