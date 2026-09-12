
//




//




const DOMAIN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

export type DomainListResult =
  | { ok: true; domains: string[] }
  | { ok: false; error: "invalid_domain"; domain: string; message: string };


export function parseDomainList(raw: string): DomainListResult {
  const parts = raw
    .split(/[\s,;]+/)
    .map((part) => part.trim().replace(/^@/, "").toLowerCase())
    .filter((part) => part !== "");

  const domains: string[] = [];

  for (const part of parts) {
    if (!DOMAIN.test(part)) {
      return {
        ok: false,
        error: "invalid_domain",
        domain: part,
        message: `"${part}" is not a valid domain. Example: acme.com`,
      };
    }
    if (!domains.includes(part)) domains.push(part);
  }

  return { ok: true, domains };
}


export function formatDomainList(domains: string[]): string {
  return domains.join(", ");
}


export function isEmailDomainAllowed(email: string, domains: string[]): boolean {
  if (domains.length === 0) return true;

  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain) return false;

  return domains.includes(domain);
}
