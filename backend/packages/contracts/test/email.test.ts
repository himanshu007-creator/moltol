import { describe, expect, it } from "vitest";
import { normalizeEmail } from "../src/email";

describe("normalizeEmail", () => {
  it("strips +tag and dots from gmail addresses", () => {
    expect(normalizeEmail("himanshu+123@gmail.com")?.normalized).toBe("himanshu@gmail.com");
    expect(normalizeEmail("hi.manshu@gmail.com")?.normalized).toBe("himanshu@gmail.com");
  });

  it("maps googlemail.com to gmail.com", () => {
    expect(normalizeEmail("himanshu+x@googlemail.com")?.normalized).toBe("himanshu@gmail.com");
  });

  it("lowercases and still strips non-whitelisted domains", () => {
    expect(normalizeEmail("John.Doe+work@Outlook.com")?.normalized).toBe("johndoe@outlook.com");
  });

  it("keeps a whitelisted domain's local part exact (just lowercased)", () => {
    const whitelist = new Set(["acme.com"]);
    expect(normalizeEmail("John.Doe+work@acme.com", whitelist)?.normalized).toBe(
      "john.doe+work@acme.com",
    );
  });

  it("returns null for a malformed address", () => {
    expect(normalizeEmail("not-an-email")).toBeNull();
    expect(normalizeEmail("@gmail.com")).toBeNull();
    expect(normalizeEmail("foo@")).toBeNull();
  });
});
