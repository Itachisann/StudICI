import { useTheme } from "@/context/ThemeContext";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import SegmentedControl from "@react-native-segmented-control/segmented-control";
import * as Clipboard from "expo-clipboard";
import Constants, { ExecutionEnvironment } from "expo-constants";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  FlatList,
  Image,
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
import { NativeActionButton } from "./NativeActionButton";
import { NativeSearchBar } from "./NativeSearchBar";
import { StationInfo } from "../types/commuter";
import { isValidSyncCode, linkDeviceWithCode } from "../utils/cloudSync";
import {
  DEFAULT_COMMUTER_CONFIG,
  saveCommuterConfig,
} from "../utils/commuterStorage";
import {
  calculateDrivingEstimate,
  DrivingEstimate,
  getStationNavigationQuery,
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

const SAPIENZA_RED = "#822433";
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

  // Pager orizzontale fase iniziale: Pagina 0 (Welcome Hero) -> Pagina 1 (Scelta Facoltà / Sincronizzazione)
  const initPagerRef = useRef<ScrollView>(null);
  const [initScrollX] = useState(() => new Animated.Value(0));
  const [initPage, setInitPage] = useState<0 | 1>(0);

  const handleInitPagerScroll = (
    e: NativeSyntheticEvent<NativeScrollEvent>,
  ) => {
    const x = e.nativeEvent.contentOffset.x;
    const pageIndex = Math.round(x / screenWidth);
    if (pageIndex === 0 || pageIndex === 1) {
      if (initPage !== pageIndex) {
        setInitPage(pageIndex as 0 | 1);
      }
    }
  };

  const [degrees, setDegrees] = useState<Degree[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [progressText, setProgressText] = useState("");
  const [currentDegreeName, setCurrentDegreeName] = useState("");

  // Modalità di avvio: Configurazione Normale vs Da Sincronizzazione
  const [setupMode, setSetupMode] = useState<"normal" | "sync">("normal");
  const [syncCodeInput, setSyncCodeInput] = useState("");
  const [isLinkingSync, setIsLinkingSync] = useState(false);

  // Fase: "select_course" (scelta facoltà) vs "post_download" (scorrimento Orario -> Viaggio)
  const [step, setStep] = useState<"select_course" | "post_download">(
    "select_course",
  );
  const [currentPage, setCurrentPage] = useState<1 | 2>(1);

  // Cache facoltà già scaricata: non riscarica se l'utente torna indietro e riclicca la stessa facoltà
  const [downloadedDegreeUrl, setDownloadedDegreeUrl] = useState<string | null>(
    null,
  );
  const [downloadedTabs, setDownloadedTabs] = useState<Tab[]>([]);
  const [pendingDegree, setPendingDegree] = useState<Degree | null>(null);

  // Selezione Anno e Canale: visibili fin da subito ma inizialmente NON selezionati
  const [selectedYear, setSelectedYear] = useState<string>("");
  const [selectedChannel, setSelectedChannel] = useState<string>("");

  // Impostazioni Viaggio (nessun valore pre-selezionato di default)
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

  // Ricerca stazioni e autocompletamento indirizzi
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

  // Gerarchia Anni / Canali per la facoltà scaricata
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

  // Anno di riferimento per mostrare fin da subito anche i canali prima ancora che l'anno sia toccato
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

  // Verifica se l'utente ha selezionato Anno e Canale (o l'unico dei due se ce n'è solo uno)
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

  // Foglio orario risolto in base alla selezione Anno/Canale
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

  // Verifica se tutte le info richieste nella pagina Viaggio sono state inserite per abilitare "Salva"
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

  // Calcolo automatico della stima stradale reale quando sono scelti origine, auto=sì e stazione partenza
  useEffect(() => {
    if (
      step !== "post_download" ||
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
  }, [step, carMode, originAddress, originCoords, departureStation]);

  // Autocompletamento indirizzo di partenza
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

  const handleSelectDegree = async (degree: Degree) => {
    // Se la facoltà cliccata è GIÀ stata scaricata, non riscaricare! Vai subito alla configurazione
    if (
      downloadedDegreeUrl === degree.url &&
      pendingDegree?.url === degree.url
    ) {
      setStep("post_download");
      setCurrentPage(1);
      scrollX.setValue(0);
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

      // Anno e canale devono poter essere selezionati fin da subito ma partono NON selezionati
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
      setStep("post_download");
      setCurrentPage(1);
      scrollX.setValue(0);
      setTimeout(() => {
        pagerRef.current?.scrollTo({ x: 0, animated: false });
      }, 40);
    } catch (err) {
      console.error("Errore durante download iniziale:", err);
      setDownloading(false);
      setStep("select_course");
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
      // Mantiene il canale già scelto dall'utente se esiste anche per questo anno
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
            enabled: carMode === "yes",
            durationMinutes:
              drivingEstimate?.durationMinutes ||
              DEFAULT_COMMUTER_CONFIG.carLeg.durationMinutes,
            distanceKm:
              drivingEstimate?.distanceKm ||
              DEFAULT_COMMUTER_CONFIG.carLeg.distanceKm,
            parkingBufferMinutes: parkingBufferMinutes ?? 7,
            stationAddress: getStationNavigationQuery(
              departureStation.shortName || departureStation.name,
            ),
          },
          departureStation,
          arrivalStation,
          bufferMinutes: bufferMinutes ?? 10,
        });
      } else {
        await saveCommuterConfig({
          ...DEFAULT_COMMUTER_CONFIG,
          enabled: false,
          originAddress: "",
        });
      }

      await AsyncStorage.setItem("selectedDegreeUrl", pendingDegree.url);
      await AsyncStorage.setItem("selectedDegreeName", pendingDegree.name);
      if (pendingDegree.className) {
        await AsyncStorage.setItem(
          "selectedDegreeClassName",
          pendingDegree.className,
        );
      }
      if (resolvedTab?.url) {
        await AsyncStorage.setItem("defaultTabUrl", resolvedTab.url);
      } else {
        await AsyncStorage.removeItem("defaultTabUrl");
      }
      onComplete();
    } catch (e) {
      console.error(e);
      onComplete();
    }
  };

  const handleStationSearchChange = (text: string) => {
    setStationSearchQuery(text);
    if (!text.trim()) {
      setStationResults(ALL_STATIONS);
      setSearchingStations(false);
      return;
    }
    setSearchingStations(true);
    searchStations(text).then((res) => {
      setStationResults(res);
      setSearchingStations(false);
    });
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

  const selectPlace = (place: PlaceSuggestion) => {
    setPlaceSearchActive(false);
    setPlaceSuggestions([]);
    setOriginAddress(place.label);
    setOriginCoords({ lat: place.lat, lon: place.lon });
  };

  const handleLinkFromCloud = async () => {
    const code = syncCodeInput.trim();
    if (!code) {
      Alert.alert(
        "Codice Mancante",
        "Inserisci il Codice Dispositivo dell'altro iPhone o iPad.",
      );
      return;
    }
    if (!isValidSyncCode(code)) {
      Alert.alert(
        "Codice Non Valido",
        "Il codice deve contenere tra 3 e 40 caratteri (es. STUD-XXXX-XXXX-XXXX o nome personalizzato).",
      );
      return;
    }

    setIsLinkingSync(true);
    try {
      const res = await linkDeviceWithCode(code);
      if (res.success) {
        onComplete();
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

  // Helper per il messaggio di blocco scorrimento quando manca la selezione
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

  // Schermata di Download Unificato
  if (downloading) {
    return (
      <CourseDownloadView
        courseName={currentDegreeName}
        progressText={progressText}
        title="Configurazione in corso"
      />
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FASE POST-DOWNLOAD: Scorrimento Orizzontale (Orario -> Impostazioni Viaggio)
  // ═══════════════════════════════════════════════════════════════════════════
  if (step === "post_download" && pendingDegree) {
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
      <SafeAreaView style={styles.container}>
        {/* Header Superiore Compatto con ritorno alla lista facoltà */}
        <View style={styles.postHeaderBar}>
          <TouchableOpacity
            style={styles.backToFacultyBtn}
            activeOpacity={0.7}
            onPress={() => {
              setStep("select_course");
              scrollX.setValue(0);
            }}
          >
            <Ionicons name="chevron-back" size={16} color={theme.accent} />
            <Text style={[styles.backToFacultyText, { color: theme.accent }]}>
              Facoltà
            </Text>
          </TouchableOpacity>
        </View>

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
                PRIMA PAGINA: PERSONALIZZA IL TUO ORARIO (Anno e Canale subito visibili)
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
                    <Ionicons name="funnel" size={28} color="#ffffff" />
                  </View>
                  <Text style={styles.channelHeroTitle}>
                    Personalizza il tuo corso
                  </Text>
                  <Text
                    style={[styles.channelDegreeTitle, { color: theme.accent }]}
                    numberOfLines={2}
                  >
                    {pendingDegree.name}
                  </Text>
                  <Text style={styles.channelHeroSubtitle}>
                    Scegli l&apos;anno e il canale che frequenti. Verranno
                    aperti in automatico ad ogni avvio
                  </Text>
                </View>

                {/* 1. Selezione Anno di Corso (visibile fin da subito, inizialmente non selezionato) */}
                {hasMultipleYears && (
                  <View style={styles.pillSection}>
                    <Text style={styles.pillSectionLabel}>ANNO DI CORSO</Text>
                    <View style={styles.chipsContainer}>
                      {uniqueYears.map((year, idx) => {
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
                              size={16}
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

                {/* 2. Selezione Canale / Suddivisione (visibile fin da subito, inizialmente non selezionato) */}
                {hasMultipleChannels && (
                  <View style={styles.pillSection}>
                    <Text style={styles.pillSectionLabel}>SUDDIVISIONE</Text>
                    <View style={styles.channelRowEqual}>
                      {channelsToDisplay.map((item, idx) => {
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
                SECONDA PAGINA: IMPOSTAZIONI VIAGGIO (Stile Pill iOS, zero default)
               ────────────────────────────────────────────────────────────── */}
            <View style={{ width: screenWidth, flex: 1 }}>
              {stationPickerType ? (
                <View style={styles.stationSearchOverlay}>
                  <View style={styles.stationSearchHeader}>
                    <TouchableOpacity
                      onPress={() => {
                        setStationPickerType(null);
                        setStationSearchQuery("");
                      }}
                      style={styles.backInlineBtn}
                    >
                      <Ionicons
                        name="arrow-back"
                        size={18}
                        color={theme.primary}
                      />
                      <Text
                        style={[styles.backInlineText, { color: theme.primary }]}
                      >
                        Indietro
                      </Text>
                    </TouchableOpacity>
                    <Text style={styles.stationSearchTitle}>
                      {stationPickerType === "departure"
                        ? "Stazione di partenza"
                        : "Stazione di arrivo"}
                    </Text>
                    <View style={{ width: 65 }} />
                  </View>

                  <NativeSearchBar
                    value={stationSearchQuery}
                    onChangeText={handleStationSearchChange}
                    placeholder="Cerca tra tutte le stazioni italiane..."
                    autoFocus
                    tintColor={theme.primary}
                    style={{ marginHorizontal: 0, marginVertical: 8 }}
                  />

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
                    style={{ flex: 1, paddingHorizontal: 20 }}
                    keyboardShouldPersistTaps="handled"
                    initialNumToRender={25}
                    maxToRenderPerBatch={30}
                    windowSize={10}
                    renderItem={({ item: st }) => (
                      <TouchableOpacity
                        style={styles.stationListItem}
                        activeOpacity={0.7}
                        onPress={() => selectStationFromSearch(st)}
                      >
                        <View
                          style={[
                            styles.stationIconBadge,
                            { backgroundColor: theme.subtle },
                          ]}
                        >
                          <Ionicons
                            name="train"
                            size={16}
                            color={theme.primary}
                          />
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
                          name="checkmark-circle-outline"
                          size={18}
                          color={theme.primary}
                        />
                      </TouchableOpacity>
                    )}
                  />
                </View>
              ) : (
                <>
                  <ScrollView
                    contentContainerStyle={styles.travelInitScrollContent}
                    showsVerticalScrollIndicator={false}
                    keyboardShouldPersistTaps="handled"
                  >
                    {/* Header Pagina Viaggio in stile coerente con la pagina precedente */}
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
                          {placeSuggestions.map((place) => (
                            <TouchableOpacity
                              key={place.id}
                              style={styles.suggestionRow}
                              activeOpacity={0.7}
                              onPress={() => selectPlace(place)}
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
                                  {place.title}
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

                    {/* ── 2. TRAGITTO IN AUTO VERSO LA STAZIONE ── */}
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
                          onPress={() => setCarMode("yes")}
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
                                    setParkingBufferMinutes((p) =>
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
                                    setParkingBufferMinutes((p) => (p ?? 7) + 1)
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
                      <View style={styles.chipsContainer}>
                        {quickDepartureStations.map((st) => {
                          const isSel = departureStation?.code === st.code;
                          return (
                            <TouchableOpacity
                              key={st.code}
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
                              >
                                {st.shortName || st.name}
                              </Text>
                            </TouchableOpacity>
                          );
                        })}

                        {departureStation &&
                        !quickDepartureStations.some(
                          (s) => s.code === departureStation.code,
                        ) ? (
                          <TouchableOpacity
                            style={[
                              styles.chip,
                              styles.chipActive,
                              {
                                backgroundColor: theme.bg,
                                borderColor: theme.primary,
                                shadowColor: theme.primary,
                              },
                            ]}
                            activeOpacity={0.7}
                            onPress={() => setStationPickerType("departure")}
                          >
                            <Ionicons
                              name="checkmark-circle"
                              size={14}
                              color="#ffffff"
                              style={{ marginRight: 5 }}
                            />
                            <Text
                              style={[styles.chipText, styles.chipTextActive]}
                            >
                              {departureStation.shortName ||
                                departureStation.name}
                            </Text>
                            <Ionicons
                              name="chevron-down"
                              size={12}
                              color="#ffffff"
                              style={{ marginLeft: 4 }}
                            />
                          </TouchableOpacity>
                        ) : (
                          <TouchableOpacity
                            style={[
                              styles.chip,
                              { borderStyle: "dashed", borderColor: "#52525b" },
                            ]}
                            activeOpacity={0.7}
                            onPress={() => setStationPickerType("departure")}
                          >
                            <Ionicons
                              name="search"
                              size={14}
                              color={theme.accent}
                              style={{ marginRight: 5 }}
                            />
                            <Text
                              style={[styles.chipText, { color: theme.accent }]}
                            >
                              Altra stazione...
                            </Text>
                          </TouchableOpacity>
                        )}
                      </View>

                      <Text
                        style={[styles.pillSectionLabel, { marginTop: 18 }]}
                      >
                        STAZIONE DI ARRIVO (ROMA)
                      </Text>
                      <View style={styles.chipsContainer}>
                        {quickArrivalStations.map((st) => {
                          const isSel = arrivalStation?.code === st.code;
                          return (
                            <TouchableOpacity
                              key={st.code}
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
                              >
                                {st.shortName || st.name}
                              </Text>
                            </TouchableOpacity>
                          );
                        })}

                        {arrivalStation &&
                        !quickArrivalStations.some(
                          (s) => s.code === arrivalStation.code,
                        ) ? (
                          <TouchableOpacity
                            style={[
                              styles.chip,
                              styles.chipActive,
                              {
                                backgroundColor: theme.bg,
                                borderColor: theme.primary,
                                shadowColor: theme.primary,
                              },
                            ]}
                            activeOpacity={0.7}
                            onPress={() => setStationPickerType("arrival")}
                          >
                            <Ionicons
                              name="checkmark-circle"
                              size={14}
                              color="#ffffff"
                              style={{ marginRight: 5 }}
                            />
                            <Text
                              style={[styles.chipText, styles.chipTextActive]}
                            >
                              {arrivalStation.shortName || arrivalStation.name}
                            </Text>
                            <Ionicons
                              name="chevron-down"
                              size={12}
                              color="#ffffff"
                              style={{ marginLeft: 4 }}
                            />
                          </TouchableOpacity>
                        ) : (
                          <TouchableOpacity
                            style={[
                              styles.chip,
                              { borderStyle: "dashed", borderColor: "#52525b" },
                            ]}
                            activeOpacity={0.7}
                            onPress={() => setStationPickerType("arrival")}
                          >
                            <Ionicons
                              name="search"
                              size={14}
                              color={theme.accent}
                              style={{ marginRight: 5 }}
                            />
                            <Text
                              style={[styles.chipText, { color: theme.accent }]}
                            >
                              Altra...
                            </Text>
                          </TouchableOpacity>
                        )}
                      </View>

                      {/* Anteprima live distanza e tempo reale se auto=sì e origine+stazione scelte */}
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
                                {departureStation.shortName ||
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
                                    ? `${drivingEstimate.distanceKm} km stradali • ~${drivingEstimate.durationMinutes} min • ${drivingEstimate.trafficCondition || "Viabilità attuale: traffico scorrevole"}`
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
                                setBufferMinutes((b) =>
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
                                setBufferMinutes((b) => (b ?? 10) + 1)
                              }
                            >
                              <Ionicons name="add" size={14} color="#ffffff" />
                            </TouchableOpacity>
                          </View>
                        )}
                      </View>
                    </View>
                  </ScrollView>
                </>
              )}
            </View>
          </Animated.ScrollView>

          {/* Barra inferiore FISSA che non scorre con la pagina ma transiziona le due barrette in modo fluido */}
          {!stationPickerType && (
            <View style={styles.fixedBottomFooter}>
              <View style={styles.twoLinesContainer}>
                {/* Lineetta 1 */}
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
                {/* Lineetta 2 */}
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
                {/* Vista Pagina 1: Hint di scorrimento / blocco selezione */}
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

                {/* Vista Pagina 2: Pulsanti "Configura più tardi" e "Salva" */}
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
          )}
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FASE INIZIALE: Pager Orizzontale (Pagina 0: Welcome Hero -> Pagina 1: Scelta Facoltà / Sync)
  // ═══════════════════════════════════════════════════════════════════════════
  const initLine1Width = initScrollX.interpolate({
    inputRange: [0, screenWidth],
    outputRange: [34, 20],
    extrapolate: "clamp",
  });
  const initLine1Color = initScrollX.interpolate({
    inputRange: [0, screenWidth],
    outputRange: [theme.primary, "#52525b"],
    extrapolate: "clamp",
  });
  const initLine2Width = initScrollX.interpolate({
    inputRange: [0, screenWidth],
    outputRange: [20, 34],
    extrapolate: "clamp",
  });
  const initLine2Color = initScrollX.interpolate({
    inputRange: [0, screenWidth],
    outputRange: ["#52525b", theme.primary],
    extrapolate: "clamp",
  });

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <Animated.ScrollView
          ref={initPagerRef}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          onScroll={Animated.event(
            [{ nativeEvent: { contentOffset: { x: initScrollX } } }],
            { useNativeDriver: false, listener: handleInitPagerScroll },
          )}
          scrollEventThrottle={16}
          style={{ flex: 1 }}
        >
          {/* ═════════════════════════════════════════════════════════════════
              PAGINA 0: SCHERMATA DI INIZIO (HERO WELCOME & SCORRI PER INIZIARE)
             ═════════════════════════════════════════════════════════════════ */}
          <View style={{ width: screenWidth, flex: 1 }}>
            <ScrollView
              contentContainerStyle={styles.welcomeScrollContent}
              showsVerticalScrollIndicator={false}
            >
              {/* Hero Logo + Titolo */}
              <View style={styles.welcomeHero}>
                <View
                  style={[
                    styles.welcomeLogoBadge,
                    {
                      backgroundColor: theme.primary,
                      shadowColor: theme.primary,
                    },
                  ]}
                >
                  <Image
                    source={require("../../assets/images/icon.png")}
                    style={styles.welcomeLogoImage}
                    resizeMode="cover"
                  />
                </View>
                <Text style={styles.welcomeAppTitle}>Benvenuto in StudICI</Text>
                <Text
                  style={[styles.welcomeAppSubtitle, { color: theme.accent }]}
                >
                  Sapienza Università di Roma · Facoltà I.C.I.
                </Text>
                <View style={styles.welcomeTaglinePill}>
                  <Ionicons
                    name="sparkles"
                    size={13}
                    color="#f59e0b"
                    style={{ marginRight: 5 }}
                  />
                  <Text style={styles.welcomeTaglineText}>
                    Esperienza nativa intelligente
                  </Text>
                </View>
              </View>

              {/* Feature Showcase Cards iOS 26 */}
              <View style={styles.welcomeCardsContainer}>
                <View style={styles.welcomeFeatureCard}>
                  <View
                    style={[
                      styles.welcomeCardIconCircle,
                      { backgroundColor: "rgba(56, 189, 248, 0.15)" },
                    ]}
                  >
                    <Ionicons name="calendar" size={22} color="#38bdf8" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.welcomeCardTitle}>
                      Orari Ufficiali Dinamici
                    </Text>
                    <Text style={styles.welcomeCardDesc}>
                      Tutte le lezioni, i canali e le variazioni d&apos;aula
                      sempre sincronizzate con i server Sapienza.
                    </Text>
                  </View>
                </View>

                <View style={styles.welcomeFeatureCard}>
                  <View
                    style={[
                      styles.welcomeCardIconCircle,
                      { backgroundColor: "rgba(245, 158, 11, 0.15)" },
                    ]}
                  >
                    <Ionicons name="train" size={22} color="#f59e0b" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.welcomeCardTitle}>
                      Tragitto Pendolare Live
                    </Text>
                    <Text style={styles.welcomeCardDesc}>
                      Calcolo coincidenze Trenitalia e tempi di percorrenza
                      in tempo reale da casa alle aule.
                    </Text>
                  </View>
                </View>

                <View style={styles.welcomeFeatureCard}>
                  <View
                    style={[
                      styles.welcomeCardIconCircle,
                      { backgroundColor: "rgba(16, 185, 129, 0.15)" },
                    ]}
                  >
                    <Ionicons name="checkbox" size={22} color="#10b981" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.welcomeCardTitle}>
                      Registro Presenze Smart
                    </Text>
                    <Text style={styles.welcomeCardDesc}>
                      Percentuali di frequenza calcolate in automatico ed
                      esportazione del report PDF firmato.
                    </Text>
                  </View>
                </View>

                <View style={styles.welcomeFeatureCard}>
                  <View
                    style={[
                      styles.welcomeCardIconCircle,
                      { backgroundColor: "rgba(168, 85, 247, 0.15)" },
                    ]}
                  >
                    <Ionicons name="sync-circle" size={24} color="#a855f7" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.welcomeCardTitle}>
                      Sincronizzazione Dispositivi
                    </Text>
                    <Text style={styles.welcomeCardDesc}>
                      Collega all&apos;istante i tuoi dati tra più dispositivi
                      con un codice univoco senza riscaricare tutto.
                    </Text>
                  </View>
                </View>
              </View>

              {/* Pulsante Inizia rapido */}
              <View style={styles.welcomeButtonContainer}>
                <NativeActionButton
                  label="Inizia"
                  onPress={() =>
                    initPagerRef.current?.scrollTo({
                      x: screenWidth,
                      animated: true,
                    })
                  }
                  accentColor={theme.primary}
                  glow={true}
                  icon={
                    <Ionicons
                      name="arrow-forward"
                      size={17}
                      color="#ffffff"
                    />
                  }
                  style={{ width: "100%", maxWidth: 280 }}
                />
              </View>
            </ScrollView>
          </View>

          {/* ═════════════════════════════════════════════════════════════════
              PAGINA 1: SELEZIONE FACOLTÀ & CONFIGURAZIONE / SINCRONIZZAZIONE
             ═════════════════════════════════════════════════════════════════ */}
          <View style={{ width: screenWidth, flex: 1 }}>
            {/* Header Pagina 1 con tasto Info indietro */}
            <View style={styles.initPage1Header}>
              <TouchableOpacity
                style={styles.backToWelcomeBtn}
                activeOpacity={0.7}
                onPress={() =>
                  initPagerRef.current?.scrollTo({ x: 0, animated: true })
                }
              >
                <Ionicons name="chevron-back" size={17} color={theme.accent} />
                <Text
                  style={[styles.backToWelcomeText, { color: theme.accent }]}
                >
                  Info
                </Text>
              </TouchableOpacity>
              <Text style={styles.initPage1HeaderTitle}>Scegli il tuo corso</Text>
              <View style={{ width: 60 }} />
            </View>

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
          {/* Barra di Ricerca Nativa Callstack / Glowing */}
          <NativeSearchBar
            value={search}
            onChangeText={setSearch}
            placeholder="Cerca corso (es. Informatica, Meccanica...)"
            tintColor={theme.primary}
          />

          {/* Lista Corsi con Pill Glow */}
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
            >
              {filteredDegrees.length === 0 ? (
                <View style={styles.emptyContainer}>
                  <Ionicons name="search-outline" size={40} color="#3a3a3c" />
                  <Text style={styles.emptyText}>
                    Nessun corso trovato per &quot;{search}&quot;
                  </Text>
                </View>
              ) : (
                filteredDegrees.map((deg, i) => {
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
                      activeOpacity={0.7}
                      onPress={() => handleSelectDegree(deg)}
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
                          color={theme.accent}
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
                          {deg.className ? (
                            <View style={styles.classBadge}>
                              <Text style={styles.classBadgeText}>
                                {deg.className}
                              </Text>
                            </View>
                          ) : null}
                        </View>
                      </View>
                      <Ionicons
                        name="chevron-forward"
                        size={20}
                        color="#636366"
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
        </Animated.ScrollView>

        {/* ── Barra Inferiore Fissa con le 2 Lineette e Swipe Hint ── */}
        <View style={styles.fixedBottomFooter}>
          <View style={styles.twoLinesContainer}>
            <Animated.View
              style={[
                styles.swipeLineIndicator,
                { width: initLine1Width, backgroundColor: initLine1Color },
              ]}
            />
            <Animated.View
              style={[
                styles.swipeLineIndicator,
                { width: initLine2Width, backgroundColor: initLine2Color },
              ]}
            />
          </View>

          <View style={styles.bottomFooterActionArea}>
            {initPage === 0 ? (
              <TouchableOpacity
                style={styles.swipeHintRow}
                activeOpacity={0.75}
                onPress={() =>
                  initPagerRef.current?.scrollTo({
                    x: screenWidth,
                    animated: true,
                  })
                }
              >
                <Text
                  style={[
                    styles.swipeHintTextActive,
                    { color: theme.accent, fontSize: 13.5 },
                  ]}
                >
                  Scorri per iniziare
                </Text>
                <Ionicons
                  name="arrow-forward"
                  size={16}
                  color={theme.accent}
                  style={{ marginLeft: 6 }}
                />
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={styles.swipeHintRow}
                activeOpacity={0.75}
                onPress={() =>
                  initPagerRef.current?.scrollTo({ x: 0, animated: true })
                }
              >
                <Ionicons
                  name="arrow-back"
                  size={14}
                  color="#71717a"
                  style={{ marginRight: 6 }}
                />
                <Text
                  style={[styles.swipeHintTextLocked, { color: "#71717a" }]}
                >
                  Scorri a sinistra per le informazioni
                </Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#111111",
  },
  /* ── Stili Schermata di Benvenuto iOS 26 (Pagina 0) ── */
  welcomeScrollContent: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 24,
  },
  welcomeHero: {
    alignItems: "center",
    marginBottom: 20,
  },
  welcomeLogoBadge: {
    width: 72,
    height: 72,
    borderRadius: 20,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 12,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.45,
    shadowRadius: 14,
    elevation: 8,
    overflow: "hidden",
  },
  welcomeLogoImage: {
    width: 72,
    height: 72,
    borderRadius: 20,
  },
  welcomeAppTitle: {
    fontSize: 28,
    fontWeight: "800",
    color: "#ffffff",
    letterSpacing: -0.6,
    marginBottom: 4,
  },
  welcomeAppSubtitle: {
    fontSize: 13.5,
    fontWeight: "600",
    textAlign: "center",
    marginBottom: 8,
  },
  welcomeTaglinePill: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 20,
    backgroundColor: "rgba(255, 255, 255, 0.06)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.12)",
    marginTop: 2,
  },
  welcomeTaglineText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#e4e4e7",
    letterSpacing: 0.2,
  },
  welcomeCardsContainer: {
    gap: 10,
    marginBottom: 20,
  },
  welcomeFeatureCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255, 255, 255, 0.04)",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
    padding: 13,
  },
  welcomeCardIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 13,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 14,
  },
  welcomeCardTitle: {
    fontSize: 14.5,
    fontWeight: "700",
    color: "#ffffff",
    marginBottom: 3,
    letterSpacing: -0.2,
  },
  welcomeCardDesc: {
    fontSize: 12,
    color: "#a1a1aa",
    lineHeight: 16.5,
    fontWeight: "400",
  },
  welcomeButtonContainer: {
    alignItems: "center",
    marginTop: 4,
    marginBottom: 8,
  },
  initPage1Header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 10,
  },
  backToWelcomeBtn: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 6,
    paddingRight: 10,
  },
  backToWelcomeText: {
    fontSize: 14,
    fontWeight: "600",
    marginLeft: 2,
  },
  initPage1HeaderTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#ffffff",
  },
  /* ── Stili Schermata Scelta Facoltà Originale (con Pill Glow) ── */
  header: {
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 6,
  },
  headerTopRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  logoBadge: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: SAPIENZA_RED,
    justifyContent: "center",
    alignItems: "center",
    shadowColor: SAPIENZA_RED,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 6,
    elevation: 4,
    overflow: "hidden",
  },
  logoBadgeImage: {
    width: "100%",
    height: "100%",
    borderRadius: 12,
  },
  appTitle: {
    fontSize: 20,
    fontWeight: "bold",
    color: "#ffffff",
    letterSpacing: -0.3,
  },
  appSubtitle: {
    fontSize: 12,
    color: SAPIENZA_RED,
    fontWeight: "600",
    marginTop: 2,
    letterSpacing: 0.3,
  },
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    marginHorizontal: 16,
    paddingHorizontal: 14,
    height: 42,
    borderRadius: 12,
    marginTop: 4,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.12)",
  },
  searchIcon: {
    marginRight: 10,
  },
  searchInput: {
    flex: 1,
    color: "#ffffff",
    fontSize: 15,
  },
  scrollList: {
    flex: 1,
    paddingHorizontal: 20,
  },
  courseCard: {
    backgroundColor: "#1c1c1e",
    borderRadius: 14,
    padding: 16,
    marginBottom: 10,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#2c2c2e",
  },
  courseIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#2c2c2e",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 14,
  },
  courseName: {
    fontSize: 16,
    fontWeight: "600",
    color: "#ffffff",
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
    backgroundColor: "rgba(255, 159, 10, 0.25)",
    borderColor: "#ff9f0a",
    borderWidth: 1,
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 999,
    shadowColor: "#ff9f0a",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.65,
    shadowRadius: 6,
    elevation: 4,
  },
  classBadgeText: {
    color: "#fde68a",
    fontSize: 11,
    fontWeight: "700",
  },
  centerContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingBottom: 60,
  },
  loadingText: {
    color: "#8e8e93",
    marginTop: 14,
    fontSize: 14,
  },
  emptyContainer: {
    alignItems: "center",
    marginTop: 60,
  },
  emptyText: {
    color: "#636366",
    marginTop: 12,
    fontSize: 14,
  },
  nativeSegmentedWrapper: {
    marginHorizontal: 16,
    marginBottom: 8,
  },
  nativeSegmentedControl: {
    height: 38,
  },
  modeSelectorContainer: {
    flexDirection: "row",
    backgroundColor: "#1c1c1e",
    borderRadius: 14,
    padding: 4,
    marginHorizontal: 16,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: "#2c2c2e",
    overflow: "visible",
  },
  modeTab: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
    borderRadius: 10,
  },
  modeTabActive: {
    backgroundColor: "rgba(130, 36, 51, 0.45)",
    borderColor: SAPIENZA_RED,
    borderWidth: 1.5,
    shadowColor: SAPIENZA_RED,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 10,
    elevation: 6,
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
  syncContainer: {
    flex: 1,
    paddingHorizontal: 16,
  },
  syncCard: {
    backgroundColor: "#1c1c1e",
    borderRadius: 16,
    padding: 20,
    alignItems: "center",
    borderWidth: 0.5,
    borderColor: "rgba(255, 255, 255, 0.08)",
    marginBottom: 16,
  },
  syncIconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "rgba(56, 189, 248, 0.15)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  syncCardTitle: {
    color: "#ffffff",
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 6,
    textAlign: "center",
  },
  syncCardDesc: {
    color: "#a1a1aa",
    fontSize: 13,
    lineHeight: 18,
    textAlign: "center",
    marginBottom: 20,
  },
  syncInputWrapper: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#2c2c2e",
    borderRadius: 12,
    paddingHorizontal: 12,
    width: "100%",
    marginBottom: 14,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.1)",
  },
  syncInput: {
    flex: 1,
    height: 48,
    color: "#ffffff",
    fontSize: 14,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    fontWeight: "600",
  },
  syncPasteBtn: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(56, 189, 248, 0.12)",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    marginLeft: 8,
  },
  syncPasteBtnText: {
    color: "#38bdf8",
    fontSize: 12,
    fontWeight: "600",
    marginLeft: 4,
  },
  syncSubmitBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#2563eb",
    width: "100%",
    paddingVertical: 14,
    borderRadius: 12,
  },
  syncSubmitBtnText: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "600",
  },

  /* ── Stili Pagine Post-Download (Orario & Impostazioni Viaggio) ── */
  postHeaderBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 18,
    paddingTop: 8,
    paddingBottom: 4,
  },
  backToFacultyBtn: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 6,
    paddingRight: 10,
  },
  backToFacultyText: {
    fontSize: 14,
    fontWeight: "700",
    marginLeft: 2,
  },
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
    backgroundColor: SAPIENZA_RED,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 16,
    shadowColor: SAPIENZA_RED,
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
    color: SAPIENZA_RED,
    textAlign: "center",
    marginBottom: 6,
  },
  channelHeroSubtitle: {
    fontSize: 13,
    color: "#8e8e93",
    textAlign: "center",
    lineHeight: 18,
  },
  pillSection: {
    marginBottom: 24,
    overflow: "visible",
  },
  pillSectionLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: "#71717a",
    letterSpacing: 0.8,
    marginBottom: 12,
    textAlign: "center",
  },
  subPillGroup: {
    marginTop: 14,
    alignItems: "center",
  },
  subPillLabel: {
    fontSize: 10.5,
    fontWeight: "700",
    color: "#71717a",
    letterSpacing: 0.7,
    marginBottom: 8,
    textAlign: "center",
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
    paddingHorizontal: 15,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: "#2c2c2e",
    justifyContent: "center",
  },
  chipActive: {
    backgroundColor: "rgba(130, 36, 51, 0.45)",
    borderColor: SAPIENZA_RED,
    borderWidth: 1.5,
    shadowColor: SAPIENZA_RED,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 10,
    elevation: 6,
  },
  chipText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#a1a1aa",
  },
  chipTextActive: {
    color: "#ffffff",
    fontWeight: "700",
  },
  channelRowEqual: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    width: "100%",
    maxWidth: 420,
    alignSelf: "center",
    gap: 8,
    overflow: "visible",
    paddingVertical: 4,
  },
  chipEqual: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1c1c1e",
    paddingHorizontal: 8,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: "#2c2c2e",
    justifyContent: "center",
  },
  summaryCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1c1c1e",
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: "#2c2c2e",
    marginTop: 8,
  },
  summaryIconBox: {
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: "rgba(130, 36, 51, 0.25)",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 14,
    borderWidth: 1,
    borderColor: "rgba(130, 36, 51, 0.4)",
  },
  summaryOverline: {
    fontSize: 10.5,
    fontWeight: "700",
    color: "#8e8e93",
    letterSpacing: 0.6,
    marginBottom: 2,
  },
  summaryValue: {
    fontSize: 16,
    fontWeight: "700",
    color: "#ffffff",
    marginBottom: 2,
  },
  summaryOriginalName: {
    fontSize: 12,
    color: "#a1a1aa",
  },
  promptSelectCard: {
    alignItems: "center",
    backgroundColor: "rgba(255, 255, 255, 0.03)",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.07)",
    paddingVertical: 18,
    paddingHorizontal: 20,
    marginTop: 8,
  },
  promptSelectText: {
    fontSize: 13,
    color: "#8e8e93",
    textAlign: "center",
    lineHeight: 19,
  },

  /* ── Input e Controlli Pill in Pagina Viaggio ── */
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
    borderRadius: 16,
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
  fineStepRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginLeft: 4,
  },
  fineStepPill: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: "#27272a",
    borderWidth: 1,
    borderColor: "#3f3f46",
    justifyContent: "center",
    alignItems: "center",
  },
  fineStepValuePill: {
    paddingHorizontal: 10,
    height: 30,
    borderRadius: 15,
    borderWidth: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  fineStepValueText: {
    fontSize: 12,
    fontWeight: "700",
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

  /* ── Overlay Ricerca Stazione ── */
  stationSearchOverlay: {
    flex: 1,
    paddingTop: 6,
  },
  stationSearchHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    marginBottom: 12,
  },
  backInlineBtn: {
    flexDirection: "row",
    alignItems: "center",
    width: 65,
  },
  backInlineText: {
    fontSize: 14,
    fontWeight: "600",
    marginLeft: 4,
  },
  stationSearchTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#ffffff",
  },
  stationListItem: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1c1c1e",
    padding: 13,
    borderRadius: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: "#2c2c2e",
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
    paddingHorizontal: 20,
    marginBottom: 10,
    marginTop: 4,
  },
});
