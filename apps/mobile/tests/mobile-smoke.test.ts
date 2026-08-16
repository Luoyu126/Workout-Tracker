import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test, vi } from "vitest";

import { translations, type TranslationKey } from "../src/lib/i18n/translations";

const currentDir = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(currentDir, "..");
const repoRoot = resolve(appRoot, "../..");

const requiredRoutes = [
  "app/_layout.tsx",
  "app/index.tsx",
  "app/login.tsx",
  "app/profile.tsx",
  "app/teams.tsx",
  "app/inbox.tsx",
  "app/teams/[teamId]/index.tsx",
  "app/teams/[teamId]/members.tsx",
  "app/teams/[teamId]/events.tsx",
  "app/teams/[teamId]/attendance-board.tsx",
  "app/teams/[teamId]/store.tsx",
  "app/teams/[teamId]/coins.tsx",
  "app/store-items/[storeItemId].tsx",
  "app/events/[eventId].tsx",
  "app/events/[eventId]/attendance.tsx",
  "app/events/[eventId]/live.tsx",
  "app/events/[eventId]/summary.tsx"
];

const screensToScan = requiredRoutes.filter((route) => route !== "app/_layout.tsx");

function functionBody(source: string, functionName: string) {
  const functionStart = source.indexOf(`async function ${functionName}`);
  expect(functionStart).toBeGreaterThanOrEqual(0);
  const nextFunctionStart = source.indexOf("\n  async function ", functionStart + 1);
  return source.slice(functionStart, nextFunctionStart === -1 ? undefined : nextFunctionStart);
}

function textInputBeforePlaceholder(source: string, placeholder: string, occurrence = 0) {
  let placeholderStart = -1;
  let searchFrom = 0;
  for (let index = 0; index <= occurrence; index += 1) {
    placeholderStart = source.indexOf(placeholder, searchFrom);
    expect(placeholderStart).toBeGreaterThanOrEqual(0);
    searchFrom = placeholderStart + placeholder.length;
  }
  const inputStart = source.lastIndexOf("<TextInput", placeholderStart);
  expect(inputStart).toBeGreaterThanOrEqual(0);
  return source.slice(inputStart, placeholderStart);
}

function allTextInputsBeforePlaceholder(source: string, placeholder: string) {
  const inputs: string[] = [];
  let searchFrom = 0;
  while (true) {
    const placeholderStart = source.indexOf(placeholder, searchFrom);
    if (placeholderStart === -1) {
      break;
    }
    const inputStart = source.lastIndexOf("<TextInput", placeholderStart);
    expect(inputStart).toBeGreaterThanOrEqual(0);
    inputs.push(source.slice(inputStart, placeholderStart));
    searchFrom = placeholderStart + placeholder.length;
  }
  expect(inputs.length).toBeGreaterThan(0);
  return inputs;
}

