import Link from "next/link";
import type { FeedItem } from "@/server/activities/scope-feed";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { FeedRow } from "./scope-feed";
import { getTranslations } from "@/server/i18n/server";
import { getLocale } from "@/server/i18n/locale";





export async function UnreadActivitiesBlock({ items, count, href }: {
  items: FeedItem[];
  count: number;
  href: string;
}) {
  if (count === 0) return null;
  const locale = await getLocale();
  const t = await getTranslations(locale);
  return (
    <Card id="unread-activities" data-test="unread-queue" className="scroll-mt-6">
      <CardHeader
        title={t("screens.dashboard.unreadTitle")}
        description={t("screens.dashboard.unreadDescription", { count })}
        action={
          <Link
            href={href}
            className="text-[length:var(--text-sm)] font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            {t("screens.dashboard.viewAllUnread")}
          </Link>
        }
      />
      <CardBody className="p-0">
        <ul className="divide-y divide-line">
          {items.map((item) => (
            <FeedRow key={item.id} item={item} locale={locale} t={t} />
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}
