import { describe, expect, it } from "vitest";

import { PG_AGE_CASES } from "@/fixtures/derived";

import { daysInMonth, pgAge, parseCalendarDate, today, yearsSince } from "./pgAge";

function date(iso: string) {
  const parsed = parseCalendarDate(iso);
  if (!parsed) throw new Error(`fixture tanggal tidak valid: ${iso}`);
  return parsed;
}

describe("pgAge", () => {
  it.each(PG_AGE_CASES)(
    "age(%s, %s) = %i tahun %i bulan %i hari, sama seperti PostgreSQL",
    (later, earlier, years, months, days) => {
      expect(pgAge(date(later), date(earlier))).toEqual({ years, months, days });
    },
  );

  it("meminjam hari dari bulan tanggal yang lebih awal, bukan dari bulan tujuan", () => {
    // Januari punya 31 hari, Februari 29 (2024 kabisat). Postgres meminjam 31.
    expect(pgAge(date("2024-03-01"), date("2024-01-31"))).toEqual({
      years: 0,
      months: 1,
      days: 1,
    });
  });

  it("menghitung 29 Februari sebagai ulang tahun penuh di tahun kabisat", () => {
    expect(pgAge(date("2024-02-29"), date("2000-02-29")).years).toBe(24);
    // Di tahun biasa, ulang tahun 29 Februari belum lewat pada 28 Februari.
    expect(pgAge(date("2023-02-28"), date("2000-02-29")).years).toBe(22);
    expect(pgAge(date("2023-03-01"), date("2000-02-29")).years).toBe(23);
  });

  it("mengembalikan nilai negatif untuk tanggal di masa depan, tanpa -0", () => {
    const interval = pgAge(date("2026-09-14"), date("2027-01-01"));
    expect(interval).toEqual({ years: 0, months: -3, days: -17 });
    // -0 lolos `===` tapi gagal `Object.is`; pastikan yang keluar 0 biasa.
    expect(Object.is(interval.years, -0)).toBe(false);
  });

  it("bulan selalu sisa 0-11, bukan total bulan (ADR-005)", () => {
    const interval = pgAge(date("2026-09-14"), date("2023-05-14"));
    expect(interval.years).toBe(3);
    expect(interval.months).toBe(4);
    expect(interval.months).toBeLessThan(12);
  });
});

describe("parseCalendarDate", () => {
  it("menerima YYYY-MM-DD dan mengabaikan bagian waktu", () => {
    expect(parseCalendarDate("2026-09-14")).toEqual({ year: 2026, month: 9, day: 14 });
    expect(parseCalendarDate("2026-09-14T10:00:00Z")).toEqual({
      year: 2026,
      month: 9,
      day: 14,
    });
  });

  it("membaca Date memakai komponen lokal", () => {
    expect(parseCalendarDate(new Date(2026, 8, 14))).toEqual({
      year: 2026,
      month: 9,
      day: 14,
    });
  });

  it("mengembalikan null untuk kosong atau tanggal mustahil", () => {
    expect(parseCalendarDate(null)).toBeNull();
    expect(parseCalendarDate(undefined)).toBeNull();
    expect(parseCalendarDate("")).toBeNull();
    expect(parseCalendarDate("bukan tanggal")).toBeNull();
    expect(parseCalendarDate("2025-02-30")).toBeNull();
    expect(parseCalendarDate("2025-13-01")).toBeNull();
    expect(parseCalendarDate(new Date("nope"))).toBeNull();
  });
});

describe("daysInMonth", () => {
  it("tahu aturan kabisat lengkap", () => {
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2023, 2)).toBe(28);
    expect(daysInMonth(2000, 2)).toBe(29); // habis dibagi 400
    expect(daysInMonth(1900, 2)).toBe(28); // habis dibagi 100, bukan 400
    expect(daysInMonth(2026, 4)).toBe(30);
  });
});

describe("yearsSince", () => {
  it("null kalau tanggalnya kosong, seperti extract dari interval NULL", () => {
    expect(yearsSince(null)).toBeNull();
    expect(yearsSince("")).toBeNull();
  });

  it("memakai asOf yang diberikan, bukan hari ini", () => {
    expect(yearsSince("2000-01-01", "2026-09-14")).toBe(26);
  });

  it("default asOf adalah hari ini", () => {
    const now = today();
    expect(yearsSince(`${now.year - 5}-01-01`, undefined)).toBeGreaterThanOrEqual(4);
  });
});
