import { ApiError, ApiNetworkError } from "@/lib/api/client";
import type { TranslationKey } from "@/lib/i18n/translations";

type Translate = (key: TranslationKey) => string;

const errorCodeTranslations: Partial<Record<string, TranslationKey>> = {
  ALREADY_TEAM_MEMBER: "common.alreadyTeamMember",
  DUPLICATE_MEMBERSHIP: "common.duplicateMembership",
  JOIN_REQUEST_PENDING: "common.joinRequestPending",
  LAST_ADMIN_REQUIRED: "common.lastAdminRequired",
  MEMBER_NOT_ELIGIBLE: "common.memberNotEligible"
};

const errorMessageTranslations: Partial<Record<string, TranslationKey>> = {
  "Insufficient coin balance": "common.insufficientCoins",
  "Insufficient stock": "common.insufficientStock",
  "Store item is not available": "common.storeItemUnavailable",
  "Only pending redemptions can be fulfilled": "common.redemptionNotPending",
  "Only pending redemptions can be cancelled": "common.redemptionNotPending",
  "Only fulfilled redemptions can be refunded": "common.redemptionNotFulfilled",
  "Match opponent is required before publishing": "common.matchOpponentRequired",
  "Signup deadline has passed": "common.signupDeadlinePassed",
  "Signup requires a published event": "common.eventNotPublished",
  "Completed events cannot be modified": "common.completedEventReadOnly",
  "Completed events cannot be deleted": "common.completedEventReadOnly",
  "Only published events can be completed": "common.eventNotPublished",
  "Match logs require a published match": "common.matchNotPublished"
};

function includesCjkText(value: string) {
  return /[\u3400-\u9FFF]/.test(value);
}

export function formatApiError(error: unknown, t: Translate) {
  if (error instanceof ApiNetworkError) {
    return t("common.networkUnavailable");
  }

  if (!(error instanceof ApiError)) {
    if (error instanceof Error && error.message) {
      return error.message;
    }
    return t("common.error");
  }

  if (error.status === 401) {
    return t("common.authRequired");
  }

  if (error.status === 403) {
    return t("common.permissionDenied");
  }

  if (error.status === 404 || error.code.endsWith("_RESOURCE_NOT_FOUND") || error.code.endsWith("_NOT_FOUND")) {
    return t("common.notFound");
  }

  if (error.status === 422 || error.code === "VALIDATION_ERROR") {
    return `${t("common.validationError")}: ${error.message}`;
  }

  const translatedCode = errorCodeTranslations[error.code];
  if (translatedCode) {
    return t(translatedCode);
  }

  const translatedMessage = errorMessageTranslations[error.message];
  if (translatedMessage) {
    return t(translatedMessage);
  }

  if (includesCjkText(error.message)) {
    return error.message;
  }

  if (error.status === 409 || error.code.endsWith("_STATE_CONFLICT")) {
    return t("common.stateConflict");
  }

  if (error.code === "INVALID_RESPONSE") {
    return t("common.invalidResponse");
  }

  if (error.status >= 500 || error.code === "INTERNAL_ERROR") {
    return t("common.error");
  }

  if (error.message && error.message !== "Request failed") {
    return error.message;
  }

  return t("common.error");
}
