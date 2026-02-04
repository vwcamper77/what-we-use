import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import { StatusBar } from "expo-status-bar";

import { RISK_LABELS, slugify } from "@what-we-use/shared";

import { scanFromText } from "./src/api";
import { API_BASE_URL } from "./src/config";

export default function App(): JSX.Element {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    summary: string;
    overallRisk: keyof typeof RISK_LABELS;
    ingredients: Array<{ name: string; risk: keyof typeof RISK_LABELS; notes?: string }>;
  } | null>(null);

  const canScan = useMemo(() => text.trim().length > 0 && !loading, [loading, text]);

  async function onScan(): Promise<void> {
    try {
      setLoading(true);
      setError(null);
      const payload = await scanFromText(text.trim());
      setResult(payload);
    } catch (scanError) {
      setError(scanError instanceof Error ? scanError.message : "Scan failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>What We Use</Text>
        <Text style={styles.subtitle}>API: {API_BASE_URL || "Missing EXPO_PUBLIC_API_URL"}</Text>

        <TextInput
          multiline
          value={text}
          onChangeText={setText}
          style={styles.input}
          placeholder="Paste ingredient list or label text here"
          autoCapitalize="none"
          autoCorrect={false}
        />

        <Pressable style={[styles.button, !canScan && styles.buttonDisabled]} onPress={onScan} disabled={!canScan}>
          {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Scan</Text>}
        </Pressable>

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
  error: {
    color: "#dc2626"
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
