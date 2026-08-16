import type { SignInInput, SyncProfileInput } from "./api";

export function normalizeAuthCredentials(email: string, password: string): SignInInput | null {
  const normalizedEmail = email.trim();
  const normalizedPassword = password.trim();
  if (normalizedEmail.length === 0 || normalizedPassword.length === 0) {
    return null;
  }
  return {
    email: normalizedEmail,
    password: normalizedPassword
  };
}

export function normalizeProfileInput(name: string, studentId: string, avatarUrl = ""): SyncProfileInput | null {
  const normalizedName = name.trim();
  if (normalizedName.length === 0) {
    return null;
  }
  const normalizedStudentId = studentId.trim();
  const normalizedAvatarUrl = avatarUrl.trim();
  return {
    name: normalizedName,
    student_id: normalizedStudentId.length > 0 ? normalizedStudentId : null,
    avatar_url: normalizedAvatarUrl.length > 0 ? normalizedAvatarUrl : null
  };
}
