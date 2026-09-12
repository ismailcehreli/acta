import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createUser } from "@/server/users/create";
import { updateUser } from "@/server/users/update";
import {
  formatDomainList,
  isEmailDomainAllowed,
  parseDomainList,
} from "@/server/settings/email-domains";
import { SETTING_KEYS } from "@/server/settings/registry";
import { saveSettings } from "@/server/settings/system-settings";

import { createOrgUnit } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// Email domain restriction: safety check against typos.
// Default is disabled and does not affect existing accounts.

const PASSWORD = "setup-password-1234";

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function applyDomainRestriction(value: string) {
  const result = await saveSettings(testDb, {
    [SETTING_KEYS.allowedEmailDomains]: value,
  });
  if (!result.ok) throw new Error(`setting failed: ${result.message}`);
}

describe("domain list parsing", () => {
  it("commas, whitespace, and newlines act as separators", () => {
    const result = parseDomainList("acme.com, example.test\nother.com.tr");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.domains).toEqual(["acme.com", "example.test", "other.com.tr"]);
  });

  it("leading @ is stripped, converted to lowercase, duplicates deduplicated", () => {
    const result = parseDomainList("@Acme.COM, acme.com");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.domains).toEqual(["acme.com"]);
    expect(formatDomainList(result.domains)).toBe("acme.com");
  });

  it("empty text means no restriction", () => {
    const result = parseDomainList("   ");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.domains).toEqual([]);
  });

  it("invalid domain is rejected and identified", () => {
    const result = parseDomainList("acme.com, no_dot");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain("no_dot");
  });
});

describe("domain matching", () => {
  it("empty list allows all email addresses", () => {
    expect(isEmailDomainAllowed("anyone@other.com", [])).toBe(true);
  });

  it("listed domain is accepted, unlisted is rejected", () => {
    const list = ["acme.com"];

    expect(isEmailDomainAllowed("user@acme.com", list)).toBe(true);
    expect(isEmailDomainAllowed("user@acme.co", list)).toBe(false);
  });

  it("subdomains do not match parent domain", () => {
    expect(isEmailDomainAllowed("user@mail.acme.com", ["acme.com"])).toBe(false);
  });
});

describe("settings registry", () => {
  it("reduces to canonical form when saving", async () => {
    await applyDomainRestriction(" @Acme.com ;  example.test ");

    const setting = await testDb.systemSetting.findUniqueOrThrow({
      where: { key: SETTING_KEYS.allowedEmailDomains },
    });
    expect(setting.value).toBe("acme.com, example.test");
  });

  it("invalid list is never saved", async () => {
    const result = await saveSettings(testDb, {
      [SETTING_KEYS.allowedEmailDomains]: "broken domain name!",
    });

    expect(result.ok).toBe(false);
    expect(
      await testDb.systemSetting.findUnique({
        where: { key: SETTING_KEYS.allowedEmailDomains },
      }),
    ).toBeNull();
  });
});

describe("account creation", () => {
  it("accounts can be created with any address when restriction is disabled", async () => {
    const unit = await createOrgUnit({ name: "Root", type: "Root" });

    const result = await createUser(testDb, {
      fullName: "Free User",
      email: "user@any.test",
      orgUnitId: unit.id,
      isUnitManager: false,
      isSystemAdmin: false,
      writesActivities: true,
      initialPassword: PASSWORD,
    });

    expect(result.ok).toBe(true);
  });

  it("cannot create account with unlisted domain", async () => {
    const unit = await createOrgUnit({ name: "Root", type: "Root" });
    await applyDomainRestriction("acme.com");

    const result = await createUser(testDb, {
      fullName: "Typo User",
      email: "user@acme.co",
      orgUnitId: unit.id,
      isUnitManager: false,
      isSystemAdmin: false,
      writesActivities: true,
      initialPassword: PASSWORD,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("email_domain_not_allowed");
    expect(result.message).toContain("acme.com");
    expect(await testDb.user.count()).toBe(0);
  });

  it("creates account with allowed domain", async () => {
    const unit = await createOrgUnit({ name: "Root", type: "Root" });
    await applyDomainRestriction("acme.com, example.test");

    const result = await createUser(testDb, {
      fullName: "Valid User",
      email: "user@example.test",
      orgUnitId: unit.id,
      isUnitManager: false,
      isSystemAdmin: false,
      writesActivities: true,
      initialPassword: PASSWORD,
    });

    expect(result.ok).toBe(true);
  });
});

describe("address modification", () => {
  it("existing user can be edited even if address is outside subsequently added restriction", async () => {
    const unit = await createOrgUnit({ name: "Root", type: "Root" });
    const creation = await createUser(testDb, {
      fullName: "Legacy User",
      email: "legacy@other.test",
      orgUnitId: unit.id,
      isUnitManager: false,
      isSystemAdmin: false,
      writesActivities: true,
      initialPassword: PASSWORD,
    });
    if (!creation.ok) throw new Error("setup failed");

    await applyDomainRestriction("acme.com");

    // Email address does not change; only name is updated.
    const result = await updateUser(testDb, {
      id: creation.user.id,
      fullName: "Legacy User Updated",
      email: "legacy@other.test",
      orgUnitId: unit.id,
      isUnitManager: false,
      isSystemAdmin: false,
      writesActivities: true,
    });

    expect(result.ok).toBe(true);
  });

  it("email cannot be changed to unlisted domain", async () => {
    const unit = await createOrgUnit({ name: "Root", type: "Root" });
    const creation = await createUser(testDb, {
      fullName: "User",
      email: "user@acme.com",
      orgUnitId: unit.id,
      isUnitManager: false,
      isSystemAdmin: false,
      writesActivities: true,
      initialPassword: PASSWORD,
    });
    if (!creation.ok) throw new Error("setup failed");

    await applyDomainRestriction("acme.com");

    const result = await updateUser(testDb, {
      id: creation.user.id,
      fullName: "User",
      email: "user@outside.test",
      orgUnitId: unit.id,
      isUnitManager: false,
      isSystemAdmin: false,
      writesActivities: true,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("email_domain_not_allowed");

    const fresh = await testDb.user.findUniqueOrThrow({
      where: { id: creation.user.id },
    });
    expect(fresh.email).toBe("user@acme.com");
  });
});