describe("mobile MVP smoke", () => {
  test("all MVP route files exist", () => {
    expect(requiredRoutes.map((route) => [route, existsSync(resolve(appRoot, route))])).toEqual(
      requiredRoutes.map((route) => [route, true])
    );
  });

  test("core list screens use shared loading, empty, error and retry state UI", () => {
    const stateComponent = readFileSync(resolve(appRoot, "src/components/ScreenState.tsx"), "utf-8");
    const layoutSource = readFileSync(resolve(appRoot, "app/_layout.tsx"), "utf-8");

    expect(stateComponent).toContain("loadingLabel");
    expect(stateComponent).toContain("retryLabel");
    expect(stateComponent).toContain("onRetry");
    expect(stateComponent).toContain("accessibilityLiveRegion");
    expect(stateComponent).toContain('href="/login"');
    expect(stateComponent).toContain("authRequiredLabel");
    expect(stateComponent).toContain("signInLabel");

    const errors = readFileSync(resolve(appRoot, "src/lib/api/errors.ts"), "utf-8");
    const i18nProvider = readFileSync(resolve(appRoot, "src/lib/i18n/I18nProvider.tsx"), "utf-8");
    const supabaseClient = readFileSync(resolve(appRoot, "src/lib/supabase/client.ts"), "utf-8");
    const supabaseConfig = readFileSync(resolve(appRoot, "src/lib/supabase/config.ts"), "utf-8");
    const translationsSource = readFileSync(resolve(appRoot, "src/lib/i18n/translations.ts"), "utf-8");

    expect(errors).toContain("ApiNetworkError");
    expect(errors).toContain("common.networkUnavailable");
    expect(errors).toContain("errorMessageTranslations");
    expect(errors).toContain("Insufficient coin balance");
    expect(errors).toContain("includesCjkText(error.message)");
    expect(errors).toContain("common.stateConflict");
    expect(translationsSource).toContain("网络不可用");
    expect(translationsSource).toContain("金币余额不足");
    expect(translationsSource).toContain("当前状态不允许执行此操作");
    expect(i18nProvider).toContain("loadPersistedLocale");
    expect(i18nProvider).toContain("persistLocale");
    expect(i18nProvider).toContain("storage.getItemAsync");
    expect(i18nProvider).toContain("storage.setItemAsync");
    expect(i18nProvider).toContain("setLocaleState(nextLocale)");
    expect(i18nProvider).toContain("Keep the default Chinese locale");
    expect(i18nProvider).toContain("Language switching should still work in-memory");
    expect(layoutSource).toContain("addNotificationResponseReceivedListener");
    expect(layoutSource).toContain("getLastNotificationResponseAsync");
    expect(layoutSource).toContain("clearLastNotificationResponseAsync");
    expect(layoutSource).toContain(".catch(() => undefined)");
    expect(layoutSource).toContain("getNotificationRoute");
    expect(layoutSource).toContain("router.push(route)");
    expect(layoutSource).toContain("Notification deep-link handling is best-effort");
    expect(layoutSource).toContain("subscription?.remove()");
    expect(layoutSource).toContain("refreshExpoPushTokenIfGrantedAsync");
    expect(layoutSource).toContain("registerDeviceToken");
    expect(layoutSource).toContain("AppState.addEventListener");
    expect(layoutSource).toContain('nextState === "active"');
    expect(layoutSource).toContain("Push token refresh is best-effort");
    expect(layoutSource).toContain("KeyboardAvoidingView");
    expect(layoutSource).toContain('behavior={Platform.OS === "ios" ? "padding" : undefined}');
    expect(layoutSource).toContain("keyboardAvoidingContainer");
    expect(supabaseClient).toContain("storage: AsyncStorage");
    expect(supabaseClient).toContain("autoRefreshToken: true");
    expect(supabaseClient).toContain("persistSession: true");
    expect(supabaseClient).toContain("supabaseConfig");
    expect(supabaseConfig).toContain("isConfigured");
    expect(supabaseConfig).toContain("isUsingDevelopmentPlaceholderKey");
    expect(supabaseConfig).toContain("isUsingDocumentationPlaceholderValue");
    expect(supabaseConfig).toContain("isDocumentationPlaceholderValue");
    expect(supabaseConfig).toContain("placeholderSupabaseAnonKeys");
    expect(supabaseConfig).toContain("developmentSupabaseAnonKeys");
    expect(supabaseConfig).toContain("dev-placeholder-anon-key");

    for (const route of ["app/teams.tsx", "app/inbox.tsx", "app/teams/[teamId]/events.tsx", "app/teams/[teamId]/store.tsx"]) {
      const source = readFileSync(resolve(appRoot, route), "utf-8");

      expect(source).toContain("ScreenState");
      expect(source).toContain('t("common.authRequired")');
      expect(source).toContain('t("common.loading")');
      expect(source).toContain('t("common.retry")');
      expect(source).toContain('t("home.openLogin")');
    }
  });

  test("core list screens auto-load on entry while keeping manual refresh buttons", () => {
    const autoLoadExpectations = [
      ["app/index.tsx", "handleLoadDashboard"],
      ["app/teams.tsx", "handleLoadTeams"],
      ["app/inbox.tsx", "handleLoadNotifications"],
      ["app/teams/[teamId]/events.tsx", "handleLoadEvents"],
      ["app/teams/[teamId]/store.tsx", "handleLoadItems"]
    ] as const;

    for (const [route, loader] of autoLoadExpectations) {
      const source = readFileSync(resolve(appRoot, route), "utf-8");

      expect(source).toContain("useEffect");
      expect(source).toContain(`void ${loader}();`);
      expect(source).toContain(`onPress={${loader}}`);
    }
  });

  test("teams screen displays accessible organizations alongside teams", () => {
    const source = readFileSync(resolve(appRoot, "app/teams.tsx"), "utf-8");

    expect(source).toContain("getMyOrganizations");
    expect(source).toContain("organizations");
    expect(source).toContain("teams.organizations");
    expect(source).toContain("teams.noOrganizations");
    expect(source).toContain("teamStatusFilter");
    expect(source).toContain("handleSelectTeamStatus");
    expect(source).toContain("teams.allStatuses");
    expect(source).toContain("teams.status.${status}");
    expect(source).toContain("disabled={isLoading}");
    expect(source).toContain("isLoading && styles.disabled");
    expect(source).toContain('getMyTeams({ status: "active" })');
    expect(source).toContain('getMyTeams({ status: "archived" })');
    expect(source).toContain("[...activeTeams, ...archivedTeams]");
  });

  test("store item detail screen loads item details and supports redemption", () => {
    const listSource = readFileSync(resolve(appRoot, "app/teams/[teamId]/store.tsx"), "utf-8");
    const detailSource = readFileSync(resolve(appRoot, "app/store-items/[storeItemId].tsx"), "utf-8");

    expect(listSource).toContain('pathname: "/store-items/[storeItemId]"');
    expect(listSource).toContain("store.detail");
    expect(detailSource).toContain("getStoreItem");
    expect(detailSource).toContain("redeemStoreItem");
    expect(detailSource).toContain("parseRedemptionQuantity");
    expect(detailSource).toContain("pendingRedemption");
    expect(detailSource).toContain("generateClientUuid");
    expect(detailSource).toContain("nextRedemption.id");
    expect(detailSource).toContain("setPendingRedemption(null)");
    expect(detailSource).toContain("canRedeemItem");
    expect(functionBody(detailSource, "handleRedeem")).toContain("if (!canRedeemItem(item))");
    expect(functionBody(detailSource, "handleRedeem")).toContain('setMessage(t("store.unavailable"))');
    expect(detailSource).toContain("store.noDescription");
    expect(detailSource).toContain('pathname: "/teams/[teamId]/store"');
    expect(detailSource).toContain('pathname: "/teams/[teamId]/coins"');
    expect(detailSource).toContain("scopedTeamId");
    expect(detailSource).toContain("ScreenState");
    const detailQuantityInput = textInputBeforePlaceholder(detailSource, 'placeholder={t("store.quantity")}');
    expect(detailQuantityInput).toContain("autoCorrect={false}");
    expect(detailQuantityInput).toContain('keyboardType="number-pad"');
  });

  test("detail and management screens auto-load and use shared state UI", () => {
    const autoLoadExpectations = [
      ["app/teams/[teamId]/index.tsx", "handleLoadHome"],
      ["app/teams/[teamId]/members.tsx", "handleLoadMembers"],
      ["app/teams/[teamId]/coins.tsx", "handleLoadCoins"],
      ["app/teams/[teamId]/attendance-board.tsx", "handleLoadBoard"],
      ["app/events/[eventId].tsx", "handleLoadEvent"],
      ["app/events/[eventId]/attendance.tsx", "handleLoadAttendance"],
      ["app/events/[eventId]/live.tsx", "handleLoadBoard"],
      ["app/events/[eventId]/summary.tsx", "handleLoadSummary"]
    ] as const;

    for (const [route, loader] of autoLoadExpectations) {
      const source = readFileSync(resolve(appRoot, route), "utf-8");

      expect(source).toContain("ScreenState");
      expect(source).toContain("useEffect");
      expect(source).toContain(`void ${loader}();`);
      expect(source).toContain(`onPress={${loader}}`);
      expect(source).toContain('t("common.authRequired")');
      expect(source).toContain('t("common.loading")');
      expect(source).toContain('t("common.retry")');
      expect(source).toContain('t("home.openLogin")');
    }
  });

  test("API-backed screens format authentication, permission and validation errors", () => {
    const apiBackedScreens = [
      "app/index.tsx",
      "app/login.tsx",
      "app/profile.tsx",
      "app/teams.tsx",
      "app/inbox.tsx",
      "app/teams/[teamId]/index.tsx",
      "app/teams/[teamId]/members.tsx",
      "app/teams/[teamId]/events.tsx",
      "app/teams/[teamId]/attendance-board.tsx",
      "app/teams/[teamId]/coins.tsx",
      "app/teams/[teamId]/store.tsx",
      "app/events/[eventId].tsx",
      "app/events/[eventId]/attendance.tsx",
      "app/events/[eventId]/live.tsx",
      "app/events/[eventId]/summary.tsx"
    ];

    for (const route of apiBackedScreens) {
      const source = readFileSync(resolve(appRoot, route), "utf-8");

      expect(source).toContain("formatApiError");
    }

    const homeSource = readFileSync(resolve(appRoot, "app/index.tsx"), "utf-8");
    expect(homeSource).toContain("ScreenState");
    expect(homeSource).toContain('t("common.authRequired")');
    expect(homeSource).toContain('t("common.loading")');
    expect(homeSource).toContain('t("common.retry")');
    expect(homeSource).toContain('t("home.openLogin")');
    expect(homeSource).toContain("onRetry={handleLoadDashboard}");
  });

  test("all referenced translation keys exist in Chinese and English", () => {
    const referencedKeys = new Set<string>();
    const translationCallPattern = /t\("([^"]+)"\)/g;

    for (const route of screensToScan) {
      const source = readFileSync(resolve(appRoot, route), "utf-8");
      for (const match of source.matchAll(translationCallPattern)) {
        referencedKeys.add(match[1]);
      }
    }

    const zh = translations["zh-CN"] satisfies Record<TranslationKey, string>;
    const en = translations.en satisfies Record<TranslationKey, string>;
    expect([...referencedKeys].sort()).toEqual(
      [...referencedKeys].filter((key) => key in zh && key in en).sort()
    );
    expect(referencedKeys.size).toBeGreaterThan(20);
  });

  test("home screen uses live team data instead of static demo metrics", () => {
    const source = readFileSync(resolve(appRoot, "app/index.tsx"), "utf-8");

    expect(source).toContain("getMyTeams");
    expect(source).toContain("getTeamHome");
    expect(source).toContain("LanguageToggle");
    expect(source).toContain("selectedTeamId");
    expect(source).toContain("handleSelectTeam");
    expect(source).toContain("home.switchTeam");
    expect(source).toContain("home.currentTeam");
    expect(source).not.toContain("周二训练");
    expect(source).not.toContain("86%");
  });

  test("login screen supports sign-in without forcing profile fields and syncs unsynced users", () => {
    const source = readFileSync(resolve(appRoot, "app/login.tsx"), "utf-8");
    const signInBody = functionBody(source, "handleSignIn");

    expect(source).toContain("didAuthenticate");
    expect(source).toContain("getMyProfile");
    expect(source).toContain("syncProfile");
    expect(source).toContain("buildProfileInput");
    expect(source).toContain("normalizeAuthCredentials");
    expect(source).toContain("normalizeProfileInput");
    expect(source).toContain("USER_NOT_SYNCED");
    expect(source).toContain("LanguageToggle");
    expect(source).toContain("auth.signInNeedsProfile");
    expect(source).toContain("auth.signInSyncedProfile");
    expect(source).toContain("auth.nameRequired");
    expect(source).toContain("auth.credentialsRequired");
    expect(source).toContain("auth.supabaseConfigMissing");
    expect(source).toContain("supabaseConfig.isConfigured");
    expect(source).toContain("auth.apiConfigMissing");
    expect(source).toContain("apiConfig.isConfigured");
    expect(source).toContain("apiConfig.isMalformed");
    expect(source).toContain("disabled={isSubmitting || !supabaseConfig.isConfigured}");
    expect(source).toContain("auth.signUpNeedsSignIn");
    expect(source).toContain('autoComplete="name"');
    expect(source).toContain('textContentType="name"');
    expect(source).toContain('autoComplete="email"');
    expect(source).toContain('textContentType="emailAddress"');
    expect(source).toContain('autoComplete="password"');
    expect(source).toContain('textContentType="password"');
    expect(source).toContain("secureTextEntry");
    expect(source).toContain("autoCorrect={false}");
    expect(source).toContain('href="/teams"');
    expect(source).toContain("home.openTeams");
    expect(source).toContain("ScrollView");
    expect(signInBody).not.toContain("buildProfileInput()");
  });

  test("profile screen validates and normalizes profile updates", () => {
    const source = readFileSync(resolve(appRoot, "app/profile.tsx"), "utf-8");

    expect(source).toContain("useEffect");
    expect(source).toContain("void handleLoadProfile();");
    expect(source).toContain("LanguageToggle");
    expect(source).toContain("ScreenState");
    expect(source).toContain("normalizeProfileInput");
    expect(source).toContain("formatApiError");
    expect(source).toContain("auth.nameRequired");
    expect(source).toContain("avatarUrl");
    expect(source).toContain("profile.avatarUrl");
    expect(source).toContain("<Image");
    expect(source).toContain('autoComplete="name"');
    expect(source).toContain('textContentType="name"');
    expect(source).toContain('keyboardType="url"');
    expect(source).toContain('textContentType="URL"');
    expect(source).toContain("autoCorrect={false}");
    expect(source).toContain("syncProfile(profileInput)");
    expect(source).toContain("updateProfile(profileInput)");
    expect(source).toContain('href="/teams"');
    expect(source).toContain("home.openTeams");
    expect(source).toContain('href="/inbox"');
    expect(source).toContain("profile.notificationSettings");
    expect(source).toContain("style={[styles.secondaryButton, isSubmitting && styles.disabled]}");
    expect(source).toContain("style={[styles.dangerButton, isSubmitting && styles.disabled]}");
    for (const handlerName of ["handleSyncProfile", "handleLoadProfile", "handleUpdateProfile", "handleSignOut"]) {
      expect(functionBody(source, handlerName)).toContain("if (isSubmitting)");
    }
    expect(source).toContain("ScrollView");
  });

  test("team home exposes captain or admin team profile management", () => {
    const source = readFileSync(resolve(appRoot, "app/teams/[teamId]/index.tsx"), "utf-8");

    expect(source).toContain("updateTeam");
    expect(source).toContain("current_membership");
    expect(source).toContain("canManageTeam");
    expect(source).toContain("canUpdateTeamStatus");
    expect(source).toContain("teamHome.manageTeam");
    expect(source).toContain("teamHome.saveTeam");
    expect(source).toContain("teamHome.archiveTeam");
    expect(source).toContain("teamHome.activateTeam");
    expect(source).toContain("teamHome.archiveConfirmTitle");
    expect(source).toContain("teamHome.archiveConfirmBody");
    expect(source).toContain("teamHome.activateConfirmTitle");
    expect(source).toContain("teamHome.activateConfirmBody");
    expect(source).toContain("teamHome.captainOnlyHint");
    expect(source).toContain("teamHome.adminOnlyHint");
    expect(source).toContain('home?.current_membership.role === "captain"');
    expect(source).toContain('home?.current_membership.role === "admin"');
    expect(functionBody(source, "handleUpdateTeam")).toContain("if (!canManageTeam)");
    expect(functionBody(source, "handleUpdateTeam")).toContain("if (statusOverride && !canUpdateTeamStatus)");
    expect(source).toContain("function handleUpdateTeamStatus");
    expect(source).toContain("if (!canUpdateTeamStatus)");
    expect(source).toContain("Alert.alert");
    expect(source).toContain("onPress: () => void handleUpdateTeam(nextStatus)");
    expect(source).toContain("onPress={() => handleUpdateTeamStatus(home.team.status === \"active\" ? \"archived\" : \"active\")}");
    expect(source).toContain("style={[styles.secondaryButton, isLoading && styles.disabled]}");
    expect(source).toContain("normalizeTeamName");
    expect(source).toContain("teamLogoUrl");
    expect(source).toContain("teamHome.logoUrl");
    expect(source).toContain("logo_url: normalizeOptionalTeamText(teamLogoUrl)");
    expect(source).toContain("<Image");
    expect(source).toContain("teamHome.invalidName");
    expect(source).toContain('pathname: "/inbox"');
    expect(source).toContain("teams.inbox");
    expect(source).toContain("events.${event.type}");
  });

  test("event detail exposes current signup and not-going note input", () => {
    const source = readFileSync(resolve(appRoot, "app/events/[eventId].tsx"), "utf-8");

    expect(source).toContain("getMySignup");
    expect(source).toContain("signupNote");
    expect(source).toContain("events.signupNote");
    expect(source).toContain("events.signupNoteRequired");
    expect(source).toContain("canUpdateSignup");
    expect(source).toContain('event?.status === "published"');
    expect(source).toContain("isSignupOpen(event.signup_deadline, event.start_time)");
    expect(source).toContain("events.signupReadonly");
    expect(functionBody(source, "handleSignup")).toContain("if (!canUpdateSignup)");
    expect(functionBody(source, "handleSignup")).toContain('setMessage(t("events.signupReadonly"))');
    expect(functionBody(source, "handleSignup")).toContain('status === "not_going" ? normalizedNote : null');
    expect(functionBody(source, "handleSignup")).toContain('setSignupNote(savedSignup.note ?? "")');
    expect(source).toContain("events.mySignup");
    expect(source).toContain("events.matchDetails");
    expect(source).toContain("events.status.${event.status}");
    expect(source).toContain("events.teamScore");
    expect(source).toContain("events.opponentScore");
    expect(source).toContain("events.result.${result}");
    expect(source).toContain("match_details");
    expect(source).toContain("parseIsoDateTime");
    expect(source).toContain("parseOptionalNonNegativeInteger");
    expect(source).toContain("isValidEventSchedule");
    expect(source).toContain("isValidMatchScoreResult");
    expect(source).toContain("events.invalidEventInput");
    expect(source).toContain("events.invalidSchedule");
    expect(source).toContain("events.invalidMatchInput");
    expect(source).toContain("events.invalidMatchScoreResult");
    expect(source).toContain("getTeamHome");
    expect(source).toContain("currentRole");
    expect(source).toContain("setCurrentRole(bundle.currentRole)");
    expect(source).toContain("canManageEvent");
    expect(source).toContain("canManageEventStatus");
    expect(source).toContain("canManageEventRole");
    expect(source).toContain('currentRole === "captain" || currentRole === "admin"');
    expect(source).toContain('event?.status === "draft" || event?.status === "published"');
    expect(source).toContain("events.manageReadonly");
    expect(source).toContain("events.captainOnlyHint");
    expect(source).toContain("if (!canManageEventRole)");
    expect(source).toContain("if (!canManageEventStatus)");
    expect(functionBody(source, "performDeleteEvent")).toContain("if (!canManageEventRole)");
    expect(functionBody(source, "performDeleteEvent")).toContain("if (!canManageEventStatus)");
    expect(source).toContain("Alert.alert");
    expect(source).toContain("performDeleteEvent");
    expect(source).toContain("events.deleteConfirmTitle");
    expect(source).toContain("events.deleteConfirmBody");
    expect(source).toContain("events.deleteConfirmAction");
    expect(source).toContain("common.cancel");
    expect(source).toContain("applyLoadedEvent");
    expect(source).toContain("loadEventBundle");
    expect(source).toContain("refreshEventSilently");
    expect(source).toContain("await refreshEventSilently();");
    expect(source).toContain("editDescription");
    expect(source).toContain("editStartTime");
    expect(source).toContain("editEndTime");
    expect(source).toContain("editSignupDeadline");
    expect(source).toContain("editMatchResult === result && styles.activeButton");
    expect(source).toContain("editMatchResult === result && styles.activeButton,\n                      isLoading && styles.disabled");
    expect(source).toContain("autoCorrect={false}");
    expect(source).toContain("style={[styles.secondaryButton, isLoading && styles.disabled]}");
    expect(source).toContain("style={[styles.dangerButton, isLoading && styles.disabled]}");
    expect(source).toContain("signup_deadline: parsedSignupDeadline");
    expect(source).toContain("setEvent(null)");
    expect(source).toContain("useRouter");
    expect(source).toContain("const deletedTeamId = event?.team_id ?? null;");
    expect(source).toContain('router.replace({ pathname: "/teams/[teamId]/events", params: { teamId: deletedTeamId } })');
    expect(source).toContain("event && eventId ? (");
    expect(source).toContain('pathname: "/events/[eventId]/attendance"');
  });

  test("event creation exposes scheduling, signup deadline and match notes fields", () => {
    const source = readFileSync(resolve(appRoot, "app/teams/[teamId]/events.tsx"), "utf-8");
    const validationSource = readFileSync(resolve(appRoot, "src/features/events/validation.ts"), "utf-8");

    expect(source).toContain("events.description");
    expect(source).toContain("events.endTime");
    expect(source).toContain("events.signupDeadline");
    expect(source).toContain("events.matchNotes");
    expect(source).toContain("getTeamHome");
    expect(source).toContain("currentRole");
    expect(source).toContain("setCurrentRole(teamHome.current_membership.role)");
    expect(source).toContain("canManageEvents");
    expect(source).toContain('currentRole === "captain" || currentRole === "admin"');
    expect(source).toContain("!canManageEvents");
    expect(source).toContain("if (!canManageEvents)");
    expect(functionBody(source, "handleLoadEvents")).not.toContain("if (!canManageEvents)");
    expect(source).toContain("filterType");
    expect(source).toContain("filterStatus");
    expect(source).toContain("buildEventsQuery");
    expect(source).toContain("loadEvents");
    expect(source).toContain("handleSelectFilterType");
    expect(source).toContain("handleSelectFilterStatus");
    expect(source).toContain("onPress={() => handleSelectFilterType(type)}");
    expect(source).toContain("onPress={() => handleSelectFilterStatus(status)}");
    expect(source).toContain("onPress={() => setEventType(\"training\")}");
    expect(source).toContain("onPress={() => setEventType(\"match\")}");
    expect(source).toContain("style={[styles.pillButton, eventType === \"training\" && styles.activePill, isLoading && styles.disabled]}");
    expect(source).toContain("style={[styles.pillButton, eventType === \"match\" && styles.activePill, isLoading && styles.disabled]}");
    expect(source).toContain("style={[styles.pillButton, filterType === type && styles.activePill, isLoading && styles.disabled]}");
    expect(source).toContain("style={[styles.pillButton, filterStatus === status && styles.activePill, isLoading && styles.disabled]}");
    expect(source).toContain("await loadEvents(filterType, filterStatus, { showEmptyMessage: false });");
    expect(source).toContain("startsAfter");
    expect(source).toContain("startsBefore");
    expect(source).toContain("events.filters");
    expect(source).toContain("events.captainOnlyHint");
    expect(source).toContain("signup_deadline");
    expect(source).toContain("end_time");
    expect(source).toContain("parseIsoDateTime");
    expect(source).toContain("parseOptionalIsoDateTime");
    expect(validationSource).toContain("isoDateTimePattern");
    expect(validationSource).toContain("T\\d{2}:\\d{2}");
    expect(validationSource).toContain("(?:Z|[+-]\\d{2}:\\d{2})");
    expect(source).toContain("events.invalidDateTime");
    expect(source).toContain("events.invalidEventInput");
    expect(source).toContain("isValidEventSchedule");
    expect(source).toContain("events.invalidSchedule");
    expect(source).toContain("events.invalidMatchInput");
    expect(source).toContain("getDefaultStartTime");
    expect(source).toContain("createdEvent");
    expect(source).toContain("setCreatedEvent(createdEvent)");
    expect(source).toContain("params: { eventId: createdEvent.id }");
    for (const key of [
      "events.startTime",
      "events.endTime",
      "events.signupDeadline",
      "events.startsAfter",
      "events.startsBefore"
    ]) {
      expect(source.split(`placeholder={t("${key}")}`)[0].slice(-220)).toContain("autoCorrect={false}");
    }
    expect(source.split('placeholder={t("events.opponent")}')[0].slice(-180)).toContain("autoCorrect={false}");
    expect(functionBody(source, "handleCreateEvent")).toContain('setTitle("");');
    expect(functionBody(source, "handleCreateEvent")).toContain('setDescription("");');
    expect(functionBody(source, "handleCreateEvent")).toContain('setLocation("");');
    expect(functionBody(source, "handleCreateEvent")).toContain("setStartTime(getDefaultStartTime());");
    expect(functionBody(source, "handleCreateEvent")).toContain('setEndTime("");');
    expect(functionBody(source, "handleCreateEvent")).toContain('setSignupDeadline("");');
    expect(functionBody(source, "handleCreateEvent")).toContain('setOpponent("");');
    expect(functionBody(source, "handleCreateEvent")).toContain('setMatchNotes("");');
    expect(source).not.toContain('useState("周末训练")');
    expect(source).not.toContain('useState("主球场")');
    expect(source).not.toContain('useState("对手球队")');
  });

  test("coin screen exposes ledger and keeps negative adjustment input possible", () => {
    const source = readFileSync(resolve(appRoot, "app/teams/[teamId]/coins.tsx"), "utf-8");
    const apiSource = readFileSync(resolve(appRoot, "src/features/coins/api.ts"), "utf-8");
    const validationSource = readFileSync(resolve(appRoot, "src/features/coins/validation.ts"), "utf-8");

    expect(apiSource).toContain('"training_attendance" | "match_attendance" | "late_attendance" | "manual"');
    expect(source).toContain('type AttendanceCoinRuleTrigger = Exclude<CoinRuleTrigger, "manual">');
    expect(source).toContain("selectEffectiveCoinRule");
    expect(validationSource).toContain("selectEffectiveCoinRule");
    expect(validationSource).toContain("rule.trigger_type === triggerType && rule.is_active");
    expect(validationSource).toContain("right.updated_at.localeCompare(left.updated_at)");
    expect(source).toContain("refreshCoinData");
    expect(source).toContain("await refreshCoinData();");
    expect(source).toContain("getTeamHome");
    expect(source).toContain("currentRole");
    expect(source).toContain("setCurrentRole(nextRole)");
    expect(source).toContain("canManageCoins");
    expect(source).toContain("canAdjustCoins");
    expect(source).toContain('nextRole === "captain" || nextRole === "admin"');
    expect(source).toContain('currentRole === "admin"');
    expect(source).toContain("!canManageCoins");
    expect(source).toContain("!canAdjustCoins");
    expect(functionBody(source, "handleLoadCoins")).not.toContain("if (!canManageCoins)");
    expect(source).toContain("coins.adminOnlyHint");
    expect(source).toContain("coins.rules");
    expect(source).toContain("getMyCoinTransactions");
    expect(source).toContain("getMemberCoinTransactions");
    expect(source).toContain("getTeamMembers");
    expect(source).toContain("parseCoinRuleAmount");
    expect(functionBody(source, "handleSaveRule").indexOf("parseCoinRuleAmount(amounts[trigger])")).toBeLessThan(
      functionBody(source, "handleSaveRule").indexOf("setIsLoading(true)")
    );
    expect(source).toContain("parseManualCoinAmount");
    expect(source).toContain("normalizeCoinTargetUserId");
    expect(source).toContain("normalizeCoinReason");
    expect(source).toContain("pendingManualAdjustment");
    expect(source).toContain("generateClientUuid");
    expect(source).toContain("id: nextManualAdjustment.id");
    expect(source).toContain("setPendingManualAdjustment(null)");
    expect(source).toContain("coins.invalidAmount");
    expect(source).toContain("coins.invalidManualAmount");
    expect(source).toContain("coins.invalidUserId");
    expect(source).toContain("handleLoadMemberTransactions(membership.user_id)");
    expect(source).toContain("coins.chooseMember");
    expect(source).toContain("coins.memberTransactions");
    expect(source).toContain('<Text style={styles.cardTitle}>{t("coins.chooseMember")}</Text>');
    expect(source.match(/<Text style=\{styles\.cardTitle\}>\{t\("coins\.memberTransactions"\)\}<\/Text>/g)).toHaveLength(1);
    expect(source).toContain("coins.myTransactions");
    expect(source).toContain("transactionType");
    expect(source).toContain("memberTransactionType");
    expect(source).toContain("handleSelectTransactionType");
    expect(source).toContain("handleSelectMemberTransactionType");
    expect(source).toContain("onPress={() => handleSelectTransactionType(type)}");
    expect(source).toContain("onPress={() => handleSelectMemberTransactionType(type)}");
    expect(source).toContain(
      "style={[styles.pillButton, transactionType === type && styles.activeButton, isLoading && styles.disabled]}"
    );
    expect(source).toContain("memberTransactionType === type && styles.activeButton");
    expect(source).toContain("setTransactions(await getMyCoinTransactions(teamId, transactionQuery))");
    expect(source).toContain("setMemberTransactions(await getMemberCoinTransactions(teamId, normalizedUserId, memberTransactionQuery))");
    expect(source).toContain("buildTransactionQuery");
    expect(source).toContain("parseOptionalIsoDateTime");
    expect(source).toContain("coins.filters");
    expect(source).toContain("coins.allTransactionTypes");
    expect(source).toContain("coins.createdAfter");
    expect(source).toContain("coins.createdBefore");
    expect(source).toContain("coins.invalidDateTime");
    expect(source).toContain("coins.captainOnlyHint");
    expect(source).not.toContain('useState("手工调整")');
    expect(source).toContain("getMyCoinTransactions(teamId, transactionQuery)");
    expect(source).toContain("getMemberCoinTransactions(teamId, normalizedUserId, memberTransactionQuery)");
    expect(source).toContain("transaction.amount > 0");
    const rewardRuleAmountInput = textInputBeforePlaceholder(source, "placeholder={ruleInput.defaultAmount}");
    expect(rewardRuleAmountInput).toContain("autoCorrect={false}");
    expect(rewardRuleAmountInput).toContain('keyboardType="number-pad"');
    const adjustmentPlaceholderStart = source.indexOf('placeholder={t("coins.adjustAmount")}');
    const adjustmentInputStart = source.lastIndexOf("<TextInput", adjustmentPlaceholderStart);
    const adjustmentInputEnd = source.indexOf('placeholder={t("coins.adjustReason")}');

    expect(adjustmentPlaceholderStart).toBeGreaterThan(0);
    expect(adjustmentInputStart).toBeGreaterThan(0);
    expect(adjustmentInputEnd).toBeGreaterThan(adjustmentInputStart);
    expect(source.slice(adjustmentInputStart, adjustmentInputEnd)).toContain('keyboardType="numbers-and-punctuation"');
    expect(source.slice(adjustmentInputStart, adjustmentInputEnd)).toContain("autoCorrect={false}");
    expect(source.slice(adjustmentInputEnd - 180, adjustmentInputEnd)).toContain("autoCorrect={false}");
    expect(source).toContain("style={[styles.secondaryButton, isLoading && styles.disabled]}");
    expect(source).toContain("styles.memberButton");
    expect(source).toContain("isLoading && styles.disabled");
    expect(source).toContain("autoCorrect={false}");
  });

  test("inbox links actionable notifications back to relevant MVP screens", () => {
    const source = readFileSync(resolve(appRoot, "app/inbox.tsx"), "utf-8");

    expect(source).toContain("renderNotificationLink");
    expect(source).toContain("createTeamAnnouncement");
    expect(source).toContain("handleCreateAnnouncement");
    expect(source).toContain("useLocalSearchParams");
    expect(source).toContain("scopedTeamId");
    expect(source).toContain("setAnnouncementTeamId(scopedTeamId)");
    expect(source).toContain("const normalizedTeamId = scopedTeamId ?? announcementTeamId.trim();");
    expect(source).toContain("getTeamHome");
    expect(source).toContain("getMyTeams");
    expect(source).toContain("announcementTeams");
    expect(source).toContain('getMyTeams({ status: "active" })');
    expect(source).toContain("setAnnouncementTeams(nextAnnouncementTeams)");
    expect(source).toContain("currentRole");
    expect(source).toContain("setCurrentRole(teamHome?.current_membership.role ?? null)");
    expect(source).toContain("canSendScopedAnnouncement");
    expect(source).toContain('currentRole === "captain" || currentRole === "admin"');
    expect(source).toContain("if (!canSendScopedAnnouncement)");
    expect(functionBody(source, "handleLoadNotifications")).not.toContain("if (!canSendScopedAnnouncement)");
    expect(source).toContain("inbox.captainOnlyHint");
    expect(source).toContain("loadNotifications");
    expect(source).toContain("handleToggleUnreadOnly");
    expect(source).toContain("const nextUnreadOnly = !unreadOnly");
    expect(source).toContain("await loadNotifications(nextUnreadOnly, { showEmptyMessage: true });");
    expect(source).toContain("onPress={handleToggleUnreadOnly}");
    expect(source).toContain("style={[styles.smallButton, unreadOnly && styles.activeButton, isLoading && styles.disabled]}");
    expect(source).toContain("getNotifications({ teamId: scopedTeamId, unreadOnly: nextUnreadOnly })");
    expect(source).toContain("getUnreadCount({ teamId: scopedTeamId })");
    expect(source).toContain("getDefaultDevicePlatform");
    expect(source).toContain("requestExpoPushTokenAsync");
    expect(source).toContain("normalizeExpoPushToken");
    expect(source).toContain("inbox.invalidDeviceToken");
    expect(source.split('placeholder={t("inbox.deviceToken")}')[0].slice(-180)).toContain("autoCorrect={false}");
    expect(source).toContain("inbox.autoRegisterDevice");
    expect(source).toContain("style={[styles.smallButton, devicePlatform === platform && styles.activeButton, isLoading && styles.disabled]}");
    expect(source).toContain("style={[styles.secondaryButton, isLoading && styles.disabled]}");
    expect(source).toContain("style={[styles.dangerButton, isLoading && styles.disabled]}");
    expect(source).toContain("inbox.notificationPermissionDenied");
    expect(source).toContain("inbox.notificationUnsupported");
    expect(source).toContain("inbox.scopedAnnouncementHint");
    expect(source).toContain("inbox.chooseAnnouncementTeam");
    expect(source).toContain("inbox.noAnnouncementTeams");
    expect(source).toContain("announcementTeams.map((team)");
    expect(source).toContain("onPress={() => setAnnouncementTeamId(team.id)}");
    expect(source).toContain("announcementTeamId === team.id");
    expect(source).toContain("style={[styles.teamButton, announcementTeamId === team.id && styles.activeButton, isLoading && styles.disabled]}");
    expect(source).toContain("inbox.announcementTeamId");
    expect(source.split('placeholder={t("inbox.announcementTeamId")}')[0].slice(-180)).toContain("autoCorrect={false}");
    expect(source).toContain("inbox.sendAnnouncement");
    expect(source).toContain("inbox.announcementSent");
    expect(source).toContain('reference_type === "event"');
    expect(source).toContain('reference_type === "event_snapshot"');
    expect(source).toContain("inbox.eventSnapshotHint");
    expect(source).toContain('reference_type === "coin_transaction"');
    expect(source).toContain('reference_type === "redemption"');
    expect(source).toContain('reference_type === "team"');
    expect(source).toContain("inbox.openEvent");
    expect(source).toContain("inbox.openCoins");
    expect(source).toContain("inbox.openStore");
    expect(source).toContain("inbox.openTeam");
    expect(source).toContain("updateMySignup");
    expect(source).toContain("isActionableEventNotification");
    const actionableEventHelperStart = source.indexOf("function isActionableEventNotification");
    const actionableEventHelperEnd = source.indexOf("\nexport default function InboxScreen", actionableEventHelperStart);
    const actionableEventHelperBody = source.slice(actionableEventHelperStart, actionableEventHelperEnd);
    expect(actionableEventHelperBody).toContain('notification.reference_type === "event"');
    expect(actionableEventHelperBody).toContain("notification.reference_id !== null");
    expect(actionableEventHelperBody).not.toContain("event_snapshot");
    expect(actionableEventHelperBody).not.toContain("event_deleted");
    expect(source).toContain("handleQuickSignup");
    expect(source).toContain("renderEventQuickSignup");
    expect(source).toContain("signupNotesByNotificationId");
    expect(functionBody(source, "handleQuickSignup")).toContain("if (!isActionableEventNotification(notification))");
    expect(source).toContain("function renderEventQuickSignup(notification: Notification)");
    expect(source).toContain("if (!isActionableEventNotification(notification))");
    expect(functionBody(source, "handleQuickSignup")).toContain('status === "not_going" ? note : null');
    expect(functionBody(source, "handleQuickSignup")).toContain('status === "not_going" ? note : ""');
    expect(source).toContain("events.signupNoteRequired");
    expect(source).toContain("events.signupSaved");
    expect(source).toContain("inbox.quickSignup");
    expect(source).toContain('onPress={() => handleQuickSignup(notification, "not_going")}');
    expect(source).toContain("style={[styles.smallButton, isLoading && styles.disabled]}");
    expect(source).toContain("style={[styles.secondaryButton, isLoading && styles.disabled]}");
    expect(source).toContain("onPress={() => handleMarkRead(notification.id)}");
  });

  test("store screen separates player and captain redemption flows", () => {
    const source = readFileSync(resolve(appRoot, "app/teams/[teamId]/store.tsx"), "utf-8");

    expect(source).toContain("refreshStoreData");
    expect(source).toContain("await refreshStoreData();");
    expect(source).toContain("getTeamHome");
    expect(source).toContain("currentRole");
    expect(source).toContain("setCurrentRole(nextRole)");
    expect(source).toContain("canManageStore");
    expect(source).toContain('nextRole === "captain" || nextRole === "admin"');
    expect(source).toContain("!canManageStore");
    expect(functionBody(source, "handleLoadItems")).not.toContain("if (!canManageStore)");
    expect(source).toContain("store.manage");
    expect(source).toContain("await createStoreItem(teamId, {");
    expect(source).not.toContain("setItems((currentItems) => [createdItem, ...currentItems])");
    expect(source).toContain("getMyRedemptions");
    expect(source).toContain("managedRedemptions");
    expect(source).toContain("myRedemptionStatus");
    expect(source).toContain("managedRedemptionStatus");
    expect(source).toContain("getMyRedemptions(teamId, { status: myRedemptionStatus })");
    expect(source).toContain("getTeamRedemptions(teamId, { status: managedRedemptionStatus })");
    expect(source).toContain("itemActiveFilter");
    expect(source).toContain("itemActiveFilters");
    expect(source).toContain("redemptionStatuses");
    expect(source).toContain("getStoreItems(teamId, { isActive: canManageWithNextRole ? itemActiveFilter : true })");
    expect(source).toContain("style={[styles.pillButton, itemActiveFilter === isActive && styles.activePill, isLoading && styles.disabled]}");
    expect(source).toContain("style={[styles.pillButton, myRedemptionStatus === status && styles.activePill, isLoading && styles.disabled]}");
    expect(source).toContain("style={[styles.pillButton, managedRedemptionStatus === status && styles.activePill, isLoading && styles.disabled]}");
    expect(source).toContain("store.items");
    expect(source).toContain("store.allItems");
    expect(source).toContain("store.captainOnlyHint");
    expect(source).toContain("store.myRedemptions");
    expect(source).toContain("store.manageRedemptions");
    expect(source).toContain("redemptionUserLabel");
    expect(source).toContain("store.redeemedBy");
    expect(source).toContain("redemption.user?.email");
    expect(source).toContain("store.allRedemptionStatuses");
    expect(source).toContain("redemptionQuantities");
    expect(source).toContain("pendingRedemptions");
    expect(source).toContain("generateClientUuid");
    expect(source).toContain("store.quantity");
    expect(source).toContain("async function handleRedeem(item: StoreItem)");
    expect(functionBody(source, "handleRedeem")).toContain("if (!canRedeemItem(item))");
    expect(functionBody(source, "handleRedeem")).toContain('setMessage(t("store.unavailable"))');
    expect(functionBody(source, "handleRedeem")).toContain("redemptionQuantities[item.id]");
    expect(functionBody(source, "handleRedeem")).toContain("pendingRedemptions[item.id]");
    expect(source).toContain("redeemStoreItem(teamId, item.id, quantity, nextRedemption.id)");
    expect(source).toContain("onPress={() => handleRedeem(item)}");
    expect(source).not.toContain("onPress={() => handleRedeem(item.id)}");
    expect(source).toContain("canRedeemItem");
    expect(source).toContain("item.is_active && (item.stock === null || item.stock > 0)");
    expect(functionBody(source, "handleRestock")).toContain("item.stock === null");
    expect(functionBody(source, "handleRestock")).toContain('setMessage(t("store.unlimitedStock"))');
    expect(functionBody(source, "handleRestock")).toContain("stock: item.stock + 1");
    expect(functionBody(source, "handleRestock")).not.toContain("(item.stock ?? 0) + 1");
    expect(source).toContain("store.unavailable");
    expect(source).toContain("itemDrafts");
    expect(source).toContain("applyItems");
    expect(source).toContain("applyUpdatedItem");
    expect(source).toContain("handleUpdateItemProfile");
    expect(source).toContain("normalizeOptionalImageUrl");
    expect(source).toContain("image_url: normalizeOptionalImageUrl");
    expect(source).toContain("store.imageUrl");
    expect(source).toContain("resetCreateItemForm");
    expect(functionBody(source, "handleCreateItem")).toContain("const emptyForm = resetCreateItemForm();");
    expect(functionBody(source, "handleCreateItem")).toContain("setName(emptyForm.name);");
    expect(functionBody(source, "handleCreateItem")).toContain("setDescription(emptyForm.description);");
    expect(functionBody(source, "handleCreateItem")).toContain("setImageUrl(emptyForm.imageUrl);");
    expect(functionBody(source, "handleCreateItem")).toContain("setPrice(emptyForm.price);");
    expect(functionBody(source, "handleCreateItem")).toContain("setStock(emptyForm.stock);");
    expect(source).toContain("<Image");
    expect(source).toContain("item.image_url");
    expect(source).toContain("parseRedemptionQuantity");
    expect(source).toContain("parseStoreNumbers");
    expect(source).toContain("parsedNumbers.price");
    expect(source).toContain("store.invalidItemName");
    expect(source).toContain("store.invalidItemNumbers");
    expect(source).toContain("store.invalidQuantity");
    expect(source).toContain("store.saveItem");
    expect(source).toContain("style={[styles.secondaryButton, isLoading && styles.disabled]}");
    expect(source).toContain("style={[styles.smallButton, isLoading && styles.disabled]}");
    expect(source).toContain("style={[styles.dangerButton, isLoading && styles.disabled]}");
    expect(source).toContain("autoCorrect={false}");
    for (const placeholder of [
      'placeholder={t("store.price")}',
      'placeholder={t("store.stock")}',
      'placeholder={t("store.quantity")}'
    ]) {
      for (const input of allTextInputsBeforePlaceholder(source, placeholder)) {
        expect(input).toContain("autoCorrect={false}");
        expect(input).toContain('keyboardType="number-pad"');
      }
    }
    expect(source).toContain("handleCancel");
    expect(source).toContain("performFulfill");
    expect(source).toContain("performCancel");
    expect(source).toContain("performRefund");
    expect(source).toContain("Alert.alert");
    expect(source).toContain("store.fulfillConfirmTitle");
    expect(source).toContain("store.fulfillConfirmBody");
    expect(source).toContain("store.cancelConfirmTitle");
    expect(source).toContain("store.cancelConfirmBody");
    expect(source).toContain("store.refundConfirmTitle");
    expect(source).toContain("store.refundConfirmBody");
    expect(source).toContain("store.redemptionReadonly");
    expect(functionBody(source, "handleFulfill")).toContain('redemption.status !== "pending"');
    expect(functionBody(source, "performFulfill")).toContain("if (!canManageStore)");
    expect(functionBody(source, "performFulfill")).toContain('redemption.status !== "pending"');
    expect(functionBody(source, "handleFulfill")).toContain("Alert.alert");
    expect(functionBody(source, "handleFulfill")).toContain("performFulfill(redemption)");
    expect(functionBody(source, "handleCancel")).toContain('redemption.status !== "pending"');
    expect(functionBody(source, "performCancel")).toContain("if (!canManageStore)");
    expect(functionBody(source, "performCancel")).toContain('redemption.status !== "pending"');
    expect(functionBody(source, "handleRefund")).toContain('redemption.status !== "fulfilled"');
    expect(functionBody(source, "performRefund")).toContain("if (!canManageStore)");
    expect(functionBody(source, "performRefund")).toContain('redemption.status !== "fulfilled"');
    expect(source).toContain("onPress={() => handleFulfill(redemption)}");
    expect(source).toContain("onPress={() => handleCancel(redemption)}");
    expect(source).toContain("onPress={() => handleRefund(redemption)}");
    expect(source).toContain('redemption.status === "pending"');
    expect(source).toContain('redemption.status === "fulfilled"');
    expect(source).not.toContain('useState("队服")');
    expect(source).not.toContain('useState("训练队服兑换")');
  });

  test("members screen supports editable jersey and position profiles", () => {
    const source = readFileSync(resolve(appRoot, "app/teams/[teamId]/members.tsx"), "utf-8");

    expect(source).toContain("memberDrafts");
    expect(source).toContain("applyMembers");
    expect(source).toContain("loadMembers");
    expect(source).toContain("getMemberCandidates");
    expect(source).toContain("candidateQuery");
    expect(source).toContain("candidates");
    expect(source).toContain("handleSearchCandidates");
    expect(source).toContain("handleSelectCandidate");
    expect(source).toContain("setNewUserId(candidate.id)");
    expect(source).toContain("style={[styles.candidateRow, isLoading && styles.disabled]}");
    expect(source).toContain("style={[styles.pillButton, newRole === role && styles.activePill, isLoading && styles.disabled]}");
    expect(source).toContain("getTeamHome");
    expect(source).toContain("currentRole");
    expect(source).toContain("setCurrentRole(teamHome.current_membership.role)");
    expect(source).toContain("canManageMembers");
    expect(source).toContain('currentRole === "admin"');
    expect(source).toContain("!canManageMembers");
    expect(functionBody(source, "handleLoadMembers")).not.toContain("if (!canManageMembers)");
    expect(source).toContain("handleSaveMemberProfile");
    expect(source).toContain("handleSelectFilterRole");
    expect(source).toContain("handleSelectFilterStatus");
    expect(source).toContain("onPress={() => handleSelectFilterRole(role)}");
    expect(source).toContain("onPress={() => handleSelectFilterStatus(status)}");
    expect(source).toContain("await loadMembers(filterRole, filterStatus);");
    expect(source).not.toContain("setMembers((currentMembers) => [createdMembership, ...currentMembers])");
    expect(source).not.toContain("currentMembership.user_id === membership.user_id ? updatedMembership : currentMembership");
    expect(source).toContain("members.saveProfile");
    expect(source).toContain("members.adminOnlyHint");
    expect(source).toContain("members.search");
    expect(source).toContain("members.searchPlaceholder");
    expect(source).toContain("members.searchMinLength");
    expect(source).toContain("members.noCandidates");
    expect(source).toContain("members.candidateSelected");
    expect(source).toContain("normalizeMemberUserId");
    expect(source).toContain("members.invalidUserId");
    expect(source).toContain("normalizeOptionalTeamText");
    expect(source).toContain("jersey_number");
    expect(source).toContain("position");
    expect(source).toContain("filterRole");
    expect(source).toContain("filterStatus");
    expect(source).toContain("members.filters");
    expect(source).toContain("members.allRoles");
    expect(source).toContain("members.allStatuses");
    expect(source).toContain("getTeamMembers(teamId, { role, status })");
    expect(source).toContain("autoCorrect={false}");
    for (const occurrence of [0, 1]) {
      expect(textInputBeforePlaceholder(source, 'placeholder={t("members.jersey")}', occurrence)).toContain(
        "autoCorrect={false}"
      );
    }
    expect(source).toContain("style={[styles.pillButton, filterRole === role && styles.activePill, isLoading && styles.disabled]}");
    expect(source).toContain("style={[styles.pillButton, filterStatus === status && styles.activePill, isLoading && styles.disabled]}");
    expect(source).toContain("style={[styles.secondaryButton, isLoading && styles.disabled]}");
    expect(source).toContain("style={[styles.smallButton, isLoading && styles.disabled]}");
    expect(source).toContain("style={[styles.dangerButton, isLoading && styles.disabled]}");
    expect(source).not.toContain("new Date().toISOString()");
    expect(source).not.toContain('left_at:');
  });

  test("attendance board route exposes team ranking data and filters", () => {
    const source = readFileSync(resolve(appRoot, "app/teams/[teamId]/attendance-board.tsx"), "utf-8");
    const teamsSource = readFileSync(resolve(appRoot, "app/teams.tsx"), "utf-8");
    const teamHomeSource = readFileSync(resolve(appRoot, "app/teams/[teamId]/index.tsx"), "utf-8");

    expect(source).toContain("getTeamAttendanceBoard");
    expect(source).toContain("attendance_rate");
    expect(source).toContain("row.user?.name ?? row.user?.email ?? row.user_id");
    expect(source).toContain("attendanceBoard.startsAfter");
    expect(source).toContain("attendanceBoard.startsBefore");
    expect(source.split('placeholder={t("attendanceBoard.startsAfter")}')[0].slice(-180)).toContain("autoCorrect={false}");
    expect(source.split('placeholder={t("attendanceBoard.startsBefore")}')[0].slice(-180)).toContain("autoCorrect={false}");
    expect(source).toContain("parseOptionalIsoDateTime");
    expect(source).toContain("attendanceBoard.invalidDateTime");
    expect(source).toContain("startsAfter: parsedStartsAfter");
    expect(source).toContain("startsBefore: parsedStartsBefore");
    expect(teamsSource).toContain("/teams/[teamId]/attendance-board");
    expect(teamHomeSource).toContain("/teams/[teamId]/attendance-board");
  });

  test("attendance route can load signups and record directly from the signup list", () => {
    const source = readFileSync(resolve(appRoot, "app/events/[eventId]/attendance.tsx"), "utf-8");
    const loadHandlerStart = source.indexOf("async function handleLoadAttendance()");
    const loadHandlerEnd = source.indexOf("useEffect", loadHandlerStart);

    expect(source).toContain("refreshAttendanceData");
    expect(source).toContain("await refreshAttendanceData();");
    expect(source.slice(loadHandlerStart, loadHandlerEnd)).not.toContain("if (!canManageAttendance)");
    expect(source).toContain("getEvent");
    expect(source).toContain("getTeamHome");
    expect(source).toContain("getTeamMembers");
    expect(source).toContain("getEventSignups");
    expect(source).toContain("currentRole");
    expect(source).toContain("const nextRole = teamHome.current_membership.role");
    expect(source).toContain('const nextCanManageAttendance = nextRole === "captain" || nextRole === "admin"');
    expect(source).toContain("const [nextSignups, nextMembers] = nextCanManageAttendance");
    expect(source).toContain("getTeamMembers(loadedEvent.team_id, { status: \"active\" })");
    expect(source).toContain("setMembers(nextMembers)");
    expect(source).toContain("setCurrentRole(nextRole)");
    expect(source).toContain("canManageAttendance");
    expect(source).toContain('currentRole === "captain" || currentRole === "admin"');
    expect(source).toContain("canRecordAttendance");
    expect(source).toContain('canManageAttendance && (event?.status === "published" || event?.status === "completed")');
    expect(source).toContain("canCompleteEvent");
    expect(source).toContain('canManageAttendance && event?.status === "published"');
    expect(source).toContain('if (event?.status !== "published")');
    expect(source).toContain('event?.status !== "published" && event?.status !== "completed"');
    expect(source).toContain("Alert.alert");
    expect(source).toContain("attendance.completeConfirmTitle");
    expect(source).toContain("attendance.completeConfirmBody");
    expect(source).toContain("attendance.completeConfirmAction");
    expect(source).toContain("common.cancel");
    expect(source).toContain("performCompleteEvent");
    expect(functionBody(source, "performCompleteEvent")).toContain("if (!canManageAttendance)");
    expect(functionBody(source, "performCompleteEvent")).toContain("if (event?.status !== \"published\")");
    expect(functionBody(source, "performCompleteEvent")).toContain("await completeEvent(eventId, matchDetailsInput)");
    expect(source).toContain("const matchDetailsInput: EventCompletionInput");
    expect(source).toContain("onPress: () => void performCompleteEvent(matchDetailsInput)");
    expect(source).toContain("style={[styles.secondaryButton, isLoading && styles.disabled]}");
    expect(source).toContain("style={[styles.smallButton, isLoading && styles.disabled]}");
    expect(source).toContain("style={[styles.smallButton, finalMatchResult === result && styles.activeButton, isLoading && styles.disabled]}");
    expect(source).toContain("isLoading && styles.disabled");
    expect(source).toContain("autoCorrect={false}");
    expect(source).toContain("finalTeamScore");
    expect(source).toContain("finalOpponentScore");
    expect(source).toContain("finalMatchResult");
    expect(source).toContain("finalMatchNotes");
    expect(source).toContain("isValidMatchScoreResult");
    expect(source).toContain("parseOptionalNonNegativeInteger");
    expect(source).toContain('event?.type === "match"');
    expect(source).toContain("match_details: {");
    expect(source).toContain("team_score: parsedTeamScore");
    expect(source).toContain("opponent_score: parsedOpponentScore");
    expect(source).toContain("result: finalMatchResult");
    expect(source).toContain("events.invalidMatchInput");
    expect(source).toContain("events.invalidMatchScoreResult");
    expect(source).toContain("events.teamScore");
    expect(source).toContain("events.opponentScore");
    expect(source).toContain("events.result.${result}");
    expect(source).toContain("events.matchNotes");
    expect(source).toContain("attendance.captainOnlyHint");
    expect(source).toContain("attendance.recordReadonly");
    expect(source).toContain("signups");
    expect(source).toContain("attendance.signups");
    expect(source).toContain("signupStatus");
    expect(source).toContain("signupStatuses");
    expect(source).toContain("attendance.signupFilters");
    expect(source).toContain("attendance.allSignupStatuses");
    expect(source).toContain("getEventSignups(eventId, signupStatus)");
    expect(source).toContain("attendance.noSignups");
    expect(source).toContain("attendance.activeMembers");
    expect(source).toContain("attendance.noMembers");
    expect(source).toContain("members.map((membership)");
    expect(source).toContain("onPress={() => setTargetUserId(membership.user_id)}");
    expect(source).toContain("targetUserId === membership.user_id");
    expect(source).toContain("attendance.records");
    expect(source).toContain("memberLabel");
    expect(source).toContain("signup.user.email");
    expect(source).toContain("row.user.email");
    expect(source).toContain("attendance.${row.status}");
    expect(source).toContain("normalizeUserId");
    expect(source).toContain("normalizeAttendanceNote");
    expect(source).toContain("attendance.invalidUserId");
    expect(source).toContain("attendance.rewardCount");
    expect(source).toContain("handleRecordAttendance(signup.user_id");
    expect(source).toContain('pathname: "/teams/[teamId]/coins"');
    expect(source).toContain('pathname: "/teams/[teamId]/attendance-board"');
    expect(source).toContain('pathname: "/events/[eventId]/summary"');
    expect(source).toContain('event.type === "match"');
    expect(source).toContain("params: { teamId: event.team_id }");
    expect(source).toContain('t("coins.title")');
    expect(source).toContain('t("attendanceBoard.title")');
  });

  test("match summary route exposes final match stats, attendance and rewards", () => {
    const source = readFileSync(resolve(appRoot, "app/events/[eventId]/summary.tsx"), "utf-8");
    const eventSource = readFileSync(resolve(appRoot, "app/events/[eventId].tsx"), "utf-8");
    const liveSource = readFileSync(resolve(appRoot, "app/events/[eventId]/live.tsx"), "utf-8");

    expect(source).toContain("getMatchSummary");
    expect(source).toContain("summary.counts.goal");
    expect(source).toContain("summary.attendance");
    expect(source).toContain("summary.rewards");
    expect(source).toContain("events.result.${summary.match_details.result}");
    expect(source).toContain("attendance.${row.status}");
    expect(source).toContain("match.loadSummary");
    expect(source).toContain('pathname: "/events/[eventId]"');
    expect(source).toContain('pathname: "/events/[eventId]/attendance"');
    expect(source).toContain('pathname: "/events/[eventId]/live"');
    expect(eventSource).toContain("/events/[eventId]/summary");
    expect(liveSource).toContain('pathname: "/events/[eventId]/attendance"');
    expect(liveSource).toContain('pathname: "/events/[eventId]/summary"');
  });

  test("live board validates match minute and localizes match log labels", () => {
    const source = readFileSync(resolve(appRoot, "app/events/[eventId]/live.tsx"), "utf-8");

    expect(source).toContain("LIVE_BOARD_POLL_INTERVAL_MS");
    expect(source).toContain("setInterval");
    expect(source).toContain("clearInterval");
    expect(source).toContain("void handleLoadBoard();");
    expect(source).toContain("void refreshLiveBoard();");
    expect(source).toContain("parseMatchMinute");
    expect(source).toContain("match.invalidMinute");
    expect(source).toContain("normalizeRequiredText");
    expect(source).toContain("match.invalidLogInput");
    expect(source).toContain('const [playerName, setPlayerName] = useState("");');
    expect(source).toContain('const [playerNumber, setPlayerNumber] = useState("");');
    expect(source).not.toContain('useState("Player")');
    expect(source).toContain("parsedMinute");
    expect(source).toContain("getTeamHome");
    expect(source).toContain("currentRole");
    expect(source).toContain("setCurrentRole(teamHome.current_membership.role)");
    expect(source).toContain("canEditMatchLogs");
    expect(source).toContain('board?.event.status === "published"');
    expect(source).toContain("canManageMatchLogs");
    expect(source).toContain('currentRole === "captain" || currentRole === "admin"');
    expect(source).toContain("canCreateMatchLogs");
    expect(source).toContain("canEditMatchLogs && canManageMatchLogs");
    expect(functionBody(source, "handleCreateLog")).toContain("if (!canManageMatchLogs)");
    expect(functionBody(source, "handleCreateLog")).toContain("if (!canEditMatchLogs)");
    expect(functionBody(source, "handleCreateLog").indexOf("parseMatchMinute(minute)")).toBeLessThan(
      functionBody(source, "handleCreateLog").indexOf("setIsLoading(true)")
    );
    expect(functionBody(source, "handleCreateLog").indexOf("normalizeRequiredText(playerName)")).toBeLessThan(
      functionBody(source, "handleCreateLog").indexOf("setIsLoading(true)")
    );
    expect(source).toContain("canDeleteMatchLogs");
    expect(functionBody(source, "handleDeleteLog")).toContain("if (!canEditMatchLogs)");
    expect(functionBody(source, "performDeleteLog")).toContain("if (!canManageMatchLogs)");
    expect(functionBody(source, "performDeleteLog")).toContain("if (!canEditMatchLogs)");
    expect(source).toContain("style={[styles.secondaryButton, isLoading && styles.disabled]}");
    expect(source).toContain("style={[styles.dangerButton, isLoading && styles.disabled]}");
    expect(source).toContain("Alert.alert");
    expect(source).toContain("performDeleteLog");
    expect(source).toContain("match.deleteLogConfirmTitle");
    expect(source).toContain("match.deleteLogConfirmBody");
    expect(source).toContain("common.cancel");
    expect(source).toContain("match.captainOnlyHint");
    expect(source).toContain('canEditMatchLogs ? t("match.captainOnlyHint") : t("match.logsReadonly")');
    expect(source).toContain('placeholder={t("match.playerNumber")}');
    expect(source).toContain('placeholder={t("match.subOutNumber")}');
    expect(source).toContain('placeholder={t("match.subInNumber")}');
    expect(source.split('placeholder={t("match.playerNumber")}')[0].slice(-220)).toContain('keyboardType="number-pad"');
    expect(source.split('placeholder={t("match.subOutNumber")}')[0].slice(-220)).toContain('keyboardType="number-pad"');
    expect(source.split('placeholder={t("match.subInNumber")}')[0].slice(-220)).toContain('keyboardType="number-pad"');
    expect(source.split('placeholder={t("match.playerName")}')[0].slice(-220)).toContain("autoCorrect={false}");
    expect(source.split('placeholder={t("match.subOutName")}')[0].slice(-220)).toContain("autoCorrect={false}");
    expect(source.split('placeholder={t("match.subInName")}')[0].slice(-220)).toContain("autoCorrect={false}");
    expect(source).not.toContain('board && canEditMatchLogs && !canManageMatchLogs');
    expect(source).toContain("match.logsReadonly");
    expect(source).toContain("match.${log.entry_type}");
    expect(source).toContain("match.substitution");
  });

  test("Maestro smoke flow covers the core unauthenticated mobile navigation", () => {
    const source = readFileSync(resolve(repoRoot, "e2e/maestro/app-smoke.yaml"), "utf-8");

    for (const label of [
      "球队首页",
      "显示语言: zh-CN",
      "Team Home",
      "Display language: en",
      "登录",
      "姓名",
      "注册",
      "个人资料",
      "头像 URL，可留空",
      "我的球队",
      "加载球队",
      "收件箱",
      "球队公告",
      "球队 UUID"
    ]) {
      expect(source).toContain(label);
    }
  });

  test("Expo native app identifiers stay aligned with Maestro E2E", () => {
    const appConfig = readFileSync(resolve(appRoot, "app.config.ts"), "utf-8");
    const maestroFlow = readFileSync(resolve(repoRoot, "e2e/maestro/app-smoke.yaml"), "utf-8");
    const expectedAppId = "com.chenyy.workouttracker";

    expect(appConfig).toContain(`bundleIdentifier: "${expectedAppId}"`);
    expect(appConfig).toContain(`package: "${expectedAppId}"`);
    expect(appConfig).toContain('"expo-notifications"');
    expect(maestroFlow).toContain(`appId: ${expectedAppId}`);
  });

  test("EAS build profiles cover development preview and production releases", () => {
    const easConfig = JSON.parse(readFileSync(resolve(appRoot, "eas.json"), "utf-8"));
    const releaseEnvCheckSource = readFileSync(resolve(appRoot, "scripts/check-release-env.mjs"), "utf-8");
    const eslintConfig = readFileSync(resolve(appRoot, "eslint.config.mjs"), "utf-8");

    expect(easConfig.cli.appVersionSource).toBe("local");
    expect(easConfig.build.development.developmentClient).toBe(true);
    expect(easConfig.build.development.distribution).toBe("internal");
    expect(easConfig.build.preview.distribution).toBe("internal");
    expect(easConfig.build.preview.android.buildType).toBe("apk");
    expect(easConfig.build.production.autoIncrement).toBe(true);
    expect(easConfig.submit.production).toEqual({});
    expect(releaseEnvCheckSource).toContain("EXPO_PUBLIC_API_BASE_URL");
    expect(releaseEnvCheckSource).toContain("EXPO_PUBLIC_SUPABASE_URL");
    expect(releaseEnvCheckSource).toContain("EXPO_PUBLIC_SUPABASE_ANON_KEY");
    expect(releaseEnvCheckSource).toContain("EXPO_PUBLIC_EAS_PROJECT_ID");
    expect(releaseEnvCheckSource).toContain("10.0.2.2");
    expect(releaseEnvCheckSource).toContain("EXPO_PUBLIC_API_BASE_URL must be a valid HTTP(S) URL");
    expect(releaseEnvCheckSource).toContain("EXPO_PUBLIC_API_BASE_URL must use HTTPS for production builds");
    expect(releaseEnvCheckSource).toContain("EXPO_PUBLIC_API_BASE_URL must not use a documentation placeholder value");
    expect(releaseEnvCheckSource).toContain("isPlaceholderApiBaseUrl");
    expect(releaseEnvCheckSource).toContain("EXPO_PUBLIC_SUPABASE_URL must be a valid HTTPS URL");
    expect(releaseEnvCheckSource).toContain("EXPO_PUBLIC_SUPABASE_URL must not use a documentation placeholder value");
    expect(releaseEnvCheckSource).toContain("isPlaceholderSupabaseUrl");
    expect(releaseEnvCheckSource).toContain("EXPO_PUBLIC_SUPABASE_ANON_KEY must not use the development placeholder key");
    expect(releaseEnvCheckSource).toContain("EXPO_PUBLIC_SUPABASE_ANON_KEY must not use a documentation placeholder value");
    expect(releaseEnvCheckSource).toContain("isPlaceholderSupabaseAnonKey");
    expect(releaseEnvCheckSource).toContain("EXPO_PUBLIC_EAS_PROJECT_ID must not use a documentation placeholder value");
    expect(releaseEnvCheckSource).toContain("EXPO_PUBLIC_EAS_PROJECT_ID must be a valid EAS project UUID");
    expect(releaseEnvCheckSource).toContain("isPlaceholderEasProjectId");
    expect(releaseEnvCheckSource).toContain("isValidEasProjectId");
    expect(releaseEnvCheckSource).toContain("normalizedProfile");
    expect(releaseEnvCheckSource).toContain("EXPO_PUBLIC_API_BASE_URL must be a reachable");
    expect(eslintConfig).toContain('files: ["scripts/**/*.mjs"]');
    expect(eslintConfig).toContain("...globals.node");
  });

  test("release environment check rejects unsafe or malformed release URLs before EAS upload", async () => {
    const { releaseEnvProblems, runReleaseEnvCheck } = (await import("../scripts/check-release-env.mjs")) as {
      releaseEnvProblems: (env: Record<string, string>, profile: string) => string[];
      runReleaseEnvCheck: (env: Record<string, string>, profile: string) => number;
    };
    const baseEnv = {
      EXPO_PUBLIC_API_BASE_URL: "http://localhost:8000",
      EXPO_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
      EXPO_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
      EXPO_PUBLIC_EAS_PROJECT_ID: "11111111-1111-4111-8111-111111111111"
    };
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    try {
      expect(runReleaseEnvCheck(baseEnv, "preview")).toBe(1);
      expect(runReleaseEnvCheck(baseEnv, "development")).toBe(0);
      expect(runReleaseEnvCheck(baseEnv, " Development ")).toBe(0);
      expect(runReleaseEnvCheck({ ...baseEnv, EXPO_PUBLIC_API_BASE_URL: "https://api.example.test" }, "production")).toBe(0);
    } finally {
      consoleErrorSpy.mockRestore();
      consoleLogSpy.mockRestore();
    }
    expect(releaseEnvProblems({ ...baseEnv, EXPO_PUBLIC_API_BASE_URL: "not-a-url" }, "preview")).toContain(
      "EXPO_PUBLIC_API_BASE_URL must be a valid HTTP(S) URL"
    );
    expect(releaseEnvProblems({ ...baseEnv, EXPO_PUBLIC_API_BASE_URL: "http://api.example.test" }, "production")).toContain(
      "EXPO_PUBLIC_API_BASE_URL must use HTTPS for production builds"
    );
    expect(releaseEnvProblems({ ...baseEnv, EXPO_PUBLIC_API_BASE_URL: "http://api.example.test" }, " Production ")).toContain(
      "EXPO_PUBLIC_API_BASE_URL must use HTTPS for production builds"
    );
    expect(
      releaseEnvProblems({ ...baseEnv, EXPO_PUBLIC_API_BASE_URL: "<your-api-base-url>" }, "preview")
    ).toContain("EXPO_PUBLIC_API_BASE_URL must not use a documentation placeholder value");
    expect(
      releaseEnvProblems({ ...baseEnv, EXPO_PUBLIC_API_BASE_URL: "https://your-api.example.test" }, "preview")
    ).toContain("EXPO_PUBLIC_API_BASE_URL must not use a documentation placeholder value");
    expect(
      releaseEnvProblems(
        {
          ...baseEnv,
          EXPO_PUBLIC_API_BASE_URL: "https://api.example.test",
          EXPO_PUBLIC_SUPABASE_URL: "http://project.supabase.co"
        },
        "preview"
      )
    ).toContain("EXPO_PUBLIC_SUPABASE_URL must be a valid HTTPS URL");
    expect(
      releaseEnvProblems(
        {
          ...baseEnv,
          EXPO_PUBLIC_API_BASE_URL: "https://api.example.test",
          EXPO_PUBLIC_SUPABASE_URL: "<your-supabase-project-url>"
        },
        "preview"
      )
    ).toContain("EXPO_PUBLIC_SUPABASE_URL must not use a documentation placeholder value");
    expect(
      releaseEnvProblems(
        {
          ...baseEnv,
          EXPO_PUBLIC_API_BASE_URL: "https://api.example.test",
          EXPO_PUBLIC_SUPABASE_URL: "https://your-project.supabase.co"
        },
        "preview"
      )
    ).toContain("EXPO_PUBLIC_SUPABASE_URL must not use a documentation placeholder value");
    expect(
      releaseEnvProblems(
        {
          ...baseEnv,
          EXPO_PUBLIC_API_BASE_URL: "https://api.example.test",
          EXPO_PUBLIC_SUPABASE_ANON_KEY: "dev-placeholder-anon-key"
        },
        "preview"
      )
    ).toContain("EXPO_PUBLIC_SUPABASE_ANON_KEY must not use the development placeholder key");
    expect(
      releaseEnvProblems(
        {
          ...baseEnv,
          EXPO_PUBLIC_API_BASE_URL: "https://api.example.test",
          EXPO_PUBLIC_SUPABASE_ANON_KEY: "<your-supabase-anon-key>"
        },
        "preview"
      )
    ).toContain("EXPO_PUBLIC_SUPABASE_ANON_KEY must not use a documentation placeholder value");
    expect(
      releaseEnvProblems(
        {
          ...baseEnv,
          EXPO_PUBLIC_API_BASE_URL: "https://api.example.test",
          EXPO_PUBLIC_SUPABASE_ANON_KEY: "your-supabase-anon-key"
        },
        "preview"
      )
    ).toContain("EXPO_PUBLIC_SUPABASE_ANON_KEY must not use a documentation placeholder value");
    expect(
      releaseEnvProblems(
        {
          ...baseEnv,
          EXPO_PUBLIC_API_BASE_URL: "https://api.example.test",
          EXPO_PUBLIC_EAS_PROJECT_ID: "<your-eas-project-uuid-for-native-push>"
        },
        "preview"
      )
    ).toContain("EXPO_PUBLIC_EAS_PROJECT_ID must not use a documentation placeholder value");
    expect(
      releaseEnvProblems(
        {
          ...baseEnv,
          EXPO_PUBLIC_API_BASE_URL: "https://api.example.test",
          EXPO_PUBLIC_EAS_PROJECT_ID: "not-a-uuid"
        },
        "preview"
      )
    ).toContain("EXPO_PUBLIC_EAS_PROJECT_ID must be a valid EAS project UUID");
  });
});
