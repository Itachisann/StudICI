import React, { useEffect, useState } from "react";
import { StatusBar } from "expo-status-bar";
import {
  ActivityIndicator,
  Animated,
  Platform,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTheme } from "@/context/ThemeContext";
import { StudICILogo } from "./StudICILogo";

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

  const [fadeAnim] = useState(() => new Animated.Value(0));
  const [translateYAnim] = useState(() => new Animated.Value(12));
  const [capsulePulse] = useState(() => new Animated.Value(1));

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 350,
        useNativeDriver: true,
      }),
      Animated.spring(translateYAnim, {
        toValue: 0,
        friction: 8,
        tension: 40,
        useNativeDriver: true,
      }),
    ]).start();

    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(capsulePulse, {
          toValue: 1.025,
          duration: 1200,
          useNativeDriver: true,
        }),
        Animated.timing(capsulePulse, {
          toValue: 1,
          duration: 1200,
          useNativeDriver: true,
        }),
      ]),
    );
    pulseLoop.start();

    return () => {
      pulseLoop.stop();
      capsulePulse.stopAnimation();
      fadeAnim.stopAnimation();
      translateYAnim.stopAnimation();
    };
  }, [fadeAnim, translateYAnim, capsulePulse]);

  return (
    <SafeAreaView style={styles.downloadContainer}>
      <StatusBar style="light" />
      <Animated.View
        style={[
          styles.downloadContent,
          {
            opacity: fadeAnim,
            transform: [{ translateY: translateYAnim }],
          },
        ]}
      >
        {/* Logo minimalista SVG senza sfondo allineato a StartupCheckScreen */}
        <View style={styles.logoWrapper}>
          <StudICILogo
            size={96}
            withBackground={false}
            primaryColor={theme.primary}
          />
        </View>

        {/* Titolo e Dettaglio Corso */}
        <Text style={styles.downloadTitle}>{title}</Text>
        <Text
          style={[
            styles.downloadCourseName,
            { color: theme.accent || theme.primary },
          ]}
          numberOfLines={2}
        >
          {courseName}
        </Text>

        {/* Dynamic Island / Liquid Glass Capsule iOS Loader */}
        <Animated.View
          style={[
            styles.capsuleWrapper,
            {
              transform: [{ scale: capsulePulse }],
            },
          ]}
        >
          <View style={styles.glassCapsule}>
            <ActivityIndicator
              size="small"
              color={theme.accent || theme.primary}
              style={{ marginRight: 8 }}
            />
            <Text style={styles.capsuleText} numberOfLines={1}>
              {progressText || "Download in corso..."}
            </Text>
          </View>

          {/* Dettaglio Avanzamento / Hint */}
          {subtitle ? (
            <View style={styles.detailBadge}>
              <Text style={styles.progressDetailText}>{subtitle}</Text>
            </View>
          ) : null}
        </Animated.View>
      </Animated.View>

      {/* Footer Minimal iOS */}
      <View style={styles.footer}>
        <Text style={styles.footerText}>Sapienza Università di Roma</Text>
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
    width: "100%",
    paddingHorizontal: 28,
  },
  logoWrapper: {
    marginBottom: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  downloadTitle: {
    fontSize: 26,
    fontWeight: "800",
    color: "#ffffff",
    letterSpacing: -0.6,
    textAlign: "center",
  },
  downloadCourseName: {
    fontSize: 14.5,
    fontWeight: "600",
    marginTop: 6,
    textAlign: "center",
    letterSpacing: -0.2,
    maxWidth: 320,
    lineHeight: 20,
  },
  capsuleWrapper: {
    marginTop: 26,
    alignItems: "center",
    width: "100%",
  },
  glassCapsule: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    borderColor: "rgba(255, 255, 255, 0.15)",
    borderWidth: 1,
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 9999,
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 4,
  },
  capsuleText: {
    color: "#ffffff",
    fontSize: 13.5,
    fontWeight: "600",
    letterSpacing: -0.2,
  },
  detailBadge: {
    backgroundColor: "rgba(255, 255, 255, 0.04)",
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginTop: 14,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
    maxWidth: 320,
  },
  progressDetailText: {
    color: "#8e8e93",
    fontSize: 12,
    textAlign: "center",
    lineHeight: 16.5,
  },
  footer: {
    position: "absolute",
    bottom: Platform.OS === "ios" ? 24 : 16,
    alignSelf: "center",
  },
  footerText: {
    color: "#48484a",
    fontSize: 12,
    fontWeight: "500",
    letterSpacing: -0.1,
  },
});
