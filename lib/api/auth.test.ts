/**
 * API Key authentication — the only gate on `/api/v1`.
 *
 * `middleware.ts` excludes these routes, and the handlers query with the
 * service-role client, so there is no session check and no RLS behind this
 * module. "401 tanpa key / key tidak dikenal / key nonaktif" is a Fase 4 exit
 * criterion and it is proved here, without a database, by handing the
 * functions a stub client.
 */
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import type { DbClient } from "@/lib/db/shared";
import { API_KEY_PATTERN, API_KEY_PREFIX } from "@/lib/validation/apiKey";

import {
  API_KEY_HASH_ALGORITHM,
  API_KEY_HASH_LENGTH,
  authenticateApiKey,
  extractBearerToken,
  hashApiKey,
  LAST_USED_THROTTLE_MS,
  requireBearerToken,
  shouldTouchLastUsed,
  touchApiKeyUsage,
} from "./auth";
import { isApiError, type ApiError } from "./errors";

/** A well-formed key: `hck_` + 40 characters (API-CONTRACT.md §Auth). */
const KEY = `hck_${"a1B2c3D4e5".repeat(4)}`;

type KeyRow = {
  id: string;
  nama_konsumen: string;
  key_prefix: string | null;
  key_hash: string;
  allowed_fields: string[];
  status: string;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
};

