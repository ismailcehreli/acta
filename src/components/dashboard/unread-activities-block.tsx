import Link from "next/link";
import type { FeedItem } from "@/server/activities/scope-feed";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { FeedRow } from "./scope-feed";

// Okunmamış faaliyetler dikkat kuyruğu (§10.1, §13.2).
// Ana akış kronolojik görünümünü korur; bu blok yalnızca yöneticinin gözden
// kaçırmaması gereken, kendisine göre henüz okunmamış kayıtların kısa yoludur.
// Sunucu en eski kayıtları önce gönderir: kuyruk önce bekleyen eski işi taşır.
export function UnreadActivitiesBlock({ items, count, href }: {
  items: FeedItem[];
  count: number;
  href: string;
}) {
  if (count === 0) return null;
  return (
    <Card id="okunmamis-faaliyetler" data-test="okunmamis-kuyrugu" className="scroll-mt-6">
      <CardHeader
        title="Okunmamış faaliyetler"
        description={count + " faaliyet henüz okunmadı."}
        action={
          <Link
            href={href}
            className="text-[length:var(--text-sm)] font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            Tüm okunmamışları gör
          </Link>
        }
      />
      <CardBody className="p-0">
        <ul className="divide-y divide-line">
          {items.map((item) => (
            <FeedRow key={item.id} item={item} />
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}
