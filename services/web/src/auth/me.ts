import { useQuery } from "@tanstack/react-query";

import { api, ApiError, unwrap } from "../api/client";

// One cache entry for the signed-in User: the app shell reads the Role from it and
// Dashboards reads the Restaurant Day calories, so neither asks twice.
export const ME_KEY = ["me"];

export function useMe() {
  return useQuery({
    queryKey: ME_KEY,
    queryFn: () => unwrap(api.GET("/api/me")),
  });
}

const SIGNUP_CLOSED = "urn:health-tracker:problem:signup-closed";

// GET /api/me refused an identity that is not yet a User because the Sign-up brake is
// closed (ADR 0026). Known Users, Pending ones included, never get this.
export function isSignupClosed(error: unknown) {
  return error instanceof ApiError && error.problem.type === SIGNUP_CLOSED;
}
