/**
 * Query-string parsing for `/api/v1`.
 *
 * The rule under test everywhere here: a parameter is either understood or
 * refused. A Konsumen that mistypes a filter and silently receives the
 * unfiltered table would sync the wrong data and never see an error —
 * `per_page` is the single deliberate exception, because API-CONTRACT.md
 * defines it as a range ("default 100, max 500") rather than a set.
 */
import { describe, expect, it } from "vitest";

import { LOOKUP_TYPES } from "@/lib/validation/lookupTypes";

import { isApiError, type ApiError } from "./errors";
import {
  MAX_SEARCH_LENGTH,
  parseBooleanParam,
  parseLookupTipe,
  parseOrgUnitTipe,
  parsePagination,
  parseSearchParam,
  parseStatusFilter,
  parseTimestampParam,
  parseUuidParam,
  parseWholeNumber,
  readSingleParam,
} from "./query";

const UUID = "3f1a0c7e-2b4d-4a8e-9c1f-5d6e7a8b9c0d";

function params(query: string): URLSearchParams {
  return new URL(`https://hc.example/api/v1/employees?${query}`).searchParams;
}

function caught(run: () => unknown): ApiError {
  try {
    run();
  } catch (error) {
    if (isApiError(error)) return error;
    throw error;
  }
  throw new Error("Seharusnya melempar ApiError.");
}

describe("readSingleParam", () => {
  it("mengembalikan nilai yang sudah dipangkas", () => {
    expect(readSingleParam(params("fields=%20full_name%20"), "fields")).toBe("full_name");
  });

  it("null kalau tidak dikirim atau kosong", () => {
    expect(readSingleParam(params(""), "fields")).toBeNull();
    expect(readSingleParam(params("fields="), "fields")).toBeNull();
    expect(readSingleParam(params("fields=%20"), "fields")).toBeNull();
  });

  it("400 kalau parameter yang sama dikirim dua kali", () => {
    // URLSearchParams.get() diam-diam memakai yang pertama; itu berarti baris
    // sebagian (fields) atau filter yang salah (status) tanpa pesan apa pun.
    const error = caught(() =>
      readSingleParam(params("fields=nip&fields=full_name"), "fields"),
    );
    expect(error.code).toBe("INVALID_QUERY");
    expect(error.details).toEqual({ param: "fields" });
  });

  it("aturan yang sama berlaku untuk setiap parameter", () => {
    expect(caught(() => parseStatusFilter(params("status=aktif&status=semua"))).code).toBe(
      "INVALID_QUERY",
    );
    expect(caught(() => parsePagination(params("per_page=10&per_page=20"))).code).toBe(
      "INVALID_QUERY",
    );
  });
});

describe("parsePagination", () => {
  it("default page 1, per_page 100", () => {
    expect(parsePagination(params(""))).toEqual({
      page: 1,
      perPage: 100,
      from: 0,
      to: 99,
    });
  });

  it("menghitung range PostgREST untuk halaman berikutnya", () => {
    expect(parsePagination(params("page=3&per_page=25"))).toEqual({
      page: 3,
      perPage: 25,
      from: 50,
      to: 74,
    });
  });

  it("per_page dibatasi di 500", () => {
    const { perPage, from, to } = parsePagination(params("per_page=10000"));
    expect(perPage).toBe(500);
    expect(to - from + 1).toBe(500);
  });

  it("per_page 0 naik ke 1", () => {
    expect(parsePagination(params("per_page=0")).perPage).toBe(1);
  });

  it("page 0 dianggap halaman 1", () => {
    expect(parsePagination(params("page=0"))).toMatchObject({ page: 1, from: 0 });
  });

  it("400 untuk page / per_page yang bukan bilangan bulat", () => {
    for (const query of ["page=abc", "page=-1", "per_page=1.5", "per_page=dua"]) {
      const error = caught(() => parsePagination(params(query)));
      expect(error.code).toBe("INVALID_QUERY");
      expect(error.status).toBe(400);
    }
  });

  it("menyebut parameter mana yang salah", () => {
    expect(caught(() => parsePagination(params("per_page=x"))).details).toEqual({
      param: "per_page",
    });
  });

  it("nilai kosong dianggap tidak dikirim", () => {
    expect(parsePagination(params("page=&per_page="))).toMatchObject({
      page: 1,
      perPage: 100,
    });
  });
});

