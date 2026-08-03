import { describe, expect, it } from "vitest";

import { collectAppPackageValidationIssues } from "@/packages/shared/contracts/package";
import {
  formatLocalizedText,
  localizePackageUiValue,
  resolveLocalizedText,
  resolvePackageLocale,
  resolvePackageLocaleChain,
} from "@/src/presentation/package-localization";

const localization = {
  defaultLocale: "en-US",
  fallbackLocale: "en",
  appLocale: "ru-RU",
  messages: {
    en: { title: "Checklist", action: "Edit {item}" },
    ru: { title: "Список дел", action: "Изменить: {item}" },
  },
} as const;

describe("package localization", () => {
  it("uses an explicit caller preference before the package preference", () => {
    expect(resolvePackageLocale(localization, { appLocale: "en-GB" })).toBe("en-gb");
    expect(resolvePackageLocaleChain(localization, { appLocale: "en-GB" })).toEqual([
      "en-gb",
      "en",
      "ru-ru",
      "ru",
      "en-us",
    ]);
  });

  it("uses the shell locale after explicit package preference and before defaults", () => {
    const withoutPreference = { ...localization, appLocale: undefined };
    expect(resolvePackageLocaleChain(withoutPreference, { deviceLocale: "ru-RU" })).toEqual([
      "ru-ru",
      "ru",
      "en-us",
      "en",
    ]);
  });

  it("resolves region fallback, leaves unknown tokens visible, and localizes nested UI props", () => {
    expect(resolveLocalizedText("$l:title", localization, { appLocale: "ru-RU" })).toBe("Список дел");
    expect(resolveLocalizedText("$l:missing", localization, { appLocale: "ru" })).toBe("$l:missing");
    expect(localizePackageUiValue({
      title: "$l:title",
      props: { copy: { action: "$l:action" } },
    }, localization, { appLocale: "ru" })).toEqual({
      title: "Список дел",
      props: { copy: { action: "Изменить: {item}" } },
    });
  });

  it("formats generic accessibility templates without a native dependency", () => {
    expect(formatLocalizedText("Изменить: {item}", "Edit {item}", { item: "Молоко" }))
      .toBe("Изменить: Молоко");
  });

  it("rejects malformed package localization metadata", () => {
    const issues = collectAppPackageValidationIssues({
      schemaVersion: "wonder.app-package.v2",
      id: "bad-locales",
      version: "1.0.0",
      collections: {},
      queries: {},
      views: {},
      rules: [],
      capabilities: [],
      acceptanceTests: [],
      presentation: {
        label: "Bad",
        surfaces: [],
        ui: {
          localization: { defaultLocale: "not a locale", messages: { ru: { title: "" } } },
          screens: { home: { components: [] } },
        },
      },
    });
    expect(issues.some((issue) => issue.category === "reference.ui.localization")).toBe(true);
  });
});
