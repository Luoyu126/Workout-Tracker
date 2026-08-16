export type ApiEnvelope<T> = {
  data: T | null;
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  } | null;
  request_id: string;
};

export * from "./generated";
