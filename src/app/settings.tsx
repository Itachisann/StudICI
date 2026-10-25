import { useTheme } from "@/context/ThemeContext";
import { MenuView } from "@expo/ui/community/menu";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Clipboard from "expo-clipboard";
import Constants, { ExecutionEnvironment } from "expo-constants";
import { router, useFocusEffect } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  LayoutAnimation,
  Linking,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native";
import Swipeable from "react-native-gesture-handler/Swipeable";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { CommuterConfigModal } from "../components/CommuterConfigModal";
import { CourseDownloadView } from "../components/CourseDownloadView";
import { DefaultTabPicker } from "../components/DefaultTabPicker";
import { NativeActionButton } from "../components/NativeActionButton";
import { NativeSheetModal } from "../components/NativeSheetModal";
import { UNIFORM_SCREEN_BG, UNIFORM_MODAL_BG } from "@/constants/theme";
import { parseTabHierarchy } from "../components/YearChannelSelector";
import { CommuterConfig } from "../types/commuter";
import { extractClassCode, getDegreeClassTheme } from "../utils/degreeColors";
import {
  getLastCalendarSync,
  syncScheduleToAppleCalendar,
} from "../utils/appleCalendar";
import {
  AttendanceRecord,
  AttendanceStats,
  clearAllAttendance,
  deleteAttendanceRecord,
  getAttendanceRecords,
  getAttendanceStats,
} from "../utils/attendance";
import {
  copyCloudSyncCodeToClipboard,
  dissociateDevice,
  getCloudSyncId,
  getICloudAutoSyncEnabled,
  getLastCloudSync,
  getPairedDevicesInfo,
  isCloudConfigured,
  isValidSyncCode,
  linkDeviceWithCode,
  PairedDevicesStatus,
  resetAppCloudAndStorage,
  restoreFromCloudBackup,
  setCustomCloudSyncId,
  setICloudAutoSyncEnabled,
  subscribeToLiveSync,
  syncWithICloudStorage,
} from "../utils/cloudSync";
import {
  getCommuterConfig,
  saveCommuterConfig,
} from "../utils/commuterStorage";
import { exportAttendanceToPdf, exportScheduleToPdf } from "../utils/pdfExport";
import { getManualEvents } from "../utils/manualEvents";
import {
  Degree,
  checkCourseUpdates,
  fetchAllCourseData,
  fetchDegrees,
  fetchScheduleData,
  fetchTabs,
  getCachedTabs,
  Tab,
} from "../utils/scraper";
import {
  AppUpdateInfo,
  checkForAppUpdate,
  GITHUB_LATEST_RELEASE_URL,
} from "../utils/updateChecker";

const SAPIENZA_RED = "#822433";
const isExpoGo =
  Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
const isNativeComponentAvailable = Platform.OS === "ios" && !isExpoGo;

const formatSyncDate = (ts: number | null): string => {
  if (!ts) return "Non sincronizzato";
  const d = new Date(ts);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const timeStr = d.toLocaleTimeString("it-IT", {
    hour: "2-digit",
    minute: "2-digit",
  });
  if (isToday) return `Oggi alle ${timeStr}`;
  return `${d.toLocaleDateString("it-IT", { day: "numeric", month: "short" })} alle ${timeStr}`;
};

