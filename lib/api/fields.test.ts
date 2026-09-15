/**
 * `fields` — the whole access control of `/api/v1/employees`.
 *
 * The routes query with the service-role client, which bypasses RLS, so a bug
 * in this module does not produce an error anywhere: it produces a column
 * leaving the building. ARCHITECTURE.md §7 lists it as one of three modules
 * worth testing for exactly that reason, and the Fase 4 exit criteria
 * ("whitelist 4 kolom → tepat 4 kolom → kolom kelima → 403 dengan nama
 * kolomnya") are the last three `describe` blocks here.
 */
import { describe, expect, it } from "vitest";

import { API_EMPLOYEE_FIELDS } from "@/lib/schema/columns.generated";

import { ApiError, isApiError } from "./errors";
import {
  allowedEmployeeFields,
  buildSelect,
  EMPLOYEE_FIELDS,
  isEmployeeField,
  parseFieldList,
  projectRow,
  projectRows,
  resolveEmployeeFields,
} from "./fields";

/** The four columns the ROADMAP's "Perf App" key is granted. */
const PERF_APP = ["personnel_number", "full_name", "divisi_nama", "jabatan_nama"];

/** Every column of `employee_private`, none of which exists in the view. */
const SENSITIVE = [
  "date_of_birth",
  "place_of_birth",
  "religion",
  "marital_status",
  "usia",
];

function caught(run: () => unknown): ApiError {
  try {
    run();
  } catch (error) {
    if (isApiError(error)) return error;
    throw error;
  }
  throw new Error("Seharusnya melempar ApiError, tapi tidak melempar apa pun.");
}

describe("semesta kolom", () => {
  it("adalah daftar kolom v_employees_api apa adanya", () => {
    expect(EMPLOYEE_FIELDS).toBe(API_EMPLOYEE_FIELDS);
  });

  it("mengenali kolom yang ada dan menolak yang tidak", () => {
    expect(isEmployeeField("personnel_number")).toBe(true);
    expect(isEmployeeField("masa_kerja_bulan")).toBe(true);
    expect(isEmployeeField("personel_number")).toBe(false);
  });

  it("tidak memuat satu pun kolom Data Pribadi Sensitif", () => {
    for (const column of SENSITIVE) {
      expect(isEmployeeField(column)).toBe(false);
    }
  });

  it("peka huruf besar-kecil", () => {
    expect(isEmployeeField("Full_Name")).toBe(false);
    expect(isEmployeeField("FULL_NAME")).toBe(false);
  });
});

describe("parseFieldList", () => {
  it("memecah, memangkas spasi, dan mempertahankan urutan", () => {
    expect(parseFieldList(" full_name , nip,personnel_number ")).toEqual([
      "full_name",
      "nip",
      "personnel_number",
    ]);
  });

  it("mengabaikan koma kosong dan koma di ujung", () => {
    expect(parseFieldList("nip,,full_name,")).toEqual(["nip", "full_name"]);
  });

  it("membuang duplikat, menyisakan kemunculan pertama", () => {
    expect(parseFieldList("nip,full_name,nip")).toEqual(["nip", "full_name"]);
  });

  it("kosong untuk null, undefined, string kosong, dan koma saja", () => {
    expect(parseFieldList(null)).toEqual([]);
    expect(parseFieldList(undefined)).toEqual([]);
    expect(parseFieldList("")).toEqual([]);
    expect(parseFieldList("   ")).toEqual([]);
    expect(parseFieldList(",,,")).toEqual([]);
  });

  it("tidak menormalkan huruf besar-kecil", () => {
    expect(parseFieldList("Full_Name")).toEqual(["Full_Name"]);
  });
});

