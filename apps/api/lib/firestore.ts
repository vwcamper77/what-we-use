import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import admin from "firebase-admin";

import { Ingredient, SourceRef, normalizeRisk, slugify } from "@what-we-use/shared";

type ServiceAccount = admin.ServiceAccount;

export function isFirestoreConfigured(): boolean {
  return Boolean(
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON || process.env.FIREBASE_SERVICE_ACCOUNT_PATH
  );
}

function loadServiceAccount(): ServiceAccount {
  const rawJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (rawJson) {
    try {
      return JSON.parse(rawJson);
    } catch {
      throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON must be valid JSON.");
    }
  }

  const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (!serviceAccountPath) {
    throw new Error(
      "Missing Firestore credentials. Set FIREBASE_SERVICE_ACCOUNT_JSON or FIREBASE_SERVICE_ACCOUNT_PATH."
    );
  }

  const resolvedPath = resolve(process.cwd(), serviceAccountPath);
  if (!existsSync(resolvedPath)) {
    throw new Error(`FIREBASE_SERVICE_ACCOUNT_PATH does not exist: ${resolvedPath}`);
  }

  const raw = readFileSync(resolvedPath, "utf8");
  return JSON.parse(raw);
}

let cachedDb: admin.firestore.Firestore | null = null;

export function getFirestore(): admin.firestore.Firestore {
  if (cachedDb) return cachedDb;

  const credentials = loadServiceAccount();

  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(credentials)
    });
  }

  cachedDb = admin.firestore();
  return cachedDb;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item || "").trim()).filter(Boolean);
}

function toSourceArray(value: unknown): SourceRef[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const title = typeof record.title === "string" ? record.title.trim() : "";
      const url = typeof record.url === "string" ? record.url.trim() : "";
      if (!title && !url) return null;
      return {
        ...(title ? { title } : {}),
        ...(url ? { url } : {})
      } as SourceRef;
    })
    .filter((item): item is SourceRef => item !== null);
}

export interface IngredientRecord extends Ingredient {
  aliases: string[];
  category: string;
  healthFlags: string[];
  regulatoryNotes: string;
  sources: SourceRef[];
}

export function mapIngredientRecord(slug: string, data: Record<string, unknown>): IngredientRecord {
  return {
    name: String(data.name || slug),
    slug,
    risk: normalizeRisk(String(data.risk_level || data.risk || "")),
    notes: String(data.regulatory_notes || "").trim() || undefined,
    aliases: toStringArray(data.aliases),
    category: String(data.category || "other"),
    healthFlags: toStringArray(data.health_flags),
    regulatoryNotes: String(data.regulatory_notes || ""),
    sources: toSourceArray(data.sources)
  };
}

export async function getIngredientBySlug(slug: string): Promise<IngredientRecord | null> {
  const normalizedSlug = slugify(slug);
  if (!normalizedSlug) return null;

  const snapshot = await getFirestore().collection("ingredients").doc(normalizedSlug).get();
  if (!snapshot.exists) return null;

  return mapIngredientRecord(normalizedSlug, (snapshot.data() || {}) as Record<string, unknown>);
}
