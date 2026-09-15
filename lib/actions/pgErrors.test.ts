/**
 * The shared database-error mapping.
 *
 * `classifyDatabaseError` is the floor `toActionFailure()` falls back to;
 * `mapDbError` is what every action file calls with its own wording. Both are
 * pure, so both are tested here without a request or a database.
 */
import type { PostgrestError } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DbError, IncompleteReadError } from "@/lib/db/shared";
import { UI } from "@/lib/i18n/terms";

import { ActionError, UnauthenticatedError } from "./errors";
import {
  classifyDatabaseError,
  KNOWN_DATABASE_CODES,
  mapDbError,
  type DbErrorContext,
} from "./pgErrors";

describe("classifyDatabaseError", () => {
  it("mengenali lima kode yang benar-benar muncul", () => {
    expect([...KNOWN_DATABASE_CODES].sort()).toEqual(
      ["23503", "23505", "23514", "42501", "PGRST116"].sort(),
    );
  });

  it("unique_violation adalah KONFLIK, bukan kegagalan misterius", () => {
    const hasil = classifyDatabaseError("23505");
    expect(hasil?.code).toBe("KONFLIK");
    expect(hasil?.message).not.toMatch(/duplicate key|constraint/i);
  });

  it("foreign_key_violation menyuruh muat ulang, bukan mencoba lagi", () => {
    const hasil = classifyDatabaseError("23503");
    expect(hasil?.code).toBe("KONFLIK");
    expect(hasil?.message).toContain("Muat ulang");
  });

  it("check_violation ditandai KONFLIK", () => {
    expect(classifyDatabaseError("23514")?.code).toBe("KONFLIK");
  });

  it("insufficient_privilege memakai kalimat hanya-admin yang sama", () => {
    const hasil = classifyDatabaseError("42501");
    expect(hasil?.code).toBe("BUKAN_ADMIN");
    expect(hasil?.message).toBe(UI.hanyaAdmin);
  });

  it("PGRST116 dibaca sebagai penolakan RLS, bukan data yang hilang", () => {
    // `using (is_admin())` MEMFILTER: UPDATE oleh viewer cocok nol baris, dan
    // `.single()` menjawab PGRST116. Menyebutnya "tidak ditemukan" akan
    // memberi tahu viewer bahwa datanya hilang.
    const hasil = classifyDatabaseError("PGRST116");
    expect(hasil?.code).toBe("BUKAN_ADMIN");
    expect(hasil?.message).toContain(UI.hanyaAdmin);
    expect(hasil?.message).toMatch(/diubah orang lain/);
  });

  it("kode yang tidak dikenal mengembalikan null, bukan tebakan", () => {
    expect(classifyDatabaseError("P0001")).toBeNull();
    expect(classifyDatabaseError("")).toBeNull();
    expect(classifyDatabaseError(undefined)).toBeNull();
    expect(classifyDatabaseError(null)).toBeNull();
  });

  it("tidak satu pun pesannya kosong atau berbahasa Inggris teknis", () => {
    for (const code of KNOWN_DATABASE_CODES) {
      const hasil = classifyDatabaseError(code);
      expect(hasil).not.toBeNull();
      expect(hasil?.message.length).toBeGreaterThan(20);
      expect(hasil?.message).not.toMatch(/violates|null value|permission denied/i);
    }
  });
});

/** A `DbError` the way `lib/db/**` and the actions build one. */
function dbError(
  code: string,
  message: string,
  details?: string,
  context = "Gagal menyimpan",
): DbError {
  const cause = {
    name: "PostgrestError",
    message,
    details: details ?? "",
    hint: "",
    code,
  } as unknown as PostgrestError;
  return new DbError(context, cause);
}

function asActionError(value: unknown): ActionError {
  expect(value).toBeInstanceOf(ActionError);
  return value as ActionError;
}

const KARYAWAN: DbErrorContext = {
  entitas: "Karyawan",
  aksi: "mengubah data Karyawan",
  unik: [
    {
      cocok: "personnel_number",
      field: "personnel_number",
      message: "Personnel Number itu baru saja dipakai Karyawan lain.",
      fieldMessage: "Personnel Number ini sudah dipakai.",
    },
    { cocok: "nip", field: "nip", message: "NIP itu baru saja dipakai Karyawan lain." },
  ],
  unikDefault: { message: "Nilai yang harus unik itu sudah dipakai baris lain." },
  rujukan: { message: "Pilihan yang dirujuk sudah tidak ada.", field: "org_unit_id" },
  aturan: (pesan) => `Ditolak aturan: ${pesan}`,
};

