import { Spinner } from "@/components/system/status-page";
import { getTranslations } from "@/server/i18n/server";


//






export default async function Loading() {
  const t = await getTranslations();
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-6 py-12">
      <Spinner label={t("common.loading")} />
    </div>
  );
}