describe("parseWholeNumber", () => {
  it("menolak angka di luar jangkauan aman", () => {
    expect(caught(() => parseWholeNumber(params("n=99999999999999999999"), "n", 1)).code).toBe(
      "INVALID_QUERY",
    );
  });
});

describe("parseStatusFilter", () => {
  it("default aktif", () => {
    expect(parseStatusFilter(params(""))).toBe("aktif");
  });

  it("menerima ketiga nilai", () => {
    expect(parseStatusFilter(params("status=nonaktif"))).toBe("nonaktif");
    expect(parseStatusFilter(params("status=semua"))).toBe("semua");
    expect(parseStatusFilter(params("status=aktif"))).toBe("aktif");
  });

  it("400 untuk nilai lain — tidak diam-diam dianggap 'semua'", () => {
    const error = caught(() => parseStatusFilter(params("status=aktiv")));
    expect(error.code).toBe("INVALID_QUERY");
    expect(error.message).toContain("aktif, nonaktif, semua");
  });

  it("peka huruf besar-kecil", () => {
    expect(caught(() => parseStatusFilter(params("status=Aktif"))).code).toBe(
      "INVALID_QUERY",
    );
  });

  it("fallback bisa diganti", () => {
    expect(parseStatusFilter(params(""), "semua")).toBe("semua");
  });
});

describe("parseUuidParam", () => {
  it("null kalau tidak dikirim", () => {
    expect(parseUuidParam(params(""), "org_unit_id")).toBeNull();
  });

  it("mengembalikan uuid huruf kecil", () => {
    expect(parseUuidParam(params(`org_unit_id=${UUID.toUpperCase()}`), "org_unit_id")).toBe(
      UUID,
    );
  });

  it("400 untuk yang bukan uuid", () => {
    for (const bad of ["org_unit_id=123", "org_unit_id=DIV-HC", `org_unit_id=${UUID}x`]) {
      expect(caught(() => parseUuidParam(params(bad), "org_unit_id")).code).toBe(
        "INVALID_QUERY",
      );
    }
  });
});

describe("parseBooleanParam", () => {
  it("default dipakai kalau tidak dikirim", () => {
    expect(parseBooleanParam(params(""), "include_children", true)).toBe(true);
    expect(parseBooleanParam(params(""), "include_children", false)).toBe(false);
  });

  it("menerima true/false/1/0 tanpa peduli huruf besar-kecil", () => {
    expect(parseBooleanParam(params("include_children=TRUE"), "include_children", false)).toBe(
      true,
    );
    expect(parseBooleanParam(params("include_children=false"), "include_children", true)).toBe(
      false,
    );
    expect(parseBooleanParam(params("include_children=1"), "include_children", false)).toBe(true);
    expect(parseBooleanParam(params("include_children=0"), "include_children", true)).toBe(false);
  });

  it("400 untuk nilai lain — 'yes' tidak boleh diam-diam berarti 'no'", () => {
    expect(
      caught(() => parseBooleanParam(params("include_children=yes"), "include_children", true))
        .code,
    ).toBe("INVALID_QUERY");
  });
});

