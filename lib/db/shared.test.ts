/**
 * The pure helpers behind `lib/db/**`.
 *
 * The queries themselves cannot be run here — there is no reachable Supabase
 * in this environment — but paging arithmetic and PostgREST filter quoting are
 * plain functions, and both are places where a quiet mistake shows up as
 * missing rows rather than as an error.
 */
import { describe, expect, it } from "vitest";

import {
  containsPattern,
  DEFAULT_PER_PAGE,
  escapeLikeWildcards,
  likePattern,
  MAX_PER_PAGE,
  normalizeSearch,
  quoteOrValue,
  resolvePage,
  toPaged,
} from "./shared";

describe("resolvePage", () => {
  it("default halaman 1 dengan MAX 50 baris", () => {
    expect(resolvePage(undefined)).toEqual({
      page: 1,
      perPage: DEFAULT_PER_PAGE,
      from: 0,
      to: DEFAULT_PER_PAGE - 1,
    });
  });

  it("menghitung range PostgREST yang inklusif", () => {
    expect(resolvePage({ page: 3, perPage: 20 })).toEqual({
      page: 3,
      perPage: 20,
      from: 40,
      to: 59,
    });
  });

  it("menjepit nilai di luar batas, bukan mengirim range negatif", () => {
    expect(resolvePage({ page: 0 }).page).toBe(1);
    expect(resolvePage({ page: -5 }).page).toBe(1);
    expect(resolvePage({ perPage: 0 }).perPage).toBe(DEFAULT_PER_PAGE);
    expect(resolvePage({ perPage: -1 }).perPage).toBe(1);
    expect(resolvePage({ perPage: 10_000 }).perPage).toBe(MAX_PER_PAGE);
    expect(resolvePage({ page: 1.7, perPage: 10.2 })).toMatchObject({ page: 1, perPage: 10 });
  });
});

describe("toPaged", () => {
  it("menghitung jumlah halaman", () => {
    expect(toPaged([{ id: 1 }], 101, 1, 50)).toEqual({
      rows: [{ id: 1 }],
      page: 1,
      perPage: 50,
      total: 101,
      pageCount: 3,
    });
  });

  it("tanpa baris pun tetap satu halaman, supaya 'Halaman 1 dari 1' masuk akal", () => {
    expect(toPaged([], 0, 1, 50).pageCount).toBe(1);
  });

  it("mundur ke panjang baris kalau count tidak dikembalikan", () => {
    expect(toPaged([{ id: 1 }, { id: 2 }], null, 1, 50).total).toBe(2);
  });
});

describe("quoteOrValue", () => {
  it("mengutip nilai supaya koma tidak memecah filter or()", () => {
    expect(quoteOrValue("Budi, Contoh")).toBe('"Budi, Contoh"');
  });

  it("meng-escape kutip dan backslash", () => {
    expect(quoteOrValue('Budi "Bud" Contoh')).toBe('"Budi \\"Bud\\" Contoh"');
    expect(quoteOrValue("C:\\temp")).toBe('"C:\\\\temp"');
  });

  it("tanda kurung tidak pernah lolos mentah ke dalam filter", () => {
    const pattern = containsPattern("Divisi (lama)");
    expect(pattern.startsWith('"')).toBe(true);
    expect(pattern.endsWith('"')).toBe(true);
    expect(pattern).toBe('"%Divisi (lama)%"');
  });

  it("containsPattern memangkas spasi di ujung", () => {
    expect(containsPattern("  budi  ")).toBe('"%budi%"');
  });
});

describe("escapeLikeWildcards", () => {
  it("membuat % dan _ dicari sebagai huruf biasa, bukan wildcard", () => {
    expect(escapeLikeWildcards("100%")).toBe("100\\%");
    expect(escapeLikeWildcards("DIV_HC")).toBe("DIV\\_HC");
  });

  it("meng-escape backslash supaya escape-nya sendiri tidak bisa dibajak", () => {
    expect(escapeLikeWildcards("a\\b")).toBe("a\\\\b");
  });

  it("likePattern membungkus dengan % di kedua ujung setelah escape", () => {
    expect(likePattern("100%")).toBe("%100\\%%");
    expect(likePattern(" budi ")).toBe("%budi%");
  });

  it("containsPattern menggabung escape LIKE dan kutip or()", () => {
    // Wildcard di-escape jadi \%, lalu backslash-nya digandakan untuk or().
    expect(containsPattern("100%")).toBe('"%100\\\\%%"');
  });
});

describe("normalizeSearch", () => {
  it("kosong dan spasi berarti tidak ada pencarian", () => {
    expect(normalizeSearch("")).toBeNull();
    expect(normalizeSearch("   ")).toBeNull();
    expect(normalizeSearch(null)).toBeNull();
    expect(normalizeSearch(undefined)).toBeNull();
  });

  it("memangkas dan mempertahankan isinya", () => {
    expect(normalizeSearch("  Budi ")).toBe("Budi");
  });
});
