import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  API_KEY_HASH_LENGTH,
  API_KEY_PATTERN,
  API_KEY_PREFIX,
  API_KEY_PREFIX_LENGTH,
  API_KEY_SECRET_LENGTH,
  apiKeyPrefix,
  createApiKeyMaterial,
  generateApiKeySecret,
  hashApiKey,
  isApiKeyFormat,
  type RandomBytes,
} from "./keygen";
import { apiKeyTokenSchema } from "@/lib/validation/apiKey";

/**
 * Sumber acak palsu yang mengulang pola byte tertentu, supaya pemetaan
 * byte → karakter bisa diperiksa, bukan hanya "hasilnya terlihat acak".
 */
function bytesOf(pattern: readonly number[]): RandomBytes {
  let i = 0;
  return (size: number) => {
    const out = new Uint8Array(size);
    for (let n = 0; n < size; n += 1) {
      out[n] = pattern[i % pattern.length];
      i += 1;
    }
    return out;
  };
}

describe("generateApiKeySecret", () => {
  it("selalu 40 karakter dari [A-Za-z0-9]", () => {
    for (let n = 0; n < 200; n += 1) {
      const secret = generateApiKeySecret();
      expect(secret).toHaveLength(API_KEY_SECRET_LENGTH);
      expect(secret).toMatch(/^[A-Za-z0-9]{40}$/);
    }
  });

  it("memetakan byte ke abjad 62 karakter", () => {
    // 0 → "A", 25 → "Z", 26 → "a", 51 → "z", 52 → "0", 61 → "9".
    const secret = generateApiKeySecret(bytesOf([0, 25, 26, 51, 52, 61]));
    expect(secret.slice(0, 6)).toBe("AZaz09");
  });

  it("membuang byte ≥ 248 daripada memetakannya dengan modulo yang bias", () => {
    // Tanpa penolakan, 248 % 62 = 0 akan menambah satu "A" lagi.
    const secret = generateApiKeySecret(bytesOf([248, 255, 1]));
    expect(secret).toBe("B".repeat(API_KEY_SECRET_LENGTH));
  });

  it("menghasilkan nilai yang berbeda setiap kali dipanggil", () => {
    const keys = new Set(
      Array.from({ length: 500 }, () => generateApiKeySecret()),
    );
    expect(keys.size).toBe(500);
  });

  it("gagal keras kalau sumber acaknya kosong, bukan menggantung", () => {
    expect(() => generateApiKeySecret(() => new Uint8Array(0))).toThrow();
  });
});

