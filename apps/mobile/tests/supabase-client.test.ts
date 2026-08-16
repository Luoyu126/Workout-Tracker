import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

describe("supabase client configuration", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test("trims configured Supabase URL and anon key", async () => {
    vi.stubEnv("EXPO_PUBLIC_SUPABASE_URL", " https://project.supabase.co ");
    vi.stubEnv("EXPO_PUBLIC_SUPABASE_ANON_KEY", " anon-key ");

    const { supabaseConfig } = await import("../src/lib/supabase/config");

    expect(supabaseConfig).toMatchObject({
      url: "https://project.supabase.co",
      anonKey: "anon-key",
      isConfigured: true,
      isUsingDevelopmentPlaceholderKey: false,
      isUsingDocumentationPlaceholderValue: false
    });
  });

  test("uses development placeholders and marks config missing for blank env values", async () => {
    vi.stubEnv("EXPO_PUBLIC_SUPABASE_URL", "   ");
    vi.stubEnv("EXPO_PUBLIC_SUPABASE_ANON_KEY", "   ");

    const { supabaseConfig } = await import("../src/lib/supabase/config");

    expect(supabaseConfig).toMatchObject({
      url: "http://localhost",
      anonKey: "dev-placeholder-anon-key",
      isConfigured: false,
      isUsingDevelopmentPlaceholderKey: true,
      isUsingDocumentationPlaceholderValue: false
    });
  });

  test("treats an explicit development placeholder anon key as unconfigured", async () => {
    vi.stubEnv("EXPO_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("EXPO_PUBLIC_SUPABASE_ANON_KEY", "dev-placeholder-anon-key");

    const { supabaseConfig } = await import("../src/lib/supabase/config");

    expect(supabaseConfig).toMatchObject({
      url: "https://project.supabase.co",
      anonKey: "dev-placeholder-anon-key",
      isConfigured: false,
      isUsingDevelopmentPlaceholderKey: true,
      isUsingDocumentationPlaceholderValue: false
    });
  });

  test("treats copied documentation placeholders as unconfigured", async () => {
    vi.stubEnv("EXPO_PUBLIC_SUPABASE_URL", "<your-supabase-project-url>");
    vi.stubEnv("EXPO_PUBLIC_SUPABASE_ANON_KEY", "<your-supabase-anon-key>");

    const { supabaseConfig } = await import("../src/lib/supabase/config");

    expect(supabaseConfig).toMatchObject({
      url: "<your-supabase-project-url>",
      anonKey: "<your-supabase-anon-key>",
      isConfigured: false,
      isUsingDevelopmentPlaceholderKey: false,
      isUsingDocumentationPlaceholderValue: true
    });
  });

  test("treats placeholder Supabase hostnames as unconfigured", async () => {
    vi.stubEnv("EXPO_PUBLIC_SUPABASE_URL", "https://your-project.supabase.co");
    vi.stubEnv("EXPO_PUBLIC_SUPABASE_ANON_KEY", "anon-key");

    const { supabaseConfig } = await import("../src/lib/supabase/config");

    expect(supabaseConfig).toMatchObject({
      url: "https://your-project.supabase.co",
      anonKey: "anon-key",
      isConfigured: false,
      isUsingDevelopmentPlaceholderKey: false,
      isUsingDocumentationPlaceholderValue: true
    });
  });
});