describe("allowedEmployeeFields", () => {
  it("mengurutkan whitelist mengikuti urutan kolom view", () => {
    expect(allowedEmployeeFields(["full_name", "id", "personnel_number"])).toEqual([
      "id",
      "personnel_number",
      "full_name",
    ]);
  });

  it("membuang nama yang bukan kolom v_employees_api", () => {
    expect(allowedEmployeeFields(["full_name", "date_of_birth", "ngawur"])).toEqual([
      "full_name",
    ]);
  });

  it("kosong untuk whitelist kosong, null, dan undefined", () => {
    expect(allowedEmployeeFields([])).toEqual([]);
    expect(allowedEmployeeFields(null)).toEqual([]);
    expect(allowedEmployeeFields(undefined)).toEqual([]);
  });

  it("membuang duplikat", () => {
    expect(allowedEmployeeFields(["nip", "nip"])).toEqual(["nip"]);
  });
});

describe("resolveEmployeeFields — fields wajib (/employees)", () => {
  it("mengembalikan kolom yang diminta, dalam urutan permintaan", () => {
    expect(
      resolveEmployeeFields({
        requested: "full_name,personnel_number",
        allowed: PERF_APP,
        required: true,
      }),
    ).toEqual(["full_name", "personnel_number"]);
  });

  it("400 FIELDS_REQUIRED kalau fields tidak dikirim", () => {
    const error = caught(() =>
      resolveEmployeeFields({ requested: null, allowed: PERF_APP, required: true }),
    );
    expect(error.code).toBe("FIELDS_REQUIRED");
    expect(error.status).toBe(400);
  });

  it("400 FIELDS_REQUIRED kalau fields hanya berisi spasi dan koma", () => {
    expect(
      caught(() =>
        resolveEmployeeFields({ requested: " , ", allowed: PERF_APP, required: true }),
      ).code,
    ).toBe("FIELDS_REQUIRED");
  });
});

describe("resolveEmployeeFields — kolom tidak dikenal", () => {
  it("400 UNKNOWN_FIELD dan menyebut semua kolomnya", () => {
    const error = caught(() =>
      resolveEmployeeFields({
        requested: "full_name,personel_number,ngawur",
        allowed: PERF_APP,
        required: true,
      }),
    );
    expect(error.code).toBe("UNKNOWN_FIELD");
    expect(error.status).toBe(400);
    expect(error.details).toEqual({ fields: ["personel_number", "ngawur"] });
  });

  it("kolom Data Pribadi Sensitif tidak dikenal, bukan sekadar tidak diizinkan", () => {
    for (const column of SENSITIVE) {
      const error = caught(() =>
        resolveEmployeeFields({
          requested: `full_name,${column}`,
          // Bahkan kalau admin salah memasukkannya ke whitelist:
          allowed: [...PERF_APP, column],
          required: true,
        }),
      );
      expect(error.code).toBe("UNKNOWN_FIELD");
      expect(error.details).toEqual({ fields: [column] });
    }
  });

  it("kolom v_employees yang tidak ikut ke v_employees_api juga ditolak", () => {
    // `gender_id` ada di v_employees, tapi v_employees_api hanya membawa
    // `gender_kode` / `gender_label`.
    const error = caught(() =>
      resolveEmployeeFields({
        requested: "gender_id",
        allowed: ["gender_id", "gender_kode"],
        required: true,
      }),
    );
    expect(error.code).toBe("UNKNOWN_FIELD");
  });

  it("kolom tidak dikenal menang atas kolom tidak diizinkan", () => {
    const error = caught(() =>
      resolveEmployeeFields({
        requested: "ngawur,person_grade_label",
        allowed: PERF_APP,
        required: true,
      }),
    );
    expect(error.code).toBe("UNKNOWN_FIELD");
    expect(error.details).toEqual({ fields: ["ngawur"] });
  });
});

