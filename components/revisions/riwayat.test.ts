import { describe, expect, it } from "vitest";

import {
  panelFetchLimit,
  RIWAYAT_DITAMPILKAN,
  RIWAYAT_LIMIT,
} from "./riwayat";

/**
 * The one thing that can go quietly wrong between a detail page and
 * `RevisionPanel`: the page reads N Revisi, the panel believes it asked for M,
 * and the footnote "Menampilkan M Revisi terbaru. Riwayat selengkapnya ada di
 * Log Perubahan." appears (or fails to appear) on the wrong list.
 *
 * Nothing here needs React or a database — which is the point of keeping the
 * ceiling in a pure module both sides import.
 */
describe("panelFetchLimit", () => {
  it("never asks for fewer than 50", () => {
    expect(panelFetchLimit(1)).toBe(50);
    expect(panelFetchLimit(10)).toBe(50);
  });

  it("asks for five times what it draws once that passes 50", () => {
    expect(panelFetchLimit(11)).toBe(55);
    expect(panelFetchLimit(20)).toBe(100);
  });

  it("never asks for more than the Server Action allows", () => {
    // `loadRowRevisions` caps `limit` at 200; asking for more would be refused.
    expect(panelFetchLimit(40)).toBe(200);
    expect(panelFetchLimit(1000)).toBe(200);
  });
});

describe("RIWAYAT_LIMIT", () => {
  it("is exactly what the panel would have fetched for itself", () => {
    expect(RIWAYAT_LIMIT).toBe(panelFetchLimit(RIWAYAT_DITAMPILKAN));
  });

  it("is five times the number of Revisi drawn", () => {
    expect(RIWAYAT_LIMIT).toBe(RIWAYAT_DITAMPILKAN * 5);
  });
});
