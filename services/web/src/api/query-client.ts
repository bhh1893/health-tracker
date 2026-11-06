import { QueryClient } from "@tanstack/react-query";

import { ApiError } from "./client";

const MAX_RETRIES = 2;

// Retry what might work a moment later: a dropped connection or a 5xx during a
// rollout. A 4xx is an answer, and asking again gets the same one.
export function shouldRetry(failureCount: number, error: unknown) {
  if (error instanceof ApiError && error.problem.status < 500) {
    return false;
  }
  return failureCount < MAX_RETRIES;
}

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: shouldRetry,
        // Only this user writes this data, and every write will update the cache,
        // so a screen revisited within 30 s can skip the refetch.
        staleTime: 30_000,
      },
      // Safe only because every write is an idempotent PUT or DELETE (ADR 0007).
      mutations: { retry: shouldRetry },
    },
  });
}
