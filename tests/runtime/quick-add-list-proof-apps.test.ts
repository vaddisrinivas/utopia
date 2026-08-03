import pantryPackage from "@/apps/pantry-restock/pantry-restock.v1.json";
import offlineChecklistPackage from "@/apps/offline-checklist/offline-checklist.v1.json";
import shoppingPackage from "@/apps/shopping-list/shopping-list.v1.json";
import { validateAppPackage } from "@/server/src/kernel/package";
import { describe, expect, it } from "vitest";

type ListPackage = {
  presentation: { ui: { defaultScreen: string; screens: Record<string, { components: Array<{ widget?: string; props?: Record<string, unknown> }> }> } };
};

function defaultComponents(appPackage: ListPackage) {
  return appPackage.presentation.ui.screens[appPackage.presentation.ui.defaultScreen].components;
}

function packageWidgets(appPackage: ListPackage) {
  return Object.values(appPackage.presentation.ui.screens)
    .flatMap((screen) => screen.components)
    .flatMap((component) => component.widget ?? []);
}

describe("quick-add list proof apps", () => {
  it.each([
    ["Shopping List", shoppingPackage, ["structuredList"]],
    ["Offline Checklist", offlineChecklistPackage, ["quickAddList"]],
    ["Pantry Restock", pantryPackage, ["structuredList", "groupedRecordShelf"]],
  ])(
    "%s validates with reusable list controls",
    (_name, appPackage, expectedWidgets) => {
      expect(validateAppPackage(appPackage)).toMatchObject({ valid: true });
      expect(packageWidgets(appPackage as ListPackage)).toEqual(expect.arrayContaining(expectedWidgets));
    },
  );

  it("contains no shopping- or pantry-specific widget kinds", () => {
    const surfaces = JSON.stringify([
      shoppingPackage.presentation.ui,
      offlineChecklistPackage.presentation.ui,
      pantryPackage.presentation.ui,
    ]);
    expect(surfaces).not.toMatch(/shoppingList|pantryRestock|restockQueue/i);
  });

  it.each([
    ["Shopping List", shoppingPackage, false],
    ["Offline Checklist", offlineChecklistPackage, true],
  ])(
    "%s exposes complete reusable list controls",
    (_name, appPackage, expectsNotes) => {
      const widget = defaultComponents(appPackage as ListPackage).find(
        (component) => component.widget === (_name === "Shopping List" ? "structuredList" : "quickAddList"),
      );
      expect(widget).toBeDefined();
      if (!widget) throw new Error(`missing ${_name} primary list widget`);
      if (_name === "Shopping List") {
        expect(widget.props).toMatchObject({
          pickedField: "checked",
          collection: "shopping_item",
          filterFields: ["category", "unit"],
        });
        return;
      }
      expect(widget.props).toMatchObject({ checkedField: "checked", editable: true, deletable: true });
      const props = widget.props ?? {};
      expect(Boolean("noteField" in props)).toBe(expectsNotes);
      if (expectsNotes) expect(widget.props).toMatchObject({ autoSaveEdits: true });
    },
  );
});
