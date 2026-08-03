import travelPackingPackage from "@/apps/travel-packing-list/travel-packing-list.v1.json";
import {
  structuredListBulkTitles,
  structuredListCoerceValues,
  structuredListFilterFields,
  structuredListMatchesFilters,
  structuredListMetadataFields,
  structuredListReplaceMetadata,
  structuredListSortRecords,
  structuredListSorts,
} from "@/src/presentation/widgets/structured-list-config";
import { validateAppPackage } from "@/server/src/kernel/package";
import { describe, expect, it } from "vitest";

const shoppingFields = structuredListMetadataFields([
  { field: "quantity", label: "Quantity", type: "number", sortable: true },
  { field: "aisle", label: "Aisle", type: "select", options: ["Produce", "Dairy"], filterable: true, sortable: true },
  { field: "link", label: "Product link", type: "url" },
]);

describe("structured list configuration", () => {
  it("coerces configurable text, number, select, and URL metadata without app names", () => {
    expect(structuredListCoerceValues({ quantity: "2.5", aisle: "Dairy", link: "https://example.test/milk" }, shoppingFields)).toEqual({
      quantity: 2.5,
      aisle: "Dairy",
      link: "https://example.test/milk",
    });
    expect(structuredListReplaceMetadata({ aisle: "Dairy", quantity: 2, position: 4 }, { aisle: "Produce", quantity: "" }, shoppingFields)).toEqual({
      position: 4,
      aisle: "Produce",
    });
  });

  it("sorts, filters, and bulk-adds generic records deterministically", () => {
    const records = [
      { title: "Rice", properties: { position: 2, aisle: "Pantry", quantity: 1 } },
      { title: "Apples", properties: { position: 1, aisle: "Produce", quantity: 6 } },
    ];
    const sorts = structuredListSorts(["manual", "alphabetic", { kind: "field", field: "quantity", direction: "desc" }], shoppingFields, "position");
    expect(structuredListSortRecords(records, sorts[1]!, "position").map((record) => record.title)).toEqual(["Apples", "Rice"]);
    expect(structuredListMatchesFilters(records[0]!, "", { aisle: "Pantry" })).toBe(true);
    expect(structuredListMatchesFilters(records[0]!, "", { aisle: "Produce" })).toBe(false);
    expect(structuredListBulkTitles("Milk\nMilk\nRice\n")).toEqual(["Milk", "Rice"]);
  });

  it("can configure an unrelated packing collection without changing its package", () => {
    const fields = structuredListMetadataFields([
      { field: "category", label: "Category", type: "select", options: ["Clothes", "Toiletries"], filterable: true },
      { field: "quantity", label: "Quantity", type: "number", sortable: true },
      { field: "trip_id", label: "Trip", type: "text", filterable: true },
    ]);
    expect(validateAppPackage(travelPackingPackage)).toMatchObject({ valid: true });
    expect(Object.keys(travelPackingPackage.collections.packing_item.fields)).toEqual(expect.arrayContaining(fields.map((field) => field.field)));
    expect(structuredListFilterFields(["category", "trip_id"], fields).map((field) => field.field)).toEqual(["category", "trip_id"]);
    expect(structuredListSorts(["manual", "alphabetic", "quantity"], fields, "position").map((sort) => sort.kind)).toEqual(expect.arrayContaining(["manual", "alphabetic", "field"]));
  });
});
