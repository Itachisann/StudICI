import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Clipboard from "expo-clipboard";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  Degree,
  fetchAllCourseData,
  fetchDegrees,
  Tab,
} from "../utils/scraper";
import { linkDeviceWithCode, isValidSyncCode } from "../utils/cloudSync";
import { CourseDownloadView } from "./CourseDownloadView";
import { DefaultTabPicker } from "./DefaultTabPicker";

const SAPIENZA_RED = "#822433";

interface OnboardingCourseSelectorProps {
  onComplete: () => void;
}

export function OnboardingCourseSelector({
  onComplete,
}: OnboardingCourseSelectorProps) {
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

  // Step 2: Selezione Anno e Canale
  const [step, setStep] = useState<"select_course" | "select_channel">(
    "select_course",
  );
  const [downloadedTabs, setDownloadedTabs] = useState<Tab[]>([]);
  const [pendingDegree, setPendingDegree] = useState<Degree | null>(null);

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

  const handleSelectDegree = async (degree: Degree) => {
    setCurrentDegreeName(degree.name);
    setPendingDegree(degree);
    setDownloading(true);
    setProgressText("Preparazione e analisi canali...");

    try {
      // 1. Scarica TUTTO in un'unica botta con avanzamento in tempo reale
      const { tabs } = await fetchAllCourseData(degree.url, true, (stepMsg) => {
        setProgressText(stepMsg);
      });

      // 2. Se il corso presenta più canali/anni, permetti allo studente di scegliere il suo predefinito
      if (tabs && tabs.length > 1) {
        setDownloadedTabs(tabs);
        setDownloading(false);
        setStep("select_channel");
      } else {
        // Corso a canale unico: salva direttamente
        await AsyncStorage.setItem("selectedDegreeUrl", degree.url);
        await AsyncStorage.setItem("selectedDegreeName", degree.name);
        if (degree.className) {
          await AsyncStorage.setItem(
            "selectedDegreeClassName",
            degree.className,
          );
        }
        if (tabs && tabs.length === 1) {
          await AsyncStorage.setItem("defaultTabUrl", tabs[0].url);
        } else {
          await AsyncStorage.removeItem("defaultTabUrl");
        }
        onComplete();
      }
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

  const handleConfirmDefaultTab = async (chosenTab: Tab) => {
    if (!pendingDegree) return;
    try {
      await AsyncStorage.setItem("selectedDegreeUrl", pendingDegree.url);
      await AsyncStorage.setItem("selectedDegreeName", pendingDegree.name);
      if (pendingDegree.className) {
        await AsyncStorage.setItem(
          "selectedDegreeClassName",
          pendingDegree.className,
        );
      }
      await AsyncStorage.setItem("defaultTabUrl", chosenTab.url);
      onComplete();
    } catch (e) {
      console.error(e);
      onComplete();
    }
  };

  const handleLinkFromCloud = async () => {
    const code = syncCodeInput.trim();
    if (!code) {
      Alert.alert("Codice Mancante", "Inserisci il Codice Dispositivo dell'altro iPhone o iPad.");
      return;
    }
    if (!isValidSyncCode(code)) {
      Alert.alert(
        "Codice Non Valido",
        "Il codice deve contenere tra 3 e 40 caratteri (es. STUD-XXXX-XXXX-XXXX o nome personalizzato)."
      );
      return;
    }

    setIsLinkingSync(true);
    try {
      const res = await linkDeviceWithCode(code);
      if (res.success) {
        Alert.alert(
          "Dispositivi Associati!",
          res.message,
          [{ text: "Inizia", onPress: () => onComplete() }]
        );
      } else {
        Alert.alert("Associazione Non Riuscita", res.message);
      }
    } catch (err: any) {
      Alert.alert("Errore", err?.message || "Impossibile associare il dispositivo.");
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

  // Schermata Step 2: Selezione Anno e Canale
  if (step === "select_channel" && pendingDegree) {
    return (
      <SafeAreaView style={styles.container}>
        <DefaultTabPicker
          tabs={downloadedTabs}
          degreeName={pendingDegree.name}
          title="Personalizza il tuo Orario"
          subtitle="Scegli l'anno e il canale che frequenti. Verranno aperti in automatico all'avvio."
          confirmButtonText="Imposta come predefinito"
          onConfirm={handleConfirmDefaultTab}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* Header Introduttivo */}
      <View style={styles.header}>
        <View style={styles.logoBadge}>
          <Image
            source={require("../../assets/images/icon.png")}
            style={styles.logoBadgeImage}
            resizeMode="cover"
          />
        </View>
        <Text style={styles.appTitle}>Benvenuto in StudICI</Text>
        <Text style={styles.appSubtitle}>
          Sapienza Università di Roma · Facoltà I.C.I.
        </Text>
        <Text style={styles.instruction}>
          {setupMode === "normal"
            ? "Seleziona il tuo corso di laurea per iniziare. Orari e aule verranno memorizzati sul telefono."
            : "Collega un altro dispositivo per scaricare subito corso, canali e presenze già configurati."}
        </Text>
      </View>

      {/* Selettore Modalità di Avvio */}
      <View style={styles.modeSelectorContainer}>
        <TouchableOpacity
          style={[
            styles.modeTab,
            setupMode === "normal" && styles.modeTabActive,
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
            Configurazione Normale
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.modeTab, setupMode === "sync" && styles.modeTabActive]}
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
            Da Sincronizzazione
          </Text>
        </TouchableOpacity>
      </View>

      {setupMode === "sync" ? (
        <ScrollView
          style={styles.syncContainer}
          contentContainerStyle={{ paddingBottom: 40 }}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.syncCard}>
            <View style={styles.syncIconCircle}>
              <Ionicons name="link" size={28} color="#38bdf8" />
            </View>
            <Text style={styles.syncCardTitle}>Collega Dispositivo Esistente</Text>
            <Text style={styles.syncCardDesc}>
              Se hai già configurato StudICI su un altro iPhone o iPad, inserisci il Codice Dispositivo per associare i due telefoni e scaricare subito corso, canali e presenze.
            </Text>

            <View style={styles.syncInputWrapper}>
              <TextInput
                style={styles.syncInput}
                placeholder="STUD-XXXX-XXXX-XXXX o NOME"
                placeholderTextColor="#71717a"
                value={syncCodeInput}
                onChangeText={setSyncCodeInput}
                autoCapitalize="characters"
                autoCorrect={false}
              />
              <TouchableOpacity
                style={styles.syncPasteBtn}
                activeOpacity={0.7}
                onPress={handlePasteSyncCode}
              >
                <Ionicons name="clipboard-outline" size={16} color="#38bdf8" />
                <Text style={styles.syncPasteBtnText}>Incolla</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={[
                styles.syncSubmitBtn,
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
                  name="cloud-download-outline"
                  size={18}
                  color="#ffffff"
                  style={{ marginRight: 8 }}
                />
              )}
              <Text style={styles.syncSubmitBtnText}>
                {isLinkingSync
                  ? "Collegamento in corso..."
                  : "Collega e Sincronizza Dati"}
              </Text>
            </TouchableOpacity>
          </View>

          {/* Suggerimento AirDrop */}
          <View style={styles.airDropHintBox}>
            <View style={styles.airDropHintIconBox}>
              <Ionicons name="share-outline" size={20} color="#2563eb" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.airDropHintTitle}>Più rapido con AirDrop!</Text>
              <Text style={styles.airDropHintText}>
                Sull&apos;altro iPhone apri{" "}
                <Text style={{ color: "#ffffff", fontWeight: "600" }}>
                  Profilo → Sincronizzazione Cloud → Invia con AirDrop
                </Text>
                . Toccando la notifica o il link ricevuto qui, StudICI si configurerà da solo a 1 tocco!
              </Text>
            </View>
          </View>
        </ScrollView>
      ) : (
        <>
          {/* Barra di Ricerca */}
          <View style={styles.searchContainer}>
            <Ionicons
              name="search"
              size={20}
              color="#8e8e93"
              style={styles.searchIcon}
            />
            <TextInput
              style={styles.searchInput}
              placeholder="Cerca corso (es. Informatica, Clinica...)"
              placeholderTextColor="#636366"
              value={search}
              onChangeText={setSearch}
              clearButtonMode="while-editing"
              autoCorrect={false}
            />
            {search.length > 0 && (
              <TouchableOpacity onPress={() => setSearch("")}>
                <Ionicons name="close-circle" size={18} color="#8e8e93" />
              </TouchableOpacity>
            )}
          </View>

      {/* Lista Corsi */}
      {loading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={SAPIENZA_RED} />
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
                  <View style={styles.courseIconCircle}>
                    <Ionicons
                      name="book-outline"
                      size={22}
                      color={SAPIENZA_RED}
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
                  <Ionicons name="chevron-forward" size={20} color="#636366" />
                </TouchableOpacity>
              );
            })
          )}
        </ScrollView>
      )}
    </>
  )}
</SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#111111",
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 16,
  },
  logoBadge: {
    width: 80,
    height: 80,
    borderRadius: 20,
    backgroundColor: SAPIENZA_RED,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 14,
    shadowColor: SAPIENZA_RED,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 6,
    overflow: "hidden",
  },
  logoBadgeImage: {
    width: "100%",
    height: "100%",
    borderRadius: 20,
  },
  appTitle: {
    fontSize: 28,
    fontWeight: "bold",
    color: "#ffffff",
  },
  appSubtitle: {
    fontSize: 13,
    color: SAPIENZA_RED,
    fontWeight: "600",
    marginTop: 2,
    letterSpacing: 0.5,
  },
  instruction: {
    fontSize: 14,
    color: "#8e8e93",
    marginTop: 8,
    lineHeight: 20,
  },
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1c1c1e",
    marginHorizontal: 20,
    paddingHorizontal: 14,
    height: 46,
    borderRadius: 12,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: "#2c2c2e",
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
  // Stili schermata download
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
    fontSize: 15,
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
  modeSelectorContainer: {
    flexDirection: "row",
    backgroundColor: "#1c1c1e",
    borderRadius: 12,
    padding: 3,
    marginHorizontal: 16,
    marginBottom: 16,
    borderWidth: 0.5,
    borderColor: "rgba(255, 255, 255, 0.1)",
  },
  modeTab: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
    borderRadius: 9,
  },
  modeTabActive: {
    backgroundColor: SAPIENZA_RED,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
  },
  modeTabText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#a1a1aa",
  },
  modeTabTextActive: {
    color: "#ffffff",
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
    backgroundColor: "#0284c7",
    width: "100%",
    height: 46,
    borderRadius: 12,
    shadowColor: "#0284c7",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
  syncSubmitBtnText: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "600",
  },
  airDropHintBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    backgroundColor: "#1c1c1e",
    borderRadius: 16,
    padding: 16,
    borderWidth: 0.5,
    borderColor: "rgba(255, 255, 255, 0.08)",
  },
  airDropHintIconBox: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(37, 99, 235, 0.15)",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
    marginTop: 2,
  },
  airDropHintTitle: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 4,
  },
  airDropHintText: {
    color: "#a1a1aa",
    fontSize: 12.5,
    lineHeight: 17,
  },
});
