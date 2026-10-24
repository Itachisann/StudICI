import { useTheme } from "@/context/ThemeContext";
import { Ionicons } from "@expo/vector-icons";
import React, { useCallback, useEffect, useMemo, useState } from "react";
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
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import {
  DarkTheme,
  NavigationContainer,
  NavigationIndependentTree,
  useNavigation,
} from "@react-navigation/native";
import { UNIFORM_MODAL_BG } from "@/constants/theme";
import { CommuterConfig, StationInfo } from "../types/commuter";
import {
  calculateDrivingEstimate,
  DrivingEstimate,
  getStationNavigationQuery,
  PlaceSuggestion,
  searchPlaces,
} from "../utils/drivingRouter";
import { ALL_STATIONS, searchStations } from "../utils/trenitaliaApi";

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
  setInitArrivalStation: React.Dispatch<React.SetStateAction<StationInfo | null>>;
  initBufferMinutes: number | null;
  setInitBufferMinutes: React.Dispatch<React.SetStateAction<number | null>>;
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
  handleSelectStation: (station: StationInfo, type: "departure" | "arrival") => void;
  handleStationSearchChange: (text: string) => void;
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

export function CommuterConfigModal({
  visible,
  config,
  onClose,
  onSave,
}: Props) {
  const { theme } = useTheme();
  const [prevConfig, setPrevConfig] = useState(config);
  const [localConfig, setLocalConfig] = useState<CommuterConfig>(config);
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
  const [initDrivingEstimate, setInitDrivingEstimate] =
    useState<DrivingEstimate | null>(null);
  const [initCalculatingDriving, setInitCalculatingDriving] = useState(false);

  const [prevVisible, setPrevVisible] = useState(visible);
  if (config !== prevConfig) {
    setPrevConfig(config);
    setLocalConfig(config);
  }

  // Reset delle selezioni alla riapertura se non configurato (nessun valore di default)
  if (visible !== prevVisible) {
    setPrevVisible(visible);
    if (visible && isUnconfigured) {
      setInitOriginAddress("");
      setInitOriginCoords(undefined);
      setInitCarMode(null);
      setInitParkingBufferMinutes(null);
      setInitDepartureStation(null);
      setInitArrivalStation(null);
      setInitBufferMinutes(null);
      setInitDrivingEstimate(null);
      setPlaceSearchActive(false);
      setPlaceSuggestions([]);
    }
  }

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

  const sheetTitle = isUnconfigured ? "Configura viaggio" : "Impostazioni viaggio";

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

  if (!visible) {
    return null;
  }

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <CommuterModalContext.Provider value={contextValue}>
        <NavigationIndependentTree>
          <NavigationContainer
            theme={navTheme}
            initialState={{
              index: 1,
              routes: [
                { name: "RootPlaceholder" },
                { name: "CommuterSheet" },
              ],
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

function MainFormScreen() {
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
          label: "Salva",
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
    <View collapsable={false} style={{ flex: 1, backgroundColor: UNIFORM_MODAL_BG }}>
      <KeyboardAvoidingView
        collapsable={false}
        style={{ flex: 1, backgroundColor: UNIFORM_MODAL_BG }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        {isUnconfigured ? (
          /* Form Inizializzazione Primo Avvio (senza nulla di default) */
          <ScrollView
            style={styles.initScrollView}
            contentContainerStyle={styles.initScrollContent}
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
                    Imposta il tuo tragitto pendolare per calcolare treni,
                    traffico e coincidenze verso le aule, oppure configura più
                    tardi.
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
                      onPress={() => setInitCarMode("yes")}
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
                          initCarMode === "no"
                            ? "checkmark-circle"
                            : "walk-outline"
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
                      <Text style={styles.subPillLabel}>
                        MARGINE DI SICUREZZA
                      </Text>
                      <View style={styles.timeBufferContainer}>
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
                                      backgroundColor: theme.bg,
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
                                  color={isSel ? "#ffffff" : "#8e8e93"}
                                  style={{ marginRight: 4 }}
                                />
                                <Text
                                  style={[
                                    styles.chipText,
                                    isSel && styles.chipTextActive,
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
                              style={styles.fineStepPill}
                              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                              onPress={() =>
                                setInitParkingBufferMinutes((p) =>
                                  Math.max(1, (p ?? 10) - 1),
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
                                  flexDirection: "row",
                                  alignItems: "center",
                                  justifyContent: "center",
                                },
                              ]}
                            >
                              <Ionicons
                                name="time-outline"
                                size={14}
                                color={theme.accent}
                                style={{ marginRight: 5 }}
                              />
                              <Text
                                style={[
                                  styles.fineStepValueText,
                                  { color: theme.accent },
                                ]}
                              >
                                {initParkingBufferMinutes} min
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
                  <Text style={styles.pillSectionLabel}>
                    STAZIONE DI PARTENZA
                  </Text>
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
                                backgroundColor: theme.bg,
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
                        isOtherInitDepartureSelected
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
                      onPress={() => openStationPicker("departure")}
                    >
                      <Ionicons
                        name={isOtherInitDepartureSelected ? "checkmark-circle" : "search"}
                        size={14}
                        color={isOtherInitDepartureSelected ? "#ffffff" : theme.accent}
                        style={{ marginRight: 5 }}
                      />
                      <Text
                        style={[
                          styles.chipText,
                          isOtherInitDepartureSelected
                            ? styles.chipTextActive
                            : { color: theme.accent, fontWeight: "600" },
                        ]}
                        numberOfLines={1}
                        adjustsFontSizeToFit
                        minimumFontScale={0.7}
                      >
                        {isOtherInitDepartureSelected
                          ? (STATION_SHORT_NAMES[initDepartureStation?.code ?? ""] ||
                              initDepartureStation?.shortName ||
                              initDepartureStation?.name ||
                              "Altro...")
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
                                backgroundColor: theme.bg,
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
                        isOtherInitArrivalSelected
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
                      onPress={() => openStationPicker("arrival")}
                    >
                      <Ionicons
                        name={isOtherInitArrivalSelected ? "checkmark-circle" : "search"}
                        size={14}
                        color={isOtherInitArrivalSelected ? "#ffffff" : theme.accent}
                        style={{ marginRight: 5 }}
                      />
                      <Text
                        style={[
                          styles.chipText,
                          isOtherInitArrivalSelected
                            ? styles.chipTextActive
                            : { color: theme.accent, fontWeight: "600" },
                        ]}
                        numberOfLines={1}
                        adjustsFontSizeToFit
                        minimumFontScale={0.7}
                      >
                        {isOtherInitArrivalSelected
                          ? (STATION_SHORT_NAMES[initArrivalStation?.code ?? ""] ||
                              initArrivalStation?.shortName ||
                              initArrivalStation?.name ||
                              "Altro...")
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
                          <ActivityIndicator
                            size="small"
                            color={theme.accent}
                          />
                        )}
                      </View>
                    )}
                </View>

                {/* 4. ANTICIPO IN AULA */}
                <View style={styles.pillSection}>
                  <Text style={styles.pillSectionLabel}>ANTICIPO IN AULA</Text>
                  <View style={styles.timeBufferContainer}>
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
                                  backgroundColor: theme.bg,
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
                              color={isSel ? "#ffffff" : "#8e8e93"}
                              style={{ marginRight: 4 }}
                            />
                            <Text
                              style={[
                                styles.chipText,
                                isSel && styles.chipTextActive,
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
                          style={styles.fineStepPill}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                          onPress={() =>
                            setInitBufferMinutes((b) =>
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
                              flexDirection: "row",
                              alignItems: "center",
                              justifyContent: "center",
                            },
                          ]}
                        >
                          <Ionicons
                            name="time-outline"
                            size={14}
                            color={theme.accent}
                            style={{ marginRight: 5 }}
                          />
                          <Text
                            style={[
                              styles.fineStepValueText,
                              { color: theme.accent },
                            ]}
                          >
                            {initBufferMinutes} min
                          </Text>
                        </View>
                        <TouchableOpacity
                          style={styles.fineStepPill}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                          onPress={() =>
                            setInitBufferMinutes((b) => (b ?? 10) + 1)
                          }
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
                contentContainerStyle={{ paddingBottom: 40 }}
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
                    I tempi di percorrenza e il tragitto verso la stazione
                    saranno calcolati da questo punto.
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
                      <Text style={styles.cardHeaderTitle}>
                        TRAGITTO IN AUTO
                      </Text>
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
                          <ActivityIndicator
                            size="small"
                            color={theme.accent}
                          />
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
                            {Math.ceil(
                              localConfig.carLeg.durationMinutes || 15,
                            )}{" "}
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
                              : drivingEstimate?.fluencyStatus ===
                                  "rallentamenti"
                                ? "warning"
                                : "checkmark-circle"
                          }
                          size={13}
                          color={
                            drivingEstimate?.fluencyStatus === "intenso"
                              ? "#ef4444"
                              : drivingEstimate?.fluencyStatus ===
                                  "rallentamenti"
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
                                  name={isSelected ? "checkmark-circle" : "time-outline"}
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
                            style={styles.stepperBtn}
                            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                            onPress={() =>
                              setLocalConfig((prev) => ({
                                ...prev,
                                carLeg: {
                                  ...prev.carLeg,
                                  parkingBufferMinutes: Math.max(
                                    1,
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
                            <Ionicons
                              name="time-outline"
                              size={14}
                              color={theme.accent}
                              style={{ marginRight: 5 }}
                            />
                            <Text
                              style={[
                                styles.fineStepValueText,
                                { color: theme.accent },
                              ]}
                            >
                              {localConfig.carLeg.parkingBufferMinutes} min
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
                                backgroundColor: theme.bg,
                                borderColor: theme.primary,
                                shadowColor: theme.primary,
                              },
                            ],
                          ]}
                          activeOpacity={0.7}
                          onPress={() => handleSelectDeparture(st)}
                        >
                          <Ionicons
                            name={isSelected ? "checkmark-circle" : "train-outline"}
                            size={14}
                            color={isSelected ? "#ffffff" : "#8e8e93"}
                            style={{ marginRight: 5 }}
                          />
                          <Text
                            style={[
                              styles.chipText,
                              isSelected && styles.chipTextActive,
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
                        !isDepartureInQuick
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
                      onPress={() => openStationPicker("departure")}
                    >
                      <Ionicons
                        name={!isDepartureInQuick ? "checkmark-circle" : "search"}
                        size={14}
                        color={!isDepartureInQuick ? "#ffffff" : theme.accent}
                        style={{ marginRight: 5 }}
                      />
                      <Text
                        style={[
                          styles.chipText,
                          !isDepartureInQuick
                            ? styles.chipTextActive
                            : { color: theme.accent, fontWeight: "600" },
                        ]}
                        numberOfLines={1}
                        adjustsFontSizeToFit
                        minimumFontScale={0.7}
                      >
                        {!isDepartureInQuick
                          ? (STATION_SHORT_NAMES[localConfig.departureStation?.code ?? ""] ||
                              localConfig.departureStation?.shortName ||
                              localConfig.departureStation?.name ||
                              "Altro...")
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
                                backgroundColor: theme.bg,
                                borderColor: theme.primary,
                                shadowColor: theme.primary,
                              },
                            ],
                          ]}
                          activeOpacity={0.7}
                          onPress={() => handleSelectArrival(st)}
                        >
                          <Ionicons
                            name={isSelected ? "checkmark-circle" : "flag-outline"}
                            size={14}
                            color={isSelected ? "#ffffff" : "#8e8e93"}
                            style={{ marginRight: 5 }}
                          />
                          <Text
                            style={[
                              styles.chipText,
                              isSelected && styles.chipTextActive,
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
                        !isArrivalInQuick
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
                      onPress={() => openStationPicker("arrival")}
                    >
                      <Ionicons
                        name={!isArrivalInQuick ? "checkmark-circle" : "search"}
                        size={14}
                        color={!isArrivalInQuick ? "#ffffff" : theme.accent}
                        style={{ marginRight: 5 }}
                      />
                      <Text
                        style={[
                          styles.chipText,
                          !isArrivalInQuick
                            ? styles.chipTextActive
                            : { color: theme.accent, fontWeight: "600" },
                        ]}
                        numberOfLines={1}
                        adjustsFontSizeToFit
                        minimumFontScale={0.7}
                      >
                        {!isArrivalInQuick
                          ? (STATION_SHORT_NAMES[localConfig.arrivalStation?.code ?? ""] ||
                              localConfig.arrivalStation?.shortName ||
                              localConfig.arrivalStation?.name ||
                              "Altro...")
                          : "Altro..."}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
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

                {/* Mezzi Pubblici Urbani puliti */}
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
                  <View style={styles.urbanModePill}>
                    <Ionicons name="walk-outline" size={13} color="#e2e8f0" />
                    <Text style={styles.urbanModeText}>A piedi</Text>
                  </View>
                </View>

                {/* Anticipo di sicurezza in aula */}
                <View style={[styles.stepperContainer, { marginTop: 14 }]}>
                  <View style={styles.stepperHeader}>
                    <Text style={styles.stepperLabel}>Anticipo in aula</Text>
                    <Text style={styles.stepperHelp}>
                      Margine per entrare in sede
                    </Text>
                  </View>

                  <View style={styles.timeBufferContainer}>
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
                              name={isSelected ? "checkmark-circle" : "time-outline"}
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
                        style={styles.stepperBtn}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        onPress={() =>
                          setLocalConfig((prev) => ({
                            ...prev,
                            bufferMinutes: Math.max(1, prev.bufferMinutes - 1),
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
                        <Ionicons
                          name="time-outline"
                          size={14}
                          color={theme.accent}
                          style={{ marginRight: 5 }}
                        />
                        <Text
                          style={[
                            styles.fineStepValueText,
                            { color: theme.accent },
                          ]}
                        >
                          {localConfig.bufferMinutes} min
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
    <View collapsable={false} style={{ flex: 1, width: "100%", backgroundColor: UNIFORM_MODAL_BG }}>
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

function CommuterSheetScreen({ navigation }: any) {
  const { onClose } = useCommuterModal();

  useEffect(() => {
    const unsub = navigation.addListener("beforeRemove", () => {
      onClose();
    });
    return unsub;
  }, [navigation, onClose]);

  return (
    <View collapsable={false} style={{ flex: 1, backgroundColor: UNIFORM_MODAL_BG }}>
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
        <CommuterModalStack.Screen
          name="MainForm"
          component={MainFormScreen}
        />
        <CommuterModalStack.Screen
          name="StationPicker"
          component={StationPickerScreen}
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
    borderRadius: 20,
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
    borderRadius: 14,
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
    borderRadius: 14,
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
    borderRadius: 16,
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
    borderRadius: 12,
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
    borderRadius: 14,
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
    borderRadius: 14,
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
    marginBottom: 22,
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
});
