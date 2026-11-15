// Search and Dashboards are opened from a window's header and return to it. The
// link that opens them passes where it was, window and Day, as router state.
export interface BackState {
  back: string;
}

// location.state is whatever a link chose to pass, so it is read as unknown.
export function backTarget(state: unknown) {
  if (
    typeof state === "object" &&
    state !== null &&
    "back" in state &&
    typeof state.back === "string"
  ) {
    return state.back;
  }
  return "/exercise";
}
