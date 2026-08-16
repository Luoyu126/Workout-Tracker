import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

import { defaultLocale, translations, type TranslationKey } from "../src/lib/i18n/translations";
import { expect, test } from "vitest";

const appRoot = resolve(import.meta.dirname, "..");
const repoRoot = resolve(appRoot, "../..");

function sourceFilesUnder(relativePath: string): string[] {
  const root = resolve(appRoot, relativePath);
  const entries = readdirSync(root);
  return entries.flatMap((entry) => {
    const fullPath = resolve(root, entry);
    const stats = statSync(fullPath);

    if (stats.isDirectory()) {
      return sourceFilesUnder(resolve(relativePath, entry));
    }

    return fullPath.endsWith(".ts") || fullPath.endsWith(".tsx") ? [fullPath] : [];
  });
}

test("defaults to Simplified Chinese", () => {
  expect(defaultLocale).toBe("zh-CN");
});

test("English and Chinese translations expose the same keys", () => {
  const zhKeys = Object.keys(translations["zh-CN"]).sort();
  const enKeys = Object.keys(translations.en).sort();

  expect(enKeys).toEqual(zhKeys);
});

test("all Chinese translations are populated", () => {
  const values = Object.values(translations["zh-CN"] satisfies Record<TranslationKey, string>);

  expect(values.every((value) => value.length > 0)).toBe(true);
});

test("all English translations are populated", () => {
  const values = Object.values(translations.en satisfies Record<TranslationKey, string>);

  expect(values.every((value) => value.length > 0)).toBe(true);
});

test("literal translation calls reference existing keys", () => {
  const knownKeys = new Set(Object.keys(translations[defaultLocale]));
  const sourceFiles = [...sourceFilesUnder("app"), ...sourceFilesUnder("src")];
  const missingKeys = sourceFiles.flatMap((sourceFile) => {
    const source = readFileSync(sourceFile, "utf-8");
    const literalTranslationCalls = source.matchAll(/\bt\("([^"]+)"\)/g);

    return Array.from(literalTranslationCalls)
      .map((match) => match[1])
      .filter((key) => !knownKeys.has(key))
      .map((key) => `${sourceFile.replace(`${appRoot}/`, "")}: ${key}`);
  });

  expect(missingKeys).toEqual([]);
});

test("dynamic enum translation keys cover MVP API values", () => {
  const knownKeys = new Set(Object.keys(translations[defaultLocale]));
  const openApi = JSON.parse(readFileSync(resolve(repoRoot, "packages/api-client/openapi.json"), "utf-8"));
  const enumValues = (schemaName: string) => openApi.components.schemas[schemaName].enum as string[];
  const dynamicKeys = [
    ...enumValues("TeamStatus").map((status) => `teams.status.${status}`),
    ...enumValues("MembershipRole").map((role) => `members.role.${role}`),
    ...enumValues("MembershipStatus").map((status) => `members.status.${status}`),
    ...enumValues("EventType").map((type) => `events.${type}`),
    ...enumValues("EventStatus").map((status) => `events.status.${status}`),
    ...enumValues("MatchResult").map((result) => `events.result.${result}`),
    ...enumValues("SignupStatus").map((status) => `events.signup.${status}`),
    ...enumValues("AttendanceStatus").map((status) => `attendance.${status}`),
    ...enumValues("MatchEntryType").map((type) => `match.${type}`),
    ...enumValues("RedemptionStatus").map((status) => `store.status.${status}`),
    ...enumValues("CoinTransactionType").map(
      (type) => `coins.transaction.${type}`
    ),
    ...enumValues("NotificationType").map((type) => `inbox.type.${type}`)
  ];

  expect(dynamicKeys.filter((key) => !knownKeys.has(key))).toEqual([]);
});

test("language switching is reachable before and after authentication", () => {
  const loginSource = readFileSync(resolve(appRoot, "app/login.tsx"), "utf-8");
  const homeSource = readFileSync(resolve(appRoot, "app/index.tsx"), "utf-8");
  const profileSource = readFileSync(resolve(appRoot, "app/profile.tsx"), "utf-8");
  const languageToggleSource = readFileSync(resolve(appRoot, "src/components/LanguageToggle.tsx"), "utf-8");

  expect(loginSource).toContain("LanguageToggle");
  expect(homeSource).toContain("LanguageToggle");
  expect(profileSource).toContain("LanguageToggle");
  expect(languageToggleSource).toContain('const label = `${t("settings.language")}: ${locale}`;');
  expect(languageToggleSource).toContain("accessibilityLabel={label}");
  expect(languageToggleSource).toContain("const [isSaving, setIsSaving] = useState(false);");
  expect(languageToggleSource).toContain("async function handleToggleLanguage()");
  expect(languageToggleSource).toContain('await setLocale(locale === "zh-CN" ? "en" : "zh-CN");');
  expect(languageToggleSource).toContain("disabled={isSaving}");
  expect(languageToggleSource).toContain("style={[styles.languageButton, isSaving && styles.disabled]}");
  expect(languageToggleSource).toContain("onPress={() => void handleToggleLanguage()}");
});

test("match log permission copy covers both create and delete actions", () => {
  expect(translations["zh-CN"]["match.captainOnlyHint"]).toContain("新增或删除");
  expect(translations.en["match.captainOnlyHint"]).toContain("Adding or deleting");
});
