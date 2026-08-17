import { apiRequest } from "@/lib/api/client";
import { generateClientUuid } from "@/lib/uuid";

export type CoinRuleTrigger = "training_signup" | "match_signup" | "manual";

export type CoinRule = {
  id: string;
  team_id: string;
  name: string;
  trigger_type: CoinRuleTrigger;
  amount: number;
  config: Record<string, unknown> | null;
  is_active: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type CoinBalance = {
  team_id: string;
  user_id: string;
  balance: number;
};

export type CoinTransaction = {
  id: string;
  team_id: string;
  user_id: string;
  amount: number;
  type: "signup_reward" | "redemption" | "admin_adjustment" | "other_reward" | "refund";
  reason: string | null;
  reference_type: string | null;
  reference_id: string | null;
  created_by: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

export type CoinTransactionType = CoinTransaction["type"];

export type CoinRuleInput = {
  id?: string;
  name: string;
  trigger_type: CoinRuleTrigger;
  amount: number;
  config?: Record<string, unknown> | null;
  is_active?: boolean;
};

export type CoinRuleUpdateInput = Partial<Omit<CoinRuleInput, "trigger_type">>;

export type ManualCoinTransactionInput = {
  id: string;
  user_id: string;
  amount: number;
  type?: "admin_adjustment" | "other_reward";
  reason?: string | null;
  metadata?: Record<string, unknown> | null;
};

export type CoinTransactionsQuery = {
  type?: CoinTransactionType | null;
  createdAfter?: string | null;
  createdBefore?: string | null;
};

function coinTransactionsQueryString(query: CoinTransactionsQuery = {}) {
  const params = new URLSearchParams();
  if (query.type) {
    params.set("type", query.type);
  }
  if (query.createdAfter) {
    params.set("created_after", query.createdAfter);
  }
  if (query.createdBefore) {
    params.set("created_before", query.createdBefore);
  }
  const queryString = params.toString();
  return queryString ? `?${queryString}` : "";
}

export function getCoinBalance(teamId: string) {
  return apiRequest<CoinBalance>(`/api/v1/teams/${teamId}/coins/balance`);
}

export function getMyCoinTransactions(teamId: string, query: CoinTransactionsQuery = {}) {
  return apiRequest<CoinTransaction[]>(
    `/api/v1/teams/${teamId}/coins/transactions${coinTransactionsQueryString(query)}`
  );
}

export function getMemberCoinTransactions(teamId: string, userId: string, query: CoinTransactionsQuery = {}) {
  return apiRequest<CoinTransaction[]>(
    `/api/v1/teams/${teamId}/members/${userId}/coin-transactions${coinTransactionsQueryString(query)}`
  );
}

export function getCoinRules(teamId: string) {
  return apiRequest<CoinRule[]>(`/api/v1/teams/${teamId}/coin-rules`);
}

export function createCoinRule(teamId: string, input: CoinRuleInput) {
  return apiRequest<CoinRule>(`/api/v1/teams/${teamId}/coin-rules`, {
    method: "POST",
    body: {
      id: input.id ?? generateClientUuid(),
      name: input.name,
      trigger_type: input.trigger_type,
      amount: input.amount,
      config: input.config ?? null,
      is_active: input.is_active ?? true
    }
  });
}

export function updateCoinRule(coinRuleId: string, input: CoinRuleUpdateInput) {
  return apiRequest<CoinRule>(`/api/v1/coin-rules/${coinRuleId}`, {
    method: "PATCH",
    body: input
  });
}

export function createManualCoinTransaction(
  teamId: string,
  input: Omit<ManualCoinTransactionInput, "id"> & { id?: string }
) {
  return apiRequest<CoinTransaction>(`/api/v1/teams/${teamId}/coin-transactions`, {
    method: "POST",
    body: {
      id: input.id ?? generateClientUuid(),
      user_id: input.user_id,
      amount: input.amount,
      type: input.type ?? "admin_adjustment",
      reason: input.reason ?? null,
      metadata: input.metadata ?? null
    }
  });
}
