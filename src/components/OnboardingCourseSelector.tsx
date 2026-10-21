import { useTheme } from "@/context/ThemeContext";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import SegmentedControl from "@react-native-segmented-control/segmented-control";
import * as Clipboard from "expo-clipboard";
import Constants, { ExecutionEnvironment } from "expo-constants";
import React, { useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
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
import { SafeAreaView } from "react-native-safe-area-context";
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
            onPress={() => navigation.navigate("CourseSelect")}
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
// SCHERMATA 2: SCELTA CORSO (con headerSearchBarOptions di @react-navigation/native-stack)
// ═══════════════════════════════════════════════════════════════════════════
function CourseSelectScreen({ navigation }: any) {
  const {
    theme,
    setupMode,
    setSetupMode,
    syncCodeInput,
    setSyncCodeInput,
    handlePasteSyncCode,
    handleLinkFromCloud,
    isLinkingSync,
    loading,
    search,
    filteredDegrees,
    handleSelectDegree,
  } = useOnboarding();

  return (
    <View style={styles.screenRoot}>
      {/* Selettore Modalità di Avvio */}
      {isNativeIos ? (
        <View style={styles.nativeSegmentedWrapper}>
          <SegmentedControl
            values={["Configurazione", "Sincronizzazione"]}
            selectedIndex={setupMode === "normal" ? 0 : 1}
            onChange={(event) => {
              const idx = event.nativeEvent.selectedSegmentIndex;
              setSetupMode(idx === 0 ? "normal" : "sync");
            }}
            appearance="dark"
            tintColor={theme.primary}
            fontStyle={{ fontSize: 13, fontWeight: "600", color: "#a1a1aa" }}
            activeFontStyle={{
              fontSize: 13,
              fontWeight: "700",
              color: "#ffffff",
            }}
            style={styles.nativeSegmentedControl}
          />
        </View>
      ) : (
        <View style={styles.modeSelectorContainer}>
          <TouchableOpacity
            style={[
              styles.modeTab,
              setupMode === "normal" && [
                styles.modeTabActive,
                {
                  backgroundColor: theme.bg,
                  borderColor: theme.primary,
                  shadowColor: theme.primary,
                },
              ],
            ]}
            onPress={() => setSetupMode("normal")}
            activeOpacity={0.8}
          >
            <Ionicons
              name="school-outline"
              size={16}
              color={setupMode === "normal" ? "#ffffff" : "#a1a1aa"}
              style={{ marginRight: 6 }}
            />
            <Text
              style={[
                styles.modeTabText,
                setupMode === "normal" && styles.modeTabTextActive,
              ]}
            >
              Configurazione
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.modeTab,
              setupMode === "sync" && [
                styles.modeTabActive,
                {
                  backgroundColor: theme.bg,
                  borderColor: theme.primary,
                  shadowColor: theme.primary,
                },
              ],
            ]}
            onPress={() => setSetupMode("sync")}
            activeOpacity={0.8}
          >
            <Ionicons
              name="cloud-download-outline"
              size={16}
              color={setupMode === "sync" ? "#ffffff" : "#a1a1aa"}
              style={{ marginRight: 6 }}
            />
            <Text
              style={[
                styles.modeTabText,
                setupMode === "sync" && styles.modeTabTextActive,
              ]}
            >
              Sincronizzazione
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {setupMode === "sync" ? (
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
      ) : (
        <>
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
                  return (
                    <TouchableOpacity
                      key={i}
                      style={styles.courseCard}
                      activeOpacity={0.75}
                      onPress={() => handleSelectDegree(deg, navigation)}
                    >
                      <View
                        style={[
                          styles.courseIconCircle,
                          {
                            backgroundColor: theme.subtle,
                            borderColor: theme.border,
                            borderWidth: 1,
                          },
                        ]}
                      >
                        <Ionicons
                          name="book-outline"
                          size={22}
                          color={theme.primary}
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.courseName}>{cleanDegreeName}</Text>
                        <View style={styles.courseBadgesRow}>
                          <View
                            style={[
                              styles.typeBadge,
                              {
                                backgroundColor: isMagistrale
                                  ? "rgba(168, 85, 247, 0.18)"
                                  : "rgba(56, 189, 248, 0.18)",
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
                                  color: isMagistrale ? "#f3e8ff" : "#e0f2fe",
                                },
                              ]}
                            >
                              {isMagistrale ? "Magistrale" : "Triennale"}
                            </Text>
                          </View>
                          {deg.className ? (
                            <View
                              style={[
                                styles.classBadge,
                                {
                                  backgroundColor: `${theme.primary}22`,
                                  borderColor: theme.primary,
                                  shadowColor: theme.primary,
                                },
                              ]}
                            >
                              <Text
                                style={[
                                  styles.classBadgeText,
                                  { color: "#ffffff" },
                                ]}
                              >
                                {deg.className}
                              </Text>
                            </View>
                          ) : (
                            <View
                              style={[
                                styles.classBadge,
                                {
                                  backgroundColor: `${theme.primary}20`,
                                  borderColor: theme.primary,
                                  shadowColor: theme.primary,
                                },
                              ]}
                            >
                              <Text
                                style={[
                                  styles.classBadgeText,
                                  { color: "#ffffff" },
                                ]}
                              >
                                I.C.I.
                              </Text>
                            </View>
                          )}
                        </View>
                      </View>
                      <Ionicons
                        name="chevron-forward"
                        size={19}
                        color="#71717a"
                      />
                    </TouchableOpacity>
                  );
                })
              )}
            </ScrollView>
          )}
        </>
      )}
    </View>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// SCHERMATA 3: POST DOWNLOAD (Orario, Viaggio & Stazioni con NativeSheetModal)
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
    originAddress,
    setOriginAddress,
    setOriginCoords,
    placeSuggestions,
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
              PRIMA PAGINA: PERSONALIZZA IL TUO ORARIO
             ────────────────────────────────────────────────────────────── */}
          <View style={{ width: screenWidth, flex: 1 }}>
            <ScrollView
              contentContainerStyle={styles.channelScrollContent}
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
                  <Ionicons name="calendar" size={28} color="#ffffff" />
                </View>
                <Text style={styles.channelHeroTitle}>Personalizza il tuo orario</Text>
                <Text style={styles.channelDegreeTitle}>{pendingDegree?.name}</Text>
                <Text style={styles.channelHeroSubtitle}>
                  Seleziona l&apos;anno di corso e il canale ufficiale per caricare
                  il tuo calendario lezioni.
                </Text>
              </View>

              {/* Sezione Selezione Anno */}
              {hasMultipleYears ? (
                <View style={styles.channelSection}>
                  <Text style={styles.channelSectionLabel}>ANNO DI CORSO</Text>
                  <View style={styles.channelButtonsGrid}>
                    {uniqueYears.map((year: string) => {
                      const isSel = selectedYear === year;
                      return (
                        <TouchableOpacity
                          key={year}
                          style={[
                            styles.channelButton,
                            isSel && [
                              styles.channelButtonActive,
                              {
                                backgroundColor: theme.primary,
                                borderColor: theme.primary,
                                shadowColor: theme.primary,
                              },
                            ],
                          ]}
                          activeOpacity={0.75}
                          onPress={() => handleSelectYear(year)}
                        >
                          <Ionicons
                            name={isSel ? "checkmark-circle" : "calendar-outline"}
                            size={16}
                            color={isSel ? "#ffffff" : "#a1a1aa"}
                            style={{ marginRight: 6 }}
                          />
                          <Text
                            style={[
                              styles.channelButtonText,
                              isSel && styles.channelButtonTextActive,
                            ]}
                          >
                            {year}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              ) : null}

              {/* Sezione Selezione Canale */}
              {hasMultipleChannels ? (
                <View style={styles.channelSection}>
                  <Text style={styles.channelSectionLabel}>CANALE / CURRICULUM</Text>
                  <View style={styles.channelButtonsGrid}>
                    {channelsToDisplay.map((p: any, idx: number) => {
                      const chName = p.channel || p.tab.name;
                      const isSel = selectedChannel === chName;
                      return (
                        <TouchableOpacity
                          key={`${chName}_${idx}`}
                          style={[
                            styles.channelButton,
                            isSel && [
                              styles.channelButtonActive,
                              {
                                backgroundColor: theme.primary,
                                borderColor: theme.primary,
                                shadowColor: theme.primary,
                              },
                            ],
                          ]}
                          activeOpacity={0.75}
                          onPress={() => handleSelectChannel(chName)}
                        >
                          <Ionicons
                            name={isSel ? "checkmark-circle" : "layers-outline"}
                            size={16}
                            color={isSel ? "#ffffff" : "#a1a1aa"}
                            style={{ marginRight: 6 }}
                          />
                          <Text
                            style={[
                              styles.channelButtonText,
                              isSel && styles.channelButtonTextActive,
                            ]}
                          >
                            {chName}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              ) : null}

              {!isChannelSelectionComplete && (
                <View style={styles.missingSelectionNotice}>
                  <Ionicons
                    name="information-circle-outline"
                    size={16}
                    color="#f59e0b"
                    style={{ marginRight: 6 }}
                  />
                  <Text style={styles.missingSelectionNoticeText}>
                    {missingSelectionMessage}.
                  </Text>
                </View>
              )}
            </ScrollView>
          </View>

          {/* ──────────────────────────────────────────────────────────────
              SECONDA PAGINA: IMPOSTAZIONI VIAGGIO
             ────────────────────────────────────────────────────────────── */}
          <View style={{ width: screenWidth, flex: 1 }}>
            <ScrollView
              contentContainerStyle={styles.travelInitScrollContent}
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
                  traffico e coincidenze verso le aule, oppure configura
                  più tardi.
                </Text>
              </View>

              {/* ── 1. LUOGO DI PARTENZA ── */}
              <View style={styles.pillSection}>
                <Text style={styles.pillSectionLabel}>LUOGO DI PARTENZA</Text>
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
                  {searchingPlaces ? (
                    <ActivityIndicator
                      size="small"
                      color={theme.primary}
                      style={{ marginLeft: 6 }}
                    />
                  ) : originAddress.trim().length > 0 ? (
                    <TouchableOpacity
                      onPress={() => {
                        setOriginAddress("");
                        setOriginCoords(undefined);
                        setPlaceSearchActive(false);
                      }}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Ionicons
                        name="close-circle"
                        size={17}
                        color="#71717a"
                      />
                    </TouchableOpacity>
                  ) : null}
                </View>

                {placeSearchActive && placeSuggestions.length > 0 && (
                  <View style={styles.suggestionsContainer}>
                    {placeSuggestions.map((item: PlaceSuggestion, idx: number) => (
                      <TouchableOpacity
                        key={idx}
                        style={styles.suggestionItem}
                        onPress={() => handleSelectPlaceSuggestion(item)}
                      >
                        <Ionicons
                          name="location-outline"
                          size={15}
                          color={theme.primary}
                          style={{ marginRight: 8 }}
                        />
                        <Text style={styles.suggestionText} numberOfLines={1}>
                          {item.label}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </View>

              {/* ── 2. USO DELL'AUTO ── */}
              <View style={styles.pillSection}>
                <Text style={styles.pillSectionLabel}>USI L&apos;AUTO?</Text>
                <View style={styles.yesNoGrid}>
                  <TouchableOpacity
                    style={[
                      styles.yesNoPill,
                      carMode === "yes" && [
                        styles.yesNoPillActive,
                        {
                          borderColor: theme.primary,
                          backgroundColor: `${theme.primary}20`,
                          shadowColor: theme.primary,
                        },
                      ],
                    ]}
                    activeOpacity={0.8}
                    onPress={() => {
                      setCarMode("yes");
                      if (parkingBufferMinutes === null) {
                        setParkingBufferMinutes(10);
                      }
                    }}
                  >
                    <Ionicons
                      name="car"
                      size={17}
                      color={carMode === "yes" ? theme.accent : "#a1a1aa"}
                      style={{ marginRight: 8 }}
                    />
                    <Text
                      style={[
                        styles.yesNoPillText,
                        carMode === "yes" && {
                          color: theme.accent,
                          fontWeight: "800",
                        },
                      ]}
                    >
                      Sì, uso l&apos;auto
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[
                      styles.yesNoPill,
                      carMode === "no" && [
                        styles.yesNoPillActive,
                        {
                          borderColor: theme.primary,
                          backgroundColor: `${theme.primary}20`,
                          shadowColor: theme.primary,
                        },
                      ],
                    ]}
                    activeOpacity={0.8}
                    onPress={() => {
                      setCarMode("no");
                      setParkingBufferMinutes(null);
                    }}
                  >
                    <Ionicons
                      name="walk"
                      size={17}
                      color={carMode === "no" ? theme.accent : "#a1a1aa"}
                      style={{ marginRight: 8 }}
                    />
                    <Text
                      style={[
                        styles.yesNoPillText,
                        carMode === "no" && {
                          color: theme.accent,
                          fontWeight: "800",
                        },
                      ]}
                    >
                      No, a piedi / mezzi
                    </Text>
                  </TouchableOpacity>
                </View>

                {carMode === "yes" && (
                  <View style={styles.parkingBufferSubSection}>
                    <Text style={styles.parkingBufferLabel}>
                      Minuti per parcheggiare alla stazione:
                    </Text>
                    <View style={styles.bufferChoicesRow}>
                      {[5, 10, 15, 20].map((mins) => {
                        const isSel = parkingBufferMinutes === mins;
                        return (
                          <TouchableOpacity
                            key={mins}
                            style={[
                              styles.smallBufferPill,
                              isSel && [
                                styles.smallBufferPillActive,
                                {
                                  borderColor: theme.primary,
                                  backgroundColor: theme.primary,
                                },
                              ],
                            ]}
                            onPress={() => setParkingBufferMinutes(mins)}
                          >
                            <Text
                              style={[
                                styles.smallBufferPillText,
                                isSel && { color: "#ffffff", fontWeight: "800" },
                              ]}
                            >
                              +{mins} min
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </View>
                )}
              </View>

              {/* ── 3. STAZIONI FERROVIARIE ── */}
              <View style={styles.pillSection}>
                <Text style={styles.pillSectionLabel}>
                  STAZIONE DI PARTENZA (FS / REGIONALE)
                </Text>
                <TouchableOpacity
                  style={[
                    styles.stationSelectorPill,
                    departureStation && [
                      styles.stationSelectorPillFilled,
                      {
                        borderColor: theme.primary,
                        backgroundColor: "rgba(28, 28, 30, 0.95)",
                      },
                    ],
                  ]}
                  activeOpacity={0.75}
                  onPress={() => setStationPickerType("departure")}
                >
                  <View style={styles.stationPillLeft}>
                    <Ionicons
                      name="train"
                      size={18}
                      color={departureStation ? theme.accent : "#71717a"}
                      style={{ marginRight: 10 }}
                    />
                    <Text
                      style={[
                        styles.stationPillText,
                        departureStation && {
                          color: "#ffffff",
                          fontWeight: "700",
                        },
                      ]}
                    >
                      {departureStation
                        ? departureStation.shortName || departureStation.name
                        : "Scegli stazione di partenza..."}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={17} color="#636366" />
                </TouchableOpacity>

                {/* Stazioni rapide partenza */}
                <View style={styles.quickStationsRow}>
                  {quickDepartureStations.slice(0, 4).map((st: StationInfo) => (
                    <TouchableOpacity
                      key={st.code}
                      style={[
                        styles.quickChip,
                        departureStation?.code === st.code && [
                          styles.quickChipActive,
                          {
                            borderColor: theme.primary,
                            backgroundColor: `${theme.primary}25`,
                          },
                        ],
                      ]}
                      onPress={() => setDepartureStation(st)}
                    >
                      <Text
                        style={[
                          styles.quickChipText,
                          departureStation?.code === st.code && {
                            color: theme.accent,
                            fontWeight: "800",
                          },
                        ]}
                      >
                        {st.shortName || st.name.replace("ROMA ", "")}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              <View style={styles.pillSection}>
                <Text style={styles.pillSectionLabel}>
                  STAZIONE DI ARRIVO (ROMA)
                </Text>
                <TouchableOpacity
                  style={[
                    styles.stationSelectorPill,
                    arrivalStation && [
                      styles.stationSelectorPillFilled,
                      {
                        borderColor: theme.primary,
                        backgroundColor: "rgba(28, 28, 30, 0.95)",
                      },
                    ],
                  ]}
                  activeOpacity={0.75}
                  onPress={() => setStationPickerType("arrival")}
                >
                  <View style={styles.stationPillLeft}>
                    <Ionicons
                      name="flag"
                      size={18}
                      color={arrivalStation ? theme.accent : "#71717a"}
                      style={{ marginRight: 10 }}
                    />
                    <Text
                      style={[
                        styles.stationPillText,
                        arrivalStation && {
                          color: "#ffffff",
                          fontWeight: "700",
                        },
                      ]}
                    >
                      {arrivalStation
                        ? arrivalStation.shortName || arrivalStation.name
                        : "Scegli stazione di arrivo a Roma..."}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={17} color="#636366" />
                </TouchableOpacity>

                {/* Stazioni rapide arrivo */}
                <View style={styles.quickStationsRow}>
                  {quickArrivalStations.map((st: StationInfo) => (
                    <TouchableOpacity
                      key={st.code}
                      style={[
                        styles.quickChip,
                        arrivalStation?.code === st.code && [
                          styles.quickChipActive,
                          {
                            borderColor: theme.primary,
                            backgroundColor: `${theme.primary}25`,
                          },
                        ],
                      ]}
                      onPress={() => setArrivalStation(st)}
                    >
                      <Text
                        style={[
                          styles.quickChipText,
                          arrivalStation?.code === st.code && {
                            color: theme.accent,
                            fontWeight: "800",
                          },
                        ]}
                      >
                        {st.shortName || st.name.replace("ROMA ", "")}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              {/* ── 4. BUFFER ANTICIPO IN AULA ── */}
              <View style={styles.pillSection}>
                <Text style={styles.pillSectionLabel}>
                  ANTICIPO DESIDERATO IN AULA
                </Text>
                <View style={styles.bufferChoicesRow}>
                  {[10, 15, 20, 30].map((mins) => {
                    const isSel = bufferMinutes === mins;
                    return (
                      <TouchableOpacity
                        key={mins}
                        style={[
                          styles.largeBufferPill,
                          isSel && [
                            styles.largeBufferPillActive,
                            {
                              borderColor: theme.primary,
                              backgroundColor: theme.primary,
                              shadowColor: theme.primary,
                            },
                          ],
                        ]}
                        onPress={() => setBufferMinutes(mins)}
                      >
                        <Text
                          style={[
                            styles.largeBufferPillText,
                            isSel && { color: "#ffffff", fontWeight: "800" },
                          ]}
                        >
                          {mins} min
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {bufferMinutes !== null && (
                  <View style={styles.bufferFineControlsRow}>
                    <TouchableOpacity
                      style={[styles.fineStepBtn, { borderColor: theme.border }]}
                      onPress={() => setBufferMinutes(Math.max(5, bufferMinutes - 1))}
                    >
                      <Ionicons name="remove" size={14} color="#ffffff" />
                    </TouchableOpacity>
                    <Text style={[styles.fineStepValueText, { color: theme.accent }]}>
                      {bufferMinutes} min esatti
                    </Text>
                    <TouchableOpacity
                      style={[styles.fineStepBtn, { borderColor: theme.border }]}
                      onPress={() => setBufferMinutes(Math.min(60, bufferMinutes + 1))}
                    >
                      <Ionicons name="add" size={14} color="#ffffff" />
                    </TouchableOpacity>
                  </View>
                )}
              </View>

              {/* Anteprima stima reale tragitto in auto */}
              {carMode === "yes" && departureStation && originAddress.trim().length >= 2 && (
                <View
                  style={[
                    styles.liveRoutePreviewPill,
                    {
                      borderColor: theme.border,
                      backgroundColor: "rgba(255, 255, 255, 0.04)",
                    },
                  ]}
                >
                  <Ionicons
                    name="speedometer-outline"
                    size={20}
                    color={theme.accent}
                    style={{ marginRight: 10 }}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.liveRoutePreviewTitle}>
                      Stima Stradale Live a {departureStation.shortName || departureStation.name}
                    </Text>
                    <Text
                      style={[
                        styles.liveRoutePreviewStats,
                        { color: theme.accent },
                      ]}
                    >
                      {calculatingDriving
                        ? "Calcolo tempi di percorrenza in corso..."
                        : drivingEstimate
                        ? `~${drivingEstimate.durationMinutes} min di tragitto + ${parkingBufferMinutes || 10} min parcheggio (${(drivingEstimate.distanceMeters / 1000).toFixed(1)} km)`
                        : "Dati stradali disponibili al calcolo"}
                    </Text>
                  </View>
                </View>
              )}
            </ScrollView>
          </View>
        </Animated.ScrollView>

        {/* Barra inferiore FISSA che non scorre con la pagina */}
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
              <View style={styles.swipeHintRow}>
                {isChannelSelectionComplete ? (
                  <>
                    <Text
                      style={[
                        styles.swipeHintTextActive,
                        { color: theme.accent },
                      ]}
                    >
                      Scorri per continuare la configurazione
                    </Text>
                    <Ionicons
                      name="arrow-forward"
                      size={14}
                      color={theme.accent}
                      style={{ marginLeft: 5 }}
                    />
                  </>
                ) : (
                  <Text style={styles.swipeHintTextLocked}>
                    {missingSelectionMessage}
                  </Text>
                )}
              </View>
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
              <TouchableOpacity
                style={styles.laterBtnPill}
                activeOpacity={0.75}
                onPress={() => finalizeOnboarding(false)}
              >
                <Text style={styles.laterBtnPillText}>
                  Configura più tardi
                </Text>
              </TouchableOpacity>

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
        <View style={{ flex: 1, paddingTop: 8 }}>
          {searchingStations && (
            <ActivityIndicator
              size="small"
              color={theme.primary}
              style={{ marginVertical: 10 }}
            />
          )}
          <Text style={styles.stationCountHeader}>
            {stationSearchQuery.trim()
              ? `RISULTATI RICERCA (${stationResults.length})`
              : `TUTTE LE STAZIONI ITALIANE (${stationResults.length})`}
          </Text>
          <FlatList
            data={stationResults}
            keyExtractor={(st) => `${st.code}_${st.name}`}
            style={{ flex: 1, paddingHorizontal: 16 }}
            keyboardShouldPersistTaps="handled"
            contentInsetAdjustmentBehavior="automatic"
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

  const [degrees, setDegrees] = useState<Degree[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [progressText, setProgressText] = useState("");
  const [currentDegreeName, setCurrentDegreeName] = useState("");

  const [setupMode, setSetupMode] = useState<"normal" | "sync">("normal");
  const [syncCodeInput, setSyncCodeInput] = useState("");
  const [isLinkingSync, setIsLinkingSync] = useState(false);

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

      setDownloading(false);
      setCurrentPage(1);
      scrollX.setValue(0);
      nav?.navigate("PostDownload");
      setTimeout(() => {
        pagerRef.current?.scrollTo({ x: 0, animated: false });
      }, 40);
    } catch (err) {
      console.error("Errore durante download iniziale:", err);
      setDownloading(false);
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
    setupMode,
    setSetupMode,
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
    originAddress,
    setOriginAddress,
    setOriginCoords,
    placeSuggestions,
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
              }}
            >
              <OnboardingStack.Screen
                name="Welcome"
                component={WelcomeScreen}
              />
              <OnboardingStack.Screen
                name="CourseSelect"
                component={CourseSelectScreen}
                options={{
                  headerShown: true,
                  title: "Scegli il tuo corso",
                  headerBackTitle: "Indietro",
                  headerTintColor: "#ffffff",
                  headerStyle: { backgroundColor: "#111111" },
                  headerShadowVisible: false,
                  headerTitleStyle: {
                    color: "#ffffff",
                    fontSize: 17,
                    fontWeight: "700",
                  },
                  headerSearchBarOptions:
                    setupMode === "normal"
                      ? {
                          placeholder: "Cerca corso o classe (es. Informatica, L-8)...",
                          textColor: "#ffffff",
                          tintColor: theme.primary,
                          headerIconColor: "#8e8e93",
                          hintTextColor: "#71717a",
                          autoCapitalize: "none",
                          hideWhenScrolling: false,
                          placement: "stacked",
                          onChangeText: (e: any) => setSearch(e.nativeEvent.text),
                          onCancelButtonPress: () => setSearch(""),
                        }
                      : undefined,
                }}
              />
              <OnboardingStack.Screen
                name="PostDownload"
                component={PostDownloadScreen}
                options={{
                  headerShown: true,
                  title: pendingDegree?.name || "Configurazione",
                  headerBackTitle: "Corsi",
                  headerTintColor: "#ffffff",
                  headerStyle: { backgroundColor: "#111111" },
                  headerShadowVisible: false,
                  headerTitleStyle: {
                    color: "#ffffff",
                    fontSize: 16,
                    fontWeight: "700",
                  },
                }}
              />
            </OnboardingStack.Navigator>
          </NavigationContainer>
        </NavigationIndependentTree>
      </OnboardingContext.Provider>

      {/* Overlay Download Unificato */}
      {downloading && (
        <View style={StyleSheet.absoluteFill}>
          <CourseDownloadView
            courseName={currentDegreeName}
            progressText={progressText}
            title="Configurazione in corso"
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#111111",
  },
  screenRoot: {
    flex: 1,
    backgroundColor: "#111111",
  },
  /* ── Stili Schermata di Benvenuto Pulita Minimal SVG & Transizione ── */
  cleanWelcomeContainer: {
    flex: 1,
    paddingHorizontal: 28,
    justifyContent: "space-between",
    alignItems: "center",
    paddingTop: 48,
    paddingBottom: Platform.OS === "ios" ? 36 : 28,
  },
  cleanWelcomeCenter: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    maxWidth: 340,
    width: "100%",
  },
  cleanLogoWrapper: {
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 28,
    position: "relative",
  },
  cleanLogoGlow: {
    position: "absolute",
    width: 140,
    height: 140,
    borderRadius: 70,
    opacity: 0.18,
    transform: [{ scale: 1.15 }],
  },
  cleanAppTitle: {
    fontSize: 34,
    fontWeight: "800",
    color: "#ffffff",
    letterSpacing: -0.6,
    marginBottom: 6,
    textAlign: "center",
  },
  cleanAppSubtitle: {
    fontSize: 15,
    fontWeight: "600",
    textAlign: "center",
    letterSpacing: 0.2,
    marginBottom: 16,
  },
  cleanAppDesc: {
    fontSize: 13.5,
    color: "#a1a1aa",
    textAlign: "center",
    lineHeight: 20,
    fontWeight: "400",
    paddingHorizontal: 8,
  },
  cleanWelcomeFooter: {
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 16,
  },

  /* ── Stili Selettore Modalità Normale vs Sync ── */
  nativeSegmentedWrapper: {
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 8,
  },
  nativeSegmentedControl: {
    height: 34,
  },
  modeSelectorContainer: {
    flexDirection: "row",
    paddingHorizontal: 16,
    paddingTop: 6,
    paddingBottom: 8,
    gap: 8,
  },
  modeTab: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 9,
    borderRadius: 12,
    backgroundColor: "#18181b",
    borderWidth: 1,
    borderColor: "#27272a",
  },
  modeTabActive: {
    borderWidth: 1.5,
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

  /* ── Stili Sincronizzazione ── */
  syncContainer: {
    flex: 1,
    paddingHorizontal: 18,
    paddingTop: 14,
  },
  syncCard: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 20,
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
    fontSize: 18,
    fontWeight: "700",
    color: "#ffffff",
    marginBottom: 8,
    textAlign: "center",
  },
  syncCardDesc: {
    fontSize: 13,
    color: "#a1a1aa",
    textAlign: "center",
    lineHeight: 18,
    marginBottom: 20,
  },
  syncInputWrapper: {
    flexDirection: "row",
    alignItems: "center",
    width: "100%",
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 4,
    marginBottom: 16,
  },
  syncInput: {
    flex: 1,
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "600",
    letterSpacing: 1.5,
    paddingVertical: 10,
  },
  syncPasteBtn: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    marginLeft: 8,
  },
  syncPasteBtnText: {
    fontSize: 12,
    fontWeight: "600",
    marginLeft: 4,
  },
  syncSubmitBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
    paddingVertical: 14,
    borderRadius: 12,
  },
  syncSubmitBtnText: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "600",
  },

  /* ── Lista Corsi di Laurea con Card Raccordate & Pill Interne con Glowing ── */
  scrollList: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 4,
  },
  courseCard: {
    backgroundColor: "rgba(255, 255, 255, 0.04)",
    borderRadius: 20,
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginBottom: 10,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
  },
  courseIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 14,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 14,
  },
  courseName: {
    fontSize: 15.5,
    fontWeight: "700",
    color: "#ffffff",
    letterSpacing: -0.2,
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
    paddingHorizontal: 10,
    paddingVertical: 3.5,
    borderRadius: 999,
    borderWidth: 1,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.75,
    shadowRadius: 7,
    elevation: 4,
  },
  typeBadgeText: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.2,
  },
  classBadge: {
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 3.5,
    borderRadius: 999,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.85,
    shadowRadius: 7,
    elevation: 5,
  },
  classBadgeText: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.2,
  },
  centerContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingTop: 40,
  },
  loadingText: {
    color: "#a1a1aa",
    marginTop: 12,
    fontSize: 14,
  },
  emptyContainer: {
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 60,
  },
  emptyText: {
    color: "#71717a",
    marginTop: 12,
    fontSize: 14,
    textAlign: "center",
  },

  /* ── Stili Pagine Post-Download (Orario & Impostazioni Viaggio) ── */
  channelScrollContent: {
    padding: 24,
    paddingTop: 12,
    paddingBottom: 110,
  },
  travelInitScrollContent: {
    paddingHorizontal: 22,
    paddingTop: 12,
    paddingBottom: 120,
  },
  channelHeroHeader: {
    alignItems: "center",
    marginBottom: 26,
  },
  channelIconCircle: {
    width: 64,
    height: 64,
    borderRadius: 20,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 16,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 6,
  },
  channelHeroTitle: {
    fontSize: 24,
    fontWeight: "800",
    color: "#ffffff",
    letterSpacing: 0.3,
    textAlign: "center",
    marginBottom: 4,
  },
  channelDegreeTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: "#a1a1aa",
    textAlign: "center",
    marginBottom: 8,
  },
  channelHeroSubtitle: {
    fontSize: 13,
    color: "#71717a",
    textAlign: "center",
    lineHeight: 18,
    paddingHorizontal: 12,
  },
  channelSection: {
    marginBottom: 22,
  },
  channelSectionLabel: {
    fontSize: 11.5,
    fontWeight: "700",
    color: "#a1a1aa",
    letterSpacing: 0.8,
    marginBottom: 10,
    marginLeft: 4,
  },
  channelButtonsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  channelButton: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 15,
    paddingVertical: 11,
    borderRadius: 14,
    backgroundColor: "#1c1c1e",
    borderWidth: 1,
    borderColor: "#2c2c2e",
  },
  channelButtonActive: {
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 4,
  },
  channelButtonText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#d4d4d8",
  },
  channelButtonTextActive: {
    color: "#ffffff",
    fontWeight: "700",
  },
  missingSelectionNotice: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(245, 158, 11, 0.1)",
    borderWidth: 1,
    borderColor: "rgba(245, 158, 11, 0.25)",
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
    marginTop: 10,
  },
  missingSelectionNoticeText: {
    fontSize: 12.5,
    color: "#f59e0b",
    fontWeight: "600",
    textAlign: "center",
  },

  /* ── Stili Viaggio (Pill Section iOS 26) ── */
  pillSection: {
    marginBottom: 20,
  },
  pillSectionLabel: {
    fontSize: 11,
    fontWeight: "800",
    color: "#71717a",
    letterSpacing: 0.6,
    marginBottom: 8,
    marginLeft: 4,
  },
  iosPillInputWrapper: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(28, 28, 30, 0.75)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.1)",
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  iosPillInput: {
    flex: 1,
    fontSize: 14.5,
    color: "#ffffff",
    fontWeight: "500",
  },
  suggestionsContainer: {
    backgroundColor: "#1c1c1e",
    borderRadius: 14,
    marginTop: 6,
    borderWidth: 1,
    borderColor: "#2c2c2e",
    overflow: "hidden",
  },
  suggestionItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#27272a",
  },
  suggestionText: {
    fontSize: 13,
    color: "#e4e4e7",
  },
  yesNoGrid: {
    flexDirection: "row",
    gap: 10,
  },
  yesNoPill: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(28, 28, 30, 0.75)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.1)",
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 8,
  },
  yesNoPillActive: {
    borderWidth: 1.5,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 3,
  },
  yesNoPillText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#a1a1aa",
  },
  parkingBufferSubSection: {
    marginTop: 12,
    backgroundColor: "rgba(28, 28, 30, 0.5)",
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.06)",
  },
  parkingBufferLabel: {
    fontSize: 11.5,
    fontWeight: "600",
    color: "#a1a1aa",
    marginBottom: 8,
  },
  bufferChoicesRow: {
    flexDirection: "row",
    gap: 8,
  },
  smallBufferPill: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: "#27272a",
    borderWidth: 1,
    borderColor: "#3f3f46",
  },
  smallBufferPillActive: {
    borderColor: "transparent",
  },
  smallBufferPillText: {
    fontSize: 11.5,
    fontWeight: "600",
    color: "#d4d4d8",
  },
  largeBufferPill: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: "rgba(28, 28, 30, 0.75)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.1)",
  },
  largeBufferPillActive: {
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 4,
  },
  largeBufferPillText: {
    fontSize: 14,
    fontWeight: "700",
    color: "#d4d4d8",
  },
  bufferFineControlsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
    marginTop: 12,
  },
  fineStepBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#27272a",
    borderWidth: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  fineStepValueText: {
    fontSize: 12,
    fontWeight: "700",
  },
  stationSelectorPill: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "rgba(28, 28, 30, 0.75)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.1)",
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  stationSelectorPillFilled: {
    borderWidth: 1.2,
  },
  stationPillLeft: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },
  stationPillText: {
    fontSize: 14,
    color: "#8e8e93",
    fontWeight: "500",
  },
  quickStationsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 8,
  },
  quickChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    backgroundColor: "rgba(255, 255, 255, 0.05)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
  },
  quickChipActive: {
    borderWidth: 1,
  },
  quickChipText: {
    fontSize: 11,
    fontWeight: "600",
    color: "#a1a1aa",
  },
  liveRoutePreviewPill: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 14,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: 16,
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

  /* ── Barra Inferiore Fissa con Animazione Fluida delle 2 Lineette ── */
  fixedBottomFooter: {
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: Platform.OS === "ios" ? 14 : 12,
    backgroundColor: "#111111",
    borderTopWidth: 0,
    alignItems: "center",
  },
  twoLinesContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginBottom: 8,
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
    height: 42,
    borderRadius: 21,
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
  saveBtnPill: {
    flex: 1,
    flexDirection: "row",
    height: 42,
    borderRadius: 21,
    borderWidth: 1.5,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 14,
    shadowOffset: { width: 0, height: 0 },
  },
  saveBtnPillDisabled: {
    backgroundColor: "#18181b",
    borderColor: "#27272a",
    opacity: 0.55,
  },
  saveBtnPillText: {
    fontSize: 14,
    fontWeight: "800",
    color: "#ffffff",
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
});
