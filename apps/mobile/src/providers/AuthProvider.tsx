import type { Session } from "@supabase/supabase-js";
import { useQueryClient } from "@tanstack/react-query";
import { createContext, PropsWithChildren, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

import {
  getMyProfile,
  signIn,
  signOut as revokeSession,
  signUp,
  syncProfile,
  type SignInInput,
  type SignUpInput,
  type SyncProfileInput
} from "@/features/auth/api";
import { profileCheckFailureStatus, type AuthStatus } from "@/features/auth/state";
import { supabase } from "@/lib/supabase/client";

export type { AuthStatus } from "@/features/auth/state";
export type AuthPreparationResult = "ready" | "needsProfile";
export type SignUpPreparationResult = "ready" | "verificationRequired";

type AuthContextValue = {
  status: AuthStatus;
  error: unknown;
  signInAndPrepare: (input: SignInInput) => Promise<AuthPreparationResult>;
  signUpAndPrepare: (input: SignUpInput, profile: SyncProfileInput) => Promise<SignUpPreparationResult>;
  completeProfile: (profile: SyncProfileInput) => Promise<void>;
  retrySessionCheck: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<AuthStatus>("checking");
  const [error, setError] = useState<unknown>(null);
  const operationInProgressRef = useRef(false);
  const requestVersionRef = useRef(0);
  const mountedRef = useRef(true);

  const commitState = useCallback((nextStatus: AuthStatus, nextError: unknown = null) => {
    if (!mountedRef.current) {
      return;
    }
    setStatus(nextStatus);
    setError(nextError);
  }, []);

  const resetSignedOutState = useCallback(() => {
    requestVersionRef.current += 1;
    queryClient.clear();
    commitState("signedOut");
  }, [commitState, queryClient]);

  const validateSession = useCallback(
    async (session: Session | null, showChecking: boolean): Promise<AuthPreparationResult | "signedOut"> => {
      const requestVersion = ++requestVersionRef.current;
      if (!session) {
        resetSignedOutState();
        return "signedOut";
      }
      if (showChecking) {
        commitState("checking");
      }
      try {
        await getMyProfile();
        if (requestVersion === requestVersionRef.current) {
          commitState("ready");
        }
        return "ready";
      } catch (sessionError) {
        if (requestVersion !== requestVersionRef.current) {
          throw sessionError;
        }
        const failureStatus = profileCheckFailureStatus(sessionError);
        if (failureStatus === "needsProfile") {
          commitState("needsProfile");
          return "needsProfile";
        }
        if (failureStatus === "signedOut") {
          try {
            await revokeSession();
          } finally {
            resetSignedOutState();
          }
          return "signedOut";
        }
        commitState("error", sessionError);
        throw sessionError;
      }
    },
    [commitState, resetSignedOutState]
  );

  useEffect(() => {
    mountedRef.current = true;
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT") {
        resetSignedOutState();
        return;
      }
      if (event === "INITIAL_SESSION" || operationInProgressRef.current) {
        return;
      }
      if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED" || event === "USER_UPDATED") {
        void validateSession(session, false).catch(() => undefined);
      }
    });

    void supabase.auth
      .getSession()
      .then(({ data: sessionData, error: sessionError }) => {
        if (sessionError) {
          commitState("error", sessionError);
          return;
        }
        return validateSession(sessionData.session, true).catch(() => undefined);
      })
      .catch((sessionError: unknown) => commitState("error", sessionError));

    return () => {
      mountedRef.current = false;
      requestVersionRef.current += 1;
      data.subscription.unsubscribe();
    };
  }, [commitState, resetSignedOutState, validateSession]);

  const signInAndPrepare = useCallback(
    async (input: SignInInput) => {
      operationInProgressRef.current = true;
      try {
        const session = await signIn(input);
        const result = await validateSession(session, false);
        if (result === "signedOut") {
          throw new Error("Sign in did not create a valid session");
        }
        return result;
      } finally {
        operationInProgressRef.current = false;
      }
    },
    [validateSession]
  );

  const signUpAndPrepare = useCallback(
    async (input: SignUpInput, profile: SyncProfileInput) => {
      operationInProgressRef.current = true;
      requestVersionRef.current += 1;
      try {
        const session = await signUp(input);
        if (!session) {
          commitState("signedOut");
          return "verificationRequired";
        }
        try {
          await syncProfile(profile);
          commitState("ready");
          return "ready";
        } catch (profileError) {
          commitState("error", profileError);
          throw profileError;
        }
      } finally {
        operationInProgressRef.current = false;
      }
    },
    [commitState]
  );

  const completeProfile = useCallback(
    async (profile: SyncProfileInput) => {
      operationInProgressRef.current = true;
      requestVersionRef.current += 1;
      try {
        await syncProfile(profile);
        commitState("ready");
      } catch (profileError) {
        commitState("error", profileError);
        throw profileError;
      } finally {
        operationInProgressRef.current = false;
      }
    },
    [commitState]
  );

  const retrySessionCheck = useCallback(async () => {
    try {
      const { data, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) {
        commitState("error", sessionError);
        throw sessionError;
      }
      await validateSession(data.session, true);
    } catch (sessionError) {
      if (status !== "signedOut") {
        commitState("error", sessionError);
      }
      throw sessionError;
    }
  }, [commitState, status, validateSession]);

  const signOut = useCallback(async () => {
    operationInProgressRef.current = true;
    try {
      await revokeSession();
      resetSignedOutState();
    } finally {
      operationInProgressRef.current = false;
    }
  }, [resetSignedOutState]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      error,
      signInAndPrepare,
      signUpAndPrepare,
      completeProfile,
      retrySessionCheck,
      signOut
    }),
    [status, error, signInAndPrepare, signUpAndPrepare, completeProfile, retrySessionCheck, signOut]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return value;
}