describe("parseTimestampParam", () => {
  it("null kalau tidak dikirim", () => {
    expect(parseTimestampParam(params(""), "updated_since")).toBeNull();
  });

  it("tanggal saja jadi tengah malam UTC", () => {
    expect(parseTimestampParam(params("updated_since=2026-03-01"), "updated_since")).toBe(
      "2026-03-01T00:00:00.000Z",
    );
  });

  it("ISO 8601 dengan Z dipertahankan", () => {
    expect(
      parseTimestampParam(params("updated_since=2026-03-01T09:30:00Z"), "updated_since"),
    ).toBe("2026-03-01T09:30:00.000Z");
  });

  it("offset zona waktu dinormalkan ke UTC", () => {
    expect(
      parseTimestampParam(
        params(`updated_since=${encodeURIComponent("2026-03-01T09:30:00+07:00")}`),
        "updated_since",
      ),
    ).toBe("2026-03-01T02:30:00.000Z");
  });

  it("waktu tanpa offset dibaca sebagai UTC, bukan waktu lokal server", () => {
    expect(
      parseTimestampParam(params("updated_since=2026-03-01T09:30:00"), "updated_since"),
    ).toBe("2026-03-01T09:30:00.000Z");
  });

  it("400 untuk format yang tidak dikenal", () => {
    for (const bad of ["updated_since=kemarin", "updated_since=01-03-2026", "updated_since=2026"]) {
      expect(caught(() => parseTimestampParam(params(bad), "updated_since")).code).toBe(
        "INVALID_QUERY",
      );
    }
  });

  it("400 untuk tanggal yang tidak ada di kalender", () => {
    // `new Date("2026-02-30")` menggulung ke Maret tanpa mengeluh.
    for (const bad of ["2026-02-30", "2026-13-01", "2025-02-29"]) {
      expect(
        caught(() => parseTimestampParam(params(`updated_since=${bad}`), "updated_since"))
          .code,
      ).toBe("INVALID_QUERY");
    }
  });

  it("29 Februari tahun kabisat tetap diterima", () => {
    expect(parseTimestampParam(params("updated_since=2028-02-29"), "updated_since")).toBe(
      "2028-02-29T00:00:00.000Z",
    );
  });

  it("400 untuk jam yang tidak mungkin", () => {
    expect(
      caught(() =>
        parseTimestampParam(params("updated_since=2026-03-01T99:00:00Z"), "updated_since"),
      ).code,
    ).toBe("INVALID_QUERY");
  });
});

describe("parseSearchParam", () => {
  it("null kalau kosong atau hanya spasi", () => {
    expect(parseSearchParam(params(""))).toBeNull();
    expect(parseSearchParam(params("search=%20%20"))).toBeNull();
  });

  it("memangkas spasi di ujung", () => {
    expect(parseSearchParam(params("search=%20budi%20"))).toBe("budi");
  });

  it("400 kalau terlalu panjang", () => {
    const long = "a".repeat(MAX_SEARCH_LENGTH + 1);
    expect(caught(() => parseSearchParam(params(`search=${long}`))).code).toBe(
      "INVALID_QUERY",
    );
  });
});

describe("parseLookupTipe", () => {
  it("menerima kesebelas tipe", () => {
    for (const tipe of LOOKUP_TYPES) {
      expect(parseLookupTipe(params(`tipe=${tipe}`))).toBe(tipe);
    }
  });

  it("400 UNKNOWN_LOOKUP_TYPE kalau tipe tidak dikirim", () => {
    const error = caught(() => parseLookupTipe(params("")));
    expect(error.code).toBe("UNKNOWN_LOOKUP_TYPE");
    expect(error.status).toBe(400);
    expect(error.details).toEqual({ tipe: null, allowed: [...LOOKUP_TYPES] });
  });

  it("400 UNKNOWN_LOOKUP_TYPE dan menyebut tipe yang diminta", () => {
    const error = caught(() => parseLookupTipe(params("tipe=jabatan")));
    expect(error.code).toBe("UNKNOWN_LOOKUP_TYPE");
    expect(error.details).toEqual({ tipe: "jabatan", allowed: [...LOOKUP_TYPES] });
  });
});

describe("parseOrgUnitTipe", () => {
  it("null kalau tidak dikirim", () => {
    expect(parseOrgUnitTipe(params(""))).toBeNull();
  });

  it("menerima tipe unit yang sah, termasuk proyek", () => {
    expect(parseOrgUnitTipe(params("tipe=divisi"))).toBe("divisi");
    expect(parseOrgUnitTipe(params("tipe=proyek"))).toBe("proyek");
  });

  it("400 untuk tipe di luar daftar", () => {
    expect(caught(() => parseOrgUnitTipe(params("tipe=job_grade"))).code).toBe(
      "INVALID_QUERY",
    );
  });
});
