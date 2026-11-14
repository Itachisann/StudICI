import { CARD_RADIUS, UNIFORM_MODAL_BG } from "@/constants/theme";
import { useTheme } from "@/context/ThemeContext";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import SegmentedControl from "@react-native-segmented-control/segmented-control";
import {
  DarkTheme,
  NavigationContainer,
  NavigationIndependentTree,
  useNavigation,
} from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import Constants, { ExecutionEnvironment } from "expo-constants";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  CommuterConfig,
  StationInfo,
  TrainPreferences,
} from "../types/commuter";
import { DEFAULT_TRAIN_PREFERENCES } from "../utils/commuterStorage";
import {
  calculateDrivingEstimate,
  DrivingEstimate,
  getStationNavigationQuery,
  PlaceSuggestion,
  searchPlaces,
} from "../utils/drivingRouter";
import { getManualEvents } from "../utils/manualEvents";
import { fetchScheduleData, getCachedScheduleData } from "../utils/scraper";
import { ALL_STATIONS, searchStations } from "../utils/trenitaliaApi";
import { SwipeToDeleteRow } from "./SwipeToDeleteRow";

const isNativeIos =
  Platform.OS === "ios" &&
  Constants.executionEnvironment !== ExecutionEnvironment.StoreClient;

interface Props {
  visible: boolean;
  config: CommuterConfig;
  onClose: () => void;
  onSave: (newConfig: CommuterConfig) => void;
}

const RootModalStack = createNativeStackNavigator();
const CommuterModalStack = createNativeStackNavigator();

interface CommuterModalContextType {
  theme: any;
  isUnconfigured: boolean;
  isInitComplete: boolean;
  sheetTitle: string;
  initOriginAddress: string;
  setInitOriginAddress: React.Dispatch<React.SetStateAction<string>>;
  initOriginCoords: { lat: number; lon: number } | undefined;
  setInitOriginCoords: React.Dispatch<
    React.SetStateAction<{ lat: number; lon: number } | undefined>
  >;
  initCarMode: "yes" | "no" | null;
  setInitCarMode: React.Dispatch<React.SetStateAction<"yes" | "no" | null>>;
  initParkingBufferMinutes: number | null;
  setInitParkingBufferMinutes: React.Dispatch<
    React.SetStateAction<number | null>
  >;
  initDepartureStation: StationInfo | null;
  setInitDepartureStation: React.Dispatch<
    React.SetStateAction<StationInfo | null>
  >;
  initArrivalStation: StationInfo | null;
  setInitArrivalStation: React.Dispatch<
    React.SetStateAction<StationInfo | null>
  >;
  initBufferMinutes: number | null;
  setInitBufferMinutes: React.Dispatch<React.SetStateAction<number | null>>;
  initIncludeIntercity: boolean;
  setInitIncludeIntercity: React.Dispatch<React.SetStateAction<boolean>>;
  initTrainPreferences: TrainPreferences;
  setInitTrainPreferences: React.Dispatch<
    React.SetStateAction<TrainPreferences>
  >;
  initUrbanMode: "auto" | "walk";
  setInitUrbanMode: React.Dispatch<React.SetStateAction<"auto" | "walk">>;
  initDrivingEstimate: DrivingEstimate | null;
  initCalculatingDriving: boolean;
  localConfig: CommuterConfig;
  setLocalConfig: React.Dispatch<React.SetStateAction<CommuterConfig>>;
  drivingEstimate: DrivingEstimate | null;
  calculatingDriving: boolean;
  placeSearchActive: boolean;
  setPlaceSearchActive: React.Dispatch<React.SetStateAction<boolean>>;
  placeSuggestions: PlaceSuggestion[];
  setPlaceSuggestions: React.Dispatch<React.SetStateAction<PlaceSuggestion[]>>;
  searchingPlaces: boolean;
  searchAddress: string;
  selectPlace: (place: PlaceSuggestion) => void;
  handleSelectDeparture: (station: StationInfo) => void;
  handleSelectArrival: (station: StationInfo) => void;
  handleSaveInit: () => void;
  handleSave: () => void;
  onClose: () => void;
  isDepartureInQuick: boolean;
  isArrivalInQuick: boolean;
  filteredStations: StationInfo[];
  setFilteredStations: React.Dispatch<React.SetStateAction<StationInfo[]>>;
  searchingStations: boolean;
  stationSearchQuery: string;
  setStationSearchQuery: React.Dispatch<React.SetStateAction<string>>;
  getSelectedStationCode: (type: "departure" | "arrival") => string | undefined;
  handleSelectStation: (
    station: StationInfo,
    type: "departure" | "arrival",
  ) => void;
  handleStationSearchChange: (text: string) => void;
  resolvedPreferredLectures: Record<string, { subject: string; room?: string }>;
  persistTrainPreferencesImmediately: (next: TrainPreferences) => void;
}

const CommuterModalContext = React.createContext<CommuterModalContextType>(
  null as any,
);
const useCommuterModal = () => React.useContext(CommuterModalContext);

function RootPlaceholderScreen() {
  return <View style={{ flex: 1, backgroundColor: "transparent" }} />;
}

// Stazioni celebri e universalmente note come opzioni rapide
const QUICK_DEPARTURES: StationInfo[] = [
  { name: "ROMA TERMINI", code: "S08409", shortName: "Roma Termini" },
  { name: "ROMA TIBURTINA", code: "S08217", shortName: "Roma Tiburtina" },
  {
    name: "FIRENZE SANTA MARIA NOVELLA",
    code: "S06421",
    shortName: "Firenze SMN",
  },
  { name: "NAPOLI CENTRALE", code: "S09218", shortName: "Napoli C.le" },
  { name: "BOLOGNA CENTRALE", code: "S05043", shortName: "Bologna C.le" },
  { name: "MILANO CENTRALE", code: "S01700", shortName: "Milano C.le" },
  { name: "PERUGIA", code: "S07004", shortName: "Perugia" },
  { name: "TERNI", code: "S07226", shortName: "Terni" },
];

const QUICK_ARRIVALS: StationInfo[] = [
  { name: "ROMA TERMINI", code: "S08409", shortName: "Roma Termini" },
  { name: "ROMA TIBURTINA", code: "S08217", shortName: "Roma Tiburtina" },
  { name: "ROMA OSTIENSE", code: "S08406", shortName: "Roma Ostiense" },
  { name: "ROMA TUSCOLANA", code: "S08408", shortName: "Roma Tuscolana" },
  { name: "ROMA S. PIETRO", code: "S08402", shortName: "Roma S. Pietro" },
];

const STATION_SHORT_NAMES: Record<string, string> = {
  S06421: "Firenze SMN",
  S05043: "Bologna C.le",
  S01700: "Milano C.le",
  S09218: "Napoli C.le",
  S08409: "Roma Termini",
  S08217: "Roma Tiburtina",
  S08406: "Roma Ostiense",
  S08408: "Roma Tuscolana",
  S08402: "Roma S. Pietro",
  S07004: "Perugia",
  S07226: "Terni",
};

const PARKING_OPTIONS = [5, 10, 15, 20];
const BUFFER_OPTIONS = [5, 10, 15, 20];

const ITEM_HEIGHT = 70;

const stationKeyExtractor = (item: StationInfo) => `${item.code}_${item.name}`;

const getStationItemLayout = (_: any, index: number) => ({
  length: ITEM_HEIGHT,
  offset: ITEM_HEIGHT * index,
  index,
});

interface StationRowProps {
  station: StationInfo;
  isSelected: boolean;
  primaryColor: string;
  subtleColor: string;
  onPress: (st: StationInfo) => void;
}

const StationRowItem = React.memo(function StationRowItem({
  station,
  isSelected,
  primaryColor,
  subtleColor,
  onPress,
}: StationRowProps) {
  return (
    <TouchableOpacity
      style={[
        styles.stationRow,
        isSelected && {
          borderColor: primaryColor,
          backgroundColor: `${primaryColor}18`,
        },
      ]}
      activeOpacity={0.7}
      onPress={() => onPress(station)}
    >
      <View
        style={[
          styles.stationIconCircle,
          {
            backgroundColor: isSelected ? primaryColor : subtleColor,
          },
        ]}
      >
        <Ionicons
          name={isSelected ? "checkmark" : "train"}
          size={15}
          color={isSelected ? "#ffffff" : primaryColor}
        />
      </View>
      <View style={{ flex: 1 }}>
        <Text
          style={[
            styles.stationName,
            isSelected && {
              color: primaryColor,
              fontWeight: "700",
            },
          ]}
          numberOfLines={1}
        >
          {station.shortName || station.name}
        </Text>
        <Text style={styles.stationCode} numberOfLines={1}>
          Codice RFI: {station.code}
        </Text>
      </View>
      <Ionicons
        name="chevron-forward"
        size={16}
        color={isSelected ? primaryColor : "#52525b"}
      />
    </TouchableOpacity>
  );
});

const EARLY_LEAVE_OPTIONS = [0, 10, 15, 20];
const WEEKDAY_NAMES_FULL = [
  "Domenica",
  "Lunedì",
  "Martedì",
  "Mercoledì",
  "Giovedì",
  "Venerdì",
  "Sabato",
];

function formatPreferredTrainKey(key: string): {
  dayLabel: string;
  dirLabel: string;
  lectureLabel: string;
  sortOrder: number;
} {
  const parts = key.split("_");
  const dir = parts[0] === "return" ? "Ritorno" : "Andata";
  const dayNum = parseInt(parts[1] || "1", 10);
  const dayName = WEEKDAY_NAMES_FULL[dayNum] || `Giorno ${dayNum}`;
  const lectureRaw = parts.slice(2).join("_");
  const lectureLabel =
    !lectureRaw || lectureRaw === "none"
      ? "Nessuna lezione"
      : `Lezione ${lectureRaw}`;
  const normalizedDay = dayNum === 0 ? 7 : dayNum;
  const dirOrder = parts[0] === "return" ? 1 : 0;
  return {
    dayLabel: dayName,
    dirLabel: dir,
    lectureLabel,
    sortOrder: normalizedDay * 10 + dirOrder,
  };
}

