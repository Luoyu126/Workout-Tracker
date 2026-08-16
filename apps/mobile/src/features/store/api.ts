import { apiRequest } from "@/lib/api/client";
import { generateClientUuid } from "@/lib/uuid";
import { normalizeOptionalText, omitUndefined } from "@/lib/validation/text";

export type StoreItem = {
  id: string;
  team_id: string;
  name: string;
  description: string | null;
  image_url: string | null;
  price: number;
  stock: number | null;
  is_active: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type Redemption = {
  id: string;
  team_id: string;
  user_id: string;
  user: {
    id: string;
    name: string;
    email: string;
    avatar_url: string | null;
  } | null;
  store_item_id: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  status: "pending" | "fulfilled" | "cancelled" | "refunded";
  fulfilled_by: string | null;
  fulfilled_at: string | null;
  created_at: string;
  updated_at: string;
};

export type RedemptionStatus = Redemption["status"];

export type StoreItemInput = {
  id?: string;
  name: string;
  description?: string | null;
  image_url?: string | null;
  price: number;
  stock?: number | null;
  is_active?: boolean;
};

export type StoreItemUpdateInput = Partial<StoreItemInput>;

export type StoreItemsQuery = {
  isActive?: boolean | null;
};

export type RedemptionsQuery = {
  status?: RedemptionStatus | null;
};

export function getStoreItems(teamId: string, query: StoreItemsQuery = {}) {
  const params = new URLSearchParams();
  if (query.isActive !== undefined && query.isActive !== null) {
    params.set("is_active", String(query.isActive));
  }
  const queryString = params.toString();
  return apiRequest<StoreItem[]>(`/api/v1/teams/${teamId}/store-items${queryString ? `?${queryString}` : ""}`);
}

export function createStoreItem(teamId: string, input: StoreItemInput) {
  return apiRequest<StoreItem>(`/api/v1/teams/${teamId}/store-items`, {
    method: "POST",
    body: omitUndefined({
      id: input.id ?? generateClientUuid(),
      name: input.name.trim(),
      description: normalizeOptionalText(input.description),
      image_url: normalizeOptionalText(input.image_url),
      price: input.price,
      stock: input.stock,
      is_active: input.is_active
    })
  });
}

export function getStoreItem(storeItemId: string) {
  return apiRequest<StoreItem>(`/api/v1/store-items/${storeItemId}`);
}

export function updateStoreItem(storeItemId: string, input: StoreItemUpdateInput) {
  return apiRequest<StoreItem>(`/api/v1/store-items/${storeItemId}`, {
    method: "PATCH",
    body: omitUndefined({
      name: input.name?.trim(),
      description: normalizeOptionalText(input.description),
      image_url: normalizeOptionalText(input.image_url),
      price: input.price,
      stock: input.stock,
      is_active: input.is_active
    })
  });
}

export function redeemStoreItem(teamId: string, storeItemId: string, quantity = 1, redemptionId = generateClientUuid()) {
  return apiRequest<Redemption>(`/api/v1/teams/${teamId}/redemptions`, {
    method: "POST",
    body: {
      id: redemptionId,
      store_item_id: storeItemId,
      quantity
    }
  });
}

export function getMyRedemptions(teamId: string, query: RedemptionsQuery = {}) {
  const params = new URLSearchParams();
  if (query.status) {
    params.set("status", query.status);
  }
  const queryString = params.toString();
  return apiRequest<Redemption[]>(`/api/v1/teams/${teamId}/redemptions${queryString ? `?${queryString}` : ""}`);
}

export function getTeamRedemptions(teamId: string, query: RedemptionsQuery = {}) {
  const params = new URLSearchParams();
  if (query.status) {
    params.set("status", query.status);
  }
  const queryString = params.toString();
  return apiRequest<Redemption[]>(
    `/api/v1/teams/${teamId}/redemptions/manage${queryString ? `?${queryString}` : ""}`
  );
}

export function fulfillRedemption(redemptionId: string) {
  return apiRequest<Redemption>(`/api/v1/redemptions/${redemptionId}/fulfill`, {
    method: "POST"
  });
}

export function cancelRedemption(redemptionId: string) {
  return apiRequest<Redemption>(`/api/v1/redemptions/${redemptionId}/cancel`, {
    method: "POST"
  });
}

export function refundRedemption(redemptionId: string) {
  return apiRequest<Redemption>(`/api/v1/redemptions/${redemptionId}/refund`, {
    method: "POST"
  });
}
