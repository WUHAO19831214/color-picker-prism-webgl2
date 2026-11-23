// Variant switcher shell matching ui-feed.dev/p/color-picker-prism-1eqhn3?v=3

import { PRESETS } from "./presets.js";
import { mountPrismWidget } from "./prism-widget.js";

const stageEl = document.getElementById("prism-stage");
const prevBtn = document.getElementById("btn-prev");
const nextBtn = document.getElementById("btn-next");
const dotsEl = document.getElementById("variant-dots");
const countEl = document.getElementById("variant-count");

let activeIndex = (() => {
  const params = new URLSearchParams(window.location.search);
  const v = Number.parseInt(params.get("v") || "3", 10);
  return v >= 1 && v <= PRESETS.length ? v - 1 : 2;
})();

let currentWidget = null;

function renderDots() {
  dotsEl.innerHTML = "";
  PRESETS.forEach((preset, idx) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "dot" + (idx === activeIndex ? " is-active" : "");
    btn.setAttribute("aria-label", `Variant ${idx + 1}: ${preset.label}`);
    btn.addEventListener("click", () => setVariant(idx));
    dotsEl.appendChild(btn);
  });
}

function setVariant(idx) {
  const next = Math.max(0, Math.min(PRESETS.length - 1, idx));
  if (currentWidget && next === activeIndex) return;
  activeIndex = next;

  if (currentWidget) {
    currentWidget.destroy();
    currentWidget = null;
  }

  currentWidget = mountPrismWidget(stageEl, PRESETS[activeIndex]);

  prevBtn.disabled = activeIndex === 0;
  nextBtn.disabled = activeIndex === PRESETS.length - 1;
  countEl.textContent = `${activeIndex + 1}/${PRESETS.length}`;
  renderDots();

  const url = new URL(window.location.href);
  url.searchParams.set("v", String(activeIndex + 1));
  window.history.replaceState(null, "", url.toString());
}

prevBtn.addEventListener("click", () => setVariant(activeIndex - 1));
nextBtn.addEventListener("click", () => setVariant(activeIndex + 1));

window.addEventListener("keydown", (ev) => {
  const tag = document.activeElement?.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") return;
  if (ev.key === "h") setVariant(activeIndex - 1);
  else if (ev.key === "l") setVariant(activeIndex + 1);
});

setVariant(activeIndex);
