import { PageSizeSelect } from "./page-size-select";
import { getTranslations } from "@/server/i18n/server";


//





export async function PageSizeForm({
  action,
  value,
}: {
  action: string;
  value: number;
}) {
  const t = await getTranslations();
  return (
    <form method="get" action={action} className="flex items-end gap-2">
      <PageSizeSelect value={value} />
      <noscript>
        <button
          type="submit"
          className="mb-0.5 rounded-(--radius-xs) border border-line-strong px-2.5 py-1.5 text-[length:var(--text-xs)] text-ink"
        >
          {t("common.apply")}
        </button>
      </noscript>
    </form>
  );
}
