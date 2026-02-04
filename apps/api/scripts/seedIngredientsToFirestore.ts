import "dotenv/config";

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { IngredientRisk, normalizeRisk, slugify } from "@what-we-use/shared";

import { getFirestore, isFirestoreConfigured } from "../lib/firestore";

function parseCsvRow(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];

    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      i += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === "," && !inQuotes) {
      cells.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  cells.push(current.trim());
  return cells;
}

function toRows(csvPath: string): Array<Record<string, string>> {
  const raw = readFileSync(csvPath, "utf8").replace(/^\uFEFF/, "");
  const lines = raw
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean);

  const [headerLine, ...dataLines] = lines;
  const headers = parseCsvRow(headerLine);

  return dataLines.map((line) => {
    const values = parseCsvRow(line);
    const row: Record<string, string> = {};

    headers.forEach((header, index) => {
      row[header] = values[index] || "";
    });

    return row;
  });
}

function inferRisk(rawRisk: string): IngredientRisk {
  return normalizeRisk(rawRisk);
}

async function run(): Promise<void> {
  if (!isFirestoreConfigured()) {
    throw new Error(
      "Missing Firestore credentials. Set FIREBASE_SERVICE_ACCOUNT_JSON or FIREBASE_SERVICE_ACCOUNT_PATH."
    );
  }

  const csvPath = resolve(process.cwd(), "data/ingredients-firestore-ready.csv");
  const rows = toRows(csvPath);
  const db = getFirestore();

  let count = 0;
  for (const row of rows) {
    const name = String(row["Chemical Name"] || row.name || "").trim();
    const slug = slugify(String(row.slug || name));
    if (!name || !slug) continue;

    await db.collection("ingredients").doc(slug).set(
      {
        slug,
        name,
        aliases: [],
        category: String(row.Category || "other").trim(),
        risk_level: inferRisk(row["Risk Summary"] || ""),
        health_flags: String(row["Risk Summary"] || "")
          .split(";")
          .map((item) => item.trim())
          .filter(Boolean),
        regulatory_notes: String(row["Regulatory Status"] || "").trim(),
        updated_at: new Date().toISOString()
      },
      { merge: true }
    );

    count += 1;
  }

  // eslint-disable-next-line no-console
  console.log(`Seeded ${count} ingredients.`);
}

run().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
