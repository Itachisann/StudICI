import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Animated,
  Easing,
  LayoutChangeEvent,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { AppTheme, CARD_RADIUS, DEFAULT_THEME } from "@/constants/theme";
import { LiveTrainInfo, LiveTrainStop } from "@/types/commuter";
import {
  formatStationName,
  parseTimeToMinutes,
  isSameStation,
} from "@/utils/trenitaliaApi";

interface TrainRouteProgressProps {
  liveTrain: LiveTrainInfo;
  commuterDepartureStation: string;
  commuterArrivalStation: string;
  commuterDepartureStationCode?: string;
  commuterArrivalStationCode?: string;
  isToday: boolean;
  theme?: AppTheme;
}

function timeDifferenceMinutes(startM: number, endM: number): number {
  let diff = endM - startM;
  if (diff < 0) diff += 1440;
  return diff;
}

export const TrainRouteProgress: React.FC<TrainRouteProgressProps> = ({
  liveTrain,
  commuterDepartureStation,
  commuterArrivalStation,
  commuterDepartureStationCode,
  commuterArrivalStationCode,
  isToday,
  theme = DEFAULT_THEME,
}) => {
  const contrast = theme.routeContrast || DEFAULT_THEME.routeContrast;
  const [trackWidth, setTrackWidth] = useState<number>(0);
  const [badgeWidth, setBadgeWidth] = useState<number>(100);

  // Timer reattivo in tempo reale continuo (1 secondo) per uno scorrimento fluido del treno in marcia
  const [nowDate, setNowDate] = useState(() => new Date());
  useEffect(() => {
    if (!isToday) return;
    const timer = setInterval(() => setNowDate(new Date()), 1000);
    return () => clearInterval(timer);
  }, [isToday]);

  const rawOrigin = (
    liveTrain.originStationName ||
    liveTrain.originStationCode ||
    ""
  ).trim();

  const depCodeClean = (commuterDepartureStationCode || "").trim().toUpperCase();
  const trainOriginCodeClean = (liveTrain.originStationCode || "").trim().toUpperCase();

  // Verifica se la stazione di salita dell'utente coincide con l'origine della corsa
  const isOriginCommuter = Boolean(
    liveTrain.isOriginStation ||
      (depCodeClean && trainOriginCodeClean && depCodeClean === trainOriginCodeClean) ||
      isSameStation(rawOrigin, commuterDepartureStation)
  );

  const originName = formatStationName(
    isOriginCommuter ? commuterDepartureStation : rawOrigin || commuterDepartureStation
  );
  const departureName = formatStationName(commuterDepartureStation);
  const arrivalName = formatStationName(commuterArrivalStation);

  // Orari programmati delle stazioni
  const depTimeStr = liveTrain.departureTimePlanned || "00:00";
  const arrTimeStr = liveTrain.arrivalTimePlanned || "00:00";
  const tDepM = parseTimeToMinutes(depTimeStr);
  const tArrM = parseTimeToMinutes(arrTimeStr);

  const origTimeStr = useMemo(() => {
    if (isOriginCommuter) return depTimeStr;
    if (liveTrain.originDepartureTimePlanned) {
      return liveTrain.originDepartureTimePlanned;
    }
    const stops: LiveTrainStop[] = liveTrain.stops || [];
    if (stops.length > 0 && stops[0].plannedTime) {
      return stops[0].plannedTime;
    }
    return depTimeStr;
  }, [isOriginCommuter, depTimeStr, liveTrain.originDepartureTimePlanned, liveTrain.stops]);

  const tOrigM = isOriginCommuter ? tDepM : parseTimeToMinutes(origTimeStr);

  // Durata totale programmata della corsa (in minuti)
  const totalTripMinutes = useMemo(() => {
    return timeDifferenceMinutes(tOrigM, tArrM);
  }, [tOrigM, tArrM]);

  // Proporzione esatta della stazione di partenza dell'utente lungo la linea ferroviaria
  const pDep = useMemo(() => {
    if (isOriginCommuter) return 0.0;
    const leg1Minutes = timeDifferenceMinutes(tOrigM, tDepM);
    if (totalTripMinutes > 0 && leg1Minutes > 0) {
      return Math.max(0.06, Math.min(0.94, leg1Minutes / totalTripMinutes));
    }
    return 0.42;
  }, [isOriginCommuter, tOrigM, tDepM, totalTripMinutes]);

  // Posizione proporzionale di una stazione in cui il treno è eventualmente fermo
  const intermediateStoppedStation = useMemo<{
    name: string;
    proportion: number;
  } | null>(() => {
    if (!liveTrain.isStoppedInStation || !liveTrain.stoppedStationName) {
      return null;
    }
    const stopped = liveTrain.stoppedStationName;
    if (
      isSameStation(stopped, originName) ||
      isSameStation(stopped, departureName) ||
      isSameStation(stopped, arrivalName)
    ) {
      return null;
    }

    const stops: LiveTrainStop[] = liveTrain.stops || [];
    const stopItem = stops.find((s) => isSameStation(s.stationName, stopped));
    if (stopItem?.plannedTime) {
      const tStopM = parseTimeToMinutes(stopItem.plannedTime);
      const diffStop = timeDifferenceMinutes(tOrigM, tStopM);
      if (totalTripMinutes > 0) {
        const rawProp = diffStop / totalTripMinutes;
        // Se la fermata in cui è fermo precede la stazione di salita del pendolare,
        // garantisce che la posizione sia strettamente antecedente a pDep
        const clampedProp = !isOriginCommuter && pDep > 0.08
          ? Math.min(pDep - 0.04, Math.max(0.04, rawProp))
          : Math.max(0.05, Math.min(0.95, rawProp));
        return {
          name: formatStationName(stopped),
          proportion: clampedProp,
        };
      }
    }

    return {
      name: formatStationName(stopped),
      proportion: !liveTrain.isDepartedFromStation
        ? Math.max(0.04, pDep * 0.5)
        : pDep + (1.0 - pDep) * 0.5,
    };
  }, [
    liveTrain.isStoppedInStation,
    liveTrain.stoppedStationName,
    liveTrain.stops,
    liveTrain.isDepartedFromStation,
    originName,
    departureName,
    arrivalName,
    tOrigM,
    totalTripMinutes,
    pDep,
    isOriginCommuter,
  ]);

  // Rileva se il convoglio ha effettivamente iniziato la sua corsa (è partito dall'origine / partenza)
  // Finchè il treno non è partito, ovunque sia posizionata la partenza, il pallino deve restare grigio
  const isTrainDeparted = useMemo(() => {
    if (!isToday) return false;
    if (
      liveTrain.trainStatusType === "cancelled" ||
      liveTrain.statusDescription?.toLowerCase().includes("soppress")
    ) {
      return false;
    }

    if (
      liveTrain.isArrivedAtDestination ||
      liveTrain.trainStatusType === "arrived" ||
      liveTrain.statusDescription?.toLowerCase().includes("arrivato")
    ) {
      return true;
    }

    // ViaggiaTreno non sempre registra la partenza reale delle primissime fermate:
    // se fermate successive all'origine mostrano gia' un passaggio reale, il treno e' in viaggio.
    const stops: LiveTrainStop[] = liveTrain.stops || [];
    const anyStopBeyondOriginReal = stops.slice(1).some((s) => s.isPassed || s.isCurrent || !!s.actualTime);
    if (anyStopBeyondOriginReal) {
      return true;
    }

    // Se l'API dichiara esplicitamente che il convoglio non è ancora partito
    if (liveTrain.isDeparted === false) {
      return false;
    }

    const statusLower = (liveTrain.statusDescription || "").toLowerCase();
    if (
      statusLower.includes("non partito") ||
      liveTrain.trainStatusType === "scheduled"
    ) {
      return false;
    }

    // Se l'origine della corsa coincide con la stazione dell'utente ed il treno non è ancora partito dalla stazione
    if (isOriginCommuter && (!liveTrain.isDepartedFromStation || !liveTrain.isDeparted)) {
      return false;
    }

    const anyStopReal = stops.some((s) => s.isPassed || s.isCurrent || !!s.actualTime);
    if (anyStopReal) {
      return true;
    }
    if (stops.length > 0 && !liveTrain.isDepartedFromStation && !liveTrain.isDeparted) {
      return false;
    }

    // Se è già partito o passato dalla stazione del pendolare
    if (liveTrain.isDepartedFromStation) {
      return true;
    }

    // Se lo stato indica che è in marcia, già passato o fermo lungo la linea
    if (
      statusLower.includes("già passato") ||
      statusLower.includes("in viaggio") ||
      statusLower.includes("in viaggio") ||
      statusLower.includes("fermo a ")
    ) {
      return true;
    }

    return Boolean(liveTrain.isDeparted);
  }, [
    isToday,
    liveTrain.isDeparted,
    liveTrain.isDepartedFromStation,
    liveTrain.isArrivedAtDestination,
    liveTrain.trainStatusType,
    liveTrain.statusDescription,
    liveTrain.stops,
    isOriginCommuter,
  ]);

  // Calcolo continuo e proporzionato della posizione del convoglio (0.0 a 1.0)
  const trainProgress = useMemo(() => {
    if (!isToday || !isTrainDeparted) return 0.0;
    if (
      liveTrain.trainStatusType === "cancelled" ||
      liveTrain.statusDescription?.toLowerCase().includes("soppress")
    ) {
      return 0.0;
    }

    if (
      liveTrain.isArrivedAtDestination ||
      liveTrain.trainStatusType === "arrived" ||
      liveTrain.statusDescription?.toLowerCase().includes("arrivato")
    ) {
      return 1.0;
    }

    if (liveTrain.isStoppedInStation && liveTrain.stoppedStationName) {
      const stopped = liveTrain.stoppedStationName;
      if (isSameStation(stopped, originName)) return 0.0;
      if (isSameStation(stopped, departureName)) return pDep;
      if (isSameStation(stopped, arrivalName)) return 1.0;
      if (intermediateStoppedStation) {
        return intermediateStoppedStation.proportion;
      }
    }

    // Se il convoglio passante è arrivato ed è fermo alla stazione di salita dell'utente:
    if (!isOriginCommuter && !liveTrain.isDepartedFromStation) {
      const depStop = (liveTrain.stops || []).find((s) => isSameStation(s.stationName, departureName));
      const depTimeM = parseTimeToMinutes(liveTrain.departureTimeActual || liveTrain.departureTimePlanned || "00:00");
      const effDepLimit = depTimeM + Math.max(0, liveTrain.delayMinutes || 0);
      let arrAtDepM = 0;
      if (depStop?.actualTime) {
        arrAtDepM = parseTimeToMinutes(depStop.actualTime);
      } else if (depStop?.plannedTime) {
        arrAtDepM = parseTimeToMinutes(depStop.plannedTime) + Math.max(0, liveTrain.delayMinutes || 0);
      }
      const nowM = nowDate.getHours() * 60 + nowDate.getMinutes() + nowDate.getSeconds() / 60;
      if (
        (depStop?.actualTime && !depStop.isPassed) ||
        (arrAtDepM > 0 && nowM >= arrAtDepM && nowM < effDepLimit)
      ) {
        return pDep;
      }
    }

    const nowMins =
      nowDate.getHours() * 60 +
      nowDate.getMinutes() +
      nowDate.getSeconds() / 60;

    // Ritardo più recente realmente rilevato lungo la linea (ultima fermata con passaggio reale)
    const realStops = (liveTrain.stops || []).filter((s) => s.isPassed || s.isCurrent);
    const lastRealDelay = realStops.length > 0 ? realStops[realStops.length - 1].delayMinutes : undefined;
    const delay = Math.max(0, lastRealDelay ?? liveTrain.delayMinutes ?? 0);
    const tOrigEff = tOrigM + delay;
    const tArrEff = tArrM + delay;

    let progress: number;
    const durEff = timeDifferenceMinutes(tOrigEff, tArrEff);
    if (nowMins < tOrigEff) {
      progress = 0.0;
    } else if (nowMins >= tArrEff || durEff <= 0) {
      progress = 1.0;
    } else {
      progress = Math.max(0.0, Math.min(1.0, timeDifferenceMinutes(tOrigEff, nowMins) / durEff));
    }

    // Il convoglio ha già lasciato la stazione di salita: la barra non può stare prima di essa.
    if (!isOriginCommuter && liveTrain.isDepartedFromStation) {
      progress = Math.max(progress, pDep);
    }
    // Finché non risulta arrivato a destinazione non si completa la barra (ritardi non ancora noti)
    return Math.min(progress, 0.97);
  }, [
    isToday,
    isTrainDeparted,
    liveTrain,
    nowDate,
    tOrigM,
    tArrM,
    pDep,
    originName,
    departureName,
    arrivalName,
    intermediateStoppedStation,
    isOriginCommuter,
  ]);

  // Fermate intermedie minori lungo la tratta del convoglio (escluse origine, arrivo e stazione di salita)
  const minorStops = useMemo<{
    name: string;
    proportion: number;
    isPassed: boolean;
    isExtraordinary?: boolean;
  }[]>(() => {
    const stops: LiveTrainStop[] = liveTrain.stops || [];
    if (stops.length === 0 || totalTripMinutes <= 0) return [];

    const result: {
      name: string;
      proportion: number;
      isPassed: boolean;
      isExtraordinary?: boolean;
    }[] = [];

    for (const stop of stops) {
      if (!stop.plannedTime && !stop.actualTime) continue;
      const sName = formatStationName(stop.stationName);

      // Escludi se coincide con l'origine del treno, la stazione di salita o la stazione di discesa
      if (
        isSameStation(sName, originName) ||
        isSameStation(sName, departureName) ||
        isSameStation(sName, arrivalName)
      ) {
        continue;
      }

      const tStopM = parseTimeToMinutes(stop.plannedTime || stop.actualTime || "00:00");
      const diffStop = timeDifferenceMinutes(tOrigM, tStopM);

      // Deve trovarsi strettamente tra l'origine (0%) e la discesa (100%)
      if (diffStop <= 1 || diffStop >= totalTripMinutes - 1) continue;

      const prop = diffStop / totalTripMinutes;

      // Se è troppo vicina graficamente alla stazione di salita dell'utente (entro 3.5%), saltala per evitare sovrapposizioni
      if (!isOriginCommuter && Math.abs(prop - pDep) < 0.035) continue;

      // Evita duplicati o fermate sovrapposte a meno di 2% di distanza
      const alreadyNearby = result.some((r) => Math.abs(r.proportion - prop) < 0.02);
      if (alreadyNearby) continue;

      result.push({
        name: sName,
        proportion: prop,
        isPassed: Boolean(stop.isPassed || (isToday && isTrainDeparted && trainProgress >= prop)),
        isExtraordinary: Boolean(stop.isExtraordinary),
      });
    }

    return result;
  }, [
    liveTrain.stops,
    totalTripMinutes,
    tOrigM,
    originName,
    departureName,
    arrivalName,
    isOriginCommuter,
    pDep,
    isToday,
    isTrainDeparted,
    trainProgress,
  ]);

  // Animazione per lo scorrimento del convoglio con accelerazione hardware nativa (useNativeDriver: true)
  const [progressAnim] = useState(() => new Animated.Value(trainProgress));
  const currentKey = `${liveTrain.trainNumber}_${liveTrain.departureTimePlanned || ""}`;
  const [prevTrainKey, setPrevTrainKey] = useState<string>(currentKey);

  // Se l'utente seleziona un altro treno, posiziona istantaneamente il cursore e la linea
  // alle coordinate del nuovo convoglio prima del paint, azzerando scatti e animazioni a ritroso
  if (currentKey !== prevTrainKey) {
    setPrevTrainKey(currentKey);
    progressAnim.setValue(trainProgress);
  }

  useEffect(() => {
    // Se è il medesimo convoglio in marcia nel tempo reale, anima in modo continuo ed elastico
    Animated.timing(progressAnim, {
      toValue: trainProgress,
      duration: 1000,
      easing: Easing.linear,
      useNativeDriver: true,
    }).start();
  }, [trainProgress, progressAnim]);

  const handleLayout = (e: LayoutChangeEvent) => {
    const width = e.nativeEvent.layout.width;
    if (width > 0 && width !== trackWidth) {
      setTrackWidth(width);
    }
  };

  const delayMinutes = liveTrain.delayMinutes || 0;

  // Rileva se il treno è deviato su percorso alternativo
  const isDiverted = Boolean(
    liveTrain.trainStatusType === "diverted" ||
      liveTrain.statusDescription?.toLowerCase().includes("deviat") ||
      liveTrain.alertMessage?.toLowerCase().includes("deviat") ||
      liveTrain.alertMessage?.toLowerCase().includes("variazione")
  );

  // Determina se il convoglio si trova attualmente alla stazione di salita dell'utente
  const isAtCommuterDepartureStation = useMemo(() => {
    if (!isToday || liveTrain.isDepartedFromStation) return false;

    // 1. Se il treno è fermo esplicitamente in una stazione secondo le API:
    if (liveTrain.isStoppedInStation && liveTrain.stoppedStationName) {
      return isSameStation(liveTrain.stoppedStationName, departureName);
    }

    // 2. Se l'utente parte dall'origine ed il treno è all'origine (fermo, non ancora partito o al binario):
    if (isOriginCommuter) {
      if (liveTrain.isStoppedInStation) return true;
      if (liveTrain.isDeparted === false) return true;
      const nowMins = nowDate.getHours() * 60 + nowDate.getMinutes() + nowDate.getSeconds() / 60;
      const depTimeM = parseTimeToMinutes(liveTrain.departureTimeActual || liveTrain.departureTimePlanned || "00:00");
      const effDepLimit = depTimeM + Math.max(0, liveTrain.delayMinutes || 0);
      if (nowMins < effDepLimit && !liveTrain.isDepartedFromStation) return true;
      return false;
    }

    // 3. Controllo sulle fermate convoglio (stops) per convoglio passante:
    const depStop = (liveTrain.stops || []).find((s) => isSameStation(s.stationName, departureName));
    if (depStop) {
      if (depStop.isCurrent && !depStop.isPassed && !liveTrain.isDepartedFromStation) return true;
      if (depStop.actualTime && !depStop.isPassed && !liveTrain.isDepartedFromStation) {
        return true;
      }
    }

    // 4. Controllo temporale e posizionale rigoroso:
    // Il treno diventa blu SOLO ed ESCLUSIVAMENTE quando è arrivato perfettamente alla stazione
    // (non durante l'avvicinamento) e vi rimane fino alla partenza effettiva
    const nowMins = nowDate.getHours() * 60 + nowDate.getMinutes() + nowDate.getSeconds() / 60;
    const depTimeM = parseTimeToMinutes(liveTrain.departureTimeActual || liveTrain.departureTimePlanned || "00:00");
    const effDepLimit = depTimeM + Math.max(0, liveTrain.delayMinutes || 0);

    let arrAtDepM = 0;
    if (depStop?.actualTime) {
      arrAtDepM = parseTimeToMinutes(depStop.actualTime);
    } else if (depStop?.plannedTime) {
      arrAtDepM = parseTimeToMinutes(depStop.plannedTime) + Math.max(0, liveTrain.delayMinutes || 0);
    }

    // Se l'API indica che l'ultimo rilevamento è in una stazione precedente (es. Tuscolana), non è ancora a Tiburtina
    if (
      liveTrain.lastDetectionStationName &&
      !isSameStation(liveTrain.lastDetectionStationName, departureName) &&
      trainProgress < pDep
    ) {
      return false;
    }

    const hasArrivedAtStation =
      depStop?.isCurrent ||
      Boolean(depStop?.actualTime && !depStop.isPassed) ||
      (arrAtDepM > 0 && nowMins >= arrAtDepM && Math.abs(trainProgress - pDep) <= 0.006);

    const isStillStoppedAtStation =
      !liveTrain.isDepartedFromStation &&
      nowMins < effDepLimit &&
      (pDep === 0 || trainProgress <= pDep + 0.008);

    if (hasArrivedAtStation && isStillStoppedAtStation) {
      return true;
    }

    return false;
  }, [
    isToday,
    liveTrain.isDepartedFromStation,
    liveTrain.isStoppedInStation,
    liveTrain.stoppedStationName,
    liveTrain.isDeparted,
    liveTrain.stops,
    liveTrain.departureTimeActual,
    liveTrain.departureTimePlanned,
    liveTrain.delayMinutes,
    liveTrain.lastDetectionStationName,
    departureName,
    isOriginCommuter,
    trainProgress,
    pDep,
    nowDate,
  ]);

  // Colore della linea: rossa se ritardo rosso (>5m), gialla se ha ritardo, verde se in orario
  const trainLineColor = useMemo(() => {
    if (liveTrain.trainStatusType === "cancelled") return "#ef4444";
    if (delayMinutes > 5) return "#ef4444"; // Ritardo rosso (>5m)
    if (delayMinutes > 0) return "#f59e0b"; // Ritardo giallo (1-5m)
    return "#10b981"; // In orario verde
  }, [liveTrain.trainStatusType, delayMinutes]);

  const trainBorderColor = useMemo(() => {
    if (liveTrain.trainStatusType === "cancelled") return "#f87171";
    if (delayMinutes > 5) return "#f87171";
    if (delayMinutes > 0) return "#fbbf24";
    return "#34d399";
  }, [liveTrain.trainStatusType, delayMinutes]);

  const depPixelX = trackWidth > 0 ? pDep * trackWidth : 0;

  // Calcolo posizione orizzontale callout "Partenza" (sopra il binario, centrata esattamente sul nodo)
  const halfBadge = badgeWidth / 2;
  const clampedDepBadgeX = useMemo(() => {
    if (trackWidth <= 0) return 0;
    return Math.max(
      halfBadge + 4,
      Math.min(trackWidth - halfBadge - 4, depPixelX)
    );
  }, [trackWidth, depPixelX, halfBadge]);

  return (
    <View style={styles.container}>
      {/* SEZIONE SUPERIORE: Callout stazione di salita e dicitura "Deviato" */}
      {(!isOriginCommuter || isDiverted) && trackWidth > 0 && (
        <View style={styles.topCalloutContainer}>
          {!isOriginCommuter && (
            <>
              <View
                style={[
                  styles.boardingCalloutBadge,
                  {
                    left: clampedDepBadgeX,
                    marginLeft: -halfBadge,
                    backgroundColor: contrast.badgeBg,
                    borderColor: contrast.badgeBorder,
                  },
                ]}
                onLayout={(e) => {
                  const w = e.nativeEvent.layout.width;
                  if (w > 0 && Math.abs(w - badgeWidth) > 1) {
                    setBadgeWidth(w);
                  }
                }}
              >
                <View style={[styles.boardingCalloutDot, { backgroundColor: contrast.accent }]} />
                <Text style={styles.boardingCalloutStation}>{departureName}</Text>
              </View>

              {/* Freccia indicatrice puntata esattamente sul centro del cerchio sottostante (depPixelX) */}
              <View
                style={[
                  styles.calloutArrow,
                  {
                    left: depPixelX,
                    marginLeft: -3.5,
                    borderTopColor: contrast.arrow,
                  },
                ]}
              />
            </>
          )}

          {/* Dicitura "Deviato" se il convoglio subisce variazioni di percorso */}
          {isDiverted && (
            <View style={styles.divertedPill}>
              <Ionicons
                name="git-branch-outline"
                size={10}
                color="#f59e0b"
                style={{ marginRight: 3 }}
              />
              <Text style={styles.divertedPillText}>Deviato</Text>
            </View>
          )}
        </View>
      )}

      {/* BINARIO FERROVIARIO PROPORZIONATO */}
      <View style={styles.trackWrapper} onLayout={handleLayout}>
        {/* Binario di fondo */}
        <View style={styles.trackRailBackground} />

        {/* Tratta dell'utente evidenziata se convoglio passante */}
        {!isOriginCommuter && trackWidth > 0 && (
          <View
            style={[
              styles.userCommuteTrackHighlight,
              {
                left: depPixelX,
                width: trackWidth - depPixelX,
                backgroundColor: contrast.trackFill,
                borderColor: contrast.trackBorder,
              },
            ]}
          />
        )}

        {/* Tratta percorsa finora (riempimento animato nativo GPU secondo lo stato ritardo: rosso, giallo o verde) */}
        {trackWidth > 0 && isTrainDeparted && (
          <View style={styles.trackRailActiveContainer}>
            <Animated.View
              style={[
                styles.trackRailActiveFill,
                {
                  backgroundColor: trainLineColor,
                  width: trackWidth,
                  transform: [
                    {
                      translateX: progressAnim.interpolate({
                        inputRange: [0, 1],
                        outputRange: [-trackWidth, 0],
                      }),
                    },
                  ],
                },
              ]}
            />
          </View>
        )}

        {/* Milestone Iniziale (0%) */}
        <View style={[styles.milestoneNode, { left: 0 }]}>
          <View
            style={[
              styles.milestoneDot,
              trainProgress >= 0.02 && isTrainDeparted
                ? {
                    backgroundColor: trainLineColor,
                    borderColor: trainLineColor,
                  }
                : {
                    backgroundColor: "#1e293b",
                    borderColor: "#64748b",
                  },
            ]}
          />
        </View>

        {/* Punti minori delle fermate intermedie del treno lungo la tratta */}
        {trackWidth > 0 &&
          minorStops.map((ms, idx) => {
            const pixelX = ms.proportion * trackWidth;
            const isPassed = isToday && (trainProgress >= ms.proportion || ms.isPassed);
            if (ms.isExtraordinary) {
              return (
                <View
                  key={`extra-stop-${idx}-${ms.name}`}
                  style={[
                    styles.extraordinaryStopDot,
                    {
                      left: pixelX,
                      backgroundColor: isPassed ? "#f59e0b" : "#fbbf24",
                      borderColor: "#ffffff",
                    },
                  ]}
                />
              );
            }
            return (
              <View
                key={`minor-stop-${idx}-${ms.name}`}
                style={[
                  styles.minorStopDot,
                  {
                    left: pixelX,
                    backgroundColor: isPassed ? trainLineColor : "rgba(255, 255, 255, 0.35)",
                    borderColor: isPassed ? trainLineColor : "#0f172a",
                  },
                ]}
              />
            );
          })}

        {/* Milestone Fermata Intermedia (se fermo lungo la tratta) */}
        {intermediateStoppedStation && trackWidth > 0 && (
          <View
            style={[
              styles.milestoneNode,
              {
                left: intermediateStoppedStation.proportion * trackWidth - 5,
              },
            ]}
          >
            <View
              style={[
                styles.milestoneDot,
                {
                  backgroundColor: "#f59e0b",
                  borderColor: "#f59e0b",
                  width: 10,
                  height: 10,
                  borderRadius: 5,
                },
              ]}
            />
          </View>
        )}

        {/* Milestone Stazione di Partenza Pendolare (se convoglio passante, centrato con precisione subpixel a depPixelX) */}
        {!isOriginCommuter && trackWidth > 0 && (
          <View
            style={[
              styles.commuterBoardingNode,
              {
                left: depPixelX,
              },
            ]}
          >
            <View
              style={[
                styles.commuterBoardingDot,
                {
                  borderColor:
                    isTrainDeparted && trainProgress >= pDep ? trainLineColor : contrast.accent,
                },
              ]}
            >
              <View
                style={[
                  styles.commuterBoardingInnerDot,
                  {
                    backgroundColor:
                      isTrainDeparted && trainProgress >= pDep ? trainLineColor : contrast.accent,
                  },
                ]}
              />
            </View>
          </View>
        )}

        {/* Milestone Finale (100%) */}
        <View style={[styles.milestoneNode, { right: 0 }]}>
          <View
            style={[
              styles.milestoneDot,
              trainProgress >= 0.98 && isTrainDeparted
                ? {
                    backgroundColor: trainLineColor,
                    borderColor: trainLineColor,
                  }
                : {
                    backgroundColor: "#1e293b",
                    borderColor: "#64748b",
                  },
            ]}
          />
        </View>

        {/* Cursore / Pallino Animato del Treno (Hardware-accelerated con useNativeDriver: true) */}
        {trackWidth > 0 && (
          <Animated.View
            style={[
              styles.trainCursorContainer,
              {
                transform: [
                  {
                    translateX: progressAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0, trackWidth],
                    }),
                  },
                ],
              },
            ]}
          >
            <View
              style={[
                styles.trainCenterDot,
                !isToday || !isTrainDeparted
                  ? {
                      backgroundColor: "#334155",
                      borderColor: "#64748b",
                    }
                  : isAtCommuterDepartureStation
                  ? {
                      backgroundColor: contrast.solid,
                      borderColor: contrast.accent,
                    }
                  : {
                      backgroundColor: trainLineColor,
                      borderColor: trainBorderColor,
                    },
              ]}
            >
              <Ionicons
                name="train"
                size={8}
                color={!isToday || !isTrainDeparted ? "#cbd5e1" : "#ffffff"}
                style={{ alignSelf: "center" }}
              />
            </View>
          </Animated.View>
        )}
      </View>

      {/* SEZIONE INFERIORE: Didascalie Stazioni ai Due Estremi (0% e 100%)
          Se partenza coincide con origine: badge ad alto contrasto attorno alla stazione */}
      <View style={styles.bottomStationsRow}>
        <View style={styles.stationColLeft}>
          <Text style={styles.stationRoleLabel}>
            {isOriginCommuter ? "Partenza" : "Origine"}
          </Text>
          {isOriginCommuter ? (
            <View
              style={[
                styles.originDepartureBadge,
                {
                  backgroundColor: contrast.badgeBg,
                  borderColor: contrast.badgeBorder,
                },
              ]}
            >
              <View style={[styles.boardingCalloutDot, { backgroundColor: contrast.accent }]} />
              <Text style={styles.originDepartureBadgeText} numberOfLines={2}>
                {departureName}
              </Text>
            </View>
          ) : (
            <Text style={styles.stationNameLabel} numberOfLines={2}>
              {originName}
            </Text>
          )}
        </View>

        <View style={styles.stationColRight}>
          <Text style={styles.stationRoleLabel}>Discesa</Text>
          <Text style={styles.stationNameLabel} numberOfLines={2}>
            {arrivalName}
          </Text>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginTop: 10,
    marginBottom: 6,
    paddingTop: 8,
    paddingBottom: 6,
    paddingHorizontal: 8,
    backgroundColor: "rgba(255, 255, 255, 0.03)",
    borderRadius: CARD_RADIUS.cardInner,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.07)",
  },
  topCalloutContainer: {
    height: 24,
    position: "relative",
    marginHorizontal: 8,
    marginBottom: 2,
  },
  boardingCalloutBadge: {
    position: "absolute",
    top: 0,
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: "rgba(14, 165, 233, 0.16)",
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "rgba(56, 189, 248, 0.4)",
  },
  boardingCalloutDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: "#38bdf8",
    marginRight: 4,
  },
  boardingCalloutStation: {
    fontSize: 10,
    fontWeight: "700",
    color: "#ffffff",
  },
  originDepartureBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(14, 165, 233, 0.16)",
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "rgba(56, 189, 248, 0.4)",
    marginTop: 1,
  },
  originDepartureBadgeText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#ffffff",
  },
  calloutArrow: {
    position: "absolute",
    bottom: 0,
    width: 0,
    height: 0,
    backgroundColor: "transparent",
    borderStyle: "solid",
    borderLeftWidth: 3.5,
    borderRightWidth: 3.5,
    borderTopWidth: 4,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
    borderTopColor: "rgba(56, 189, 248, 0.6)",
  },
  trackWrapper: {
    height: 24,
    justifyContent: "center",
    position: "relative",
    marginHorizontal: 8,
  },
  trackRailBackground: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 4,
    backgroundColor: "rgba(255, 255, 255, 0.12)",
    borderRadius: 2,
  },
  userCommuteTrackHighlight: {
    position: "absolute",
    height: 4,
    borderRadius: 2,
    borderWidth: 0.5,
  },
  trackRailActiveContainer: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 4,
    borderRadius: 2,
    overflow: "hidden",
  },
  trackRailActiveFill: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    height: 4,
    borderRadius: 2,
  },
  milestoneNode: {
    position: "absolute",
    top: 8,
    alignItems: "center",
    justifyContent: "center",
    width: 8,
    height: 8,
  },
  commuterBoardingNode: {
    position: "absolute",
    top: 6,
    width: 12,
    height: 12,
    marginLeft: -6,
    alignItems: "center",
    justifyContent: "center",
  },
  minorStopDot: {
    position: "absolute",
    top: 9.5,
    width: 5,
    height: 5,
    borderRadius: 2.5,
    marginLeft: -2.5,
    borderWidth: 0.5,
    zIndex: 2,
  },
  extraordinaryStopDot: {
    position: "absolute",
    top: 9,
    width: 6,
    height: 6,
    borderRadius: 3,
    marginLeft: -3,
    borderWidth: 1,
    zIndex: 3,
  },
  divertedPill: {
    position: "absolute",
    right: 0,
    top: 0,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(245, 158, 11, 0.15)",
    paddingHorizontal: 6,
    paddingVertical: 2.5,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "rgba(245, 158, 11, 0.35)",
  },
  divertedPillText: {
    fontSize: 10,
    fontWeight: "700",
    color: "#f59e0b",
  },
  milestoneDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    borderWidth: 1.5,
  },
  commuterBoardingDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: "#0f172a",
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  commuterBoardingInnerDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
  },
  trainCursorContainer: {
    position: "absolute",
    top: 4,
    left: 0,
    marginLeft: -8,
    width: 16,
    height: 16,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 10,
  },
  trainCenterDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.3,
    shadowRadius: 2,
    elevation: 3,
  },
  bottomStationsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginTop: 6,
    minHeight: 28,
  },
  stationColLeft: {
    alignItems: "flex-start",
    maxWidth: "48%",
  },
  stationColRight: {
    alignItems: "flex-end",
    maxWidth: "48%",
  },
  stationRoleLabel: {
    fontSize: 9,
    fontWeight: "700",
    color: "#64748b",
    marginBottom: 2,
    letterSpacing: 0.2,
  },
  stationNameLabel: {
    fontSize: 11,
    fontWeight: "600",
    color: "#e2e8f0",
    lineHeight: 14,
  },
});
