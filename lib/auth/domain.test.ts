import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_ALLOWED_EMAIL_DOMAIN,
  emailDomain,
  isOfficeEmail,
  isValidEmailShape,
  normalizeDomain,
  normalizeEmail,
  officeEmailMessage,
  officeEmailPlaceholder,
} from "./domain";

const MIGRATION = path.resolve(
  import.meta.dirname,
  "../../supabase/migrations/0001_init.sql",
);

const DOMAIN = "hutamakarya.com";

describe("normalizeEmail", () => {
  it("trims and lower-cases, the way handle_new_user() stores it", () => {
    expect(normalizeEmail("  Rie@HutamaKarya.com ")).toBe(
      "rie@hutamakarya.com",
    );
  });
});

describe("emailDomain", () => {
  it("takes the SECOND field, exactly like split_part(email, '@', 2)", () => {
    expect(emailDomain("rie@hutamakarya.com")).toBe("hutamakarya.com");
    // A second '@' makes the domain "hutamakarya.com" no longer the 2nd field,
    // so the database rejects it — and so must we.
    expect(emailDomain("rie@evil.test@hutamakarya.com")).toBe("evil.test");
  });

  it("is null when there is no domain at all", () => {
    expect(emailDomain("rie")).toBeNull();
    expect(emailDomain("rie@")).toBeNull();
  });
});

describe("isOfficeEmail", () => {
  it("accepts the office domain in any casing or spacing", () => {
    expect(isOfficeEmail(" RIE@HUTAMAKARYA.COM ", DOMAIN)).toBe(true);
    expect(isOfficeEmail("rie@hutamakarya.com", " @HutamaKarya.com ")).toBe(
      true,
    );
  });

  it("rejects everything else, including lookalikes", () => {
    expect(isOfficeEmail("rie@gmail.com", DOMAIN)).toBe(false);
    expect(isOfficeEmail("rie@sub.hutamakarya.com", DOMAIN)).toBe(false);
    expect(isOfficeEmail("rie@hutamakarya.com.evil.test", DOMAIN)).toBe(false);
    expect(isOfficeEmail("rie@evil.test@hutamakarya.com", DOMAIN)).toBe(false);
  });
});

describe("isValidEmailShape", () => {
  it("accepts an ordinary address", () => {
    expect(isValidEmailShape("rie.putri@hutamakarya.com")).toBe(true);
  });

  it("rejects obvious typos before a round trip", () => {
    for (const bad of ["", "rie", "rie@", "@hutamakarya.com", "rie@kantor", "a b@c.com"]) {
      expect(isValidEmailShape(bad), bad).toBe(false);
    }
  });
});

describe("normalizeDomain", () => {
  it("drops a leading @ and surrounding space", () => {
    expect(normalizeDomain(" @HutamaKarya.com ")).toBe("hutamakarya.com");
  });
});

describe("Indonesian copy", () => {
  it("names the domain, so the user knows what to use instead", () => {
    expect(officeEmailMessage(DOMAIN)).toContain("@hutamakarya.com");
    expect(officeEmailPlaceholder(DOMAIN)).toBe("nama@hutamakarya.com");
  });
});

describe("the fallback domain matches the migration", () => {
  /**
   * `handle_new_user()` falls back to a literal when
   * `app.allowed_email_domain` is unset. If the two drift, the UI would promise
   * a domain the database refuses.
   */
  it("uses the same literal as handle_new_user()", () => {
    const sql = readFileSync(MIGRATION, "utf8");
    const fn = sql.match(
      /create or replace function public\.handle_new_user\(\)([\s\S]*?)\$fn\$;/i,
    );
    expect(fn, "handle_new_user() tidak ditemukan di migration").toBeTruthy();
    expect(fn?.[1]).toContain(`'${DEFAULT_ALLOWED_EMAIL_DOMAIN}'`);
  });
});
