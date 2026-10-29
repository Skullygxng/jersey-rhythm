const CHART_OFFSET_KEY = "jersey-rhythm-chart-offsets-v1";

export function loadChartOffsets() {
  try {
    if (typeof window === "undefined") return {};
    const raw = localStorage.getItem(CHART_OFFSET_KEY);
    if (!raw) return {};
    const value = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return value;
  } catch {
    return {};
  }
}

export function saveChartOffsets(offsets) {
  try {
    if (typeof window === "undefined") return;
    localStorage.setItem(CHART_OFFSET_KEY, JSON.stringify(offsets));
  } catch {}
}
