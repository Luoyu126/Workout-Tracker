import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { apiEndpoints, apiSchemaNames } from "../../../packages/api-client/src/generated";

const appRoot = resolve(__dirname, "..");

function sourceFilesUnder(relativePath: string): string[] {
  const root = resolve(appRoot, relativePath);
  return readdirSync(root).flatMap((entry) => {
    const fullPath = resolve(root, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      return sourceFilesUnder(resolve(relativePath, entry));
    }
    return fullPath.endsWith(".ts") || fullPath.endsWith(".tsx") ? [fullPath] : [];
  });
}

function normalizeMobileApiPath(pathTemplate: string) {
  const pathWithoutQuery = pathTemplate
    .replace(/\$\{[A-Za-z0-9_]+QueryString\([^}]+\)\}$/, "")
    .split("${query")[0]
    .split("?")[0];
  return pathWithoutQuery
    .replaceAll("${teamId}", "{team_id}")
    .replaceAll("${eventId}", "{event_id}")
    .replaceAll("${userId}", "{user_id}")
    .replaceAll("${coinRuleId}", "{coin_rule_id}")
    .replaceAll("${storeItemId}", "{store_item_id}")
    .replaceAll("${redemptionId}", "{redemption_id}")
    .replaceAll("${notificationId}", "{notification_id}")
    .replaceAll("${deviceTokenId}", "{device_token_id}")
    .replaceAll("${logId}", "{log_id}");
}

function mobileFeatureApiPaths() {
  const apiPathPattern = /[`'"]([^`'"]*\/api\/v1\/[^`'"]*)[`'"]/g;
  return sourceFilesUnder("src/features").flatMap((sourceFile) => {
    const source = readFileSync(sourceFile, "utf-8");
    return Array.from(source.matchAll(apiPathPattern), (match) => ({
      sourceFile: sourceFile.replace(`${appRoot}/`, ""),
      path: normalizeMobileApiPath(match[1])
    }));
  });
}

const authMock = vi.hoisted(() => {
  const state = {
    accessToken: "test-access-token" as string | null
  };
  return {
    state,
    getSession: vi.fn(async () => ({
      data: {
        session: state.accessToken ? { access_token: state.accessToken } : null
      }
    }))
  };
});

vi.mock("@/lib/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: authMock.getSession
    }
  }
}));

function jsonResponse(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: vi.fn(async () => body)
  };
}

function expectedFetchOptions(options: {
  method?: string;
  headers: Record<string, string>;
  body?: string;
}) {
  return {
    method: options.method ?? "GET",
    headers: options.headers,
    body: options.body,
    signal: expect.any(AbortSignal)
  };
}

