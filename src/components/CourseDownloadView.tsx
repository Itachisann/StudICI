import { Ionicons } from "@expo/vector-icons";
import { StatusBar } from "expo-status-bar";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTheme } from "@/context/ThemeContext";

const SAPIENZA_RED = "#822433";

interface CourseDownloadViewProps {
  courseName: string;
  progressText: string;
  title?: string;
  subtitle?: string;
}

export function CourseDownloadView({
  courseName,
  progressText,
  title = "Configurazione in corso",
  subtitle = "Download e mappatura di tutte le aule e canali in corso. Questa operazione viene eseguita solo ora!",
}: CourseDownloadViewProps) {
  const { theme } = useTheme();
  return (
    <SafeAreaView style={styles.downloadContainer}>
      <StatusBar style="light" />
      <View style={styles.downloadContent}>
        <View
          style={[
            styles.iconCircle,
            {
              backgroundColor: theme.bg,
              borderColor: theme.primary,
              shadowColor: theme.primary,
            },
          ]}
        >
          <Ionicons name="cloud-download" size={48} color={theme.accent} />
        </View>
        <Text style={styles.downloadTitle}>{title}</Text>
        <Text style={[styles.downloadCourseName, { color: theme.accent }]}>
          {courseName}
        </Text>

        <ActivityIndicator
          size="large"
          color={theme.primary}
          style={{ marginVertical: 24 }}
        />

        <View style={[styles.progressBox, { borderColor: theme.border }]}>
          <Text style={styles.progressStatus}>
            {progressText || "Download in corso..."}
          </Text>
          <Text style={styles.progressHint}>{subtitle}</Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  downloadContainer: {
    flex: 1,
    backgroundColor: "#111111",
    justifyContent: "center",
    alignItems: "center",
  },
  downloadContent: {
    alignItems: "center",
    paddingHorizontal: 30,
    width: "100%",
  },
  iconCircle: {
    width: 90,
    height: 90,
    borderRadius: 45,
    backgroundColor: "rgba(130, 36, 51, 0.35)",
    borderWidth: 1.5,
    borderColor: SAPIENZA_RED,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 20,
    shadowColor: SAPIENZA_RED,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.85,
    shadowRadius: 12,
    elevation: 6,
  },
  downloadTitle: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#ffffff",
  },
  downloadCourseName: {
    fontSize: 16,
    color: SAPIENZA_RED,
    fontWeight: "600",
    marginTop: 6,
    textAlign: "center",
  },
  progressBox: {
    backgroundColor: "#1c1c1e",
    padding: 18,
    borderRadius: 16,
    width: "100%",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#2c2c2e",
  },
  progressStatus: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "600",
    textAlign: "center",
    marginBottom: 8,
  },
  progressHint: {
    color: "#8e8e93",
    fontSize: 12,
    textAlign: "center",
    lineHeight: 18,
  },
});
