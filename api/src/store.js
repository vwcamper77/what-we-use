// Firestore support, optional. If you do not set FIREBASE_SERVICE_ACCOUNT_JSON, it just won’t save.

import admin from "firebase-admin";

let firestore = null;

export function initFirestore() {
  if (firestore) return firestore;

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("Missing FIREBASE_SERVICE_ACCOUNT_JSON");

  let creds;
  try {
    creds = JSON.parse(raw);
  } catch {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON must be valid JSON");
  }

  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(creds)
    });
  }

  firestore = admin.firestore();
  return firestore;
}

export async function saveScan(db, payload) {
  const scan = {
    uid: payload.uid || null,
    room: payload.room || "cleaning_cupboard",
    preferences: payload.preferences || {},
    extracted: payload.extracted || {},
    results: payload.results || [],
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  };

  const ref = await db.collection("scans").add(scan);
  return { scanId: ref.id };
}