describe("mapDbError", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("meneruskan ActionError dan error guard apa adanya", () => {
    const sendiri = new ActionError("KONFLIK", "sudah ada");
    expect(mapDbError(sendiri, KARYAWAN)).toBe(sendiri);
    const tamu = new UnauthenticatedError();
    expect(mapDbError(tamu, KARYAWAN)).toBe(tamu);
  });

  it("error yang bukan database diteruskan tanpa fallback, dan menjadi GAGAL dengan fallback", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const asing = new TypeError("undefined is not a function");
    expect(mapDbError(asing, KARYAWAN)).toBe(asing);
    const hasil = asActionError(
      mapDbError(asing, { ...KARYAWAN, fallback: "Gagal mengembalikan Revisi. Coba lagi." }),
    );
    expect(hasil.code).toBe("GAGAL");
    expect(hasil.message).toBe("Gagal mengembalikan Revisi. Coba lagi.");
  });

  it("IncompleteReadError menjadi GAGAL dengan akhiran yang diminta", () => {
    const terpotong = new IncompleteReadError("Unit Organisasi", 1000, 1200);
    const hasil = asActionError(
      mapDbError(terpotong, { ...KARYAWAN, bacaTerpotong: "Naikkan batasnya dulu." }),
    );
    expect(hasil.code).toBe("GAGAL");
    expect(hasil.message).toContain("1000 dari 1200");
    expect(hasil.message).toMatch(/Naikkan batasnya dulu\.$/);
    expect(asActionError(mapDbError(terpotong, KARYAWAN)).message).toMatch(
      /Hubungi admin HC Core\.$/,
    );
  });

  it("23505 memilih kalimat per kolom UNIQUE dari nama constraint, urut prioritas", () => {
    const pn = asActionError(
      mapDbError(
        dbError(
          "23505",
          'duplicate key value violates unique constraint "employees_personnel_number_key"',
          "Key (personnel_number)=(HK001) already exists.",
        ),
        KARYAWAN,
      ),
    );
    expect(pn.code).toBe("KONFLIK");
    expect(pn.message).toContain("Personnel Number");
    expect(pn.fieldErrors).toEqual({ personnel_number: "Personnel Number ini sudah dipakai." });

    const nip = asActionError(
      mapDbError(
        dbError("23505", 'duplicate key value violates unique constraint "employees_nip_key"'),
        KARYAWAN,
      ),
    );
    expect(nip.message).toContain("NIP");
    // fieldMessage tidak diberi → memakai message.
    expect(nip.fieldErrors).toEqual({ nip: "NIP itu baru saja dipakai Karyawan lain." });
  });

  it("23505 tanpa aturan yang cocok memakai unikDefault, dan tanpa itu memakai lantai", () => {
    const umum = asActionError(
      mapDbError(dbError("23505", 'violates unique constraint "x_y_key"'), KARYAWAN),
    );
    expect(umum.message).toBe("Nilai yang harus unik itu sudah dipakai baris lain.");
    expect(umum.fieldErrors).toBeUndefined();

    const lantai = asActionError(
      mapDbError(dbError("23505", "violates"), { entitas: "Jabatan" }),
    );
    expect(lantai.message).toBe(classifyDatabaseError("23505")?.message);
  });

  it("23503 dan 23514 memakai kalimat entitas, dengan pesan mentah untuk aturan", () => {
    const fk = asActionError(mapDbError(dbError("23503", "violates foreign key"), KARYAWAN));
    expect(fk.code).toBe("KONFLIK");
    expect(fk.fieldErrors).toEqual({ org_unit_id: "Pilihan yang dirujuk sudah tidak ada." });

    const check = asActionError(
      mapDbError(dbError("23514", "Induk baru membuat siklus."), KARYAWAN),
    );
    expect(check.message).toBe("Ditolak aturan: Induk baru membuat siklus.");
    // Pesan mentah dari PostgREST, bukan yang sudah diberi awalan DbError.
    expect(check.message).not.toContain("Gagal menyimpan");
  });

  it("42501 dan PGRST116 keduanya BUKAN_ADMIN dan menyebut aksinya", () => {
    const insert = asActionError(mapDbError(dbError("42501", "permission denied"), KARYAWAN));
    expect(insert.code).toBe("BUKAN_ADMIN");
    expect(insert.message).toContain("mengubah data Karyawan");
    expect(insert.message).not.toMatch(/permission denied/);

    const update = asActionError(mapDbError(dbError("PGRST116", "no rows"), KARYAWAN));
    expect(update.code).toBe("BUKAN_ADMIN");
    expect(update.message).toContain("mengubah data Karyawan");
    expect(update.message).toMatch(/muat ulang/i);

    // Tanpa `aksi`, kalimatnya dibentuk dari nama entitas.
    const tanpaAksi = asActionError(
      mapDbError(dbError("42501", "x"), { entitas: "Lookup" }),
    );
    expect(tanpaAksi.message).toContain("mengubah Lookup");
  });

  it("kode SQL sendiri diteruskan verbatim, kecuali kalau pesannya ternyata milik Postgres", () => {
    const ctx: DbErrorContext = {
      entitas: "Data Referensi",
      sendiri: { "42501": "BUKAN_ADMIN", "55000": "KONFLIK", "22023": "VALIDASI" },
      ulang: { "55000": "Batch ini sudah pernah dikembalikan." },
    };

    const sendiri = asActionError(
      mapDbError(
        dbError("42501", "Hanya admin yang boleh menggabungkan Unit Organisasi.", "", "Gagal menggabungkan data"),
        ctx,
      ),
    );
    expect(sendiri.code).toBe("BUKAN_ADMIN");
    expect(sendiri.message).toBe("Hanya admin yang boleh menggabungkan Unit Organisasi.");

    const postgres = asActionError(
      mapDbError(
        dbError("42501", 'new row violates row-level security policy for table "org_units"'),
        ctx,
      ),
    );
    expect(postgres.code).toBe("BUKAN_ADMIN");
    expect(postgres.message).toBe(UI.hanyaAdmin);
    expect(postgres.message).not.toContain("org_units");

    const diulang = asActionError(
      mapDbError(dbError("55000", "Batch ini sudah pernah dikembalikan (oleh Batch 3f2a…)."), ctx),
    );
    expect(diulang.message).toBe("Batch ini sudah pernah dikembalikan.");

    const validasi = asActionError(
      mapDbError(dbError("22023", "Asal dan tujuan Merge tidak boleh sama."), ctx),
    );
    expect(validasi.code).toBe("VALIDASI");
  });

  it("kode yang tidak dikenal dicatat ke log dan menjadi GAGAL dengan fallback entitas", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const hasil = asActionError(
      mapDbError(dbError("PGRST103", "Requested range not satisfiable"), {
        entitas: "Lookup",
        fallback: "Gagal menyimpan Lookup. Coba lagi.",
      }),
    );
    expect(hasil.code).toBe("GAGAL");
    expect(hasil.message).toBe("Gagal menyimpan Lookup. Coba lagi.");
    expect(log).toHaveBeenCalledTimes(1);

    const umum = asActionError(mapDbError(dbError("PGRST103", "x"), { entitas: "Lookup" }));
    expect(umum.message).toBe("Gagal menyimpan perubahan. Coba lagi.");
  });

  it("tidak satu pun kalimat bawaannya membocorkan bahasa Postgres", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    // Konteks polos: yang diuji kalimat bawaan `mapDbError`, bukan `aturan`
    // milik pemanggil (yang memang menerima pesan mentah untuk dibaca sendiri).
    const polos: DbErrorContext = { entitas: "Karyawan" };
    const pesanInggris = 'duplicate key value violates unique constraint "employees_nip_key"';
    for (const code of [...KNOWN_DATABASE_CODES, "P0001"]) {
      const hasil = asActionError(mapDbError(dbError(code, pesanInggris), polos));
      expect(hasil.message).not.toMatch(/violates|constraint|permission denied/i);
    }
  });
});
