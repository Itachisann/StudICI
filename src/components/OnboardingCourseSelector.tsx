import { useTheme } from "@/context/ThemeContext";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Clipboard from "expo-clipboard";
import Constants, { ExecutionEnvironment } from "expo-constants";
import React, { useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  FlatList,
  KeyboardAvoidingView,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import {
  DarkTheme,
  NavigationContainer,
  NavigationIndependentTree,
} from "@react-navigation/native";
import { NativeActionButton } from "./NativeActionButton";
import { NativeSheetModal } from "./NativeSheetModal";
import { StudICILogo } from "./StudICILogo";
import { StationInfo } from "../types/commuter";
import { isValidSyncCode, linkDeviceWithCode } from "../utils/cloudSync";
import {
  DEFAULT_COMMUTER_CONFIG,
  saveCommuterConfig,
} from "../utils/commuterStorage";
import { getDegreeClassTheme } from "../utils/degreeColors";
import {
  calculateDrivingEstimate,
  DrivingEstimate,
  PlaceSuggestion,
  searchPlaces,
} from "../utils/drivingRouter";
import {
  Degree,
  fetchAllCourseData,
  fetchDegrees,
  Tab,
} from "../utils/scraper";
import {
  ALL_STATIONS,
  POPULAR_STATIONS,
  searchStations,
} from "../utils/trenitaliaApi";
import { CourseDownloadView } from "./CourseDownloadView";
import { parseTabHierarchy } from "./YearChannelSelector";

const isExpoGo =
  Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
const isNativeIos = Platform.OS === "ios" && !isExpoGo;

const QUICK_DEPARTURE_CODES = [
  "S08409", // Roma Termini
  "S08217", // Roma Tiburtina
  "S06421", // Firenze SMN
  "S09218", // Napoli Centrale
  "S05043", // Bologna Centrale
  "S01700", // Milano Centrale
  "S07004", // Perugia
  "S07226", // Terni
];

const QUICK_ARRIVAL_CODES = [
  "S08409", // Roma Termini
  "S08217", // Roma Tiburtina
  "S08406", // Roma Ostiense
  "S08408", // Roma Tuscolana
  "S08402", // Roma S. Pietro
];

const STATION_SHORT_NAMES: Record<string, string> = {
  "S06421": "Firenze SMN",
  "S05043": "Bologna C.le",
  "S01700": "Milano C.le",
  "S09218": "Napoli C.le",
  "S08409": "Roma Termini",
  "S08217": "Roma Tiburtina",
  "S08406": "Roma Ostiense",
  "S08408": "Roma Tuscolana",
  "S08402": "Roma S. Pietro",
  "S07004": "Perugia",
  "S07226": "Terni",
};

const OnboardingStack = createNativeStackNavigator();
const OnboardingContext = React.createContext<any>(null);
const useOnboarding = () => useContext(OnboardingContext);

// ═══════════════════════════════════════════════════════════════════════════
// SCHERMATA 1: BENVENUTO PULITO MINIMAL CON LOGO SVG
// ═══════════════════════════════════════════════════════════════════════════
function WelcomeScreen({ navigation }: any) {
  const { theme } = useOnboarding();

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.cleanWelcomeContainer}>
        <View style={styles.cleanWelcomeCenter}>
          <View style={styles.cleanLogoWrapper}>
            <View
              style={[
                styles.cleanLogoGlow,
                { backgroundColor: theme.primary },
              ]}
            />
            <StudICILogo
              size={120}
              withBackground={false}
              primaryColor={theme.primary}
              secondaryColor="#a1a1aa"
            />
          </View>

          <Text style={styles.cleanAppTitle}>StudICI</Text>
          <Text style={[styles.cleanAppSubtitle, { color: theme.accent }]}>
            Sapienza Università di Roma
          </Text>
          <Text style={styles.cleanAppDesc}>
            Orari ufficiali delle lezioni, aule e tragitto pendolare in un&apos;unica app moderna.
          </Text>
        </View>

        <View style={styles.cleanWelcomeFooter}>
          <NativeActionButton
            label="Inizia"
            onPress={() => navigation.navigate("SetupMode")}
            accentColor={theme.primary}
            glow={true}
            icon={
              <Ionicons
                name="arrow-forward"
                size={18}
                color="#ffffff"
              />
            }
            style={{ width: "100%", maxWidth: 300 }}
          />
        </View>
      </View>
    </SafeAreaView>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// SCHERMATA 2: SCELTA MODALITÀ DI AVVIO
// ═══════════════════════════════════════════════════════════════════════════
function SetupModeScreen({ navigation }: any) {
  const { theme } = useOnboarding();

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.setupModeContainer}>
        <View style={styles.setupModeHeader}>
          <Text style={styles.setupModeTitle}>Come vuoi iniziare?</Text>
          <Text style={styles.setupModeSubtitle}>
            Puoi cambiare idea in qualsiasi momento
          </Text>
        </View>

        <View style={styles.setupModeCards}>
          {/* Card 1 – Configurazione manuale */}
          <TouchableOpacity
            style={[styles.setupModeCard, { borderColor: "#27272a" }]}
            activeOpacity={0.75}
            onPress={() => navigation.navigate("CourseSelect")}
          >
            <View style={styles.setupModeCardLeft}>
              <View
                style={[
                  styles.setupModeIconCircle,
                  {
                    backgroundColor: theme.primary + "28",
                    borderColor: theme.primary + "50",
                    shadowColor: theme.primary,
                  },
                ]}
              >
                <Ionicons name="school-outline" size={26} color={theme.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.setupModeCardTitle}>Configura manualmente</Text>
                <Text style={styles.setupModeCardSubtitle}>
                  Scegli il tuo corso dalla lista della Sapienza
                </Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#52525b" />
          </TouchableOpacity>

          {/* Card 2 – Sincronizzazione */}
          <TouchableOpacity
            style={[styles.setupModeCard, { borderColor: "#27272a" }]}
            activeOpacity={0.75}
            onPress={() => navigation.navigate("Sync")}
          >
            <View style={styles.setupModeCardLeft}>
              <View
                style={[
                  styles.setupModeIconCircle,
                  {
                    backgroundColor: "#3b82f628",
                    borderColor: "#3b82f650",
                    shadowColor: "#3b82f6",
                  },
                ]}
              >
                <Ionicons name="cloud-download-outline" size={26} color="#3b82f6" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.setupModeCardTitle}>Sincronizza</Text>
                <Text style={styles.setupModeCardSubtitle}>
                  Importa la configurazione da un altro dispositivo
                </Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#52525b" />
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// SCHERMATA 3: SINCRONIZZAZIONE VIA CLOUD
// ═══════════════════════════════════════════════════════════════════════════
function SyncScreen() {
  const {
    theme,
    syncCodeInput,
    setSyncCodeInput,
    handlePasteSyncCode,
    handleLinkFromCloud,
    isLinkingSync,
  } = useOnboarding();

  return (
    <View style={styles.screenRoot}>
      <ScrollView
        style={styles.syncContainer}
        contentContainerStyle={{ paddingBottom: 40 }}
        keyboardShouldPersistTaps="handled"
      >
        <View
          style={[
            styles.syncCard,
            {
              backgroundColor: "#18181b",
              borderColor: theme.border,
            },
          ]}
        >
          <View
            style={[
              styles.syncIconCircle,
              {
                backgroundColor: theme.subtle,
                borderColor: theme.border,
                borderWidth: 1,
              },
            ]}
          >
            <Ionicons name="link" size={28} color={theme.primary} />
          </View>
          <Text style={styles.syncCardTitle}>Sincronizza via Cloud</Text>
          <Text style={styles.syncCardDesc}>
            Se hai già configurato StudICI su un altro dispositivo, inserisci
            il codice univoco per sincronizzare corso, canali e presenze. Il
            codice è visibile nella sezione &quot;Sincronizzazione&quot;
            dell&apos;altro dispositivo.
          </Text>

          <View
            style={[
              styles.syncInputWrapper,
              {
                backgroundColor: "#121214",
                borderColor: theme.border,
              },
            ]}
          >
            <TextInput
              style={styles.syncInput}
              placeholder="es. ST1234A o NOME"
              placeholderTextColor="#71717a"
              value={syncCodeInput}
              onChangeText={setSyncCodeInput}
              autoCapitalize="characters"
              autoCorrect={false}
            />
            <TouchableOpacity
              style={[
                styles.syncPasteBtn,
                {
                  backgroundColor: theme.subtle,
                  borderColor: theme.border,
                  borderWidth: 0.5,
                },
              ]}
              activeOpacity={0.7}
              onPress={handlePasteSyncCode}
            >
              <Ionicons name="clipboard-outline" size={16} color={theme.accent} />
              <Text style={[styles.syncPasteBtnText, { color: theme.accent }]}>
                Incolla
              </Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={[
              styles.syncSubmitBtn,
              {
                backgroundColor: theme.primary,
                shadowColor: theme.primary,
                shadowOffset: { width: 0, height: 2 },
                shadowOpacity: 0.35,
                shadowRadius: 6,
                elevation: 4,
              },
              (!syncCodeInput.trim() || isLinkingSync) && { opacity: 0.5 },
            ]}
            activeOpacity={0.8}
            onPress={handleLinkFromCloud}
            disabled={!syncCodeInput.trim() || isLinkingSync}
          >
            {isLinkingSync ? (
              <ActivityIndicator
                size="small"
                color="#ffffff"
                style={{ marginRight: 8 }}
              />
            ) : (
              <Ionicons
                name="link-outline"
                size={18}
                color="#ffffff"
                style={{ marginRight: 8 }}
              />
            )}
            <Text style={styles.syncSubmitBtnText}>
              {isLinkingSync ? "Collegamento in corso..." : "Collega"}
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// SCHERMATA 4: SCELTA CORSO (con headerSearchBarOptions nativo di native-stack)
// ═══════════════════════════════════════════════════════════════════════════
function CourseSelectScreen({ navigation }: any) {
  const {
    theme,
    loading,
    search,
    setSearch,
    filteredDegrees,
    pendingDegree,
    handleSelectDegree,
  } = useOnboarding();

  // Search bar autentica nativa di @react-navigation/native-stack (Apple UISearchBar)
  useEffect(() => {
    navigation.setOptions({
      headerSearchBarOptions: isNativeIos ? {
        placeholder: "Cerca corso o classe (es. Informatica, L-8)...",
        placement: "stacked",
        allowToolbarIntegration: false,
        hideWhenScrolling: false,
        autoCapitalize: "none",
        tintColor: theme.primary,
        textColor: "#ffffff",
        headerIconColor: "#8e8e93",
        hintTextColor: "#71717a",
        barTintColor: "rgba(255, 255, 255, 0.08)",
        onChangeText: (e: any) => setSearch(e.nativeEvent.text),
        onCancelButtonPress: () => setSearch(""),
      } : undefined,
    });
  }, [navigation, theme.primary, setSearch]);

  return (
    <View style={styles.screenRoot}>
      {!isNativeIos && (
        <View style={styles.expoSearchWrapper}>
          <Ionicons name="search" size={16} color="#71717a" style={{ marginRight: 8 }} />
          <TextInput
            style={styles.expoSearchInput}
            value={search}
            onChangeText={setSearch}
            placeholder="Cerca corso o classe..."
            placeholderTextColor="#71717a"
            autoCapitalize="none"
            autoCorrect={false}
            clearButtonMode="while-editing"
          />
        </View>
      )}
      {loading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={theme.primary} />
          <Text style={styles.loadingText}>
            Caricamento elenco corsi Sapienza...
          </Text>
        </View>
      ) : (
        <ScrollView
          style={styles.scrollList}
          contentContainerStyle={{ paddingBottom: 40 }}
          contentInsetAdjustmentBehavior="automatic"
          keyboardShouldPersistTaps="handled"
        >
          {filteredDegrees.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Ionicons name="search-outline" size={40} color="#3a3a3c" />
              <Text style={styles.emptyText}>
                Nessun corso trovato per &quot;{search}&quot;
              </Text>
            </View>
          ) : (
            filteredDegrees.map((deg: Degree, i: number) => {
              const cleanDegreeName = deg.name
                .replace(
                  /\s*[-–]\s*(?:laurea\s+)?(?:triennale|magistrale|ciclo unico)\b/gi,
                  "",
                )
                .trim();
              const isMagistrale =
                deg.name.toLowerCase().includes("magistrale") ||
                deg.className?.toUpperCase().startsWith("LM");
              const isPendingSelected = pendingDegree?.url === deg.url;
              return (
                <TouchableOpacity
                  key={i}
                  style={[
                    styles.modalItem,
                    isPendingSelected && {
                      borderColor: theme.primary,
                      borderWidth: 1.5,
                      backgroundColor: `${theme.primary}18`,
                      shadowColor: theme.primary,
                      shadowOpacity: 0.35,
                      shadowRadius: 10,
                      shadowOffset: { width: 0, height: 0 },
                    },
                  ]}
                  activeOpacity={0.7}
                  onPress={() => handleSelectDegree(deg, navigation)}
                >
                  <View
                    style={[
                      styles.courseIconBox,
                      {
                        backgroundColor: theme.subtle,
                        borderColor: theme.border,
                        borderWidth: 1,
                      },
                    ]}
                  >
                    <Ionicons
                      name="school"
                      size={18}
                      color={theme.primary}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.modalItemTitle}>
                      {cleanDegreeName}
                    </Text>
                    <View style={styles.courseBadgesRow}>
                      <View
                        style={[
                          styles.typeBadge,
                          {
                            backgroundColor: isMagistrale
                              ? "rgba(168, 85, 247, 0.25)"
                              : "rgba(59, 130, 246, 0.25)",
                            borderColor: isMagistrale
                              ? "#c084fc"
                              : "#60a5fa",
                            shadowColor: isMagistrale
                              ? "#c084fc"
                              : "#60a5fa",
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.typeBadgeText,
                            {
                              color: isMagistrale ? "#e9d5ff" : "#bfdbfe",
                            },
                          ]}
                        >
                          {isMagistrale ? "Magistrale" : "Triennale"}
                        </Text>
                      </View>
                      {deg.className ? (() => {
                        const classTheme = getDegreeClassTheme(deg.className);
                        return (
                          <View
                            style={[
                              styles.classBadge,
                              {
                                backgroundColor: classTheme.backgroundColor,
                                borderColor: classTheme.borderColor,
                                shadowColor: classTheme.glowColor,
                              },
                            ]}
                          >
                            <Text
                              style={[
                                styles.classBadgeText,
                                { color: classTheme.textColor },
                              ]}
                            >
                              {deg.className}
                            </Text>
                          </View>
                        );
                      })() : null}
                    </View>
                  </View>
                  {isPendingSelected ? (
                    <Ionicons name="checkmark-circle" size={20} color={theme.primary} />
                  ) : (
                    <Ionicons
                      name="chevron-forward"
                      size={18}
                      color="#71717a"
                    />
                  )}
                </TouchableOpacity>
              );
            })
          )}
        </ScrollView>
      )}
    </View>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// SCHERMATA 3: POST DOWNLOAD (Orario, Viaggio & Stazioni con NativeSheetModal)
// Stile originale glowing buttons e layout card da c261508
// ═══════════════════════════════════════════════════════════════════════════
function PostDownloadScreen() {
  const {
    theme,
    pendingDegree,
    hasMultipleYears,
    uniqueYears,
    selectedYear,
    handleSelectYear,
    hasMultipleChannels,
    channelsToDisplay,
    selectedChannel,
    handleSelectChannel,
    isChannelSelectionComplete,
    missingSelectionMessage,
    resolvedTab,
    originAddress,
    setOriginAddress,
    setOriginCoords,
    placeSuggestions,
    setPlaceSuggestions,
    searchingPlaces,
    placeSearchActive,
    setPlaceSearchActive,
    handleSelectPlaceSuggestion,
    carMode,
    setCarMode,
    parkingBufferMinutes,
    setParkingBufferMinutes,
    drivingEstimate,
    calculatingDriving,
    departureStation,
    arrivalStation,
    setDepartureStation,
    setArrivalStation,
    stationPickerType,
    setStationPickerType,
    quickDepartureStations,
    quickArrivalStations,
    stationSearchQuery,
    setStationSearchQuery,
    stationResults,
    searchingStations,
    handleStationSearchChange,
    selectStationFromSearch,
    bufferMinutes,
    setBufferMinutes,
    isCommuterFormComplete,
    finalizeOnboarding,
    currentPage,
    scrollX,
    pagerRef,
    handlePagerScroll,
    screenWidth,
  } = useOnboarding();

  const insets = useSafeAreaInsets();
  const topInsetPadding = Math.max(insets.top, 24) + 16;

  const isOtherDepartureSelected = Boolean(
    departureStation &&
      !quickDepartureStations.some(
        (s: StationInfo) => s.code === departureStation.code,
      ),
  );
  const isOtherArrivalSelected = Boolean(
    arrivalStation &&
      !quickArrivalStations.some(
        (s: StationInfo) => s.code === arrivalStation.code,
      ),
  );

  const line1Width = scrollX.interpolate({
    inputRange: [0, screenWidth],
    outputRange: [34, 22],
    extrapolate: "clamp",
  });

  const line1Color = scrollX.interpolate({
    inputRange: [0, screenWidth],
    outputRange: [theme.primary, "#52525b"],
    extrapolate: "clamp",
  });

  const line2Width = scrollX.interpolate({
    inputRange: [0, screenWidth],
    outputRange: [22, 34],
    extrapolate: "clamp",
  });

  const line2Color = scrollX.interpolate({
    inputRange: [0, screenWidth],
    outputRange: [
      isChannelSelectionComplete ? "#52525b" : "#27272a",
      theme.primary,
    ],
    extrapolate: "clamp",
  });

  const page1Opacity = scrollX.interpolate({
    inputRange: [0, screenWidth * 0.45],
    outputRange: [1, 0],
    extrapolate: "clamp",
  });

  const page1TranslateY = scrollX.interpolate({
    inputRange: [0, screenWidth * 0.45],
    outputRange: [0, -6],
    extrapolate: "clamp",
  });

  const page2Opacity = scrollX.interpolate({
    inputRange: [screenWidth * 0.55, screenWidth],
    outputRange: [0, 1],
    extrapolate: "clamp",
  });

  const page2TranslateY = scrollX.interpolate({
    inputRange: [screenWidth * 0.55, screenWidth],
    outputRange: [6, 0],
    extrapolate: "clamp",
  });

  return (
    <View style={styles.screenRoot}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <Animated.ScrollView
          ref={pagerRef}
          horizontal
          pagingEnabled
          scrollEnabled={isChannelSelectionComplete && !stationPickerType}
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          onScroll={Animated.event(
            [{ nativeEvent: { contentOffset: { x: scrollX } } }],
            { useNativeDriver: false, listener: handlePagerScroll },
          )}
          scrollEventThrottle={16}
          style={{ flex: 1 }}
        >
          {/* ──────────────────────────────────────────────────────────────
              PRIMA PAGINA: PERSONALIZZA IL TUO ORARIO (Stile Glowing Chips)
             ────────────────────────────────────────────────────────────── */}
          <View style={{ width: screenWidth, flex: 1 }}>
            <ScrollView
              contentContainerStyle={[
                styles.channelScrollContent,
                { paddingTop: topInsetPadding },
              ]}
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.channelHeroHeader}>
                <View
                  style={[
                    styles.channelIconCircle,
                    {
                      backgroundColor: theme.primary,
                      shadowColor: theme.primary,
                    },
                  ]}
                >
                  <Ionicons name="funnel" size={28} color="#ffffff" />
                </View>
                <Text style={styles.channelHeroTitle}>
                  Personalizza il tuo corso
                </Text>
                <Text
                  style={[styles.channelDegreeTitle, { color: theme.accent }]}
                  numberOfLines={2}
                >
                  {pendingDegree?.name}
                </Text>
                <Text style={styles.channelHeroSubtitle}>
                  Scegli l&apos;anno e il canale che frequenti. Verranno aperti
                  in automatico ad ogni avvio
                </Text>
              </View>

              {/* 1. Selezione Anno di Corso */}
              {hasMultipleYears && (
                <View style={styles.pillSection}>
                  <Text style={styles.pillSectionLabel}>ANNO DI CORSO</Text>
                  <View style={styles.chipsContainer}>
                    {uniqueYears.map((year: string, idx: number) => {
                      const isSelected = year === selectedYear;
                      return (
                        <TouchableOpacity
                          key={idx}
                          style={[
                            styles.chip,
                            isSelected && [
                              styles.chipActive,
                              {
                                backgroundColor: theme.bg,
                                borderColor: theme.primary,
                                shadowColor: theme.primary,
                              },
                            ],
                          ]}
                          activeOpacity={0.7}
                          onPress={() => handleSelectYear(year)}
                        >
                          <Ionicons
                            name={
                              isSelected
                                ? "checkmark-circle"
                                : "calendar-outline"
                            }
                            size={15}
                            color={isSelected ? "#ffffff" : "#8e8e93"}
                            style={{ marginRight: 6 }}
                          />
                          <Text
                            style={[
                              styles.chipText,
                              isSelected && styles.chipTextActive,
                            ]}
                          >
                            {year}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              )}

              {/* 2. Selezione Canale / Suddivisione */}
              {hasMultipleChannels && (
                <View style={styles.pillSection}>
                  <Text style={styles.pillSectionLabel}>SUDDIVISIONE</Text>
                  <View style={styles.channelRowEqual}>
                    {channelsToDisplay.map((item: any, idx: number) => {
                      const channelVal = item.channel || item.tab.name;
                      const isSelected =
                        channelVal === selectedChannel &&
                        selectedChannel !== "";
                      const displayName = item.channel || item.tab.name;
                      return (
                        <TouchableOpacity
                          key={idx}
                          style={[
                            styles.chipEqual,
                            isSelected && [
                              styles.chipActive,
                              {
                                backgroundColor: theme.bg,
                                borderColor: theme.primary,
                                shadowColor: theme.primary,
                              },
                            ],
                          ]}
                          activeOpacity={0.7}
                          onPress={() => handleSelectChannel(channelVal)}
                        >
                          <Ionicons
                            name={
                              isSelected
                                ? "checkmark-circle"
                                : "people-outline"
                            }
                            size={15}
                            color={isSelected ? "#ffffff" : "#8e8e93"}
                            style={{ marginRight: 6 }}
                          />
                          <Text
                            style={[
                              styles.chipText,
                              isSelected && styles.chipTextActive,
                            ]}
                            numberOfLines={1}
                          >
                            {displayName}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              )}

              {/* 3. Card Anteprima Selezione o Avviso Selezione Richiesta */}
              {isChannelSelectionComplete && resolvedTab ? (
                <View style={styles.summaryCard}>
                  <View
                    style={[
                      styles.summaryIconBox,
                      {
                        backgroundColor: theme.subtle,
                        borderColor: theme.border,
                      },
                    ]}
                  >
                    <Ionicons name="time" size={24} color={theme.accent} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.summaryOverline}>
                      ORARIO PREDEFINITO
                    </Text>
                    <Text style={styles.summaryValue}>
                      {selectedYear || uniqueYears[0] || "Corso Unico"}
                      {selectedChannel ? ` · ${selectedChannel}` : ""}
                    </Text>
                    <Text
                      style={styles.summaryOriginalName}
                      numberOfLines={1}
                    >
                      Foglio: {resolvedTab.name}
                    </Text>
                  </View>
                </View>
              ) : (
                <View style={styles.promptSelectCard}>
                  <Ionicons
                    name="lock-closed-outline"
                    size={20}
                    color="#71717a"
                    style={{ marginBottom: 6 }}
                  />
                  <Text style={styles.promptSelectText}>
                    {missingSelectionMessage}.
                  </Text>
                </View>
              )}
            </ScrollView>
          </View>

          {/* ──────────────────────────────────────────────────────────────
              SECONDA PAGINA: IMPOSTAZIONI VIAGGIO (Stile Glowing Chips)
             ────────────────────────────────────────────────────────────── */}
          <View style={{ width: screenWidth, flex: 1 }}>
            <ScrollView
              contentContainerStyle={[
                styles.travelInitScrollContent,
                { paddingTop: topInsetPadding },
              ]}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              <View style={styles.channelHeroHeader}>
                <View
                  style={[
                    styles.channelIconCircle,
                    {
                      backgroundColor: theme.primary,
                      shadowColor: theme.primary,
                    },
                  ]}
                >
                  <Ionicons name="train" size={28} color="#ffffff" />
                </View>
                <Text style={styles.channelHeroTitle}>
                  Configura il tuo viaggio
                </Text>
                <Text style={styles.channelHeroSubtitle}>
                  Imposta il tuo tragitto pendolare per calcolare treni,
                  traffico e coincidenze verso le aule, oppure configura più
                  tardi.
                </Text>
              </View>

              {/* ── 1. LUOGO DI PARTENZA ── */}
              <View style={styles.pillSection}>
                <Text style={styles.pillSectionLabel}>
                  LUOGO DI PARTENZA
                </Text>
                <View
                  style={[
                    styles.iosPillInputWrapper,
                    originAddress.trim().length >= 2 && {
                      borderColor: theme.primary,
                      backgroundColor: "rgba(28, 28, 30, 0.95)",
                    },
                  ]}
                >
                  <Ionicons
                    name="location"
                    size={17}
                    color={
                      originAddress.trim().length >= 2
                        ? theme.accent
                        : "#71717a"
                    }
                    style={{ marginRight: 8 }}
                  />
                  <TextInput
                    style={styles.iosPillInput}
                    value={originAddress}
                    onFocus={() => setPlaceSearchActive(true)}
                    onChangeText={(txt) => {
                      setPlaceSearchActive(true);
                      setOriginAddress(txt);
                      setOriginCoords(undefined);
                    }}
                    placeholder="Inserisci indirizzo o città di partenza"
                    placeholderTextColor="#636366"
                  />
                  {searchingPlaces && (
                    <ActivityIndicator
                      size="small"
                      color={theme.accent}
                      style={{ marginLeft: 6 }}
                    />
                  )}
                  {originAddress.length > 0 && !searchingPlaces && (
                    <TouchableOpacity
                      onPress={() => {
                        setOriginAddress("");
                        setOriginCoords(undefined);
                        setPlaceSuggestions([]);
                      }}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Ionicons
                        name="close-circle"
                        size={18}
                        color="#71717a"
                      />
                    </TouchableOpacity>
                  )}
                </View>

                {placeSearchActive && placeSuggestions.length > 0 && (
                  <View style={styles.suggestionsBox}>
                    {placeSuggestions.map((place: PlaceSuggestion) => (
                      <TouchableOpacity
                        key={place.id}
                        style={styles.suggestionRow}
                        activeOpacity={0.7}
                        onPress={() => handleSelectPlaceSuggestion(place)}
                      >
                        <Ionicons
                          name="navigate-circle-outline"
                          size={17}
                          color={theme.accent}
                          style={{ marginRight: 8 }}
                        />
                        <View style={{ flex: 1 }}>
                          <Text
                            style={styles.suggestionTitle}
                            numberOfLines={1}
                          >
                            {place.title || place.label}
                          </Text>
                          {!!place.subtitle && (
                            <Text
                              style={styles.suggestionSub}
                              numberOfLines={1}
                            >
                              {place.subtitle}
                            </Text>
                          )}
                        </View>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </View>

              {/* ── 2. TRAGITTO VERSO LA STAZIONE (AUTO / NO MEZZI) ── */}
              <View style={styles.pillSection}>
                <Text style={styles.pillSectionLabel}>
                  TRAGITTO VERSO LA STAZIONE
                </Text>
                <View style={styles.channelRowEqual}>
                  <TouchableOpacity
                    style={[
                      styles.chipEqual,
                      carMode === "yes" && [
                        styles.chipActive,
                        {
                          backgroundColor: theme.bg,
                          borderColor: theme.primary,
                          shadowColor: theme.primary,
                        },
                      ],
                    ]}
                    activeOpacity={0.7}
                    onPress={() => {
                      setCarMode("yes");
                      if (parkingBufferMinutes === null) {
                        setParkingBufferMinutes(7);
                      }
                    }}
                  >
                    <Ionicons
                      name={
                        carMode === "yes"
                          ? "checkmark-circle"
                          : "car-sport-outline"
                      }
                      size={16}
                      color={carMode === "yes" ? "#ffffff" : "#8e8e93"}
                      style={{ marginRight: 6 }}
                    />
                    <Text
                      style={[
                        styles.chipText,
                        carMode === "yes" && styles.chipTextActive,
                      ]}
                    >
                      Auto
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[
                      styles.chipEqual,
                      carMode === "no" && [
                        styles.chipActive,
                        {
                          backgroundColor: theme.bg,
                          borderColor: theme.primary,
                          shadowColor: theme.primary,
                        },
                      ],
                    ]}
                    activeOpacity={0.7}
                    onPress={() => {
                      setCarMode("no");
                      setParkingBufferMinutes(null);
                    }}
                  >
                    <Ionicons
                      name={
                        carMode === "no"
                          ? "checkmark-circle"
                          : "walk-outline"
                      }
                      size={16}
                      color={carMode === "no" ? "#ffffff" : "#8e8e93"}
                      style={{ marginRight: 6 }}
                    />
                    <Text
                      style={[
                        styles.chipText,
                        carMode === "no" && styles.chipTextActive,
                      ]}
                    >
                      No mezzi
                    </Text>
                  </TouchableOpacity>
                </View>

                {carMode === "yes" && (
                  <View style={styles.subPillGroup}>
                    <Text style={styles.subPillLabel}>
                      MARGINE DI SICUREZZA
                    </Text>
                    <View style={styles.chipsContainer}>
                      {[5, 7, 10, 15].map((mins) => {
                        const isSel = parkingBufferMinutes === mins;
                        return (
                          <TouchableOpacity
                            key={mins}
                            style={[
                              styles.chip,
                              isSel && [
                                styles.chipActive,
                                {
                                  backgroundColor: theme.bg,
                                  borderColor: theme.primary,
                                  shadowColor: theme.primary,
                                },
                              ],
                            ]}
                            activeOpacity={0.7}
                            onPress={() => setParkingBufferMinutes(mins)}
                          >
                            <Text
                              style={[
                                styles.chipText,
                                isSel && styles.chipTextActive,
                              ]}
                            >
                              {mins} min
                            </Text>
                          </TouchableOpacity>
                        );
                      })}

                      {parkingBufferMinutes !== null && (
                        <View style={styles.fineStepRow}>
                          <TouchableOpacity
                            style={styles.fineStepPill}
                            onPress={() =>
                              setParkingBufferMinutes((p: number | null) =>
                                Math.max(1, (p ?? 7) - 1),
                              )
                            }
                          >
                            <Ionicons
                              name="remove"
                              size={14}
                              color="#ffffff"
                            />
                          </TouchableOpacity>
                          <View
                            style={[
                              styles.fineStepValuePill,
                              {
                                borderColor: theme.primary,
                                backgroundColor: theme.subtle,
                              },
                            ]}
                          >
                            <Text
                              style={[
                                styles.fineStepValueText,
                                { color: theme.accent },
                              ]}
                            >
                              {parkingBufferMinutes} min
                            </Text>
                          </View>
                          <TouchableOpacity
                            style={styles.fineStepPill}
                            onPress={() =>
                              setParkingBufferMinutes((p: number | null) => (p ?? 7) + 1)
                            }
                          >
                            <Ionicons
                              name="add"
                              size={14}
                              color="#ffffff"
                            />
                          </TouchableOpacity>
                        </View>
                      )}
                    </View>
                  </View>
                )}
              </View>

              {/* ── 3. TRATTA FERROVIARIA (PARTENZA & ARRIVO) ── */}
              <View style={styles.pillSection}>
                <Text style={styles.pillSectionLabel}>
                  STAZIONE DI PARTENZA
                </Text>
                <View style={styles.stationGrid}>
                  {quickDepartureStations.map((st: StationInfo) => {
                    const isSel = departureStation?.code === st.code;
                    return (
                      <TouchableOpacity
                        key={st.code}
                        style={[
                          styles.stationGridItem,
                          isSel && [
                            styles.chipActive,
                            {
                              backgroundColor: theme.bg,
                              borderColor: theme.primary,
                              shadowColor: theme.primary,
                            },
                          ],
                        ]}
                        activeOpacity={0.7}
                        onPress={() => setDepartureStation(st)}
                      >
                        <Ionicons
                          name={
                            isSel ? "checkmark-circle" : "train-outline"
                          }
                          size={14}
                          color={isSel ? "#ffffff" : "#8e8e93"}
                          style={{ marginRight: 5 }}
                        />
                        <Text
                          style={[
                            styles.chipText,
                            isSel && styles.chipTextActive,
                          ]}
                          numberOfLines={1}
                          adjustsFontSizeToFit
                          minimumFontScale={0.7}
                        >
                          {STATION_SHORT_NAMES[st.code] || st.shortName || st.name}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                  <TouchableOpacity
                    style={[
                      styles.stationGridItem,
                      isOtherDepartureSelected
                        ? [
                            styles.chipActive,
                            {
                              backgroundColor: theme.bg,
                              borderColor: theme.primary,
                              shadowColor: theme.primary,
                              borderStyle: "solid",
                            },
                          ]
                        : [
                            styles.stationGridItemDashed,
                            { borderColor: theme.primary },
                          ],
                    ]}
                    activeOpacity={0.7}
                    onPress={() => setStationPickerType("departure")}
                  >
                    <Ionicons
                      name={isOtherDepartureSelected ? "checkmark-circle" : "search"}
                      size={14}
                      color={isOtherDepartureSelected ? "#ffffff" : theme.accent}
                      style={{ marginRight: 5 }}
                    />
                    <Text
                      style={[
                        styles.chipText,
                        isOtherDepartureSelected
                          ? styles.chipTextActive
                          : { color: theme.accent, fontWeight: "600" },
                      ]}
                      numberOfLines={1}
                      adjustsFontSizeToFit
                      minimumFontScale={0.7}
                    >
                      {isOtherDepartureSelected
                        ? (STATION_SHORT_NAMES[departureStation?.code ?? ""] ||
                            departureStation?.shortName ||
                            departureStation?.name ||
                            "Altro...")
                        : "Altro..."}
                    </Text>
                  </TouchableOpacity>
                </View>

                <Text
                  style={[styles.pillSectionLabel, { marginTop: 18 }]}
                >
                  STAZIONE DI ARRIVO (ROMA)
                </Text>
                <View style={styles.stationGrid}>
                  {quickArrivalStations.map((st: StationInfo) => {
                    const isSel = arrivalStation?.code === st.code;
                    return (
                      <TouchableOpacity
                        key={st.code}
                        style={[
                          styles.stationGridItem,
                          isSel && [
                            styles.chipActive,
                            {
                              backgroundColor: theme.bg,
                              borderColor: theme.primary,
                              shadowColor: theme.primary,
                            },
                          ],
                        ]}
                        activeOpacity={0.7}
                        onPress={() => setArrivalStation(st)}
                      >
                        <Ionicons
                          name={
                            isSel ? "checkmark-circle" : "flag-outline"
                          }
                          size={14}
                          color={isSel ? "#ffffff" : "#8e8e93"}
                          style={{ marginRight: 5 }}
                        />
                        <Text
                          style={[
                            styles.chipText,
                            isSel && styles.chipTextActive,
                          ]}
                          numberOfLines={1}
                          adjustsFontSizeToFit
                          minimumFontScale={0.7}
                        >
                          {STATION_SHORT_NAMES[st.code] || st.shortName || st.name}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                  <TouchableOpacity
                    style={[
                      styles.stationGridItem,
                      isOtherArrivalSelected
                        ? [
                            styles.chipActive,
                            {
                              backgroundColor: theme.bg,
                              borderColor: theme.primary,
                              shadowColor: theme.primary,
                              borderStyle: "solid",
                            },
                          ]
                        : [
                            styles.stationGridItemDashed,
                            { borderColor: theme.primary },
                          ],
                    ]}
                    activeOpacity={0.7}
                    onPress={() => setStationPickerType("arrival")}
                  >
                    <Ionicons
                      name={isOtherArrivalSelected ? "checkmark-circle" : "search"}
                      size={14}
                      color={isOtherArrivalSelected ? "#ffffff" : theme.accent}
                      style={{ marginRight: 5 }}
                    />
                    <Text
                      style={[
                        styles.chipText,
                        isOtherArrivalSelected
                          ? styles.chipTextActive
                          : { color: theme.accent, fontWeight: "600" },
                      ]}
                      numberOfLines={1}
                      adjustsFontSizeToFit
                      minimumFontScale={0.7}
                    >
                      {isOtherArrivalSelected
                        ? (STATION_SHORT_NAMES[arrivalStation?.code ?? ""] ||
                            arrivalStation?.shortName ||
                            arrivalStation?.name ||
                            "Altro...")
                        : "Altro..."}
                    </Text>
                  </TouchableOpacity>
                </View>

                {/* Anteprima live distanza e tempi reali se auto=sì e origine+stazione scelte */}
                {carMode === "yes" &&
                  originAddress.trim().length >= 2 &&
                  departureStation && (
                    <View
                      style={[
                        styles.liveRoutePreviewPill,
                        {
                          backgroundColor: theme.cardTint,
                          borderColor: theme.border,
                        },
                      ]}
                    >
                      <Ionicons
                        name="car-sport"
                        size={16}
                        color={theme.accent}
                        style={{ marginRight: 8 }}
                      />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.liveRoutePreviewTitle}>
                          {originAddress} ➔{" "}
                          {STATION_SHORT_NAMES[departureStation.code] || departureStation.shortName ||
                            departureStation.name}
                        </Text>
                        <Text
                          style={[
                            styles.liveRoutePreviewStats,
                            { color: theme.accent },
                          ]}
                        >
                          {calculatingDriving
                            ? "Calcolo distanza e tempi reali in corso..."
                            : drivingEstimate
                              ? `${drivingEstimate.distanceKm || (drivingEstimate.distanceMeters ? (drivingEstimate.distanceMeters / 1000).toFixed(1) : 0)} km stradali • ~${drivingEstimate.durationMinutes} min • ${drivingEstimate.trafficCondition || "Viabilità attuale: traffico scorrevole"}`
                              : "Percorso stradale pronto"}
                        </Text>
                      </View>
                      {calculatingDriving && (
                        <ActivityIndicator
                          size="small"
                          color={theme.accent}
                        />
                      )}
                    </View>
                  )}
              </View>

              {/* ── 4. ANTICIPO DI SICUREZZA IN AULA ── */}
              <View style={styles.pillSection}>
                <Text style={styles.pillSectionLabel}>
                  ANTICIPO IN AULA
                </Text>
                <View style={styles.chipsContainer}>
                  {[5, 10, 15, 20].map((mins) => {
                    const isSel = bufferMinutes === mins;
                    return (
                      <TouchableOpacity
                        key={mins}
                        style={[
                          styles.chip,
                          isSel && [
                            styles.chipActive,
                            {
                              backgroundColor: theme.bg,
                              borderColor: theme.primary,
                              shadowColor: theme.primary,
                            },
                          ],
                        ]}
                        activeOpacity={0.7}
                        onPress={() => setBufferMinutes(mins)}
                      >
                        <Ionicons
                          name={
                            isSel ? "checkmark-circle" : "time-outline"
                          }
                          size={14}
                          color={isSel ? "#ffffff" : "#8e8e93"}
                          style={{ marginRight: 5 }}
                        />
                        <Text
                          style={[
                            styles.chipText,
                            isSel && styles.chipTextActive,
                          ]}
                        >
                          {mins} min
                        </Text>
                      </TouchableOpacity>
                    );
                  })}

                  {bufferMinutes !== null && (
                    <View style={styles.fineStepRow}>
                      <TouchableOpacity
                        style={styles.fineStepPill}
                        onPress={() =>
                          setBufferMinutes((b: number) =>
                            Math.max(1, (b ?? 10) - 1),
                          )
                        }
                      >
                        <Ionicons
                          name="remove"
                          size={14}
                          color="#ffffff"
                        />
                      </TouchableOpacity>
                      <View
                        style={[
                          styles.fineStepValuePill,
                          {
                            borderColor: theme.primary,
                            backgroundColor: theme.subtle,
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.fineStepValueText,
                            { color: theme.accent },
                          ]}
                        >
                          {bufferMinutes} min
                        </Text>
                      </View>
                      <TouchableOpacity
                        style={styles.fineStepPill}
                        onPress={() =>
                          setBufferMinutes((b: number) => (b ?? 10) + 1)
                        }
                      >
                        <Ionicons name="add" size={14} color="#ffffff" />
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              </View>
            </ScrollView>
          </View>
        </Animated.ScrollView>

        {/* Barra inferiore FISSA con animazione fluida delle due lineette */}
        <View style={styles.fixedBottomFooter}>
          <View style={styles.twoLinesContainer}>
            <Animated.View
              style={[
                styles.swipeLineIndicator,
                {
                  width: line1Width,
                  backgroundColor: line1Color,
                  shadowColor: theme.primary,
                  shadowOpacity: scrollX.interpolate({
                    inputRange: [0, screenWidth],
                    outputRange: [0.85, 0],
                    extrapolate: "clamp",
                  }),
                  shadowRadius: 6,
                },
              ]}
            />
            <Animated.View
              style={[
                styles.swipeLineIndicator,
                {
                  width: line2Width,
                  backgroundColor: line2Color,
                  shadowColor: theme.primary,
                  shadowOpacity: scrollX.interpolate({
                    inputRange: [0, screenWidth],
                    outputRange: [0, 0.85],
                    extrapolate: "clamp",
                  }),
                  shadowRadius: 6,
                },
              ]}
            />
          </View>

          <View style={styles.bottomFooterActionArea}>
            <Animated.View
              style={[
                styles.footerPage1Area,
                {
                  opacity: page1Opacity,
                  transform: [{ translateY: page1TranslateY }],
                },
              ]}
              pointerEvents={currentPage === 1 ? "auto" : "none"}
            >
              {isChannelSelectionComplete ? (
                <View style={styles.swipeHintRow}>
                  <Ionicons
                    name="chevron-forward-circle-outline"
                    size={18}
                    color={theme.primary}
                    style={{ marginRight: 6 }}
                  />
                  <Text style={[styles.swipeHintTextLocked, { color: theme.primary, opacity: 1 }]}>
                    Scorri per continuare
                  </Text>
                </View>
              ) : (
                <View style={styles.swipeHintRow}>
                  <Text style={styles.swipeHintTextLocked}>
                    {missingSelectionMessage}
                  </Text>
                </View>
              )}
            </Animated.View>

            <Animated.View
              style={[
                styles.footerPage2Area,
                {
                  opacity: page2Opacity,
                  transform: [{ translateY: page2TranslateY }],
                },
              ]}
              pointerEvents={currentPage === 2 ? "auto" : "none"}
            >
              <NativeActionButton
                label="Configura più tardi"
                onPress={() => finalizeOnboarding(false)}
                variant="glass"
                glow={false}
                style={{ flex: 1 }}
                textStyle={{ fontSize: 13, fontWeight: "700" }}
              />

              <NativeActionButton
                label="Salva"
                onPress={() => finalizeOnboarding(true)}
                disabled={!isCommuterFormComplete}
                accentColor={theme.primary}
                glow={true}
                icon={
                  <Ionicons
                    name="checkmark-circle"
                    size={17}
                    color={isCommuterFormComplete ? "#ffffff" : "#52525b"}
                  />
                }
                style={{ flex: 1 }}
              />
            </Animated.View>
          </View>
        </View>
      </KeyboardAvoidingView>

      {/* ── SELEZIONE STAZIONI CON NativeSheetModal (headerSearchBarOptions nativo) ── */}
      <NativeSheetModal
        visible={stationPickerType !== null}
        onClose={() => {
          setStationPickerType(null);
          setStationSearchQuery("");
        }}
        title={
          stationPickerType === "departure"
            ? "Stazione di partenza"
            : "Stazione di arrivo"
        }
        backgroundColor="#16181d"
        searchBarOptions={{
          placeholder: "Cerca tra tutte le stazioni italiane...",
          textColor: "#ffffff",
          tintColor: theme.primary,
          headerIconColor: "#8e8e93",
          hintTextColor: "#71717a",
          autoCapitalize: "none",
          autoFocus: true,
          onChangeText: (e: any) => handleStationSearchChange(e.nativeEvent.text),
          onCancelButtonPress: () => handleStationSearchChange(""),
        }}
      >
        <View collapsable={false} style={{ flex: 1, width: "100%" }}>
          <View
            collapsable={false}
            style={{
              width: "100%",
              paddingHorizontal: 16,
              paddingTop: 8,
              paddingBottom: 6,
            }}
          >
            {searchingStations && (
              <ActivityIndicator
                size="small"
                color={theme.primary}
                style={{ marginVertical: 6 }}
              />
            )}
            <Text style={styles.stationCountHeader}>
              {stationSearchQuery.trim()
                ? `RISULTATI RICERCA (${stationResults.length})`
                : `TUTTE LE STAZIONI ITALIANE (${stationResults.length})`}
            </Text>
          </View>
          <FlatList
            data={stationResults}
            keyExtractor={(st) => `${st.code}_${st.name}`}
            style={{ flex: 1, width: "100%" }}
            contentContainerStyle={{
              paddingHorizontal: 16,
              paddingBottom: 36,
            }}
            keyboardShouldPersistTaps="handled"
            contentInsetAdjustmentBehavior="never"
            initialNumToRender={25}
            maxToRenderPerBatch={30}
            windowSize={10}
            renderItem={({ item: st }) => (
              <TouchableOpacity
                style={styles.stationListItem}
                activeOpacity={0.75}
                onPress={() => selectStationFromSearch(st)}
              >
                <View
                  style={[
                    styles.stationIconBadge,
                    { backgroundColor: theme.subtle },
                  ]}
                >
                  <Ionicons name="train" size={16} color={theme.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.stationRowName}>
                    {st.shortName || st.name}
                  </Text>
                  <Text style={styles.stationRowCode}>
                    Codice RFI: {st.code}
                  </Text>
                </View>
                <Ionicons
                  name="chevron-forward"
                  size={18}
                  color="#71717a"
                />
              </TouchableOpacity>
            )}
          />
        </View>
      </NativeSheetModal>
    </View>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// COMPONENTE PRINCIPALE ONBOARDING (Stack Nativo Indipendente)
// ═══════════════════════════════════════════════════════════════════════════
interface OnboardingCourseSelectorProps {
  onComplete: () => void;
}

export function OnboardingCourseSelector({
  onComplete,
}: OnboardingCourseSelectorProps) {
  const { theme } = useTheme();
  const { width: screenWidth } = useWindowDimensions();
  const pagerRef = useRef<ScrollView>(null);
  const [scrollX] = useState(() => new Animated.Value(0));
  const [downloadFadeAnim] = useState(() => new Animated.Value(0));
  const [downloadScaleAnim] = useState(() => new Animated.Value(0.94));

  const [degrees, setDegrees] = useState<Degree[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [progressText, setProgressText] = useState("");
  const [currentDegreeName, setCurrentDegreeName] = useState("");

  const [syncCodeInput, setSyncCodeInput] = useState("");  const [isLinkingSync, setIsLinkingSync] = useState(false);

  const [currentPage, setCurrentPage] = useState<1 | 2>(1);

  const [downloadedDegreeUrl, setDownloadedDegreeUrl] = useState<string | null>(
    null,
  );
  const [downloadedTabs, setDownloadedTabs] = useState<Tab[]>([]);
  const [pendingDegree, setPendingDegree] = useState<Degree | null>(null);

  const [selectedYear, setSelectedYear] = useState<string>("");
  const [selectedChannel, setSelectedChannel] = useState<string>("");

  const [originAddress, setOriginAddress] = useState<string>("");
  const [originCoords, setOriginCoords] = useState<
    { lat: number; lon: number } | undefined
  >(undefined);
  const [carMode, setCarMode] = useState<"yes" | "no" | null>(null);
  const [parkingBufferMinutes, setParkingBufferMinutes] = useState<
    number | null
  >(null);
  const [departureStation, setDepartureStation] = useState<StationInfo | null>(
    null,
  );
  const [arrivalStation, setArrivalStation] = useState<StationInfo | null>(
    null,
  );
  const [bufferMinutes, setBufferMinutes] = useState<number | null>(null);

  const [stationPickerType, setStationPickerType] = useState<
    "departure" | "arrival" | null
  >(null);
  const [stationSearchQuery, setStationSearchQuery] = useState("");
  const [stationResults, setStationResults] =
    useState<StationInfo[]>(ALL_STATIONS);
  const [searchingStations, setSearchingStations] = useState(false);
  const [drivingEstimate, setDrivingEstimate] =
    useState<DrivingEstimate | null>(null);
  const [calculatingDriving, setCalculatingDriving] = useState(false);
  const [placeSuggestions, setPlaceSuggestions] = useState<PlaceSuggestion[]>(
    [],
  );
  const [searchingPlaces, setSearchingPlaces] = useState(false);
  const [placeSearchActive, setPlaceSearchActive] = useState(false);

  const quickDepartureStations = useMemo(
    () =>
      QUICK_DEPARTURE_CODES.map(
        (c) =>
          ALL_STATIONS.find((s) => s.code === c) ||
          POPULAR_STATIONS.find((s) => s.code === c),
      ).filter(Boolean) as StationInfo[],
    [],
  );

  const quickArrivalStations = useMemo(
    () =>
      QUICK_ARRIVAL_CODES.map(
        (c) =>
          ALL_STATIONS.find((s) => s.code === c) ||
          POPULAR_STATIONS.find((s) => s.code === c),
      ).filter(Boolean) as StationInfo[],
    [],
  );

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const degList = await fetchDegrees();
        setDegrees(degList);
      } catch (e) {
        console.error("Errore caricamento corsi:", e);
      }
      setLoading(false);
    }
    load();
  }, []);

  const parsedTabs = useMemo(
    () => parseTabHierarchy(downloadedTabs),
    [downloadedTabs],
  );

  const uniqueYears = useMemo(() => {
    const years: string[] = [];
    parsedTabs.forEach((p) => {
      if (p.year && !years.includes(p.year)) {
        years.push(p.year);
      }
    });
    return years;
  }, [parsedTabs]);

  const effectiveYearForChannels = useMemo(() => {
    if (selectedYear) return selectedYear;
    return uniqueYears[0] || "";
  }, [selectedYear, uniqueYears]);

  const channelsToDisplay = useMemo(() => {
    if (!effectiveYearForChannels) return parsedTabs;
    return parsedTabs.filter((p) => p.year === effectiveYearForChannels);
  }, [parsedTabs, effectiveYearForChannels]);

  const hasMultipleYears = uniqueYears.length > 1;
  const hasMultipleChannels = channelsToDisplay.length > 1;

  const isChannelSelectionComplete = useMemo(() => {
    if (downloadedTabs.length <= 1) return true;
    if (hasMultipleYears && !selectedYear) return false;
    if (hasMultipleChannels && !selectedChannel) return false;
    return true;
  }, [
    downloadedTabs.length,
    hasMultipleYears,
    selectedYear,
    hasMultipleChannels,
    selectedChannel,
  ]);

  const resolvedTab = useMemo(() => {
    if (!isChannelSelectionComplete) return null;
    if (downloadedTabs.length === 1) return downloadedTabs[0];
    const targetYear = selectedYear || uniqueYears[0] || "";
    const yearTabs = parsedTabs.filter((p) => p.year === targetYear);
    const match = yearTabs.find(
      (p) => (p.channel || p.tab.name) === selectedChannel,
    );
    return match?.tab || yearTabs[0]?.tab || parsedTabs[0]?.tab || null;
  }, [
    isChannelSelectionComplete,
    downloadedTabs,
    selectedYear,
    uniqueYears,
    parsedTabs,
    selectedChannel,
  ]);

  const isCommuterFormComplete = useMemo(() => {
    const hasOrigin = originAddress.trim().length >= 2;
    const hasCarChoice =
      carMode === "no" || (carMode === "yes" && parkingBufferMinutes !== null);
    const hasStations = departureStation !== null && arrivalStation !== null;
    const hasBuffer = bufferMinutes !== null;
    return hasOrigin && hasCarChoice && hasStations && hasBuffer;
  }, [
    originAddress,
    carMode,
    parkingBufferMinutes,
    departureStation,
    arrivalStation,
    bufferMinutes,
  ]);

  useEffect(() => {
    if (
      !pendingDegree ||
      carMode !== "yes" ||
      originAddress.trim().length < 2 ||
      !departureStation
    ) {
      return;
    }
    let cancelled = false;
    const fetchDriveEstimate = async () => {
      setCalculatingDriving(true);
      try {
        const est = await calculateDrivingEstimate(
          originAddress,
          departureStation.shortName || departureStation.name,
          undefined,
          originCoords,
        );
        if (!cancelled) {
          setDrivingEstimate(est);
        }
      } catch {}
      if (!cancelled) setCalculatingDriving(false);
    };
    const timer = setTimeout(fetchDriveEstimate, 320);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [pendingDegree, carMode, originAddress, originCoords, departureStation]);

  useEffect(() => {
    if (!placeSearchActive || originAddress.trim().length < 3) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setSearchingPlaces(true);
      const results = await searchPlaces(originAddress, controller.signal);
      if (!controller.signal.aborted) {
        setPlaceSuggestions(results);
        setSearchingPlaces(false);
      }
    }, 320);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [originAddress, placeSearchActive]);

  const handleSelectDegree = async (degree: Degree, nav?: any) => {
    if (
      downloadedDegreeUrl === degree.url &&
      pendingDegree?.url === degree.url
    ) {
      setCurrentPage(1);
      scrollX.setValue(0);
      nav?.navigate("PostDownload");
      setTimeout(() => {
        pagerRef.current?.scrollTo({ x: 0, animated: false });
      }, 30);
      return;
    }

    setCurrentDegreeName(degree.name);
    setPendingDegree(degree);
    setDownloading(true);
    setProgressText("Preparazione e analisi canali...");
    downloadFadeAnim.setValue(0);
    downloadScaleAnim.setValue(0.94);
    Animated.parallel([
      Animated.timing(downloadFadeAnim, {
        toValue: 1,
        duration: 320,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.spring(downloadScaleAnim, {
        toValue: 1,
        friction: 8,
        tension: 40,
        useNativeDriver: true,
      }),
    ]).start();

    try {
      const { tabs } = await fetchAllCourseData(degree.url, true, (stepMsg) => {
        setProgressText(stepMsg);
      });

      const safeTabs = tabs || [];
      setDownloadedDegreeUrl(degree.url);
      setDownloadedTabs(safeTabs);

      const hierarchy = parseTabHierarchy(safeTabs);
      const years: string[] = [];
      hierarchy.forEach((p) => {
        if (p.year && !years.includes(p.year)) years.push(p.year);
      });

      setSelectedYear(years.length === 1 ? years[0] : "");
      const refYear = years[0] || "";
      const refChannels = hierarchy.filter((p) => p.year === refYear);
      setSelectedChannel(
        refChannels.length === 1
          ? refChannels[0].channel || refChannels[0].tab.name
          : "",
      );

      Animated.timing(downloadFadeAnim, {
        toValue: 0,
        duration: 220,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }).start(() => {
        setDownloading(false);
        setCurrentPage(1);
        scrollX.setValue(0);
        nav?.navigate("PostDownload");
        setTimeout(() => {
          pagerRef.current?.scrollTo({ x: 0, animated: false });
        }, 40);
      });
    } catch (err) {
      console.error("Errore durante download iniziale:", err);
      Animated.timing(downloadFadeAnim, {
        toValue: 0,
        duration: 180,
        useNativeDriver: true,
      }).start(() => {
        setDownloading(false);
      });
      Alert.alert(
        "Errore di Connessione",
        "Impossibile scaricare i dati del corso dal sito Sapienza. Controlla la tua connessione e riprova.",
        [{ text: "OK" }],
      );
    }
  };

  const handleSelectYear = (year: string) => {
    setSelectedYear(year);
    const available = parsedTabs.filter((p) => p.year === year);
    if (available.length === 1) {
      setSelectedChannel(available[0].channel || available[0].tab.name);
    } else if (selectedChannel) {
      const sameCh = available.find(
        (p) => (p.channel || p.tab.name) === selectedChannel,
      );
      setSelectedChannel(sameCh ? sameCh.channel || sameCh.tab.name : "");
    }
  };

  const handleSelectChannel = (channelValue: string) => {
    setSelectedChannel(channelValue);
  };

  const handlePagerScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offsetX = e.nativeEvent.contentOffset.x;
    const page = Math.round(offsetX / screenWidth) === 1 ? 2 : 1;
    if (page !== currentPage) {
      setCurrentPage(page);
    }
  };

  const finalizeOnboarding = async (enableCommuter: boolean) => {
    if (!pendingDegree) return;
    try {
      if (
        enableCommuter &&
        isCommuterFormComplete &&
        departureStation &&
        arrivalStation
      ) {
        await saveCommuterConfig({
          ...DEFAULT_COMMUTER_CONFIG,
          enabled: true,
          originAddress: originAddress.trim(),
          originCoords,
          carLeg: {
            ...DEFAULT_COMMUTER_CONFIG.carLeg,
            enabled: carMode === "yes",
            parkingBufferMinutes: parkingBufferMinutes || 15,
            durationMinutes: drivingEstimate?.durationMinutes || 0,
            distanceKm: drivingEstimate ? drivingEstimate.distanceKm : undefined,
          },
          departureStation,
          arrivalStation,
          bufferMinutes: bufferMinutes ?? 15,
        });
      }

      await AsyncStorage.setItem("selectedDegreeName", pendingDegree.name);
      await AsyncStorage.setItem("selectedDegreeUrl", pendingDegree.url);

      if (downloadedTabs.length > 0) {
        await AsyncStorage.setItem(
          "cachedCourseData",
          JSON.stringify(downloadedTabs),
        );
      }

      if (resolvedTab) {
        await AsyncStorage.setItem(
          "selectedTabInfo",
          JSON.stringify(resolvedTab),
        );
      }

      await AsyncStorage.setItem(
        "hasCompletedInitialCourseSelection",
        "true",
      );

      onComplete();
    } catch (err) {
      console.error("Errore salvataggio configurazione iniziale:", err);
      Alert.alert("Errore", "Impossibile salvare la configurazione.");
    }
  };

  const handleStationSearchChange = async (query: string) => {
    setStationSearchQuery(query);
    if (!query.trim()) {
      setStationResults(ALL_STATIONS);
      return;
    }
    setSearchingStations(true);
    const filtered = await searchStations(query);
    setStationResults(filtered);
    setSearchingStations(false);
  };

  const selectStationFromSearch = (station: StationInfo) => {
    if (stationPickerType === "departure") {
      setDepartureStation(station);
    } else if (stationPickerType === "arrival") {
      setArrivalStation(station);
    }
    setStationPickerType(null);
    setStationSearchQuery("");
  };

  const handleSelectPlaceSuggestion = (item: PlaceSuggestion) => {
    setOriginAddress(item.label);
    setOriginCoords({ lat: item.lat, lon: item.lon });
    setPlaceSearchActive(false);
  };

  const handleLinkFromCloud = async () => {
    if (!syncCodeInput.trim() || !isValidSyncCode(syncCodeInput.trim())) {
      Alert.alert(
        "Codice Non Valido",
        "Inserisci un codice di sincronizzazione valido generato dall'altro dispositivo.",
      );
      return;
    }
    setIsLinkingSync(true);
    try {
      const res = await linkDeviceWithCode(syncCodeInput.trim().toUpperCase());
      if (res.success) {
        await AsyncStorage.setItem(
          "hasCompletedInitialCourseSelection",
          "true",
        );
        Alert.alert(
          "Sincronizzazione Riuscita",
          "Il dispositivo è stato associato con successo!",
          [{ text: "Inizia", onPress: () => onComplete() }],
        );
      } else {
        Alert.alert("Associazione Non Riuscita", res.message);
      }
    } catch (err: any) {
      Alert.alert(
        "Errore",
        err?.message || "Impossibile associare il dispositivo.",
      );
    } finally {
      setIsLinkingSync(false);
    }
  };

  const handlePasteSyncCode = async () => {
    try {
      const text = await Clipboard.getStringAsync();
      if (text && text.trim()) {
        const clean = text.trim();
        if (clean.includes("code=")) {
          const match = clean.match(/code=([^&]+)/);
          if (match && match[1]) {
            setSyncCodeInput(decodeURIComponent(match[1]));
            return;
          }
        }
        setSyncCodeInput(clean);
      }
    } catch {}
  };

  const filteredDegrees = degrees.filter(
    (d) =>
      d.name.toLowerCase().includes(search.toLowerCase()) ||
      (d.className && d.className.toLowerCase().includes(search.toLowerCase())),
  );

  const missingSelectionMessage = useMemo(() => {
    const missingYear = hasMultipleYears && !selectedYear;
    const missingChannel = hasMultipleChannels && !selectedChannel;
    if (missingYear && missingChannel) {
      return "Non puoi andare avanti senza selezionare anno e canale";
    }
    if (missingYear) {
      return "Non puoi andare avanti senza selezionare l'anno di corso";
    }
    if (missingChannel) {
      return "Non puoi andare avanti senza selezionare il canale";
    }
    return "";
  }, [hasMultipleYears, selectedYear, hasMultipleChannels, selectedChannel]);

  const navTheme = useMemo(
    () => ({
      ...DarkTheme,
      colors: {
        ...DarkTheme.colors,
        background: "#111111",
        card: "#111111",
        text: "#ffffff",
        primary: theme.primary,
      },
    }),
    [theme.primary],
  );

  const contextValue = {
    theme,
    syncCodeInput,
    setSyncCodeInput,
    handlePasteSyncCode,
    handleLinkFromCloud,
    isLinkingSync,
    loading,
    search,
    setSearch,
    filteredDegrees,
    handleSelectDegree,
    pendingDegree,
    hasMultipleYears,
    uniqueYears,
    selectedYear,
    handleSelectYear,
    hasMultipleChannels,
    channelsToDisplay,
    selectedChannel,
    handleSelectChannel,
    isChannelSelectionComplete,
    missingSelectionMessage,
    resolvedTab,
    originAddress,
    setOriginAddress,
    setOriginCoords,
    placeSuggestions,
    setPlaceSuggestions,
    searchingPlaces,
    placeSearchActive,
    setPlaceSearchActive,
    handleSelectPlaceSuggestion,
    carMode,
    setCarMode,
    parkingBufferMinutes,
    setParkingBufferMinutes,
    drivingEstimate,
    calculatingDriving,
    departureStation,
    arrivalStation,
    setDepartureStation,
    setArrivalStation,
    stationPickerType,
    setStationPickerType,
    quickDepartureStations,
    quickArrivalStations,
    stationSearchQuery,
    setStationSearchQuery,
    stationResults,
    searchingStations,
    handleStationSearchChange,
    selectStationFromSearch,
    bufferMinutes,
    setBufferMinutes,
    isCommuterFormComplete,
    finalizeOnboarding,
    currentPage,
    setCurrentPage,
    scrollX,
    pagerRef,
    handlePagerScroll,
    screenWidth,
  };

  return (
    <View style={{ flex: 1, backgroundColor: "#111111" }}>
      <OnboardingContext.Provider value={contextValue}>
        <NavigationIndependentTree>
          <NavigationContainer theme={navTheme}>
            <OnboardingStack.Navigator
              screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: "#111111" },
                headerStyle: { backgroundColor: "#111111" },
                headerShadowVisible: false,
                headerBackButtonDisplayMode: "minimal",
                headerBackTitle: "",
              }}
            >
              <OnboardingStack.Screen name="Welcome" component={WelcomeScreen} />
              <OnboardingStack.Screen
                name="SetupMode"
                component={SetupModeScreen}
                options={{
                  headerShown: true,
                  headerTitle: "",
                  headerTransparent: true,
                  headerShadowVisible: false,
                  headerBackButtonDisplayMode: "minimal",
                  headerBackTitle: "",
                  headerTintColor: "#ffffff",
                  headerStyle: { backgroundColor: "transparent" },
                }}
              />
              <OnboardingStack.Screen
                name="CourseSelect"
                component={CourseSelectScreen}
                options={{
                  headerShown: true,
                  headerLargeTitle: false,
                  headerTitle: "Scegli il tuo corso",
                  headerTitleStyle: {
                    color: "#ffffff",
                    fontSize: 17,
                    fontWeight: "600",
                  },
                  headerStyle: {
                    backgroundColor: "transparent",
                  },
                  headerTransparent: true,
                  headerTintColor: "#ffffff",
                  headerShadowVisible: false,
                  headerBackButtonDisplayMode: "minimal",
                  headerBackTitle: "",
                  headerSearchBarOptions: isNativeIos
                    ? {
                        placeholder: "Cerca corso o classe (es. Informatica, L-8)...",
                        placement: "stacked",
                        allowToolbarIntegration: false,
                        hideWhenScrolling: false,
                        autoCapitalize: "none",
                        tintColor: theme.primary,
                        textColor: "#ffffff",
                        headerIconColor: "#8e8e93",
                        hintTextColor: "#71717a",
                        barTintColor: "rgba(255, 255, 255, 0.08)",
                        onChangeText: (e: any) => setSearch(e.nativeEvent.text),
                        onCancelButtonPress: () => setSearch(""),
                      }
                    : undefined,
                }}
              />
              <OnboardingStack.Screen
                name="Sync"
                component={SyncScreen}
                options={{
                  headerShown: true,
                  headerTitle: "Sincronizzazione",
                  headerLargeTitle: false,
                  headerStyle: { backgroundColor: "#111111" },
                  headerTintColor: "#ffffff",
                  headerShadowVisible: false,
                  headerBackButtonDisplayMode: "minimal",
                  headerBackTitle: "",
                }}
              />
              <OnboardingStack.Screen name="PostDownload" component={PostDownloadScreen} />
            </OnboardingStack.Navigator>
          </NavigationContainer>
        </NavigationIndependentTree>
      </OnboardingContext.Provider>

      {/* Overlay Download Unificato con animazione fluida */}
      {downloading && (
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            {
              opacity: downloadFadeAnim,
              transform: [{ scale: downloadScaleAnim }],
            },
          ]}
        >
          <CourseDownloadView
            courseName={currentDegreeName}
            progressText={progressText}
            title="Configurazione in corso"
          />
        </Animated.View>
      )}
    </View>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// STILI GRAFICI: Pill arrotondate a capsula / stadium, glowing neon e centrati
// ═══════════════════════════════════════════════════════════════════════════
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#111111",
  },
  screenRoot: {
    flex: 1,
    backgroundColor: "#111111",
  },

  /* ── Stili Welcome Minimal ── */
  cleanWelcomeContainer: {
    flex: 1,
    paddingHorizontal: 32,
    justifyContent: "space-between",
    alignItems: "center",
    paddingTop: Platform.OS === "ios" ? 40 : 28,
    paddingBottom: Platform.OS === "ios" ? 28 : 24,
  },
  cleanWelcomeCenter: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    maxWidth: 340,
  },
  cleanLogoWrapper: {
    position: "relative",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 28,
  },
  cleanLogoGlow: {
    position: "absolute",
    width: 140,
    height: 140,
    borderRadius: 70,
    opacity: 0.16,
  },
  cleanAppTitle: {
    fontSize: 34,
    fontWeight: "900",
    color: "#ffffff",
    letterSpacing: -0.5,
  },
  cleanAppSubtitle: {
    fontSize: 16,
    fontWeight: "700",
    marginTop: 4,
    letterSpacing: 0.2,
  },
  cleanAppDesc: {
    fontSize: 14,
    color: "#a1a1aa",
    textAlign: "center",
    lineHeight: 21,
    marginTop: 14,
    paddingHorizontal: 8,
  },
  cleanWelcomeFooter: {
    width: "100%",
    alignItems: "center",
    paddingBottom: 8,
  },

  /* ── Segmented Control / Tabs ── */
  nativeSegmentedWrapper: {
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 8,
    backgroundColor: "transparent",
  },
  nativeSegmentedControl: {
    height: 36,
    backgroundColor: "rgba(255, 255, 255, 0.08)",
  },
  modeSelectorContainer: {
    flexDirection: "row",
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 8,
    gap: 10,
    backgroundColor: "transparent",
  },
  modeTab: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: "#18181b",
    borderWidth: 1,
    borderColor: "#27272a",
  },
  modeTabActive: {
    borderWidth: 1.5,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 6,
    elevation: 3,
  },
  modeTabText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#a1a1aa",
  },
  modeTabTextActive: {
    color: "#ffffff",
    fontWeight: "700",
  },

  /* ── Sync Form ── */
  syncContainer: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  syncCard: {
    padding: 24,
    borderRadius: 22,
    borderWidth: 1,
    alignItems: "center",
  },
  syncIconCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 16,
  },
  syncCardTitle: {
    fontSize: 20,
    fontWeight: "800",
    color: "#ffffff",
    marginBottom: 8,
  },
  syncCardDesc: {
    fontSize: 13.5,
    color: "#a1a1aa",
    textAlign: "center",
    lineHeight: 19,
    marginBottom: 20,
  },
  syncInputWrapper: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 22,
    borderWidth: 1,
    width: "100%",
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  syncInput: {
    flex: 1,
    height: 48,
    fontSize: 15,
    fontWeight: "700",
    color: "#ffffff",
    letterSpacing: 1,
  },
  syncPasteBtn: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    marginLeft: 8,
  },
  syncPasteBtnText: {
    fontSize: 12,
    fontWeight: "700",
    marginLeft: 4,
  },
  syncSubmitBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
    height: 48,
    borderRadius: 24,
  },
  syncSubmitBtnText: {
    fontSize: 15,
    fontWeight: "800",
    color: "#ffffff",
  },

  /* ── Course List Screen ── */
  scrollList: {
    flex: 1,
    paddingHorizontal: 16,
  },
  centerContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: 60,
  },
  loadingText: {
    color: "#8e8e93",
    fontSize: 13,
    marginTop: 12,
  },
  emptyContainer: {
    alignItems: "center",
    paddingVertical: 60,
  },
  emptyText: {
    color: "#8e8e93",
    fontSize: 14,
    marginTop: 10,
  },
  modalItem: {
    backgroundColor: "#1c1c1e",
    padding: 14,
    borderRadius: 16,
    marginBottom: 10,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#27272a",
  },
  courseIconBox: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: "#2c2c2e",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 14,
  },
  modalItemTitle: {
    color: "#f4f4f5",
    fontSize: 15,
    fontWeight: "600",
    marginBottom: 6,
  },
  courseBadgesRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    overflow: "visible",
    paddingVertical: 2,
  },
  typeBadge: {
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.65,
    shadowRadius: 6,
    elevation: 4,
  },
  typeBadgeText: {
    fontSize: 11,
    fontWeight: "700",
  },
  classBadge: {
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.75,
    shadowRadius: 6,
    elevation: 4,
  },
  classBadgeText: {
    fontSize: 11,
    fontWeight: "700",
  },

  /* ── Header Schermate Post-Download ── */
  channelScrollContent: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 110,
  },
  travelInitScrollContent: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 110,
  },
  stationGridItemDashed: {
    borderStyle: "dashed",
    borderWidth: 1.5,
    backgroundColor: "transparent",
  },
  channelHeroHeader: {
    alignItems: "center",
    marginBottom: 20,
    marginTop: 4,
  },
  channelIconCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 12,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 6,
  },
  channelHeroTitle: {
    fontSize: 22,
    fontWeight: "800",
    color: "#ffffff",
    letterSpacing: -0.4,
  },
  channelDegreeTitle: {
    fontSize: 15,
    fontWeight: "700",
    textAlign: "center",
    marginTop: 4,
    paddingHorizontal: 16,
  },
  channelHeroSubtitle: {
    fontSize: 13,
    color: "#a1a1aa",
    textAlign: "center",
    marginTop: 6,
    lineHeight: 18,
    paddingHorizontal: 20,
  },

  /* ── Sezioni e Glowing Chips (Arrotondati a Capsula e Centrati) ── */
  pillSection: {
    marginBottom: 20,
  },
  pillSectionLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: "#71717a",
    letterSpacing: 0.8,
    marginBottom: 12,
    textAlign: "center",
    textTransform: "uppercase",
  },
  chipsContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    alignItems: "center",
    gap: 8,
    overflow: "visible",
    paddingVertical: 4,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1c1c1e",
    paddingHorizontal: 14,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#2c2c2e",
    justifyContent: "center",
  },
  chipActive: {
    borderWidth: 1.5,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 8,
    elevation: 4,
  },
  chipText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#a1a1aa",
  },
  chipTextActive: {
    fontWeight: "700",
    color: "#ffffff",
  },
  channelRowEqual: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 10,
    width: "100%",
  },
  chipEqual: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#1c1c1e",
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#2c2c2e",
    paddingHorizontal: 12,
  },
  stationGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    rowGap: 8,
    width: "100%",
  },
  stationGridItem: {
    width: "48.5%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#1c1c1e",
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#2c2c2e",
    paddingHorizontal: 6,
  },
  stationActionPill: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#1c1c1e",
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#3f3f46",
    borderStyle: "dashed",
    paddingHorizontal: 12,
    marginTop: 8,
  },
  subPillGroup: {
    marginTop: 14,
    alignItems: "center",
  },
  subPillLabel: {
    fontSize: 10.5,
    fontWeight: "700",
    color: "#71717a",
    letterSpacing: 0.8,
    marginBottom: 8,
    textAlign: "center",
  },
  fineStepRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginLeft: 4,
  },
  fineStepPill: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#27272a",
    borderWidth: 1,
    borderColor: "#3f3f46",
    justifyContent: "center",
    alignItems: "center",
  },
  fineStepValuePill: {
    paddingHorizontal: 12,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  fineStepValueText: {
    fontSize: 12,
    fontWeight: "700",
  },

  /* ── Summary Card & Prompt Card ── */
  summaryCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255, 255, 255, 0.03)",
    borderRadius: 20,
    padding: 14,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
    marginTop: 6,
  },
  summaryIconBox: {
    width: 44,
    height: 44,
    borderRadius: 14,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    marginRight: 12,
  },
  summaryOverline: {
    fontSize: 10.5,
    fontWeight: "800",
    color: "#71717a",
    letterSpacing: 0.6,
  },
  summaryValue: {
    fontSize: 15,
    fontWeight: "700",
    color: "#ffffff",
    marginTop: 1,
  },
  summaryOriginalName: {
    fontSize: 11.5,
    color: "#71717a",
    marginTop: 2,
  },
  promptSelectCard: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 18,
    paddingHorizontal: 16,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.06)",
    backgroundColor: "rgba(255, 255, 255, 0.02)",
    marginTop: 6,
  },
  promptSelectText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#71717a",
    textAlign: "center",
  },

  /* ── Pill Input Indirizzo Partenza (Capsula Arrotondata) ── */
  iosPillInputWrapper: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1c1c1e",
    borderRadius: 22,
    borderWidth: 1.2,
    borderColor: "#2c2c2e",
    paddingHorizontal: 16,
    height: 44,
  },
  iosPillInput: {
    flex: 1,
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "500",
  },
  suggestionsBox: {
    marginTop: 8,
    backgroundColor: "#18181b",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#2c2c2e",
    overflow: "hidden",
  },
  suggestionRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255, 255, 255, 0.08)",
  },
  suggestionTitle: {
    color: "#ffffff",
    fontSize: 13.5,
    fontWeight: "600",
  },
  suggestionSub: {
    color: "#94a3b8",
    fontSize: 11.5,
    marginTop: 1,
  },

  /* ── Live Route Preview Pill ── */
  liveRoutePreviewPill: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 20,
    borderWidth: 1,
  },
  liveRoutePreviewTitle: {
    color: "#ffffff",
    fontSize: 12.5,
    fontWeight: "700",
  },
  liveRoutePreviewStats: {
    fontSize: 11.5,
    fontWeight: "600",
    marginTop: 2,
  },

  /* ── Fixed Bottom Footer con Indicatori Fluidi ── */
  fixedBottomFooter: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: Platform.OS === "ios" ? 22 : 16,
    backgroundColor: "#111111",
    borderTopWidth: 0,
    alignItems: "center",
  },
  twoLinesContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginBottom: 16,
  },
  swipeLineIndicator: {
    height: 4.5,
    borderRadius: 3,
  },
  bottomFooterActionArea: {
    width: "100%",
    minHeight: 44,
    justifyContent: "center",
    alignItems: "center",
  },
  footerPage1Area: {
    position: "absolute",
    left: 0,
    right: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  footerPage2Area: {
    position: "absolute",
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  swipeHintRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  swipeHintTextActive: {
    fontSize: 12.5,
    fontWeight: "700",
    textAlign: "center",
  },
  swipeHintTextLocked: {
    fontSize: 12,
    fontWeight: "600",
    color: "#71717a",
    textAlign: "center",
  },
  laterBtnPill: {
    flex: 1,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#1c1c1e",
    borderWidth: 1,
    borderColor: "#2c2c2e",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 12,
  },
  laterBtnPillText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#a1a1aa",
  },

  /* ── Stili Stazioni per NativeSheetModal ── */
  stationListItem: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255, 255, 255, 0.04)",
    padding: 13,
    borderRadius: 18,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
  },
  stationIconBadge: {
    width: 34,
    height: 34,
    borderRadius: 10,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  stationRowName: {
    fontSize: 15,
    fontWeight: "700",
    color: "#ffffff",
  },
  stationRowCode: {
    fontSize: 11.5,
    color: "#94a3b8",
    marginTop: 2,
  },
  stationCountHeader: {
    fontSize: 11,
    fontWeight: "800",
    color: "#71717a",
    letterSpacing: 0.6,
    paddingHorizontal: 4,
    marginBottom: 10,
    marginTop: 4,
  },

  /* ── Setup Mode Screen ── */
  setupModeTopBar: {
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  setupModeBackBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    justifyContent: "center",
    alignItems: "center",
  },
  setupModeContainer: {
    flex: 1,
    paddingHorizontal: 24,
    justifyContent: "center",
  },
  setupModeHeader: {
    alignItems: "center",
    marginBottom: 32,
  },
  setupModeTitle: {
    fontSize: 28,
    fontWeight: "800",
    color: "#ffffff",
    letterSpacing: -0.5,
    textAlign: "center",
  },
  setupModeSubtitle: {
    fontSize: 14,
    color: "#71717a",
    marginTop: 8,
    textAlign: "center",
  },
  setupModeCards: {
    gap: 14,
  },
  setupModeCard: {
    backgroundColor: "#18181b",
    borderRadius: 18,
    borderWidth: 1,
    padding: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  setupModeCardLeft: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    gap: 16,
  },
  setupModeIconCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 1,
    justifyContent: "center",
    alignItems: "center",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 10,
    elevation: 4,
  },
  setupModeCardTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#ffffff",
    marginBottom: 4,
  },
  setupModeCardSubtitle: {
    fontSize: 13,
    color: "#71717a",
    lineHeight: 18,
  },

  /* ── Expo Go fallback search bar ── */
  expoSearchWrapper: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.12)",
    marginHorizontal: 16,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  expoSearchInput: {
    flex: 1,
    color: "#ffffff",
    fontSize: 15,
  },
});