describe("createApiKeyMaterial", () => {
  it("membuat key berbentuk hck_ + 40 karakter", () => {
    const { key } = createApiKeyMaterial();
    expect(key.startsWith(API_KEY_PREFIX)).toBe(true);
    expect(key).toHaveLength(API_KEY_PREFIX.length + API_KEY_SECRET_LENGTH);
    expect(API_KEY_PATTERN.test(key)).toBe(true);
  });

  it("key-nya lolos apiKeyTokenSchema — bentuk yang sama yang dipakai /api/v1", () => {
    for (let n = 0; n < 50; n += 1) {
      const { key } = createApiKeyMaterial();
      expect(apiKeyTokenSchema.safeParse(key).success).toBe(true);
    }
  });

  it("prefix-nya 8 karakter pertama key", () => {
    const { key, keyPrefix } = createApiKeyMaterial();
    expect(keyPrefix).toHaveLength(API_KEY_PREFIX_LENGTH);
    expect(keyPrefix).toBe(key.slice(0, API_KEY_PREFIX_LENGTH));
    expect(keyPrefix.startsWith(API_KEY_PREFIX)).toBe(true);
  });

  it("prefix-nya tidak cukup untuk menebak key-nya", () => {
    const { key, keyPrefix } = createApiKeyMaterial();
    expect(key.slice(API_KEY_PREFIX_LENGTH)).not.toHaveLength(0);
    expect(key).not.toBe(keyPrefix);
  });

  /**
   * Inti dari seluruh unit ini: hash yang disimpan saat key dibuat HARUS sama
   * dengan hash yang dihitung `lib/api/auth.ts` dari key yang dikirim
   * Konsumen. Kalau keduanya bergeser, setiap key baru ditolak 401 tanpa satu
   * pun pesan yang menjelaskannya.
   */
  it("hash-nya = sha256 heksadesimal huruf kecil dari key penuh", () => {
    const { key, keyHash } = createApiKeyMaterial();
    const expected = createHash("sha256").update(key, "utf8").digest("hex");
    expect(keyHash).toBe(expected);
    expect(keyHash).toBe(hashApiKey(key));
    expect(keyHash).toHaveLength(API_KEY_HASH_LENGTH);
    expect(keyHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("hash-nya tidak memuat potongan key-nya", () => {
    const { key, keyHash } = createApiKeyMaterial();
    expect(keyHash).not.toContain(key);
    expect(keyHash).not.toContain(key.slice(API_KEY_PREFIX.length, 12));
  });
});

describe("hashApiKey", () => {
  it("nilai acuan tetap — kalau ini berubah, semua key yang sudah ada mati", () => {
    // Bukan key sungguhan: 40 karakter "a" (lihat API_KEY_PATTERN).
    const contoh = `${API_KEY_PREFIX}${"a".repeat(API_KEY_SECRET_LENGTH)}`;
    expect(hashApiKey(contoh)).toBe(
      createHash("sha256").update(contoh, "utf8").digest("hex"),
    );
    expect(hashApiKey(contoh)).toHaveLength(API_KEY_HASH_LENGTH);
  });

  it("deterministik", () => {
    const { key } = createApiKeyMaterial();
    expect(hashApiKey(key)).toBe(hashApiKey(key));
  });

  it("meng-hash key APA ADANYA — spasi dan beda huruf bukan key yang sama", () => {
    const { key } = createApiKeyMaterial();
    expect(hashApiKey(`${key} `)).not.toBe(hashApiKey(key));
    expect(hashApiKey(key.toUpperCase())).not.toBe(hashApiKey(key));
  });

  it("dua key berbeda tidak pernah punya hash yang sama", () => {
    const hashes = new Set(
      Array.from({ length: 200 }, () => createApiKeyMaterial().keyHash),
    );
    expect(hashes.size).toBe(200);
  });

  it("menolak string kosong daripada menghasilkan hash yang cocok ke mana-mana", () => {
    expect(() => hashApiKey("")).toThrow();
  });
});

describe("apiKeyPrefix", () => {
  it("mengambil 8 karakter pertama", () => {
    expect(apiKeyPrefix("hck_ABCDEFGH")).toBe("hck_ABCD");
  });

  it("tidak meledak untuk string pendek", () => {
    expect(apiKeyPrefix("hck_")).toBe("hck_");
  });
});

describe("isApiKeyFormat", () => {
  it("menerima key yang dibuat modul ini", () => {
    expect(isApiKeyFormat(createApiKeyMaterial().key)).toBe(true);
  });

  it("menolak bentuk yang bukan API Key HC Core", () => {
    const secret = "a".repeat(API_KEY_SECRET_LENGTH);
    expect(isApiKeyFormat("")).toBe(false);
    expect(isApiKeyFormat(secret)).toBe(false);
    expect(isApiKeyFormat(`HCK_${secret}`)).toBe(false);
    expect(isApiKeyFormat(`${API_KEY_PREFIX}${"a".repeat(39)}`)).toBe(false);
    expect(isApiKeyFormat(`${API_KEY_PREFIX}${"a".repeat(41)}`)).toBe(false);
    expect(isApiKeyFormat(`${API_KEY_PREFIX}${"a".repeat(39)}-`)).toBe(false);
    expect(isApiKeyFormat(` ${API_KEY_PREFIX}${secret}`)).toBe(false);
  });
});
