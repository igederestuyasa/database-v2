/**
 * The shared database-error defaults.
 *
 * Five codes were being re-mapped by hand in five files, each with its own
 * spelling of what they mean, and each free to forget one. The wording per
 * entity stays where it is — it is better than anything generic — but the
 * floor under it is here, and it is tested, so a new Server Action that maps
 * nothing still tells staf HC something true.
 *
 * `_guard.ts` itself imports `next/headers` through `lib/supabase/server.ts`
 * and is not importable from a plain node test; this module is deliberately
 * pure so that the mapping can be.
 */
import { describe, expect, it } from "vitest";

import { UI } from "@/lib/i18n/terms";

import { classifyDatabaseError, KNOWN_DATABASE_CODES } from "./pgErrors";

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
