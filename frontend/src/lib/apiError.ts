interface ApiErrorEnvelope {
  detail?: unknown;
  message?: unknown;
  error?: {
    code?: unknown;
    message?: unknown;
    details?: unknown;
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const readNonEmptyString = (value: unknown) =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

const readResponseData = (error: unknown): ApiErrorEnvelope | null => {
  if (!isRecord(error) || !isRecord(error.response)) {
    return null;
  }

  return isRecord(error.response.data)
    ? (error.response.data as ApiErrorEnvelope)
    : null;
};

export const getUserFacingErrorMessage = (
  error: unknown,
  fallback: string,
): string => {
  const data = readResponseData(error);
  const backendMessage =
    readNonEmptyString(data?.error?.message) ??
    readNonEmptyString(data?.detail) ??
    readNonEmptyString(data?.message);

  if (backendMessage) {
    return backendMessage;
  }

  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  if (isRecord(error)) {
    const message = readNonEmptyString(error.message);
    if (message) {
      return message;
    }
  }

  return fallback;
};

export const getUserFacingErrorCode = (error: unknown): string | null => {
  const data = readResponseData(error);
  return readNonEmptyString(data?.error?.code);
};
