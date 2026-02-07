import { useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { CameraView, useCameraPermissions } from "expo-camera";

import { RISK_LABELS, slugify } from "@what-we-use/shared";

import { scanFromText } from "./src/api";
import { API_BASE_URL } from "./src/config";
import { runOcr } from "./src/services/ocr";

const MIN_OCR_LENGTH = 120;
const MIN_OCR_CONFIDENCE = 0.45;
const OCR_KEYWORD_REGEX = /\b(ingredients|contains|composition)\b/i;
const WARNING_REGEX = /(warning|caution|danger|keep out of reach|first aid|poison|harmful)/i;

type OcrEvaluation = {
  ok: boolean;
  message: string;
};

function evaluateOcrText(text: string, confidence?: number | null): OcrEvaluation {
  const cleaned = text.trim();
  if (!cleaned) {
    return {
      ok: false,
      message: "We couldn't read the ingredient list. Try better light, move closer, and fill the frame."
    };
  }

  if (cleaned.length < MIN_OCR_LENGTH) {
    return {
      ok: false,
      message: "We couldn't read enough text. Try better light, move closer, and fill the frame."
    };
  }

  if (confidence !== null && confidence !== undefined && confidence < MIN_OCR_CONFIDENCE) {
    return {
      ok: false,
      message: "The photo looks blurry or too dark. Please retake in better light."
    };
  }

  const commaCount = (cleaned.match(/,/g) || []).length;
  const semicolonCount = (cleaned.match(/;/g) || []).length;
  const lineCount = cleaned.split("\n").filter((line) => line.trim()).length;
  const listDensity = ((commaCount + semicolonCount) / Math.max(1, cleaned.length)) * 100;
  const hasKeyword = OCR_KEYWORD_REGEX.test(cleaned);

  if (!hasKeyword && listDensity < 1.2 && lineCount < 6) {
    return {
      ok: false,
      message: "We couldn't find an ingredients list. Make sure the ingredients panel fills the frame."
    };
  }

  return {
    ok: true,
    message: "Review the text below to confirm we captured the full ingredients list."
  };
}

function pickLargestSize(sizes?: string[]): string | null {
  if (!sizes || sizes.length === 0) return null;
  let best = sizes[0];
  let bestArea = 0;
  for (const size of sizes) {
    const match = size.match(/(\d+)\s*x\s*(\d+)/i);
    if (!match) continue;
    const width = Number(match[1]);
    const height = Number(match[2]);
    const area = width * height;
    if (area > bestArea) {
      bestArea = area;
      best = size;
    }
  }
  return best;
}

function extractWarnings(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && WARNING_REGEX.test(line));
}

function buildAnalysisText(input: { productName: string; ingredientText: string }): string {
  const sections: string[] = [];
  const name = input.productName.trim();
  if (name) sections.push(`Product name: ${name}`);
  const ingredientText = input.ingredientText.trim();
  if (ingredientText) sections.push(`Ingredients label text:\n${ingredientText}`);
  const warnings = extractWarnings(input.ingredientText);
  if (warnings.length) {
    sections.push(`Warnings or cautions:\n${warnings.join(" ")}`);
  }
  return sections.join("\n\n");
}

function guessProductName(text: string): string {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    if (OCR_KEYWORD_REGEX.test(line)) continue;
    if (line.length < 3 || line.length > 60) continue;
    return line;
  }

  return "";
}

function toFriendlyErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error || "");
  const upper = message.toUpperCase();
  if (upper.includes("RESOURCE_EXHAUSTED") || upper.includes("RATE_LIMIT") || message.includes("429")) {
    return "The analysis service is busy right now. Please try again in a moment.";
  }
  if (upper.includes("NETWORK") || upper.includes("FETCH") || upper.includes("ABORT")) {
    return "We couldn't reach the analysis service. Check your connection and try again.";
  }
  return message || "Scan failed.";
}

