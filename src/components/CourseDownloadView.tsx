import React, { useEffect, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { StatusBar } from "expo-status-bar";
import { ActivityIndicator, Animated, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTheme } from "@/context/ThemeContext";

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

  const [pulseAnim] = useState(() => new Animated.Value(1));
  const [glowOpacity] = useState(() => new Animated.Value(0.35));

  useEffect(() => {
    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(pulseAnim, {
            toValue: 1.18,
            duration: 1500,
            useNativeDriver: true,
          }),
          Animated.timing(glowOpacity, {
            toValue: 0.65,
            duration: 1500,
            useNativeDriver: true,
          }),
        ]),
        Animated.parallel([
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 1500,
            useNativeDriver: true,
          }),
          Animated.timing(glowOpacity, {
            toValue: 0.35,
            duration: 1500,
            useNativeDriver: true,
          }),
        ]),
      ])
    );
    pulseLoop.start();

    return () => pulseLoop.stop();
  }, [pulseAnim, glowOpacity]);

  return (
    <SafeAreaView style={styles.downloadContainer}>
      <StatusBar style="light" />
      <View style={styles.downloadContent}>
        {/* Glow Aura & Icon */}
        <View style={styles.iconWrapper}>
          <Animated.View
            style={[
              styles.glowAura,
              {
                backgroundColor: theme.primary,
                shadowColor: theme.primary,
                opacity: glowOpacity,
                transform: [{ scale: pulseAnim }],
              },
            ]}
          />

          <View
            style={[
              styles.iconCircle,
              {
                backgroundColor: theme.subtle,
                borderColor: theme.primary,
                shadowColor: theme.primary,
              },
            ]}
          >
            <Ionicons name="cloud-download" size={44} color={theme.primary} />
          </View>
        </View>

        <Text style={styles.downloadTitle}>{title}</Text>
        <Text style={[styles.downloadCourseName, { color: theme.primary }]}>
          {courseName}
        </Text>

        <ActivityIndicator
          size="large"
          color={theme.primary}
          style={{ marginVertical: 24 }}
        />

        <View style={styles.glassCard}>
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
    backgroundColor: "#0d0e12",
    justifyContent: "center",
    alignItems: "center",
  },
  downloadContent: {
    alignItems: "center",
    paddingHorizontal: 28,
    width: "100%",
  },
  iconWrapper: {
    width: 120,
    height: 120,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 20,
    position: "relative",
  },
  glowAura: {
    position: "absolute",
    width: 100,
    height: 100,
    borderRadius: 50,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 26,
    elevation: 8,
  },
  iconCircle: {
    width: 88,
    height: 88,
    borderRadius: 44,
    borderWidth: 1.5,
    justifyContent: "center",
    alignItems: "center",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.45,
    shadowRadius: 14,
    elevation: 6,
  },
  downloadTitle: {
    fontSize: 24,
    fontWeight: "800",
    color: "#ffffff",
    letterSpacing: -0.4,
  },
  downloadCourseName: {
    fontSize: 15,
    fontWeight: "600",
    marginTop: 6,
    textAlign: "center",
    letterSpacing: -0.2,
  },
  glassCard: {
    backgroundColor: "rgba(28, 28, 32, 0.82)",
    padding: 18,
    borderRadius: 20,
    width: "100%",
    maxWidth: 340,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.1)",
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 4,
  },
  progressStatus: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "600",
    textAlign: "center",
    marginBottom: 6,
    letterSpacing: -0.2,
  },
  progressHint: {
    color: "#8e8e93",
    fontSize: 12,
    textAlign: "center",
    lineHeight: 17,
  },
});
