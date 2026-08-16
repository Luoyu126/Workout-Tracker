import { Link, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { ScreenState } from "@/components/ScreenState";
import { getStoreItem, redeemStoreItem, type StoreItem } from "@/features/store/api";
import { parseRedemptionQuantity } from "@/features/store/validation";
import { formatApiError } from "@/lib/api/errors";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { generateClientUuid } from "@/lib/uuid";
import { colors } from "@/theme/colors";

function canRedeemItem(item: StoreItem) {
  return item.is_active && (item.stock === null || item.stock > 0);
}

type PendingRedemptionRequest = {
  id: string;
  teamId: string;
  storeItemId: string;
  quantity: number;
};

export default function StoreItemDetailScreen() {
  const { storeItemId, teamId } = useLocalSearchParams<{ storeItemId: string; teamId?: string }>();
  const { t } = useI18n();
  const [item, setItem] = useState<StoreItem | null>(null);
  const [quantity, setQuantity] = useState("1");
  const [pendingRedemption, setPendingRedemption] = useState<PendingRedemptionRequest | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  async function handleLoadItem() {
    if (!storeItemId) {
      return;
    }
    setIsLoading(true);
    setMessage(null);
    try {
      setItem(await getStoreItem(storeItemId));
    } catch (error) {
      setMessage(formatApiError(error, t));
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    if (storeItemId) {
      void handleLoadItem();
    }
  }, [storeItemId]);

  async function handleRedeem() {
    if (!item) {
      return;
    }
    if (!canRedeemItem(item)) {
      setMessage(t("store.unavailable"));
      return;
    }
    const scopedTeamId = typeof teamId === "string" && teamId.trim().length > 0 ? teamId : item.team_id;
    const parsedQuantity = parseRedemptionQuantity(quantity);
    if (parsedQuantity === null) {
      setMessage(t("store.invalidQuantity"));
      return;
    }
    const nextRedemption =
      pendingRedemption?.teamId === scopedTeamId &&
      pendingRedemption.storeItemId === item.id &&
      pendingRedemption.quantity === parsedQuantity
        ? pendingRedemption
        : {
            id: generateClientUuid(),
            teamId: scopedTeamId,
            storeItemId: item.id,
            quantity: parsedQuantity
          };
    setIsLoading(true);
    setMessage(null);
    setPendingRedemption(nextRedemption);
    try {
      await redeemStoreItem(scopedTeamId, item.id, parsedQuantity, nextRedemption.id);
      await handleLoadItem();
      setPendingRedemption(null);
      setMessage(t("store.redeemed"));
    } catch (error) {
      setMessage(formatApiError(error, t));
    } finally {
      setIsLoading(false);
    }
  }

  const scopedTeamId = item?.team_id ?? (typeof teamId === "string" && teamId.trim().length > 0 ? teamId : null);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>{t("store.detail")}</Text>
      <Pressable
        accessibilityRole="button"
        disabled={isLoading}
        onPress={handleLoadItem}
        style={[styles.button, isLoading && styles.disabled]}
      >
        <Text style={styles.buttonText}>{t("store.load")}</Text>
      </Pressable>
      <ScreenState
        isLoading={isLoading}
        authRequiredLabel={t("common.authRequired")}
        loadingLabel={t("common.loading")}
        message={message}
        onRetry={handleLoadItem}
        retryLabel={t("common.retry")}
        signInLabel={t("home.openLogin")}
      />
      {item ? (
        <View style={styles.card}>
          {item.image_url ? <Image source={{ uri: item.image_url }} style={styles.itemImage} /> : null}
          <Text style={styles.cardTitle}>{item.name}</Text>
          <Text style={styles.muted}>{item.description ?? t("store.noDescription")}</Text>
          {item.image_url ? <Text style={styles.muted}>{item.image_url}</Text> : null}
          <Text style={styles.muted}>
            {t("store.price")}: {item.price}
          </Text>
          <Text style={styles.muted}>
            {t("store.stock")}: {item.stock ?? "∞"}
          </Text>
          <Text style={styles.muted}>{item.is_active ? t("store.active") : t("store.inactive")}</Text>
          {canRedeemItem(item) ? (
            <>
              <TextInput
                autoCorrect={false}
                keyboardType="number-pad"
                onChangeText={setQuantity}
                placeholder={t("store.quantity")}
                placeholderTextColor={colors.muted}
                style={styles.input}
                value={quantity}
              />
              <Pressable
                accessibilityRole="button"
                disabled={isLoading}
                onPress={handleRedeem}
                style={[styles.secondaryButton, isLoading && styles.disabled]}
              >
                <Text style={styles.secondaryText}>{t("store.redeem")}</Text>
              </Pressable>
            </>
          ) : (
            <Text style={styles.muted}>{t("store.unavailable")}</Text>
          )}
          {scopedTeamId ? (
            <View style={styles.grid}>
              <Link href={{ pathname: "/teams/[teamId]/store", params: { teamId: scopedTeamId } }} asChild>
                <Pressable accessibilityRole="button" style={styles.smallButton}>
                  <Text style={styles.secondaryText}>{t("store.title")}</Text>
                </Pressable>
              </Link>
              <Link href={{ pathname: "/teams/[teamId]/coins", params: { teamId: scopedTeamId } }} asChild>
                <Pressable accessibilityRole="button" style={styles.smallButton}>
                  <Text style={styles.secondaryText}>{t("coins.title")}</Text>
                </Pressable>
              </Link>
            </View>
          ) : null}
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 14,
    padding: 20,
    paddingTop: 72
  },
  title: {
    color: colors.text,
    fontSize: 30,
    fontWeight: "800",
    marginBottom: 10
  },
  button: {
    alignItems: "center",
    backgroundColor: colors.accent,
    borderRadius: 8,
    minHeight: 52,
    justifyContent: "center"
  },
  buttonText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "800"
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    gap: 8,
    padding: 16
  },
  cardTitle: {
    color: colors.text,
    fontSize: 20,
    fontWeight: "800"
  },
  itemImage: {
    backgroundColor: colors.background,
    borderRadius: 8,
    height: 220,
    width: "100%"
  },
  muted: {
    color: colors.muted,
    fontSize: 14
  },
  input: {
    backgroundColor: colors.background,
    borderRadius: 8,
    color: colors.text,
    fontSize: 16,
    minHeight: 48,
    paddingHorizontal: 14
  },
  secondaryButton: {
    alignItems: "center",
    backgroundColor: colors.background,
    borderRadius: 8,
    minHeight: 44,
    justifyContent: "center",
    marginTop: 4
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 4
  },
  smallButton: {
    alignItems: "center",
    backgroundColor: colors.background,
    borderRadius: 8,
    minHeight: 44,
    justifyContent: "center",
    minWidth: "48%",
    paddingHorizontal: 10
  },
  secondaryText: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "700"
  },
  disabled: {
    opacity: 0.7
  }
});
