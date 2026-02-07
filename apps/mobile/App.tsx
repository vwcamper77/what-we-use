import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Linking,
  Platform,
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
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as ImageManipulator from "expo-image-manipulator";

import { RISK_LABELS, ScanResult, slugify } from "@what-we-use/shared";

import { askAboutScan, scanFromText } from "./src/api";
import { API_BASE_URL } from "./src/config";
import { runOcr } from "./src/services/ocr";

const MIN_OCR_LENGTH = 120;
const MIN_OCR_CONFIDENCE = 0.45;
const OCR_KEYWORD_REGEX = /\b(ingredients|contains|composition)\b/i;
const WARNING_REGEX = /(warning|caution|danger|keep out of reach|first aid|poison|harmful)/i;

const HISTORY_STORAGE_KEY = "scan_history_v1";
const MAX_HISTORY = 20;
const THUMBNAIL_WIDTH = 480;

type HistoryEntry = {
  id: string;
  createdAt: number;
  mode: "camera" | "text";
  result: ScanResult;
  thumbnails?: {
    front?: string;
    back?: string;
  };
  rawText?: string;
};

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
  const [result, setResult] = useState<ScanResult | null>(null);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [answerSources, setAnswerSources] = useState<Array<{ title?: string; url?: string }>>([]);
  const [chatError, setChatError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);

  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView | null>(null);
  const [pictureSize, setPictureSize] = useState<string | null>(null);

  const [frontUri, setFrontUri] = useState<string | null>(null);
  const [backUri, setBackUri] = useState<string | null>(null);
  const [frontThumbUri, setFrontThumbUri] = useState<string | null>(null);
  const [backThumbUri, setBackThumbUri] = useState<string | null>(null);
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
  const canAsk = useMemo(
    () => Boolean(result) && question.trim().length > 0 && !asking,
    [asking, question, result]
  );

  const ocrPreview = useMemo(() => {
    if (!ocrText) return "";
    const trimmed = ocrText.slice(0, 500);
    return ocrText.length > 500 ? `${trimmed}...` : trimmed;
  }, [ocrText]);

  useEffect(() => {
    async function loadHistory(): Promise<void> {
      try {
        const raw = await AsyncStorage.getItem(HISTORY_STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as HistoryEntry[];
          if (Array.isArray(parsed)) {
            setHistory(parsed);
          }
        }
      } catch {
        // Ignore history load errors.
      } finally {
        setHistoryLoaded(true);
      }
    }

    loadHistory();
  }, []);

  useEffect(() => {
    if (!historyLoaded) return;
    AsyncStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history)).catch(() => {
      // Ignore history persistence errors.
    });
  }, [history, historyLoaded]);

  async function onScan(): Promise<void> {
    try {
      setIsAnalyzing(true);
      setError(null);
      setStatus("Analyzing text...");
      setResult(null);
      setQuestion("");
      setAnswer(null);
      setAnswerSources([]);
      setChatError(null);
      const payload = await scanFromText(text.trim());
      setResult(payload);
      addToHistory({
        id: String(Date.now()),
        createdAt: Date.now(),
        mode: "text",
        result: payload,
        rawText: text.trim()
      });
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

      const thumbnailPromise = createThumbnail(photo.uri);

      if (kind === "front") {
        setFrontUri(photo.uri);
        const frontThumb = await thumbnailPromise;
        setFrontThumbUri(frontThumb);
        if (!productName.trim()) {
          void runFrontOcr(photo.uri);
        }
      } else {
        setBackUri(photo.uri);
        const backThumb = await thumbnailPromise;
        setBackThumbUri(backThumb);
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
      setQuestion("");
      setAnswer(null);
      setAnswerSources([]);
      setChatError(null);

      const analysisText = buildAnalysisText({
        productName,
        ingredientText: ocrText
      });

      const payload = await scanFromText(analysisText);
      setResult(payload);
      addToHistory({
        id: String(Date.now()),
        createdAt: Date.now(),
        mode: "camera",
        result: payload,
        thumbnails: {
          ...(frontThumbUri ? { front: frontThumbUri } : {}),
          ...(backThumbUri ? { back: backThumbUri } : {})
        }
      });
    } catch (scanError) {
      setError(toFriendlyErrorMessage(scanError));
    } finally {
      setIsAnalyzing(false);
      setStatus(null);
    }
  }

  async function onAsk(): Promise<void> {
    if (!result) return;
    try {
      setAsking(true);
      setChatError(null);
      setAnswer(null);
      setAnswerSources([]);
      const response = await askAboutScan({
        question: question.trim(),
        scan: result
      });
      setAnswer(response.answer);
      setAnswerSources(response.sources || []);
      setQuestion("");
    } catch (chatError) {
      setChatError(chatError instanceof Error ? chatError.message : "Question failed.");
    } finally {
      setAsking(false);
    }
  }

  function addToHistory(entry: HistoryEntry): void {
    setHistory((prev) => [entry, ...prev].slice(0, MAX_HISTORY));
  }

  function loadHistory(entry: HistoryEntry): void {
    setResult(entry.result);
    setQuestion("");
    setAnswer(null);
    setAnswerSources([]);
    setChatError(null);
    setStatus(null);
    setError(null);
    clearCaptureState();
    setMode(entry.mode);
    setText(entry.mode === "text" ? entry.rawText || "" : "");
  }

  function clearCaptureState(): void {
    setFrontUri(null);
    setBackUri(null);
    setFrontThumbUri(null);
    setBackThumbUri(null);
    setProductName("");
    setOcrText("");
    setOcrConfidence(null);
    setOcrStatus("idle");
    setOcrAccepted(false);
    setOcrError(null);
    setCaptureTarget("back");
  }

  function resetScan(): void {
    setMode("camera");
    setText("");
    setStatus(null);
    setQuestion("");
    setAnswer(null);
    setAnswerSources([]);
    setChatError(null);
    setResult(null);
    setError(null);
    clearCaptureState();
  }

  async function createThumbnail(uri: string): Promise<string | null> {
    try {
      const result = await ImageManipulator.manipulateAsync(
        uri,
        [{ resize: { width: THUMBNAIL_WIDTH } }],
        {
          compress: 0.6,
          format: ImageManipulator.SaveFormat.JPEG
        }
      );
      return result.uri || null;
    } catch {
      return null;
    }
  }
  function retakeBack(): void {
    setBackUri(null);
    setBackThumbUri(null);
    setOcrText("");
    setOcrConfidence(null);
    setOcrStatus("idle");
    setOcrAccepted(false);
    setOcrError(null);
    setResult(null);
    setCaptureTarget("back");
  }

  function resetPhotos(): void {
    clearCaptureState();
    setResult(null);
    setError(null);
  }

  return (
    <KeyboardAvoidingView
      style={styles.safeArea}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={Platform.OS === "ios" ? 80 : 0}
    >
      <SafeAreaView style={styles.safeArea}>
        <StatusBar style="dark" />
        <ScrollView
          contentContainerStyle={styles.container}
          keyboardShouldPersistTaps="handled"
        >
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
          <Pressable style={styles.outlineButton} onPress={resetScan}>
            <Text style={styles.outlineButtonText}>New Scan</Text>
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
                    {frontThumbUri || frontUri ? (
                      <Image
                        source={{ uri: frontThumbUri || frontUri || "" }}
                        style={styles.previewImage}
                      />
                    ) : (
                      <Text style={styles.previewEmpty}>Optional</Text>
                    )}
                  </View>
                  <View style={styles.previewBox}>
                    <Text style={styles.previewLabel}>Back</Text>
                    {backThumbUri || backUri ? (
                      <Image
                        source={{ uri: backThumbUri || backUri || "" }}
                        style={styles.previewImage}
                      />
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
                {ingredient.regulatoryNotes ? (
                  <Text style={styles.notes}>Regulatory: {ingredient.regulatoryNotes}</Text>
                ) : null}
                {ingredient.sources && ingredient.sources.length ? (
                  <View style={styles.sourcesBlock}>
                    <Text style={styles.sourcesLabel}>Sources</Text>
                    {ingredient.sources.map((source, index) => {
                      const label = source.title || source.url || `Source ${index + 1}`;
                      return (
                        <Pressable
                          key={`${label}-${index}`}
                          onPress={() => {
                            if (source.url) {
                              Linking.openURL(source.url);
                            }
                          }}
                        >
                          <Text style={styles.sourceLink}>{label}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                ) : null}
              </View>
            ))}
          </View>
        ) : null}

        {result ? (
          <View style={styles.chatCard}>
            <Text style={styles.chatTitle}>Ask About This Product</Text>
            <TextInput
              multiline
              value={question}
              onChangeText={setQuestion}
              style={styles.chatInput}
              placeholder="Ask about ingredients, risks, or alternatives"
              autoCapitalize="sentences"
            />
            <Pressable
              style={[styles.button, !canAsk && styles.buttonDisabled]}
              onPress={() => {
                Keyboard.dismiss();
                onAsk();
              }}
              disabled={!canAsk}
            >
              {asking ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.buttonText}>Ask</Text>
              )}
            </Pressable>
            {chatError ? <Text style={styles.error}>{chatError}</Text> : null}
            {answer ? (
              <View style={styles.answerBlock}>
                <Text style={styles.answerText}>{answer}</Text>
                {answerSources.length ? (
                  <View style={styles.sourcesBlock}>
                    <Text style={styles.sourcesLabel}>Sources</Text>
                    {answerSources.map((source, index) => {
                      const label = source.title || source.url || `Source ${index + 1}`;
                      return (
                        <Pressable
                          key={`${label}-${index}`}
                          onPress={() => {
                            if (source.url) {
                              Linking.openURL(source.url);
                            }
                          }}
                        >
                          <Text style={styles.sourceLink}>{label}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                ) : null}
              </View>
            ) : null}
          </View>
        ) : null}

        <View style={styles.historyCard}>
          <Text style={styles.historyTitle}>Recent Scans</Text>
          {history.length === 0 ? (
            <Text style={styles.historyEmpty}>No scans yet.</Text>
          ) : (
            history.map((entry) => {
              const thumb = entry.thumbnails?.front || entry.thumbnails?.back;
              const dateLabel = new Date(entry.createdAt).toLocaleDateString();
              return (
                <Pressable
                  key={entry.id}
                  style={styles.historyItem}
                  onPress={() => loadHistory(entry)}
                >
                  {thumb ? (
                    <Image source={{ uri: thumb }} style={styles.historyThumb} />
                  ) : (
                    <View style={styles.historyThumbPlaceholder}>
                      <Text style={styles.historyThumbText}>
                        {entry.mode === "text" ? "TXT" : "IMG"}
                      </Text>
                    </View>
                  )}
                  <View style={styles.historyMeta}>
                    <Text style={styles.historySummary} numberOfLines={2}>
                      {entry.result.summary || "Scan result"}
                    </Text>
                    <Text style={styles.historySub}>
                      {RISK_LABELS[entry.result.overallRisk] || entry.result.overallRisk} -{" "}
                      {dateLabel}
                    </Text>
                  </View>
                </Pressable>
              );
            })
          )}
        </View>
        </ScrollView>
      </SafeAreaView>
    </KeyboardAvoidingView>
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
  },
  sourcesBlock: {
    gap: 4,
    marginTop: 4
  },
  sourcesLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: "#475569"
  },
  sourceLink: {
    color: "#2563eb",
    textDecorationLine: "underline"
  },
  chatCard: {
    backgroundColor: "#fff",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    padding: 14,
    gap: 10
  },
  chatTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#0f172a"
  },
  chatInput: {
    minHeight: 80,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#cbd5e1",
    backgroundColor: "#fff",
    paddingHorizontal: 12,
    paddingVertical: 10,
    textAlignVertical: "top"
  },
  answerBlock: {
    gap: 8
  },
  answerText: {
    color: "#0f172a"
  },
  historyCard: {
    backgroundColor: "#fff",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    padding: 14,
    gap: 12
  },
  historyTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#0f172a"
  },
  historyEmpty: {
    color: "#64748b"
  },
  historyItem: {
    flexDirection: "row",
    gap: 12,
    alignItems: "center",
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: "#e2e8f0"
  },
  historyThumb: {
    width: 64,
    height: 64,
    borderRadius: 10,
    backgroundColor: "#e2e8f0"
  },
  historyThumbPlaceholder: {
    width: 64,
    height: 64,
    borderRadius: 10,
    backgroundColor: "#e2e8f0",
    alignItems: "center",
    justifyContent: "center"
  },
  historyThumbText: {
    fontWeight: "700",
    color: "#475569"
  },
  historyMeta: {
    flex: 1,
    gap: 4
  },
  historySummary: {
    color: "#0f172a",
    fontWeight: "600"
  },
  historySub: {
    color: "#64748b"
  }
});


















