import { ButtonLink } from "@/components/ui/button";
import { NotFoundIcon, StatusPage } from "@/components/system/status-page";
import { getLocalizedMetadata, getTranslations } from "@/server/i18n/server";


//




export async function generateMetadata() {
  return getLocalizedMetadata("screens.errors.notFoundTitle");
}

export default async function NotFound() {
  const t = await getTranslations();
  return (
    <StatusPage
      icon={<NotFoundIcon />}
      title={t("screens.errors.notFoundTitle")}
      description={t("screens.errors.notFoundDescription")}
      marker={t("screens.errors.notFoundMarker")}
      actions={
        <ButtonLink href="/" variant="primary">
          {t("screens.errors.backToDashboard")}
        </ButtonLink>
      }
    />
  );
}