export default function App(): JSX.Element {
  const [text, setText] = useState("");
  const [mode, setMode] = useState<"text" | "camera">("camera");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [result, setResult] = useState<{
    summary: string;
    overallRisk: keyof typeof RISK_LABELS;
    ingredients: Array<{ name: string; risk: keyof typeof RISK_LABELS; notes?: string }>;
  } | null>(null);

  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView | null>(null);
  const [pictureSize, setPictureSize] = useState<string | null>(null);

  const [frontUri, setFrontUri] = useState<string | null>(null);
  const [backUri, setBackUri] = useState<string | null>(null);
  const [captureTarget, setCaptureTarget] = useState<"front" | "back">("back");
  const [torchOn, setTorchOn] = useState(false);

  const [productName, setProductName] = useState("");

  const [ocrText, setOcrText] = useState("");
  const [ocrConfidence, setOcrConfidence] = useState<number | null>(null);
  const [ocrStatus, setOcrStatus] = useState<"idle" | "running" | "ready" | "failed">("idle");
  const [ocrAccepted, setOcrAccepted] = useState(false);
  const [ocrError, setOcrError] = useState<string | null>(null);

  const ocrEvaluation = useMemo(
    () => evaluateOcrText(ocrText, ocrConfidence),
    [ocrText, ocrConfidence]
  );

  const isOcrRunning = ocrStatus === "running";
  const isBusy = isAnalyzing || isOcrRunning;

  const canScan = useMemo(() => text.trim().length > 0 && !isAnalyzing, [text, isAnalyzing]);
  const canAnalyze = useMemo(
    () => Boolean(backUri) && ocrAccepted && !isBusy,
    [backUri, ocrAccepted, isBusy]
  );

  const ocrPreview = useMemo(() => {
    if (!ocrText) return "";
    const trimmed = ocrText.slice(0, 500);
    return ocrText.length > 500 ? `${trimmed}...` : trimmed;
  }, [ocrText]);

  async function onScan(): Promise<void> {
    try {
      setIsAnalyzing(true);
      setError(null);
      setStatus("Analyzing text...");
      setResult(null);
      const payload = await scanFromText(text.trim());
      setResult(payload);
    } catch (scanError) {
      setError(toFriendlyErrorMessage(scanError));
    } finally {
      setIsAnalyzing(false);
      setStatus(null);
    }
  }

  async function handleCameraReady(): Promise<void> {
    if (pictureSize) return;
    try {
      const sizes = await cameraRef.current?.getAvailablePictureSizesAsync();
      const best = pickLargestSize(sizes);
      if (best) setPictureSize(best);
    } catch {
      // Ignore camera size lookup errors.
    }
  }

  async function runFrontOcr(uri: string): Promise<void> {
    try {
      const { text: frontText } = await runOcr(uri);
      const guess = guessProductName(frontText);
      if (guess && !productName.trim()) {
        setProductName(guess);
      }
    } catch {
      // Front OCR is optional.
    }
  }

  async function runBackOcr(uri: string): Promise<void> {
    setOcrStatus("running");
    setOcrText("");
    setOcrConfidence(null);
    setOcrAccepted(false);
    setOcrError(null);
    setStatus("Running on-device OCR...");
    setError(null);

    try {
      const { text: extractedText, confidence } = await runOcr(uri);
      setOcrText(extractedText);
      setOcrConfidence(confidence ?? null);
      setOcrStatus("ready");
    } catch {
      setOcrStatus("failed");
      setOcrError("OCR failed. Please retake the photo in better light.");
    } finally {
      setStatus(null);
    }
  }

  async function takePhoto(kind: "front" | "back"): Promise<void> {
    if (!cameraRef.current || isBusy) return;

    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 1,
        skipProcessing: false
      });

      if (!photo?.uri) return;

      if (kind === "front") {
        setFrontUri(photo.uri);
        if (!productName.trim()) {
          void runFrontOcr(photo.uri);
        }
      } else {
        setBackUri(photo.uri);
        setResult(null);
        await runBackOcr(photo.uri);
      }
    } catch {
      setError("Camera capture failed.");
    }
  }

  async function onAnalyzeIngredients(): Promise<void> {
    if (!backUri || !ocrAccepted || isBusy) return;

    try {
      setIsAnalyzing(true);
      setError(null);
      setStatus("Analyzing ingredients...");
      setResult(null);

      const analysisText = buildAnalysisText({
        productName,
        ingredientText: ocrText
      });

      const payload = await scanFromText(analysisText);
      setResult(payload);
    } catch (scanError) {
      setError(toFriendlyErrorMessage(scanError));
    } finally {
      setIsAnalyzing(false);
      setStatus(null);
    }
  }

  function retakeBack(): void {
    setBackUri(null);
    setOcrText("");
    setOcrConfidence(null);
    setOcrStatus("idle");
    setOcrAccepted(false);
    setOcrError(null);
    setResult(null);
    setCaptureTarget("back");
  }

  function resetPhotos(): void {
    setFrontUri(null);
    setBackUri(null);
    setProductName("");
    setOcrText("");
    setOcrConfidence(null);
    setOcrStatus("idle");
    setOcrAccepted(false);
    setOcrError(null);
    setResult(null);
    setError(null);
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>What We Use</Text>
        <Text style={styles.subtitle}>API: {API_BASE_URL || "Missing EXPO_PUBLIC_API_URL"}</Text>

        <View style={styles.modeRow}>
          <Pressable
            style={[styles.chip, mode === "camera" && styles.chipActive]}
            onPress={() => setMode("camera")}
          >
            <Text style={[styles.chipText, mode === "camera" && styles.chipTextActive]}>
              Camera
            </Text>
          </Pressable>
          <Pressable
            style={[styles.chip, mode === "text" && styles.chipActive]}
            onPress={() => setMode("text")}
          >
            <Text style={[styles.chipText, mode === "text" && styles.chipTextActive]}>Text</Text>
          </Pressable>
        </View>

        {mode === "camera" ? (
          <View style={styles.cameraCard}>
            {!permission?.granted ? (
              <Pressable style={styles.button} onPress={requestPermission}>
                <Text style={styles.buttonText}>Enable Camera</Text>
              </Pressable>
            ) : (
              <>
                <Text style={styles.sectionTitle}>Capture labels</Text>
                <Text style={styles.sectionNote}>Back ingredients panel required. Front is optional.</Text>

                <View style={styles.guidanceCard}>
                  <Text style={styles.guidanceTitle}>Capture tips</Text>
                  <Text style={styles.guidanceItem}>- Find bright light</Text>
                  <Text style={styles.guidanceItem}>- Hold steady</Text>
                  <Text style={styles.guidanceItem}>- Fill the frame with the ingredients list</Text>
                  <Text style={styles.guidanceItem}>- Avoid glare</Text>
                </View>

                <View style={styles.cameraShell}>
                  <CameraView
                    ref={cameraRef}
                    style={styles.cameraView}
                    facing="back"
                    enableTorch={torchOn}
                    autofocus="on"
                    pictureSize={pictureSize || undefined}
                    onCameraReady={handleCameraReady}
                  />
                  {captureTarget === "back" ? (
                    <View pointerEvents="none" style={styles.ingredientsOverlay}>
                      <View style={styles.ingredientsFrame} />
                      <View style={styles.ingredientsLabel}>
                        <Text style={styles.ingredientsLabelText}>Ingredients area</Text>
                      </View>
                    </View>
                  ) : null}
                </View>

                <View style={styles.captureRow}>
                  <Pressable
                    style={[styles.chip, captureTarget === "back" && styles.chipActive]}
                    onPress={() => setCaptureTarget("back")}
                  >
                    <Text
                      style={[
                        styles.chipText,
                        captureTarget === "back" && styles.chipTextActive
                      ]}
                    >
                      Back (Required)
                    </Text>
                  </Pressable>
                  <Pressable
                    style={[styles.chip, captureTarget === "front" && styles.chipActive]}
                    onPress={() => setCaptureTarget("front")}
                  >
                    <Text
                      style={[
                        styles.chipText,
                        captureTarget === "front" && styles.chipTextActive
                      ]}
                    >
                      Front (Optional)
                    </Text>
                  </Pressable>
                </View>

                <View style={styles.captureRow}>
                  <Pressable
                    style={[styles.button, isBusy && styles.buttonDisabled]}
                    onPress={() => takePhoto(captureTarget)}
                    disabled={isBusy}
                  >
                    {isBusy ? (
                      <ActivityIndicator color="#fff" />
                    ) : (
                      <Text style={styles.buttonText}>
                        Capture {captureTarget === "back" ? "Back" : "Front"}
                      </Text>
                    )}
                  </Pressable>
                  <Pressable style={styles.outlineButton} onPress={() => setTorchOn((on) => !on)}>
                    <Text style={styles.outlineButtonText}>{torchOn ? "Torch On" : "Torch Off"}</Text>
                  </Pressable>
                </View>

                <View style={styles.previewRow}>
                  <View style={styles.previewBox}>
                    <Text style={styles.previewLabel}>Front</Text>
                    {frontUri ? (
                      <Image source={{ uri: frontUri }} style={styles.previewImage} />
                    ) : (
                      <Text style={styles.previewEmpty}>Optional</Text>
                    )}
                  </View>
                  <View style={styles.previewBox}>
                    <Text style={styles.previewLabel}>Back</Text>
                    {backUri ? (
                      <Image source={{ uri: backUri }} style={styles.previewImage} />
                    ) : (
                      <Text style={styles.previewEmpty}>Required</Text>
                    )}
                  </View>
                </View>

                <TextInput
                  value={productName}
                  onChangeText={setProductName}
                  style={styles.singleLineInput}
                  placeholder="Product name (optional)"
                  autoCapitalize="words"
                  autoCorrect={false}
                />

                {backUri && ocrStatus !== "idle" ? (
                  <View style={styles.ocrCard}>
                    <Text style={styles.ocrTitle}>We found this text:</Text>
                    {ocrStatus === "running" ? (
                      <View style={styles.ocrLoadingRow}>
                        <ActivityIndicator color="#2563eb" />
                        <Text style={styles.ocrMessage}>Running on-device OCR...</Text>
                      </View>
                    ) : null}
                    {ocrStatus === "failed" ? (
                      <Text style={styles.error}>{ocrError || "OCR failed. Please retake."}</Text>
                    ) : null}
                    {ocrStatus === "ready" ? (
                      <>
                        <Text style={styles.ocrPreview}>{ocrPreview || "(No text detected)"}</Text>
                        <Text style={styles.ocrMessage}>{ocrEvaluation.message}</Text>
                        {ocrAccepted ? (
                          <Text style={styles.success}>OCR approved. Ready to analyze.</Text>
                        ) : null}
                      </>
                    ) : null}
                    <View style={styles.captureRow}>
                      {ocrStatus === "ready" && ocrEvaluation.ok ? (
                        <Pressable
                          style={[styles.smallButton, ocrAccepted && styles.buttonDisabled]}
                          onPress={() => setOcrAccepted(true)}
                          disabled={ocrAccepted}
                        >
                          <Text style={styles.buttonText}>
                            {ocrAccepted ? "Looks Good" : "Looks Good, Continue"}
                          </Text>
                        </Pressable>
                      ) : null}
                      <Pressable style={styles.outlineButton} onPress={retakeBack}>
                        <Text style={styles.outlineButtonText}>Retake</Text>
                      </Pressable>
                    </View>
                  </View>
                ) : null}

                <View style={styles.captureRow}>
                  <Pressable
                    style={[styles.button, !canAnalyze && styles.buttonDisabled]}
                    onPress={onAnalyzeIngredients}
                    disabled={!canAnalyze}
                  >
                    {isAnalyzing ? (
                      <ActivityIndicator color="#fff" />
                    ) : (
                      <Text style={styles.buttonText}>
                        {ocrAccepted ? "Analyze Ingredients" : "Analyze Photos"}
                      </Text>
                    )}
                  </Pressable>
                  <Pressable style={styles.outlineButton} onPress={resetPhotos}>
                    <Text style={styles.outlineButtonText}>Clear</Text>
                  </Pressable>
                </View>
                {status ? <Text style={styles.loadingText}>{status}</Text> : null}
              </>
            )}
          </View>
        ) : (
          <>
            <TextInput
              multiline
              value={text}
              onChangeText={setText}
              style={[styles.input, styles.textArea]}
              placeholder="Paste ingredient list or label text here"
              autoCapitalize="none"
              autoCorrect={false}
            />

            <Pressable
              style={[styles.button, !canScan && styles.buttonDisabled]}
              onPress={onScan}
              disabled={!canScan}
            >
              {isAnalyzing ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.buttonText}>Scan</Text>
              )}
            </Pressable>
          </>
        )}

        {error ? <Text style={styles.error}>{error}</Text> : null}

        {result ? (
          <View style={styles.resultCard}>
            <Text style={styles.resultTitle}>
              Overall Risk: {RISK_LABELS[result.overallRisk] || result.overallRisk}
            </Text>
            <Text style={styles.summary}>{result.summary}</Text>
            {result.ingredients.map((ingredient) => (
              <View key={`${slugify(ingredient.name)}-${ingredient.risk}`} style={styles.ingredientRow}>
                <Text style={styles.ingredientName}>{ingredient.name}</Text>
                <Text style={styles.ingredientRisk}>
                  {RISK_LABELS[ingredient.risk] || ingredient.risk}
                </Text>
                {ingredient.notes ? <Text style={styles.notes}>{ingredient.notes}</Text> : null}
              </View>
            ))}
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#f8fafc"
  },
  container: {
    padding: 20,
    gap: 16
  },
  title: {
    fontSize: 30,
    fontWeight: "700",
    color: "#0f172a"
  },
  subtitle: {
    color: "#334155"
  },
  modeRow: {
    flexDirection: "row",
    gap: 8,
    flexWrap: "wrap"
  },
  chip: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#cbd5e1",
    backgroundColor: "#fff"
  },
  chipActive: {
    backgroundColor: "#2563eb",
    borderColor: "#2563eb"
  },
  chipText: {
    color: "#1e293b",
    fontWeight: "600"
  },
  chipTextActive: {
    color: "#fff"
  },
  cameraCard: {
    backgroundColor: "#fff",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    padding: 12,
    gap: 12
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#0f172a"
  },
  sectionNote: {
    color: "#64748b",
    fontSize: 12
  },
  guidanceCard: {
    borderRadius: 12,
    padding: 10,
    backgroundColor: "#f1f5f9",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    gap: 4
  },
  guidanceTitle: {
    fontWeight: "700",
    color: "#0f172a",
    fontSize: 13
  },
  guidanceItem: {
    color: "#475569",
    fontSize: 12
  },
  cameraShell: {
    width: "100%",
    height: 320,
    borderRadius: 12,
    overflow: "hidden",
    backgroundColor: "#0f172a"
  },
  cameraView: {
    flex: 1
  },
  ingredientsOverlay: {
    ...StyleSheet.absoluteFillObject,
    padding: 14,
    justifyContent: "center",
    alignItems: "center"
  },
  ingredientsFrame: {
    width: "100%",
    height: "72%",
    borderWidth: 2,
    borderColor: "#22c55e",
    borderRadius: 12,
    backgroundColor: "rgba(34, 197, 94, 0.08)"
  },
  ingredientsLabel: {
    position: "absolute",
    top: 12,
    left: 12,
    backgroundColor: "rgba(15, 23, 42, 0.75)",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999
  },
  ingredientsLabelText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "700"
  },
  captureRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    alignItems: "center",
    justifyContent: "space-between"
  },
  smallButton: {
    flex: 1,
    backgroundColor: "#2563eb",
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: "center"
  },
  previewRow: {
    flexDirection: "row",
    gap: 12
  },
  previewBox: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 10,
    padding: 8,
    gap: 6,
    alignItems: "center"
  },
  previewLabel: {
    fontSize: 12,
    color: "#475569",
    fontWeight: "600"
  },
  previewImage: {
    width: "100%",
    height: 120,
    borderRadius: 8
  },
  previewEmpty: {
    color: "#94a3b8"
  },
  input: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#cbd5e1",
    backgroundColor: "#fff",
    paddingHorizontal: 14,
    paddingVertical: 12
  },
  textArea: {
    minHeight: 140,
    textAlignVertical: "top"
  },
  singleLineInput: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#cbd5e1",
    backgroundColor: "#fff",
    paddingHorizontal: 14,
    paddingVertical: 12
  },
  button: {
    backgroundColor: "#2563eb",
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: "center",
    flex: 1
  },
  buttonDisabled: {
    opacity: 0.5
  },
  buttonText: {
    color: "#fff",
    fontWeight: "600",
    textAlign: "center"
  },
  outlineButton: {
    borderWidth: 1,
    borderColor: "#94a3b8",
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 16
  },
  outlineButtonText: {
    color: "#1e293b",
    fontWeight: "600"
  },
  ocrCard: {
    backgroundColor: "#f8fafc",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    padding: 12,
    gap: 8
  },
  ocrTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: "#0f172a"
  },
  ocrPreview: {
    color: "#0f172a",
    fontSize: 12
  },
  ocrMessage: {
    color: "#475569",
    fontSize: 12
  },
  ocrLoadingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8
  },
  success: {
    color: "#16a34a",
    fontWeight: "600",
    fontSize: 12
  },
  error: {
    color: "#dc2626"
  },
  loadingText: {
    color: "#475569",
    fontWeight: "600"
  },
  resultCard: {
    backgroundColor: "#fff",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    padding: 14,
    gap: 10
  },
  resultTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#0f172a"
  },
  summary: {
    color: "#334155"
  },
  ingredientRow: {
    borderTopWidth: 1,
    borderTopColor: "#e2e8f0",
    paddingTop: 8,
    gap: 2
  },
  ingredientName: {
    fontWeight: "600",
    color: "#0f172a"
  },
  ingredientRisk: {
    color: "#1e293b"
  },
  notes: {
    color: "#475569"
  }
});
