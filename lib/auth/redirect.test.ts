import { describe, expect, it } from "vitest";

import {
  DEFAULT_AFTER_LOGIN,
  LOGIN_PATH,
  isPublicPath,
  loginHref,
  safeNextPath,
} from "./redirect";

describe("isPublicPath", () => {
  it("covers /login and everything under it, and nothing else", () => {
    expect(isPublicPath("/login")).toBe(true);
    expect(isPublicPath("/login/callback")).toBe(true);
    expect(isPublicPath("/karyawan")).toBe(false);
    // Not a prefix match on the string: /loginx is a different route.
    expect(isPublicPath("/loginx")).toBe(false);
  });
});

describe("safeNextPath", () => {
  it("keeps an ordinary in-app path, query string and all", () => {
    expect(safeNextPath("/karyawan?status=aktif")).toBe("/karyawan?status=aktif");
    expect(safeNextPath("/pengguna")).toBe("/pengguna");
  });

  it("refuses to send the browser off-origin", () => {
    for (const hostile of [
      "https://evil.test/phish",
      "//evil.test",
      "/\\evil.test",
      "http://evil.test",
      "javascript:alert(1)",
    ]) {
      expect(safeNextPath(hostile), hostile).toBe(DEFAULT_AFTER_LOGIN);
    }
  });

  /**
   * Pinned with characters built at runtime, never typed into this file.
   *
   * The check in `redirect.ts` is a range `[\x00-\x1f\x7f]`, and the whole
   * point is that those bytes must never appear literally in source — a file
   * containing them is binary to git, unreviewable on GitHub, and one
   * formatter pass away from silently matching nothing. Constructing them here
   * means the behaviour stays pinned however the source spells the range.
   */
  it("refuses control characters", () => {
    const NUL = String.fromCharCode(0);
    const US = String.fromCharCode(0x1f);
    const DEL = String.fromCharCode(0x7f);

    expect(safeNextPath("/karyawan\nSet-Cookie: x=1")).toBe(DEFAULT_AFTER_LOGIN);
    expect(safeNextPath("/karyawan\rSet-Cookie: x=1")).toBe(DEFAULT_AFTER_LOGIN);
    expect(safeNextPath(`/karyawan${NUL}`)).toBe(DEFAULT_AFTER_LOGIN);
    expect(safeNextPath(`/karyawan${US}`)).toBe(DEFAULT_AFTER_LOGIN);
    expect(safeNextPath(`/karyawan${DEL}`)).toBe(DEFAULT_AFTER_LOGIN);
    expect(safeNextPath(`${NUL}/karyawan`)).toBe(DEFAULT_AFTER_LOGIN);

    // Every byte in the range, so a narrowed class cannot pass unnoticed.
    for (let code = 0; code <= 0x1f; code++) {
      const candidate = `/karyawan${String.fromCharCode(code)}`;
      expect(safeNextPath(candidate), `charCode ${code}`).toBe(
        DEFAULT_AFTER_LOGIN,
      );
    }
  });

  it("still accepts an ordinary path next to that range", () => {
    // Guards the other direction: the class must not have widened into
    // printable ASCII (0x20 is a space, which `.trim()` removes at the edges).
    expect(safeNextPath("/karyawan?q=a b")).toBe("/karyawan?q=a b");
    expect(safeNextPath("  /karyawan  ")).toBe("/karyawan");
  });

  it("never bounces back to the login page, which would loop", () => {
    expect(safeNextPath(LOGIN_PATH)).toBe(DEFAULT_AFTER_LOGIN);
    expect(safeNextPath("/login/callback?code=x")).toBe(DEFAULT_AFTER_LOGIN);
  });

  it("falls back for empty and non-string input", () => {
    expect(safeNextPath(null)).toBe(DEFAULT_AFTER_LOGIN);
    expect(safeNextPath(undefined)).toBe(DEFAULT_AFTER_LOGIN);
    expect(safeNextPath("   ")).toBe(DEFAULT_AFTER_LOGIN);
  });
});

describe("loginHref", () => {
  it("is bare when there is nothing to say", () => {
    expect(loginHref()).toBe("/login");
    expect(loginHref({ next: DEFAULT_AFTER_LOGIN })).toBe("/login");
  });

  it("carries the destination and the notice code", () => {
    expect(loginHref({ next: "/pengguna", pesan: "login" })).toBe(
      "/login?next=%2Fpengguna&pesan=login",
    );
  });

  it("sanitises the destination it is given", () => {
    expect(loginHref({ next: "https://evil.test" })).toBe("/login");
  });
});
