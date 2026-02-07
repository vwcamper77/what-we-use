import type { ExpoConfig } from "expo/config";

const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL || "https://YOUR-API.vercel.app";
const EAS_PROJECT_ID = process.env.EAS_PROJECT_ID || "";

const config: ExpoConfig = {
  name: "What We Use",
  slug: "what-we-use",
  scheme: "whatweuse",
  version: "1.0.0",
  orientation: "portrait",
  userInterfaceStyle: "light",
  ios: {
    supportsTablet: true,
    bundleIdentifier: "com.whatweuse.mobile",
    infoPlist: {
      NSCameraUsageDescription: "We use the camera to scan product labels."
    }
  },
  android: {
    package: "com.whatweuse.mobile"
  },
  plugins: ["react-native-mlkit-ocr"],
  extra: {
    apiBaseUrl: API_BASE_URL,
    eas: {
      projectId: EAS_PROJECT_ID
    }
  }
};

export default config;