describe("resolveEmployeeFields — kolom di luar whitelist", () => {
  it("403 FIELD_NOT_ALLOWED dan menyebut kolomnya", () => {
    const error = caught(() =>
      resolveEmployeeFields({
        requested: "full_name,person_grade_label",
        allowed: PERF_APP,
        required: true,
      }),
    );
    expect(error.code).toBe("FIELD_NOT_ALLOWED");
    expect(error.status).toBe(403);
    expect(error.details).toEqual({ fields: ["person_grade_label"] });
  });

  it("menolak seluruh permintaan, tidak sebagian", () => {
    const error = caught(() =>
      resolveEmployeeFields({
        requested: "full_name,person_grade_label,job_grade_label",
        allowed: PERF_APP,
        required: true,
      }),
    );
    expect(error.details).toEqual({
      fields: ["person_grade_label", "job_grade_label"],
    });
  });

  it("whitelist kosong menolak kolom apa pun", () => {
    expect(
      caught(() =>
        resolveEmployeeFields({ requested: "full_name", allowed: [], required: true }),
      ).code,
    ).toBe("FIELD_NOT_ALLOWED");
  });
});

describe("resolveEmployeeFields — fields opsional (/employees/{personnel_number})", () => {
  it("tanpa fields: seluruh whitelist, dalam urutan kolom view", () => {
    expect(
      resolveEmployeeFields({ requested: null, allowed: PERF_APP, required: false }),
    ).toEqual(["personnel_number", "full_name", "divisi_nama", "jabatan_nama"]);
  });

  it("tanpa fields: nama di whitelist yang bukan kolom view tidak ikut", () => {
    expect(
      resolveEmployeeFields({
        requested: null,
        allowed: ["full_name", "date_of_birth"],
        required: false,
      }),
    ).toEqual(["full_name"]);
  });

  it("dengan fields: aturan whitelist tetap berlaku", () => {
    expect(
      caught(() =>
        resolveEmployeeFields({
          requested: "person_grade_label",
          allowed: PERF_APP,
          required: false,
        }),
      ).code,
    ).toBe("FIELD_NOT_ALLOWED");
  });

  it("whitelist kosong: 403, bukan permintaan tanpa kolom", () => {
    const error = caught(() =>
      resolveEmployeeFields({ requested: null, allowed: [], required: false }),
    );
    expect(error.code).toBe("FIELD_NOT_ALLOWED");
    expect(error.details).toEqual({ fields: [] });
  });
});

describe("buildSelect", () => {
  it("merangkai daftar kolom PostgREST", () => {
    expect(buildSelect(["personnel_number", "full_name"])).toBe(
      "personnel_number, full_name",
    );
  });

  it("menolak daftar kosong — select('') berarti SEMUA kolom", () => {
    expect(caught(() => buildSelect([])).code).toBe("INTERNAL_ERROR");
  });
});

describe("projectRow / projectRows", () => {
  it("mengembalikan tepat kolom yang diminta, dalam urutannya", () => {
    const row = { full_name: "Budi", nip: "123", status: "aktif" };
    expect(Object.keys(projectRow(row, ["nip", "full_name"]))).toEqual([
      "nip",
      "full_name",
    ]);
  });

  it("membuang kolom yang tidak diminta, walau ikut terbawa dari database", () => {
    const row = { full_name: "Budi", person_grade_label: "PG-7" };
    expect(projectRow(row, ["full_name"])).toEqual({ full_name: "Budi" });
  });

  it("kolom yang tidak ada jadi null, bukan hilang dari JSON", () => {
    const projected = projectRow({ full_name: "Budi" }, ["full_name", "nip"]);
    expect(projected).toEqual({ full_name: "Budi", nip: null });
    expect(JSON.parse(JSON.stringify(projected))).toHaveProperty("nip", null);
  });

  it("mempertahankan nilai falsy apa adanya", () => {
    expect(
      projectRow({ masa_kerja_bulan: 0, keterangan: "", jurusan: null }, [
        "masa_kerja_bulan",
        "keterangan",
        "jurusan",
      ]),
    ).toEqual({ masa_kerja_bulan: 0, keterangan: "", jurusan: null });
  });

  it("memproyeksikan setiap baris satu halaman", () => {
    expect(
      projectRows(
        [
          { full_name: "Budi", nip: "1" },
          { full_name: "Ani", nip: "2" },
        ],
        ["full_name"],
      ),
    ).toEqual([{ full_name: "Budi" }, { full_name: "Ani" }]);
  });
});
