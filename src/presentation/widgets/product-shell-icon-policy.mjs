export const PRODUCT_SHELL_SUPPORTED_ICON_IDS = Object.freeze([
  "archive",
  "bar-chart",
  "book",
  "book-open",
  "bookmark",
  "briefcase",
  "calculator",
  "calendar",
  "check",
  "clipboard-check",
  "clipboard-list",
  "dumbbell",
  "edit-3",
  "flame",
  "function-square",
  "history",
  "home",
  "line-chart",
  "list",
  "list-plus",
  "message-square",
  "play",
  "plus",
  "rotate-ccw",
  "search",
  "settings",
  "shield-check",
  "shopping-cart",
  "sliders-horizontal",
  "superscript",
  "table",
  "trending-up",
]);

const PRODUCT_SHELL_SUPPORTED_ICON_ID_SET = new Set(PRODUCT_SHELL_SUPPORTED_ICON_IDS);

export function isProductShellSupportedIconId(value) {
  return typeof value === "string" && PRODUCT_SHELL_SUPPORTED_ICON_ID_SET.has(value);
}
