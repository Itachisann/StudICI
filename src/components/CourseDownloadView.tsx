import { Ionicons } from "@expo/vector-icons";
import { StatusBar } from "expo-status-bar";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

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
  return (
    <SafeAreaView style={styles.downloadContainer}>
      <StatusBar style="light" />
      <View style={styles.downloadContent}>
        <View style={styles.iconCircle}>
          <Ionicons name="cloud-download" size={48} color={SAPIENZA_RED} />
        </View>
        <Text style={styles.downloadTitle}>{title}</Text>
        <Text style={styles.downloadCourseName}>{courseName}</Text>

        <ActivityIndicator
          size="large"
          color={SAPIENZA_RED}
          style={{ marginVertical: 24 }}
        />

        <View style={styles.progressBox}>
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
    backgroundColor: "rgba(130, 36, 51, 0.15)",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 20,
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