describe("apiRequest", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    authMock.state.accessToken = "test-access-token";
    authMock.getSession.mockClear();
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ ok: true })));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  test("builds API URL and attaches bearer token", async () => {
    const { apiRequest } = await import("../src/lib/api/client");

    const result = await apiRequest<{ ok: boolean }>("/api/v1/teams");

    expect(result).toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledWith("http://localhost:8000/api/v1/teams", expectedFetchOptions({
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test-access-token"
      },
      body: undefined
    }));
  });

  test("serializes JSON body and respects configured API base URL", async () => {
    vi.stubEnv("EXPO_PUBLIC_API_BASE_URL", "https://api.example.test/");
    const { apiRequest } = await import("../src/lib/api/client");

    await apiRequest("/api/v1/auth/sync", {
      method: "POST",
      body: { name: "球员", student_id: "9" }
    });

    expect(fetch).toHaveBeenCalledWith("https://api.example.test/api/v1/auth/sync", expectedFetchOptions({
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test-access-token"
      },
      body: JSON.stringify({ name: "球员", student_id: "9" })
    }));
  });

  test("falls back to the local API URL for blank configured API base URL", async () => {
    vi.stubEnv("EXPO_PUBLIC_API_BASE_URL", "   ");
    const { apiConfig, apiRequest } = await import("../src/lib/api/client");

    await apiRequest("/api/v1/health-check-example");

    expect(apiConfig).toMatchObject({
      baseUrl: "http://localhost:8000",
      isConfigured: false,
      isUsingDefaultLocalUrl: true,
      isMalformed: false,
      requestTimeoutMs: 15000
    });
    expect(fetch).toHaveBeenCalledWith("http://localhost:8000/api/v1/health-check-example", expectedFetchOptions({
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test-access-token"
      },
      body: undefined
    }));
  });

  test("exposes configured API base URL status for device build warnings", async () => {
    vi.stubEnv("EXPO_PUBLIC_API_BASE_URL", "https://api.example.test/");
    const { apiConfig } = await import("../src/lib/api/client");

    expect(apiConfig).toEqual({
      baseUrl: "https://api.example.test",
      isConfigured: true,
      isUsingDefaultLocalUrl: false,
      isMalformed: false,
      requestTimeoutMs: 15000
    });
  });

  test("treats malformed configured API base URL as unconfigured and falls back locally", async () => {
    vi.stubEnv("EXPO_PUBLIC_API_BASE_URL", "not-a-url");
    const { apiConfig, apiRequest } = await import("../src/lib/api/client");

    await apiRequest("/api/v1/health-check-example");

    expect(apiConfig).toEqual({
      baseUrl: "http://localhost:8000",
      isConfigured: false,
      isUsingDefaultLocalUrl: true,
      isMalformed: true,
      requestTimeoutMs: 15000
    });
    expect(fetch).toHaveBeenCalledWith("http://localhost:8000/api/v1/health-check-example", expectedFetchOptions({
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test-access-token"
      },
      body: undefined
    }));
  });

  test("omits authorization header without a session", async () => {
    authMock.state.accessToken = null;
    const { apiRequest } = await import("../src/lib/api/client");

    await apiRequest("/api/v1/notifications");

    expect(fetch).toHaveBeenCalledWith("http://localhost:8000/api/v1/notifications", expectedFetchOptions({
      headers: {
        "Content-Type": "application/json"
      },
      body: undefined
    }));
  });

  test("reads the current Supabase session for every API request", async () => {
    const { apiRequest } = await import("../src/lib/api/client");

    authMock.state.accessToken = "first-token";
    await apiRequest("/api/v1/teams");
    authMock.state.accessToken = "refreshed-token";
    await apiRequest("/api/v1/notifications");

    expect(authMock.getSession).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenNthCalledWith(1, "http://localhost:8000/api/v1/teams", expectedFetchOptions({
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer first-token"
      },
      body: undefined
    }));
    expect(fetch).toHaveBeenNthCalledWith(2, "http://localhost:8000/api/v1/notifications", expectedFetchOptions({
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer refreshed-token"
      },
      body: undefined
    }));
  });

  test("handles successful no-content responses without parsing JSON", async () => {
    const json = vi.fn(async () => {
      throw new Error("No body");
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 204,
        json
      }))
    );
    const { apiRequest } = await import("../src/lib/api/client");

    await expect(apiRequest<void>("/api/v1/device-tokens/device-token-1", { method: "DELETE" })).resolves.toBeUndefined();
    expect(json).not.toHaveBeenCalled();
  });

  test("wraps invalid successful JSON responses as structured API errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: vi.fn(async () => {
          throw new SyntaxError("Unexpected end of JSON input");
        })
      }))
    );
    const { ApiError, apiRequest } = await import("../src/lib/api/client");

    const request = apiRequest("/api/v1/teams");

    await expect(request).rejects.toMatchObject({
      message: "Invalid API response",
      status: 200,
      code: "INVALID_RESPONSE"
    });
    await expect(request).rejects.toBeInstanceOf(ApiError);
  });

  test("throws structured ApiError from backend detail payload", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(
          {
            detail: {
              code: "STORE_RULE_CONFLICT",
              message: "Insufficient coin balance"
            }
          },
          { ok: false, status: 409 }
        )
      )
    );
    const { ApiError, apiRequest } = await import("../src/lib/api/client");

    await expect(apiRequest("/api/v1/teams/team-id/redemptions")).rejects.toMatchObject({
      message: "Insufficient coin balance",
      status: 409,
      code: "STORE_RULE_CONFLICT"
    });
    await expect(apiRequest("/api/v1/teams/team-id/redemptions")).rejects.toBeInstanceOf(ApiError);
  });

  test("throws readable ApiError from FastAPI validation detail arrays", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(
          {
            detail: [
              {
                loc: ["body", "name"],
                msg: "String should have at least 1 character"
              }
            ]
          },
          { ok: false, status: 422 }
        )
      )
    );
    const { apiRequest } = await import("../src/lib/api/client");

    await expect(apiRequest("/api/v1/auth/sync")).rejects.toMatchObject({
      message: "body.name: String should have at least 1 character",
      status: 422,
      code: "VALIDATION_ERROR"
    });
  });

  test("throws readable ApiError from string error details", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(
          {
            detail: "Plain backend error"
          },
          { ok: false, status: 400 }
        )
      )
    );
    const { apiRequest } = await import("../src/lib/api/client");

    await expect(apiRequest("/api/v1/example")).rejects.toMatchObject({
      message: "Plain backend error",
      status: 400,
      code: "REQUEST_FAILED"
    });
  });

  test("wraps fetch failures as network errors for offline recovery UI", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Network request failed");
      })
    );
    const { ApiNetworkError, apiRequest } = await import("../src/lib/api/client");

    await expect(apiRequest("/api/v1/teams")).rejects.toMatchObject({
      message: "Network request failed",
      code: "NETWORK_UNAVAILABLE"
    });
    await expect(apiRequest("/api/v1/teams")).rejects.toBeInstanceOf(ApiNetworkError);
  });

  test("aborts hanging API requests after the default timeout", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async (_url: string, init?: RequestInit) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              const abortError = new Error("Aborted");
              abortError.name = "AbortError";
              reject(abortError);
            });
          })
      )
    );
    const { ApiNetworkError, apiConfig, apiRequest } = await import("../src/lib/api/client");

    const request = apiRequest("/api/v1/teams");
    const messageAssertion = expect(request).rejects.toMatchObject({
      message: "Request timed out",
      code: "NETWORK_UNAVAILABLE"
    });
    const typeAssertion = expect(request).rejects.toBeInstanceOf(ApiNetworkError);
    await vi.advanceTimersByTimeAsync(apiConfig.requestTimeoutMs);

    await messageAssertion;
    await typeAssertion;
  });

  test("generated OpenAPI metadata covers MVP route and schema contracts", () => {
    const endpointKeys = new Set(apiEndpoints.map((endpoint) => `${endpoint.method} ${endpoint.path}`));
    const endpointByKey = new Map(apiEndpoints.map((endpoint) => [`${endpoint.method} ${endpoint.path}`, endpoint]));

    for (const key of [
      "POST /api/v1/auth/sync",
      "GET /api/v1/users/me",
      "PATCH /api/v1/users/me",
      "GET /api/v1/organizations",
      "GET /api/v1/teams",
      "GET /api/v1/teams/{team_id}/home",
      "GET /api/v1/teams/{team_id}",
      "PATCH /api/v1/teams/{team_id}",
      "GET /api/v1/teams/{team_id}/members",
      "POST /api/v1/teams/{team_id}/members",
      "GET /api/v1/teams/{team_id}/members/{user_id}",
      "PATCH /api/v1/teams/{team_id}/members/{user_id}",
      "GET /api/v1/teams/{team_id}/member-candidates",
      "GET /api/v1/teams/{team_id}/events",
      "POST /api/v1/teams/{team_id}/events",
      "POST /api/v1/teams/{team_id}/matches",
      "GET /api/v1/events/{event_id}",
      "PATCH /api/v1/events/{event_id}",
      "DELETE /api/v1/events/{event_id}",
      "GET /api/v1/events/{event_id}/signup",
      "PUT /api/v1/events/{event_id}/signup",
      "GET /api/v1/events/{event_id}/signups",
      "POST /api/v1/events/{event_id}/complete",
      "GET /api/v1/events/{event_id}/live-board",
      "GET /api/v1/events/{event_id}/match-logs",
      "POST /api/v1/events/{event_id}/match-logs",
      "DELETE /api/v1/match-logs/{log_id}",
      "GET /api/v1/events/{event_id}/summary",
      "GET /api/v1/teams/{team_id}/signup-board",
      "GET /api/v1/teams/{team_id}/coins/balance",
      "GET /api/v1/teams/{team_id}/coins/transactions",
      "GET /api/v1/teams/{team_id}/members/{user_id}/coin-transactions",
      "GET /api/v1/teams/{team_id}/coin-rules",
      "POST /api/v1/teams/{team_id}/coin-rules",
      "PATCH /api/v1/coin-rules/{coin_rule_id}",
      "POST /api/v1/teams/{team_id}/coin-transactions",
      "GET /api/v1/teams/{team_id}/store-items",
      "POST /api/v1/teams/{team_id}/store-items",
      "GET /api/v1/store-items/{store_item_id}",
      "PATCH /api/v1/store-items/{store_item_id}",
      "GET /api/v1/teams/{team_id}/redemptions",
      "GET /api/v1/notifications",
      "GET /api/v1/notifications/unread-count",
      "POST /api/v1/notifications/{notification_id}/read",
      "POST /api/v1/teams/{team_id}/announcements",
      "PUT /api/v1/device-tokens",
      "DELETE /api/v1/device-tokens/{device_token_id}",
      "POST /api/v1/teams/{team_id}/redemptions",
      "GET /api/v1/teams/{team_id}/redemptions/manage",
      "POST /api/v1/redemptions/{redemption_id}/fulfill",
      "POST /api/v1/redemptions/{redemption_id}/cancel",
      "POST /api/v1/redemptions/{redemption_id}/refund"
    ]) {
      expect(endpointKeys).toContain(key);
    }

    for (const schemaName of [
      "TeamHomeRead",
      "MembershipRead",
      "EventCompletionRequest",
      "LiveBoardRead",
      "NotificationRead",
      "CoinTransactionRead",
      "RedemptionRead"
    ]) {
      expect(apiSchemaNames).toContain(schemaName);
    }

    const openApi = JSON.parse(readFileSync(resolve(__dirname, "../../../packages/api-client/openapi.json"), "utf-8"));
    const coinTransactionProperties = openApi.components.schemas.CoinTransactionRead.properties;
    expect(coinTransactionProperties).toHaveProperty("metadata");
    expect(coinTransactionProperties).not.toHaveProperty("metadata_");

    expect(endpointByKey.get("POST /api/v1/events/{event_id}/complete")).toMatchObject({
      requestBody: "EventCompletionRequest",
      response: "EventCompletionRead"
    });
    expect(endpointByKey.get("DELETE /api/v1/events/{event_id}")).toMatchObject({
      requestBody: null,
      response: "void",
      statusCodes: [204, 422]
    });
    expect(endpointByKey.get("DELETE /api/v1/match-logs/{log_id}")).toMatchObject({
      requestBody: null,
      response: "void",
      statusCodes: [204, 422]
    });
    expect(endpointByKey.get("GET /api/v1/notifications/unread-count")).toMatchObject({
      requestBody: null,
      response: "UnreadCountRead"
    });
    expect(endpointByKey.get("DELETE /api/v1/device-tokens/{device_token_id}")).toMatchObject({
      requestBody: null,
      response: "void",
      statusCodes: [204, 422]
    });
  });

  test("mobile feature API paths are backed by generated OpenAPI endpoints", () => {
    const generatedPaths = new Set<string>(apiEndpoints.map((endpoint) => endpoint.path));
    const unknownPaths = mobileFeatureApiPaths()
      .filter(({ path }) => !generatedPaths.has(path))
      .map(({ sourceFile, path }) => `${sourceFile}: ${path}`);

    expect(unknownPaths).toEqual([]);
  });

  test("generated OpenAPI schemas keep fields used by mobile screens", () => {
    const openApi = JSON.parse(readFileSync(resolve(__dirname, "../../../packages/api-client/openapi.json"), "utf-8"));
    const schemaProperties = (schemaName: string) => Object.keys(openApi.components.schemas[schemaName].properties);

    expect(schemaProperties("UserSummary")).toEqual(
      expect.arrayContaining(["id", "name", "email", "avatar_url"])
    );
    expect(schemaProperties("EventRead")).toEqual(
      expect.arrayContaining(["match_details", "end_time", "status", "type"])
    );
    expect(schemaProperties("EventSignupRead")).toEqual(
      expect.arrayContaining(["user", "status", "note", "created_at", "updated_at"])
    );
    expect(schemaProperties("EventCompletionRead")).toEqual(
      expect.arrayContaining(["event_id", "status", "going_count", "reward_count"])
    );
    expect(schemaProperties("SignupBoardRow")).toEqual(
      expect.arrayContaining(["user", "going", "maybe", "not_going", "total", "going_rate"])
    );
    expect(schemaProperties("RedemptionRead")).toEqual(
      expect.arrayContaining(["user", "quantity", "unit_price", "total_price", "status", "fulfilled_at"])
    );
    expect(schemaProperties("NotificationRead")).toEqual(
      expect.arrayContaining(["type", "reference_type", "reference_id", "read_at", "expires_at"])
    );
    expect(schemaProperties("TeamHomeRead")).toEqual(
      expect.arrayContaining([
        "team",
        "current_membership",
        "admins",
        "upcoming_events",
        "signup_summary",
        "coin_summary"
      ])
    );
    expect(schemaProperties("MembershipRead")).toEqual(
      expect.arrayContaining(["user", "role", "status", "jersey_number", "player_name", "left_at"])
    );
  });
});
