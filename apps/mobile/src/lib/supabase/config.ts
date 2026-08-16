const fallbackSupabaseUrl = "http://localhost";
const fallbackSupabaseAnonKey = "dev-placeholder-anon-key";
const developmentSupabaseAnonKeys = new Set([fallbackSupabaseAnonKey]);
const placeholderSupabaseAnonKeys = new Set(["your-supabase-anon-key", "supabase-anon-key"]);

function nonBlankEnv(value: string | undefined) {
  if (value === undefined) {
    return null;
  }
  const normalizedValue = value.trim();
  return normalizedValue.length > 0 ? normalizedValue : null;
}

function parseUrl(value: string) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function isDocumentationPlaceholderValue(value: string | null) {
  if (value === null) {
    return false;
  }
  const normalizedValue = value.trim().toLowerCase().replace(/^<|>$/g, "");
  const parsedUrl = parseUrl(normalizedValue);
  const hostname = parsedUrl?.hostname ?? "";
  return (
    normalizedValue.startsWith("your-") ||
    normalizedValue.endsWith("-placeholder") ||
    normalizedValue.includes("placeholder") ||
    hostname.startsWith("your-") ||
    hostname.includes(".your-")
  );
}

const configuredSupabaseUrl = nonBlankEnv(process.env.EXPO_PUBLIC_SUPABASE_URL);
const configuredSupabaseAnonKey = nonBlankEnv(process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY);
const normalizedSupabaseAnonKey = configuredSupabaseAnonKey?.trim().toLowerCase() ?? null;
const isUsingDevelopmentPlaceholderKey =
  normalizedSupabaseAnonKey === null || developmentSupabaseAnonKeys.has(normalizedSupabaseAnonKey);
const isUsingDocumentationPlaceholderValue =
  isDocumentationPlaceholderValue(configuredSupabaseUrl) ||
  (normalizedSupabaseAnonKey !== null &&
    !developmentSupabaseAnonKeys.has(normalizedSupabaseAnonKey) &&
    (placeholderSupabaseAnonKeys.has(normalizedSupabaseAnonKey) ||
      isDocumentationPlaceholderValue(configuredSupabaseAnonKey)));

export const supabaseConfig = {
  url: configuredSupabaseUrl ?? fallbackSupabaseUrl,
  anonKey: configuredSupabaseAnonKey ?? fallbackSupabaseAnonKey,
  isConfigured:
    configuredSupabaseUrl !== null &&
    configuredSupabaseAnonKey !== null &&
    !isUsingDevelopmentPlaceholderKey &&
    !isUsingDocumentationPlaceholderValue,
  isUsingDevelopmentPlaceholderKey,
  isUsingDocumentationPlaceholderValue
};