function TrainPreferencesSection({
  includeIntercity,
  onToggleIntercity,
  trainPreferences,
  onChangeTrainPreferences,
  onOpenPreferredTrains,
  theme,
}: {
  includeIntercity: boolean;
  onToggleIntercity: (val: boolean) => void;
  trainPreferences: TrainPreferences;
  onChangeTrainPreferences: (next: TrainPreferences) => void;
  onOpenPreferredTrains?: () => void;
  theme: { primary: string; accent: string; bg: string; border: string };
}) {
  const prefs: Required<TrainPreferences> = {
    ...DEFAULT_TRAIN_PREFERENCES,
    ...trainPreferences,
  };
  const effectiveEarlyLeave = prefs.smartReturnEnabled
    ? prefs.maxEarlyLeaveMinutes
    : 0;
  const preferredCount = Object.keys(prefs.preferredTrains || {}).length;

  return (
    <View>
      {/* Opzione Treni Intercity */}
      <View style={[styles.cardDivider, { marginVertical: 14 }]} />
      <View style={styles.switchRow}>
        <View style={{ flex: 1, paddingRight: 12 }}>
          <Text
            style={{
              fontSize: 13,
              fontWeight: "700",
              color: "#ffffff",
              marginBottom: 2,
            }}
          >
            Includi treni Intercity
          </Text>
          <Text style={styles.switchDesc}>
            Mostra anche i treni Intercity (IC)
          </Text>
        </View>
        <Switch
          value={Boolean(includeIntercity)}
          onValueChange={onToggleIntercity}
          trackColor={{ false: theme.border, true: theme.primary }}
          thumbColor={
            Platform.OS === "android"
              ? includeIntercity
                ? theme.primary
                : "#94a3b8"
              : undefined
          }
          ios_backgroundColor={theme.border}
        />
      </View>

      {/* Treni preferiti: riga compatta che apre la schermata dedicata */}
      <View style={[styles.cardDivider, { marginVertical: 14 }]} />
      <TouchableOpacity
        style={styles.switchRow}
        activeOpacity={0.7}
        onPress={onOpenPreferredTrains}
      >
        <View style={{ flex: 1, paddingRight: 12 }}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              marginBottom: 2,
            }}
          >
            <Ionicons
              name={preferredCount > 0 ? "star" : "star-outline"}
              size={14}
              color={preferredCount > 0 ? "#fbbf24" : "#8e8e93"}
            />
            <Text
              style={{
                fontSize: 13,
                fontWeight: "700",
                color: "#ffffff",
              }}
            >
              Treni preferiti
            </Text>
          </View>
          <Text style={styles.switchDesc}>
            {preferredCount > 0
              ? `${preferredCount} ${preferredCount === 1 ? "preferenza salvata" : "preferenze salvate"} • Tocca per gestire`
              : 'Nessuna preferenza • Impostabile dalla stella "Preferenza" in Viaggio'}
          </Text>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          {preferredCount > 0 && (
            <View
              style={[
                styles.preferredCountBadge,
                { borderColor: theme.border, backgroundColor: theme.bg },
              ]}
            >
              <Text
                style={[
                  styles.preferredCountBadgeText,
                  { color: theme.accent },
                ]}
              >
                {preferredCount}
              </Text>
            </View>
          )}
          <Ionicons name="chevron-forward" size={18} color="#8e8e93" />
        </View>
      </TouchableOpacity>

      {/* Consiglio Rientro Anticipato Intelligente */}
      <View style={[styles.cardDivider, { marginVertical: 14 }]} />
      <View>
        <Text
          style={{
            fontSize: 13,
            fontWeight: "700",
            color: "#ffffff",
            marginBottom: 4,
          }}
        >
          Consiglio rientro anticipato
        </Text>
        <Text style={[styles.switchDesc, { marginBottom: 10 }]}>
          Minuti massimi di lezione che puoi perdere per anticipare un treno
          vantaggioso
        </Text>
        <View style={styles.trainPrefRow}>
          {EARLY_LEAVE_OPTIONS.map((mins) => {
            const isSelected = effectiveEarlyLeave === mins;
            return (
              <TouchableOpacity
                key={mins}
                style={[
                  styles.trainPrefChip,
                  isSelected && [
                    styles.chipActive,
                    {
                      backgroundColor: `${theme.primary}25`,
                      borderColor: theme.primary,
                      shadowColor: theme.primary,
                    },
                  ],
                ]}
                activeOpacity={0.7}
                onPress={() =>
                  onChangeTrainPreferences({
                    ...prefs,
                    smartReturnEnabled: mins > 0,
                    maxEarlyLeaveMinutes: mins,
                  })
                }
              >
                <Ionicons
                  name={isSelected ? "checkmark-circle" : "time-outline"}
                  size={13}
                  color={isSelected ? theme.accent : "#8e8e93"}
                  style={{ marginRight: 5 }}
                />
                <Text
                  style={[
                    styles.chipText,
                    { fontSize: 12 },
                    isSelected && [
                      styles.chipTextActive,
                      { color: theme.accent },
                    ],
                  ]}
                  numberOfLines={1}
                >
                  {mins === 0 ? "Off" : `${mins}m`}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
    </View>
  );
}

function CommuterConfigModalContent({
  config,
  onClose,
  onSave,
}: Omit<Props, "visible">) {
  const { theme } = useTheme();
  const [localConfig, setLocalConfig] = useState<CommuterConfig>(() =>
    JSON.parse(JSON.stringify(config)),
  );
  const [stationSearchQuery, setStationSearchQuery] = useState("");
  const [filteredStations, setFilteredStations] =
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

  const isUnconfigured =
    !config?.enabled ||
    !config?.originAddress ||
    config?.originAddress.trim() === "";

  const [initOriginAddress, setInitOriginAddress] = useState("");
  const [initOriginCoords, setInitOriginCoords] = useState<
    { lat: number; lon: number } | undefined
  >(undefined);
  const [initCarMode, setInitCarMode] = useState<"yes" | "no" | null>(null);
  const [initParkingBufferMinutes, setInitParkingBufferMinutes] = useState<
    number | null
  >(null);
  const [initDepartureStation, setInitDepartureStation] =
    useState<StationInfo | null>(null);
  const [initArrivalStation, setInitArrivalStation] =
    useState<StationInfo | null>(null);
  const [initBufferMinutes, setInitBufferMinutes] = useState<number | null>(
    null,
  );
  const [initIncludeIntercity, setInitIncludeIntercity] =
    useState<boolean>(false);
  const [initTrainPreferences, setInitTrainPreferences] =
    useState<TrainPreferences>(() => ({
      ...DEFAULT_TRAIN_PREFERENCES,
    }));
  const [initUrbanMode, setInitUrbanMode] = useState<"auto" | "walk">("auto");
  const [initDrivingEstimate, setInitDrivingEstimate] =
    useState<DrivingEstimate | null>(null);
  const [initCalculatingDriving, setInitCalculatingDriving] = useState(false);

  // Calcolo automatico della stima stradale in modalità inizializzazione
  useEffect(() => {
    if (
      !isUnconfigured ||
      initCarMode !== "yes" ||
      initOriginAddress.trim().length < 2 ||
      !initDepartureStation
    ) {
      return;
    }
    let cancelled = false;
    const fetchDriveEstimate = async () => {
      setInitCalculatingDriving(true);
      try {
        const est = await calculateDrivingEstimate(
          initOriginAddress,
          initDepartureStation.shortName || initDepartureStation.name,
          undefined,
          initOriginCoords,
        );
        if (!cancelled) {
          const ceilDuration = Math.ceil(est.durationMinutes);
          setInitDrivingEstimate({
            ...est,
            durationMinutes: ceilDuration,
          });
        }
      } catch (err) {
        console.warn("Errore calcolo guida:", err);
      } finally {
        if (!cancelled) setInitCalculatingDriving(false);
      }
    };

    const timer = setTimeout(fetchDriveEstimate, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    isUnconfigured,
    initCarMode,
    initOriginAddress,
    initOriginCoords,
    initDepartureStation,
  ]);

  // Calcolo automatico della stima di guida all'apertura o modifica indirizzo / stazione (modalità modifica)
  const originCoords = localConfig.originCoords;
  useEffect(() => {
    if (isUnconfigured) return;
    let cancelled = false;
    const fetchDriveEstimate = async () => {
      if (!localConfig.carLeg.enabled) return;
      setCalculatingDriving(true);
      try {
        const est = await calculateDrivingEstimate(
          localConfig.originAddress,
          localConfig.departureStation.shortName ||
            localConfig.departureStation.name,
          undefined,
          originCoords,
        );
        if (!cancelled) {
          const baseDuration = Math.ceil(
            est.baseDurationMinutes || est.durationMinutes,
          );
          const trafficDelay = Math.max(
            0,
            Math.ceil(est.trafficDelayMinutes || 0),
          );
          const totalDuration = Math.max(2, baseDuration + trafficDelay);
          setDrivingEstimate({
            ...est,
            durationMinutes: totalDuration,
            baseDurationMinutes: baseDuration,
            trafficDelayMinutes: trafficDelay,
          });
          setLocalConfig((prev) => ({
            ...prev,
            carLeg: {
              ...prev.carLeg,
              durationMinutes: totalDuration,
              baseDurationMinutes: baseDuration,
              trafficDelayMinutes: trafficDelay,
              trafficCondition: est.trafficCondition,
              trafficFluency: est.fluencyStatus,
              distanceKm: est.distanceKm,
              stationAddress: getStationNavigationQuery(
                prev.departureStation.shortName || prev.departureStation.name,
              ),
            },
          }));
        }
      } catch (err) {
        console.warn("Errore calcolo guida:", err);
      } finally {
        if (!cancelled) setCalculatingDriving(false);
      }
    };

    const timer = setTimeout(fetchDriveEstimate, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    isUnconfigured,
    localConfig.originAddress,
    originCoords,
    localConfig.departureStation.shortName,
    localConfig.departureStation.name,
    localConfig.carLeg.enabled,
  ]);

  // Ricerca luoghi in stile Mappe
  const searchAddress = isUnconfigured
    ? initOriginAddress
    : localConfig.originAddress;
  useEffect(() => {
    if (!placeSearchActive || searchAddress.trim().length < 3) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setSearchingPlaces(true);
      const results = await searchPlaces(searchAddress, controller.signal);
      if (!controller.signal.aborted) {
        setPlaceSuggestions(results);
        setSearchingPlaces(false);
      }
    }, 350);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [searchAddress, placeSearchActive]);

  const selectPlace = useCallback(
    (place: PlaceSuggestion) => {
      setPlaceSearchActive(false);
      setPlaceSuggestions([]);
      if (isUnconfigured) {
        setInitOriginAddress(place.label);
        setInitOriginCoords({ lat: place.lat, lon: place.lon });
      } else {
        setLocalConfig((prev) => ({
          ...prev,
          originAddress: place.label,
          originCoords: { lat: place.lat, lon: place.lon },
        }));
      }
    },
    [isUnconfigured],
  );

  const handleStationSearchChange = useCallback((text: string) => {
    setStationSearchQuery(text);
    if (!text.trim()) {
      setFilteredStations(ALL_STATIONS);
      setSearchingStations(false);
      return;
    }
    setSearchingStations(true);
    searchStations(text).then((res) => {
      setFilteredStations(res);
      setSearchingStations(false);
    });
  }, []);

  const handleSelectDeparture = useCallback((station: StationInfo) => {
    Keyboard.dismiss();
    setLocalConfig((prev) => ({
      ...prev,
      departureStation: station,
      carLeg: {
        ...prev.carLeg,
        stationAddress: getStationNavigationQuery(
          station.shortName || station.name,
        ),
      },
    }));
    setStationSearchQuery("");
  }, []);

  const handleSelectArrival = useCallback((station: StationInfo) => {
    Keyboard.dismiss();
    setLocalConfig((prev) => ({
      ...prev,
      arrivalStation: station,
    }));
    setStationSearchQuery("");
  }, []);

  const handleSelectStation = useCallback(
    (station: StationInfo, type: "departure" | "arrival") => {
      Keyboard.dismiss();
      if (isUnconfigured) {
        if (type === "departure") {
          setInitDepartureStation(station);
        } else {
          setInitArrivalStation(station);
        }
      } else {
        if (type === "departure") {
          handleSelectDeparture(station);
        } else {
          handleSelectArrival(station);
        }
      }
      setStationSearchQuery("");
      setFilteredStations(ALL_STATIONS);
    },
    [isUnconfigured, handleSelectDeparture, handleSelectArrival],
  );

  const getSelectedStationCode = useCallback(
    (type: "departure" | "arrival") => {
      if (isUnconfigured) {
        return type === "departure"
          ? initDepartureStation?.code
          : initArrivalStation?.code;
      }
      return type === "departure"
        ? localConfig.departureStation.code
        : localConfig.arrivalStation.code;
    },
    [
      isUnconfigured,
      initDepartureStation?.code,
      initArrivalStation?.code,
      localConfig.departureStation.code,
      localConfig.arrivalStation.code,
    ],
  );

  const isInitComplete = useMemo(() => {
    const hasOrigin = initOriginAddress.trim().length >= 2;
    const hasCarChoice =
      initCarMode === "no" ||
      (initCarMode === "yes" && initParkingBufferMinutes !== null);
    const hasStations =
      initDepartureStation !== null && initArrivalStation !== null;
    const hasBuffer = initBufferMinutes !== null;
    return hasOrigin && hasCarChoice && hasStations && hasBuffer;
  }, [
    initOriginAddress,
    initCarMode,
    initParkingBufferMinutes,
    initDepartureStation,
    initArrivalStation,
    initBufferMinutes,
  ]);

  const handleSaveInit = useCallback(() => {
    if (!isInitComplete || !initDepartureStation || !initArrivalStation) return;
    const baseMin = Math.ceil(
      initDrivingEstimate?.baseDurationMinutes ||
        initDrivingEstimate?.durationMinutes ||
        15,
    );
    const trafficDelay = Math.max(
      0,
      Math.ceil(initDrivingEstimate?.trafficDelayMinutes || 0),
    );
    const totalDuration = Math.max(2, baseMin + trafficDelay);
    const newConfig: CommuterConfig = {
      ...config,
      enabled: true,
      originAddress: initOriginAddress.trim(),
      originCoords: initOriginCoords,
      carLeg: {
        enabled: initCarMode === "yes",
        durationMinutes: totalDuration,
        baseDurationMinutes: baseMin,
        trafficDelayMinutes: trafficDelay,
        trafficCondition: initDrivingEstimate?.trafficCondition,
        trafficFluency: initDrivingEstimate?.fluencyStatus,
        distanceKm: initDrivingEstimate?.distanceKm || 6.2,
        parkingBufferMinutes: initParkingBufferMinutes ?? 7,
        stationAddress: getStationNavigationQuery(
          initDepartureStation.shortName || initDepartureStation.name,
        ),
      },
      departureStation: initDepartureStation,
      arrivalStation: initArrivalStation,
      includeIntercity: initIncludeIntercity,
      trainPreferences: {
        ...DEFAULT_TRAIN_PREFERENCES,
        ...initTrainPreferences,
      },
      transitLeg: {
        ...config?.transitLeg,
        preferredMode: initUrbanMode,
      },
      bufferMinutes: initBufferMinutes ?? 10,
    };
    onSave(newConfig);
    onClose();
  }, [
    isInitComplete,
    initDepartureStation,
    initArrivalStation,
    initDrivingEstimate,
    config,
    initOriginAddress,
    initOriginCoords,
    initCarMode,
    initParkingBufferMinutes,
    initBufferMinutes,
    initIncludeIntercity,
    initTrainPreferences,
    initUrbanMode,
    onSave,
    onClose,
  ]);

  const handleSave = useCallback(() => {
    const baseDuration = Math.ceil(
      localConfig.carLeg.baseDurationMinutes ||
        localConfig.carLeg.durationMinutes ||
        15,
    );
    const trafficDelay = Math.max(
      0,
      Math.ceil(
        localConfig.carLeg.trafficDelayMinutes ??
          drivingEstimate?.trafficDelayMinutes ??
          0,
      ),
    );
    const totalDuration = Math.max(2, baseDuration + trafficDelay);

    onSave({
      ...localConfig,
      enabled: true,
      carLeg: {
        ...localConfig.carLeg,
        durationMinutes: totalDuration,
        baseDurationMinutes: baseDuration,
        trafficDelayMinutes: trafficDelay,
        trafficCondition:
          localConfig.carLeg.trafficCondition ||
          drivingEstimate?.trafficCondition,
        trafficFluency:
          localConfig.carLeg.trafficFluency || drivingEstimate?.fluencyStatus,
        stationAddress: getStationNavigationQuery(
          localConfig.departureStation.shortName ||
            localConfig.departureStation.name,
        ),
      },
    });
    onClose();
  }, [localConfig, drivingEstimate, onSave, onClose]);

  const isDepartureInQuick = QUICK_DEPARTURES.some(
    (s) => s.code === localConfig.departureStation.code,
  );

  const isArrivalInQuick = QUICK_ARRIVALS.some(
    (s) => s.code === localConfig.arrivalStation.code,
  );

  const sheetTitle = isUnconfigured
    ? "Configura viaggio"
    : "Impostazioni viaggio";

  const [resolvedPreferredLectures, setResolvedPreferredLectures] = useState<
    Record<string, { subject: string; room?: string }>
  >({});

  useEffect(() => {
    const prefMap =
      (isUnconfigured
        ? initTrainPreferences?.preferredTrains
        : localConfig.trainPreferences?.preferredTrains) || {};
    const missing = Object.entries(prefMap).filter(
      ([, pref]) => !pref?.subject?.trim(),
    );
    if (missing.length === 0) return;

    let cancelled = false;
    (async () => {
      try {
        const degreeUrl = await AsyncStorage.getItem("selectedDegreeUrl");
        const tabUrl =
          (degreeUrl
            ? await AsyncStorage.getItem(`defaultTabUrl_${degreeUrl}`)
            : null) || (await AsyncStorage.getItem("defaultTabUrl"));
        const [sched, manuals] = await Promise.all([
          tabUrl
            ? getCachedScheduleData(tabUrl, degreeUrl)
                .then((cached) => cached || fetchScheduleData(tabUrl))
                .catch(() => null)
            : Promise.resolve(null),
          getManualEvents(degreeUrl || undefined).catch(() => []),
        ]);
        if (cancelled) return;

        const nextResolved: Record<string, { subject: string; room?: string }> = {};
        for (const [key] of missing) {
          const parts = key.split("_");
          const dayNum = parseInt(parts[1] || "", 10);
          const lectureRaw = parts.slice(2).join("_");
          if (isNaN(dayNum) || dayNum < 1 || dayNum > 5 || !lectureRaw || lectureRaw === "none") {
            continue;
          }
          const schedIdx = dayNum - 1;
          const official = sched?.days?.[schedIdx] || [];
          const manualForDay = (manuals || []).filter((m) => m.dayIndex === schedIdx);
          const allForDay = [
            ...official.map((c) => ({
              startTime: c.startTime,
              endTime: c.endTime,
              subject: c.subject,
              room: c.room,
            })),
            ...manualForDay.map((m) => ({
              startTime: m.startTime,
              endTime: m.endTime,
              subject: m.subject,
              room: m.room,
            })),
          ];
          const match = allForDay.find(
            (c) => `${c.startTime || ""}-${c.endTime || ""}` === lectureRaw,
          );
          if (match?.subject) {
            nextResolved[key] = {
              subject: match.subject,
              room: match.room,
            };
          }
        }
        if (!cancelled && Object.keys(nextResolved).length > 0) {
          setResolvedPreferredLectures(nextResolved);
        }
      } catch {}
    })();

    return () => {
      cancelled = true;
    };
  }, [isUnconfigured, initTrainPreferences, localConfig.trainPreferences]);

  const latestConfigRef = useRef<CommuterConfig>(config);
  useEffect(() => {
    latestConfigRef.current = config;
  }, [config]);

  const persistTrainPreferencesImmediately = useCallback(
    (nextPrefs: TrainPreferences) => {
      const nextCfg: CommuterConfig = {
        ...latestConfigRef.current,
        trainPreferences: nextPrefs,
      };
      latestConfigRef.current = nextCfg;
      onSave(nextCfg);
    },
    [onSave],
  );

  const contextValue = useMemo(
    () => ({
      theme,
      isUnconfigured,
      isInitComplete,
      sheetTitle,
      initOriginAddress,
      setInitOriginAddress,
      initOriginCoords,
      setInitOriginCoords,
      initCarMode,
      setInitCarMode,
      initParkingBufferMinutes,
      setInitParkingBufferMinutes,
      initDepartureStation,
      setInitDepartureStation,
      initArrivalStation,
      setInitArrivalStation,
      initBufferMinutes,
      setInitBufferMinutes,
      initIncludeIntercity,
      setInitIncludeIntercity,
      initTrainPreferences,
      setInitTrainPreferences,
      initUrbanMode,
      setInitUrbanMode,
      initDrivingEstimate,
      initCalculatingDriving,
      localConfig,
      setLocalConfig,
      drivingEstimate,
      calculatingDriving,
      placeSearchActive,
      setPlaceSearchActive,
      placeSuggestions,
      setPlaceSuggestions,
      searchingPlaces,
      searchAddress,
      selectPlace,
      handleSelectDeparture,
      handleSelectArrival,
      handleSaveInit,
      handleSave,
      onClose,
      isDepartureInQuick,
      isArrivalInQuick,
      filteredStations,
      setFilteredStations,
      searchingStations,
      stationSearchQuery,
      setStationSearchQuery,
      getSelectedStationCode,
      handleSelectStation,
      handleStationSearchChange,
      resolvedPreferredLectures,
      persistTrainPreferencesImmediately,
    }),
    [
      theme,
      isUnconfigured,
      isInitComplete,
      sheetTitle,
      initOriginAddress,
      initOriginCoords,
      initCarMode,
      initParkingBufferMinutes,
      initDepartureStation,
      initArrivalStation,
      initBufferMinutes,
      initIncludeIntercity,
      initTrainPreferences,
      initUrbanMode,
      initDrivingEstimate,
      initCalculatingDriving,
      localConfig,
      drivingEstimate,
      calculatingDriving,
      placeSearchActive,
      placeSuggestions,
      searchingPlaces,
      searchAddress,
      selectPlace,
      handleSelectDeparture,
      handleSelectArrival,
      handleSaveInit,
      handleSave,
      onClose,
      isDepartureInQuick,
      isArrivalInQuick,
      filteredStations,
      searchingStations,
      stationSearchQuery,
      getSelectedStationCode,
      handleSelectStation,
      handleStationSearchChange,
      resolvedPreferredLectures,
      persistTrainPreferencesImmediately,
    ],
  );

  const navTheme = useMemo(
    () => ({
      ...DarkTheme,
      colors: {
        ...DarkTheme.colors,
        background: UNIFORM_MODAL_BG,
        card: UNIFORM_MODAL_BG,
        text: "#ffffff",
        primary: "#ffffff",
      },
    }),
    [],
  );

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <CommuterModalContext.Provider value={contextValue}>
        <NavigationIndependentTree>
          <NavigationContainer
            theme={navTheme}
            initialState={{
              index: 1,
              routes: [{ name: "RootPlaceholder" }, { name: "CommuterSheet" }],
            }}
          >
            <RootModalStack.Navigator
              screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: "transparent" },
              }}
            >
              <RootModalStack.Screen
                name="RootPlaceholder"
                component={RootPlaceholderScreen}
              />
              <RootModalStack.Screen
                name="CommuterSheet"
                component={CommuterSheetScreen}
                options={{
                  presentation: "formSheet",
                  sheetAllowedDetents: [1.0],
                  sheetGrabberVisible: true,
                  sheetExpandsWhenScrolledToEdge: true,
                  gestureEnabled: true,
                  animation: "slide_from_bottom",
                  contentStyle: { backgroundColor: UNIFORM_MODAL_BG },
                }}
              />
            </RootModalStack.Navigator>
          </NavigationContainer>
        </NavigationIndependentTree>
      </CommuterModalContext.Provider>
    </View>
  );
}

