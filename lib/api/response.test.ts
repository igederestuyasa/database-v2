/**
 * The v1 envelopes, checked against API-CONTRACT.md.
 *
 * "Versi: perubahan yang memecah bentuk response → /api/v2; v1 tidak diubah
 * bentuknya setelah ada konsumen." These tests are what makes that promise
 * enforceable rather than aspirational.
 */
import { describe, expect, it, vi } from "vitest";

import { API_ERROR_STATUS, ApiError, apiError, toApiError } from "./errors";
import { buildMeta, jsonCollection, jsonError, jsonItem, jsonList } from "./response";

describe("envelope sukses", () => {
  it("satu baris: { data }", async () => {
    const response = jsonItem({ personnel_number: "TEST-0001" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { personnel_number: "TEST-0001" } });
  });

  it("daftar: { data, meta } dengan per_page snake_case", async () => {
    const response = jsonList([{ id: "1" }], buildMeta({ page: 2, perPage: 100, total: 1475 }));
    expect(await response.json()).toEqual({
      data: [{ id: "1" }],
      meta: { page: 2, per_page: 100, total: 1475 },
    });
  });

  it("daftar referensi tanpa pagination: { data } saja", async () => {
    const body = (await jsonCollection([{ id: "1" }]).json()) as Record<string, unknown>;
    expect(body).toEqual({ data: [{ id: "1" }] });
    expect("meta" in body).toBe(false);
  });

  it("tidak pernah boleh di-cache", () => {
    expect(jsonItem({}).headers.get("Cache-Control")).toBe("no-store");
    expect(jsonList([], buildMeta({ page: 1, perPage: 100, total: 0 })).headers.get(
      "Cache-Control",
    )).toBe("no-store");
  });
});

describe("envelope error", () => {
  it("selalu { error: { code, message } }", async () => {
    const response = jsonError(apiError.fieldsRequired());
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: {
        code: "FIELDS_REQUIRED",
        message: "Parameter 'fields' wajib diisi.",
      },
    });
  });

  it("menyertakan details.fields persis seperti contoh di API-CONTRACT", async () => {
    const response = jsonError(apiError.fieldNotAllowed(["person_grade_label"]));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: {
        code: "FIELD_NOT_ALLOWED",
        message: "Kolom tidak diizinkan untuk key ini.",
        details: { fields: ["person_grade_label"] },
      },
    });
  });

  it("kolom tidak dikenal adalah 400, kolom di luar whitelist adalah 403", () => {
    expect(apiError.unknownField(["tidak_ada"]).status).toBe(400);
    expect(apiError.fieldNotAllowed(["gender_label"]).status).toBe(403);
  });

  it("401 membawa WWW-Authenticate dan tidak membedakan key salah dari key nonaktif", async () => {
    const response = jsonError(apiError.unauthorized());
    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toBe("Bearer");
    const body = (await response.json()) as { error: { message: string } };
    expect(body.error.message).not.toMatch(/nonaktif|tidak dikenal/i);
  });

  it("405 membawa header Allow", async () => {
    const response = jsonError(apiError.methodNotAllowed());
    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("GET");
    expect(await response.json()).toEqual({
      error: {
        code: "METHOD_NOT_ALLOWED",
        message: "Method tidak didukung; /api/v1 hanya menerima GET.",
        details: { allow: ["GET"] },
      },
    });
  });

  it("UNKNOWN_LOOKUP_TYPE menyebut tipe yang diminta", async () => {
    const body = (await jsonError(apiError.unknownLookupType("jabatan")).json()) as {
      error: { code: string; details: { tipe: string } };
    };
    expect(body.error.code).toBe("UNKNOWN_LOOKUP_TYPE");
    expect(body.error.details.tipe).toBe("jabatan");
  });

  it("error tak terduga menjadi 500 generik, tanpa membocorkan pesan aslinya", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = jsonError(
      new Error('duplicate key value violates unique constraint "employees_nip_key"'),
    );
    expect(response.status).toBe(500);
    const body = (await response.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(body.error.message).toBe("Terjadi kesalahan di server.");
    expect(body.error.message).not.toMatch(/constraint/);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("toApiError membiarkan ApiError apa adanya", () => {
    const original = apiError.notFound("Karyawan tidak ditemukan.");
    expect(toApiError(original)).toBe(original);
  });
});

describe("pemetaan status", () => {
  it("cocok dengan tabel status code di API-CONTRACT.md", () => {
    expect(API_ERROR_STATUS).toEqual({
      FIELDS_REQUIRED: 400,
      UNKNOWN_FIELD: 400,
      UNKNOWN_LOOKUP_TYPE: 400,
      INVALID_QUERY: 400,
      UNAUTHORIZED: 401,
      FIELD_NOT_ALLOWED: 403,
      NOT_FOUND: 404,
      METHOD_NOT_ALLOWED: 405,
      INTERNAL_ERROR: 500,
    });
  });

  it("ApiError mengambil status dari kodenya", () => {
    expect(new ApiError("NOT_FOUND").status).toBe(404);
    expect(new ApiError("NOT_FOUND").message).toBe("Data tidak ditemukan.");
  });
});
