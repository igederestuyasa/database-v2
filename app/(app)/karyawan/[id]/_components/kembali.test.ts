import { describe, expect, it } from "vitest";

import { hrefKembali } from "./kembali";

describe("hrefKembali", () => {
  it("mengembalikan filter yang dititipkan daftar", () => {
    expect(hrefKembali("/karyawan?q=apri&unit=abc&hal=2")).toBe(
      "/karyawan?q=apri&unit=abc&hal=2",
    );
    expect(hrefKembali("/karyawan")).toBe("/karyawan");
  });

  it("tanpa titipan, kembali ke daftar polos", () => {
    expect(hrefKembali(undefined)).toBe("/karyawan");
    expect(hrefKembali("")).toBe("/karyawan");
  });

  /**
   * `kembali` datang dari alamat halaman, jadi ia bisa ditulis siapa saja.
   * Tombol "kembali" yang mendarat di situs orang lain sambil terlihat berasal
   * dari HC Core adalah pengalihan terbuka — dan halaman ini yang paling
   * mungkin ditautkan ke orang lain lewat chat.
   */
  it.each([
    "https://jahat.example",
    "//jahat.example",
    "http://jahat.example/karyawan",
    "/karyawan@jahat.example",
    "javascript:alert(1)",
    "/pengguna",
    "/karyawanX?q=1",
  ])("menjatuhkan %s ke daftar polos", (jahat) => {
    expect(hrefKembali(jahat)).toBe("/karyawan");
  });

  it("mengambil nilai pertama kalau parameternya diulang", () => {
    expect(hrefKembali(["/karyawan?q=a", "https://jahat.example"])).toBe(
      "/karyawan?q=a",
    );
    expect(hrefKembali(["https://jahat.example", "/karyawan?q=a"])).toBe("/karyawan");
  });

  it("alamat detail bukan alamat daftar", () => {
    // `/karyawan/123` diawali "/karyawan" tetapi bukan daftarnya; tanpa
    // pemeriksaan "?" tepat sesudahnya, tombol kembali akan berputar di tempat.
    expect(hrefKembali("/karyawan/123")).toBe("/karyawan");
  });
});
