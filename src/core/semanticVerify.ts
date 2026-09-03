import { ParsedVillager } from "./types";
import { toEditableVillagerState } from "./editableState";
import { deepEqualSafe } from "./clone";

export function assertVillagerSemanticMatch(
  intended: ParsedVillager,
  actual: ParsedVillager
): void {
  if (actual.identifier !== intended.identifier) {
    throw new Error(
      `Entity identifier mismatch after save: expected ${intended.identifier}, got ${actual.identifier}`
    );
  }

  const expected = toEditableVillagerState(intended);
  const observed = toEditableVillagerState(actual);

  if (!deepEqualSafe(expected, observed)) {
    throw new Error(
      `Post-save semantic verification failed: re-parsed villager does not match intended editable state.\nExpected: ${JSON.stringify(expected)}\nObserved: ${JSON.stringify(observed)}`
    );
  }
}