export function CommuterConfigModal(props: Props) {
  if (!props.visible) return null;
  return <CommuterConfigModalContent {...props} />;
}

function MainFormScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const {
    theme,
    isUnconfigured,
    isInitComplete,
    sheetTitle,
    initOriginAddress,
    setInitOriginAddress,
    setInitOriginCoords,
    initCarMode,
    setInitCarMode,
    initParkingBufferMinutes,
    setInitParkingBufferMinutes,
    initDepartureStation,
    setInitDepartureStation,
    initArrivalStation,
    setInitArrivalStation,
    initBufferMinutes,
    setInitBufferMinutes,
    initIncludeIntercity,
    setInitIncludeIntercity,
    initTrainPreferences,
    setInitTrainPreferences,
    initUrbanMode,
    setInitUrbanMode,
    initDrivingEstimate,
    initCalculatingDriving,
    localConfig,
    setLocalConfig,
    drivingEstimate,
    calculatingDriving,
    placeSearchActive,
    setPlaceSearchActive,
    placeSuggestions,
    setPlaceSuggestions,
    searchingPlaces,
    selectPlace,
    handleSelectDeparture,
    handleSelectArrival,
    handleSaveInit,
    handleSave,
    onClose,
    isDepartureInQuick,
    isArrivalInQuick,
    setStationSearchQuery,
    setFilteredStations,
  } = useCommuterModal();

  const isOtherInitDepartureSelected = useMemo(
    () =>
      !!initDepartureStation &&
      !QUICK_DEPARTURES.some((s) => s.code === initDepartureStation.code),
    [initDepartureStation],
  );

  const isOtherInitArrivalSelected = useMemo(
    () =>
      !!initArrivalStation &&
      !QUICK_ARRIVALS.some((s) => s.code === initArrivalStation.code),
    [initArrivalStation],
  );

  const openStationPicker = useCallback(
    (type: "departure" | "arrival") => {
      setStationSearchQuery("");
      setFilteredStations(ALL_STATIONS);
      navigation.navigate("StationPicker", { type });
    },
    [navigation, setStationSearchQuery, setFilteredStations],
  );

  useEffect(() => {
    navigation.setOptions({
      headerShown: true,
      title: sheetTitle,
      headerTintColor: "#ffffff",
      headerStyle: { backgroundColor: UNIFORM_MODAL_BG },
      headerShadowVisible: false,
      headerTitleStyle: {
        color: "#ffffff",
        fontSize: 17,
        fontWeight: "600",
      },
      unstable_headerLeftItems: () => [
        {
          type: "button",
          label: "",
          icon: { type: "sfSymbol", name: "chevron.left" },
          tintColor: "#ffffff",
          onPress: onClose,
          accessibilityLabel: "Indietro",
        },
      ],
      unstable_headerRightItems: () => [
        {
          type: "button",
          label: "",
          icon: { type: "sfSymbol", name: "checkmark" },
          variant: "prominent" as const,
          prominent: true,
          tintColor: theme.primary,
          disabled: isUnconfigured ? !isInitComplete : false,
          onPress: isUnconfigured ? handleSaveInit : handleSave,
          accessibilityLabel: "Salva",
        },
      ],
    });
  }, [
    navigation,
    sheetTitle,
    theme.primary,
    isUnconfigured,
    isInitComplete,
    handleSaveInit,
    handleSave,
    onClose,
  ]);

  return (
    <View
      collapsable={false}
      style={{ flex: 1, backgroundColor: UNIFORM_MODAL_BG }}
    >
      <KeyboardAvoidingView
        collapsable={false}
        style={{ flex: 1, backgroundColor: UNIFORM_MODAL_BG }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        {isUnconfigured ? (
          /* Form Inizializzazione Primo Avvio (senza nulla di default) */
          <ScrollView
            style={styles.initScrollView}
            contentContainerStyle={[
              styles.initScrollContent,
              { paddingBottom: Math.max(insets.bottom, 24) + 84 },
            ]}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {/* Hero Header */}
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
                Imposta il tuo tragitto pendolare per calcolare treni, traffico
                e coincidenze verso le aule, oppure configura più tardi.
              </Text>
            </View>

            {/* 1. LUOGO DI PARTENZA */}
            <View style={styles.pillSection}>
              <Text style={styles.pillSectionLabel}>LUOGO DI PARTENZA</Text>
              <View
                style={[
                  styles.iosPillInputWrapper,
                  initOriginAddress.trim().length >= 2 && {
                    borderColor: theme.primary,
                    backgroundColor: "rgba(28, 28, 30, 0.95)",
                  },
                ]}
              >
                <Ionicons
                  name="location"
                  size={17}
                  color={
                    initOriginAddress.trim().length >= 2
                      ? theme.accent
                      : "#71717a"
                  }
                  style={{ marginRight: 8 }}
                />
                <TextInput
                  style={styles.iosPillInput}
                  value={initOriginAddress}
                  onFocus={() => setPlaceSearchActive(true)}
                  onChangeText={(txt) => {
                    setPlaceSearchActive(true);
                    setInitOriginAddress(txt);
                    setInitOriginCoords(undefined);
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
                {initOriginAddress.length > 0 && !searchingPlaces && (
                  <TouchableOpacity
                    onPress={() => {
                      setInitOriginAddress("");
                      setInitOriginCoords(undefined);
                      setPlaceSuggestions([]);
                    }}
                  >
                    <Ionicons name="close-circle" size={18} color="#71717a" />
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
                        <Text style={styles.suggestionTitle} numberOfLines={1}>
                          {place.title}
                        </Text>
                        {!!place.subtitle && (
                          <Text
                            style={styles.suggestionSubtitle}
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

            {/* 2. TRAGITTO VERSO LA STAZIONE */}
            <View style={styles.pillSection}>
              <Text style={styles.pillSectionLabel}>
                TRAGITTO VERSO LA STAZIONE
              </Text>
              <View style={styles.channelRowEqual}>
                <TouchableOpacity
                  style={[
                    styles.chipEqual,
                    initCarMode === "yes" && [
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
                    setInitCarMode("yes");
                    if (initParkingBufferMinutes === null) {
                      setInitParkingBufferMinutes(10);
                    }
                  }}
                >
                  <Ionicons
                    name={
                      initCarMode === "yes"
                        ? "checkmark-circle"
                        : "car-sport-outline"
                    }
                    size={16}
                    color={initCarMode === "yes" ? "#ffffff" : "#8e8e93"}
                    style={{ marginRight: 6 }}
                  />
                  <Text
                    style={[
                      styles.chipText,
                      initCarMode === "yes" && styles.chipTextActive,
                    ]}
                  >
                    Auto
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.chipEqual,
                    initCarMode === "no" && [
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
                    setInitCarMode("no");
                    setInitParkingBufferMinutes(null);
                  }}
                >
                  <Ionicons
                    name={
                      initCarMode === "no" ? "checkmark-circle" : "walk-outline"
                    }
                    size={16}
                    color={initCarMode === "no" ? "#ffffff" : "#8e8e93"}
                    style={{ marginRight: 6 }}
                  />
                  <Text
                    style={[
                      styles.chipText,
                      initCarMode === "no" && styles.chipTextActive,
                    ]}
                  >
                    No mezzi
                  </Text>
                </TouchableOpacity>
              </View>

              {initCarMode === "yes" && (
                <View style={styles.subPillGroup}>
                  <Text style={styles.subPillLabel}>MARGINE DI SICUREZZA</Text>
                  <View style={styles.timeBufferContainer}>
                    <TouchableOpacity
                      style={[
                        styles.zeroOptionChip,
                        initParkingBufferMinutes === 0 && [
                          styles.chipActive,
                          {
                            backgroundColor: `${theme.primary}25`,
                            borderColor: theme.primary,
                            shadowColor: theme.primary,
                          },
                        ],
                      ]}
                      activeOpacity={0.7}
                      onPress={() => setInitParkingBufferMinutes(0)}
                    >
                      <Ionicons
                        name={
                          initParkingBufferMinutes === 0
                            ? "checkmark-circle"
                            : "time-outline"
                        }
                        size={13}
                        color={
                          initParkingBufferMinutes === 0
                            ? theme.accent
                            : "#8e8e93"
                        }
                        style={{ marginRight: 6 }}
                      />
                      <Text
                        style={[
                          styles.chipText,
                          initParkingBufferMinutes === 0 && [
                            styles.chipTextActive,
                            { color: theme.accent },
                          ],
                          { fontSize: 12, fontWeight: "600" },
                        ]}
                        numberOfLines={1}
                      >
                        Nessun margine
                      </Text>
                    </TouchableOpacity>

                    <View style={styles.timeQuickRow}>
                      {[5, 10, 15, 20].map((mins) => {
                        const isSel = initParkingBufferMinutes === mins;
                        return (
                          <TouchableOpacity
                            key={mins}
                            style={[
                              styles.timeQuickChip,
                              isSel && [
                                styles.chipActive,
                                {
                                  backgroundColor: `${theme.primary}25`,
                                  borderColor: theme.primary,
                                  shadowColor: theme.primary,
                                },
                              ],
                            ]}
                            activeOpacity={0.7}
                            onPress={() => setInitParkingBufferMinutes(mins)}
                          >
                            <Ionicons
                              name={isSel ? "checkmark-circle" : "time-outline"}
                              size={13}
                              color={isSel ? theme.accent : "#8e8e93"}
                              style={{ marginRight: 4 }}
                            />
                            <Text
                              style={[
                                styles.chipText,
                                isSel && [
                                  styles.chipTextActive,
                                  { color: theme.accent },
                                ],
                                { fontSize: 12 },
                              ]}
                              numberOfLines={1}
                            >
                              {mins} min
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>

                    {initParkingBufferMinutes !== null && (
                      <View style={styles.timeStepperCenteredRow}>
                        <TouchableOpacity
                          style={[
                            styles.fineStepPill,
                            initParkingBufferMinutes === 0 && {
                              opacity: 0.35,
                            },
                          ]}
                          disabled={initParkingBufferMinutes === 0}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                          onPress={() =>
                            setInitParkingBufferMinutes((p) =>
                              Math.max(0, (p ?? 10) - 1),
                            )
                          }
                        >
                          <Ionicons name="remove" size={14} color="#ffffff" />
                        </TouchableOpacity>
                        <View
                          style={[
                            styles.fineStepValuePill,
                            {
                              borderColor: theme.primary,
                              backgroundColor: theme.subtle,
                              flexDirection: "row",
                              alignItems: "center",
                              justifyContent: "center",
                            },
                          ]}
                        >
                          <Text
                            style={[
                              styles.fineStepValueText,
                              { color: theme.accent },
                            ]}
                          >
                            {initParkingBufferMinutes === 0
                              ? "Nessun margine"
                              : `${initParkingBufferMinutes} min`}
                          </Text>
                        </View>
                        <TouchableOpacity
                          style={styles.fineStepPill}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                          onPress={() =>
                            setInitParkingBufferMinutes((p) => (p ?? 10) + 1)
                          }
                        >
                          <Ionicons name="add" size={14} color="#ffffff" />
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>
                </View>
              )}
            </View>

            {/* 3. TRATTA FERROVIARIA */}
            <View style={styles.pillSection}>
              <Text style={styles.pillSectionLabel}>STAZIONE DI PARTENZA</Text>
              <View style={styles.stationGrid}>
                {QUICK_DEPARTURES.map((st) => {
                  const isSel = initDepartureStation?.code === st.code;
                  return (
                    <TouchableOpacity
                      key={st.code}
                      style={[
                        styles.stationGridItem,
                        isSel && [
                          styles.chipActive,
                          {
                            backgroundColor: `${theme.primary}25`,
                            borderColor: theme.primary,
                            shadowColor: theme.primary,
                          },
                        ],
                      ]}
                      activeOpacity={0.7}
                      onPress={() => setInitDepartureStation(st)}
                    >
                      <Ionicons
                        name={isSel ? "checkmark-circle" : "train-outline"}
                        size={14}
                        color={isSel ? theme.accent : "#8e8e93"}
                        style={{ marginRight: 5 }}
                      />
                      <Text
                        style={[
                          styles.chipText,
                          isSel && [
                            styles.chipTextActive,
                            { color: theme.accent },
                          ],
                        ]}
                        numberOfLines={1}
                        adjustsFontSizeToFit
                        minimumFontScale={0.7}
                      >
                        {STATION_SHORT_NAMES[st.code] ||
                          st.shortName ||
                          st.name}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
                <TouchableOpacity
                  style={[
                    styles.stationGridItem,
                    isOtherInitDepartureSelected
                      ? [
                          styles.chipActive,
                          {
                            backgroundColor: `${theme.primary}25`,
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
                  onPress={() => openStationPicker("departure")}
                >
                  <Ionicons
                    name={
                      isOtherInitDepartureSelected
                        ? "checkmark-circle"
                        : "search"
                    }
                    size={14}
                    color={theme.accent}
                    style={{ marginRight: 5 }}
                  />
                  <Text
                    style={[
                      styles.chipText,
                      isOtherInitDepartureSelected
                        ? [styles.chipTextActive, { color: theme.accent }]
                        : { color: theme.accent, fontWeight: "600" },
                    ]}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.7}
                  >
                    {isOtherInitDepartureSelected
                      ? STATION_SHORT_NAMES[initDepartureStation?.code ?? ""] ||
                        initDepartureStation?.shortName ||
                        initDepartureStation?.name ||
                        "Altro..."
                      : "Altro..."}
                  </Text>
                </TouchableOpacity>
              </View>

              <Text style={[styles.pillSectionLabel, { marginTop: 18 }]}>
                STAZIONE DI ARRIVO (ROMA)
              </Text>
              <View style={styles.stationGrid}>
                {QUICK_ARRIVALS.map((st) => {
                  const isSel = initArrivalStation?.code === st.code;
                  return (
                    <TouchableOpacity
                      key={st.code}
                      style={[
                        styles.stationGridItem,
                        isSel && [
                          styles.chipActive,
                          {
                            backgroundColor: `${theme.primary}25`,
                            borderColor: theme.primary,
                            shadowColor: theme.primary,
                          },
                        ],
                      ]}
                      activeOpacity={0.7}
                      onPress={() => setInitArrivalStation(st)}
                    >
                      <Ionicons
                        name={isSel ? "checkmark-circle" : "flag-outline"}
                        size={14}
                        color={isSel ? theme.accent : "#8e8e93"}
                        style={{ marginRight: 5 }}
                      />
                      <Text
                        style={[
                          styles.chipText,
                          isSel && [
                            styles.chipTextActive,
                            { color: theme.accent },
                          ],
                        ]}
                        numberOfLines={1}
                        adjustsFontSizeToFit
                        minimumFontScale={0.7}
                      >
                        {STATION_SHORT_NAMES[st.code] ||
                          st.shortName ||
                          st.name}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
                <TouchableOpacity
                  style={[
                    styles.stationGridItem,
                    isOtherInitArrivalSelected
                      ? [
                          styles.chipActive,
                          {
                            backgroundColor: `${theme.primary}25`,
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
                  onPress={() => openStationPicker("arrival")}
                >
                  <Ionicons
                    name={
                      isOtherInitArrivalSelected ? "checkmark-circle" : "search"
                    }
                    size={14}
                    color={theme.accent}
                    style={{ marginRight: 5 }}
                  />
                  <Text
                    style={[
                      styles.chipText,
                      isOtherInitArrivalSelected
                        ? [styles.chipTextActive, { color: theme.accent }]
                        : { color: theme.accent, fontWeight: "600" },
                    ]}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.7}
                  >
                    {isOtherInitArrivalSelected
                      ? STATION_SHORT_NAMES[initArrivalStation?.code ?? ""] ||
                        initArrivalStation?.shortName ||
                        initArrivalStation?.name ||
                        "Altro..."
                      : "Altro..."}
                  </Text>
                </TouchableOpacity>
              </View>

              {/* Anteprima live distanza e tempi reali se auto=sì e origine+stazione scelte */}
              {initCarMode === "yes" &&
                initOriginAddress.trim().length >= 2 &&
                initDepartureStation && (
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
                        {initOriginAddress} ➔{" "}
                        {initDepartureStation.shortName ||
                          initDepartureStation.name}
                      </Text>
                      <Text
                        style={[
                          styles.liveRoutePreviewStats,
                          { color: theme.accent },
                        ]}
                      >
                        {initCalculatingDriving
                          ? "Calcolo distanza e tempi reali in corso..."
                          : initDrivingEstimate
                            ? `${initDrivingEstimate.distanceKm} km stradali • ~${initDrivingEstimate.durationMinutes} min • ${initDrivingEstimate.trafficCondition || "Viabilità attuale: traffico scorrevole"}`
                            : "Percorso stradale pronto"}
                      </Text>
                    </View>
                    {initCalculatingDriving && (
                      <ActivityIndicator size="small" color={theme.accent} />
                    )}
                  </View>
                )}

              {/* Preferenze Treni */}
              <TrainPreferencesSection
                includeIntercity={Boolean(initIncludeIntercity)}
                onToggleIntercity={setInitIncludeIntercity}
                trainPreferences={initTrainPreferences}
                onChangeTrainPreferences={setInitTrainPreferences}
                onOpenPreferredTrains={() =>
                  navigation.navigate("PreferredTrains", { mode: "init" })
                }
                theme={theme}
              />
            </View>

            {/* 4. TRAGITTO URBANO A ROMA */}
            <View style={styles.pillSection}>
              <Text style={styles.pillSectionLabel}>
                TRAGITTO URBANO A ROMA
              </Text>
              <View style={{ marginBottom: 10 }}>
                {isNativeIos ? (
                  <SegmentedControl
                    key={`seg-init-urban-${theme.primary}`}
                    values={["Con i mezzi", "A piedi"]}
                    selectedIndex={initUrbanMode === "walk" ? 1 : 0}
                    onChange={(event) => {
                      const idx = event.nativeEvent.selectedSegmentIndex;
                      setInitUrbanMode(idx === 1 ? "walk" : "auto");
                    }}
                    appearance="dark"
                    tintColor={theme.primary}
                    fontStyle={{
                      fontSize: 13,
                      fontWeight: "600",
                      color: "#a1a1aa",
                    }}
                    activeFontStyle={{
                      fontSize: 13,
                      fontWeight: "700",
                      color: "#ffffff",
                    }}
                    style={{ height: 36, width: "100%" }}
                  />
                ) : (
                  <View style={styles.urbanSelectorContainer}>
                    <TouchableOpacity
                      style={[
                        styles.urbanSelectorBtn,
                        initUrbanMode !== "walk" && [
                          styles.urbanSelectorBtnActive,
                          {
                            backgroundColor: theme.bg,
                            borderColor: theme.primary,
                          },
                        ],
                      ]}
                      activeOpacity={0.7}
                      onPress={() => setInitUrbanMode("auto")}
                    >
                      <Ionicons
                        name="bus-outline"
                        size={16}
                        color={initUrbanMode !== "walk" ? "#ffffff" : "#8e8e93"}
                        style={{ marginRight: 6 }}
                      />
                      <Text
                        style={[
                          styles.urbanSelectorText,
                          initUrbanMode !== "walk" &&
                            styles.urbanSelectorTextActive,
                        ]}
                      >
                        Con i mezzi
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[
                        styles.urbanSelectorBtn,
                        initUrbanMode === "walk" && [
                          styles.urbanSelectorBtnActive,
                          {
                            backgroundColor: theme.bg,
                            borderColor: theme.primary,
                          },
                        ],
                      ]}
                      activeOpacity={0.7}
                      onPress={() => setInitUrbanMode("walk")}
                    >
                      <Ionicons
                        name="footsteps-outline"
                        size={16}
                        color={initUrbanMode === "walk" ? "#ffffff" : "#8e8e93"}
                        style={{ marginRight: 6 }}
                      />
                      <Text
                        style={[
                          styles.urbanSelectorText,
                          initUrbanMode === "walk" &&
                            styles.urbanSelectorTextActive,
                        ]}
                      >
                        A piedi
                      </Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>

              {/* Dettaglio modalità urbana selezionata */}
              {initUrbanMode !== "walk" ? (
                <View style={styles.urbanModesRow}>
                  <View style={styles.urbanModePill}>
                    <Ionicons
                      name="subway-outline"
                      size={13}
                      color={theme.accent}
                    />
                    <Text style={styles.urbanModeText}>Metro B / A</Text>
                  </View>
                  <View style={styles.urbanModePill}>
                    <Ionicons name="bus-outline" size={13} color="#fb923c" />
                    <Text style={styles.urbanModeText}>Bus ATAC</Text>
                  </View>
                  <View style={styles.urbanModePill}>
                    <Ionicons name="train-outline" size={13} color="#34c759" />
                    <Text style={styles.urbanModeText}>Tram</Text>
                  </View>
                </View>
              ) : (
                <View style={styles.urbanModesRow}>
                  <View style={styles.urbanModePill}>
                    <Ionicons
                      name="footsteps-outline"
                      size={13}
                      color="#94a3b8"
                      style={{ marginRight: 5 }}
                    />
                    <Text style={styles.urbanModeText}>
                      {" Camminata a piedi"}
                    </Text>
                  </View>
                </View>
              )}
            </View>

            {/* 5. ANTICIPO IN AULA */}
            <View style={styles.pillSection}>
              <Text style={styles.pillSectionLabel}>ANTICIPO IN AULA</Text>
              <View style={styles.timeBufferContainer}>
                <TouchableOpacity
                  style={[
                    styles.zeroOptionChip,
                    initBufferMinutes === 0 && [
                      styles.chipActive,
                      {
                        backgroundColor: `${theme.primary}25`,
                        borderColor: theme.primary,
                        shadowColor: theme.primary,
                      },
                    ],
                  ]}
                  activeOpacity={0.7}
                  onPress={() => setInitBufferMinutes(0)}
                >
                  <Ionicons
                    name={
                      initBufferMinutes === 0
                        ? "checkmark-circle"
                        : "time-outline"
                    }
                    size={13}
                    color={initBufferMinutes === 0 ? theme.accent : "#8e8e93"}
                    style={{ marginRight: 6 }}
                  />
                  <Text
                    style={[
                      styles.chipText,
                      initBufferMinutes === 0 && [
                        styles.chipTextActive,
                        { color: theme.accent },
                      ],
                      { fontSize: 12, fontWeight: "600" },
                    ]}
                    numberOfLines={1}
                  >
                    Nessun anticipo
                  </Text>
                </TouchableOpacity>

                <View style={styles.timeQuickRow}>
                  {[5, 10, 15, 20].map((mins) => {
                    const isSel = initBufferMinutes === mins;
                    return (
                      <TouchableOpacity
                        key={mins}
                        style={[
                          styles.timeQuickChip,
                          isSel && [
                            styles.chipActive,
                            {
                              backgroundColor: `${theme.primary}25`,
                              borderColor: theme.primary,
                              shadowColor: theme.primary,
                            },
                          ],
                        ]}
                        activeOpacity={0.7}
                        onPress={() => setInitBufferMinutes(mins)}
                      >
                        <Ionicons
                          name={isSel ? "checkmark-circle" : "time-outline"}
                          size={13}
                          color={isSel ? theme.accent : "#8e8e93"}
                          style={{ marginRight: 4 }}
                        />
                        <Text
                          style={[
                            styles.chipText,
                            isSel && [
                              styles.chipTextActive,
                              { color: theme.accent },
                            ],
                            { fontSize: 12 },
                          ]}
                          numberOfLines={1}
                        >
                          {mins} min
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {initBufferMinutes !== null && (
                  <View style={styles.timeStepperCenteredRow}>
                    <TouchableOpacity
                      style={[
                        styles.fineStepPill,
                        initBufferMinutes === 0 && { opacity: 0.35 },
                      ]}
                      disabled={initBufferMinutes === 0}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      onPress={() =>
                        setInitBufferMinutes((b) => Math.max(0, (b ?? 10) - 1))
                      }
                    >
                      <Ionicons name="remove" size={14} color="#ffffff" />
                    </TouchableOpacity>
                    <View
                      style={[
                        styles.fineStepValuePill,
                        {
                          borderColor: theme.primary,
                          backgroundColor: theme.subtle,
                          flexDirection: "row",
                          alignItems: "center",
                          justifyContent: "center",
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.fineStepValueText,
                          { color: theme.accent },
                        ]}
                      >
                        {initBufferMinutes === 0
                          ? "Nessun anticipo"
                          : `${initBufferMinutes} min`}
                      </Text>
                    </View>
                    <TouchableOpacity
                      style={styles.fineStepPill}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      onPress={() => setInitBufferMinutes((b) => (b ?? 10) + 1)}
                    >
                      <Ionicons name="add" size={14} color="#ffffff" />
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            </View>
          </ScrollView>
        ) : (
          /* Form Configurazione iOS 26 */
          <ScrollView
            style={styles.body}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{
              paddingBottom: Math.max(insets.bottom, 24) + 84,
            }}
            showsVerticalScrollIndicator={false}
          >
            {/* 1. Partenza da casa */}
            <View style={styles.card}>
              <View style={styles.cardHeaderRow}>
                <View
                  style={[
                    styles.cardHeaderBadge,
                    { backgroundColor: theme.subtle },
                  ]}
                >
                  <Ionicons
                    name="home-outline"
                    size={14}
                    color={theme.accent}
                  />
                </View>
                <Text style={styles.cardHeaderTitle}>LUOGO DI PARTENZA</Text>
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>
                  Indirizzo o città di partenza
                </Text>
                <View style={styles.placeInputRow}>
                  <Ionicons
                    name="search"
                    size={16}
                    color="#8e8e93"
                    style={{ marginRight: 8 }}
                  />
                  <TextInput
                    style={styles.placeInput}
                    value={localConfig.originAddress}
                    onFocus={() => setPlaceSearchActive(true)}
                    onBlur={() =>
                      setTimeout(() => setPlaceSearchActive(false), 250)
                    }
                    onChangeText={(val) => {
                      setPlaceSearchActive(true);
                      setLocalConfig((prev) => ({
                        ...prev,
                        originAddress: val,
                        originCoords: undefined,
                      }));
                    }}
                    placeholder="Cerca via o comune (es. Piazzale Aldo Moro, Roma)"
                    placeholderTextColor="#666"
                    autoCapitalize="words"
                    autoCorrect={false}
                    returnKeyType="search"
                  />
                  {searchingPlaces && (
                    <ActivityIndicator size="small" color={theme.accent} />
                  )}
                  {!searchingPlaces && localConfig.originCoords && (
                    <Ionicons
                      name="checkmark-circle"
                      size={18}
                      color="#22c55e"
                    />
                  )}
                </View>

                {placeSearchActive &&
                  localConfig.originAddress.trim().length >= 3 &&
                  placeSuggestions.length > 0 && (
                    <View style={styles.suggestionsBox}>
                      {placeSuggestions.map((place, idx) => (
                        <TouchableOpacity
                          key={place.id}
                          style={[
                            styles.suggestionRow,
                            idx < placeSuggestions.length - 1 &&
                              styles.suggestionRowBorder,
                          ]}
                          activeOpacity={0.7}
                          onPress={() => selectPlace(place)}
                        >
                          <View
                            style={[
                              styles.suggestionIcon,
                              { backgroundColor: theme.subtle },
                            ]}
                          >
                            <Ionicons
                              name="location"
                              size={15}
                              color={theme.accent}
                            />
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text
                              style={styles.suggestionTitle}
                              numberOfLines={1}
                            >
                              {place.title}
                            </Text>
                            {!!place.subtitle && (
                              <Text
                                style={styles.suggestionSubtitle}
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
                <Text style={styles.inputHelp}>
                  I tempi di percorrenza e il tragitto verso la stazione saranno
                  calcolati da questo punto.
                </Text>
              </View>
            </View>

            {/* 2. Tragitto in Auto */}
            <View style={styles.card}>
              <View style={styles.switchRow}>
                <View style={{ flex: 1, paddingRight: 8 }}>
                  <View style={styles.cardHeaderRow}>
                    <View
                      style={[
                        styles.cardHeaderBadge,
                        { backgroundColor: theme.subtle },
                      ]}
                    >
                      <Ionicons
                        name="car-outline"
                        size={14}
                        color={theme.accent}
                      />
                    </View>
                    <Text style={styles.cardHeaderTitle}>TRAGITTO IN AUTO</Text>
                  </View>
                </View>
                <Switch
                  value={localConfig.carLeg.enabled}
                  onValueChange={(val) =>
                    setLocalConfig((prev) => ({
                      ...prev,
                      carLeg: { ...prev.carLeg, enabled: val },
                    }))
                  }
                  trackColor={{ false: "#2c2c2e", true: theme.primary }}
                  thumbColor="#ffffff"
                />
              </View>

              {localConfig.carLeg.enabled && (
                <View style={{ marginTop: 14 }}>
                  {/* Box Calcolo Automatico da Mappe */}
                  <View
                    style={[
                      styles.autoCalcCard,
                      {
                        backgroundColor: theme.cardTint,
                        borderColor: theme.border,
                      },
                    ]}
                  >
                    <View style={styles.autoCalcHeader}>
                      <View
                        style={[
                          styles.autoCalcIconBadge,
                          { backgroundColor: theme.subtle },
                        ]}
                      >
                        <Ionicons
                          name="car-sport"
                          size={16}
                          color={theme.accent}
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.autoCalcTitle}>
                          Calcolo percorso
                        </Text>
                        <Text style={styles.autoCalcRoute} numberOfLines={1}>
                          {localConfig.originAddress || "Partenza"} ➔ Stazione{" "}
                          {localConfig.departureStation.shortName ||
                            localConfig.departureStation.name}
                        </Text>
                      </View>
                      {calculatingDriving && (
                        <ActivityIndicator size="small" color={theme.accent} />
                      )}
                    </View>

                    <View style={styles.autoCalcStatsRow}>
                      <View style={styles.autoCalcStat}>
                        <Text
                          style={[
                            styles.autoCalcStatValue,
                            { color: theme.accent },
                          ]}
                        >
                          {Math.ceil(localConfig.carLeg.durationMinutes || 15)}{" "}
                          min
                        </Text>
                        <Text style={styles.autoCalcStatLabel}>
                          Tempo guida stimato
                        </Text>
                      </View>
                      <View style={styles.autoCalcStatDivider} />
                      <View style={styles.autoCalcStat}>
                        <Text
                          style={[
                            styles.autoCalcStatValue,
                            { color: theme.accent },
                          ]}
                        >
                          {localConfig.carLeg.distanceKm
                            ? `${localConfig.carLeg.distanceKm} km`
                            : "~6.2 km"}
                        </Text>
                        <Text style={styles.autoCalcStatLabel}>Distanza</Text>
                      </View>
                    </View>

                    {/* Viabilità attuale / condizione traffico */}
                    <View style={styles.fluencyBadgeRow}>
                      <Ionicons
                        name={
                          drivingEstimate?.fluencyStatus === "intenso"
                            ? "alert-circle"
                            : drivingEstimate?.fluencyStatus === "rallentamenti"
                              ? "warning"
                              : "checkmark-circle"
                        }
                        size={13}
                        color={
                          drivingEstimate?.fluencyStatus === "intenso"
                            ? "#ef4444"
                            : drivingEstimate?.fluencyStatus === "rallentamenti"
                              ? "#f59e0b"
                              : "#22c55e"
                        }
                        style={{ marginRight: 6 }}
                      />
                      <Text style={styles.fluencyBadgeText}>
                        {drivingEstimate?.trafficCondition?.startsWith(
                          "Viabilità attuale:",
                        )
                          ? drivingEstimate.trafficCondition
                          : `Viabilità attuale: ${drivingEstimate?.trafficCondition || "traffico scorrevole"}`}
                      </Text>
                    </View>
                  </View>

                  {/* Margine Parcheggio & Accesso */}
                  <View style={styles.stepperContainer}>
                    <View style={styles.stepperHeader}>
                      <Text style={styles.stepperLabel}>
                        Margine di sicurezza
                      </Text>
                      <Text style={styles.stepperHelp}>
                        Tempo per posteggiare e raggiungere il binario
                      </Text>
                    </View>

                    <View style={styles.timeBufferContainer}>
                      {/* Pill opzione nessun margine */}
                      <TouchableOpacity
                        style={[
                          styles.zeroOptionChip,
                          localConfig.carLeg.parkingBufferMinutes === 0 && [
                            styles.chipActive,
                            {
                              backgroundColor: `${theme.primary}25`,
                              borderColor: theme.primary,
                              shadowColor: theme.primary,
                            },
                          ],
                        ]}
                        activeOpacity={0.7}
                        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                        onPress={() =>
                          setLocalConfig((prev) => ({
                            ...prev,
                            carLeg: {
                              ...prev.carLeg,
                              parkingBufferMinutes: 0,
                            },
                          }))
                        }
                      >
                        <Ionicons
                          name={
                            localConfig.carLeg.parkingBufferMinutes === 0
                              ? "checkmark-circle"
                              : "time-outline"
                          }
                          size={13}
                          color={
                            localConfig.carLeg.parkingBufferMinutes === 0
                              ? theme.accent
                              : "#8e8e93"
                          }
                          style={{ marginRight: 6 }}
                        />
                        <Text
                          style={[
                            styles.chipText,
                            localConfig.carLeg.parkingBufferMinutes === 0 && [
                              styles.chipTextActive,
                              { color: theme.accent },
                            ],
                            { fontSize: 12, fontWeight: "600" },
                          ]}
                          numberOfLines={1}
                        >
                          Nessun margine
                        </Text>
                      </TouchableOpacity>

                      {/* Pill options veloci */}
                      <View style={styles.timeQuickRow}>
                        {PARKING_OPTIONS.map((mins) => {
                          const isSelected =
                            localConfig.carLeg.parkingBufferMinutes === mins;
                          return (
                            <TouchableOpacity
                              key={mins}
                              style={[
                                styles.timeQuickChip,
                                isSelected && [
                                  styles.chipActive,
                                  {
                                    backgroundColor: `${theme.primary}25`,
                                    borderColor: theme.primary,
                                    shadowColor: theme.primary,
                                  },
                                ],
                              ]}
                              activeOpacity={0.7}
                              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                              onPress={() =>
                                setLocalConfig((prev) => ({
                                  ...prev,
                                  carLeg: {
                                    ...prev.carLeg,
                                    parkingBufferMinutes: mins,
                                  },
                                }))
                              }
                            >
                              <Ionicons
                                name={
                                  isSelected
                                    ? "checkmark-circle"
                                    : "time-outline"
                                }
                                size={13}
                                color={isSelected ? theme.accent : "#8e8e93"}
                                style={{ marginRight: 4 }}
                              />
                              <Text
                                style={[
                                  styles.chipText,
                                  isSelected && [
                                    styles.chipTextActive,
                                    { color: theme.accent },
                                  ],
                                  { fontSize: 12 },
                                ]}
                                numberOfLines={1}
                              >
                                {mins} min
                              </Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>

                      {/* Stepper minuto per minuto centrato */}
                      <View style={styles.timeStepperCenteredRow}>
                        <TouchableOpacity
                          style={[
                            styles.stepperBtn,
                            localConfig.carLeg.parkingBufferMinutes === 0 && {
                              opacity: 0.35,
                            },
                          ]}
                          disabled={
                            localConfig.carLeg.parkingBufferMinutes === 0
                          }
                          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                          onPress={() =>
                            setLocalConfig((prev) => ({
                              ...prev,
                              carLeg: {
                                ...prev.carLeg,
                                parkingBufferMinutes: Math.max(
                                  0,
                                  prev.carLeg.parkingBufferMinutes - 1,
                                ),
                              },
                            }))
                          }
                        >
                          <Ionicons name="remove" size={16} color="#ffffff" />
                        </TouchableOpacity>
                        <View
                          style={[
                            styles.fineStepValuePill,
                            {
                              borderColor: theme.primary,
                              backgroundColor: theme.subtle,
                              flexDirection: "row",
                              alignItems: "center",
                              justifyContent: "center",
                            },
                          ]}
                        >
                          <Text
                            style={[
                              styles.fineStepValueText,
                              { color: theme.accent },
                            ]}
                          >
                            {localConfig.carLeg.parkingBufferMinutes === 0
                              ? "Nessun margine"
                              : `${localConfig.carLeg.parkingBufferMinutes} min`}
                          </Text>
                        </View>
                        <TouchableOpacity
                          style={styles.stepperBtn}
                          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                          onPress={() =>
                            setLocalConfig((prev) => ({
                              ...prev,
                              carLeg: {
                                ...prev.carLeg,
                                parkingBufferMinutes:
                                  prev.carLeg.parkingBufferMinutes + 1,
                              },
                            }))
                          }
                        >
                          <Ionicons name="add" size={16} color="#ffffff" />
                        </TouchableOpacity>
                      </View>
                    </View>
                  </View>
                </View>
              )}
            </View>

            {/* 3. Tratta Ferroviaria (Trenitalia) */}
            <View style={styles.card}>
              <View style={styles.cardHeaderRow}>
                <View
                  style={[
                    styles.cardHeaderBadge,
                    { backgroundColor: theme.subtle },
                  ]}
                >
                  <Ionicons
                    name="train-outline"
                    size={14}
                    color={theme.accent}
                  />
                </View>
                <Text style={styles.cardHeaderTitle}>TRATTA IN TRENO</Text>
              </View>

              {/* Stazione di Partenza */}
              <View style={{ marginTop: 6 }}>
                <Text style={styles.stationFieldLabel}>
                  STAZIONE DI PARTENZA
                </Text>
                <View style={styles.stationGrid}>
                  {QUICK_DEPARTURES.map((st) => {
                    const isSelected =
                      localConfig.departureStation.code === st.code;
                    return (
                      <TouchableOpacity
                        key={st.code}
                        style={[
                          styles.stationGridItem,
                          isSelected && [
                            styles.chipActive,
                            {
                              backgroundColor: `${theme.primary}25`,
                              borderColor: theme.primary,
                              shadowColor: theme.primary,
                            },
                          ],
                        ]}
                        activeOpacity={0.7}
                        onPress={() => handleSelectDeparture(st)}
                      >
                        <Ionicons
                          name={
                            isSelected ? "checkmark-circle" : "train-outline"
                          }
                          size={14}
                          color={isSelected ? theme.accent : "#8e8e93"}
                          style={{ marginRight: 5 }}
                        />
                        <Text
                          style={[
                            styles.chipText,
                            isSelected && [
                              styles.chipTextActive,
                              { color: theme.accent },
                            ],
                          ]}
                          numberOfLines={1}
                          adjustsFontSizeToFit
                          minimumFontScale={0.7}
                        >
                          {STATION_SHORT_NAMES[st.code] ||
                            st.shortName ||
                            st.name}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}

                  <TouchableOpacity
                    style={[
                      styles.stationGridItem,
                      !isDepartureInQuick
                        ? [
                            styles.chipActive,
                            {
                              backgroundColor: `${theme.primary}25`,
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
                    onPress={() => openStationPicker("departure")}
                  >
                    <Ionicons
                      name={!isDepartureInQuick ? "checkmark-circle" : "search"}
                      size={14}
                      color={!isDepartureInQuick ? theme.accent : theme.accent}
                      style={{ marginRight: 5 }}
                    />
                    <Text
                      style={[
                        styles.chipText,
                        !isDepartureInQuick
                          ? [styles.chipTextActive, { color: theme.accent }]
                          : { color: theme.accent, fontWeight: "600" },
                      ]}
                      numberOfLines={1}
                      adjustsFontSizeToFit
                      minimumFontScale={0.7}
                    >
                      {!isDepartureInQuick
                        ? STATION_SHORT_NAMES[
                            localConfig.departureStation?.code ?? ""
                          ] ||
                          localConfig.departureStation?.shortName ||
                          localConfig.departureStation?.name ||
                          "Altro..."
                        : "Altro..."}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>

              <View style={[styles.cardDivider, { marginVertical: 14 }]} />

              {/* Stazione di Arrivo */}
              <View>
                <Text style={styles.stationFieldLabel}>
                  STAZIONE DI ARRIVO (ROMA)
                </Text>
                <View style={styles.stationGrid}>
                  {QUICK_ARRIVALS.map((st) => {
                    const isSelected =
                      localConfig.arrivalStation.code === st.code;
                    return (
                      <TouchableOpacity
                        key={st.code}
                        style={[
                          styles.stationGridItem,
                          isSelected && [
                            styles.chipActive,
                            {
                              backgroundColor: `${theme.primary}25`,
                              borderColor: theme.primary,
                              shadowColor: theme.primary,
                            },
                          ],
                        ]}
                        activeOpacity={0.7}
                        onPress={() => handleSelectArrival(st)}
                      >
                        <Ionicons
                          name={
                            isSelected ? "checkmark-circle" : "flag-outline"
                          }
                          size={14}
                          color={isSelected ? theme.accent : "#8e8e93"}
                          style={{ marginRight: 5 }}
                        />
                        <Text
                          style={[
                            styles.chipText,
                            isSelected && [
                              styles.chipTextActive,
                              { color: theme.accent },
                            ],
                          ]}
                          numberOfLines={1}
                          adjustsFontSizeToFit
                          minimumFontScale={0.7}
                        >
                          {STATION_SHORT_NAMES[st.code] ||
                            st.shortName ||
                            st.name}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}

                  <TouchableOpacity
                    style={[
                      styles.stationGridItem,
                      !isArrivalInQuick
                        ? [
                            styles.chipActive,
                            {
                              backgroundColor: `${theme.primary}25`,
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
                    onPress={() => openStationPicker("arrival")}
                  >
                    <Ionicons
                      name={!isArrivalInQuick ? "checkmark-circle" : "search"}
                      size={14}
                      color={!isArrivalInQuick ? theme.accent : theme.accent}
                      style={{ marginRight: 5 }}
                    />
                    <Text
                      style={[
                        styles.chipText,
                        !isArrivalInQuick
                          ? [styles.chipTextActive, { color: theme.accent }]
                          : { color: theme.accent, fontWeight: "600" },
                      ]}
                      numberOfLines={1}
                      adjustsFontSizeToFit
                      minimumFontScale={0.7}
                    >
                      {!isArrivalInQuick
                        ? STATION_SHORT_NAMES[
                            localConfig.arrivalStation?.code ?? ""
                          ] ||
                          localConfig.arrivalStation?.shortName ||
                          localConfig.arrivalStation?.name ||
                          "Altro..."
                        : "Altro..."}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>

              {/* Preferenze Treni */}
              <TrainPreferencesSection
                includeIntercity={Boolean(localConfig.includeIntercity)}
                onToggleIntercity={(val) =>
                  setLocalConfig((prev) => ({
                    ...prev,
                    includeIntercity: val,
                  }))
                }
                trainPreferences={
                  localConfig.trainPreferences || DEFAULT_TRAIN_PREFERENCES
                }
                onChangeTrainPreferences={(nextPrefs) =>
                  setLocalConfig((prev) => ({
                    ...prev,
                    trainPreferences: nextPrefs,
                  }))
                }
                onOpenPreferredTrains={() =>
                  navigation.navigate("PreferredTrains", { mode: "edit" })
                }
                theme={theme}
              />
            </View>

            {/* 4. Tragitto Urbano a Roma (senza pappardelle) */}
            <View style={styles.card}>
              <View style={styles.cardHeaderRow}>
                <View
                  style={[
                    styles.cardHeaderBadge,
                    { backgroundColor: theme.subtle },
                  ]}
                >
                  <Ionicons
                    name="navigate-outline"
                    size={14}
                    color={theme.accent}
                  />
                </View>
                <Text style={styles.cardHeaderTitle}>TRAGITTO URBANO</Text>
              </View>

              {/* Selettore Mezzi Pubblici o A Piedi dopo il treno (Segmented UI) */}
              <View style={{ marginBottom: 10 }}>
                {isNativeIos ? (
                  <SegmentedControl
                    key={`seg-commuter-urban-${theme.primary}`}
                    values={["Con i mezzi", "A piedi"]}
                    selectedIndex={
                      localConfig.transitLeg.preferredMode === "walk" ? 1 : 0
                    }
                    onChange={(event) => {
                      const idx = event.nativeEvent.selectedSegmentIndex;
                      setLocalConfig((prev) => ({
                        ...prev,
                        transitLeg: {
                          ...prev.transitLeg,
                          preferredMode: idx === 1 ? "walk" : "auto",
                        },
                      }));
                    }}
                    appearance="dark"
                    tintColor={theme.primary}
                    fontStyle={{
                      fontSize: 13,
                      fontWeight: "600",
                      color: "#a1a1aa",
                    }}
                    activeFontStyle={{
                      fontSize: 13,
                      fontWeight: "700",
                      color: "#ffffff",
                    }}
                    style={{ height: 36, width: "100%" }}
                  />
                ) : (
                  <View style={styles.urbanSelectorContainer}>
                    <TouchableOpacity
                      style={[
                        styles.urbanSelectorBtn,
                        localConfig.transitLeg.preferredMode !== "walk" && [
                          styles.urbanSelectorBtnActive,
                          {
                            backgroundColor: `${theme.primary}25`,
                            borderColor: theme.primary,
                          },
                        ],
                      ]}
                      activeOpacity={0.7}
                      onPress={() =>
                        setLocalConfig((prev) => ({
                          ...prev,
                          transitLeg: {
                            ...prev.transitLeg,
                            preferredMode: "auto",
                          },
                        }))
                      }
                    >
                      <Ionicons
                        name="bus-outline"
                        size={15}
                        color={
                          localConfig.transitLeg.preferredMode !== "walk"
                            ? theme.accent
                            : "#8e8e93"
                        }
                        style={{ marginRight: 6 }}
                      />
                      <Text
                        style={[
                          styles.urbanSelectorText,
                          localConfig.transitLeg.preferredMode !== "walk" && [
                            styles.urbanSelectorTextActive,
                            { color: theme.accent },
                          ],
                        ]}
                      >
                        Con i mezzi
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[
                        styles.urbanSelectorBtn,
                        localConfig.transitLeg.preferredMode === "walk" && [
                          styles.urbanSelectorBtnActive,
                          {
                            backgroundColor: `${theme.primary}25`,
                            borderColor: theme.primary,
                          },
                        ],
                      ]}
                      activeOpacity={0.7}
                      onPress={() =>
                        setLocalConfig((prev) => ({
                          ...prev,
                          transitLeg: {
                            ...prev.transitLeg,
                            preferredMode: "walk",
                          },
                        }))
                      }
                    >
                      <Ionicons
                        name="walk-outline"
                        size={15}
                        color={
                          localConfig.transitLeg.preferredMode === "walk"
                            ? theme.accent
                            : "#8e8e93"
                        }
                        style={{ marginRight: 6 }}
                      />
                      <Text
                        style={[
                          styles.urbanSelectorText,
                          localConfig.transitLeg.preferredMode === "walk" && [
                            styles.urbanSelectorTextActive,
                            { color: theme.accent },
                          ],
                        ]}
                      >
                        A piedi
                      </Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>

              {/* Dettaglio modalità urbana selezionata */}
              {localConfig.transitLeg.preferredMode !== "walk" ? (
                <View style={styles.urbanModesRow}>
                  <View style={styles.urbanModePill}>
                    <Ionicons
                      name="subway-outline"
                      size={13}
                      color={theme.accent}
                    />
                    <Text style={styles.urbanModeText}>Metro B / A</Text>
                  </View>
                  <View style={styles.urbanModePill}>
                    <Ionicons name="bus-outline" size={13} color="#fb923c" />
                    <Text style={styles.urbanModeText}>Bus ATAC</Text>
                  </View>
                  <View style={styles.urbanModePill}>
                    <Ionicons name="train-outline" size={13} color="#34c759" />
                    <Text style={styles.urbanModeText}>Tram</Text>
                  </View>
                </View>
              ) : (
                <View style={styles.urbanModesRow}>
                  <View style={styles.urbanModePill}>
                    <Ionicons
                      name="footsteps-outline"
                      size={13}
                      color="#94a3b8"
                      style={{ marginRight: 5 }}
                    />
                    <Text style={styles.urbanModeText}>
                      {" Camminata a piedi"}
                    </Text>
                  </View>
                </View>
              )}

              {/* Anticipo di sicurezza in aula */}
              <View style={[styles.stepperContainer, { marginTop: 14 }]}>
                <View style={styles.stepperHeader}>
                  <Text style={styles.stepperLabel}>Anticipo in aula</Text>
                  <Text style={styles.stepperHelp}>
                    Margine per entrare in sede
                  </Text>
                </View>

                <View style={styles.timeBufferContainer}>
                  {/* Pill opzione nessun anticipo */}
                  <TouchableOpacity
                    style={[
                      styles.zeroOptionChip,
                      localConfig.bufferMinutes === 0 && [
                        styles.chipActive,
                        {
                          backgroundColor: `${theme.primary}25`,
                          borderColor: theme.primary,
                          shadowColor: theme.primary,
                        },
                      ],
                    ]}
                    activeOpacity={0.7}
                    hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                    onPress={() =>
                      setLocalConfig((prev) => ({
                        ...prev,
                        bufferMinutes: 0,
                      }))
                    }
                  >
                    <Ionicons
                      name={
                        localConfig.bufferMinutes === 0
                          ? "checkmark-circle"
                          : "time-outline"
                      }
                      size={13}
                      color={
                        localConfig.bufferMinutes === 0
                          ? theme.accent
                          : "#8e8e93"
                      }
                      style={{ marginRight: 6 }}
                    />
                    <Text
                      style={[
                        styles.chipText,
                        localConfig.bufferMinutes === 0 && [
                          styles.chipTextActive,
                          { color: theme.accent },
                        ],
                        { fontSize: 12, fontWeight: "600" },
                      ]}
                      numberOfLines={1}
                    >
                      Nessun anticipo
                    </Text>
                  </TouchableOpacity>

                  {/* Riga superiore: opzioni veloci */}
                  <View style={styles.timeQuickRow}>
                    {BUFFER_OPTIONS.map((mins) => {
                      const isSelected = localConfig.bufferMinutes === mins;
                      return (
                        <TouchableOpacity
                          key={mins}
                          style={[
                            styles.timeQuickChip,
                            isSelected && [
                              styles.chipActive,
                              {
                                backgroundColor: `${theme.primary}25`,
                                borderColor: theme.primary,
                                shadowColor: theme.primary,
                              },
                            ],
                          ]}
                          activeOpacity={0.7}
                          onPress={() =>
                            setLocalConfig((prev) => ({
                              ...prev,
                              bufferMinutes: mins,
                            }))
                          }
                        >
                          <Ionicons
                            name={
                              isSelected ? "checkmark-circle" : "time-outline"
                            }
                            size={13}
                            color={isSelected ? theme.accent : "#8e8e93"}
                            style={{ marginRight: 4 }}
                          />
                          <Text
                            style={[
                              styles.chipText,
                              isSelected && [
                                styles.chipTextActive,
                                { color: theme.accent },
                              ],
                              { fontSize: 12 },
                            ]}
                            numberOfLines={1}
                          >
                            {mins} min
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>

                  {/* Selettore di precisione centrato esattamente sotto */}
                  <View style={styles.timeStepperCenteredRow}>
                    <TouchableOpacity
                      style={[
                        styles.stepperBtn,
                        localConfig.bufferMinutes === 0 && { opacity: 0.35 },
                      ]}
                      disabled={localConfig.bufferMinutes === 0}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      onPress={() =>
                        setLocalConfig((prev) => ({
                          ...prev,
                          bufferMinutes: Math.max(0, prev.bufferMinutes - 1),
                        }))
                      }
                    >
                      <Ionicons name="remove" size={16} color="#ffffff" />
                    </TouchableOpacity>
                    <View
                      style={[
                        styles.fineStepValuePill,
                        {
                          borderColor: theme.primary,
                          backgroundColor: theme.subtle,
                          flexDirection: "row",
                          alignItems: "center",
                          justifyContent: "center",
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.fineStepValueText,
                          { color: theme.accent },
                        ]}
                      >
                        {localConfig.bufferMinutes === 0
                          ? "Nessun anticipo"
                          : `${localConfig.bufferMinutes} min`}
                      </Text>
                    </View>
                    <TouchableOpacity
                      style={styles.stepperBtn}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      onPress={() =>
                        setLocalConfig((prev) => ({
                          ...prev,
                          bufferMinutes: prev.bufferMinutes + 1,
                        }))
                      }
                    >
                      <Ionicons name="add" size={16} color="#ffffff" />
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            </View>
          </ScrollView>
        )}
      </KeyboardAvoidingView>
    </View>
  );
}

function StationPickerScreen({ navigation, route }: any) {
  const pickerType: "departure" | "arrival" = route.params?.type || "departure";
  const {
    theme,
    filteredStations,
    searchingStations,
    stationSearchQuery,
    getSelectedStationCode,
    handleSelectStation,
    handleStationSearchChange,
  } = useCommuterModal();

  useEffect(() => {
    navigation.setOptions({
      headerShown: true,
      title:
        pickerType === "departure"
          ? "Stazione di partenza"
          : "Stazione di arrivo (Roma)",
      headerTintColor: "#ffffff",
      headerStyle: { backgroundColor: UNIFORM_MODAL_BG },
      headerShadowVisible: false,
      headerTitleStyle: {
        color: "#ffffff",
        fontSize: 17,
        fontWeight: "600",
      },
      headerBackButtonDisplayMode: "minimal",
      headerBackTitle: "",
      headerSearchBarOptions: {
        placeholder: "Cerca tra tutte le stazioni italiane...",
        textColor: "#ffffff",
        tintColor: theme.primary,
        headerIconColor: "#8e8e93",
        hintTextColor: "#71717a",
        autoCapitalize: "words",
        placement: "stacked",
        hideWhenScrolling: false,
        onChangeText: (e: any) => handleStationSearchChange(e.nativeEvent.text),
        onCancelButtonPress: () => handleStationSearchChange(""),
      },
    });
  }, [navigation, pickerType, theme.primary, handleStationSearchChange]);

  const selectedCode = getSelectedStationCode(pickerType);

  const onPickStation = useCallback(
    (station: StationInfo) => {
      handleSelectStation(station, pickerType);
      navigation.goBack();
    },
    [handleSelectStation, pickerType, navigation],
  );

  return (
    <View
      collapsable={false}
      style={{ flex: 1, width: "100%", backgroundColor: UNIFORM_MODAL_BG }}
    >
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
          <View style={{ paddingVertical: 4, alignItems: "center" }}>
            <ActivityIndicator size="small" color={theme.primary} />
          </View>
        )}
        <Text style={styles.sectionLabel}>
          {stationSearchQuery.trim()
            ? `RISULTATI RICERCA (${filteredStations.length})`
            : `TUTTE LE STAZIONI ITALIANE (${filteredStations.length})`}
        </Text>
      </View>

      <FlatList
        data={filteredStations}
        keyExtractor={stationKeyExtractor}
        renderItem={({ item }) => (
          <StationRowItem
            station={item}
            isSelected={selectedCode === item.code}
            primaryColor={theme.primary}
            subtleColor={theme.subtle}
            onPress={onPickStation}
          />
        )}
        getItemLayout={getStationItemLayout}
        keyboardShouldPersistTaps="always"
        keyboardDismissMode="on-drag"
        contentInsetAdjustmentBehavior="automatic"
        style={{ flex: 1, width: "100%" }}
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingBottom: 36,
        }}
        initialNumToRender={15}
        maxToRenderPerBatch={20}
        updateCellsBatchingPeriod={50}
        windowSize={7}
        removeClippedSubviews={Platform.OS !== "android"}
      />
    </View>
  );
}

function PreferredTrainsScreen({ navigation, route }: any) {
  const mode: "init" | "edit" = route.params?.mode === "init" ? "init" : "edit";
  const {
    theme,
    initTrainPreferences,
    setInitTrainPreferences,
    localConfig,
    setLocalConfig,
    resolvedPreferredLectures,
    persistTrainPreferencesImmediately,
  } = useCommuterModal();

  const sourcePrefs =
    mode === "init" ? initTrainPreferences : localConfig.trainPreferences;

  const currentPrefs: Required<TrainPreferences> = useMemo(
    () => ({
      ...DEFAULT_TRAIN_PREFERENCES,
      ...(sourcePrefs || {}),
    }),
    [sourcePrefs],
  );

  const preferredEntries = useMemo(
    () =>
      Object.entries(currentPrefs.preferredTrains || {}).sort(
        ([keyA], [keyB]) =>
          formatPreferredTrainKey(keyA).sortOrder -
          formatPreferredTrainKey(keyB).sortOrder,
      ),
    [currentPrefs.preferredTrains],
  );
  const preferredCount = preferredEntries.length;

  const groupedByDay = useMemo(() => {
    const groups: {
      dayLabel: string;
      items: {
        key: string;
        pref: NonNullable<TrainPreferences["preferredTrains"]>[string];
        meta: ReturnType<typeof formatPreferredTrainKey>;
      }[];
    }[] = [];
    for (const [key, pref] of preferredEntries) {
      const meta = formatPreferredTrainKey(key);
      let group = groups.find((g) => g.dayLabel === meta.dayLabel);
      if (!group) {
        group = { dayLabel: meta.dayLabel, items: [] };
        groups.push(group);
      }
      group.items.push({ key, pref, meta });
    }
    return groups;
  }, [preferredEntries]);

  const updatePrefs = useCallback(
    (next: TrainPreferences) => {
      if (mode === "init") {
        setInitTrainPreferences(next);
      } else {
        setLocalConfig((prev) => ({
          ...prev,
          trainPreferences: next,
        }));
        persistTrainPreferencesImmediately(next);
      }
    },
    [
      mode,
      setInitTrainPreferences,
      setLocalConfig,
      persistTrainPreferencesImmediately,
    ],
  );

  const removePreference = useCallback(
    (keyToRemove: string) => {
      const next = {
        ...(currentPrefs.preferredTrains || {}),
      };
      delete next[keyToRemove];
      updatePrefs({
        ...currentPrefs,
        preferredTrains: next,
      });
    },
    [currentPrefs, updatePrefs],
  );

  useEffect(() => {
    navigation.setOptions({
      headerShown: true,
      title: "Treni preferiti",
      headerBackVisible: false,
      headerTintColor: "#ffffff",
      headerStyle: { backgroundColor: UNIFORM_MODAL_BG },
      headerShadowVisible: false,
      headerTitleStyle: {
        color: "#ffffff",
        fontSize: 17,
        fontWeight: "600",
      },
      unstable_headerLeftItems: () => [
        {
          type: "button",
          label: "",
          icon: { type: "sfSymbol", name: "chevron.left" },
          tintColor: "#ffffff",
          onPress: () => navigation.goBack(),
          accessibilityLabel: "Indietro",
        },
      ],
      unstable_headerRightItems: () =>
        preferredCount > 0
          ? [
              {
                type: "button",
                label: "Azzera",
                variant: "prominent" as const,
                prominent: true,
                tintColor: "#ef4444",
                onPress: () =>
                  updatePrefs({ ...currentPrefs, preferredTrains: {} }),
                accessibilityLabel: "Azzera preferenze",
              },
            ]
          : [],
    });
  }, [navigation, preferredCount, currentPrefs, updatePrefs]);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: UNIFORM_MODAL_BG }}
      contentContainerStyle={{ padding: 16, paddingBottom: 44 }}
      showsVerticalScrollIndicator={false}
    >
      {preferredCount === 0 ? (
        <View style={styles.prefEmptyWrap}>
          <View style={styles.prefEmptyIconCircle}>
            <Ionicons name="star-outline" size={26} color="#fbbf24" />
          </View>
          <Text style={styles.prefEmptyTitle}>Nessun treno preferito</Text>
          <Text style={styles.prefEmptySub}>
            Nella schermata viaggio seleziona un treno e tocca la stella
            &quot;Preferenza&quot; per salvarlo.
          </Text>
        </View>
      ) : (
        <View style={{ gap: 18 }}>
          {groupedByDay.map((group) => (
            <View key={group.dayLabel} style={styles.prefDaySection}>
              <Text style={styles.prefDayHeader}>
                {group.dayLabel.toUpperCase()}
              </Text>
              <View>
                {group.items.map(({ key, pref, meta }, idx) => {
                  const isOutbound = meta.dirLabel === "Andata";
                  const cleanLectureTime = meta.lectureLabel
                    .replace(/^Lezione\s+/i, "")
                    .trim();
                  const resolved = resolvedPreferredLectures[key];
                  const effectiveSubject =
                    pref.subject?.trim() || resolved?.subject?.trim();
                  const lectureTitle =
                    effectiveSubject ||
                    (cleanLectureTime === "Nessuna lezione" ||
                    cleanLectureTime === "Senza lezione"
                      ? "Nessuna lezione"
                      : `Lezione ${cleanLectureTime}`);
                  const lectureSub =
                    cleanLectureTime === "Nessuna lezione" ||
                    cleanLectureTime === "Senza lezione"
                      ? "Giornata senza lezioni"
                      : cleanLectureTime;

                  return (
                    <SwipeToDeleteRow
                      key={key}
                      onDelete={() => removePreference(key)}
                      marginBottom={idx < group.items.length - 1 ? 8 : 0}
                      borderRadius={16}
                    >
                      <View style={styles.prefCardRow}>
                        <View style={styles.prefCardTopRow}>
                          <View
                            style={[
                              styles.prefDirPill,
                              isOutbound
                                ? {
                                    backgroundColor: theme.bg,
                                    borderColor: theme.border,
                                  }
                                : {
                                    backgroundColor: "rgba(56, 189, 248, 0.12)",
                                    borderColor: "rgba(56, 189, 248, 0.28)",
                                  },
                            ]}
                          >
                            <Ionicons
                              name={
                                isOutbound ? "arrow-forward" : "home-outline"
                              }
                              size={11}
                              color={isOutbound ? theme.accent : "#38bdf8"}
                            />
                            <Text
                              style={[
                                styles.prefDirPillText,
                                { color: isOutbound ? theme.accent : "#38bdf8" },
                              ]}
                            >
                              {meta.dirLabel}
                            </Text>
                          </View>

                          <Text
                            style={styles.prefLectureSubject}
                            numberOfLines={1}
                          >
                            {lectureTitle}
                          </Text>

                          <TouchableOpacity
                            style={styles.prefDeleteBtn}
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                            onPress={() => removePreference(key)}
                          >
                            <Ionicons
                              name="trash-outline"
                              size={15}
                              color="#ef4444"
                            />
                          </TouchableOpacity>
                        </View>

                        <View style={styles.prefCardBottomRow}>
                          <View style={styles.prefLectureTimeWrap}>
                            <Ionicons
                              name="school-outline"
                              size={13}
                              color="#8e8e93"
                            />
                            <Text
                              style={styles.prefLectureTimeText}
                              numberOfLines={1}
                            >
                              {lectureSub}
                            </Text>
                          </View>

                          <View style={styles.prefTrainPill}>
                            <Ionicons name="star" size={12} color="#fbbf24" />
                            <Text style={styles.prefTrainTime}>
                              {pref.departureTime}
                            </Text>
                            {pref.arrivalTime && (
                              <Text style={styles.prefTrainMeta}>
                                → {pref.arrivalTime}
                              </Text>
                            )}
                            {pref.label && (
                              <Text style={styles.prefTrainLabel}>
                                • {pref.label}
                              </Text>
                            )}
                          </View>
                        </View>
                      </View>
                    </SwipeToDeleteRow>
                  );
                })}
              </View>
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

function CommuterSheetScreen({ navigation }: any) {
  const { onClose } = useCommuterModal();

  useEffect(() => {
    const unsub = navigation.addListener("beforeRemove", () => {
      onClose();
    });
    return unsub;
  }, [navigation, onClose]);

  return (
    <View
      collapsable={false}
      style={{ flex: 1, backgroundColor: UNIFORM_MODAL_BG }}
    >
      <CommuterModalStack.Navigator
        screenOptions={{
          headerStyle: { backgroundColor: UNIFORM_MODAL_BG },
          headerShadowVisible: false,
          headerTintColor: "#ffffff",
          headerTitleStyle: {
            color: "#ffffff",
            fontSize: 17,
            fontWeight: "600",
          },
          contentStyle: { backgroundColor: UNIFORM_MODAL_BG },
          animation: "slide_from_right",
        }}
      >
        <CommuterModalStack.Screen name="MainForm" component={MainFormScreen} />
        <CommuterModalStack.Screen
          name="StationPicker"
          component={StationPickerScreen}
        />
        <CommuterModalStack.Screen
          name="PreferredTrains"
          component={PreferredTrainsScreen}
        />
      </CommuterModalStack.Navigator>
    </View>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.65)",
  },
  modalContainer: {
    height: "92%",
    backgroundColor: UNIFORM_MODAL_BG,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: "hidden",
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  sheetHandleContainer: {
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 8,
    paddingBottom: 6,
  },
  sheetHandle: {
    width: 38,
    height: 4.5,
    borderRadius: 2.5,
    backgroundColor: "rgba(255,255,255,0.22)",
    alignSelf: "center",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.08)",
  },
  title: {
    fontSize: 16.5,
    fontWeight: "700",
    color: "#ffffff",
    letterSpacing: -0.2,
  },
  cancelText: {
    fontSize: 15.5,
    color: "#8e8e93",
  },
  saveText: {
    fontSize: 15.5,
    fontWeight: "700",
  },
  body: {
    flex: 1,
    padding: 16,
  },
  card: {
    backgroundColor: "#1c1c1e",
    borderRadius: CARD_RADIUS.cardLarge,
    borderWidth: 1,
    borderColor: "#2c2c2e",
    padding: 16,
    marginBottom: 16,
  },
  cardHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 10,
  },
  cardHeaderBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 8,
  },
  cardHeaderTitle: {
    fontSize: 11.5,
    fontWeight: "800",
    color: "#8e8e93",
    letterSpacing: 0.8,
  },
  cardDivider: {
    height: 1,
    backgroundColor: "#2c2c2e",
    marginVertical: 12,
  },
  inputGroup: {
    marginTop: 4,
  },
  inputLabel: {
    fontSize: 12.5,
    fontWeight: "600",
    color: "#d4d4d8",
    marginBottom: 8,
  },
  placeInputRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#121214",
    borderRadius: CARD_RADIUS.cardInner,
    borderWidth: 1,
    borderColor: "#2c2c2e",
    paddingHorizontal: 12,
    height: 44,
  },
  placeInput: {
    flex: 1,
    color: "#ffffff",
    fontSize: 14.5,
  },
  suggestionsBox: {
    marginTop: 8,
    backgroundColor: "#121214",
    borderRadius: CARD_RADIUS.cardInner,
    borderWidth: 1,
    borderColor: "#2c2c2e",
    overflow: "hidden",
  },
  suggestionRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 10,
  },
  suggestionRowBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#2c2c2e",
  },
  suggestionIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  suggestionTitle: {
    color: "#ffffff",
    fontSize: 13.5,
    fontWeight: "600",
  },
  suggestionSubtitle: {
    color: "#8e8e93",
    fontSize: 11.5,
    marginTop: 1,
  },
  inputHelp: {
    fontSize: 11,
    color: "#71717a",
    marginTop: 8,
    lineHeight: 15,
  },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  switchDesc: {
    fontSize: 12.5,
    color: "#8e8e93",
    marginTop: 2,
    lineHeight: 16,
  },
  autoCalcCard: {
    borderRadius: CARD_RADIUS.card,
    borderWidth: 1,
    padding: 14,
    marginBottom: 14,
  },
  autoCalcHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
  },
  autoCalcIconBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 9,
  },
  autoCalcTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: "#ffffff",
  },
  autoCalcRoute: {
    fontSize: 11,
    color: "#8e8e93",
    marginTop: 1,
  },
  autoCalcStatsRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(0, 0, 0, 0.35)",
    borderRadius: CARD_RADIUS.cardInner,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 10,
  },
  autoCalcStat: {
    flex: 1,
    alignItems: "center",
  },
  autoCalcStatValue: {
    fontSize: 17,
    fontWeight: "800",
    letterSpacing: -0.3,
  },
  autoCalcStatLabel: {
    fontSize: 10.5,
    color: "#8e8e93",
    marginTop: 2,
    fontWeight: "600",
  },
  autoCalcStatDivider: {
    width: 1,
    height: 24,
    backgroundColor: "rgba(255, 255, 255, 0.1)",
  },
  fluencyBadgeRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 4,
  },
  fluencyBadgeText: {
    fontSize: 11.5,
    color: "#d4d4d8",
    fontWeight: "500",
  },
  stepperContainer: {
    marginTop: 4,
  },
  stepperHeader: {
    marginBottom: 8,
  },
  stepperLabel: {
    fontSize: 12.5,
    fontWeight: "600",
    color: "#d4d4d8",
  },
  stepperHelp: {
    fontSize: 11,
    color: "#71717a",
    marginTop: 2,
  },
  chipsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 6,
    marginBottom: 10,
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
    fontSize: 12.5,
    fontWeight: "600",
    color: "#a1a1aa",
  },
  chipTextActive: {
    fontWeight: "700",
  },
  stepperRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: 4,
  },
  stepperSubtext: {
    fontSize: 12,
    color: "#8e8e93",
  },
  stepperControls: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#121214",
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#2c2c2e",
    padding: 3,
  },
  stepperBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "#242426",
    justifyContent: "center",
    alignItems: "center",
  },
  stepperValue: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "700",
    paddingHorizontal: 12,
    minWidth: 55,
    textAlign: "center",
  },
  stationFieldLabel: {
    fontSize: 10.5,
    fontWeight: "800",
    color: "#71717a",
    letterSpacing: 0.7,
    marginBottom: 6,
  },
  urbanSelectorContainer: {
    flexDirection: "row",
    backgroundColor: "#121214",
    borderRadius: CARD_RADIUS.cardInner,
    padding: 3,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
    marginTop: 6,
    marginBottom: 8,
  },
  urbanSelectorBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 9,
    borderRadius: 9,
  },
  urbanSelectorBtnActive: {
    borderWidth: 1,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 3,
    elevation: 2,
  },
  urbanSelectorText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#8e8e93",
  },
  urbanSelectorTextActive: {
    fontWeight: "700",
  },
  urbanModesRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 4,
    marginBottom: 4,
  },
  urbanModePill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#121214",
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#2c2c2e",
    gap: 6,
  },
  urbanModeText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#e2e8f0",
  },
  pickerHeader: {
    marginBottom: 14,
  },
  backBtn: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 10,
  },
  backBtnText: {
    fontSize: 13.5,
    marginLeft: 4,
    fontWeight: "600",
  },
  pickerTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: "#ffffff",
    letterSpacing: -0.2,
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1c1c1e",
    borderRadius: CARD_RADIUS.cardInner,
    borderWidth: 1,
    borderColor: "#2c2c2e",
    paddingHorizontal: 12,
    height: 44,
    marginBottom: 10,
  },
  searchInput: {
    flex: 1,
    color: "#ffffff",
    fontSize: 14.5,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: "800",
    color: "#71717a",
    letterSpacing: 0.6,
    marginBottom: 10,
    marginTop: 4,
  },
  stationRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1c1c1e",
    borderRadius: CARD_RADIUS.card,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: "#2c2c2e",
  },
  stationIconCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 10,
  },
  stationName: {
    fontSize: 14.5,
    fontWeight: "600",
    color: "#ffffff",
  },
  stationCode: {
    fontSize: 11,
    color: "#71717a",
    marginTop: 2,
  },

  /* Stili Modalità Inizializzazione Primo Avvio */
  initScrollView: {
    flex: 1,
  },
  initScrollContent: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 40,
  },
  stationGridItemDashed: {
    borderStyle: "dashed",
    borderWidth: 1.5,
    backgroundColor: "transparent",
  },
  channelHeroHeader: {
    alignItems: "center",
    marginBottom: 20,
    paddingHorizontal: 16,
  },
  channelIconCircle: {
    width: 60,
    height: 60,
    borderRadius: 20,
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
    letterSpacing: 0.3,
    textAlign: "center",
    marginBottom: 6,
  },
  channelHeroSubtitle: {
    fontSize: 13,
    color: "#8e8e93",
    textAlign: "center",
    lineHeight: 18,
    maxWidth: 380,
  },
  pillSection: {
    marginBottom: 28,
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
  timeBufferContainer: {
    width: "100%",
    alignItems: "center",
    marginTop: 4,
    paddingBottom: 8,
  },
  zeroOptionChip: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#1c1c1e",
    paddingHorizontal: 12,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#2c2c2e",
    marginBottom: 8,
  },
  timeQuickRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    width: "100%",
    gap: 6,
  },
  timeQuickChip: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#1c1c1e",
    paddingHorizontal: 4,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#2c2c2e",
  },
  preferredClearBtn: {
    paddingHorizontal: 12,
    height: 30,
    borderRadius: 15,
    backgroundColor: "#1c1c1e",
    borderWidth: 1,
    borderColor: "#2c2c2e",
    justifyContent: "center",
  },
  preferredClearText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#f87171",
  },
  preferredListContainer: {
    marginTop: 10,
    gap: 6,
  },
  preferredItemRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1c1c1e",
    borderWidth: 1,
    borderColor: "#2c2c2e",
    borderRadius: CARD_RADIUS.cardInner,
    paddingHorizontal: 11,
    paddingVertical: 8,
  },
  preferredItemLeft: {
    flex: 1,
    marginRight: 8,
  },
  preferredItemTitle: {
    fontSize: 12.5,
    fontWeight: "700",
    color: "#ffffff",
  },
  preferredItemSub: {
    fontSize: 11,
    color: "#8e8e93",
    marginTop: 1,
  },
  preferredItemTrain: {
    fontSize: 12,
    fontWeight: "700",
    color: "#fbbf24",
    marginRight: 8,
  },
  trainPrefRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    width: "100%",
  },
  trainPrefChip: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#1c1c1e",
    paddingHorizontal: 6,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: "#2c2c2e",
  },
  timeStepperCenteredRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 10,
    width: "100%",
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
    borderRadius: CARD_RADIUS.card,
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
  initBottomButtonsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: Platform.OS === "ios" ? 20 : 14,
    backgroundColor: UNIFORM_MODAL_BG,
    borderTopWidth: 0,
  },
  saveBottomBar: {
    backgroundColor: UNIFORM_MODAL_BG,
    borderTopWidth: 0,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: Platform.OS === "ios" ? 20 : 14,
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
  saveBtnPill: {
    flex: 1,
    flexDirection: "row",
    height: 44,
    borderRadius: 22,
    borderWidth: 1.5,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 14,
    shadowOffset: { width: 0, height: 0 },
  },
  saveBtnPillDisabled: {
    backgroundColor: "#18181b",
    borderColor: "#27272a",
    opacity: 0.5,
  },
  saveBtnPillText: {
    fontSize: 14,
    fontWeight: "700",
    color: "#ffffff",
  },
  preferredCountBadge: {
    minWidth: 24,
    height: 22,
    borderRadius: 11,
    borderWidth: 1,
    paddingHorizontal: 7,
    alignItems: "center",
    justifyContent: "center",
  },
  preferredCountBadgeText: {
    fontSize: 12,
    fontWeight: "700",
  },
  preferredEmptyCard: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 32,
    paddingHorizontal: 20,
    borderRadius: CARD_RADIUS.card,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    gap: 8,
  },
  preferredEmptyTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: "#ffffff",
  },
  preferredEmptySub: {
    fontSize: 13,
    color: "#8e8e93",
    textAlign: "center",
    lineHeight: 18,
  },
  prefEmptyWrap: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 44,
    paddingHorizontal: 24,
    borderRadius: CARD_RADIUS.cardLarge,
    backgroundColor: "#1c1c1e",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    marginTop: 12,
    gap: 10,
  },
  prefEmptyIconCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: "rgba(251, 191, 36, 0.12)",
    borderWidth: 1,
    borderColor: "rgba(251, 191, 36, 0.25)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  prefEmptyTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#ffffff",
  },
  prefEmptySub: {
    fontSize: 13,
    color: "#8e8e93",
    textAlign: "center",
    lineHeight: 19,
  },
  prefDaySection: {
    gap: 8,
  },
  prefDayHeader: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.8,
    color: "#8e8e93",
    paddingHorizontal: 4,
  },
  prefDayCard: {
    borderRadius: CARD_RADIUS.card,
    backgroundColor: "#1c1c1e",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    overflow: "hidden",
  },
  prefCardRow: {
    borderRadius: CARD_RADIUS.card,
    backgroundColor: "#1c1c1e",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    paddingHorizontal: 14,
    paddingVertical: 13,
    gap: 10,
  },
  prefCardRowBorder: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(255,255,255,0.1)",
  },
  prefCardTopRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  prefDirPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
  },
  prefDirPillText: {
    fontSize: 11,
    fontWeight: "700",
  },
  prefLectureSubject: {
    flex: 1,
    fontSize: 14,
    fontWeight: "700",
    color: "#ffffff",
  },
  prefDeleteBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "rgba(239, 68, 68, 0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  prefCardBottomRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  prefLectureTimeWrap: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  prefLectureTimeText: {
    flex: 1,
    fontSize: 12,
    color: "#94a3b8",
    fontWeight: "500",
  },
  prefTrainPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
    backgroundColor: "rgba(251, 191, 36, 0.10)",
    borderWidth: 1,
    borderColor: "rgba(251, 191, 36, 0.24)",
  },
  prefTrainTime: {
    fontSize: 13,
    fontWeight: "800",
    color: "#ffffff",
  },
  prefTrainMeta: {
    fontSize: 12,
    fontWeight: "600",
    color: "#cbd5e1",
  },
  prefTrainLabel: {
    fontSize: 11,
    fontWeight: "600",
    color: "#fbbf24",
  },
});
