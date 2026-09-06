import { isValidElement, type ReactNode } from "react";
import { describe, expect, test, vi } from "vitest";

vi.mock("react-native", () => ({
  View: "section", Text: "span", Pressable: "button", ActivityIndicator: "progress",
  StyleSheet: { create: (styles: unknown) => styles }
}));
vi.mock("expo-router", () => ({ Link: "a" }));
vi.mock("@/lib/supabase/client", () => ({ supabase: {} }));
vi.mock("@/lib/i18n/I18nProvider", () => ({ useI18n: () => ({ t: (key: string) => key }) }));

import { ScreenState } from "../src/components/ScreenState";
import { ApiError, ApiNetworkError } from "../src/lib/api/client";
import { canRetryLoad, isEmptyLoad, type LoadState } from "../src/lib/api/loadState";

function visibleText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(visibleText).join(" ");
  if (isValidElement<{ children?: ReactNode }>(node)) return visibleText(node.props.children);
  return "";
}

const onRetry = vi.fn();
function renderState(loadState: LoadState, message?: string, isLoading = false) {
  return visibleText(ScreenState({
    loadState, message, emptyMessage: "暂无已完成活动出勤数据",
    isLoading, loadingLabel: "加载中", retryLabel: "重试", onRetry
  }));
}

describe("load and empty state UI contract", () => {
  test("a successful empty response shows only the empty message", () => {
    expect(isEmptyLoad({ status: "success" }, 0)).toBe(true);
    const text = renderState({ status: "success" });
    expect(text).toContain("暂无已完成活动出勤数据");
    expect(text).not.toContain("重试");
  });

  test("a network failure overrides an old empty message and offers retry", () => {
    const state: LoadState = { status: "error", error: new ApiNetworkError() };
    expect(isEmptyLoad(state, 0)).toBe(false);
    const text = renderState(state);
    expect(text).toContain("common.networkUnavailable");
    expect(text).toContain("重试");
    expect(text).not.toContain("暂无");
  });

  test.each([408, 429, 500, 502, 503, 504])("offers manual retry for HTTP %i", (status) => {
    expect(canRetryLoad({ status: "error", error: new ApiError("Failed", status, "REQUEST_FAILED") })).toBe(true);
  });

  test.each([400, 401, 403, 404, 409, 422])("HTTP %i is neither empty nor retryable", (status) => {
    const state: LoadState = { status: "error", error: new ApiError("Failed", status, "REQUEST_FAILED") };
    expect(isEmptyLoad(state, 0)).toBe(false);
    expect(canRetryLoad(state)).toBe(false);
    const text = renderState(state);
    expect(text).not.toContain("暂无");
    expect(text).not.toContain("重试");
  });

  test("an invalid successful response remains an error", () => {
    const state: LoadState = { status: "error", error: new ApiError("Invalid API response", 200, "INVALID_RESPONSE") };
    expect(renderState(state)).toContain("common.invalidResponse");
    expect(isEmptyLoad(state, 0)).toBe(false);
    expect(canRetryLoad(state)).toBe(false);
  });

  test("loading hides old messages and retry controls", () => {
    for (const message of ["暂无活动", "网络异常"]) {
      const text = renderState({ status: "loading" }, message);
      expect(text).toContain("加载中");
      expect(text).not.toContain(message);
      expect(text).not.toContain("重试");
    }
    expect(renderState({ status: "error", error: new ApiNetworkError() }, "", true)).not.toContain("重试");
  });

  test("idle and successful nonempty lists do not render empty states", () => {
    expect(isEmptyLoad({ status: "idle" }, 0)).toBe(false);
    expect(isEmptyLoad({ status: "loading" }, 0)).toBe(false);
    expect(isEmptyLoad({ status: "success" }, 1)).toBe(false);
  });

  test("success and validation feedback do not offer a data reload", () => {
    expect(renderState({ status: "success" }, "报名成功")).not.toContain("重试");
    expect(renderState({ status: "idle" }, "请输入姓名")).not.toContain("重试");
  });
});
