import { apiRequest } from "@/lib/api/client";
import { supabase } from "@/lib/supabase/client";
import { normalizeOptionalText, omitUndefined } from "@/lib/validation/text";

import { normalizeAuthCredentials } from "./validation";

export type UserProfile = {
  id: string;
  auth_id: string;
  name: string;
  student_id: string | null;
  email: string;
  avatar_url: string | null;
  status: "active" | "disabled";
  created_at: string;
  updated_at: string;
};

export type SignInInput = {
  email: string;
  password: string;
};

export type SignUpInput = SignInInput;

export type SyncProfileInput = {
  name: string;
  student_id?: string | null;
  avatar_url?: string | null;
};

export type ProfileUpdateInput = Partial<SyncProfileInput>;

export class AuthValidationError extends Error {
  readonly code = "AUTH_VALIDATION_ERROR";
}

export async function signUp(input: SignUpInput) {
  const normalizedInput = normalizeAuthCredentials(input.email, input.password);
  if (normalizedInput === null) {
    throw new AuthValidationError("Email and password are required");
  }
  const { data, error } = await supabase.auth.signUp(normalizedInput);
  if (error) {
    throw error;
  }
  return data.session;
}

export async function signIn(input: SignInInput) {
  const normalizedInput = normalizeAuthCredentials(input.email, input.password);
  if (normalizedInput === null) {
    throw new AuthValidationError("Email and password are required");
  }
  const { data, error } = await supabase.auth.signInWithPassword(normalizedInput);
  if (error) {
    throw error;
  }
  return data.session;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) {
    throw error;
  }
}

export function syncProfile(input: SyncProfileInput) {
  return apiRequest<UserProfile>("/api/v1/auth/sync", {
    method: "POST",
    body: omitUndefined({
      name: input.name.trim(),
      student_id: normalizeOptionalText(input.student_id),
      avatar_url: normalizeOptionalText(input.avatar_url)
    })
  });
}

export function updateProfile(input: ProfileUpdateInput) {
  return apiRequest<UserProfile>("/api/v1/users/me", {
    method: "PATCH",
    body: omitUndefined({
      name: input.name?.trim(),
      student_id: normalizeOptionalText(input.student_id),
      avatar_url: normalizeOptionalText(input.avatar_url)
    })
  });
}

export function getMyProfile() {
  return apiRequest<UserProfile>("/api/v1/users/me");
}
