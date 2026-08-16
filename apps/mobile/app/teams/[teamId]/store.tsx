import { Link, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { ScreenState } from "@/components/ScreenState";
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
import { parseRedemptionQuantity, parseStoreNumbers } from "@/features/store/validation";
import { getTeamHome, type MembershipRole } from "@/features/teams/api";
import { formatApiError } from "@/lib/api/errors";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { generateClientUuid } from "@/lib/uuid";
import { colors } from "@/theme/colors";

const itemActiveFilters: Array<boolean | null> = [null, true, false];
const redemptionStatuses: Array<RedemptionStatus | null> = [null, "pending", "fulfilled", "cancelled", "refunded"];

type ItemDraft = {
  name: string;
  description: string;
  imageUrl: string;
  price: string;
  stock: string;
};

type PendingRedemptionRequest = {
  id: string;
  quantity: number;
};

function normalizeOptionalImageUrl(value: string) {
  const normalizedValue = value.trim();
  return normalizedValue.length > 0 ? normalizedValue : null;
}

function draftFromItem(item: StoreItem): ItemDraft {
  return {
    name: item.name,
    description: item.description ?? "",
    imageUrl: item.image_url ?? "",
    price: item.price.toString(),
    stock: item.stock?.toString() ?? ""
  };
}

function canRedeemItem(item: StoreItem) {
  return item.is_active && (item.stock === null || item.stock > 0);
}

function resetCreateItemForm() {
  return {
    name: "",
    description: "",
    imageUrl: "",
    price: "50",
    stock: "10"
  };
}

export default function TeamStoreScreen() {
  const { teamId } = useLocalSearchParams<{ teamId: string }>();
  const { t } = useI18n();
  const [items, setItems] = useState<StoreItem[]>([]);
  const [myRedemptions, setMyRedemptions] = useState<Redemption[]>([]);
  const [managedRedemptions, setManagedRedemptions] = useState<Redemption[]>([]);
  const [itemActiveFilter, setItemActiveFilter] = useState<boolean | null>(null);
  const [myRedemptionStatus, setMyRedemptionStatus] = useState<RedemptionStatus | null>(null);
  const [managedRedemptionStatus, setManagedRedemptionStatus] = useState<RedemptionStatus | null>("pending");
  const [name, setName] = useState(resetCreateItemForm().name);
  const [description, setDescription] = useState(resetCreateItemForm().description);
  const [imageUrl, setImageUrl] = useState(resetCreateItemForm().imageUrl);
  const [price, setPrice] = useState(resetCreateItemForm().price);
  const [stock, setStock] = useState(resetCreateItemForm().stock);
  const [redemptionQuantities, setRedemptionQuantities] = useState<Record<string, string>>({});
  const [pendingRedemptions, setPendingRedemptions] = useState<Record<string, PendingRedemptionRequest>>({});
  const [itemDrafts, setItemDrafts] = useState<Record<string, ItemDraft>>({});
  const [currentRole, setCurrentRole] = useState<MembershipRole | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const canManageStore = currentRole === "captain" || currentRole === "admin";

  function applyItems(nextItems: StoreItem[]) {
    setItems(nextItems);
    setItemDrafts(Object.fromEntries(nextItems.map((item) => [item.id, draftFromItem(item)])));
  }

  function applyUpdatedItem(updatedItem: StoreItem) {
    setItems((currentItems) =>
      currentItems.map((currentItem) => (currentItem.id === updatedItem.id ? updatedItem : currentItem))
    );
    setItemDrafts((currentDrafts) => ({
      ...currentDrafts,
      [updatedItem.id]: draftFromItem(updatedItem)
    }));
  }

  async function refreshStoreData() {
    if (!teamId) {
      return;
    }
    const [teamHome, nextMyRedemptions] = await Promise.all([
      getTeamHome(teamId),
      getMyRedemptions(teamId, { status: myRedemptionStatus })
    ]);
    const nextRole = teamHome.current_membership.role;
    const canManageWithNextRole = nextRole === "captain" || nextRole === "admin";
    const nextItems = await getStoreItems(teamId, { isActive: canManageWithNextRole ? itemActiveFilter : true });
    setCurrentRole(nextRole);
    applyItems(nextItems);
    setMyRedemptions(nextMyRedemptions);
    if (canManageWithNextRole) {
      setManagedRedemptions(await getTeamRedemptions(teamId, { status: managedRedemptionStatus }));
    } else {
      setManagedRedemptions([]);
    }
    return nextItems;
  }

  async function handleLoadItems() {
    if (!teamId) {
      return;
    }
    setIsLoading(true);
    setMessage(null);
    try {
      const nextItems = await refreshStoreData();
      if (nextItems?.length === 0) {
        setMessage(t("store.noItems"));
      }
    } catch (error) {
      setMessage(formatApiError(error, t));
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    if (teamId) {
      void handleLoadItems();
    }
  }, [teamId, itemActiveFilter, myRedemptionStatus, managedRedemptionStatus]);

  async function handleCreateItem() {
    if (!teamId) {
      return;
    }
    if (!canManageStore) {
      setMessage(t("store.captainOnlyHint"));
      return;
    }
    const parsedNumbers = parseStoreNumbers(price, stock);
    const trimmedName = name.trim();
    if (trimmedName.length === 0) {
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
      await createStoreItem(teamId, {
        name: trimmedName,
        description: description.trim().length > 0 ? description.trim() : null,
        image_url: normalizeOptionalImageUrl(imageUrl),
        price: parsedNumbers.price,
        stock: parsedNumbers.stock,
        is_active: true
      });
      await refreshStoreData();
      const emptyForm = resetCreateItemForm();
      setName(emptyForm.name);
      setDescription(emptyForm.description);
      setImageUrl(emptyForm.imageUrl);
      setPrice(emptyForm.price);
      setStock(emptyForm.stock);
      setMessage(t("store.created"));
    } catch (error) {
      setMessage(formatApiError(error, t));
    } finally {
      setIsLoading(false);
    }
  }

  async function handleToggleItem(item: StoreItem) {
    if (!canManageStore) {
      setMessage(t("store.captainOnlyHint"));
      return;
    }
    setIsLoading(true);
    setMessage(null);
    try {
      const updatedItem = await updateStoreItem(item.id, { is_active: !item.is_active });
      applyUpdatedItem(updatedItem);
      await refreshStoreData();
      setMessage(t("store.updated"));
    } catch (error) {
      setMessage(formatApiError(error, t));
    } finally {
      setIsLoading(false);
    }
  }

  async function handleRestock(item: StoreItem) {
    if (!canManageStore) {
      setMessage(t("store.captainOnlyHint"));
      return;
    }
    if (item.stock === null) {
      setMessage(t("store.unlimitedStock"));
      return;
    }
    setIsLoading(true);
    setMessage(null);
    try {
      const updatedItem = await updateStoreItem(item.id, { stock: item.stock + 1 });
      applyUpdatedItem(updatedItem);
      await refreshStoreData();
      setMessage(t("store.updated"));
    } catch (error) {
      setMessage(formatApiError(error, t));
    } finally {
      setIsLoading(false);
    }
  }

  async function handleUpdateItemProfile(item: StoreItem) {
    if (!canManageStore) {
      setMessage(t("store.captainOnlyHint"));
      return;
    }
    const draft = itemDrafts[item.id] ?? draftFromItem(item);
    const parsedNumbers = parseStoreNumbers(draft.price, draft.stock);
    const trimmedName = draft.name.trim();
    if (trimmedName.length === 0) {
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
      const updatedItem = await updateStoreItem(item.id, {
        name: trimmedName,
        description: draft.description.trim().length > 0 ? draft.description.trim() : null,
        image_url: normalizeOptionalImageUrl(draft.imageUrl),
        price: parsedNumbers.price,
        stock: parsedNumbers.stock
      });
      applyUpdatedItem(updatedItem);
      await refreshStoreData();
      setMessage(t("store.updated"));
    } catch (error) {
      setMessage(formatApiError(error, t));
    } finally {
      setIsLoading(false);
    }
  }

  async function handleRedeem(item: StoreItem) {
    if (!teamId) {
      return;
    }
    if (!canRedeemItem(item)) {
      setMessage(t("store.unavailable"));
      return;
    }
    const quantity = parseRedemptionQuantity(redemptionQuantities[item.id] ?? "1");
    if (quantity === null) {
      setMessage(t("store.invalidQuantity"));
      return;
    }
    const nextRedemption =
      pendingRedemptions[item.id]?.quantity === quantity
        ? pendingRedemptions[item.id]
        : {
            id: generateClientUuid(),
            quantity
          };
    setIsLoading(true);
    setMessage(null);
    setPendingRedemptions((currentRedemptions) => ({
      ...currentRedemptions,
      [item.id]: nextRedemption
    }));
    try {
      await redeemStoreItem(teamId, item.id, quantity, nextRedemption.id);
      await refreshStoreData();
      setPendingRedemptions((currentRedemptions) => {
        const { [item.id]: _completedRedemption, ...remainingRedemptions } = currentRedemptions;
        return remainingRedemptions;
      });
      setMessage(t("store.redeemed"));
    } catch (error) {
      setMessage(formatApiError(error, t));
    } finally {
      setIsLoading(false);
    }
  }

  async function performFulfill(redemption: Redemption) {
    if (!teamId) {
      return;
    }
    if (!canManageStore) {
      setMessage(t("store.captainOnlyHint"));
      return;
    }
    if (redemption.status !== "pending") {
      setMessage(t("store.redemptionReadonly"));
      return;
    }
    setIsLoading(true);
    setMessage(null);
    try {
      await fulfillRedemption(redemption.id);
      await refreshStoreData();
      setMessage(t("store.fulfilled"));
    } catch (error) {
      setMessage(formatApiError(error, t));
    } finally {
      setIsLoading(false);
    }
  }

  async function handleFulfill(redemption: Redemption) {
    if (!teamId) {
      return;
    }
    if (!canManageStore) {
      setMessage(t("store.captainOnlyHint"));
      return;
    }
    if (redemption.status !== "pending") {
      setMessage(t("store.redemptionReadonly"));
      return;
    }
    Alert.alert(t("store.fulfillConfirmTitle"), t("store.fulfillConfirmBody"), [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("store.fulfill"), onPress: () => void performFulfill(redemption) }
    ]);
  }

  async function performRefund(redemption: Redemption) {
    if (!teamId) {
      return;
    }
    if (!canManageStore) {
      setMessage(t("store.captainOnlyHint"));
      return;
    }
    if (redemption.status !== "fulfilled") {
      setMessage(t("store.redemptionReadonly"));
      return;
    }
    setIsLoading(true);
    setMessage(null);
    try {
      await refundRedemption(redemption.id);
      await refreshStoreData();
      setMessage(t("store.refunded"));
    } catch (error) {
      setMessage(formatApiError(error, t));
    } finally {
      setIsLoading(false);
    }
  }

  async function handleRefund(redemption: Redemption) {
    if (!canManageStore) {
      setMessage(t("store.captainOnlyHint"));
      return;
    }
    if (redemption.status !== "fulfilled") {
      setMessage(t("store.redemptionReadonly"));
      return;
    }
    Alert.alert(t("store.refundConfirmTitle"), t("store.refundConfirmBody"), [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("store.refund"), style: "destructive", onPress: () => void performRefund(redemption) }
    ]);
  }

  async function performCancel(redemption: Redemption) {
    if (!teamId) {
      return;
    }
    if (!canManageStore) {
      setMessage(t("store.captainOnlyHint"));
      return;
    }
    if (redemption.status !== "pending") {
      setMessage(t("store.redemptionReadonly"));
      return;
    }
    setIsLoading(true);
    setMessage(null);
    try {
      await cancelRedemption(redemption.id);
      await refreshStoreData();
      setMessage(t("store.cancelled"));
    } catch (error) {
      setMessage(formatApiError(error, t));
    } finally {
      setIsLoading(false);
    }
  }

  async function handleCancel(redemption: Redemption) {
    if (!canManageStore) {
      setMessage(t("store.captainOnlyHint"));
      return;
    }
    if (redemption.status !== "pending") {
      setMessage(t("store.redemptionReadonly"));
      return;
    }
    Alert.alert(t("store.cancelConfirmTitle"), t("store.cancelConfirmBody"), [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("store.cancel"), style: "destructive", onPress: () => void performCancel(redemption) }
    ]);
  }

  function itemLabel(storeItemId: string) {
    return items.find((item) => item.id === storeItemId)?.name ?? storeItemId;
  }

  function redemptionUserLabel(redemption: Redemption) {
    return redemption.user?.name ?? redemption.user?.email ?? redemption.user_id;
  }

  function updateItemDraft(item: StoreItem, patch: Partial<ItemDraft>) {
    setItemDrafts((currentDrafts) => ({
      ...currentDrafts,
      [item.id]: {
        ...(currentDrafts[item.id] ?? draftFromItem(item)),
        ...patch
      }
    }));
  }

  function renderRedemption(redemption: Redemption, options: { manageable: boolean }) {
    return (
      <View key={redemption.id} style={styles.card}>
        <Text style={styles.cardTitle}>{t(`store.status.${redemption.status}`)}</Text>
        <Text style={styles.muted}>
          {itemLabel(redemption.store_item_id)} · {redemption.quantity} · {redemption.total_price}
        </Text>
        {options.manageable || redemption.user ? (
          <Text style={styles.muted}>
            {t("store.redeemedBy")} {redemptionUserLabel(redemption)}
            {redemption.user?.email ? ` · ${redemption.user.email}` : ""}
          </Text>
        ) : null}
        <Text style={styles.muted}>{new Date(redemption.created_at).toLocaleString()}</Text>
        {redemption.fulfilled_at ? (
          <Text style={styles.muted}>
            {t("store.fulfilledAt")} {new Date(redemption.fulfilled_at).toLocaleString()}
          </Text>
        ) : null}
        {options.manageable ? (
          <View style={styles.row}>
            {redemption.status === "pending" ? (
              <>
                <Pressable
                  accessibilityRole="button"
                  disabled={isLoading}
                  style={[styles.smallButton, isLoading && styles.disabled]}
                  onPress={() => handleFulfill(redemption)}
                >
                  <Text style={styles.secondaryText}>{t("store.fulfill")}</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  disabled={isLoading}
                  style={[styles.dangerButton, isLoading && styles.disabled]}
                  onPress={() => handleCancel(redemption)}
                >
                  <Text style={styles.secondaryText}>{t("store.cancel")}</Text>
                </Pressable>
              </>
            ) : null}
            {redemption.status === "fulfilled" ? (
              <Pressable
                accessibilityRole="button"
                disabled={isLoading}
                style={[styles.dangerButton, isLoading && styles.disabled]}
                onPress={() => handleRefund(redemption)}
              >
                <Text style={styles.secondaryText}>{t("store.refund")}</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>{t("store.title")}</Text>
      <Text style={styles.muted}>{t("store.captainOnlyHint")}</Text>
      {!canManageStore ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t("store.manage")}</Text>
          <Text style={styles.muted}>{t("store.captainOnlyHint")}</Text>
        </View>
      ) : null}
      {canManageStore ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t("store.create")}</Text>
        <TextInput
          onChangeText={setName}
          placeholder={t("store.name")}
          placeholderTextColor={colors.muted}
          style={styles.input}
          value={name}
        />
        <TextInput
          onChangeText={setDescription}
          placeholder={t("store.description")}
          placeholderTextColor={colors.muted}
          style={styles.input}
          value={description}
        />
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={setImageUrl}
          placeholder={t("store.imageUrl")}
          placeholderTextColor={colors.muted}
          style={styles.input}
          value={imageUrl}
        />
        <View style={styles.row}>
          <TextInput
            autoCorrect={false}
            keyboardType="number-pad"
            onChangeText={setPrice}
            placeholder={t("store.price")}
            placeholderTextColor={colors.muted}
            style={[styles.input, styles.rowInput]}
            value={price}
          />
          <TextInput
            autoCorrect={false}
            keyboardType="number-pad"
            onChangeText={setStock}
            placeholder={t("store.stock")}
            placeholderTextColor={colors.muted}
            style={[styles.input, styles.rowInput]}
            value={stock}
          />
        </View>
        <Pressable
          accessibilityRole="button"
          disabled={isLoading}
          onPress={handleCreateItem}
          style={[styles.button, isLoading && styles.disabled]}
        >
          <Text style={styles.buttonText}>{t("store.create")}</Text>
        </Pressable>
        </View>
      ) : null}
      <Pressable
        accessibilityRole="button"
        disabled={isLoading}
        onPress={handleLoadItems}
        style={[styles.button, isLoading && styles.disabled]}
      >
        <Text style={styles.buttonText}>{t("store.load")}</Text>
      </Pressable>
      <ScreenState
        isLoading={isLoading}
        authRequiredLabel={t("common.authRequired")}
        loadingLabel={t("common.loading")}
        message={message}
        onRetry={handleLoadItems}
        retryLabel={t("common.retry")}
        signInLabel={t("home.openLogin")}
      />
      <Text style={styles.sectionTitle}>{t("store.items")}</Text>
      {canManageStore ? (
        <View style={styles.row}>
          {itemActiveFilters.map((isActive) => (
            <Pressable
              accessibilityRole="button"
              disabled={isLoading}
              key={isActive === null ? "all-items" : String(isActive)}
              onPress={() => setItemActiveFilter(isActive)}
              style={[styles.pillButton, itemActiveFilter === isActive && styles.activePill, isLoading && styles.disabled]}
            >
              <Text style={styles.secondaryText}>
                {isActive === null ? t("store.allItems") : isActive ? t("store.active") : t("store.inactive")}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {items.map((item) => (
        <View key={item.id} style={styles.card}>
          {item.image_url ? <Image source={{ uri: item.image_url }} style={styles.itemImage} /> : null}
          <Text style={styles.cardTitle}>{item.name}</Text>
          <Text style={styles.muted}>{item.description ?? ""}</Text>
          {item.image_url ? <Text style={styles.muted}>{item.image_url}</Text> : null}
          <Text style={styles.muted}>
            {item.price} · {item.stock ?? "∞"} · {item.is_active ? t("store.active") : t("store.inactive")}
          </Text>
          <Link href={{ pathname: "/store-items/[storeItemId]", params: { storeItemId: item.id, teamId } }} asChild>
            <Pressable accessibilityRole="button" style={styles.secondaryButton}>
              <Text style={styles.secondaryText}>{t("store.detail")}</Text>
            </Pressable>
          </Link>
          {canManageStore ? (
            <>
              <TextInput
                onChangeText={(nextName) => updateItemDraft(item, { name: nextName })}
                placeholder={t("store.name")}
                placeholderTextColor={colors.muted}
                style={styles.input}
                value={itemDrafts[item.id]?.name ?? item.name}
              />
              <TextInput
                onChangeText={(nextDescription) => updateItemDraft(item, { description: nextDescription })}
                placeholder={t("store.description")}
                placeholderTextColor={colors.muted}
                style={styles.input}
                value={itemDrafts[item.id]?.description ?? item.description ?? ""}
              />
              <TextInput
                autoCapitalize="none"
                autoCorrect={false}
                onChangeText={(nextImageUrl) => updateItemDraft(item, { imageUrl: nextImageUrl })}
                placeholder={t("store.imageUrl")}
                placeholderTextColor={colors.muted}
                style={styles.input}
                value={itemDrafts[item.id]?.imageUrl ?? item.image_url ?? ""}
              />
              <View style={styles.row}>
                <TextInput
                  autoCorrect={false}
                  keyboardType="number-pad"
                  onChangeText={(nextPrice) => updateItemDraft(item, { price: nextPrice })}
                  placeholder={t("store.price")}
                  placeholderTextColor={colors.muted}
                  style={[styles.input, styles.rowInput]}
                  value={itemDrafts[item.id]?.price ?? item.price.toString()}
                />
                <TextInput
                  autoCorrect={false}
                  keyboardType="number-pad"
                  onChangeText={(nextStock) => updateItemDraft(item, { stock: nextStock })}
                  placeholder={t("store.stock")}
                  placeholderTextColor={colors.muted}
                  style={[styles.input, styles.rowInput]}
                  value={itemDrafts[item.id]?.stock ?? item.stock?.toString() ?? ""}
                />
              </View>
              <Pressable
                accessibilityRole="button"
                disabled={isLoading}
                style={[styles.secondaryButton, isLoading && styles.disabled]}
                onPress={() => handleUpdateItemProfile(item)}
              >
                <Text style={styles.secondaryText}>{t("store.saveItem")}</Text>
              </Pressable>
            </>
          ) : null}
          {canRedeemItem(item) ? (
            <>
              <TextInput
                autoCorrect={false}
                keyboardType="number-pad"
                onChangeText={(nextQuantity) =>
                  setRedemptionQuantities((currentQuantities) => ({
                    ...currentQuantities,
                    [item.id]: nextQuantity
                  }))
                }
                placeholder={t("store.quantity")}
                placeholderTextColor={colors.muted}
                style={styles.input}
                value={redemptionQuantities[item.id] ?? "1"}
              />
              <Pressable
                accessibilityRole="button"
                disabled={isLoading}
                style={[styles.secondaryButton, isLoading && styles.disabled]}
                onPress={() => handleRedeem(item)}
              >
                <Text style={styles.secondaryText}>{t("store.redeem")}</Text>
              </Pressable>
            </>
          ) : (
            <Text style={styles.muted}>{t("store.unavailable")}</Text>
          )}
          {canManageStore ? (
            <View style={styles.row}>
              <Pressable
                accessibilityRole="button"
                disabled={isLoading}
                style={[styles.smallButton, isLoading && styles.disabled]}
                onPress={() => handleRestock(item)}
              >
                <Text style={styles.secondaryText}>{t("store.restock")}</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={isLoading}
                style={[styles.smallButton, isLoading && styles.disabled]}
                onPress={() => handleToggleItem(item)}
              >
                <Text style={styles.secondaryText}>
                  {item.is_active ? t("store.deactivate") : t("store.activate")}
                </Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      ))}
      <Text style={styles.sectionTitle}>{t("store.myRedemptions")}</Text>
      <View style={styles.row}>
        {redemptionStatuses.map((status) => (
          <Pressable
            accessibilityRole="button"
            disabled={isLoading}
            key={status ?? "all-my-redemptions"}
            onPress={() => setMyRedemptionStatus(status)}
            style={[styles.pillButton, myRedemptionStatus === status && styles.activePill, isLoading && styles.disabled]}
          >
            <Text style={styles.secondaryText}>
              {status === null ? t("store.allRedemptionStatuses") : t(`store.status.${status}`)}
            </Text>
          </Pressable>
        ))}
      </View>
      {myRedemptions.length === 0 ? <Text style={styles.muted}>{t("store.noRedemptions")}</Text> : null}
      {myRedemptions.map((redemption) => renderRedemption(redemption, { manageable: false }))}
      {canManageStore ? (
        <>
          <Text style={styles.sectionTitle}>{t("store.manageRedemptions")}</Text>
          <View style={styles.row}>
            {redemptionStatuses.map((status) => (
              <Pressable
                accessibilityRole="button"
                disabled={isLoading}
                key={status ?? "all-managed-redemptions"}
                onPress={() => setManagedRedemptionStatus(status)}
                style={[styles.pillButton, managedRedemptionStatus === status && styles.activePill, isLoading && styles.disabled]}
              >
                <Text style={styles.secondaryText}>
                  {status === null ? t("store.allRedemptionStatuses") : t(`store.status.${status}`)}
                </Text>
              </Pressable>
            ))}
          </View>
          {managedRedemptions.length === 0 ? (
            <Text style={styles.muted}>{t("store.noManagedRedemptions")}</Text>
          ) : null}
          {managedRedemptions.map((redemption) => renderRedemption(redemption, { manageable: true }))}
        </>
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
    height: 160,
    width: "100%"
  },
  muted: {
    color: colors.muted,
    fontSize: 14
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 22,
    fontWeight: "800",
    marginTop: 8
  },
  input: {
    backgroundColor: colors.background,
    borderRadius: 8,
    color: colors.text,
    fontSize: 16,
    minHeight: 48,
    paddingHorizontal: 14
  },
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10
  },
  rowInput: {
    flex: 1
  },
  pillButton: {
    alignItems: "center",
    backgroundColor: colors.background,
    borderRadius: 999,
    flex: 1,
    minHeight: 42,
    justifyContent: "center",
    paddingHorizontal: 10
  },
  activePill: {
    backgroundColor: colors.accent
  },
  secondaryButton: {
    alignItems: "center",
    backgroundColor: colors.background,
    borderRadius: 8,
    minHeight: 44,
    justifyContent: "center",
    marginTop: 4
  },
  smallButton: {
    alignItems: "center",
    backgroundColor: colors.background,
    borderRadius: 8,
    flex: 1,
    minHeight: 42,
    justifyContent: "center",
    marginTop: 4
  },
  dangerButton: {
    alignItems: "center",
    backgroundColor: "#7f1d1d",
    borderRadius: 8,
    flex: 1,
    minHeight: 42,
    justifyContent: "center",
    marginTop: 4
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
