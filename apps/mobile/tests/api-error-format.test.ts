import { describe, expect, test, vi } from "vitest";

import { formatApiError } from "../src/lib/api/errors";
import type { TranslationKey } from "../src/lib/i18n/translations";

const { TestApiError, TestApiNetworkError } = vi.hoisted(() => {
  class TestApiError extends Error {
    constructor(
      message: string,
      readonly status: number,
      readonly code: string
    ) {
      super(message);
    }
  }
  class TestApiNetworkError extends Error {
    readonly code = "NETWORK_UNAVAILABLE";
  }
  return { TestApiError, TestApiNetworkError };
});

vi.mock("@/lib/api/client", () => ({
  ApiError: TestApiError,
  ApiNetworkError: TestApiNetworkError
}));

const zhMessages: Partial<Record<TranslationKey, string>> = {
  "common.authRequired": "请先登录后继续",
  "common.permissionDenied": "当前账号没有权限执行此操作",
  "common.validationError": "输入校验失败",
  "common.networkUnavailable": "网络不可用，请检查连接后重试",
  "common.invalidResponse": "服务器响应异常，请稍后重试",
  "common.notFound": "未找到相关资源，请刷新后重试",
  "common.stateConflict": "当前状态不允许执行此操作，请刷新后重试",
  "common.lastAdminRequired": "球队至少需要保留一名有效管理员",
  "common.insufficientCoins": "金币余额不足",
  "common.insufficientStock": "库存不足",
  "common.matchOpponentRequired": "发布比赛前请先填写对手",
  "common.signupDeadlinePassed": "报名截止时间已过",
  "common.error": "操作失败"
};

function zh(key: TranslationKey) {
  return zhMessages[key] ?? key;
}

describe("formatApiError", () => {
  test("localizes authentication and permission errors", () => {
    expect(formatApiError(new TestApiError("Missing token", 401, "AUTH_REQUIRED"), zh)).toBe("请先登录后继续");
    expect(formatApiError(new TestApiError("Forbidden", 403, "FORBIDDEN"), zh)).toBe("当前账号没有权限执行此操作");
  });

  test("keeps validation detail visible for form fixes", () => {
    expect(formatApiError(new TestApiError("body.name: Required", 422, "VALIDATION_ERROR"), zh)).toBe(
      "输入校验失败: body.name: Required"
    );
  });

  test("uses backend and client SDK messages and falls back for unknown errors", () => {
    expect(formatApiError(new TestApiError("余额不足", 409, "STORE_RULE_CONFLICT"), zh)).toBe("余额不足");
    expect(formatApiError(new TestApiError("Resource not found", 404, "STORE_RESOURCE_NOT_FOUND"), zh)).toBe(
      "未找到相关资源，请刷新后重试"
    );
    expect(formatApiError(new TestApiError("Unexpected error", 500, "INTERNAL_ERROR"), zh)).toBe("操作失败");
    expect(formatApiError(new Error("Invalid login credentials"), zh)).toBe("Invalid login credentials");
    expect(formatApiError("unknown failure", zh)).toBe("操作失败");
    expect(formatApiError(new TestApiError("Request failed", 500, "REQUEST_FAILED"), zh)).toBe("操作失败");
  });

  test("localizes common backend business conflicts instead of leaking English service messages", () => {
    expect(formatApiError(new TestApiError("Insufficient coin balance", 409, "STORE_RULE_CONFLICT"), zh)).toBe(
      "金币余额不足"
    );
    expect(formatApiError(new TestApiError("Insufficient stock", 409, "STORE_RULE_CONFLICT"), zh)).toBe("库存不足");
    expect(formatApiError(new TestApiError("Match opponent is required before publishing", 409, "EVENT_STATE_CONFLICT"), zh)).toBe(
      "发布比赛前请先填写对手"
    );
    expect(formatApiError(new TestApiError("Signup deadline has passed", 409, "EVENT_STATE_CONFLICT"), zh)).toBe(
      "报名截止时间已过"
    );
    expect(formatApiError(new TestApiError("Team must keep one active admin", 409, "LAST_ADMIN_REQUIRED"), zh)).toBe(
      "球队至少需要保留一名有效管理员"
    );
    expect(formatApiError(new TestApiError("Only draft events can be published", 409, "EVENT_STATE_CONFLICT"), zh)).toBe(
      "当前状态不允许执行此操作，请刷新后重试"
    );
  });

  test("localizes network failures for offline recovery", () => {
    expect(formatApiError(new TestApiNetworkError("Network request failed"), zh)).toBe(
      "网络不可用，请检查连接后重试"
    );
  });

  test("localizes invalid API response errors instead of leaking English internals", () => {
    expect(formatApiError(new TestApiError("Invalid API response", 200, "INVALID_RESPONSE"), zh)).toBe(
      "服务器响应异常，请稍后重试"
    );
  });
});
