import { AppTheme } from "@/constants/theme";
import { DisruptionCategory, DisruptionEvent } from "@/types/disruptions";
import {
  isTrainStrikeImpactingCommuter,
  isWalkDisruptionImpactingCommuter,
} from "@/utils/disruptionsService";
import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  LayoutAnimation,
  Platform,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  UIManager,
  View,
} from "react-native";
import { NativeSheetModal } from "./NativeSheetModal";

if (
  Platform.OS === "android" &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

interface DisruptionsRegistryModalProps {
  visible: boolean;
  onClose: () => void;
  disruptions: DisruptionEvent[];
  loading?: boolean;
  onRefresh?: () => void;
  theme?: AppTheme;
  initialFilter?: "all" | "train" | "walk" | "transit";
  activeStationName?: string;
  highlightEventId?: string | null;
}

type FilterMode = "all" | "train" | "walk" | "transit";

function formatIsoToDisplay(iso: string): string {
  const parts = (iso || "").split("-");
  if (parts.length === 3) {
    return `${parts[2]}/${parts[1]}`;
  }
  return iso;
}

function getCategoryConfig(category: DisruptionCategory): {
  label: string;
  color: string;
  bg: string;
  border: string;
  icon: keyof typeof Ionicons.glyphMap;
} {
  switch (category) {
    case "sciopero_treni":
      return {
        label: "Sciopero Treni",
        color: "#ef4444",
        bg: "rgba(239, 68, 68, 0.12)",
        border: "rgba(239, 68, 68, 0.3)",
        icon: "train",
      };
    case "sciopero_tpl":
      return {
        label: "Sciopero Mezzi TPL",
        color: "#f97316",
        bg: "rgba(249, 115, 22, 0.12)",
        border: "rgba(249, 115, 22, 0.3)",
        icon: "bus",
      };
    case "manifestazione":
      return {
        label: "Manifestazione",
        color: "#38bdf8",
        bg: "rgba(56, 189, 248, 0.12)",
        border: "rgba(56, 189, 248, 0.3)",
        icon: "megaphone",
      };
    case "blocco_stradale":
      return {
        label: "Blocco / Deviazione",
        color: "#f59e0b",
        bg: "rgba(245, 158, 11, 0.12)",
        border: "rgba(245, 158, 11, 0.3)",
        icon: "warning",
      };
    case "cantiere_viabilita":
      return {
        label: "Viabilità",
        color: "#a855f7",
        bg: "rgba(168, 85, 247, 0.12)",
        border: "rgba(168, 85, 247, 0.3)",
        icon: "construct",
      };
    default:
      return {
        label: "Avviso Mobilità",
        color: "#94a3b8",
        bg: "rgba(148, 163, 184, 0.12)",
        border: "rgba(148, 163, 184, 0.3)",
        icon: "information-circle",
      };
  }
}

export const DisruptionsRegistryModal: React.FC<
  DisruptionsRegistryModalProps
> = ({
  visible,
  onClose,
  disruptions,
  loading = false,
  onRefresh,
  theme,
  initialFilter = "all",
  activeStationName,
  highlightEventId,
}) => {
  const [filterMode, setFilterMode] = useState<FilterMode>(initialFilter);
  const [prevFilterProp, setPrevFilterProp] =
    useState<FilterMode>(initialFilter);
  if (prevFilterProp !== initialFilter) {
    setPrevFilterProp(initialFilter);
    setFilterMode(initialFilter);
  }

  const [onlyMyRoute, setOnlyMyRoute] = useState<boolean>(true);
  const flatListRef = useRef<FlatList<DisruptionEvent>>(null);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [prevHighlightProp, setPrevHighlightProp] = useState<
    string | null | undefined
  >(highlightEventId);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const toggleExpand = (id: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  if (visible && highlightEventId && prevHighlightProp !== highlightEventId) {
    setPrevHighlightProp(highlightEventId);
    setHighlightedId(highlightEventId);
    setExpandedIds((prev) => {
      const next = new Set(prev);
      next.add(highlightEventId);
      return next;
    });
    const target = disruptions.find((d) => d.id === highlightEventId);
    if (target) {
      if (target.affectedModes.includes("train") && filterMode === "walk") {
        setFilterMode("train");
      } else if (
        target.affectedModes.includes("walk") &&
        filterMode === "train"
      ) {
        setFilterMode("walk");
      }
    }
  } else if (!visible && prevHighlightProp !== null) {
    setPrevHighlightProp(null);
  }

  const filteredDisruptions = useMemo(() => {
    let list = [...disruptions];

    // Filtro per tratta pendolare
    if (onlyMyRoute) {
      list = list.filter((d) => {
        if (d.category === "sciopero_treni") {
          return isTrainStrikeImpactingCommuter(d);
        }
        return isWalkDisruptionImpactingCommuter(d, activeStationName);
      });
    }

    // Filtro per modalità
    if (filterMode === "train") {
      list = list.filter((d) => d.affectedModes.includes("train"));
    } else if (filterMode === "walk") {
      list = list.filter((d) => d.affectedModes.includes("walk"));
    } else if (filterMode === "transit") {
      list = list.filter((d) => d.affectedModes.includes("transit"));
    }

    return list;
  }, [disruptions, onlyMyRoute, filterMode, activeStationName]);

  // Gestione tocco da card esterna: scroll automatico ed estinzione evidenziazione neon
  useEffect(() => {
    if (visible && highlightEventId) {
      const scrollTimer = setTimeout(() => {
        const idx = filteredDisruptions.findIndex(
          (d) => d.id === highlightEventId,
        );
        if (idx >= 0 && flatListRef.current) {
          flatListRef.current.scrollToIndex({
            index: idx,
            animated: true,
            viewPosition: 0.25,
          });
        }
      }, 420);

      const clearTimer = setTimeout(() => {
        setHighlightedId(null);
      }, 3500);

      return () => {
        clearTimeout(scrollTimer);
        clearTimeout(clearTimer);
      };
    }
  }, [visible, highlightEventId, filteredDisruptions]);

  const renderDisruptionItem = ({ item }: { item: DisruptionEvent }) => {
    const cat = getCategoryConfig(item.category);
    const isTrain = item.category === "sciopero_treni";
    const isTrainImpacting = isTrain
      ? isTrainStrikeImpactingCommuter(item)
      : false;
    const isWalkImpacting = !isTrain
      ? isWalkDisruptionImpactingCommuter(item, activeStationName)
      : false;
    const isHighlighted = item.id === highlightedId;
    const isExpanded = expandedIds.has(item.id);
    const hasNotes = Boolean(item.notes && item.notes !== item.timeWindow);
    const isLongNote = Boolean(
      hasNotes && (item.notes!.length > 80 || item.notes!.includes("\n")),
    );

    return (
      <TouchableOpacity
        activeOpacity={isLongNote ? 0.85 : 1}
        onPress={isLongNote ? () => toggleExpand(item.id) : undefined}
        style={[
          styles.cardContainer,
          isHighlighted && [
            styles.cardHighlighted,
            {
              borderColor: theme?.accent || theme?.primary || "#38bdf8",
              shadowColor: theme?.accent || theme?.primary || "#38bdf8",
            },
          ],
        ]}
      >
        {/* Intestazione Card: Badge Categoria + Data Formattata */}
        <View style={styles.cardHeader}>
          <View
            style={[
              styles.categoryBadge,
              { backgroundColor: cat.bg, borderColor: cat.border },
            ]}
          >
            <Ionicons
              name={cat.icon}
              size={12}
              color={cat.color}
              style={{ marginRight: 4 }}
            />
            <Text style={[styles.categoryBadgeText, { color: cat.color }]}>
              {cat.label}
            </Text>
          </View>

          {item.startDate && item.endDate && item.startDate !== item.endDate ? (
            <View style={styles.dateRangeBadge}>
              <Ionicons
                name="calendar"
                size={11}
                color="#38bdf8"
                style={{ marginRight: 5 }}
              />
              <Text style={styles.dateRangePrefix}>DA </Text>
              <Text style={styles.dateRangeValue}>
                {formatIsoToDisplay(item.startDate)}
              </Text>
              <Ionicons
                name="arrow-forward"
                size={10}
                color="#64748b"
                style={{ marginHorizontal: 4 }}
              />
              <Text style={styles.dateRangePrefix}>A </Text>
              <Text style={styles.dateRangeValue}>
                {formatIsoToDisplay(item.endDate)}
              </Text>
            </View>
          ) : (
            <View style={styles.dateBadge}>
              <Ionicons
                name="calendar-outline"
                size={11}
                color="#94a3b8"
                style={{ marginRight: 4 }}
              />
              <Text style={styles.dateBadgeText}>{item.formattedDateSpan}</Text>
            </View>
          )}
        </View>

        {/* Badge di Impatto Specifico sul Pendolare */}
        {isTrain ? (
          isTrainImpacting ? (
            <View style={styles.impactingBadge}>
              <Ionicons
                name="alert-circle"
                size={12}
                color="#ef4444"
                style={{ marginRight: 5 }}
              />
              <Text style={styles.impactingBadgeText}>
                Impatta la tua tratta (Trenitalia / RFI / IC)
              </Text>
            </View>
          ) : (
            <View style={styles.nonImpactingBadge}>
              <Ionicons
                name="checkmark-circle-outline"
                size={12}
                color="#10b981"
                style={{ marginRight: 5 }}
              />
              <Text style={styles.nonImpactingBadgeText}>
                Non impatta la tua tratta
              </Text>
            </View>
          )
        ) : isWalkImpacting ? (
          <View style={styles.walkImpactingBadge}>
            <Ionicons
              name="warning-outline"
              size={12}
              color="#f59e0b"
              style={{ marginRight: 5 }}
            />
            <Text style={styles.walkImpactingBadgeText}>
              Impatta il tuo tragitto
            </Text>
          </View>
        ) : (
          <View style={styles.nonImpactingBadge}>
            <Ionicons
              name="information-circle-outline"
              size={12}
              color="#94a3b8"
              style={{ marginRight: 5 }}
            />
            <Text style={styles.nonImpactingBadgeText}>
              Non impatta il tuo tragitto
            </Text>
          </View>
        )}

        {/* Titolo Principale */}
        <Text style={styles.cardTitle}>{item.title}</Text>

        {/* Orario / Fascia Oraria */}
        {Boolean(item.timeWindow) && (
          <View style={styles.infoRow}>
            <Ionicons
              name="time-outline"
              size={13}
              color="#f59e0b"
              style={{ marginRight: 6, marginTop: 1 }}
            />
            <Text style={styles.infoRowText}>
              <Text style={styles.infoRowLabel}>Orari / Durata: </Text>
              {item.timeWindow}
            </Text>
          </View>
        )}

        {/* Categorie / Aziende Coinvolte */}
        {Boolean(item.affectedCompanies) && (
          <View style={styles.infoRow}>
            <Ionicons
              name="business-outline"
              size={13}
              color="#38bdf8"
              style={{ marginRight: 6, marginTop: 1 }}
            />
            <Text style={styles.infoRowText}>
              <Text style={styles.infoRowLabel}>Coinvolti: </Text>
              {item.affectedCompanies}
            </Text>
          </View>
        )}

        {/* Aree / Vie Specifiche */}
        {Boolean(item.affectedAreas && item.affectedAreas.length > 0) && (
          <View style={styles.areasRow}>
            <Ionicons
              name="location-outline"
              size={13}
              color="#a855f7"
              style={{ marginRight: 6, marginTop: 1 }}
            />
            <View style={styles.areaPillsContainer}>
              {item.affectedAreas!.map((area, idx) => (
                <View key={idx} style={styles.areaPill}>
                  <Text style={styles.areaPillText}>{area}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Note / Dettagli aggiuntivi */}
        {hasNotes && (
          <View style={styles.notesContainer}>
            <Text
              style={styles.notesText}
              numberOfLines={isExpanded ? undefined : 3}
            >
              {item.notes}
            </Text>

            {isLongNote && (
              <View style={styles.expandActionRow}>
                <Text
                  style={[
                    styles.expandActionText,
                    isExpanded && styles.expandActionTextActive,
                    !isExpanded && theme?.primary
                      ? { color: theme.accent || theme.primary }
                      : null,
                  ]}
                >
                  {isExpanded ? "Mostra meno" : "Leggi tutto"}
                </Text>
                <Ionicons
                  name={isExpanded ? "chevron-up" : "chevron-down"}
                  size={12}
                  color={
                    isExpanded
                      ? "#94a3b8"
                      : theme?.accent || theme?.primary || "#38bdf8"
                  }
                />
              </View>
            )}
          </View>
        )}

        {/* Footer: Fonte Ufficiale */}
        <View style={styles.cardFooter}>
          <Text style={styles.sourceText}>Fonte: {item.sourceName}</Text>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <NativeSheetModal
      visible={visible}
      onClose={onClose}
      title="Scioperi e manifestazioni"
      showCloseButton={true}
    >
      <View style={styles.container}>
        <View style={styles.controlsSection}>
          {/* Filtri Categoria a Pill Arrotondate con Glowing Effect */}
          <View style={styles.filtersRow}>
            <TouchableOpacity
              style={[
                styles.filterPill,
                filterMode === "all" && [
                  styles.filterPillActive,
                  theme?.primary
                    ? {
                        backgroundColor: theme.primary,
                        borderColor: theme.accent || theme.primary,
                        shadowColor: theme.accent || theme.primary,
                      }
                    : null,
                ],
              ]}
              onPress={() => setFilterMode("all")}
              activeOpacity={0.75}
            >
              <Text
                style={[
                  styles.filterPillText,
                  filterMode === "all" && styles.filterPillTextActive,
                ]}
              >
                Tutti ({disruptions.length})
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.filterPill,
                filterMode === "train" && [
                  styles.filterPillActive,
                  theme?.primary
                    ? {
                        backgroundColor: theme.primary,
                        borderColor: theme.accent || theme.primary,
                        shadowColor: theme.accent || theme.primary,
                      }
                    : null,
                ],
              ]}
              onPress={() => setFilterMode("train")}
              activeOpacity={0.75}
            >
              <Ionicons
                name="train"
                size={12}
                color={filterMode === "train" ? "#fff" : "#94a3b8"}
                style={{ marginRight: 5 }}
              />
              <Text
                style={[
                  styles.filterPillText,
                  filterMode === "train" && styles.filterPillTextActive,
                ]}
              >
                Treni
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.filterPill,
                filterMode === "walk" && [
                  styles.filterPillActive,
                  theme?.primary
                    ? {
                        backgroundColor: theme.primary,
                        borderColor: theme.accent || theme.primary,
                        shadowColor: theme.accent || theme.primary,
                      }
                    : null,
                ],
              ]}
              onPress={() => setFilterMode("walk")}
              activeOpacity={0.75}
            >
              <Ionicons
                name="navigate-outline"
                size={12}
                color={filterMode === "walk" ? "#fff" : "#94a3b8"}
                style={{ marginRight: 5 }}
              />
              <Text
                style={[
                  styles.filterPillText,
                  filterMode === "walk" && styles.filterPillTextActive,
                ]}
              >
                Viabilità
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.filterPill,
                filterMode === "transit" && [
                  styles.filterPillActive,
                  theme?.primary
                    ? {
                        backgroundColor: theme.primary,
                        borderColor: theme.accent || theme.primary,
                        shadowColor: theme.accent || theme.primary,
                      }
                    : null,
                ],
              ]}
              onPress={() => setFilterMode("transit")}
              activeOpacity={0.75}
            >
              <Ionicons
                name="bus"
                size={12}
                color={filterMode === "transit" ? "#fff" : "#94a3b8"}
                style={{ marginRight: 5 }}
              />
              <Text
                style={[
                  styles.filterPillText,
                  filterMode === "transit" && styles.filterPillTextActive,
                ]}
              >
                Mezzi
              </Text>
            </TouchableOpacity>
          </View>

          {/* Sottoriga di controllo sobria: contatore e pill toggle pertinenza tratta */}
          <View style={styles.scopeRow}>
            <Text style={styles.scopeCountLabel}>
              {filteredDisruptions.length}{" "}
              {filteredDisruptions.length === 1
                ? "segnalazione"
                : "segnalazioni"}
            </Text>

            <TouchableOpacity
              style={[styles.scopePill, onlyMyRoute && styles.scopePillActive]}
              onPress={() => setOnlyMyRoute(!onlyMyRoute)}
              activeOpacity={0.75}
            >
              <Ionicons
                name={onlyMyRoute ? "shield-checkmark" : "globe-outline"}
                size={12}
                color={
                  onlyMyRoute
                    ? theme?.accent || theme?.primary || "#38bdf8"
                    : "#94a3b8"
                }
                style={{ marginRight: 5 }}
              />
              <Text
                style={[
                  styles.scopePillText,
                  onlyMyRoute && styles.scopePillTextActive,
                ]}
              >
                {onlyMyRoute ? "Sul tuo tragitto" : "Mostra tutto"}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Lista Risultati */}
        {loading && disruptions.length === 0 ? (
          <View style={styles.centerContainer}>
            <ActivityIndicator
              size="large"
              color={theme?.primary || "#38bdf8"}
            />
            <Text style={styles.loadingText}>
              Sincronizzazione scioperi e manifestazioni...
            </Text>
          </View>
        ) : filteredDisruptions.length === 0 ? (
          <View style={styles.centerContainer}>
            <Ionicons
              name="checkmark-circle-outline"
              size={48}
              color="#10b981"
            />
            <Text style={styles.emptyTitle}>
              Nessuna manifestazione o sciopero
            </Text>
            <Text style={styles.emptySubtitle}>
              Al momento non risultano interruzioni o scioperi per i filtri
              selezionati.
            </Text>
          </View>
        ) : (
          <FlatList
            ref={flatListRef}
            data={filteredDisruptions}
            keyExtractor={(item) => item.id}
            renderItem={renderDisruptionItem}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            onScrollToIndexFailed={(info) => {
              setTimeout(() => {
                flatListRef.current?.scrollToOffset({
                  offset: info.averageItemLength * info.index,
                  animated: true,
                });
              }, 100);
            }}
            refreshControl={
              onRefresh ? (
                <RefreshControl
                  refreshing={loading}
                  onRefresh={onRefresh}
                  tintColor={theme?.primary || "#38bdf8"}
                />
              ) : undefined
            }
          />
        )}
      </View>
    </NativeSheetModal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 10,
  },
  controlsSection: {
    marginBottom: 10,
  },
  filtersRow: {
    flexDirection: "row",
    marginBottom: 8,
    gap: 7,
    flexWrap: "wrap",
  },
  scopeRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 2,
    marginBottom: 4,
  },
  scopeCountLabel: {
    fontSize: 11,
    fontWeight: "600",
    color: "#64748b",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  scopePill: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 4.5,
    borderRadius: 14,
    backgroundColor: "rgba(255, 255, 255, 0.05)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
  },
  scopePillActive: {
    backgroundColor: "rgba(2, 132, 199, 0.14)",
    borderColor: "rgba(56, 189, 248, 0.35)",
  },
  scopePillText: {
    fontSize: 11,
    fontWeight: "500",
    color: "#94a3b8",
  },
  scopePillTextActive: {
    color: "#38bdf8",
    fontWeight: "600",
  },
  impactingBadge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: "rgba(239, 68, 68, 0.12)",
    borderWidth: 1,
    borderColor: "rgba(239, 68, 68, 0.28)",
    marginBottom: 8,
  },
  impactingBadgeText: {
    color: "#fca5a5",
    fontSize: 11,
    fontWeight: "600",
  },
  nonImpactingBadge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: "rgba(255, 255, 255, 0.04)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
    marginBottom: 8,
  },
  nonImpactingBadgeText: {
    color: "#94a3b8",
    fontSize: 11,
    fontWeight: "500",
  },
  walkImpactingBadge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: "rgba(245, 158, 11, 0.12)",
    borderWidth: 1,
    borderColor: "rgba(245, 158, 11, 0.28)",
    marginBottom: 8,
  },
  walkImpactingBadgeText: {
    color: "#fcd34d",
    fontSize: 11,
    fontWeight: "600",
  },
  filterPill: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: "rgba(255, 255, 255, 0.05)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
  },
  filterPillActive: {
    backgroundColor: "#0284c7",
    borderColor: "#38bdf8",
    shadowColor: "#38bdf8",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.85,
    shadowRadius: 8,
    elevation: 6,
  },
  filterPillText: {
    color: "#94a3b8",
    fontSize: 12,
    fontWeight: "500",
  },
  filterPillTextActive: {
    color: "#ffffff",
    fontWeight: "700",
  },
  listContent: {
    paddingBottom: 28,
  },
  cardContainer: {
    backgroundColor: "#1c1c1e",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
    padding: 14,
    marginBottom: 10,
  },
  cardHighlighted: {
    borderWidth: 2,
    backgroundColor: "rgba(56, 189, 248, 0.06)",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.95,
    shadowRadius: 12,
    elevation: 8,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  categoryBadge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
  },
  categoryBadgeText: {
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },
  dateBadge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: "rgba(255, 255, 255, 0.04)",
  },
  dateBadgeText: {
    color: "#cbd5e1",
    fontSize: 11,
    fontWeight: "600",
  },
  dateRangeBadge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 7,
    paddingVertical: 2.5,
    borderRadius: 6,
    backgroundColor: "rgba(56, 189, 248, 0.08)",
    borderWidth: 1,
    borderColor: "rgba(56, 189, 248, 0.25)",
  },
  dateRangePrefix: {
    color: "#38bdf8",
    fontSize: 9.5,
    fontWeight: "800",
    letterSpacing: 0.3,
  },
  dateRangeValue: {
    color: "#f1f5f9",
    fontSize: 11,
    fontWeight: "700",
  },
  cardTitle: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "700",
    lineHeight: 20,
    marginBottom: 8,
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 4,
  },
  infoRowLabel: {
    color: "#94a3b8",
    fontWeight: "600",
  },
  infoRowText: {
    color: "#e2e8f0",
    fontSize: 12,
    flex: 1,
    lineHeight: 16,
  },
  areasRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginTop: 4,
    marginBottom: 6,
  },
  areaPillsContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 4,
    flex: 1,
  },
  areaPill: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: "rgba(168, 85, 247, 0.15)",
  },
  areaPillText: {
    color: "#d8b4fe",
    fontSize: 10,
    fontWeight: "600",
  },
  notesContainer: {
    marginTop: 6,
    backgroundColor: "rgba(255, 255, 255, 0.03)",
    borderRadius: 8,
    padding: 9,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.05)",
  },
  notesText: {
    color: "#cbd5e1",
    fontSize: 11.5,
    lineHeight: 17,
  },
  expandActionRow: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    marginTop: 6,
    paddingVertical: 2,
    gap: 3,
  },
  expandActionText: {
    fontSize: 11,
    fontWeight: "600",
    color: "#38bdf8",
  },
  expandActionTextActive: {
    color: "#94a3b8",
    fontWeight: "500",
  },
  cardFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(255, 255, 255, 0.08)",
  },
  sourceText: {
    color: "#64748b",
    fontSize: 10,
  },
  centerContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
    paddingTop: 40,
  },
  loadingText: {
    color: "#94a3b8",
    fontSize: 13,
    marginTop: 12,
  },
  emptyTitle: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "700",
    marginTop: 12,
    marginBottom: 4,
    textAlign: "center",
  },
  emptySubtitle: {
    color: "#94a3b8",
    fontSize: 13,
    textAlign: "center",
    lineHeight: 18,
  },
});
