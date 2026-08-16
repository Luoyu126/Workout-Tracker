import { supabase } from "@/lib/supabase/client";

export const defaultApiBaseUrl = "http://localhost:8000";
export const defaultApiRequestTimeoutMs = 15000;

function normalizeApiBaseUrl(value: string | undefined) {
  if (value === undefined) {
    return null;
  }
  const normalizedValue = value.trim().replace(/\/+$/, "");
  return normalizedValue.length > 0 ? normalizedValue : null;
}

const configuredApiBaseUrl = normalizeApiBaseUrl(process.env.EXPO_PUBLIC_API_BASE_URL);
const parsedConfiguredApiBaseUrl = configuredApiBaseUrl === null ? null : safeParseApiBaseUrl(configuredApiBaseUrl);
const validConfiguredApiBaseUrl =
  parsedConfiguredApiBaseUrl !== null && ["http:", "https:"].includes(parsedConfiguredApiBaseUrl.protocol)
    ? configuredApiBaseUrl
    : null;

function safeParseApiBaseUrl(value: string) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

export const apiConfig = {
  baseUrl: validConfiguredApiBaseUrl ?? defaultApiBaseUrl,
  isConfigured: validConfiguredApiBaseUrl !== null,
  isUsingDefaultLocalUrl: validConfiguredApiBaseUrl === null,
  isMalformed: configuredApiBaseUrl !== null && validConfiguredApiBaseUrl === null,
  requestTimeoutMs: defaultApiRequestTimeoutMs
};

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string
  ) {
    super(message);
  }
}

export class ApiNetworkError extends Error {
  readonly code = "NETWORK_UNAVAILABLE";

  constructor(message = "Network unavailable") {
    super(message);
  }
}

function apiErrorFromBody(errorBody: unknown, status: number) {
  const body = errorBody as { detail?: unknown; error?: unknown } | null;
  const detail = body?.detail ?? body?.error;

  if (detail && typeof detail === "object" && !Array.isArray(detail)) {
    const structuredDetail = detail as { message?: unknown; code?: unknown };
    return new ApiError(
      typeof structuredDetail.message === "string" ? structuredDetail.message : "Request failed",
      status,
      typeof structuredDetail.code === "string" ? structuredDetail.code : "REQUEST_FAILED"
    );
  }

  if (Array.isArray(detail) && detail.length > 0) {
    const firstDetail = detail[0] as { msg?: unknown; loc?: unknown } | undefined;
    const message = typeof firstDetail?.msg === "string" ? firstDetail.msg : "Request failed";
    const location = Array.isArray(firstDetail?.loc) ? firstDetail.loc.join(".") : null;
    return new ApiError(location ? `${location}: ${message}` : message, status, "VALIDATION_ERROR");
  }

  if (typeof detail === "string") {
    return new ApiError(detail, status, "REQUEST_FAILED");
  }

  return new ApiError("Request failed", status, "REQUEST_FAILED");
}

type RequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
};

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;
  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), apiConfig.requestTimeoutMs);

  let response: Response;
  try {
    response = await fetch(`${apiConfig.baseUrl}${path}`, {
      method: options.method ?? "GET",
      headers: {
        "Content-Type": "application/json",
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {})
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: abortController.signal
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new ApiNetworkError("Request timed out");
    }
    throw new ApiNetworkError(error instanceof Error ? error.message : undefined);
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    const errorBody = await response.json().catch(() => null);
    throw apiErrorFromBody(errorBody, response.status);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  try {
    return (await response.json()) as T;
  } catch {
    throw new ApiError("Invalid API response", response.status, "INVALID_RESPONSE");
  }
}
