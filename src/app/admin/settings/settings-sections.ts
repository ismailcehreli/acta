export const SETTINGS_SECTIONS = [
  {
    slug: "general",
    labelKey: "screens.settingsPage.sectionGeneral",
    descriptionKey: "screens.settingsPage.sections.generalDescription",
    groups: ["Activity entry", "Leave and no-activity days"],
  },
  {
    slug: "approval",
    labelKey: "screens.settingsPage.sectionApproval",
    descriptionKey: "screens.settingsPage.sections.approvalDescription",
    groups: ["Approval flow", "Questions and answers", "Follow-up items"],
  },
  {
    slug: "notifications",
    labelKey: "screens.settingsPage.sectionNotifications",
    descriptionKey: "screens.settingsPage.sections.notificationsDescription",
    groups: ["Notifications"],
  },
  {
    slug: "scoring",
    labelKey: "screens.settingsPage.sectionScoring",
    descriptionKey: "screens.settingsPage.sections.scoringDescription",
    groups: ["Score"],
  },
  {
    slug: "accounts",
    labelKey: "screens.settingsPage.sectionAccounts",
    descriptionKey: "screens.settingsPage.sections.accountsDescription",
    groups: ["User accounts", "Sessions and security"],
  },
  {
    slug: "files",
    labelKey: "screens.settingsPage.sectionFiles",
    descriptionKey: "screens.settingsPage.sections.filesDescription",
    groups: ["File attachments"],
  },
  {
    slug: "delivery",
    labelKey: "screens.settingsPage.sectionDelivery",
    descriptionKey: "screens.settingsPage.sections.deliveryDescription",
    groups: [],
  },
  {
    slug: "customization",
    labelKey: "screens.settingsPage.sectionCustomization",
    descriptionKey: "screens.settingsPage.sections.customizationDescription",
    groups: [],
  },
  {
    slug: "demo",
    labelKey: "screens.settingsPage.sectionDemo",
    descriptionKey: "screens.settingsPage.sections.demoDescription",
    groups: [],
  },
  {
    slug: "reset",
    labelKey: "screens.settingsPage.sectionReset",
    descriptionKey: "screens.settingsPage.sections.resetDescription",
    groups: [],
  },
] as const;

export type SettingsSectionSlug = (typeof SETTINGS_SECTIONS)[number]["slug"];
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

export function findSettingsSection(
  slug: string,
): SettingsSection | undefined {
  return SETTINGS_SECTIONS.find((section) => section.slug === slug);
}
