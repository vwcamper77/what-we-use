import MlkitOcr from "react-native-mlkit-ocr";

type OcrElement = {
  text?: string;
  confidence?: number;
};

type OcrLine = {
  text?: string;
  confidence?: number;
  elements?: OcrElement[];
};

type OcrBlock = {
  text?: string;
  confidence?: number;
  lines?: OcrLine[];
};

const NON_PRINTABLE_PATTERN = /[^\x09\x0A\x0D\x20-\x7E]/g;

function normalizeOcrText(input: string): string {
  return String(input || "")
    .replace(/\r\n?/g, "\n")
    .replace(/\t/g, " ")
    .replace(NON_PRINTABLE_PATTERN, "")
    .replace(/[|¦]+/g, "")
    .replace(/[_=]{3,}/g, "")
    .replace(/[ ]{2,}/g, " ")
    .replace(/\n[ ]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function collectText(blocks: OcrBlock[]): string {
  const lines: string[] = [];
  for (const block of blocks) {
    if (block?.lines && block.lines.length > 0) {
      for (const line of block.lines) {
        const text = String(line?.text || "").trim();
        if (text) lines.push(text);
      }
      continue;
    }
    const fallback = String(block?.text || "").trim();
    if (fallback) lines.push(fallback);
  }
  return lines.join("\n");
}

function pushConfidence(target: number[], value: unknown): void {
  if (typeof value !== "number" || !Number.isFinite(value)) return;
  const normalized = value > 1 ? value / 100 : value;
  if (normalized >= 0 && normalized <= 1) {
    target.push(normalized);
  }
}

function collectConfidence(blocks: OcrBlock[]): number | undefined {
  const confidences: number[] = [];
  for (const block of blocks) {
    pushConfidence(confidences, block?.confidence);
    if (block?.lines) {
      for (const line of block.lines) {
        pushConfidence(confidences, line?.confidence);
        if (line?.elements) {
          for (const element of line.elements) {
            pushConfidence(confidences, element?.confidence);
          }
        }
      }
    }
  }
  if (!confidences.length) return undefined;
  const total = confidences.reduce((sum, value) => sum + value, 0);
  return Math.max(0, Math.min(1, total / confidences.length));
}

export async function runOcr(
  imageUri: string
): Promise<{ text: string; blocks?: OcrBlock[]; confidence?: number }> {
  if (!imageUri) {
    return { text: "" };
  }

  const moduleRef = MlkitOcr as unknown as {
    detectFromUri?: (uri: string) => Promise<OcrBlock[]>;
    detectFromFile?: (uri: string) => Promise<OcrBlock[]>;
    recognize?: (uri: string) => Promise<OcrBlock[]>;
  };

  let blocks: OcrBlock[] = [];
  if (typeof moduleRef.detectFromUri === "function") {
    blocks = await moduleRef.detectFromUri(imageUri);
  } else if (typeof moduleRef.detectFromFile === "function") {
    blocks = await moduleRef.detectFromFile(imageUri);
  } else if (typeof moduleRef.recognize === "function") {
    blocks = await moduleRef.recognize(imageUri);
  } else {
    throw new Error("OCR module is missing a recognize method.");
  }

  const rawText = collectText(blocks);
  const text = normalizeOcrText(rawText);
  const confidence = collectConfidence(blocks);

  return {
    text,
    blocks,
    ...(confidence !== undefined ? { confidence } : {})
  };
}
