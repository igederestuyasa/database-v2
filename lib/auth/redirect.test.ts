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

  it("refuses control characters", () => {
    expect(safeNextPath("/karyawan\nSet-Cookie: x=1")).toBe(DEFAULT_AFTER_LOGIN);
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
