import { describe, expect, it } from "vitest";

import { authErrorMessage, loginNotice, LOGIN_NOTICES } from "./errors";

const allowedDomain = "hutamakarya.com";
const options = { allowedDomain };

describe("authErrorMessage", () => {
  it("turns the office-domain trigger into the office-domain sentence", () => {
    // What `handle_new_user()`'s 42501 actually looks like from the outside.
    const message = authErrorMessage(
      {
        name: "AuthApiError",
        status: 500,
        code: "unexpected_failure",
        message: "Database error saving new user",
      },
      { ...options, context: "pendaftaran" },
    );
    expect(message).toContain("@hutamakarya.com");
    expect(message).not.toMatch(/database/i);
  });

  it("does NOT blame the email domain when no account can be created", () => {
    // A password sign-in cannot fire `handle_new_user()`: the account already
    // exists. Telling the user to "pakai email kantor" would be a dead end.
    const message = authErrorMessage(
      { status: 500, code: "unexpected_failure", message: "Database error" },
      { ...options, context: "masuk" },
    );
    expect(message).not.toContain("@hutamakarya.com");
    expect(message).toMatch(/Supabase/);
  });

  it("does not mistake a generic outage for a domain rejection", () => {
    const message = authErrorMessage(
      { status: 500, message: "Database error querying schema" },
      { ...options, context: "pendaftaran" },
    );
    expect(message).not.toContain("@hutamakarya.com");
  });

  it("translates the everyday failures", () => {
    expect(
      authErrorMessage({ code: "invalid_credentials" }, options),
    ).toBe("Email atau kata sandi salah.");
    expect(
      authErrorMessage({ message: "Invalid login credentials" }, options),
    ).toBe("Email atau kata sandi salah.");
    expect(authErrorMessage({ code: "otp_expired" }, options)).toMatch(
      /kedaluwarsa/,
    );
    expect(authErrorMessage({ status: 429 }, options)).toMatch(/Tunggu/);
  });

  it("says the server is unreachable instead of leaking 'Failed to fetch'", () => {
    const message = authErrorMessage(
      { name: "AuthRetryableFetchError", message: "Failed to fetch" },
      options,
    );
    expect(message).toMatch(/Supabase/);
    expect(message).not.toMatch(/fetch/i);
  });

  it("never returns English, and never returns nothing", () => {
    for (const error of [
      null,
      undefined,
      {},
      { code: "sesuatu_yang_belum_ada" },
      { message: "Some brand new upstream wording" },
    ]) {
      const message = authErrorMessage(error, options);
      expect(message.length).toBeGreaterThan(0);
      expect(message).toMatch(/[A-Za-z]/);
      expect(message).not.toContain("Some brand new upstream wording");
    }
  });
});

describe("loginNotice", () => {
  it("renders every code in the closed set", () => {
    for (const code of LOGIN_NOTICES) {
      const notice = loginNotice(code, options);
      expect(notice, code).not.toBeNull();
      expect(notice?.text.length).toBeGreaterThan(0);
    }
  });

  it("ignores anything not in the set, so ?pesan= cannot put words on the page", () => {
    expect(loginNotice("Klik di sini untuk hadiah Anda", options)).toBeNull();
    expect(loginNotice("", options)).toBeNull();
    expect(loginNotice(null, options)).toBeNull();
    expect(loginNotice(undefined, options)).toBeNull();
  });

  it("reads the first value when the query string repeats the parameter", () => {
    expect(loginNotice(["keluar", "domain"], options)?.tone).toBe("info");
  });
});
