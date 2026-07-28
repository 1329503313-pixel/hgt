import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateGiftConsumption,
  calculateGiftInventoryCredit,
  MAX_GIFT_INVENTORY_QUANTITY
} from "./giftInventory.js";

test("gift sending purchases every unit when inventory is empty", () => {
  assert.deepEqual(calculateGiftConsumption(0, 5, 20), {
    inventoryQuantityUsed: 0,
    purchasedQuantity: 5,
    inventoryQuantityAfter: 0,
    totalCost: 100
  });
});

test("gift sending consumes inventory before purchasing the shortage", () => {
  assert.deepEqual(calculateGiftConsumption(3, 5, 20), {
    inventoryQuantityUsed: 3,
    purchasedQuantity: 2,
    inventoryQuantityAfter: 0,
    totalCost: 40
  });
});

test("gift sending does not charge shells when inventory covers the quantity", () => {
  assert.deepEqual(calculateGiftConsumption(9, 5, 20), {
    inventoryQuantityUsed: 5,
    purchasedQuantity: 0,
    inventoryQuantityAfter: 4,
    totalCost: 0
  });
});

test("gift inventory caps at 999 and converts overflow at the gift shell price", () => {
  assert.deepEqual(calculateGiftInventoryCredit(998, 4, 20), {
    creditedQuantity: 1,
    inventoryQuantityAfter: MAX_GIFT_INVENTORY_QUANTITY,
    overflowQuantity: 3,
    overflowShell: 60
  });
});
