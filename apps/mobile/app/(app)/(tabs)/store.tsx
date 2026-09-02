import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Alert, Image, Pressable, StyleSheet, Text, View } from "react-native";

import { ScreenState } from "@/components/ScreenState";
import { Badge, Button, Card, EmptyState, Screen, SegmentedControl, TextField } from "@/components/ui";
import { getCoinBalance } from "@/features/coins/api";
import {
  cancelRedemption,
  createStoreItem,
  fulfillRedemption,
  getMyRedemptions,
  getStoreItems,
  getTeamRedemptions,
  redeemStoreItem,
  refundRedemption,
  updateStoreItem,
  type Redemption,
  type RedemptionStatus,
  type StoreItem
} from "@/features/store/api";
import { parseStoreNumbers } from "@/features/store/validation";
import { formatApiError } from "@/lib/api/errors";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { generateClientUuid } from "@/lib/uuid";
import { useTeamContext } from "@/providers/TeamProvider";
import { colors } from "@/theme/colors";
import { spacing, typography } from "@/theme/tokens";

function canRedeemItem(item: StoreItem) {
  return item.is_active && (item.stock === null || item.stock > 0);
}

export default function StoreTabScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const { selectedTeamId, role, home } = useTeamContext();
  const canManageStore = role === "captain" || role === "admin";
  const [items, setItems] = useState<StoreItem[]>([]);
  const [balance, setBalance] = useState<number | null>(null);
  const [myRedemptions, setMyRedemptions] = useState<Redemption[]>([]);
  const [managedRedemptions, setManagedRedemptions] = useState<Redemption[]>([]);
  const [showManage, setShowManage] = useState(false);
  const [itemActiveFilter, setItemActiveFilter] = useState<boolean | null>(true);
  const [myRedemptionStatus, setMyRedemptionStatus] = useState<RedemptionStatus | null>(null);
  const [managedRedemptionStatus, setManagedRedemptionStatus] = useState<RedemptionStatus | null>("pending");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [price, setPrice] = useState("50");
  const [stock, setStock] = useState("10");
  const [message, setMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const refreshStore = useCallback(async () => {
    if (!selectedTeamId) {
      setItems([]);
      setBalance(null);
      return;
    }
    const [nextItems, nextBalance, nextMyRedemptions] = await Promise.all([
      getStoreItems(selectedTeamId, { isActive: canManageStore ? itemActiveFilter : true }),
      getCoinBalance(selectedTeamId).catch(() => null),
      getMyRedemptions(selectedTeamId, { status: myRedemptionStatus })
    ]);
    setItems(nextItems);
    setBalance(nextBalance?.balance ?? home?.coin_summary.balance ?? null);
    setMyRedemptions(nextMyRedemptions);
    if (canManageStore) {
      setManagedRedemptions(await getTeamRedemptions(selectedTeamId, { status: managedRedemptionStatus }));
    } else {
      setManagedRedemptions([]);
    }
  }, [
    selectedTeamId,
    canManageStore,
    itemActiveFilter,
    myRedemptionStatus,
    managedRedemptionStatus,
    home?.coin_summary.balance
  ]);

  async function handleLoad() {
    if (!selectedTeamId) {
      return;
    }
    setIsLoading(true);
    setMessage(null);
    try {
      await refreshStore();
      if (items.length === 0) {
        // refreshed below
      }
    } catch (error) {
      setMessage(formatApiError(error, t));
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    if (!selectedTeamId) {
      return;
    }
    setIsLoading(true);
    setMessage(null);
    void refreshStore()
      .catch((error) => setMessage(formatApiError(error, t)))
      .finally(() => setIsLoading(false));
  }, [selectedTeamId, itemActiveFilter, myRedemptionStatus, managedRedemptionStatus, refreshStore, t]);

  async function handleCreateItem() {
    if (!selectedTeamId || !canManageStore) {
      setMessage(t("store.captainOnlyHint"));
      return;
    }
    const parsedNumbers = parseStoreNumbers(price, stock);
    if (name.trim().length === 0) {
      setMessage(t("store.invalidItemName"));
      return;
    }
    if (parsedNumbers === null) {
      setMessage(t("store.invalidItemNumbers"));
      return;
    }
    setIsLoading(true);
    setMessage(null);
    try {
      await createStoreItem(selectedTeamId, {
        name: name.trim(),
        description: description.trim() || null,
        image_url: imageUrl.trim() || null,
        price: parsedNumbers.price,
        stock: parsedNumbers.stock,
        is_active: true
      });
      setName("");
      setDescription("");
      setImageUrl("");
      setPrice("50");
      setStock("10");
      setMessage(t("store.created"));
      await refreshStore();
    } catch (error) {
      setMessage(formatApiError(error, t));
    } finally {
      setIsLoading(false);
    }
  }

  async function handleRedeem(item: StoreItem) {
    if (!selectedTeamId) {
      return;
    }
    if (!canRedeemItem(item)) {
      setMessage(t("store.unavailable"));
      return;
    }
    if (balance != null && balance < item.price) {
      setMessage(t("store.insufficientBalance"));
      return;
    }
    setIsLoading(true);
    setMessage(null);
    try {
      await redeemStoreItem(selectedTeamId, item.id, 1, generateClientUuid());
      setMessage(t("store.redeemed"));
      await refreshStore();
    } catch (error) {
      setMessage(formatApiError(error, t));
    } finally {
      setIsLoading(false);
    }
  }

  async function handleFulfill(redemption: Redemption) {
    Alert.alert(t("store.fulfillConfirmTitle"), t("store.fulfillConfirmBody"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("store.fulfill"),
        onPress: () => {
          void (async () => {
            setIsLoading(true);
            try {
              await fulfillRedemption(redemption.id);
              setMessage(t("store.fulfilled"));
              await refreshStore();
            } catch (error) {
              setMessage(formatApiError(error, t));
            } finally {
              setIsLoading(false);
            }
          })();
        }
      }
    ]);
  }

  async function handleCancel(redemption: Redemption) {
    Alert.alert(t("store.cancelConfirmTitle"), t("store.cancelConfirmBody"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("store.cancel"),
        style: "destructive",
        onPress: () => {
          void (async () => {
            setIsLoading(true);
            try {
              await cancelRedemption(redemption.id);
              setMessage(t("store.cancelled"));
              await refreshStore();
            } catch (error) {
              setMessage(formatApiError(error, t));
            } finally {
              setIsLoading(false);
            }
          })();
        }
      }
    ]);
  }

  async function handleRefund(redemption: Redemption) {
    Alert.alert(t("store.refundConfirmTitle"), t("store.refundConfirmBody"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("store.refund"),
        style: "destructive",
        onPress: () => {
          void (async () => {
            setIsLoading(true);
            try {
              await refundRedemption(redemption.id);
              setMessage(t("store.refunded"));
              await refreshStore();
            } catch (error) {
              setMessage(formatApiError(error, t));
            } finally {
              setIsLoading(false);
            }
          })();
        }
      }
    ]);
  }

  return (
    <Screen
      title={t("store.title")}
      subtitle={home?.team.name}
      refreshing={isLoading}
      onRefresh={() => void handleLoad()}
      headerRight={
        canManageStore ? (
          <Pressable accessibilityRole="button" onPress={() => setShowManage((value) => !value)}>
            <Text style={styles.manageLink}>{t("store.manage")}</Text>
          </Pressable>
        ) : null
      }
    >
      {!selectedTeamId ? (
        <EmptyState title={t("teams.noTeams")} actionLabel={t("home.openLogin")} onAction={() => router.push("/login")} />
      ) : null}

      <Card style={styles.walletCard}>
        <Text style={styles.walletLabel}>{t("store.walletBalance")}</Text>
        <Text style={styles.walletValue}>{balance != null ? `${balance.toLocaleString()} COINS` : "--"}</Text>
      </Card>

      <Text style={styles.section}>{t("store.hotItems")}</Text>

      {canManageStore ? (
        <SegmentedControl
          value={itemActiveFilter}
          onChange={setItemActiveFilter}
          options={[
            { value: null, label: t("store.allItems") },
            { value: true, label: t("store.active") },
            { value: false, label: t("store.inactive") }
          ]}
        />
      ) : null}

      {showManage && canManageStore ? (
        <Card>
          <Text style={styles.cardTitle}>{t("store.create")}</Text>
          <TextField label={t("store.name")} onChangeText={setName} value={name} />
          <TextField label={t("store.description")} onChangeText={setDescription} value={description} />
          <TextField
            autoCapitalize="none"
            autoCorrect={false}
            label={t("store.imageUrl")}
            onChangeText={setImageUrl}
            value={imageUrl}
          />
          <View style={styles.row}>
            <TextField
              autoCorrect={false}
              keyboardType="number-pad"
              label={t("store.price")}
              onChangeText={setPrice}
              style={styles.flex}
              value={price}
            />
            <TextField
              autoCorrect={false}
              keyboardType="number-pad"
              label={t("store.stock")}
              onChangeText={setStock}
              style={styles.flex}
              value={stock}
            />
          </View>
          <Button disabled={isLoading} label={t("store.create")} onPress={() => void handleCreateItem()} />
        </Card>
      ) : null}

      <ScreenState
        isLoading={isLoading}
        authRequiredLabel={t("common.authRequired")}
        loadingLabel={t("common.loading")}
        message={message}
        onRetry={() => void handleLoad()}
        retryLabel={t("common.retry")}
        signInLabel={t("home.openLogin")}
      />

      <View style={styles.grid}>
        {items.map((item) => {
          const insufficient = balance != null && balance < item.price;
          const unavailable = !canRedeemItem(item) || insufficient;
          return (
            <Card key={item.id} style={styles.itemCard} padded={false}>
              <Pressable
                onPress={() =>
                  router.push({
                    pathname: "/store-items/[storeItemId]",
                    params: { storeItemId: item.id, teamId: selectedTeamId ?? "" }
                  })
                }
              >
                {item.image_url ? (
                  <Image source={{ uri: item.image_url }} style={styles.itemImage} />
                ) : (
                  <View style={styles.itemImagePlaceholder}>
                    <Text style={styles.placeholderText}>{item.name.slice(0, 1)}</Text>
                  </View>
                )}
              </Pressable>
              <View style={styles.itemBody}>
                <Text style={styles.itemName} numberOfLines={2}>
                  {item.name}
                </Text>
                <Text style={styles.price}>{item.price} {t("store.coinUnit")}</Text>
                <Text style={styles.muted}>
                  {item.stock == null ? "∞" : item.stock} · {item.is_active ? t("store.active") : t("store.inactive")}
                </Text>
                <Button
                  label={t("store.redeem")}
                  disabled={isLoading || unavailable}
                  onPress={() => void handleRedeem(item)}
                />
                {canManageStore ? (
                  <Button
                    label={item.is_active ? t("store.deactivate") : t("store.activate")}
                    variant="ghost"
                    disabled={isLoading}
                    onPress={() => {
                      void (async () => {
                        setIsLoading(true);
                        try {
                          await updateStoreItem(item.id, { is_active: !item.is_active });
                          await refreshStore();
                          setMessage(t("store.updated"));
                        } catch (error) {
                          setMessage(formatApiError(error, t));
                        } finally {
                          setIsLoading(false);
                        }
                      })();
                    }}
                  />
                ) : null}
              </View>
            </Card>
          );
        })}
      </View>

      <Text style={styles.section}>{t("store.myRedemptions")}</Text>
      <SegmentedControl
        value={myRedemptionStatus}
        onChange={setMyRedemptionStatus}
        options={[
          { value: null, label: t("store.allRedemptionStatuses") },
          { value: "pending", label: t("store.status.pending") },
          { value: "fulfilled", label: t("store.status.fulfilled") }
        ]}
      />
      {myRedemptions.length === 0 ? <Text style={styles.muted}>{t("store.noRedemptions")}</Text> : null}
      {myRedemptions.map((redemption) => (
        <Card key={redemption.id}>
          <Badge label={t(`store.status.${redemption.status}`)} />
          <Text style={styles.cardTitle}>
            {items.find((item) => item.id === redemption.store_item_id)?.name ?? redemption.store_item_id}
          </Text>
          <Text style={styles.muted}>
            x{redemption.quantity} · {redemption.total_price}
          </Text>
        </Card>
      ))}

      {canManageStore ? (
        <>
          <Text style={styles.section}>{t("store.manageRedemptions")}</Text>
          <SegmentedControl
            value={managedRedemptionStatus}
            onChange={setManagedRedemptionStatus}
            options={[
              { value: null, label: t("store.allRedemptionStatuses") },
              { value: "pending", label: t("store.status.pending") },
              { value: "fulfilled", label: t("store.status.fulfilled") }
            ]}
          />
          {managedRedemptions.map((redemption) => (
            <Card key={redemption.id}>
              <Badge label={t(`store.status.${redemption.status}`)} tone="gold" />
              <Text style={styles.cardTitle}>
                {redemption.user?.name ?? redemption.user_id} · {redemption.total_price}
              </Text>
              <View style={styles.row}>
                {redemption.status === "pending" ? (
                  <>
                    <Button label={t("store.fulfill")} style={styles.flex} onPress={() => void handleFulfill(redemption)} />
                    <Button
                      label={t("store.cancel")}
                      variant="danger"
                      style={styles.flex}
                      onPress={() => void handleCancel(redemption)}
                    />
                  </>
                ) : null}
                {redemption.status === "fulfilled" ? (
                  <Button label={t("store.refund")} variant="danger" onPress={() => void handleRefund(redemption)} />
                ) : null}
              </View>
            </Card>
          ))}
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  manageLink: {
    color: colors.accentSoft,
    fontWeight: "700"
  },
  walletCard: {
    backgroundColor: "#14532D",
    borderColor: colors.accent
  },
  walletLabel: {
    color: "rgba(255,255,255,0.8)",
    ...typography.caption
  },
  walletValue: {
    color: colors.white,
    fontSize: 32,
    fontWeight: "800"
  },
  section: {
    color: colors.text,
    ...typography.section
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md
  },
  itemCard: {
    width: "47%",
    flexGrow: 1
  },
  itemImage: {
    backgroundColor: colors.surfaceMuted,
    height: 110,
    width: "100%"
  },
  itemImagePlaceholder: {
    alignItems: "center",
    backgroundColor: colors.surfaceMuted,
    height: 110,
    justifyContent: "center"
  },
  placeholderText: {
    color: colors.accentSoft,
    fontSize: 28,
    fontWeight: "800"
  },
  itemBody: {
    gap: spacing.sm,
    padding: spacing.md
  },
  itemName: {
    color: colors.text,
    ...typography.bodyStrong
  },
  price: {
    color: colors.gold,
    fontWeight: "800"
  },
  muted: {
    color: colors.muted,
    ...typography.caption
  },
  cardTitle: {
    color: colors.text,
    ...typography.section
  },
  row: {
    flexDirection: "row",
    gap: spacing.sm
  },
  flex: {
    flex: 1
  }
});
