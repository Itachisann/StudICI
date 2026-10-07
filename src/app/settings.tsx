import { MenuView } from "@expo/ui/community/menu";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants, { ExecutionEnvironment } from "expo-constants";
import { router, useFocusEffect } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  LayoutAnimation,
  Modal,
  Platform,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import Swipeable from "react-native-gesture-handler/Swipeable";
import { SafeAreaView } from "react-native-safe-area-context";
import { CourseDownloadView } from "../components/CourseDownloadView";
import { DefaultTabPicker } from "../components/DefaultTabPicker";
import { parseTabHierarchy } from "../components/YearChannelSelector";
import {
  AttendanceRecord,
  AttendanceStats,
  clearAllAttendance,
  deleteAttendanceRecord,
  getAttendanceRecords,
  getAttendanceStats,
} from "../utils/attendance";
import {
  Degree,
  fetchAllCourseData,
  fetchDegrees,
  fetchTabs,
  fetchScheduleData,
  Tab,
} from "../utils/scraper";
import {
  syncScheduleToAppleCalendar,
  getLastCalendarSync,
} from "../utils/appleCalendar";
import {
  exportScheduleToPdf,
  exportAttendanceToPdf,
} from "../utils/pdfExport";
import * as Clipboard from "expo-clipboard";
import {
  getCloudSyncId,
  getLastCloudSync,
  copyCloudSyncCodeToClipboard,
  restoreFromCloudBackup,
  getICloudAutoSyncEnabled,
  setICloudAutoSyncEnabled,
  syncWithICloudStorage,
  linkDeviceWithCode,
  isValidSyncCode,
  isCloudConfigured,
  setCustomCloudSyncId,
  getPairedDevicesInfo,
  dissociateDevice,
  PairedDevicesStatus,
  subscribeToLiveSync,
} from "../utils/cloudSync";
import { CommuterConfigModal } from "../components/CommuterConfigModal";
import { CommuterConfig } from "../types/commuter";
import {
  getCommuterConfig,
  saveCommuterConfig,
} from "../utils/commuterStorage";
import { useTheme } from "@/context/ThemeContext";

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
  const { theme, themeId, setThemeId, availableThemes } = useTheme();
  const [degreeName, setDegreeName] = useState<string>("");
  const [degreeClassName, setDegreeClassName] = useState<string>("");
  const [degreeUrl, setDegreeUrl] = useState<string | null>(null);
  const [defaultTabUrl, setDefaultTabUrl] = useState<string | null>(null);
  const [availableTabs, setAvailableTabs] = useState<Tab[]>([]);
  const [degrees, setDegrees] = useState<Degree[]>([]);
  const [loading, setLoading] = useState(true);
  const [courseModalVisible, setCourseModalVisible] = useState(false);
  const [channelModalVisible, setChannelModalVisible] = useState(false);
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

  // Stati Sincronizzazione Cloud, Calendario Apple ed Esportazione PDF
  const [cloudModalVisible, setCloudModalVisible] = useState(false);
  const [cloudSyncId, setCloudSyncId] = useState<string>("");
  const [lastCloudSyncTime, setLastCloudSyncTime] = useState<number | null>(null);
  const [lastCalendarSyncTime, setLastCalendarSyncTime] = useState<number | null>(null);
  const [isSyncingCloud, setIsSyncingCloud] = useState(false);
  const [isSyncingCalendar, setIsSyncingCalendar] = useState(false);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [restoreCodeInput, setRestoreCodeInput] = useState("");
  const [iCloudAutoSync, setICloudAutoSync] = useState(false);
  const [pairedDevices, setPairedDevices] = useState<PairedDevicesStatus | null>(null);
  const [commuterConfig, setCommuterConfig] = useState<CommuterConfig | null>(null);
  const [commuterModalVisible, setCommuterModalVisible] = useState(false);
  const [themeSectionExpanded, setThemeSectionExpanded] = useState(false);

  const themeMenuActions = useMemo(
    () =>
      availableThemes.map((t) => ({
        id: t.id,
        title: t.name,
        state: (t.id === themeId ? "on" : "off") as "on" | "off",
      })),
    [availableThemes, themeId],
  );

  const loadProfileData = useCallback(async () => {
    setLoading(true);
    try {
      const storedUrl = await AsyncStorage.getItem("selectedDegreeUrl");
      const storedName = await AsyncStorage.getItem("selectedDegreeName");
      const storedClassName = await AsyncStorage.getItem(
        "selectedDegreeClassName",
      );
      const storedDefaultTab = await AsyncStorage.getItem("defaultTabUrl");

      setDegreeUrl(storedUrl);
      setDegreeName(storedName || "");
      setDegreeClassName(storedClassName || "");
      setDefaultTabUrl(storedDefaultTab);

      if (storedUrl) {
        const tabs = await fetchTabs(storedUrl);
        setAvailableTabs(tabs);
      }

      const degList = await fetchDegrees();
      setDegrees(degList);

      const attList = await getAttendanceRecords();
      setAttendanceRecords(attList);
      setAttendanceStats(getAttendanceStats(attList));

      const [cloudId, lastCloud, lastCal, icloudEnabled, pairs, commConfig] = await Promise.all([
        getCloudSyncId(),
        getLastCloudSync(),
        getLastCalendarSync(),
        getICloudAutoSyncEnabled(),
        getPairedDevicesInfo(),
        getCommuterConfig(),
      ]);
      setCloudSyncId(cloudId);
      setLastCloudSyncTime(lastCloud);
      setLastCalendarSyncTime(lastCal);
      setICloudAutoSync(icloudEnabled);
      setPairedDevices(pairs);
      setCommuterConfig(commConfig);
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  }, []);

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
    setDownloadingCourse(degree);
    setDownloadProgressText("Preparazione e analisi canali...");

    try {
      const { tabs } = await fetchAllCourseData(degree.url, true, (stepMsg) => {
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
      } else {
        await AsyncStorage.removeItem("defaultTabUrl");
      }

      setDegreeUrl(degree.url);
      setDegreeName(degree.name);
      setDegreeClassName(degree.className || "");
      setDefaultTabUrl(firstTab);
      setAvailableTabs(tabs);
      setDownloadingCourse(null);

      if (tabs && tabs.length > 1) {
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
      "Ripristina Applicazione",
      "Sei sicuro di voler ripristinare StudICI? Verranno rimossi il corso e le impostazioni salvate.",
      [
        { text: "Annulla", style: "cancel" },
        {
          text: "Ripristina",
          style: "destructive",
          onPress: async () => {
            await AsyncStorage.clear();
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
      const updated = await deleteAttendanceRecord(record.id);
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
      "Azzera Registro Presenze",
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
        <Text style={styles.attendanceHistorySubject} numberOfLines={1}>
          {item.subject?.toUpperCase()}
        </Text>
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
        Alert.alert("Sincronizzazione Cloud", res.message);
      } else {
        if (res.notPaired) {
          Alert.alert(
            "Nessun Dispositivo Associato",
            "La sincronizzazione tra dispositivi richiede che due dispositivi siano associati. Invia il codice con AirDrop o inseriscilo sul secondo iPhone per associarlo."
          );
        } else {
          Alert.alert("Sincronizzazione non riuscita", res.message);
        }
      }
    } catch {
      Alert.alert("Errore", "Impossibile completare la sincronizzazione cloud.");
    } finally {
      setIsSyncingCloud(false);
    }
  };

  const handleSyncCalendar = async () => {
    if (!degreeUrl) {
      Alert.alert("Nessun corso", "Configura prima un corso di laurea per sincronizzare le lezioni.");
      return;
    }
    const tabUrl = defaultTabUrl || availableTabs[0]?.url;
    if (!tabUrl) {
      Alert.alert("Nessun canale", "Seleziona prima un canale o anno per sincronizzare l'orario.");
      return;
    }

    Alert.alert(
      "Calendario Apple",
      `Vuoi sincronizzare le lezioni di "${courseMetadata.cleanCourseTitle}" nel Calendario di iOS? Verrà creato il calendario "StudICI - Lezioni Sapienza".`,
      [
        { text: "Annulla", style: "cancel" },
        {
          text: "Sincronizza Ora",
          onPress: async () => {
            setIsSyncingCalendar(true);
            try {
              const schedule = await fetchScheduleData(tabUrl);
              const res = await syncScheduleToAppleCalendar(
                schedule,
                courseMetadata.cleanCourseTitle,
                defaultTabLabel
              );
              if (res.success) {
                setLastCalendarSyncTime(Date.now());
                Alert.alert("Calendario Sincronizzato", res.message);
              } else {
                Alert.alert("Errore Calendario", res.message);
              }
            } catch (err: any) {
              Alert.alert("Errore", err?.message || "Errore durante la sincronizzazione con il calendario.");
            } finally {
              setIsSyncingCalendar(false);
            }
          },
        },
      ]
    );
  };

  const handleExportSchedulePdf = async () => {
    if (!degreeUrl) {
      Alert.alert("Nessun corso", "Configura prima un corso per esportare l'orario.");
      return;
    }
    const tabUrl = defaultTabUrl || availableTabs[0]?.url;
    if (!tabUrl) {
      Alert.alert("Nessun canale", "Seleziona prima un canale.");
      return;
    }

    setIsExportingPdf(true);
    try {
      const schedule = await fetchScheduleData(tabUrl);
      await exportScheduleToPdf(schedule, courseMetadata.cleanCourseTitle, defaultTabLabel);
    } catch (err: any) {
      Alert.alert("Errore Esportazione", err?.message || "Impossibile generare il PDF dell'orario.");
    } finally {
      setIsExportingPdf(false);
    }
  };

  const handleExportAttendancePdf = async () => {
    setIsExportingPdf(true);
    try {
      await exportAttendanceToPdf(attendanceRecords, attendanceStats, courseMetadata.cleanCourseTitle);
    } catch (err: any) {
      Alert.alert("Errore Esportazione", err?.message || "Impossibile generare il PDF del registro presenze.");
    } finally {
      setIsExportingPdf(false);
    }
  };

  const handleAirDrop = async () => {
    try {
      setIsSyncingCloud(true);
      await syncWithICloudStorage();
      const code = await getCloudSyncId();
      const url = `studici://sync?code=${encodeURIComponent(code)}`;
      await Share.share({
        title: "Sincronizza StudICI",
        message: `Codice di sincronizzazione StudICI:\n${code}\n\nSe hai l'app installata o usi LiveContainer, apri questo link:\n${url}`,
        url: url,
      });
      const updatedPairs = await getPairedDevicesInfo();
      setPairedDevices(updatedPairs);
    } catch {
      Alert.alert("Errore", "Impossibile aprire il menu di condivisione.");
    } finally {
      setIsSyncingCloud(false);
    }
  };

  const handleDissociateDevice = (targetDeviceId?: string, deviceName?: string) => {
    const isSelf = !targetDeviceId || targetDeviceId === pairedDevices?.myDevice?.id;
    const targetName =
      deviceName ||
      (isSelf
        ? pairedDevices?.myDevice?.name || "questo iPhone"
        : pairedDevices?.otherDevice?.name || "il dispositivo associato");

    Alert.alert(
      isSelf ? "Scollega questo Dispositivo" : "Dissocia Dispositivo",
      isSelf
        ? `Vuoi scollegare "${targetName}" dal gruppo di sincronizzazione? La sincronizzazione verrà disattivata e verrà generato un nuovo codice privato indipendente.`
        : `Vuoi dissociare "${targetName}"? La sincronizzazione con questo dispositivo verrà interrotta finché non verrà associato nuovamente.`,
      [
        { text: "Annulla", style: "cancel" },
        {
          text: isSelf ? "Scollega" : "Dissocia",
          style: "destructive",
          onPress: async () => {
            setIsSyncingCloud(true);
            try {
              const res = await dissociateDevice(targetDeviceId);
              const updatedPairs = await getPairedDevicesInfo();
              setPairedDevices(updatedPairs);
              if (!updatedPairs.isPaired) {
                await setICloudAutoSyncEnabled(false);
                setICloudAutoSync(false);
              }
              await loadProfileData();
              Alert.alert(
                res.success
                  ? isSelf
                    ? "Dispositivo Scollegato"
                    : "Dispositivo Dissociato"
                  : "Errore",
                res.message
              );
            } catch {
              Alert.alert("Errore", "Impossibile dissociare il dispositivo.");
            } finally {
              setIsSyncingCloud(false);
            }
          },
        },
      ]
    );
  };

  const handleChangeCustomSyncCode = () => {
    if (Platform.OS === "ios") {
      Alert.prompt(
        "Personalizza Codice Cloud",
        "Scegli un nome semplice non ancora in uso (es. il tuo nome o matricola). Inserendo lo stesso nome su entrambi i telefoni, si sincronizzeranno senza codici casuali.",
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
      if (isCloudConfigured()) {
        // Sincronizza prima, così il codice punta a dati già presenti sul cloud
        await syncWithICloudStorage();
        const code = await getCloudSyncId();
        await Clipboard.setStringAsync(code);
        setCloudSyncId(code);
        Alert.alert(
          "Codice Copiato!",
          `Il Codice Dispositivo ${code} è stato copiato. Inseriscilo nel campo "Collega un altro dispositivo" sull'altro dispositivo.`,
        );
        return;
      }
      await copyCloudSyncCodeToClipboard();
      Alert.alert(
        "Codice Copiato!",
        "Il codice di backup è stato copiato negli appunti. Incollalo su un altro dispositivo per ripristinare i tuoi dati.",
      );
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
        }
        Alert.alert(
          res.success ? "Dispositivi Associati" : "Associazione non riuscita",
          res.message,
        );
      } finally {
        setIsSyncingCloud(false);
      }
      return;
    }

    // Codice di backup manuale (STUDICI_CLOUD:...)
    Alert.alert(
      "Ripristina Dati Cloud",
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
              Alert.alert("Ripristino Completato", res.message);
            } else {
              Alert.alert("Errore Ripristino", res.message);
            }
          },
        },
      ]
    );
  };

  const handleToggleICloudAutoSync = async (value: boolean) => {
    if (!pairedDevices?.isPaired) {
      Alert.alert(
        "Associazione Richiesta",
        "La sincronizzazione automatica non è selezionabile finché non associ un secondo dispositivo. Usa il pulsante AirDrop o condividi il codice per associare l'altro iPhone/iPad.",
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
    ? "Laurea a Ciclo Unico"
    : isMagistrale
      ? "Laurea Magistrale"
      : "Laurea Triennale";

  // Percorso / Classe (es. "LR9", "L-9", "LM-21")
  let displayClass = rawCourseClass;
  if (!displayClass && rawCourseName) {
    const match = rawCourseName.match(/\b(L[MR]?[- ]?\d+|L[- ]\d+)\b/i);
    if (match) displayClass = match[1].toUpperCase();
  }
  if (
    displayClass &&
    !displayClass.toLowerCase().startsWith("classe") &&
    !displayClass.toLowerCase().startsWith("percorso")
  ) {
    displayClass = displayClass.startsWith("L")
      ? `Classe ${displayClass}`
      : `Percorso ${displayClass}`;
  }

  const cleanCourseTitle =
    rawCourseName
      .replace(/\s*[-–]\s*(?:triennale|magistrale)\b/gi, "")
      .trim() || "Nessun corso";

  const courseMetadata = {
    cleanCourseTitle,
    degreeTypeLabel,
    isMagistrale,
    displayClass,
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
        contentContainerStyle={{ paddingBottom: 130 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Apple ID Style Account Header Card con Metadati Corso */}
        <View style={styles.profileHeaderCard}>
          <View style={[styles.profileAvatarBox, { backgroundColor: theme.primary, shadowColor: theme.primary }]}>
            <Ionicons name="school" size={26} color="#ffffff" />
          </View>
          <View style={styles.profileHeaderInfo}>
            <Text style={styles.profileDegreeTitle} numberOfLines={2}>
              {courseMetadata.cleanCourseTitle}
            </Text>
            <Text style={styles.profileFacultySubtitle}>
              {courseMetadata.faculty}
            </Text>

            {/* Badge Tipologia & Classe/Percorso */}
            <View style={styles.profileBadgesRow}>
              <View
                style={[
                  styles.profileBadge,
                  {
                    backgroundColor: courseMetadata.isMagistrale
                      ? "rgba(168, 85, 247, 0.15)"
                      : "rgba(59, 130, 246, 0.15)",
                  },
                ]}
              >
                <View
                  style={[
                    styles.profileBadgeDot,
                    {
                      backgroundColor: courseMetadata.isMagistrale
                        ? "#c084fc"
                        : "#60a5fa",
                    },
                  ]}
                />
                <Text
                  style={[
                    styles.profileBadgeText,
                    {
                      color: courseMetadata.isMagistrale
                        ? "#c084fc"
                        : "#60a5fa",
                    },
                  ]}
                >
                  {courseMetadata.degreeTypeLabel}
                </Text>
              </View>

              {courseMetadata.displayClass ? (
                <View
                  style={[
                    styles.profileBadge,
                    { backgroundColor: "rgba(255, 159, 10, 0.15)" },
                  ]}
                >
                  <Ionicons
                    name="ribbon-outline"
                    size={11}
                    color="#ff9f0a"
                    style={{ marginRight: 4 }}
                  />
                  <Text style={[styles.profileBadgeText, { color: "#ff9f0a" }]}>
                    {courseMetadata.displayClass}
                  </Text>
                </View>
              ) : null}
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
            onPress={() => setCourseModalVisible(true)}
          >
            <View style={[styles.iconBox, { backgroundColor: theme.primary }]}>
              <Ionicons name="school" size={17} color="#ffffff" />
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
            onPress={() => setChannelModalVisible(true)}
          >
            <View style={[styles.iconBox, { backgroundColor: "#ff2d55" }]}>
              <Ionicons name="funnel" size={16} color="#ffffff" />
            </View>
            <Text style={styles.rowTitle}>Corso Predefinito</Text>
            <Text style={styles.rowDetail} numberOfLines={1}>
              {defaultTabLabel}
            </Text>
            <Ionicons name="chevron-forward" size={15} color="#48484a" />
          </TouchableOpacity>
        </View>
        <Text style={styles.sectionFooter}>
          {
            "L'app visualizzerà in automatico l'orario e le aule del canale selezionato."
          }
        </Text>

        {/* Gruppo: ASPETTO & TEMA */}
        <Text style={styles.sectionHeader}>ASPETTO</Text>
        <View style={styles.groupedCard}>
          {isNativeComponentAvailable ? (
            <MenuView
              title="Colore Tema"
              actions={themeMenuActions}
              onPressAction={({ nativeEvent }) => {
                setThemeId(nativeEvent.event);
              }}
            >
              <View style={styles.tableRow}>
                <View style={[styles.iconBox, { backgroundColor: theme.primary }]}>
                  <Ionicons name="color-palette" size={17} color="#ffffff" />
                </View>
                <Text style={styles.rowTitle}>Colore Tema</Text>
                <View style={styles.themeRowPreview}>
                  <View
                    style={[styles.themeRowDot, { backgroundColor: theme.primary }]}
                  />
                  <Text style={styles.rowDetail} numberOfLines={1}>
                    {theme.name}
                  </Text>
                </View>
                <Ionicons name="chevron-expand" size={15} color="#8e8e93" />
              </View>
            </MenuView>
          ) : (
            <>
              <TouchableOpacity
                style={styles.tableRow}
                activeOpacity={0.7}
                onPress={() => setThemeSectionExpanded((prev) => !prev)}
              >
                <View style={[styles.iconBox, { backgroundColor: theme.primary }]}>
                  <Ionicons name="color-palette" size={17} color="#ffffff" />
                </View>
                <Text style={styles.rowTitle}>Colore Tema</Text>
                <View style={styles.themeRowPreview}>
                  <View
                    style={[styles.themeRowDot, { backgroundColor: theme.primary }]}
                  />
                  <Text style={styles.rowDetail} numberOfLines={1}>
                    {theme.name}
                  </Text>
                </View>
                <Ionicons
                  name={themeSectionExpanded ? "chevron-up" : "chevron-down"}
                  size={15}
                  color="#8e8e93"
                />
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
                              <Ionicons name="checkmark" size={13} color="#ffffff" />
                            )}
                          </View>
                          <Text
                            style={[
                              styles.themeCardName,
                              isSelected && { color: "#ffffff", fontWeight: "700" },
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
          Modifica il colore tema dell&apos;intera app. I dettagli visivi e le sezioni del viaggio pendolare si adatteranno automaticamente.
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
            <View style={[styles.iconBox, { backgroundColor: "#10b981" }]}>
              <Ionicons name="calendar" size={17} color="#ffffff" />
            </View>
            <Text style={styles.rowTitle}>Registro Presenze</Text>
            <Text style={styles.rowDetail}>
              {attendanceRecords.length > 0
                ? `${attendanceRecords.length} registrate`
                : "Nessuna"}
            </Text>
            <Ionicons name="chevron-forward" size={15} color="#48484a" />
          </TouchableOpacity>
        </View>
        <Text style={styles.sectionFooter}>
          {
            "Tieni premuta una lezione nell'orario per registrarne la frequenza."
          }
        </Text>

        {/* Gruppo: SINCRONIZZAZIONE */}
        <Text style={styles.sectionHeader}>SINCRONIZZAZIONE</Text>
        <View style={styles.groupedCard}>
          {/* Riga 1: Sincronizzazione Cloud */}
          <TouchableOpacity
            style={styles.tableRow}
            activeOpacity={0.7}
            onPress={() => setCloudModalVisible(true)}
          >
            <View style={[styles.iconBox, { backgroundColor: "#0ea5e9" }]}>
              {isSyncingCloud ? (
                <ActivityIndicator size="small" color="#ffffff" />
              ) : (
                <Ionicons name="cloud-done" size={17} color="#ffffff" />
              )}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>Sincronizzazione Cloud</Text>
              <Text style={styles.rowSubTitle}>
                {pairedDevices?.isPaired && pairedDevices.otherDevice
                  ? `Associato con ${pairedDevices.otherDevice.name} • ${formatSyncDate(lastCloudSyncTime)}`
                  : "Non associato (richiede 2 dispositivi)"}
              </Text>
            </View>
            <TouchableOpacity
              style={styles.inlineActionBtn}
              activeOpacity={0.7}
              onPress={handleSyncCloud}
              disabled={isSyncingCloud}
            >
              <Text style={styles.inlineActionBtnText}>Sincronizza</Text>
            </TouchableOpacity>
            <Ionicons name="chevron-forward" size={15} color="#48484a" style={{ marginLeft: 6 }} />
          </TouchableOpacity>

          <View style={styles.separator} />

          {/* Riga 2: Calendario Apple */}
          <TouchableOpacity
            style={styles.tableRow}
            activeOpacity={0.7}
            onPress={handleSyncCalendar}
            disabled={isSyncingCalendar}
          >
            <View style={[styles.iconBox, { backgroundColor: "#ff2d55" }]}>
              {isSyncingCalendar ? (
                <ActivityIndicator size="small" color="#ffffff" />
              ) : (
                <Ionicons name="calendar" size={17} color="#ffffff" />
              )}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>Calendario Apple</Text>
              <Text style={styles.rowSubTitle}>
                {formatSyncDate(lastCalendarSyncTime)}
              </Text>
            </View>
            <TouchableOpacity
              style={[styles.inlineActionBtn, { backgroundColor: "rgba(255, 45, 85, 0.15)" }]}
              activeOpacity={0.7}
              onPress={handleSyncCalendar}
              disabled={isSyncingCalendar}
            >
              <Text style={[styles.inlineActionBtnText, { color: "#ff2d55" }]}>
                {isSyncingCalendar ? "In corso..." : "Sincronizza"}
              </Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </View>
        <Text style={styles.sectionFooter}>
          Sincronizza lezioni e presenze nel cloud o esportale direttamente nel Calendario Apple.
        </Text>

        {/* Gruppo: ITINERARIO PENDOLARE */}
        <Text style={styles.sectionHeader}>ITINERARIO PENDOLARE</Text>
        <View style={styles.groupedCard}>
          <TouchableOpacity
            style={styles.tableRow}
            activeOpacity={0.7}
            onPress={() => setCommuterModalVisible(true)}
          >
            <View style={[styles.iconBox, { backgroundColor: "#fb923c" }]}>
              <Ionicons name="train" size={17} color="#ffffff" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>Impostazioni Viaggio Pendolare</Text>
              <Text style={styles.rowSubTitle}>
                {commuterConfig?.originAddress || "Amelia"} ➔{" "}
                {commuterConfig?.departureStation?.shortName || "Orte"} ➔{" "}
                {commuterConfig?.arrivalStation?.shortName || "Roma Tiburtina"}
                {commuterConfig?.carLeg?.enabled ? " • Auto inclusa" : ""}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={15} color="#48484a" style={{ marginLeft: 6 }} />
          </TouchableOpacity>
        </View>
        <Text style={styles.sectionFooter}>
          Configura partenza da casa, tragitto in auto per la stazione, stazioni Trenitalia e mezzi urbani a Roma per calcolare l&apos;itinerario migliore.
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
            <View style={[styles.iconBox, { backgroundColor: theme.primary }]}>
              {isExportingPdf ? (
                <ActivityIndicator size="small" color="#ffffff" />
              ) : (
                <Ionicons name="document-text" size={17} color="#ffffff" />
              )}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>Orario Settimanale (PDF)</Text>
              <Text style={styles.rowSubTitle}>Formato Calendario A4</Text>
            </View>
            <Ionicons name="share-outline" size={18} color="#8e8e93" />
          </TouchableOpacity>

          <View style={styles.separator} />

          {/* Riga 2: PDF Registro Presenze */}
          <TouchableOpacity
            style={styles.tableRow}
            activeOpacity={0.7}
            onPress={handleExportAttendancePdf}
            disabled={isExportingPdf}
          >
            <View style={[styles.iconBox, { backgroundColor: "#10b981" }]}>
              {isExportingPdf ? (
                <ActivityIndicator size="small" color="#ffffff" />
              ) : (
                <Ionicons name="stats-chart" size={16} color="#ffffff" />
              )}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>Registro Presenze (PDF)</Text>
              <Text style={styles.rowSubTitle}>Statistiche, Frequenze & Calendario</Text>
            </View>
            <Ionicons name="share-outline" size={18} color="#8e8e93" />
          </TouchableOpacity>
        </View>
        <Text style={styles.sectionFooter}>
          Genera ed esporta documenti PDF pronti per la stampa, salvataggio su File o condivisione.
        </Text>

        {/* Gruppo 2: FONTI UFFICIALI */}
        <Text style={styles.sectionHeader}>FONTI UFFICIALI</Text>
        <View style={styles.groupedCard}>
          <TouchableOpacity
            style={styles.tableRow}
            activeOpacity={0.7}
            onPress={openSourceWebsite}
          >
            <View style={[styles.iconBox, { backgroundColor: "#007aff" }]}>
              <Ionicons name="globe-outline" size={17} color="#ffffff" />
            </View>
            <Text style={styles.rowTitle}>Portale Orari ICI</Text>
            <Text style={styles.rowDetail} numberOfLines={1}>
              web.uniroma1.it
            </Text>
            <Ionicons name="open-outline" size={15} color="#48484a" />
          </TouchableOpacity>
        </View>
        <Text style={styles.sectionFooter}>
          Orari e aule sono estratti direttamente dalle tabelle ufficiali della
          presidenza.
        </Text>

        {/* Gruppo 3: SISTEMA & ARCHIVIAZIONE */}
        <Text style={styles.sectionHeader}>ARCHIVIAZIONE</Text>
        <View style={styles.groupedCard}>
          {/* Riga 1: Svuota Cache */}
          <TouchableOpacity
            style={styles.tableRow}
            activeOpacity={0.7}
            onPress={clearCacheAndReload}
          >
            <View style={[styles.iconBox, { backgroundColor: "#34c759" }]}>
              <Ionicons name="refresh" size={17} color="#ffffff" />
            </View>
            <Text style={styles.rowTitle}>Aggiorna</Text>
            <Ionicons name="chevron-forward" size={15} color="#48484a" />
          </TouchableOpacity>

          <View style={styles.separator} />

          {/* Riga 2: Reset Totale */}
          <TouchableOpacity
            style={styles.tableRow}
            activeOpacity={0.7}
            onPress={resetApp}
          >
            <View style={[styles.iconBox, { backgroundColor: "#ff3b30" }]}>
              <Ionicons name="trash" size={16} color="#ffffff" />
            </View>
            <Text style={[styles.rowTitle, { color: "#ff453a" }]}>
              Ripristina Applicazione
            </Text>
            <Ionicons name="chevron-forward" size={15} color="#48484a" />
          </TouchableOpacity>
        </View>

        {/* Footer Info App */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>
            {`StudICI · v${Constants.expoConfig?.version || "1.4.9"} (Build ${Constants.expoConfig?.ios?.buildNumber || "7"})`}
          </Text>
          <Text style={styles.footerSubText}>Sapienza Università di Roma</Text>
        </View>
      </ScrollView>

      {/* Modal Selezione Corso di Laurea in stile App / iOS */}
      <Modal
        visible={courseModalVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setCourseModalVisible(false)}
      >
        <SafeAreaView style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.modalTitle}>Corso di Laurea</Text>
              <Text style={styles.modalSubtitle}>
                Facoltà di Ingegneria Civile e Industriale
              </Text>
            </View>
            <TouchableOpacity
              style={styles.modalCloseCircle}
              activeOpacity={0.7}
              onPress={() => setCourseModalVisible(false)}
            >
              <Ionicons name="close" size={20} color="#a1a1aa" />
            </TouchableOpacity>
          </View>

          {/* Barra di Ricerca in stile iOS */}
          <View style={styles.searchBarContainer}>
            <Ionicons
              name="search"
              size={16}
              color="#8e8e93"
              style={{ marginRight: 8 }}
            />
            <TextInput
              style={styles.searchInput}
              placeholder="Cerca corso o classe (es. Clinica, L-9)..."
              placeholderTextColor="#71717a"
              value={searchCourse}
              onChangeText={setSearchCourse}
              clearButtonMode="while-editing"
            />
            {searchCourse.length > 0 && (
              <TouchableOpacity onPress={() => setSearchCourse("")}>
                <Ionicons name="close-circle" size={16} color="#8e8e93" />
              </TouchableOpacity>
            )}
          </View>

          {loading ? (
            <ActivityIndicator
              size="large"
              color={theme.primary}
              style={{ marginTop: 40 }}
            />
          ) : (
            <ScrollView
              style={styles.modalScroll}
              showsVerticalScrollIndicator={false}
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
                      isSelected && [styles.modalItemSelected, { borderColor: theme.primary }],
                    ]}
                    activeOpacity={0.7}
                    onPress={() => selectDegree(deg)}
                  >
                    <View
                      style={[
                        styles.courseIconBox,
                        isSelected && { backgroundColor: theme.primary },
                      ]}
                    >
                      <Ionicons name="school" size={18} color="#ffffff" />
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
                                ? "rgba(168, 85, 247, 0.15)"
                                : "rgba(59, 130, 246, 0.15)",
                            },
                          ]}
                        >
                          <Text
                            style={[
                              styles.typeBadgeText,
                              { color: isMagistrale ? "#c084fc" : "#60a5fa" },
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
        </SafeAreaView>
      </Modal>

      {/* Modal Fallback Cambio Canale / Anno (usato in Expo Go o cliccando 'Personalizza...') */}
      <Modal
        visible={channelModalVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setChannelModalVisible(false)}
      >
        <SafeAreaView style={{ flex: 1, backgroundColor: "#111111" }}>
          <View
            style={{
              flexDirection: "row",
              justifyContent: "flex-end",
              paddingHorizontal: 20,
              paddingTop: 16,
            }}
          >
            <TouchableOpacity
              style={styles.modalCloseCircle}
              activeOpacity={0.7}
              onPress={() => setChannelModalVisible(false)}
            >
              <Ionicons name="close" size={20} color="#a1a1aa" />
            </TouchableOpacity>
          </View>
          <DefaultTabPicker
            tabs={availableTabs}
            initialTabUrl={defaultTabUrl}
            degreeName={degreeName}
            title="Anno e Canale Predefinito"
            subtitle="Scegli quale orario visualizzare all'apertura dell'app."
            confirmButtonText="Imposta come Predefinito"
            onConfirm={async (tab) => {
              await selectDefaultTab(tab);
            }}
          />
        </SafeAreaView>
      </Modal>

      {/* Modal Registro Presenze Completo */}
      <Modal
        visible={attendanceModalVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setAttendanceModalVisible(false)}
      >
        <SafeAreaView style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.modalTitle}>Registro Presenze</Text>
              <Text style={styles.modalSubtitle}>
                {attendanceRecords.length}{" "}
                {attendanceRecords.length === 1
                  ? "lezione frequentata"
                  : "lezioni frequentate"}{" "}
                · {attendanceStats?.totalHours || 0} ore
              </Text>
            </View>
            {attendanceRecords.length > 0 && (
              <TouchableOpacity
                style={styles.modalExportHeaderBtn}
                activeOpacity={0.7}
                onPress={handleExportAttendancePdf}
              >
                <Ionicons name="share-outline" size={19} color="#ffffff" />
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={styles.modalCloseCircle}
              activeOpacity={0.7}
              onPress={() => setAttendanceModalVisible(false)}
            >
              <Ionicons name="close" size={20} color="#a1a1aa" />
            </TouchableOpacity>
          </View>

          <ScrollView
            style={styles.modalScroll}
            showsVerticalScrollIndicator={false}
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
                  Tieni premuto su una lezione nell&apos;Orario per registrarne
                  la presenza.
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
        </SafeAreaView>
      </Modal>

      {/* Modal Gestione Sincronizzazione Cloud */}
      <Modal
        visible={cloudModalVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setCloudModalVisible(false)}
      >
        <SafeAreaView style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.modalTitle}>Sincronizzazione Cloud</Text>
              <Text style={styles.modalSubtitle}>
                Backup e ripristino di corsi, preferenze e presenze
              </Text>
            </View>
            <TouchableOpacity
              style={styles.modalCloseCircle}
              activeOpacity={0.7}
              onPress={() => setCloudModalVisible(false)}
            >
              <Ionicons name="close" size={20} color="#a1a1aa" />
            </TouchableOpacity>
          </View>

          <ScrollView
            style={styles.modalScroll}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {/* Status Card */}
            <View style={styles.cloudStatusCard}>
              <View style={styles.cloudIconCircle}>
                <Ionicons name="cloud-done" size={30} color="#0284c7" />
              </View>
              <Text style={styles.cloudStatusTitle}>Cloud Sync StudICI</Text>
              <Text style={styles.cloudStatusSub}>
                {lastCloudSyncTime
                  ? `Ultimo salvataggio: ${formatSyncDate(lastCloudSyncTime)}`
                  : "Nessun salvataggio recente"}
              </Text>
              {cloudSyncId ? (
                <TouchableOpacity
                  style={styles.cloudIdBadge}
                  activeOpacity={0.7}
                  onPress={handleChangeCustomSyncCode}
                >
                  <Ionicons
                    name="finger-print"
                    size={13}
                    color="#38bdf8"
                    style={{ marginRight: 4 }}
                  />
                  <Text style={styles.cloudIdText} selectable>{cloudSyncId}</Text>
                  <Ionicons
                    name="pencil"
                    size={11}
                    color="#38bdf8"
                    style={{ marginLeft: 6, opacity: 0.8 }}
                  />
                </TouchableOpacity>
              ) : null}
            </View>

            {/* Sezione Dispositivi Associati */}
            <View style={styles.devicesSection}>
              <View style={styles.devicesHeaderRow}>
                <Text style={styles.devicesSectionTitle}>
                  Dispositivi Associati ({pairedDevices ? (pairedDevices.otherDevices?.length || 0) + 1 : 1})
                </Text>
                <View
                  style={[
                    styles.pairingStatusPill,
                    pairedDevices?.isPaired
                      ? styles.pairingStatusPillActive
                      : styles.pairingStatusPillWaiting,
                  ]}
                >
                  <View
                    style={[
                      styles.pairingStatusDot,
                      pairedDevices?.isPaired
                        ? styles.pairingStatusDotActive
                        : styles.pairingStatusDotWaiting,
                    ]}
                  />
                  <Text
                    style={[
                      styles.pairingStatusText,
                      pairedDevices?.isPaired
                        ? styles.pairingStatusTextActive
                        : styles.pairingStatusTextWaiting,
                    ]}
                  >
                    {pairedDevices?.isPaired
                      ? `Associati (${(pairedDevices.otherDevices?.length || 0) + 1})`
                      : "In attesa"}
                  </Text>
                </View>
              </View>

              {/* Card 1: Questo Dispositivo */}
              <View style={styles.deviceCard}>
                <View
                  style={[
                    styles.deviceIconCircle,
                    { backgroundColor: "rgba(2, 132, 199, 0.15)" },
                  ]}
                >
                  <Ionicons name="phone-portrait" size={19} color="#38bdf8" />
                </View>
                <View style={{ flex: 1, paddingRight: 4 }}>
                  <View style={{ flexDirection: "row", alignItems: "center" }}>
                    <Text style={styles.deviceNameText} numberOfLines={1}>
                      {pairedDevices?.myDevice?.name || "Questo iPhone"}
                    </Text>
                    <View style={styles.myDeviceBadge}>
                      <Text style={styles.myDeviceBadgeText}>Questo</Text>
                    </View>
                  </View>
                  <Text style={styles.deviceMetaText}>
                    {pairedDevices?.myDevice?.platform || "iOS"} • Attivo adesso
                  </Text>
                </View>
                {pairedDevices?.isPaired && (
                  <TouchableOpacity
                    style={styles.dissociateBtn}
                    activeOpacity={0.7}
                    onPress={() => handleDissociateDevice()}
                  >
                    <Ionicons
                      name="link-outline"
                      size={13}
                      color="#ef4444"
                      style={{ marginRight: 3 }}
                    />
                    <Text style={styles.dissociateBtnText}>Scollega</Text>
                  </TouchableOpacity>
                )}
              </View>

              {/* Lista Dispositivi Associati oppure Empty State */}
              {pairedDevices?.isPaired && pairedDevices.otherDevices && pairedDevices.otherDevices.length > 0 ? (
                pairedDevices.otherDevices.map((dev) => (
                  <View key={dev.id} style={[styles.deviceCard, { marginTop: 8 }]}>
                    <View
                      style={[
                        styles.deviceIconCircle,
                        { backgroundColor: "rgba(52, 199, 89, 0.15)" },
                      ]}
                    >
                      <Ionicons name="phone-portrait" size={19} color="#34c759" />
                    </View>
                    <View style={{ flex: 1, paddingRight: 4 }}>
                      <View style={{ flexDirection: "row", alignItems: "center" }}>
                        <Text style={styles.deviceNameText} numberOfLines={1}>
                          {dev.name}
                        </Text>
                        <View style={styles.pairedDeviceBadge}>
                          <Text style={styles.pairedDeviceBadgeText}>Associato</Text>
                        </View>
                      </View>
                      <Text style={styles.deviceMetaText}>
                        {dev.platform} • Sinc:{" "}
                        {formatSyncDate(dev.lastActive)}
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
                ))
              ) : (
                <View style={styles.unpairedNoticeBox}>
                  <View style={styles.unpairedNoticeHeader}>
                    <Ionicons
                      name="alert-circle-outline"
                      size={16}
                      color="#f59e0b"
                      style={{ marginRight: 5 }}
                    />
                    <Text style={styles.unpairedNoticeTitle}>
                      Nessun dispositivo associato
                    </Text>
                  </View>
                  <Text style={styles.unpairedNoticeDesc}>
                    La sincronizzazione si attiva solo se associ altri dispositivi. Invia il codice con AirDrop o inseriscilo sull&apos;altro iPhone per iniziare.
                  </Text>
                </View>
              )}
            </View>

            {/* Card Switch iCloud Sync Automatico */}
            <TouchableOpacity
              style={[
                styles.cloudICloudCard,
                !pairedDevices?.isPaired && { opacity: 0.55 },
              ]}
              activeOpacity={pairedDevices?.isPaired ? 1 : 0.7}
              onPress={() => {
                if (!pairedDevices?.isPaired) {
                  Alert.alert(
                    "Associazione Richiesta",
                    "La sincronizzazione automatica non è selezionabile finché non associ un secondo dispositivo. Usa il pulsante AirDrop o condividi il codice per associare l'altro iPhone/iPad.",
                  );
                }
              }}
            >
              <View
                style={[
                  styles.cloudICloudIconBox,
                  !pairedDevices?.isPaired && {
                    backgroundColor: "rgba(142, 142, 147, 0.15)",
                  },
                ]}
              >
                <Ionicons
                  name="cloud"
                  size={20}
                  color={pairedDevices?.isPaired ? "#34c759" : "#8e8e93"}
                />
              </View>
              <View style={{ flex: 1, paddingRight: 8 }}>
                <Text style={styles.cloudICloudTitle}>Sincronizzazione Automatica</Text>
                <Text style={styles.cloudICloudSub}>
                  {pairedDevices?.isPaired
                    ? pairedDevices.otherDevices && pairedDevices.otherDevices.length > 1
                      ? `Mantiene sincronizzato questo dispositivo con gli altri ${pairedDevices.otherDevices.length} dispositivi associati`
                      : `Mantiene sincronizzato questo dispositivo con ${pairedDevices.otherDevice?.name || "l'altro dispositivo"}`
                    : "Non selezionabile: richiede almeno un dispositivo associato"}
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

            {/* Azioni Principali */}
            <TouchableOpacity
              style={[
                styles.cloudPrimaryBtn,
                isSyncingCloud && { opacity: 0.7 },
              ]}
              activeOpacity={0.7}
              onPress={handleSyncCloud}
              disabled={isSyncingCloud}
            >
              <Ionicons
                name={isSyncingCloud ? "refresh" : "cloud-upload-outline"}
                size={18}
                color="#ffffff"
                style={{ marginRight: 8 }}
              />
              <Text style={styles.cloudPrimaryBtnText}>
                {isSyncingCloud
                  ? "Sincronizzazione in corso..."
                  : "Esegui Sincronizzazione Ora"}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.cloudAirDropBtn}
              activeOpacity={0.7}
              onPress={handleAirDrop}
              disabled={isSyncingCloud}
            >
              <Ionicons
                name="share-outline"
                size={18}
                color="#ffffff"
                style={{ marginRight: 8 }}
              />
              <Text style={styles.cloudAirDropBtnText}>
                Invia via AirDrop
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.cloudSecondaryBtn}
              activeOpacity={0.7}
              onPress={handleCopyCloudCode}
            >
              <Ionicons
                name="copy-outline"
                size={18}
                color="#0284c7"
                style={{ marginRight: 8 }}
              />
              <Text style={styles.cloudSecondaryBtnText}>
                Copia Codice Dispositivo
              </Text>
            </TouchableOpacity>

            {/* Box Ripristino */}
            <View style={styles.cloudRestoreBox}>
              <Text style={styles.cloudRestoreTitle}>
                Collega un altro dispositivo
              </Text>
              <Text style={styles.cloudRestoreSub}>
                Inserisci il Codice Dispositivo mostrato sull&apos;altro
                dispositivo: corso, canale e presenze verranno sincronizzati
                automaticamente. (Accetta anche un codice di backup
                STUDICI_CLOUD:...)
              </Text>
              <TextInput
                style={styles.cloudRestoreInput}
                placeholder="es. ST1234A o NOME"
                placeholderTextColor="#71717a"
                value={restoreCodeInput}
                onChangeText={setRestoreCodeInput}
                multiline
                numberOfLines={3}
                autoCapitalize="characters"
                autoCorrect={false}
              />
              <TouchableOpacity
                style={[
                  styles.cloudRestoreBtn,
                  (!restoreCodeInput.trim() || isSyncingCloud) && {
                    opacity: 0.4,
                  },
                ]}
                activeOpacity={0.7}
                onPress={handleRestoreFromCloud}
                disabled={!restoreCodeInput.trim() || isSyncingCloud}
              >
                <Ionicons
                  name="link-outline"
                  size={16}
                  color="#ffffff"
                  style={{ marginRight: 6 }}
                />
                <Text style={styles.cloudRestoreBtnText}>Collega</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </SafeAreaView>
      </Modal>

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
    backgroundColor: "#000000",
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
    gap: 6,
    marginTop: 6,
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
    fontWeight: "400",
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
    borderRadius: 14,
    overflow: "hidden",
    borderWidth: 0.5,
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
    width: 30,
    height: 30,
    borderRadius: 7,
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
    backgroundColor: "rgba(255, 255, 255, 0.1)",
    marginLeft: 60,
  },
  /* Footer */
  footer: {
    alignItems: "center",
    marginTop: 32,
    marginBottom: 20,
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
    backgroundColor: "#111111",
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
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#27272a",
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
    backgroundColor: "rgba(130, 36, 51, 0.15)",
    borderWidth: 1.5,
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
  },
  typeBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  typeBadgeText: {
    fontSize: 11,
    fontWeight: "700",
  },
  classBadge: {
    backgroundColor: "rgba(255, 159, 10, 0.15)",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  classBadgeText: {
    color: "#ff9f0a",
    fontSize: 11,
    fontWeight: "700",
  },
  /* ── Registro Presenze Styles ── */
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
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 10,
    marginLeft: 8,
  },
  inlineActionBtnText: {
    color: "#ffffff",
    fontSize: 12.5,
    fontWeight: "600",
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
    backgroundColor: "rgba(56, 189, 248, 0.12)",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
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
  cloudICloudCard: {
    backgroundColor: "#1c1c1e",
    borderRadius: 16,
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 16,
    borderWidth: 0.5,
    borderColor: "rgba(255, 255, 255, 0.08)",
  },
  cloudICloudIconBox: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(52, 199, 89, 0.15)",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  cloudICloudTitle: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "600",
  },
  cloudICloudSub: {
    color: "#8e8e93",
    fontSize: 12,
    marginTop: 2,
  },
  cloudPrimaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#0284c7",
    height: 44,
    borderRadius: 9999,
    paddingHorizontal: 20,
    marginBottom: 10,
    shadowColor: "#0284c7",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
  cloudPrimaryBtnText: {
    color: "#ffffff",
    fontSize: 14.5,
    fontWeight: "600",
    letterSpacing: -0.2,
  },
  cloudAirDropBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#2563eb",
    height: 44,
    borderRadius: 9999,
    paddingHorizontal: 20,
    marginBottom: 10,
    shadowColor: "#2563eb",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
  cloudAirDropBtnText: {
    color: "#ffffff",
    fontSize: 14.5,
    fontWeight: "600",
    letterSpacing: -0.2,
  },
  cloudSecondaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(2, 132, 199, 0.12)",
    borderWidth: 1,
    borderColor: "rgba(2, 132, 199, 0.35)",
    height: 44,
    borderRadius: 9999,
    paddingHorizontal: 20,
    marginBottom: 20,
  },
  cloudSecondaryBtnText: {
    color: "#38bdf8",
    fontSize: 14,
    fontWeight: "600",
    letterSpacing: -0.2,
  },
  cloudRestoreBox: {
    backgroundColor: "#1c1c1e",
    borderRadius: 16,
    padding: 16,
    borderWidth: 0.5,
    borderColor: "rgba(255, 255, 255, 0.08)",
    marginBottom: 40,
  },
  cloudRestoreTitle: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "700",
    marginBottom: 6,
  },
  cloudRestoreSub: {
    color: "#8e8e93",
    fontSize: 12.5,
    lineHeight: 17,
    marginBottom: 12,
  },
  cloudRestoreInput: {
    backgroundColor: "#141416",
    color: "#ffffff",
    fontSize: 12.5,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.1)",
    marginBottom: 12,
    minHeight: 64,
    textAlignVertical: "top",
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
  cloudRestoreBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#10b981",
    height: 42,
    borderRadius: 9999,
    paddingHorizontal: 18,
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
    marginRight: 6,
  },
  themeRowDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginRight: 7,
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
});

