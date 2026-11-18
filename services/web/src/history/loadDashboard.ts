// The only reference to the chart chunk. import() inside a function runs when the
// function is called, not when this file loads, and the bundler splits the
// imported file and everything only it reaches (the chart library) into a chunk
// of its own. A module of its own so a test can watch the call (ADR 0033: the
// chunk loads on the Dashboard's first open, not with History).
export const loadDashboard = () => import("../dashboards/Dashboard");
