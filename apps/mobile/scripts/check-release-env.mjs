import { pathToFileURL } from "node:url";

const profile = process.argv[2] ?? process.env.EAS_BUILD_PROFILE ?? "preview";

const requiredEnvNames = [
  "EXPO_PUBLIC_API_BASE_URL",
  "EXPO_PUBLIC_SUPABASE_URL",
  "EXPO_PUBLIC_SUPABASE_ANON_KEY",
  "EXPO_PUBLIC_EAS_PROJECT_ID"
];
const developmentSupabaseAnonKeys = new Set(["dev-placeholder-anon-key"]);
const placeholderSupabaseAnonKeys = new Set(["your-supabase-anon-key", "supabase-anon-key"]);
const placeholderEasProjectIds = new Set([
  "your-eas-project-id-for-native-push",
  "your-eas-project-id",
  "your-eas-project-uuid-for-native-push"
]);
const placeholderApiBaseUrls = new Set(["your-api-base-url", "your-backend-url", "api-placeholder"]);

function nonBlankEnv(env, name) {
  const value = env[name]?.trim();
  return value && value.length > 0 ? value : null;
}

function parseUrl(value) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function isLocalhostUrl(url) {
  return ["localhost", "127.0.0.1", "0.0.0.0", "10.0.2.2"].includes(url.hostname);
}

function isPlaceholderValue(value) {
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

function isPlaceholderApiBaseUrl(value) {
  const normalizedValue = value.trim().toLowerCase().replace(/^<|>$/g, "");
  return placeholderApiBaseUrls.has(normalizedValue) || isPlaceholderValue(value);
}

function isPlaceholderSupabaseUrl(value) {
  return isPlaceholderValue(value);
}

function isPlaceholderEasProjectId(value) {
  const normalizedValue = value.trim().toLowerCase();
  return (
    placeholderEasProjectIds.has(normalizedValue) ||
    isPlaceholderValue(value)
  );
}

function isValidEasProjectId(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value.trim()
  );
}

function isPlaceholderSupabaseAnonKey(value) {
  const normalizedValue = value.trim().toLowerCase();
  return (
    placeholderSupabaseAnonKeys.has(normalizedValue) ||
    isPlaceholderValue(value)
  );
}

export function releaseEnvProblems(env = process.env, selectedProfile = profile) {
  const normalizedProfile = selectedProfile.trim().toLowerCase();
  const missing = requiredEnvNames.filter((name) => nonBlankEnv(env, name) === null);
  const apiBaseUrl = nonBlankEnv(env, "EXPO_PUBLIC_API_BASE_URL");
  const supabaseUrl = nonBlankEnv(env, "EXPO_PUBLIC_SUPABASE_URL");
  const supabaseAnonKey = nonBlankEnv(env, "EXPO_PUBLIC_SUPABASE_ANON_KEY");
  const easProjectId = nonBlankEnv(env, "EXPO_PUBLIC_EAS_PROJECT_ID");
  const problems = [];

  if (missing.length > 0) {
    problems.push(`Missing required environment variables: ${missing.join(", ")}`);
  }

  if (apiBaseUrl !== null) {
    if (isPlaceholderApiBaseUrl(apiBaseUrl)) {
      problems.push("EXPO_PUBLIC_API_BASE_URL must not use a documentation placeholder value");
    }
    const parsedApiBaseUrl = parseUrl(apiBaseUrl);
    if (parsedApiBaseUrl === null || !["http:", "https:"].includes(parsedApiBaseUrl.protocol)) {
      problems.push("EXPO_PUBLIC_API_BASE_URL must be a valid HTTP(S) URL");
    } else {
      if (isLocalhostUrl(parsedApiBaseUrl)) {
        problems.push("EXPO_PUBLIC_API_BASE_URL must be a reachable LAN, preview, or production URL for release builds");
      }
      if (normalizedProfile === "production" && parsedApiBaseUrl.protocol !== "https:") {
        problems.push("EXPO_PUBLIC_API_BASE_URL must use HTTPS for production builds");
      }
    }
  }

  if (supabaseUrl !== null) {
    if (isPlaceholderSupabaseUrl(supabaseUrl)) {
      problems.push("EXPO_PUBLIC_SUPABASE_URL must not use a documentation placeholder value");
    }
    const parsedSupabaseUrl = parseUrl(supabaseUrl);
    if (parsedSupabaseUrl === null || parsedSupabaseUrl.protocol !== "https:") {
      problems.push("EXPO_PUBLIC_SUPABASE_URL must be a valid HTTPS URL");
    }
  }

  if (supabaseAnonKey !== null && developmentSupabaseAnonKeys.has(supabaseAnonKey)) {
    problems.push("EXPO_PUBLIC_SUPABASE_ANON_KEY must not use the development placeholder key");
  }

  if (supabaseAnonKey !== null && isPlaceholderSupabaseAnonKey(supabaseAnonKey)) {
    problems.push("EXPO_PUBLIC_SUPABASE_ANON_KEY must not use a documentation placeholder value");
  }

  if (easProjectId !== null && isPlaceholderEasProjectId(easProjectId)) {
    problems.push("EXPO_PUBLIC_EAS_PROJECT_ID must not use a documentation placeholder value");
  }
  if (easProjectId !== null && !isPlaceholderEasProjectId(easProjectId) && !isValidEasProjectId(easProjectId)) {
    problems.push("EXPO_PUBLIC_EAS_PROJECT_ID must be a valid EAS project UUID");
  }

  return problems;
}

export function runReleaseEnvCheck(env = process.env, selectedProfile = profile) {
  const normalizedProfile = selectedProfile.trim().toLowerCase();
  const problems = releaseEnvProblems(env, selectedProfile);
  if (normalizedProfile !== "development" && problems.length > 0) {
    console.error(`Mobile release environment check failed for ${selectedProfile}:`);
    for (const problem of problems) {
      console.error(`- ${problem}`);
    }
    return 1;
  }

  console.log(`Mobile release environment check passed for ${selectedProfile}.`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(runReleaseEnvCheck());
}
