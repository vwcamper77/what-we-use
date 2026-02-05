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

import { scanFromPhotos, scanFromText } from "./src/api";
import { API_BASE_URL } from "./src/config";

export default function App(): JSX.Element {
  const [text, setText] = useState("");
  const [mode, setMode] = useState<"text" | "camera">("camera");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    summary: string;
    overallRisk: keyof typeof RISK_LABELS;
    ingredients: Array<{ name: string; risk: keyof typeof RISK_LABELS; notes?: string }>;
  } | null>(null);

  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView | null>(null);
  const [frontUri, setFrontUri] = useState<string | null>(null);
  const [backUri, setBackUri] = useState<string | null>(null);

  const canScan = useMemo(() => text.trim().length > 0 && !loading, [loading, text]);
  const canAnalyze = useMemo(
    () => Boolean(frontUri && backUri) && !loading,
    [frontUri, backUri, loading]
  );

  async function onScan(): Promise<void> {
    try {
      setLoading(true);
      setError(null);
      setResult(null);
      const payload = await scanFromText(text.trim());
      setResult(payload);
    } catch (scanError) {
      setError(scanError instanceof Error ? scanError.message : "Scan failed.");
    } finally {
      setLoading(false);
    }
  }

  async function takePhoto(kind: "front" | "back"): Promise<void> {
    if (!cameraRef.current) return;
    const photo = await cameraRef.current.takePictureAsync({ quality: 0.7 });
    if (!photo?.uri) return;
    if (kind === "front") setFrontUri(photo.uri);
    else setBackUri(photo.uri);
  }

  async function onAnalyzePhotos(): Promise<void> {
    if (!frontUri || !backUri) return;
    try {
      setLoading(true);
      setError("Uploading photos...");
      setResult(null);
      const payload = await scanFromPhotos({ frontUri, backUri });
      setResult(payload);
      setError(null);
    } catch (scanError) {
      setError(scanError instanceof Error ? scanError.message : "Image scan failed.");
    } finally {
      setLoading(false);
    }
  }

  function resetPhotos(): void {
    setFrontUri(null);
    setBackUri(null);
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
            <Text style={[styles.chipText, mode === "text" && styles.chipTextActive]}>
              Text
            </Text>
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
                <CameraView ref={cameraRef} style={styles.cameraView} facing="back" />
                <View style={styles.captureRow}>
                  <Pressable style={styles.smallButton} onPress={() => takePhoto("front")}>
                    <Text style={styles.buttonText}>Capture Front</Text>
                  </Pressable>
                  <Pressable style={styles.smallButton} onPress={() => takePhoto("back")}>
                    <Text style={styles.buttonText}>Capture Back</Text>
                  </Pressable>
                </View>
                <View style={styles.previewRow}>
                  <View style={styles.previewBox}>
                    <Text style={styles.previewLabel}>Front</Text>
                    {frontUri ? (
                      <Image source={{ uri: frontUri }} style={styles.previewImage} />
                    ) : (
                      <Text style={styles.previewEmpty}>No photo</Text>
                    )}
                  </View>
                  <View style={styles.previewBox}>
                    <Text style={styles.previewLabel}>Back</Text>
                    {backUri ? (
                      <Image source={{ uri: backUri }} style={styles.previewImage} />
                    ) : (
                      <Text style={styles.previewEmpty}>No photo</Text>
                    )}
                  </View>
                </View>
                <View style={styles.captureRow}>
                  <Pressable
                    style={[styles.button, !canAnalyze && styles.buttonDisabled]}
                    onPress={onAnalyzePhotos}
                    disabled={!canAnalyze}
                  >
                    {loading ? (
                      <ActivityIndicator color="#fff" />
                    ) : (
                      <Text style={styles.buttonText}>Analyze Photos</Text>
                    )}
                  </Pressable>
                  <Pressable style={styles.outlineButton} onPress={resetPhotos}>
                    <Text style={styles.outlineButtonText}>Clear</Text>
                  </Pressable>
                </View>
                {loading ? <Text style={styles.loadingText}>Analyzing photos...</Text> : null}
              </>
            )}
          </View>
        ) : (
          <>
            <TextInput
              multiline
              value={text}
              onChangeText={setText}
              style={styles.input}
              placeholder="Paste ingredient list or label text here"
              autoCapitalize="none"
              autoCorrect={false}
            />

            <Pressable
              style={[styles.button, !canScan && styles.buttonDisabled]}
              onPress={onScan}
              disabled={!canScan}
            >
              {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Scan</Text>}
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
                <Text style={styles.ingredientRisk}>{RISK_LABELS[ingredient.risk] || ingredient.risk}</Text>
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
    gap: 8
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
  cameraView: {
    width: "100%",
    height: 280,
    borderRadius: 12,
    overflow: "hidden"
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
    minHeight: 140,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#cbd5e1",
    backgroundColor: "#fff",
    paddingHorizontal: 14,
    paddingVertical: 12,
    textAlignVertical: "top"
  },
  button: {
    backgroundColor: "#2563eb",
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: "center"
  },
  buttonDisabled: {
    opacity: 0.5
  },
  buttonText: {
    color: "#fff",
    fontWeight: "600"
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
