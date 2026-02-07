# What We Use Monorepo

## Workspace Layout

- `apps/mobile`: Expo mobile app (EAS-ready).
- `apps/api`: Vercel serverless API using Next.js Route Handlers.
- `packages/shared`: Shared types and helpers used by both apps.

## Install

```bash
pnpm install
```

## Local Development

```bash
pnpm dev:api
pnpm dev:mobile
```

## API Environment (`apps/api/.env`)

- `GEMINI_API_KEY`
- `GEMINI_MODEL` (optional, defaults to `gemini-2.0-flash`)
- `FIREBASE_SERVICE_ACCOUNT_JSON` (preferred on Vercel)
- `FIREBASE_SERVICE_ACCOUNT_PATH` (optional local fallback)

## Mobile Environment (`apps/mobile/.env`)

- `EXPO_PUBLIC_API_URL=https://<your-vercel-domain>`

## On-Device OCR (Mobile)

The mobile app runs OCR on-device with ML Kit. Label images never leave the device; only extracted text is sent to the API for Gemini analysis.

Setup steps:
1. `cd apps/mobile`
2. `npx expo install expo-dev-client react-native-mlkit-ocr`
3. `npx expo prebuild`
4. `npx expo run:ios` or `npx expo run:android` (or use EAS build)

## Deploy API to Vercel

1. Create a Vercel project with root directory `apps/api`.
2. Set environment variables from `apps/api/.env.example`.
3. Deploy.

## EAS Build Commands

```bash
cd apps/mobile
eas build --profile ios-testflight --platform ios
eas submit --profile ios-testflight --platform ios

eas build --profile android-internal --platform android
eas submit --profile android-internal --platform android
```
