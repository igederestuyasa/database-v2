import { describe, expect, it } from "vitest";

import { DERIVED_EXPECTATIONS } from "@/fixtures/derived";
import { ASOF, EMPLOYEES, EMPLOYEE_PRIVATE } from "@/fixtures/employees";

import {
  computeMasaKerja,
  computeUsia,
  deriveEmployeeColumns,
  formatMasa,
  formatMasaColumns,
  formatUsia,
  KOSONG,
} from "./employee";

describe("deriveEmployeeColumns", () => {
  it.each(DERIVED_EXPECTATIONS)(
    "cocok dengan nilai yang dihitung tangan: $keterangan",
    (expected) => {
      const employee = EMPLOYEES.find((row) => row.id === expected.employeeId);
      if (!employee) throw new Error("fixture Karyawan tidak ditemukan");
      const priv = EMPLOYEE_PRIVATE.find((row) => row.employee_id === expected.employeeId);

      const derived = deriveEmployeeColumns(
        { ...employee, date_of_birth: priv?.date_of_birth ?? null },
        ASOF,
      );

      expect(derived).toEqual({
        masa_kerja_tahun: expected.masa_kerja_tahun,
        masa_kerja_bulan: expected.masa_kerja_bulan,
        masa_sejak_diangkat_tahun: expected.masa_sejak_diangkat_tahun,
        masa_sejak_diangkat_bulan: expected.masa_sejak_diangkat_bulan,
        masa_pg_tahun: expected.masa_pg_tahun,
        masa_jg_tahun: expected.masa_jg_tahun,
        usia: expected.usia,
      });
    },
  );

  it("mengembalikan null untuk setiap tanggal yang kosong", () => {
    expect(deriveEmployeeColumns({}, ASOF)).toEqual({
      masa_kerja_tahun: null,
      masa_kerja_bulan: null,
      masa_sejak_diangkat_tahun: null,
      masa_sejak_diangkat_bulan: null,
      masa_pg_tahun: null,
      masa_jg_tahun: null,
      usia: null,
    });
  });

  it("usia hanya terisi kalau date_of_birth diberikan (admin saja)", () => {
    const employee = EMPLOYEES[0];
    expect(deriveEmployeeColumns(employee, ASOF).usia).toBeNull();
    expect(
      deriveEmployeeColumns({ ...employee, date_of_birth: "1980-02-29" }, ASOF).usia,
    ).toBe(46);
  });
});

describe("computeMasaKerja", () => {
  it("bulan adalah sisa setelah tahun penuh, bukan total bulan", () => {
    const masa = computeMasaKerja("2023-05-14", ASOF);
    expect(masa).toEqual({ tahun: 3, bulan: 4 });
    // 3 tahun 4 bulan = 40 bulan total; kolomnya BUKAN 40 (ADR-005).
    expect(masa?.bulan).toBe(4);
  });

  it("tidak pernah melompat sehari lebih awal di bulan pendek", () => {
    // 31 Agustus → 31 Agustus berikutnya tepat 1 tahun, 0 bulan, 0 hari.
    expect(computeMasaKerja("2025-08-31", "2026-08-31")).toEqual({ tahun: 1, bulan: 0 });
    // Sehari sebelumnya belum genap.
    expect(computeMasaKerja("2025-08-31", "2026-08-30")).toEqual({ tahun: 0, bulan: 11 });
  });
});

describe("computeUsia", () => {
  it("menghitung usia dalam tahun penuh", () => {
    expect(computeUsia("1990-09-15", "2026-09-14")).toBe(35);
    expect(computeUsia("1990-09-14", "2026-09-14")).toBe(36);
  });

  it("null untuk viewer yang tidak pernah menerima tanggal lahir", () => {
    expect(computeUsia(null, ASOF)).toBeNull();
  });
});

describe("format", () => {
  it("menulis masa kerja dalam bahasa Indonesia", () => {
    expect(formatMasa({ tahun: 3, bulan: 4 })).toBe("3 tahun 4 bulan");
    expect(formatMasa({ tahun: 3, bulan: 0 })).toBe("3 tahun");
    expect(formatMasa({ tahun: 0, bulan: 7 })).toBe("7 bulan");
    expect(formatMasa({ tahun: 0, bulan: 0 })).toBe("kurang dari 1 bulan");
  });

  it("menandai tanggal mulai di masa depan, bukan menampilkan angka negatif", () => {
    expect(formatMasa({ tahun: 0, bulan: -3 })).toBe("belum mulai");
  });

  it("menampilkan em dash untuk nilai kosong", () => {
    expect(formatMasa(null)).toBe(KOSONG);
    expect(formatUsia(null)).toBe(KOSONG);
    expect(formatMasaColumns(null, null)).toBe(KOSONG);
  });

  it("memformat langsung dari dua kolom view", () => {
    expect(formatMasaColumns(3, 4)).toBe("3 tahun 4 bulan");
    expect(formatMasaColumns(11, 0)).toBe("11 tahun");
    expect(formatUsia(46)).toBe("46 tahun");
  });
});