export default function ProfiloScreen() {
  const insets = useSafeAreaInsets();
  const { theme, themeId, setThemeId, availableThemes } = useTheme();
  const [degreeName, setDegreeName] = useState<string>("");
  const [degreeClassName, setDegreeClassName] = useState<string>("");
  const [degreeUrl, setDegreeUrl] = useState<string | null>(null);
  const [defaultTabUrl, setDefaultTabUrl] = useState<string | null>(null);
  const [availableTabs, setAvailableTabs] = useState<Tab[]>([]);
  const [degrees, setDegrees] = useState<Degree[]>([]);
  const [courseModalVisible, setCourseModalVisible] = useState(false);
  const [channelModalVisible, setChannelModalVisible] = useState(false);
  const [selectedTabForSpecifiche, setSelectedTabForSpecifiche] =
    useState<Tab | null>(null);
  const [attendanceModalVisible, setAttendanceModalVisible] = useState(false);
  const [searchCourse, setSearchCourse] = useState("");
  const [downloadingCourse, setDownloadingCourse] = useState<Degree | null>(
    null,
  );
  const [downloadProgressText, setDownloadProgressText] = useState("");
  const [attendanceRecords, setAttendanceRecords] = useState<
    AttendanceRecord[]
  >([]);
  const [attendanceStats, setAttendanceStats] =
    useState<AttendanceStats | null>(null);

  // Stati Sincronizzazione, Calendario Apple ed Esportazione PDF
  const [cloudModalVisible, setCloudModalVisible] = useState(false);
  const [cloudSyncId, setCloudSyncId] = useState<string>("");
  const [lastCloudSyncTime, setLastCloudSyncTime] = useState<number | null>(
    null,
  );
  const [lastCalendarSyncTime, setLastCalendarSyncTime] = useState<
    number | null
  >(null);
  const [isSyncingCloud, setIsSyncingCloud] = useState(false);
  const [isSyncingCalendar, setIsSyncingCalendar] = useState(false);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [restoreCodeInput, setRestoreCodeInput] = useState("");
  const [iCloudAutoSync, setICloudAutoSync] = useState(false);
  const [pairedDevices, setPairedDevices] =
    useState<PairedDevicesStatus | null>(null);
  const [commuterConfig, setCommuterConfig] = useState<CommuterConfig | null>(
    null,
  );
  const [commuterModalVisible, setCommuterModalVisible] = useState(false);
  const [themeSectionExpanded, setThemeSectionExpanded] = useState(false);
  const [appUpdate, setAppUpdate] = useState<AppUpdateInfo | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);

  useEffect(() => {
    checkForAppUpdate().then((info) => setAppUpdate(info));
  }, []);

  const handleManualCheckUpdate = async () => {
    setCheckingUpdate(true);
    const info = await checkForAppUpdate();
    setAppUpdate(info);
    setCheckingUpdate(false);
    if (info.hasUpdate) {
      Alert.alert(
        "Aggiornamento Disponibile",
        `È disponibile la nuova versione v${info.latestVersion} (versione attuale: v${info.currentVersion}).`,
        [
          { text: "Più tardi", style: "cancel" },
          {
            text: "Aggiorna",
            style: "default",
            onPress: () =>
              Linking.openURL(info.htmlUrl || GITHUB_LATEST_RELEASE_URL),
          },
        ],
      );
    } else {
      Alert.alert(
        "App Aggiornata",
        `Hai già installato l'ultima versione disponibile (v${info.currentVersion}).`,
        [{ text: "OK" }],
      );
    }
  };

  const { width: windowWidth } = useWindowDimensions();
  const [measuredCardWidth, setMeasuredCardWidth] = useState<number>(0);
  const themeCardWidth =
    measuredCardWidth > 0 ? measuredCardWidth : Math.max(windowWidth - 32, 280);

  const themeMenuActions = useMemo(
    () =>
      availableThemes.map((t) => ({
        id: t.id,
        title: t.name,
        image: "circle.fill" as const,
        imageColor: t.primary,
        state: (t.id === themeId ? "on" : "off") as "on" | "off",
      })),
    [availableThemes, themeId],
  );

  const loadProfileData = useCallback(async () => {
    try {
      // 1. Lettura istantanea da memoria locale (0ms latency, zero attese di rete)
      const storedPairs = await AsyncStorage.multiGet([
        "selectedDegreeUrl",
        "selectedDegreeName",
        "selectedDegreeClassName",
        "defaultTabUrl",
      ]);
      const storedMap = Object.fromEntries(storedPairs);
      const storedUrl = storedMap["selectedDegreeUrl"] || null;
      const storedName = storedMap["selectedDegreeName"] || "";
      const storedClassName = storedMap["selectedDegreeClassName"] || "";
      const storedDefaultTab = storedMap["defaultTabUrl"] || null;

      setDegreeUrl(storedUrl);
      setDegreeName(storedName);
      setDegreeClassName(storedClassName);
      setDefaultTabUrl(storedDefaultTab);

      // 2. Canali e Tab caricati istantaneamente dalla cache locale (il canale appare al primo frame!)
      let localTabs: Tab[] = [];
      if (storedUrl) {
        localTabs = (await getCachedTabs(storedUrl)) || [];
      }
      if (localTabs.length > 0) {
        setAvailableTabs(localTabs);
      }

      // 3. Presenze e statistiche immediate da disco
      const attList = await getAttendanceRecords(storedUrl || undefined);
      setAttendanceRecords(attList);
      setAttendanceStats(getAttendanceStats(attList));

      // 4. Parametri Cloud e Pendolare letti istantaneamente dal disco locale
      const [cloudId, lastCloud, lastCal, icloudEnabled, commConfig] =
        await Promise.all([
          getCloudSyncId(),
          getLastCloudSync(),
          getLastCalendarSync(),
          getICloudAutoSyncEnabled(),
          getCommuterConfig(),
        ]);

      setCloudSyncId(cloudId);
      setLastCloudSyncTime(lastCloud);
      setLastCalendarSyncTime(lastCal);
      setICloudAutoSync(icloudEnabled);
      setCommuterConfig(commConfig);

      // 5. Aggiornamenti silenti di rete in BACKGROUND (completamente asincroni, zero ritardi per l'utente)
      getPairedDevicesInfo()
        .then((pairs) => {
          if (pairs) setPairedDevices(pairs);
        })
        .catch(() => {});

      if (storedUrl && localTabs.length === 0) {
        fetchTabs(storedUrl)
          .then((tabs) => {
            if (tabs && tabs.length > 0) setAvailableTabs(tabs);
          })
          .catch(() => {});
      }

      if (degrees.length === 0) {
        fetchDegrees()
          .then((degList) => {
            if (degList && degList.length > 0) setDegrees(degList);
          })
          .catch(() => {});
      }
    } catch (e) {
      console.error("Errore caricamento profilo:", e);
    }
  }, [degrees.length]);

  useFocusEffect(
    useCallback(() => {
      loadProfileData();
    }, [loadProfileData]),
  );

  useEffect(() => {
    const unsubscribe = subscribeToLiveSync((status, updated) => {
      setPairedDevices(status);
      getCloudSyncId().then(setCloudSyncId);
      getLastCloudSync().then(setLastCloudSyncTime);
      getICloudAutoSyncEnabled().then(setICloudAutoSync);
      if (updated) {
        loadProfileData();
      }
    });
    return () => {
      unsubscribe();
    };
  }, [loadProfileData]);

  const selectDegree = async (degree: Degree) => {
    setCourseModalVisible(false);

    try {
      // 1. Controlla se il corso è già presente in cache locale (download effettuato in precedenza)
      const cacheKey = `allSchedules_v8_${degree.url}`;
      const cachedRaw = await AsyncStorage.getItem(cacheKey);

      if (cachedRaw) {
        let cachedData: { tabs?: Tab[]; schedules?: Record<string, any> } | null = null;
        try {
          cachedData = JSON.parse(cachedRaw);
        } catch {}

        if (cachedData && Array.isArray(cachedData.tabs) && cachedData.tabs.length > 0) {
          const tabs = cachedData.tabs;
          // Recupera il canale precedentemente scelto per questo specifico corso
          const savedTabForDegree = await AsyncStorage.getItem(`defaultTabUrl_${degree.url}`);
          const activeTab = (savedTabForDegree && tabs.some((t) => t.url === savedTabForDegree))
            ? savedTabForDegree
            : (tabs[0]?.url || null);

          // Salva istantaneamente i parametri del corso selezionato
          const pairs: [string, string][] = [
            ["selectedDegreeUrl", degree.url],
            ["selectedDegreeName", degree.name],
            ["selectedDegreeClassName", degree.className || ""],
          ];
          if (activeTab) {
            pairs.push(["defaultTabUrl", activeTab]);
            pairs.push([`defaultTabUrl_${degree.url}`, activeTab]);
          }
          await AsyncStorage.multiSet(pairs);

          setDegreeUrl(degree.url);
          setDegreeName(degree.name);
          setDegreeClassName(degree.className || "");
          setDefaultTabUrl(activeTab);
          setAvailableTabs(tabs);
          setDownloadingCourse(null);

          // Ricarica le presenze e i dati del profilo per la facoltà appena attivata
          loadProfileData();

          // Esegui la verifica orari ordinaria in background (senza attese o blocchi UI)
          checkCourseUpdates(degree.url).then(async (checkRes) => {
            if (checkRes.hasChanges) {
              console.log("Verifica ordinaria: rilevate variazioni per il corso", degree.name);
              fetchAllCourseData(degree.url, true).catch(() => {});
            }
          }).catch(() => {});

          router.replace("/");
          return;
        }
      }

      // 2. Se non è presente in cache, scarica per la prima volta
      setDownloadingCourse(degree);
      setDownloadProgressText("Preparazione e analisi canali...");

      const { tabs } = await fetchAllCourseData(degree.url, false, (stepMsg) => {
        setDownloadProgressText(stepMsg);
      });

      await AsyncStorage.setItem("selectedDegreeUrl", degree.url);
      await AsyncStorage.setItem("selectedDegreeName", degree.name);
      if (degree.className) {
        await AsyncStorage.setItem("selectedDegreeClassName", degree.className);
      }

      const firstTab = tabs && tabs[0] ? tabs[0].url : null;
      if (firstTab) {
        await AsyncStorage.setItem("defaultTabUrl", firstTab);
        await AsyncStorage.setItem(`defaultTabUrl_${degree.url}`, firstTab);
      } else {
        await AsyncStorage.removeItem("defaultTabUrl");
      }

      setDegreeUrl(degree.url);
      setDegreeName(degree.name);
      setDegreeClassName(degree.className || "");
      setDefaultTabUrl(firstTab);
      setAvailableTabs(tabs);
      setDownloadingCourse(null);

      loadProfileData();

      if (tabs && tabs.length > 1) {
        const match = tabs.find((t) => t.url === firstTab) || tabs[0];
        setSelectedTabForSpecifiche(match || null);
        setChannelModalVisible(true);
      } else {
        router.replace("/");
      }
    } catch (err) {
      console.error("Errore durante download nuovo corso:", err);
      setDownloadingCourse(null);
      Alert.alert(
        "Errore di Connessione",
        "Impossibile scaricare i dati del corso dal sito Sapienza. Controlla la tua connessione e riprova.",
        [{ text: "OK" }],
      );
    }
  };

  const selectDefaultTab = async (tab: Tab) => {
    setDefaultTabUrl(tab.url);
    await AsyncStorage.setItem("defaultTabUrl", tab.url);
    if (degreeUrl) {
      await AsyncStorage.setItem(`defaultTabUrl_${degreeUrl}`, tab.url);
    }
    setChannelModalVisible(false);
  };

  const clearCacheAndReload = async () => {
    if (!degreeUrl) return;
    try {
      const dummyDegree: Degree = {
        name: degreeName || "Corso di Laurea",
        url: degreeUrl,
        className: "",
      };
      setDownloadingCourse(dummyDegree);
      setDownloadProgressText("Svuotamento cache e aggiornamento...");

      const allKeys = await AsyncStorage.getAllKeys();
      const keysToKeep = [
        "selectedDegreeUrl",
        "selectedDegreeName",
        "selectedDegreeClassName",
        "defaultTabUrl",
      ];
      const cacheKeys = allKeys.filter((k) => !keysToKeep.includes(k));
      await AsyncStorage.multiRemove(cacheKeys);

      const { tabs } = await fetchAllCourseData(degreeUrl, true, (stepMsg) => {
        setDownloadProgressText(stepMsg);
      });
      setAvailableTabs(tabs);
      setDownloadingCourse(null);

      Alert.alert(
        "Cache Aggiornata",
        "Orari e aule di tutti i canali sono stati riscaricati dal sito Sapienza.",
        [{ text: "OK", onPress: () => router.replace("/") }],
      );
    } catch (e) {
      console.error(e);
      setDownloadingCourse(null);
      Alert.alert(
        "Errore",
        "Si è verificato un errore durante l'aggiornamento.",
      );
    }
  };

  const resetApp = async () => {
    Alert.alert(
      "Ripristina",
      "Sei sicuro di voler ripristinare StudICI? Verranno rimossi il corso e le impostazioni salvate.",
      [
        { text: "Annulla", style: "cancel" },
        {
          text: "Ripristina",
          style: "destructive",
          onPress: async () => {
            await resetAppCloudAndStorage();
            router.replace("/");
          },
        },
      ],
    );
  };

  const handleDeleteAttendanceDirect = async (record: AttendanceRecord) => {
    try {
      if (Platform.OS === "ios") {
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      }
      const updated = await deleteAttendanceRecord(record.id, degreeUrl || undefined);
      setAttendanceRecords(updated);
      setAttendanceStats(getAttendanceStats(updated));
      if (iCloudAutoSync) {
        syncWithICloudStorage().catch(() => {});
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeleteAttendance = (record: AttendanceRecord) => {
    Alert.alert(
      "Rimuovi Presenza",
      `Vuoi rimuovere la presenza per ${record.subject} del ${record.displayDate || record.date}?`,
      [
        { text: "Annulla", style: "cancel" },
        {
          text: "Rimuovi",
          style: "destructive",
          onPress: () => handleDeleteAttendanceDirect(record),
        },
      ],
    );
  };

  const handleClearAllAttendance = () => {
    Alert.alert(
      "Azzera Registro presenze",
      "Sei sicuro di voler cancellare tutte le presenze registrate finora? Questa operazione non può essere annullata.",
      [
        { text: "Annulla", style: "cancel" },
        {
          text: "Azzera Tutto",
          style: "destructive",
          onPress: async () => {
            if (Platform.OS === "ios") {
              LayoutAnimation.configureNext(
                LayoutAnimation.Presets.easeInEaseOut,
              );
            }
            await clearAllAttendance();
            setAttendanceRecords([]);
            setAttendanceStats(getAttendanceStats([]));
            setAttendanceModalVisible(false);
            if (iCloudAutoSync) {
              syncWithICloudStorage().catch(() => {});
            }
          },
        },
      ],
    );
  };

  const renderRightActions = (
    _progress: Animated.AnimatedInterpolation<number | string>,
    dragX: Animated.AnimatedInterpolation<number | string>,
    item: AttendanceRecord,
  ) => {
    const scale = dragX.interpolate({
      inputRange: [-160, -70, 0],
      outputRange: [1.15, 1, 0.5],
      extrapolate: "clamp",
    });
    const opacity = dragX.interpolate({
      inputRange: [-90, -30, 0],
      outputRange: [1, 1, 0],
      extrapolate: "clamp",
    });
    const trans = dragX.interpolate({
      inputRange: [-240, -70, 0],
      outputRange: [0, 0, 30],
      extrapolate: "clamp",
    });

    return (
      <TouchableOpacity
        style={styles.swipeDeleteContainer}
        activeOpacity={0.85}
        onPress={() => handleDeleteAttendanceDirect(item)}
      >
        <Animated.View
          style={[
            styles.swipeDeleteContent,
            {
              opacity,
              transform: [{ scale }, { translateX: trans }],
            },
          ]}
        >
          <Ionicons name="trash" size={20} color="#ffffff" />
          <Text style={styles.swipeDeleteText}>Elimina</Text>
        </Animated.View>
      </TouchableOpacity>
    );
  };

  const renderAttendanceCardContent = (item: AttendanceRecord) => (
    <>
      <View style={styles.attendanceDateSquircle}>
        <Text style={styles.attendanceDayName}>
          {item.dayName?.slice(0, 3).toUpperCase() || "GIORNO"}
        </Text>
        <Text style={styles.attendanceDateNum}>
          {item.displayDate?.split(" ")[0] || ""}
        </Text>
      </View>

      <View style={{ flex: 1, marginHorizontal: 12 }}>
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <Text style={[styles.attendanceHistorySubject, { flexShrink: 1 }]} numberOfLines={1}>
            {item.subject?.toUpperCase()}
          </Text>
          {item.isManual && (
            <View style={styles.manualAttendanceBadge}>
              <Text style={styles.manualAttendanceBadgeText}>MANUALE</Text>
            </View>
          )}
        </View>
        <View style={styles.attendanceTimeRow}>
          <Ionicons
            name="time-outline"
            size={13}
            color="#94a3b8"
            style={{ marginRight: 4 }}
          />
          <Text style={styles.attendanceHistoryTime}>
            {item.startTime} - {item.endTime} ({item.duration}h)
          </Text>
        </View>
        {item.room ? (
          <View style={styles.attendanceRoomRow}>
            <Ionicons
              name="location-outline"
              size={12}
              color="#ef4444"
              style={{ marginRight: 3 }}
            />
            <Text style={styles.attendanceHistoryRoom} numberOfLines={1}>
              {item.room}
            </Text>
          </View>
        ) : null}
      </View>

      <TouchableOpacity
        style={styles.attendanceDeleteButton}
        activeOpacity={0.7}
        onPress={() => handleDeleteAttendance(item)}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Ionicons name="trash-outline" size={17} color="#ef4444" />
      </TouchableOpacity>
    </>
  );

  const openSourceWebsite = async () => {
    await WebBrowser.openBrowserAsync("https://ici.web.uniroma1.it/node/388");
  };

  const handleSyncCloud = async () => {
    setIsSyncingCloud(true);
    try {
      const res = await syncWithICloudStorage();
      const updatedPairs = await getPairedDevicesInfo();
      setPairedDevices(updatedPairs);
      if (res.success) {
        setLastCloudSyncTime(await getLastCloudSync());
        if (res.updated) await loadProfileData();
        Alert.alert("Sincronizzazione", res.message);
      } else {
        if (res.notPaired) {
          Alert.alert(
            "Nessun Dispositivo Associato",
            "Copia il codice e inseriscilo sul secondo dispositivo per avviare la sincronizzazione.",
          );
        } else {
          Alert.alert("Sincronizzazione non riuscita", res.message);
        }
      }
    } catch {
      Alert.alert(
        "Errore",
        "Impossibile completare la sincronizzazione cloud.",
      );
    } finally {
      setIsSyncingCloud(false);
    }
  };

  const handleSyncCalendar = async () => {
    if (!degreeUrl) {
      Alert.alert(
        "Nessun corso",
        "Configura prima un corso di laurea per sincronizzare le lezioni.",
      );
      return;
    }
    const tabUrl = defaultTabUrl || availableTabs[0]?.url;
    if (!tabUrl) {
      Alert.alert(
        "Nessun canale",
        "Seleziona prima un canale o anno per sincronizzare l'orario.",
      );
      return;
    }

    Alert.alert(
      "Calendario Apple",
      `Vuoi sincronizzare le lezioni di "${courseMetadata.cleanCourseTitle}" nel Calendario di iOS? Verrà creato il calendario "StudICI - Lezioni Sapienza".`,
      [
        { text: "Annulla", style: "cancel" },
        {
          text: "Sincronizza",
          onPress: async () => {
            setIsSyncingCalendar(true);
            try {
              const schedule = await fetchScheduleData(tabUrl);
              const res = await syncScheduleToAppleCalendar(
                schedule,
                courseMetadata.cleanCourseTitle,
                defaultTabLabel,
              );
              if (res.success) {
                setLastCalendarSyncTime(Date.now());
                Alert.alert("Calendario Sincronizzato", res.message);
              } else {
                Alert.alert("Errore Calendario", res.message);
              }
            } catch (err: any) {
              Alert.alert(
                "Errore",
                err?.message ||
                  "Errore durante la sincronizzazione con il calendario.",
              );
            } finally {
              setIsSyncingCalendar(false);
            }
          },
        },
      ],
    );
  };

  const handleExportSchedulePdf = async () => {
    if (!degreeUrl) {
      Alert.alert(
        "Nessun corso",
        "Configura prima un corso per esportare l'orario.",
      );
      return;
    }
    const tabUrl = defaultTabUrl || availableTabs[0]?.url;
    if (!tabUrl) {
      Alert.alert("Nessun canale", "Seleziona prima un canale.");
      return;
    }

    setIsExportingPdf(true);
    try {
      const schedule = await fetchScheduleData(tabUrl, true);
      const manualEvents = await getManualEvents(degreeUrl || undefined);
      await exportScheduleToPdf(
        schedule,
        courseMetadata.cleanCourseTitle,
        defaultTabLabel,
        manualEvents,
      );
    } catch (err: any) {
      Alert.alert(
        "Errore Esportazione",
        err?.message || "Impossibile generare il PDF dell'orario.",
      );
    } finally {
      setIsExportingPdf(false);
    }
  };

  const handleExportAttendancePdf = async () => {
    setIsExportingPdf(true);
    try {
      await exportAttendanceToPdf(
        attendanceRecords,
        attendanceStats,
        courseMetadata.cleanCourseTitle,
      );
    } catch (err: any) {
      Alert.alert(
        "Errore Esportazione",
        err?.message || "Impossibile generare il PDF del registro presenze.",
      );
    } finally {
      setIsExportingPdf(false);
    }
  };

  const handleDissociateDevice = (
    targetDeviceId?: string,
    deviceName?: string,
  ) => {
    const targetName =
      deviceName ||
      pairedDevices?.otherDevice?.name ||
      "il dispositivo associato";

    Alert.alert(
      "Dissocia Dispositivo",
      `Vuoi dissociare "${targetName}"? La sincronizzazione con questo dispositivo verrà interrotta e, in caso di dissociazione da un master, verranno rimossi gli elementi ereditati ripristinando lo stato precedente.`,
      [
        { text: "Annulla", style: "cancel" },
        {
          text: "Dissocia",
          style: "destructive",
          onPress: async () => {
            setIsSyncingCloud(true);
            try {
              const res = await dissociateDevice(targetDeviceId);
              await loadProfileData();
              const updatedPairs = await getPairedDevicesInfo();
              setPairedDevices(updatedPairs);
              if (!updatedPairs.isPaired) {
                await setICloudAutoSyncEnabled(false);
                setICloudAutoSync(false);
              }
              Alert.alert(
                res.success ? "Dispositivo Dissociato" : "Errore",
                res.message,
              );
            } catch {
              Alert.alert("Errore", "Impossibile dissociare il dispositivo.");
            } finally {
              setIsSyncingCloud(false);
            }
          },
        },
      ],
    );
  };

  const handleChangeCustomSyncCode = () => {
    if (Platform.OS === "ios") {
      Alert.prompt(
        "Personalizza Codice Cloud",
        "Scegli un identificativo univoco (es. nome o matricola). Usando lo stesso testo su entrambi i dispositivi si collegheranno automaticamente.",
        [
          { text: "Annulla", style: "cancel" },
          {
            text: "Salva",
            onPress: async (val?: string) => {
              if (!val || !val.trim()) return;
              const res = await setCustomCloudSyncId(val.trim());
              if (res.success) {
                setCloudSyncId(val.trim().toUpperCase());
                await loadProfileData();
                Alert.alert("Codice Aggiornato", res.message);
              } else {
                Alert.alert("Nome Non Disponibile", res.message);
              }
            },
          },
        ],
        "plain-text",
        cloudSyncId,
      );
    }
  };

  const handleCopyCloudCode = async () => {
    try {
      const code = cloudSyncId || (await getCloudSyncId());
      if (code) {
        await Clipboard.setStringAsync(code);
        setCloudSyncId(code);
        if (isCloudConfigured()) {
          syncWithICloudStorage().catch(() => {});
        }
        return;
      }
      await copyCloudSyncCodeToClipboard();
    } catch {
      Alert.alert("Errore", "Impossibile copiare il codice.");
    }
  };

  const handleRestoreFromCloud = async () => {
    if (!restoreCodeInput.trim()) {
      Alert.alert("Codice mancante", "Incolla il codice nel campo di testo.");
      return;
    }

    // Codice Dispositivo (STUD-XXXX-XXXX-XXXX o nome): collegamento + associazione
    if (isValidSyncCode(restoreCodeInput)) {
      setIsSyncingCloud(true);
      try {
        const res = await linkDeviceWithCode(restoreCodeInput);
        if (res.success) {
          setRestoreCodeInput("");
          await loadProfileData();
          const updatedPairs = await getPairedDevicesInfo();
          setPairedDevices(updatedPairs);
        } else {
          Alert.alert("Associazione non riuscita", res.message);
        }
      } catch (err: any) {
        Alert.alert(
          "Errore",
          err?.message || "Impossibile associare il dispositivo.",
        );
      } finally {
        setIsSyncingCloud(false);
      }
      return;
    }

    // Codice di backup manuale (STUDICI_CLOUD:...)
    Alert.alert(
      "Ripristina dati Cloud",
      "I dati attuali sul dispositivo verranno sostituiti con quelli presenti nel backup cloud. Continuare?",
      [
        { text: "Annulla", style: "cancel" },
        {
          text: "Ripristina",
          style: "destructive",
          onPress: async () => {
            const res = await restoreFromCloudBackup(restoreCodeInput);
            if (res.success) {
              setRestoreCodeInput("");
              setCloudModalVisible(false);
              await loadProfileData();
              Alert.alert("Ripristino completato", res.message);
            } else {
              Alert.alert("Errore ripristino", res.message);
            }
          },
        },
      ],
    );
  };

  const handleToggleICloudAutoSync = async (value: boolean) => {
    if (!pairedDevices?.isPaired) {
      Alert.alert(
        "Associazione richiesta",
        "Associa prima un secondo dispositivo usando il codice per attivare la sincronizzazione automatica.",
      );
      setICloudAutoSync(false);
      await setICloudAutoSyncEnabled(false);
      return;
    }
    if (value && !isCloudConfigured()) {
      Alert.alert(
        "Cloud non configurato",
        "La sincronizzazione automatica non è disponibile in questa build.",
      );
      return;
    }
    setICloudAutoSync(value);
    await setICloudAutoSyncEnabled(value);
    if (value) {
      const res = await syncWithICloudStorage();
      setLastCloudSyncTime(await getLastCloudSync());
      if (res.success) {
        if (res.updated) await loadProfileData();
      } else {
        Alert.alert("Sincronizzazione non riuscita", res.message);
      }
    }
  };

  const parsedAvailable = useMemo(
    () => parseTabHierarchy(availableTabs),
    [availableTabs],
  );
  const defaultTabInfo = useMemo(() => {
    if (!defaultTabUrl) return parsedAvailable[0] || null;
    return (
      parsedAvailable.find((p) => p.tab.url === defaultTabUrl) ||
      parsedAvailable[0] ||
      null
    );
  }, [defaultTabUrl, parsedAvailable]);

  const defaultTabObj =
    availableTabs.find((t) => t.url === defaultTabUrl) ||
    availableTabs[0] ||
    null;

  const defaultTabLabel = !defaultTabInfo
    ? defaultTabObj
      ? defaultTabObj.name
      : "Non impostato"
    : `${defaultTabInfo.year}${defaultTabInfo.channel ? ` · ${defaultTabInfo.channel}` : ""}`;

  const rawCourseName = degreeName || "";
  const rawCourseClass = degreeClassName || "";

  // Tipologia Laurea
  const isMagistrale =
    /magistrale|LM[- ]?\d+/i.test(rawCourseName) ||
    /LM[- ]?\d+/i.test(rawCourseClass);
  const isCicloUnico =
    /ciclo unico|quinquennale/i.test(rawCourseName) ||
    /ciclo unico/i.test(rawCourseClass);
  const degreeTypeLabel = isCicloUnico
    ? "Ciclo Unico"
    : isMagistrale
      ? "Magistrale"
      : "Triennale";

  // Risoluzione codice classe (es. "L-9R", "L-9", "LM-20", "L-8")
  const matchedDegree = degrees.find(
    (d) =>
      (degreeUrl && d.url === degreeUrl) ||
      (degreeName && d.name.toLowerCase() === degreeName.toLowerCase()),
  );
  const resolvedClassCode = extractClassCode(
    degreeClassName || matchedDegree?.className || rawCourseClass || rawCourseName,
  );

  const cleanCourseTitle =
    rawCourseName
      .replace(/\s*[-–]\s*(?:triennale|magistrale)\b/gi, "")
      .trim() || "Nessun corso";

  const courseMetadata = {
    cleanCourseTitle,
    degreeTypeLabel,
    isMagistrale,
    isCicloUnico,
    resolvedClassCode,
    faculty: "Facoltà di Ingegneria Civile e Industriale",
  };

  const groupedAttendance = useMemo(() => {
    const groups: {
      date: string;
      displayDate: string;
      dayName: string;
      records: AttendanceRecord[];
    }[] = [];
    const map = new Map<
      string,
      {
        date: string;
        displayDate: string;
        dayName: string;
        records: AttendanceRecord[];
      }
    >();

    // Sort by timestamp descending (newest first)
    const sorted = [...attendanceRecords].sort(
      (a, b) => b.timestamp - a.timestamp,
    );

    for (const r of sorted) {
      const key = r.date || "other";
      if (!map.has(key)) {
        const group = {
          date: r.date,
          displayDate: r.displayDate || r.date,
          dayName: r.dayName || "Giorno",
          records: [],
        };
        map.set(key, group);
        groups.push(group);
      }
      map.get(key)!.records.push(r);
    }

    return groups;
  }, [attendanceRecords]);

  const filteredDegrees = useMemo(() => {
    if (!searchCourse.trim()) return degrees;
    const q = searchCourse.toLowerCase().trim();
    return degrees.filter(
      (d) =>
        d.name.toLowerCase().includes(q) ||
        (d.className && d.className.toLowerCase().includes(q)),
    );
  }, [degrees, searchCourse]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.header}>
        <Text style={styles.largeTitle}>Profilo</Text>
      </View>

      <ScrollView
        style={styles.container}
        contentContainerStyle={{
          paddingBottom: Math.max(20, insets.bottom + 14),
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* Apple ID Style Account Header Card con Metadati Corso */}
        <View style={styles.profileHeaderCard}>
          <View
            style={[
              styles.profileAvatarBox,
              { backgroundColor: theme.primary, shadowColor: theme.primary },
            ]}
          >
            <Ionicons name="school" size={26} color="#ffffff" />
          </View>
          <View style={styles.profileHeaderInfo}>
            <Text style={styles.profileDegreeTitle} numberOfLines={2}>
              {courseMetadata.cleanCourseTitle}
            </Text>
            <Text style={styles.profileFacultySubtitle}>
              {courseMetadata.faculty}
            </Text>

            {/* Badge Tipologia & Classe (stesso stile glowing della schermata di scelta facoltà) */}
            <View style={styles.profileBadgesRow}>
              <View
                style={[
                  styles.typeBadge,
                  {
                    backgroundColor: courseMetadata.isMagistrale
                      ? "rgba(168, 85, 247, 0.25)"
                      : courseMetadata.isCicloUnico
                      ? "rgba(234, 179, 8, 0.25)"
                      : "rgba(59, 130, 246, 0.25)",
                    borderColor: courseMetadata.isMagistrale
                      ? "#c084fc"
                      : courseMetadata.isCicloUnico
                      ? "#facc15"
                      : "#60a5fa",
                    shadowColor: courseMetadata.isMagistrale
                      ? "#c084fc"
                      : courseMetadata.isCicloUnico
                      ? "#facc15"
                      : "#60a5fa",
                  },
                ]}
              >
                <Text
                  style={[
                    styles.typeBadgeText,
                    {
                      color: courseMetadata.isMagistrale
                        ? "#e9d5ff"
                        : courseMetadata.isCicloUnico
                        ? "#fef08a"
                        : "#bfdbfe",
                    },
                  ]}
                >
                  {courseMetadata.degreeTypeLabel}
                </Text>
              </View>

              {courseMetadata.resolvedClassCode ? (() => {
                const classTheme = getDegreeClassTheme(courseMetadata.resolvedClassCode);
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
                      {courseMetadata.resolvedClassCode}
                    </Text>
                  </View>
                );
              })() : null}
            </View>
          </View>
        </View>

        {/* Gruppo 1: CORSO & DIDATTICA */}
        <Text style={styles.sectionHeader}>CORSO</Text>
        <View style={styles.groupedCard}>
          {/* Riga 1: Corso di Laurea */}
          <TouchableOpacity
            style={styles.tableRow}
            activeOpacity={0.7}
            onPress={async () => {
              setCourseModalVisible(true);
              if (degrees.length === 0) {
                try {
                  const degList = await fetchDegrees();
                  if (degList && degList.length > 0) setDegrees(degList);
                } catch {}
              }
            }}
          >
            <View
              style={[
                styles.iconBox,
                { backgroundColor: theme.subtle, borderColor: theme.border },
              ]}
            >
              <Ionicons name="school-outline" size={17} color={theme.accent} />
            </View>
            <Text style={styles.rowTitle}>Corso di Laurea</Text>
            <Text style={styles.rowDetail} numberOfLines={1}>
              {courseMetadata.cleanCourseTitle}
            </Text>
            <Ionicons name="chevron-forward" size={15} color="#48484a" />
          </TouchableOpacity>

          <View style={styles.separator} />

          {/* Riga 2: Canale / Anno Predefinito */}
          <TouchableOpacity
            style={styles.tableRow}
            activeOpacity={0.7}
            onPress={() => {
              const match =
                availableTabs.find((t) => t.url === defaultTabUrl) ||
                availableTabs[0];
              setSelectedTabForSpecifiche(match || null);
              setChannelModalVisible(true);
            }}
          >
            <View
              style={[
                styles.iconBox,
                { backgroundColor: theme.subtle, borderColor: theme.border },
              ]}
            >
              <Ionicons name="funnel-outline" size={16} color={theme.accent} />
            </View>
            <Text style={styles.rowTitle}>Specifiche</Text>
            <Text style={styles.rowDetail} numberOfLines={1}>
              {defaultTabLabel}
            </Text>
            <Ionicons name="chevron-forward" size={15} color="#48484a" />
          </TouchableOpacity>
        </View>
        <Text style={styles.sectionFooter}>
          Modifica il corso di laurea e il canale/anno predefinito per
          l&apos;app. Queste impostazioni influenzano le lezioni, gli orari e le
          aule visualizzate.
        </Text>

        {/* Gruppo: ASPETTO & TEMA */}
        <Text style={styles.sectionHeader}>ASPETTO</Text>
        <View
          style={styles.groupedCard}
          onLayout={(e) => {
            const w = e.nativeEvent.layout.width;
            if (w > 0 && Math.abs(w - measuredCardWidth) > 1) {
              setMeasuredCardWidth(w);
            }
          }}
        >
          {isNativeComponentAvailable ? (
            <MenuView
              title="Tema"
              actions={themeMenuActions}
              shouldOpenOnLongPress={false}
              onPressAction={({ nativeEvent }) => {
                setThemeId(nativeEvent.event);
              }}
              style={{ width: themeCardWidth }}
            >
              <View style={[styles.tableRow, { width: themeCardWidth }]}>
                <View
                  style={[
                    styles.iconBox,
                    { backgroundColor: theme.subtle, borderColor: theme.border },
                  ]}
                >
                  <Ionicons
                    name="color-palette-outline"
                    size={17}
                    color={theme.accent}
                  />
                </View>
                <Text style={styles.rowTitle}>Tema</Text>
                <View style={styles.themeRowPreview}>
                  <View
                    style={[
                      styles.themeRowDot,
                      { backgroundColor: theme.primary },
                    ]}
                  />
                  <Text style={styles.rowDetail} numberOfLines={1}>
                    {theme.name}
                  </Text>
                  <Ionicons name="chevron-forward" size={15} color="#48484a" />
                </View>
              </View>
            </MenuView>
          ) : (
            <>
              <TouchableOpacity
                style={styles.tableRow}
                activeOpacity={0.7}
                onPress={() => setThemeSectionExpanded((prev) => !prev)}
              >
                <View
                  style={[
                    styles.iconBox,
                    { backgroundColor: theme.subtle, borderColor: theme.border },
                  ]}
                >
                  <Ionicons
                    name="color-palette-outline"
                    size={17}
                    color={theme.accent}
                  />
                </View>
                <Text style={styles.rowTitle}>Tema</Text>
                <View style={styles.themeRowPreview}>
                  <View
                    style={[
                      styles.themeRowDot,
                      { backgroundColor: theme.primary },
                    ]}
                  />
                  <Text style={styles.rowDetail} numberOfLines={1}>
                    {theme.name}
                  </Text>
                  <Ionicons
                    name={themeSectionExpanded ? "chevron-up" : "chevron-down"}
                    size={15}
                    color="#48484a"
                  />
                </View>
              </TouchableOpacity>

              {themeSectionExpanded && (
                <View style={styles.themeDropdownContainer}>
                  <View style={styles.separator} />
                  <View style={styles.themeGrid}>
                    {availableThemes.map((t) => {
                      const isSelected = t.id === themeId;
                      return (
                        <TouchableOpacity
                          key={t.id}
                          style={[
                            styles.themeCardItem,
                            isSelected && {
                              borderColor: t.primary,
                              backgroundColor: t.cardTint,
                            },
                          ]}
                          activeOpacity={0.7}
                          onPress={() => setThemeId(t.id)}
                        >
                          <View
                            style={[
                              styles.themeColorDot,
                              { backgroundColor: t.primary },
                            ]}
                          >
                            {isSelected && (
                              <Ionicons
                                name="checkmark"
                                size={13}
                                color="#ffffff"
                              />
                            )}
                          </View>
                          <Text
                            style={[
                              styles.themeCardName,
                              isSelected && {
                                color: "#ffffff",
                                fontWeight: "700",
                              },
                            ]}
                            numberOfLines={1}
                          >
                            {t.name}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              )}
            </>
          )}
        </View>
        <Text style={styles.sectionFooter}>
          Personalizza il colore principale dell&apos;app.
        </Text>

        {/* Gruppo: REGISTRO PRESENZE */}
        <Text style={styles.sectionHeader}>REGISTRO PRESENZE</Text>

        {/* 3 KPI Health / Fitness Cards */}
        <View style={styles.statsCardsRow}>
          {/* Card 1: Ore Totali */}
          <View style={styles.statCard}>
            <View
              style={[
                styles.statIconSquircle,
                { backgroundColor: "rgba(16, 185, 129, 0.15)" },
              ]}
            >
              <Ionicons name="time" size={17} color="#10b981" />
            </View>
            <Text style={styles.statValue}>
              {attendanceStats?.totalHours || 0}h
            </Text>
            <Text style={styles.statLabel}>FREQUENZA</Text>
          </View>

          {/* Card 2: Lezioni */}
          <View style={styles.statCard}>
            <View
              style={[
                styles.statIconSquircle,
                { backgroundColor: "rgba(59, 130, 246, 0.15)" },
              ]}
            >
              <Ionicons name="checkmark-done" size={17} color="#3b82f6" />
            </View>
            <Text style={styles.statValue}>
              {attendanceStats?.totalLessons || 0}
            </Text>
            <Text style={styles.statLabel}>LEZIONI</Text>
          </View>

          {/* Card 3: Materie */}
          <View style={styles.statCard}>
            <View
              style={[
                styles.statIconSquircle,
                { backgroundColor: "rgba(168, 85, 247, 0.15)" },
              ]}
            >
              <Ionicons name="book" size={17} color="#a855f7" />
            </View>
            <Text style={styles.statValue}>
              {attendanceStats?.subjectsCount || 0}
            </Text>
            <Text style={styles.statLabel}>MATERIE</Text>
          </View>
        </View>

        {/* Dettaglio Registro Table Card Compatto */}
        <View style={styles.groupedCard}>
          <TouchableOpacity
            style={styles.tableRow}
            activeOpacity={0.7}
            onPress={() => setAttendanceModalVisible(true)}
          >
            <View
              style={[
                styles.iconBox,
                { backgroundColor: theme.subtle, borderColor: theme.border },
              ]}
            >
              <Ionicons
                name="calendar-outline"
                size={17}
                color={theme.accent}
              />
            </View>
            <Text style={styles.rowTitle}>Registro presenze</Text>
            <Text style={styles.rowDetail}>
              {attendanceRecords.length > 0
                ? `${attendanceRecords.length} registrate`
                : "Nessuna"}
            </Text>
            <Ionicons name="chevron-forward" size={15} color="#48484a" />
          </TouchableOpacity>
        </View>
        <Text style={styles.sectionFooter}>
          Tieni premuta una lezione nell&apos;orario per registrarne la
          frequenza.
        </Text>

        {/* Gruppo: SINCRONIZZAZIONE */}
        <Text style={styles.sectionHeader}>SINCRONIZZAZIONE</Text>
        <View style={styles.groupedCard}>
          {/* Riga 1: Sincronizzazione */}
          <TouchableOpacity
            style={styles.tableRow}
            activeOpacity={0.7}
            onPress={() => setCloudModalVisible(true)}
          >
            <View
              style={[
                styles.iconBox,
                { backgroundColor: theme.subtle, borderColor: theme.border },
              ]}
            >
              {isSyncingCloud ? (
                <ActivityIndicator size="small" color={theme.accent} />
              ) : (
                <Ionicons
                  name="cloud-outline"
                  size={17}
                  color={theme.accent}
                />
              )}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>Sincronizzazione</Text>
              <Text style={styles.rowSubTitle}>
                {pairedDevices?.isPaired && pairedDevices.otherDevice
                  ? `Associato con ${pairedDevices.otherDevice.name} • ${formatSyncDate(lastCloudSyncTime)}`
                  : "Non attiva"}
              </Text>
            </View>
            <NativeActionButton
              label={isSyncingCloud ? "In corso..." : "Sincronizza"}
              onPress={handleSyncCloud}
              disabled={isSyncingCloud}
              variant="filled"
              glow={true}
              glowColor={theme.accent}
              accentColor={theme.primary}
              style={[
                styles.inlineActionBtnCallstack,
                {
                  shadowColor: theme.accent,
                  shadowOpacity: 0.35,
                  shadowRadius: 5,
                },
              ]}
              pillStyle={{
                height: 32,
                borderRadius: 16,
                paddingHorizontal: 13,
              }}
              textStyle={styles.inlineActionBtnText}
            />
            <Ionicons
              name="chevron-forward"
              size={15}
              color="#48484a"
              style={{ marginLeft: 6 }}
            />
          </TouchableOpacity>

          <View style={styles.separator} />

          {/* Riga 2: Calendario Apple */}
          <TouchableOpacity
            style={styles.tableRow}
            activeOpacity={0.7}
            onPress={handleSyncCalendar}
            disabled={isSyncingCalendar}
          >
            <View
              style={[
                styles.iconBox,
                { backgroundColor: theme.subtle, borderColor: theme.border },
              ]}
            >
              {isSyncingCalendar ? (
                <ActivityIndicator size="small" color={theme.accent} />
              ) : (
                <Ionicons
                  name="calendar-clear-outline"
                  size={17}
                  color={theme.accent}
                />
              )}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>Calendario Apple</Text>
              <Text style={styles.rowSubTitle}>
                {formatSyncDate(lastCalendarSyncTime)}
              </Text>
            </View>
            <NativeActionButton
              label={isSyncingCalendar ? "In corso..." : "Sincronizza"}
              onPress={handleSyncCalendar}
              disabled={isSyncingCalendar}
              variant="filled"
              glow={true}
              glowColor={theme.accent}
              accentColor={theme.primary}
              style={[
                styles.inlineActionBtnCallstack,
                {
                  shadowColor: theme.accent,
                  shadowOpacity: 0.35,
                  shadowRadius: 5,
                },
              ]}
              pillStyle={{
                height: 32,
                borderRadius: 16,
                paddingHorizontal: 13,
              }}
              textStyle={styles.inlineActionBtnText}
            />
          </TouchableOpacity>
        </View>
        <Text style={styles.sectionFooter}>
          Sincronizza tra dispositivi o esporta nel calendario Apple.
        </Text>

        {/* Gruppo: ITINERARIO PENDOLARE */}
        <Text style={styles.sectionHeader}>VIAGGIO</Text>
        <View style={styles.groupedCard}>
          <TouchableOpacity
            style={styles.tableRow}
            activeOpacity={0.7}
            onPress={() => setCommuterModalVisible(true)}
          >
            <View
              style={[
                styles.iconBox,
                { backgroundColor: theme.subtle, borderColor: theme.border },
              ]}
            >
              <Ionicons name="train-outline" size={17} color={theme.accent} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>Impostazioni</Text>
              <Text style={styles.rowSubTitle}>
                {commuterConfig?.enabled === false
                  ? "Tocca per configurare"
                  : `${commuterConfig?.originAddress || "Amelia"} ➔ ${
                      commuterConfig?.departureStation?.shortName || "Orte"
                    } ➔ ${commuterConfig?.arrivalStation?.shortName || "Roma Tiburtina"}${
                      commuterConfig?.carLeg?.enabled ? " • Auto inclusa" : ""
                    }`}
              </Text>
            </View>
            <Ionicons
              name="chevron-forward"
              size={15}
              color="#48484a"
              style={{ marginLeft: 6 }}
            />
          </TouchableOpacity>
        </View>
        <Text style={styles.sectionFooter}>
          Configura il tuo itinerario pendolare per ricevere gli aggiornamenti
          sullo stato dei treni.
        </Text>

        {/* Gruppo: ESPORTA & CONDIVIDI */}
        <Text style={styles.sectionHeader}>ESPORTAZIONE</Text>
        <View style={styles.groupedCard}>
          {/* Riga 1: PDF Orario Settimanale */}
          <TouchableOpacity
            style={styles.tableRow}
            activeOpacity={0.7}
            onPress={handleExportSchedulePdf}
            disabled={isExportingPdf}
          >
            <View
              style={[
                styles.iconBox,
                { backgroundColor: theme.subtle, borderColor: theme.border },
              ]}
            >
              {isExportingPdf ? (
                <ActivityIndicator size="small" color={theme.accent} />
              ) : (
                <Ionicons
                  name="document-text-outline"
                  size={17}
                  color={theme.accent}
                />
              )}
            </View>
            <Text style={styles.rowTitle}>Orario settimanale</Text>
            <Ionicons name="share-outline" size={18} color="#8e8e93" />
          </TouchableOpacity>

          <View style={styles.separator} />

          {/* Riga 2: PDF Registro presenze */}
          <TouchableOpacity
            style={styles.tableRow}
            activeOpacity={0.7}
            onPress={handleExportAttendancePdf}
            disabled={isExportingPdf}
          >
            <View
              style={[
                styles.iconBox,
                { backgroundColor: theme.subtle, borderColor: theme.border },
              ]}
            >
              {isExportingPdf ? (
                <ActivityIndicator size="small" color={theme.accent} />
              ) : (
                <Ionicons
                  name="stats-chart-outline"
                  size={16}
                  color={theme.accent}
                />
              )}
            </View>
            <Text style={styles.rowTitle}>Registro presenze</Text>
            <Ionicons name="share-outline" size={18} color="#8e8e93" />
          </TouchableOpacity>
        </View>
        <Text style={styles.sectionFooter}>
          Esporta orario e presenze in formato PDF.
        </Text>

        {/* Gruppo 2: FONTI UFFICIALI */}
        <Text style={styles.sectionHeader}>FONTI UFFICIALI</Text>
        <View style={styles.groupedCard}>
          <TouchableOpacity
            style={styles.tableRow}
            activeOpacity={0.7}
            onPress={openSourceWebsite}
          >
            <View
              style={[
                styles.iconBox,
                { backgroundColor: theme.subtle, borderColor: theme.border },
              ]}
            >
              <Ionicons name="globe-outline" size={17} color={theme.accent} />
            </View>
            <Text style={styles.rowTitle}>Portale Orari ICI</Text>
            <Text style={styles.rowDetail} numberOfLines={1}>
              web.uniroma1.it
            </Text>
            <Ionicons name="open-outline" size={15} color="#48484a" />
          </TouchableOpacity>
        </View>

        {/* Gruppo 3: SISTEMA & ARCHIVIAZIONE */}
        <Text style={styles.sectionHeader}>ARCHIVIAZIONE</Text>
        <View style={styles.groupedCard}>
          {/* Riga 1: Svuota Cache */}
          <TouchableOpacity
            style={styles.tableRow}
            activeOpacity={0.7}
            onPress={clearCacheAndReload}
          >
            <View
              style={[
                styles.iconBox,
                { backgroundColor: theme.subtle, borderColor: theme.border },
              ]}
            >
              <Ionicons
                name="refresh-outline"
                size={17}
                color={theme.accent}
              />
            </View>
            <Text style={styles.rowTitle}>Riscarica orari</Text>
            <Ionicons name="chevron-forward" size={15} color="#48484a" />
          </TouchableOpacity>

          <View style={styles.separator} />

          {/* Riga 2: Reset Totale */}
          <TouchableOpacity
            style={styles.tableRow}
            activeOpacity={0.7}
            onPress={resetApp}
          >
            <View
              style={[
                styles.iconBox,
                {
                  backgroundColor: "rgba(255, 69, 58, 0.12)",
                  borderColor: "rgba(255, 69, 58, 0.25)",
                },
              ]}
            >
              <Ionicons name="trash-outline" size={16} color="#ff453a" />
            </View>
            <Text style={[styles.rowTitle, { color: "#ff453a" }]}>
              Ripristina applicazione
            </Text>
            <Ionicons name="chevron-forward" size={15} color="#48484a" />
          </TouchableOpacity>
        </View>

        {/* Gruppo: AGGIORNAMENTI & SIDELOADING */}
        <Text style={styles.sectionHeader}>AGGIORNAMENTI</Text>
        <View style={styles.groupedCard}>
          {/* Verifica Aggiornamenti GitHub */}
          <TouchableOpacity
            style={styles.tableRow}
            activeOpacity={0.7}
            onPress={handleManualCheckUpdate}
          >
            <View
              style={[
                styles.iconBox,
                { backgroundColor: theme.subtle, borderColor: theme.border },
              ]}
            >
              {checkingUpdate ? (
                <ActivityIndicator size="small" color={theme.accent} />
              ) : (
                <Ionicons
                  name="cloud-download-outline"
                  size={17}
                  color={theme.accent}
                />
              )}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>Controlla versione</Text>
              <Text style={styles.rowSubTitle}>
                {appUpdate?.hasUpdate
                  ? `Nuova versione v${appUpdate.latestVersion} disponibile!`
                  : `Versione v${Constants.expoConfig?.version || "1.7.8"} (aggiornata)`}
              </Text>
            </View>
            {appUpdate?.hasUpdate ? (
              <View
                style={[styles.updatePill, { backgroundColor: theme.primary }]}
              >
                <Text style={styles.updatePillText}>UPDATE</Text>
              </View>
            ) : (
              <Ionicons name="checkmark-circle" size={16} color="#10b981" />
            )}
          </TouchableOpacity>
        </View>

        {/* Footer Info App */}
        <View style={styles.footer}>
          <TouchableOpacity
            style={styles.githubCircleBtn}
            activeOpacity={0.7}
            onPress={() =>
              Linking.openURL("https://github.com/Itachisann/StudICI")
            }
          >
            <Ionicons name="logo-github" size={24} color="#ffffff" />
          </TouchableOpacity>

          <Text style={styles.footerText}>
            {`StudICI · v${Constants.expoConfig?.version || "1.4.9"} (Build ${Constants.expoConfig?.ios?.buildNumber || "7"})`}
          </Text>
          <Text style={styles.footerSubText}>Sapienza Università di Roma</Text>
        </View>
      </ScrollView>

      {/* Modal Selezione Corso di Laurea in stile App / iOS */}
      <NativeSheetModal
        visible={courseModalVisible}
        onClose={() => {
          setCourseModalVisible(false);
          setSearchCourse("");
        }}
        title="Corso di Laurea"
        backgroundColor={UNIFORM_MODAL_BG}
        searchBarOptions={{
          placeholder: "Cerca corso o classe (es. Meccanica, L-9)...",
          textColor: "#ffffff",
          tintColor: theme.primary,
          headerIconColor: "#8e8e93",
          hintTextColor: "#71717a",
          autoCapitalize: "none",
          onChangeText: (e) => setSearchCourse(e.nativeEvent.text),
          onCancelButtonPress: () => setSearchCourse(""),
        }}
      >
        <View style={styles.modalContainer}>
          {degrees.length === 0 ? (
            <ActivityIndicator
              size="large"
              color={theme.primary}
              style={{ marginTop: 40 }}
            />
          ) : (
            <ScrollView
              style={styles.modalScroll}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              contentInsetAdjustmentBehavior="automatic"
            >
              {filteredDegrees.map((deg, i) => {
                const isSelected = degreeUrl === deg.url;
                const isMagistrale =
                  deg.name.toLowerCase().includes("magistrale") ||
                  deg.className?.toUpperCase().startsWith("LM");
                const cleanDegreeName = deg.name
                  .replace(
                    /\s*[-–]\s*(?:laurea\s+)?(?:triennale|magistrale|ciclo unico)\b/gi,
                    "",
                  )
                  .trim();
                return (
                  <TouchableOpacity
                    key={i}
                    style={[
                      styles.modalItem,
                      isSelected && [
                        styles.modalItemSelected,
                        {
                          backgroundColor: theme.bg,
                          borderColor: theme.primary,
                          shadowColor: theme.primary,
                        },
                      ],
                    ]}
                    activeOpacity={0.7}
                    onPress={() => selectDegree(deg)}
                  >
                    <View
                      style={[
                        styles.courseIconBox,
                        {
                          backgroundColor: theme.subtle,
                          borderColor: theme.border,
                          borderWidth: 1,
                        },
                        isSelected && {
                          backgroundColor: theme.primary,
                          borderColor: theme.primary,
                        },
                      ]}
                    >
                      <Ionicons
                        name="school"
                        size={18}
                        color={isSelected ? "#ffffff" : theme.primary}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text
                        style={[
                          styles.modalItemTitle,
                          isSelected && { color: "#fff" },
                        ]}
                      >
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
                              borderColor: isMagistrale ? "#c084fc" : "#60a5fa",
                              shadowColor: isMagistrale ? "#c084fc" : "#60a5fa",
                            },
                          ]}
                        >
                          <Text
                            style={[
                              styles.typeBadgeText,
                              { color: isMagistrale ? "#e9d5ff" : "#bfdbfe" },
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
                    {isSelected && (
                      <Ionicons
                        name="checkmark-circle"
                        size={22}
                        color={theme.primary}
                      />
                    )}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          )}
        </View>
      </NativeSheetModal>

      {/* Modal Cambio Canale / Anno */}
      <NativeSheetModal
        visible={channelModalVisible}
        onClose={() => setChannelModalVisible(false)}
        title="Specifiche"
        backgroundColor={UNIFORM_MODAL_BG}
        rightActions={[
          {
            label: "",
            sfSymbol: "checkmark",
            prominent: true,
            tintColor: theme.primary,
            disabled: !selectedTabForSpecifiche,
            accessibilityLabel: "Salva",
            onPress: async () => {
              if (selectedTabForSpecifiche) {
                await selectDefaultTab(selectedTabForSpecifiche);
              }
            },
          },
        ]}
      >
        <DefaultTabPicker
          tabs={availableTabs}
          initialTabUrl={defaultTabUrl}
          degreeName={degreeName}
          title="Specifiche"
          subtitle="Scegli l'anno e il canale che frequenti. Verranno aperti in automatico ad ogni avvio"
          confirmButtonText="Salva"
          hideFooterButton={true}
          onActiveTabChange={(tab) => {
            setSelectedTabForSpecifiche(tab);
          }}
          onConfirm={async (tab) => {
            await selectDefaultTab(tab);
          }}
        />
      </NativeSheetModal>

      {/* Modal Registro presenze Completo */}
      <NativeSheetModal
        visible={attendanceModalVisible}
        onClose={() => setAttendanceModalVisible(false)}
        title="Registro presenze"
        backgroundColor={UNIFORM_MODAL_BG}
        rightActions={
          attendanceRecords.length > 0
            ? [
                {
                  label: "Esporta",
                  sfSymbol: "square.and.arrow.up",
                  onPress: handleExportAttendancePdf,
                  tintColor: "#ffffff",
                },
              ]
            : undefined
        }
      >
        <View style={styles.modalContainer}>
          <ScrollView
            style={styles.modalScroll}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            >
            {groupedAttendance.length === 0 ? (
              <View style={styles.attendanceEmptyBox}>
                <Ionicons
                  name="calendar-outline"
                  size={36}
                  color="#71717a"
                  style={{ marginBottom: 10 }}
                />
                <Text style={styles.attendanceEmptyTitle}>
                  Nessuna presenza
                </Text>
                <Text style={styles.attendanceEmptySub}>
                  Tieni premuta una lezione nell&apos;orario per registrarne la
                  frequenza.
                </Text>
              </View>
            ) : (
              groupedAttendance.map((group) => (
                <View key={group.date} style={styles.dayGroupContainer}>
                  {/* Intestazione del Giorno */}
                  <View style={styles.dayGroupHeader}>
                    <Ionicons
                      name="calendar"
                      size={13}
                      color="#10b981"
                      style={{ marginRight: 6 }}
                    />
                    <Text style={styles.dayGroupTitle}>
                      {group.dayName.toUpperCase()} ·{" "}
                      {group.displayDate.toUpperCase()}
                    </Text>
                    <View style={styles.dayGroupBadge}>
                      <Text style={styles.dayGroupBadgeText}>
                        {group.records.length}{" "}
                        {group.records.length === 1 ? "lezione" : "lezioni"}
                      </Text>
                    </View>
                  </View>

                  {/* Lista Lezioni: Slide Nativo iOS per IPA, Card con cestino e long press per Expo Go */}
                  {group.records.map((item) =>
                    isNativeComponentAvailable ? (
                      <Swipeable
                        key={item.id}
                        renderRightActions={(progress, dragX) =>
                          renderRightActions(progress, dragX, item)
                        }
                        rightThreshold={110}
                        overshootRight={true}
                        onSwipeableOpen={(direction) => {
                          if (direction === "right") {
                            handleDeleteAttendanceDirect(item);
                          }
                        }}
                        containerStyle={{
                          marginBottom: 10,
                          borderRadius: 16,
                          overflow: "hidden",
                        }}
                      >
                        <View
                          style={[
                            styles.attendanceHistoryItem,
                            { marginBottom: 0 },
                          ]}
                        >
                          {renderAttendanceCardContent(item)}
                        </View>
                      </Swipeable>
                    ) : (
                      <TouchableOpacity
                        key={item.id}
                        style={styles.attendanceHistoryItem}
                        activeOpacity={0.8}
                        onLongPress={() => handleDeleteAttendance(item)}
                      >
                        {renderAttendanceCardContent(item)}
                      </TouchableOpacity>
                    ),
                  )}
                </View>
              ))
            )}

            {attendanceRecords.length > 0 && (
              <TouchableOpacity
                style={styles.clearAttendanceBtn}
                activeOpacity={0.7}
                onPress={handleClearAllAttendance}
              >
                <Ionicons
                  name="trash"
                  size={16}
                  color="#ef4444"
                  style={{ marginRight: 6 }}
                />
                <Text style={styles.clearAttendanceText}>
                  Azzera Tutto il Registro
                </Text>
              </TouchableOpacity>
            )}
          </ScrollView>
        </View>
      </NativeSheetModal>

      {/* Modal Gestione Sincronizzazione */}
      <NativeSheetModal
        visible={cloudModalVisible}
        onClose={() => setCloudModalVisible(false)}
        title="Sincronizzazione"
        backgroundColor={UNIFORM_MODAL_BG}
      >
        <View style={styles.modalContainer}>
          <ScrollView
            style={styles.modalScroll}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingBottom: 40 }}
          >
            {/* Box 1: Hero Card Sincronizzazione Unificata */}
            <View style={styles.cloudHeroCard}>
              <View style={styles.cloudHeroTop}>
                <View
                  style={[
                    styles.cloudHeroIconBadge,
                    {
                      backgroundColor: theme.primary,
                      shadowColor: theme.primary,
                      shadowOpacity: 0.4,
                      shadowRadius: 8,
                      shadowOffset: { width: 0, height: 2 },
                      elevation: 4,
                    },
                  ]}
                >
                  <Ionicons name="cloud" size={26} color="#ffffff" />
                </View>
                <View style={{ flex: 1, marginLeft: 14 }}>
                  <Text style={styles.cloudHeroTitle}>Cloud Sync StudICI</Text>
                  <Text style={styles.cloudHeroSub}>
                    {lastCloudSyncTime
                      ? `Ultimo salvataggio: ${formatSyncDate(lastCloudSyncTime)}`
                      : "Nessun salvataggio recente"}
                  </Text>
                  {cloudSyncId ? (
                    <TouchableOpacity
                      style={[
                        styles.cloudIdBadge,
                        {
                          backgroundColor: theme.subtle,
                          borderColor: theme.border,
                        },
                      ]}
                      activeOpacity={0.7}
                      onPress={handleChangeCustomSyncCode}
                    >
                      <Ionicons
                        name="finger-print"
                        size={13}
                        color={theme.primary}
                        style={{ marginRight: 4 }}
                      />
                      <Text
                        style={[styles.cloudIdText, { color: theme.primary }]}
                        selectable
                      >
                        {cloudSyncId}
                      </Text>
                      <Ionicons
                        name="pencil"
                        size={11}
                        color={theme.primary}
                        style={{ marginLeft: 6, opacity: 0.8 }}
                      />
                    </TouchableOpacity>
                  ) : null}
                </View>
              </View>

              {/* Separatore orizzontale centrale */}
              <View style={styles.separator} />

              {/* Riga Switch Sincronizzazione Automatica */}
              <TouchableOpacity
                style={[
                  styles.cloudAutoSyncRow,
                  !pairedDevices?.isPaired && { opacity: 0.6 },
                ]}
                activeOpacity={pairedDevices?.isPaired ? 1 : 0.7}
                onPress={() => {
                  if (!pairedDevices?.isPaired) {
                    Alert.alert(
                      "Associazione Richiesta",
                      "Associa prima un secondo dispositivo usando il codice per attivare la sincronizzazione automatica.",
                    );
                  }
                }}
              >
                <View style={{ flex: 1, paddingRight: 10 }}>
                  <Text style={styles.cloudAutoSyncTitle}>
                    Sincronizzazione automatica
                  </Text>
                  <Text style={styles.cloudAutoSyncSub}>
                    {pairedDevices?.isPaired
                      ? pairedDevices.otherDevices &&
                        pairedDevices.otherDevices.length > 1
                        ? `Sincronizzazione attiva con ${pairedDevices.otherDevices.length} dispositivi`
                        : `Sincronizzazione attiva con ${pairedDevices.otherDevice?.name || "il dispositivo associato"}`
                      : "Richiede almeno un dispositivo associato"}
                  </Text>
                </View>
                <Switch
                  value={pairedDevices?.isPaired ? iCloudAutoSync : false}
                  disabled={!pairedDevices?.isPaired}
                  onValueChange={handleToggleICloudAutoSync}
                  trackColor={{ false: "#39393d", true: "#34c759" }}
                  ios_backgroundColor="#39393d"
                />
              </TouchableOpacity>

              {/* Separatore orizzontale centrale */}
              <View style={styles.separator} />

              {/* Azioni Principali: Tasti Sincronizza & Copia codice */}
              <View style={styles.cloudHeroActionRow}>
                <NativeActionButton
                  label={isSyncingCloud ? "In corso..." : "Sincronizza"}
                  onPress={handleSyncCloud}
                  disabled={isSyncingCloud}
                  variant="filled"
                  glow={true}
                  glowColor={theme.accent}
                  accentColor={theme.primary}
                  icon={
                    <Ionicons
                      name={isSyncingCloud ? "refresh" : "cloud-upload-outline"}
                      size={16}
                      color="#ffffff"
                    />
                  }
                  style={{
                    flex: 1,
                    height: 42,
                    borderRadius: 21,
                    shadowColor: theme.accent,
                    shadowOpacity: 0.45,
                    shadowRadius: 8,
                  }}
                  pillStyle={{
                    height: 42,
                    borderRadius: 21,
                    paddingHorizontal: 14,
                  }}
                  textStyle={styles.cloudPrimaryBtnPillText}
                />

                <NativeActionButton
                  label="Copia codice"
                  onPress={handleCopyCloudCode}
                  variant="glass"
                  glow={false}
                  icon={
                    <Ionicons
                      name="copy-outline"
                      size={16}
                      color="#ffffff"
                    />
                  }
                  style={{
                    flex: 1,
                    height: 42,
                    borderRadius: 21,
                  }}
                  pillStyle={{
                    height: 42,
                    borderRadius: 21,
                    paddingHorizontal: 14,
                    backgroundColor: "#2c2c2e",
                    borderColor: "rgba(255, 255, 255, 0.12)",
                  }}
                  textStyle={{
                    color: "#ffffff",
                    fontSize: 13.5,
                    fontWeight: "600",
                    letterSpacing: -0.2,
                  }}
                />
              </View>
            </View>

            {/* Footnote sotto il box principale */}
            <Text style={styles.cloudBoxFootnote}>
              La sincronizzazione automatica mantiene allineati orari, corsi, registro presenze e impostazioni di viaggio su tutti i dispositivi associati.
            </Text>

            {/* Box 2: I MIEI DISPOSITIVI */}
            <Text style={styles.sectionHeader}>I MIEI DISPOSITIVI</Text>
            <View style={styles.groupedCard}>
              {/* Card: Questo Dispositivo */}
              <View style={styles.deviceRow}>
                <View
                  style={[
                    styles.deviceIconCircle,
                    {
                      backgroundColor: theme.subtle,
                      borderColor: theme.border,
                      borderWidth: 1,
                    },
                  ]}
                >
                  <Ionicons
                    name="phone-portrait"
                    size={18}
                    color={theme.primary}
                  />
                </View>
                <View style={{ flex: 1, paddingRight: 4 }}>
                  <View style={{ flexDirection: "row", alignItems: "center" }}>
                    <Text style={styles.deviceNameText} numberOfLines={1}>
                      {pairedDevices?.myDevice?.name || "Questo iPhone"}
                    </Text>
                    <View
                      style={[
                        styles.myDeviceBadge,
                        {
                          backgroundColor: theme.subtle,
                          borderColor: theme.border,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.myDeviceBadgeText,
                          { color: theme.primary },
                        ]}
                      >
                        Questo
                      </Text>
                    </View>
                  </View>
                  <Text style={styles.deviceMetaText}>
                    {pairedDevices?.myDevice?.platform || "iOS"} • Attivo adesso
                  </Text>
                </View>
              </View>

              {/* Lista Dispositivi Associati oppure Empty Notice */}
              {pairedDevices?.isPaired &&
              pairedDevices.otherDevices &&
              pairedDevices.otherDevices.length > 0 ? (
                pairedDevices.otherDevices.map((dev) => (
                  <Fragment key={dev.id}>
                    <View style={styles.separator} />
                    <View style={styles.deviceRow}>
                      <View
                        style={[
                          styles.deviceIconCircle,
                          {
                            backgroundColor: "rgba(52, 199, 89, 0.15)",
                            borderColor: "rgba(52, 199, 89, 0.3)",
                            borderWidth: 1,
                          },
                        ]}
                      >
                        <Ionicons
                          name="phone-portrait"
                          size={18}
                          color="#34c759"
                        />
                      </View>
                      <View style={{ flex: 1, paddingRight: 4 }}>
                        <View
                          style={{ flexDirection: "row", alignItems: "center" }}
                        >
                          <Text style={styles.deviceNameText} numberOfLines={1}>
                            {dev.name}
                          </Text>
                          <View style={styles.pairedDeviceBadge}>
                            <Text style={styles.pairedDeviceBadgeText}>
                              Associato
                            </Text>
                          </View>
                        </View>
                        <Text style={styles.deviceMetaText}>
                          {dev.platform} • Sinc: {formatSyncDate(dev.lastActive)}
                        </Text>
                      </View>
                      <TouchableOpacity
                        style={styles.dissociateBtn}
                        activeOpacity={0.7}
                        onPress={() => handleDissociateDevice(dev.id, dev.name)}
                      >
                        <Ionicons
                          name="link-outline"
                          size={13}
                          color="#ef4444"
                          style={{ marginRight: 3 }}
                        />
                        <Text style={styles.dissociateBtnText}>Dissocia</Text>
                      </TouchableOpacity>
                    </View>
                  </Fragment>
                ))
              ) : (
                <>
                  <View style={styles.separator} />
                  <View style={styles.unpairedNoticeBox}>
                    <View style={styles.unpairedNoticeHeader}>
                      <Ionicons
                        name="alert-circle-outline"
                        size={16}
                        color="#f59e0b"
                        style={{ marginRight: 5 }}
                      />
                      <Text style={styles.unpairedNoticeTitle}>
                        Nessun altro dispositivo associato
                      </Text>
                    </View>
                    <Text style={styles.unpairedNoticeDesc}>
                      Copia il codice e inseriscilo sul secondo dispositivo per
                      avviare la sincronizzazione.
                    </Text>
                  </View>
                </>
              )}
            </View>

            {/* Box 3: COLLEGA DISPOSITIVO */}
            <Text style={[styles.sectionHeader, { marginTop: 24 }]}>
              COLLEGA DISPOSITIVO
            </Text>
            <View style={styles.groupedCard}>
              {pairedDevices?.isSlave ? (
                <View style={styles.cloudSlaveNoticeBox}>
                  <View
                    style={[
                      styles.cloudRestoreIconBadge,
                      {
                        backgroundColor: theme.subtle,
                        borderColor: theme.border,
                      },
                    ]}
                  >
                    <Ionicons
                      name="link-outline"
                      size={17}
                      color={theme.primary}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cloudSlaveNoticeTitle}>
                      Dispositivo associato a un gruppo
                    </Text>
                    <Text style={styles.cloudSlaveNoticeSub}>
                      Questo dispositivo è attualmente collegato come slave a un master. Non puoi collegarti ad altri dispositivi finché non ti dissoci dal master attuale nell&apos;elenco sopra.
                    </Text>
                  </View>
                </View>
              ) : (
                <View style={styles.cloudRestoreBox}>
                  <View style={styles.cloudRestoreHeaderRow}>
                    <View
                      style={[
                        styles.cloudRestoreIconBadge,
                        {
                          backgroundColor: theme.subtle,
                          borderColor: theme.border,
                        },
                      ]}
                    >
                      <Ionicons
                        name="link-outline"
                        size={17}
                        color={theme.primary}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.cloudRestoreTitle}>
                        Collega un altro dispositivo
                      </Text>
                      <Text style={styles.cloudRestoreSub}>
                        Inserisci il codice di un altro dispositivo per sincronizzare corso, canale, presenze e impostazioni di viaggio.
                      </Text>
                    </View>
                  </View>

                  <View style={styles.cloudRestoreInputRow}>
                    <View style={styles.cloudRestoreInputWrap}>
                      <Ionicons
                        name="keypad-outline"
                        size={16}
                        color="#71717a"
                        style={{ marginRight: 8 }}
                      />
                      <TextInput
                        style={styles.cloudRestoreInput}
                        placeholder="es. ST1234A o NOME"
                        placeholderTextColor="#71717a"
                        value={restoreCodeInput}
                        onChangeText={setRestoreCodeInput}
                        autoCapitalize="characters"
                        autoCorrect={false}
                        returnKeyType="done"
                        onSubmitEditing={handleRestoreFromCloud}
                      />
                      {restoreCodeInput.length > 0 && (
                        <TouchableOpacity
                          onPress={() => setRestoreCodeInput("")}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                          style={{ padding: 4 }}
                        >
                          <Ionicons
                            name="close-circle"
                            size={16}
                            color="#71717a"
                          />
                        </TouchableOpacity>
                      )}
                    </View>
                    <NativeActionButton
                      label="Collega"
                      onPress={handleRestoreFromCloud}
                      disabled={!restoreCodeInput.trim() || isSyncingCloud}
                      variant={
                        !restoreCodeInput.trim() || isSyncingCloud
                          ? "glass"
                          : "filled"
                      }
                      glow={Boolean(restoreCodeInput.trim() && !isSyncingCloud)}
                      glowColor={theme.accent}
                      accentColor={theme.primary}
                      style={{
                        height: 44,
                        borderRadius: 22,
                        minWidth: 104,
                        flexShrink: 0,
                        ...(restoreCodeInput.trim() && !isSyncingCloud
                          ? {
                              shadowColor: theme.accent,
                              shadowOpacity: 0.45,
                              shadowRadius: 8,
                            }
                          : {}),
                      }}
                      pillStyle={{
                        height: 44,
                        borderRadius: 22,
                        paddingHorizontal: 16,
                        ...(!restoreCodeInput.trim() || isSyncingCloud
                          ? {
                              backgroundColor: "#2c2c2e",
                              borderColor: "rgba(255, 255, 255, 0.12)",
                            }
                          : {}),
                      }}
                      textStyle={{
                        color: "#ffffff",
                        fontSize: 14,
                        fontWeight: "600",
                        letterSpacing: -0.2,
                      }}
                    />
                  </View>
                </View>
              )}
            </View>
          </ScrollView>
        </View>
      </NativeSheetModal>

      {/* Modal Schermata Download Unificato */}
      <Modal
        visible={Boolean(downloadingCourse)}
        animationType="fade"
        presentationStyle="fullScreen"
      >
        {downloadingCourse && (
          <CourseDownloadView
            courseName={downloadingCourse.name}
            progressText={downloadProgressText}
            title="Configurazione in corso"
          />
        )}
      </Modal>

      {/* Modal Impostazioni Pendolare */}
      {commuterConfig && (
        <CommuterConfigModal
          visible={commuterModalVisible}
          config={commuterConfig}
          onClose={() => setCommuterModalVisible(false)}
          onSave={async (newCfg) => {
            const saved = await saveCommuterConfig(newCfg);
            setCommuterConfig(saved);
          }}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: UNIFORM_SCREEN_BG,
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 16,
  },
  largeTitle: {
    fontSize: 34,
    fontWeight: "700",
    color: "#ffffff",
    letterSpacing: 0.35,
  },
  container: {
    flex: 1,
    paddingHorizontal: 16,
  },
  /* Card stile profilo Apple ID */
  profileHeaderCard: {
    backgroundColor: "#1c1c1e",
    borderRadius: 16,
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
    borderWidth: 0.5,
    borderColor: "rgba(255, 255, 255, 0.08)",
  },
  profileAvatarBox: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: SAPIENZA_RED,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 14,
    shadowColor: SAPIENZA_RED,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
  },
  profileHeaderInfo: {
    flex: 1,
  },
  profileDegreeTitle: {
    color: "#ffffff",
    fontSize: 17,
    fontWeight: "600",
    letterSpacing: -0.2,
  },
  profileFacultySubtitle: {
    color: "#8e8e93",
    fontSize: 13,
    marginTop: 3,
  },
  profileBadgesRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 8,
  },
  profileBadge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  profileBadgeDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    marginRight: 4,
  },
  profileBadgeText: {
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.1,
  },
  /* Sezioni e Gruppi Inset Grouped iOS */
  sectionHeader: {
    fontSize: 13,
    fontWeight: "500",
    color: "#8e8e93",
    textTransform: "uppercase",
    letterSpacing: -0.08,
    marginLeft: 16,
    marginBottom: 6,
    marginTop: 22,
  },
  sectionFooter: {
    fontSize: 13,
    color: "#636366",
    marginLeft: 16,
    marginRight: 16,
    marginTop: 6,
    lineHeight: 18,
  },
  groupedCard: {
    backgroundColor: "#1c1c1e",
    borderRadius: 16,
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255, 255, 255, 0.08)",
  },
  tableRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 11,
    paddingHorizontal: 16,
    minHeight: 48,
  },
  iconBox: {
    width: 32,
    height: 32,
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 14,
  },
  rowTitle: {
    fontSize: 16,
    color: "#ffffff",
    flex: 1,
    letterSpacing: -0.2,
  },
  rowDetail: {
    fontSize: 15,
    color: "#8e8e93",
    marginRight: 6,
    maxWidth: "48%",
    textAlign: "right",
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    marginHorizontal: 16,
  },
  /* Footer */
  footer: {
    alignItems: "center",
    marginTop: 26,
    marginBottom: 8,
  },
  githubCircleBtn: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.16)",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 14,
  },
  footerText: {
    color: "#636366",
    fontSize: 13,
    fontWeight: "500",
  },
  footerSubText: {
    color: "#48484a",
    fontSize: 12,
    marginTop: 3,
  },
  /* Modal styling */
  modalContainer: {
    flex: 1,
    backgroundColor: UNIFORM_MODAL_BG,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#27272a",
  },
  modalTitle: {
    color: "#ffffff",
    fontSize: 20,
    fontWeight: "700",
  },
  modalSubtitle: {
    color: "#8e8e93",
    fontSize: 12.5,
    marginTop: 2,
  },
  modalCloseCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(255, 255, 255, 0.12)",
    justifyContent: "center",
    alignItems: "center",
  },
  searchBarContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1c1c1e",
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 8,
    paddingHorizontal: 14,
    height: 42,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#2c2c2e",
  },
  searchInput: {
    flex: 1,
    color: "#ffffff",
    fontSize: 14.5,
  },
  modalScroll: {
    flex: 1,
    padding: 16,
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
  modalItemSelected: {
    borderColor: SAPIENZA_RED,
    backgroundColor: "rgba(130, 36, 51, 0.35)",
    borderWidth: 1.5,
    shadowColor: SAPIENZA_RED,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 10,
    elevation: 6,
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
    color: "#fde68a",
    fontSize: 11,
    fontWeight: "700",
  },
  /* ── Registro presenze Styles ── */
  statsCardsRow: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 12,
  },
  statCard: {
    flex: 1,
    backgroundColor: "#1c1c1e",
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
    alignItems: "center",
  },
  statIconSquircle: {
    width: 34,
    height: 34,
    borderRadius: 10,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 8,
  },
  statValue: {
    color: "#ffffff",
    fontSize: 18,
    fontWeight: "800",
    letterSpacing: -0.2,
  },
  statLabel: {
    color: "#71717a",
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 0.6,
    marginTop: 2,
  },
  attendanceEmptyBox: {
    padding: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  attendanceEmptyTitle: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "700",
    textAlign: "center",
    marginBottom: 4,
  },
  attendanceEmptySub: {
    color: "#8e8e93",
    fontSize: 12,
    textAlign: "center",
    lineHeight: 18,
  },
  subjectStatRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  subjectStatIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: "#27272a",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  subjectStatTitle: {
    color: "#ffffff",
    fontSize: 13.5,
    fontWeight: "700",
  },
  subjectStatSubtitle: {
    color: "#71717a",
    fontSize: 11,
    marginTop: 2,
  },
  subjectStatBadge: {
    backgroundColor: "rgba(16, 185, 129, 0.15)",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(16, 185, 129, 0.3)",
  },
  subjectStatBadgeText: {
    color: "#10b981",
    fontSize: 11,
    fontWeight: "700",
  },
  /* Full Modal Attendance History */
  attendanceHistoryItem: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1c1c1e",
    borderRadius: 16,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
  },
  attendanceDateSquircle: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: "rgba(16, 185, 129, 0.15)",
    borderWidth: 1,
    borderColor: "rgba(16, 185, 129, 0.3)",
    justifyContent: "center",
    alignItems: "center",
  },
  attendanceDayName: {
    color: "#10b981",
    fontSize: 9.5,
    fontWeight: "800",
    letterSpacing: 0.3,
  },
  attendanceDateNum: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "800",
    marginTop: 1,
  },
  attendanceHistorySubject: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "700",
  },
  manualAttendanceBadge: {
    backgroundColor: "rgba(249, 115, 22, 0.15)",
    borderWidth: 1,
    borderColor: "rgba(249, 115, 22, 0.35)",
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
    marginLeft: 6,
  },
  manualAttendanceBadgeText: {
    fontSize: 9.5,
    fontWeight: "700",
    color: "#f97316",
  },
  attendanceTimeRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 3,
  },
  attendanceHistoryTime: {
    color: "#94a3b8",
    fontSize: 12,
    fontWeight: "500",
  },
  attendanceRoomRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 2,
  },
  attendanceHistoryRoom: {
    color: "#ef4444",
    fontSize: 11.5,
    fontWeight: "600",
  },
  attendanceDeleteButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(239, 68, 68, 0.12)",
    justifyContent: "center",
    alignItems: "center",
  },
  clearAttendanceBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    height: 46,
    borderRadius: 14,
    backgroundColor: "rgba(239, 68, 68, 0.1)",
    borderWidth: 1,
    borderColor: "rgba(239, 68, 68, 0.25)",
    marginTop: 16,
    marginBottom: 32,
  },
  clearAttendanceText: {
    color: "#ef4444",
    fontSize: 13.5,
    fontWeight: "700",
  },
  /* Swipeable Slide to Delete & Day Groups */
  swipeDeleteContainer: {
    backgroundColor: "#ff3b30",
    flex: 1,
    justifyContent: "center",
    alignItems: "flex-end",
    paddingRight: 22,
    borderRadius: 16,
    height: "100%",
  },
  swipeDeleteContent: {
    alignItems: "center",
    justifyContent: "center",
  },
  swipeDeleteText: {
    color: "#ffffff",
    fontSize: 11,
    fontWeight: "700",
    marginTop: 2,
  },
  dayGroupContainer: {
    marginBottom: 16,
  },
  dayGroupHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  dayGroupTitle: {
    color: "#a1a1aa",
    fontSize: 11.5,
    fontWeight: "700",
    letterSpacing: 0.6,
    flex: 1,
  },
  dayGroupBadge: {
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  dayGroupBadgeText: {
    color: "#a1a1aa",
    fontSize: 10,
    fontWeight: "600",
  },
  rowSubTitle: {
    color: "#71717a",
    fontSize: 12,
    marginTop: 2,
  },
  inlineActionBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 9999,
    borderWidth: 1,
    marginLeft: 8,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.35,
    shadowRadius: 6,
    elevation: 3,
  },
  inlineActionBtnText: {
    fontSize: 12.5,
    fontWeight: "600",
    color: "#ffffff",
    letterSpacing: -0.2,
  },
  inlineActionBtnCallstack: {
    height: 32,
    minWidth: 96,
    borderRadius: 16,
    marginLeft: 8,
  },
  modalExportHeaderBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "rgba(255, 255, 255, 0.12)",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 8,
  },
  cloudStatusCard: {
    backgroundColor: "#1c1c1e",
    borderRadius: 16,
    padding: 20,
    alignItems: "center",
    marginBottom: 20,
    borderWidth: 0.5,
    borderColor: "rgba(255, 255, 255, 0.08)",
  },
  cloudIconCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: "rgba(2, 132, 199, 0.15)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  cloudStatusTitle: {
    color: "#ffffff",
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 4,
  },
  cloudStatusSub: {
    color: "#a1a1aa",
    fontSize: 13,
    textAlign: "center",
    marginBottom: 10,
  },
  cloudIdBadge: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 9999,
    borderWidth: 1,
    marginTop: 4,
  },
  cloudIdText: {
    color: "#38bdf8",
    fontSize: 11.5,
    fontWeight: "600",
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
  devicesSection: {
    backgroundColor: "#1c1c1e",
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 0.5,
    borderColor: "rgba(255, 255, 255, 0.08)",
  },
  devicesHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  devicesSectionTitle: {
    fontSize: 12,
    fontWeight: "700",
    color: "#a1a1aa",
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  pairingStatusPill: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
  },
  pairingStatusPillActive: {
    backgroundColor: "rgba(52, 199, 89, 0.15)",
  },
  pairingStatusPillWaiting: {
    backgroundColor: "rgba(245, 158, 11, 0.15)",
  },
  pairingStatusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 5,
  },
  pairingStatusDotActive: {
    backgroundColor: "#34c759",
  },
  pairingStatusDotWaiting: {
    backgroundColor: "#f59e0b",
  },
  pairingStatusText: {
    fontSize: 11,
    fontWeight: "600",
  },
  pairingStatusTextActive: {
    color: "#34c759",
  },
  pairingStatusTextWaiting: {
    color: "#f59e0b",
  },
  deviceCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#2c2c2e",
    borderRadius: 12,
    padding: 12,
  },
  deviceIconCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  deviceNameText: {
    color: "#ffffff",
    fontSize: 14.5,
    fontWeight: "600",
    flexShrink: 1,
  },
  deviceMetaText: {
    color: "#8e8e93",
    fontSize: 11.5,
    marginTop: 2,
  },
  myDeviceBadge: {
    backgroundColor: "rgba(56, 189, 248, 0.15)",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    marginLeft: 6,
  },
  myDeviceBadgeText: {
    color: "#38bdf8",
    fontSize: 10,
    fontWeight: "700",
  },
  pairedDeviceBadge: {
    backgroundColor: "rgba(52, 199, 89, 0.15)",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    marginLeft: 6,
  },
  pairedDeviceBadgeText: {
    color: "#34c759",
    fontSize: 10,
    fontWeight: "700",
  },
  dissociateBtn: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(239, 68, 68, 0.12)",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    marginLeft: 8,
    borderWidth: 0.5,
    borderColor: "rgba(239, 68, 68, 0.3)",
  },
  dissociateBtnText: {
    color: "#ef4444",
    fontSize: 12,
    fontWeight: "600",
  },
  unpairedNoticeBox: {
    backgroundColor: "rgba(245, 158, 11, 0.08)",
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: "rgba(245, 158, 11, 0.25)",
    borderStyle: "dashed",
    marginTop: 8,
  },
  unpairedNoticeHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 4,
  },
  unpairedNoticeTitle: {
    color: "#f59e0b",
    fontSize: 13,
    fontWeight: "600",
  },
  unpairedNoticeDesc: {
    color: "#d4d4d8",
    fontSize: 12,
    lineHeight: 16,
  },
  cloudHeroCard: {
    backgroundColor: "#1c1c1e",
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255, 255, 255, 0.08)",
    overflow: "hidden",
    marginBottom: 8,
  },
  cloudHeroTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    padding: 16,
  },
  cloudHeroIconBadge: {
    width: 48,
    height: 48,
    borderRadius: 14,
    justifyContent: "center",
    alignItems: "center",
  },
  cloudHeroTitle: {
    color: "#ffffff",
    fontSize: 18,
    fontWeight: "700",
    letterSpacing: -0.3,
    marginBottom: 3,
  },
  cloudHeroSub: {
    color: "#8e8e93",
    fontSize: 12.5,
    lineHeight: 16,
    marginBottom: 8,
  },
  cloudAutoSyncRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  cloudAutoSyncTitle: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "600",
    letterSpacing: -0.2,
  },
  cloudAutoSyncSub: {
    color: "#8e8e93",
    fontSize: 12,
    marginTop: 2,
    lineHeight: 16,
  },
  cloudHeroActionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 14,
  },
  cloudPrimaryBtnPill: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    height: 42,
    borderRadius: 9999,
    paddingHorizontal: 14,
  },
  cloudPrimaryBtnPillText: {
    color: "#ffffff",
    fontSize: 13.5,
    fontWeight: "600",
    letterSpacing: -0.2,
  },
  cloudSecondaryBtnPill: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    height: 42,
    borderRadius: 9999,
    paddingHorizontal: 14,
    borderWidth: 1,
  },
  cloudSecondaryBtnPillText: {
    fontSize: 13.5,
    fontWeight: "600",
    letterSpacing: -0.2,
  },
  cloudBoxFootnote: {
    fontSize: 12,
    color: "#8e8e93",
    lineHeight: 16,
    paddingHorizontal: 16,
    marginTop: 6,
    marginBottom: 20,
  },
  deviceRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  cloudRestoreBox: {
    padding: 16,
  },
  cloudRestoreHeaderRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 14,
  },
  cloudRestoreIconBadge: {
    width: 34,
    height: 34,
    borderRadius: 10,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
    borderWidth: 1,
  },
  cloudSlaveNoticeBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    padding: 16,
  },
  cloudSlaveNoticeTitle: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "600",
    marginBottom: 4,
  },
  cloudSlaveNoticeSub: {
    color: "#8e8e93",
    fontSize: 12.5,
    lineHeight: 17,
  },
  cloudRestoreTitle: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "600",
    marginBottom: 3,
  },
  cloudRestoreSub: {
    color: "#8e8e93",
    fontSize: 12,
    lineHeight: 16,
  },
  cloudRestoreInputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  cloudRestoreInputWrap: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#141416",
    borderRadius: 9999,
    paddingHorizontal: 14,
    height: 44,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.1)",
  },
  cloudRestoreInput: {
    flex: 1,
    color: "#ffffff",
    fontSize: 13,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    padding: 0,
  },
  cloudRestoreBtn: {
    height: 44,
    paddingHorizontal: 20,
    borderRadius: 9999,
    justifyContent: "center",
    alignItems: "center",
  },
  cloudRestoreBtnDisabled: {
    opacity: 0.4,
  },
  cloudRestoreBtnText: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "600",
    letterSpacing: -0.2,
  },
  themeRowPreview: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
  },
  themeRowDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 6,
  },
  themeDropdownContainer: {
    paddingHorizontal: 14,
    paddingBottom: 14,
  },
  themeGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 12,
  },
  themeCardItem: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255, 255, 255, 0.04)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
    borderRadius: 10,
    paddingVertical: 9,
    paddingHorizontal: 10,
    minWidth: "48%",
    flexGrow: 1,
    gap: 8,
  },
  themeColorDot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    justifyContent: "center",
    alignItems: "center",
  },
  themeCardName: {
    fontSize: 13,
    color: "#cbd5e1",
    fontWeight: "500",
    flex: 1,
  },
  updatePill: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
  },
  updatePillText: {
    color: "#ffffff",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.4,
  },
});
