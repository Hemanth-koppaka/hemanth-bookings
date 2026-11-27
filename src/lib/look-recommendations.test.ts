import { describe, test } from "node:test";
import { deepStrictEqual } from "node:assert";
import { resolveRecommendations } from "./look-recommendations";
import type { Category } from "./salon";

describe("selected-menu recommendations", () => {
  const menu: Category[] = [{ id: "beard", title: "Beard", services: [{ id: "beard-trim", name: "Beard trim", price: 200, minutes: 30, slots: 1 }] }];
  test("only services from the selected menu can be recommended", () => {
    deepStrictEqual(resolveRecommendations({ summary: "", recommendations: [{ serviceId: "women-colour", reason: "Colour" }] }, menu), []);
  });
  test("new categories work without special category handling", () => {
    deepStrictEqual(resolveRecommendations({ summary: "", recommendations: [{ serviceId: "beard-trim", reason: "Shape" }, { serviceId: "beard-trim", reason: "Duplicate" }] }, menu), [{ id: "beard-trim", name: "Beard trim", price: 200, minutes: 30, from: false, reason: "Shape" }]);
  });
});