function keyRow(overrides: Partial<KeyRow> = {}): KeyRow {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    nama_konsumen: "Konsumen Uji",
    key_prefix: KEY.slice(0, 8),
    key_hash: hashApiKey(KEY),
    allowed_fields: ["personnel_number", "full_name"],
    status: "aktif",
    last_used_at: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

/**
 * The smallest `api_keys` stand-in that `lib/db/apiKeys.ts` can run against:
 * `select().eq().eq().maybeSingle()` for the lookup, `update().eq()` for
 * `last_used_at`.
 */
function stubClient(
  rows: KeyRow[],
  options: { failUpdate?: boolean; throwOnUpdate?: boolean } = {},
) {
  const updates: { values: Record<string, unknown>; id: unknown }[] = [];

  const builder = () => {
    const filters: [string, unknown][] = [];
    let columns: string[] = [];
    const chain = {
      select: (list: string) => {
        columns = list.split(",").map((name) => name.trim());
        return chain;
      },
      eq: (column: string, value: unknown) => {
        filters.push([column, value]);
        return chain;
      },
      maybeSingle: async () => {
        const match = rows.find((row) =>
          filters.every(([column, value]) => (row as Record<string, unknown>)[column] === value),
        );
        if (!match) return { data: null, error: null };
        // PostgREST returns exactly the columns that were selected, which is
        // the point of the "never key_hash" assertion below.
        const projected = Object.fromEntries(
          columns.map((name) => [name, (match as Record<string, unknown>)[name]]),
        );
        return { data: projected, error: null };
      },
    };
    return chain;
  };

  const client = {
    from: () => ({
      ...builder(),
      update: (values: Record<string, unknown>) => ({
        eq: async (_column: string, id: unknown) => {
          if (options.throwOnUpdate) throw new Error("jaringan putus");
          updates.push({ values, id });
          return options.failUpdate
            ? { error: { message: "izin ditolak" }, data: null }
            : { error: null, data: null };
        },
      }),
    }),
  };

  return { client: client as unknown as DbClient, updates };
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

async function caughtAsync(run: () => Promise<unknown>): Promise<ApiError> {
  try {
    await run();
  } catch (error) {
    if (isApiError(error)) return error;
    throw error;
  }
  throw new Error("Seharusnya melempar ApiError.");
}

function withAuth(header: string | null): Request {
  return new Request("https://hc.example/api/v1/employees", {
    headers: header === null ? {} : { authorization: header },
  });
}

describe("hashApiKey", () => {
  it("SHA-256 heksadesimal huruf kecil dari key utuh", () => {
    // Vektor uji standar, supaya algoritma & encoding-nya tidak bisa berubah
    // diam-diam: halaman API Keys menyimpan hash dengan rumus yang sama.
    expect(hashApiKey("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("64 karakter heksadesimal untuk key sungguhan", () => {
    expect(hashApiKey(KEY)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashApiKey(KEY)).toHaveLength(API_KEY_HASH_LENGTH);
    expect(API_KEY_HASH_ALGORITHM).toBe("sha256");
  });

  it("sama dengan sha256 hex node untuk key yang sama, beda untuk key lain", () => {
    expect(hashApiKey(KEY)).toBe(createHash("sha256").update(KEY).digest("hex"));
    expect(hashApiKey(KEY)).not.toBe(hashApiKey(`${KEY}x`));
  });

  it("menolak key kosong daripada menghasilkan sha256('')", () => {
    expect(() => hashApiKey("")).toThrow();
  });
});

/**
 * PERJANJIAN DENGAN HALAMAN API KEYS (PRD #19).
 *
 * Key dibuat di `lib/apiKeys/keygen.ts` dan diverifikasi di sini. Kalau kedua
 * sisi menghitung hash yang berbeda — beda algoritma, beda encoding, atau
 * salah satunya sempat mem-`trim()` atau meng-`toLowerCase()` key-nya — setiap
 * key yang baru dibuat langsung ditolak 401, dan gejalanya persis sama dengan
 * "key salah ketik": Konsumen menyalin ulang, admin membuat ulang, tidak ada
 * yang curiga rumusnya yang beda.
 *
 * Karena itu digest satu key tetap dipaku angkanya di bawah. Nilai itu adalah
 * yang dihasilkan `hashApiKey()` di `lib/apiKeys/keygen.ts` untuk key yang
 * sama, jadi test ini gagal begitu salah satu sisi berubah — sekarang, dan
 * juga nanti setelah file ini meng-import fungsi itu langsung.
 */
describe("hash bolak-balik dengan pembuat key", () => {
  /** `hck_` + 40 karakter [A-Za-z0-9], bentuk yang keluar dari generator. */
  const ISSUED = "hck_Kx7QmZ2rT9vB4nL6sW1yH8cJ0dF5gP3eR7uAbCdE";
  const ISSUED_HASH =
    "d284833228a52c52a998af08fb7f4bbe0aed77347e513792a2bcea8cc7215105";

  it("key yang diterbitkan generator lolos pemeriksaan bentuk", () => {
    expect(API_KEY_PATTERN.test(ISSUED)).toBe(true);
    expect(ISSUED.startsWith(API_KEY_PREFIX)).toBe(true);
    expect(ISSUED).toHaveLength(API_KEY_PREFIX.length + 40);
  });

  it("digest-nya persis nilai yang disimpan ke api_keys.key_hash", () => {
    expect(hashApiKey(ISSUED)).toBe(ISSUED_HASH);
  });

  it("jalur otentikasi menghasilkan digest yang sama dari header HTTP", () => {
    // Persis yang dilakukan route: ambil dari header, periksa bentuk, hash.
    const token = requireBearerToken(withAuth(`Bearer  ${ISSUED}  `));
    expect(token).toBe(ISSUED);
    expect(hashApiKey(token)).toBe(ISSUED_HASH);
  });

  it("hash dihitung atas key apa adanya — termasuk awalan hck_", () => {
    expect(hashApiKey(ISSUED)).not.toBe(hashApiKey(ISSUED.slice(4)));
    expect(hashApiKey(ISSUED)).not.toBe(hashApiKey(ISSUED.toLowerCase()));
    expect(hashApiKey(ISSUED)).not.toBe(hashApiKey(`${ISSUED} `));
  });

  it("key yang diterbitkan itu benar-benar bisa dipakai memanggil API", async () => {
    const { client } = stubClient([
      keyRow({ key_hash: ISSUED_HASH, key_prefix: ISSUED.slice(0, 8) }),
    ]);
    const key = await authenticateApiKey(client, ISSUED);
    expect(key.nama_konsumen).toBe("Konsumen Uji");
  });
});

describe("extractBearerToken", () => {
  it("mengambil token setelah skema Bearer", () => {
    expect(extractBearerToken(withAuth(`Bearer ${KEY}`))).toBe(KEY);
  });

  it("skema tidak peka huruf besar-kecil (RFC 7235)", () => {
    expect(extractBearerToken(withAuth(`bearer ${KEY}`))).toBe(KEY);
    expect(extractBearerToken(withAuth(`BEARER ${KEY}`))).toBe(KEY);
  });

  it("memangkas spasi berlebih di sekitar token", () => {
    expect(extractBearerToken(withAuth(`  Bearer    ${KEY}   `))).toBe(KEY);
  });

  it("null kalau header tidak ada, kosong, atau bukan Bearer", () => {
    expect(extractBearerToken(withAuth(null))).toBeNull();
    expect(extractBearerToken(withAuth("Bearer"))).toBeNull();
    expect(extractBearerToken(withAuth("Bearer    "))).toBeNull();
    expect(extractBearerToken(withAuth(`Basic ${KEY}`))).toBeNull();
    expect(extractBearerToken(withAuth(KEY))).toBeNull();
  });

  it("menerima Headers langsung, bukan hanya Request", () => {
    expect(extractBearerToken(new Headers({ authorization: `Bearer ${KEY}` }))).toBe(
      KEY,
    );
  });
});

describe("requireBearerToken", () => {
  it("mengembalikan token yang formatnya benar", () => {
    expect(requireBearerToken(withAuth(`Bearer ${KEY}`))).toBe(KEY);
  });

  it("401 tanpa header Authorization", () => {
    const error = caught(() => requireBearerToken(withAuth(null)));
    expect(error.code).toBe("UNAUTHORIZED");
    expect(error.status).toBe(401);
    expect(error.headers).toEqual({ "WWW-Authenticate": "Bearer" });
  });

  it("401 untuk key yang bentuknya bukan hck_ + 40 karakter", () => {
    for (const bad of ["Bearer abc", `Bearer hck_${"a".repeat(39)}`, `Bearer ${KEY}!`]) {
      expect(caught(() => requireBearerToken(withAuth(bad))).code).toBe("UNAUTHORIZED");
    }
  });

  it("tidak membocorkan kenapa key ditolak", () => {
    expect(caught(() => requireBearerToken(withAuth(null))).message).toBe(
      caught(() => requireBearerToken(withAuth("Bearer abc"))).message,
    );
  });
});

describe("authenticateApiKey", () => {
  it("mengembalikan Konsumen untuk key aktif yang dikenal", async () => {
    const { client } = stubClient([keyRow()]);
    const key = await authenticateApiKey(client, KEY);
    expect(key.nama_konsumen).toBe("Konsumen Uji");
    expect(key.allowed_fields).toEqual(["personnel_number", "full_name"]);
  });

  it("tidak pernah membawa key_hash keluar", async () => {
    const { client } = stubClient([keyRow()]);
    const key = await authenticateApiKey(client, KEY);
    expect(Object.keys(key)).not.toContain("key_hash");
    expect(key.id).toBe("11111111-1111-4111-8111-111111111111");
  });

  it("401 untuk key yang tidak dikenal", async () => {
    const { client } = stubClient([keyRow()]);
    expect(
      (await caughtAsync(() => authenticateApiKey(client, `hck_${"z".repeat(40)}`)))
        .code,
    ).toBe("UNAUTHORIZED");
  });

  it("401 untuk key yang nonaktif", async () => {
    const { client } = stubClient([keyRow({ status: "nonaktif" })]);
    expect((await caughtAsync(() => authenticateApiKey(client, KEY))).code).toBe(
      "UNAUTHORIZED",
    );
  });

  it("pesan key nonaktif sama dengan pesan key tidak dikenal", async () => {
    const unknown = await caughtAsync(() =>
      authenticateApiKey(stubClient([keyRow()]).client, `hck_${"z".repeat(40)}`),
    );
    const inactive = await caughtAsync(() =>
      authenticateApiKey(stubClient([keyRow({ status: "nonaktif" })]).client, KEY),
    );
    expect(inactive.message).toBe(unknown.message);
    expect(inactive.details).toEqual(unknown.details);
  });
});

describe("shouldTouchLastUsed", () => {
  const now = new Date("2026-03-01T12:00:00.000Z");

  it("key yang belum pernah dipakai selalu ditulis", () => {
    expect(shouldTouchLastUsed(null, now)).toBe(true);
    expect(shouldTouchLastUsed(undefined, now)).toBe(true);
  });

  it("dilewati kalau baru saja ditulis", () => {
    expect(shouldTouchLastUsed("2026-03-01T11:59:00.000Z", now)).toBe(false);
  });

  it("ditulis lagi setelah ambang batas terlewati", () => {
    const stale = new Date(now.getTime() - LAST_USED_THROTTLE_MS).toISOString();
    expect(shouldTouchLastUsed(stale, now)).toBe(true);
  });

  it("nilai yang tidak bisa dibaca dianggap belum pernah dipakai", () => {
    expect(shouldTouchLastUsed("bukan waktu", now)).toBe(true);
  });

  it("cap waktu di masa depan dibiarkan, bukan ditimpa", () => {
    expect(shouldTouchLastUsed("2026-03-02T00:00:00.000Z", now)).toBe(false);
  });
});

describe("touchApiKeyUsage", () => {
  it("hanya menulis last_used_at, tidak kolom lain", async () => {
    const { client, updates } = stubClient([keyRow()]);
    const now = new Date("2026-03-01T08:30:00.000Z");
    await touchApiKeyUsage(client, { id: "key-1", last_used_at: null }, now);
    expect(updates).toEqual([
      { values: { last_used_at: "2026-03-01T08:30:00.000Z" }, id: "key-1" },
    ]);
  });

  it("tidak menulis apa-apa kalau baru saja dipakai", async () => {
    const { client, updates } = stubClient([keyRow()]);
    const now = new Date("2026-03-01T08:30:00.000Z");
    await touchApiKeyUsage(
      client,
      { id: "key-1", last_used_at: "2026-03-01T08:29:00.000Z" },
      now,
    );
    expect(updates).toEqual([]);
  });

  it("tidak menggagalkan permintaan kalau tulisannya ditolak", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = stubClient([keyRow()], { failUpdate: true });
    await expect(
      touchApiKeyUsage(client, { id: "key-1", last_used_at: null }),
    ).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("tidak menggagalkan permintaan kalau tulisannya melempar", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = stubClient([keyRow()], { throwOnUpdate: true });
    await expect(
      touchApiKeyUsage(client, { id: "key-1", last_used_at: null }),
    ).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
