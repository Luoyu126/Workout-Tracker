import { useEffect, useState } from "react";
import { FlatList, Modal, Pressable, StyleSheet, Text, View } from "react-native";

import { beijingIso, beijingParts, dateLabel, daysInMonth, halfHourOptions, timeLabel, type BeijingParts } from "@/lib/datetime/beijing";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { colors } from "@/theme/colors";

const years = Array.from({ length: 9999 }, (_, index) => index + 1);
const months = Array.from({ length: 12 }, (_, index) => index + 1);
const rowHeight = 44;

type Props = { label: string; value: string; onChange: (value: string) => void; disabled?: boolean };

function Options({ label, values, selected, onSelect, labels }: {
  label: string; values: number[]; selected: number; onSelect: (value: number) => void; labels?: string[];
}) {
  return (
    <View style={styles.column}>
      <Text style={styles.label}>{label}</Text>
      <FlatList
        accessibilityLabel={label}
        style={styles.options}
        data={values}
        extraData={selected}
        initialScrollIndex={Math.max(0, values.findIndex((value) => value >= selected) - 2)}
        getItemLayout={(_, index) => ({ length: rowHeight, offset: rowHeight * index, index })}
        keyExtractor={(value) => String(value)}
        renderItem={({ item, index }) => (
          <Pressable accessibilityRole="radio" accessibilityState={{ checked: item === selected }}
            onPress={() => onSelect(item)} style={[styles.option, item === selected && styles.selected]}>
            <Text style={styles.text}>{labels?.[index] ?? String(item).padStart(2, "0")}</Text>
          </Pressable>
        )}
      />
    </View>
  );
}

export function DateTimeField({ label, value, onChange, disabled = false }: Props) {
  const { t } = useI18n();
  const [parts, setParts] = useState(() => beijingParts(value));
  const [hasDate, setHasDate] = useState(Boolean(value));
  const [hasTime, setHasTime] = useState(Boolean(value));
  const [mode, setMode] = useState<"date" | "time" | null>(null);
  const [draft, setDraft] = useState<BeijingParts | null>(null);
  useEffect(() => {
    setParts(beijingParts(value));
    setHasDate(Boolean(value));
    setHasTime(Boolean(value));
  }, [value]);

  function open(nextMode: "date" | "time") {
    const next = parts ?? beijingParts(new Date().toISOString());
    if (!next) return;
    setDraft(nextMode === "time" && !hasTime ? { ...next, minute: next.minute < 30 ? 0 : 30, second: 0, millisecond: 0 } : next);
    setMode(nextMode);
  }
  function confirm() {
    if (!draft || !mode) return;
    const nextDate = hasDate || mode === "date";
    const nextTime = hasTime || mode === "time";
    setParts(draft);
    setHasDate(nextDate);
    setHasTime(nextTime);
    setMode(null);
    if (nextDate && nextTime) onChange(beijingIso(draft));
  }
  function changeCalendar(year: number, month: number, day: number) {
    if (draft) setDraft({ ...draft, year, month, day: Math.min(day, daysInMonth(year, month)) });
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label} · {t("dateTime.beijing")}</Text>
      <View style={styles.row}>
        <Pressable accessibilityRole="button" accessibilityLabel={`${label} ${t("dateTime.date")}`}
          disabled={disabled} style={[styles.field, disabled && styles.disabled]} onPress={() => open("date")}>
          <Text style={styles.text}>{hasDate && parts ? dateLabel(parts) : t("dateTime.selectDate")}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={`${label} ${t("dateTime.time")}`}
          disabled={disabled} style={[styles.field, disabled && styles.disabled]} onPress={() => open("time")}>
          <Text style={styles.text}>{hasTime && parts ? timeLabel(parts) : t("dateTime.selectTime")}</Text>
        </Pressable>
        {hasDate || hasTime ? (
          <Pressable accessibilityRole="button" accessibilityLabel={`${label} ${t("dateTime.clear")}`} disabled={disabled}
            style={styles.clear} onPress={() => { setParts(null); setHasDate(false); setHasTime(false); onChange(""); }}>
            <Text style={styles.label}>{t("dateTime.clear")}</Text>
          </Pressable>
        ) : null}
      </View>
      <Modal visible={mode !== null} transparent animationType="slide" onRequestClose={() => setMode(null)}>
        <View style={styles.overlay}>
          <View style={styles.sheet} accessibilityViewIsModal>
            <Text style={styles.title}>{label} · {t(mode === "date" ? "dateTime.date" : "dateTime.time")}</Text>
            <Text style={styles.label}>{t("dateTime.scrollHint")}</Text>
            {draft && mode === "date" ? (
              <View style={styles.row}>
                <Options label={t("dateTime.year")} values={years} selected={draft.year}
                  onSelect={(year) => changeCalendar(year, draft.month, draft.day)} />
                <Options label={t("dateTime.month")} values={months} selected={draft.month}
                  onSelect={(month) => changeCalendar(draft.year, month, draft.day)} />
                <Options key={`${draft.year}-${draft.month}`} label={t("dateTime.day")}
                  values={Array.from({ length: daysInMonth(draft.year, draft.month) }, (_, index) => index + 1)} selected={draft.day}
                  onSelect={(day) => changeCalendar(draft.year, draft.month, day)} />
              </View>
            ) : draft && mode === "time" ? (
              <View style={styles.row}><Options label={t("dateTime.time")} values={halfHourOptions.map((_, index) => index)}
                labels={halfHourOptions.map((option) => option.label)} selected={draft.hour * 2 + draft.minute / 30}
                onSelect={(index) => setDraft({ ...draft, hour: halfHourOptions[index].hour, minute: halfHourOptions[index].minute, second: 0, millisecond: 0 })} /></View>
            ) : null}
            <View style={styles.row}>
              <Pressable accessibilityRole="button" style={styles.field} onPress={() => setMode(null)}>
                <Text style={styles.text}>{t("common.cancel")}</Text>
              </Pressable>
              <Pressable accessibilityRole="button" disabled={disabled} style={[styles.field, styles.selected]} onPress={confirm}>
                <Text style={styles.text}>{t("dateTime.confirm")}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 }, row: { flexDirection: "row", gap: 8 },
  label: { color: colors.muted, fontSize: 13 }, text: { color: colors.text, fontSize: 16 },
  title: { color: colors.text, fontSize: 18, fontWeight: "700" },
  field: { flex: 1, minHeight: 48, padding: 12, borderRadius: 12, backgroundColor: colors.surfaceElevated, alignItems: "center", justifyContent: "center" },
  clear: { minHeight: 48, paddingHorizontal: 4, justifyContent: "center" },
  column: { flexShrink: 1, flexGrow: 1, flexBasis: 0, gap: 6 },
  options: { height: 220, flexGrow: 0 }, option: { height: rowHeight, alignItems: "center", justifyContent: "center", borderRadius: 8 },
  selected: { backgroundColor: colors.accentMuted, borderColor: colors.accent, borderWidth: 1 },
  overlay: { flex: 1, justifyContent: "center", backgroundColor: colors.overlay, padding: 16 },
  sheet: { width: "100%", maxWidth: 480, alignSelf: "center", backgroundColor: colors.surface, padding: 16, borderRadius: 16, gap: 16 },
  disabled: { opacity: 0.5 }
});
