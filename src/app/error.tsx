"use client";

import { useEffect } from "react";

import { useTranslations } from "@/components/i18n/provider";
import { Button, ButtonLink } from "@/components/ui/button";

import { StatusPage, WarningIcon } from "@/components/system/status-page";


//





//



export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations();
  useEffect(() => {
    console.error("[error]", error.digest ?? "", error.message);
  }, [error]);

  return (
    <StatusPage
      icon={<WarningIcon />}
      title={t("screens.errors.unexpectedTitle")}
      description={t("screens.errors.unexpectedDescription")}
      detail={
        error.digest ? t("screens.errors.errorCode", { code: error.digest }) : undefined
      }
      marker={t("screens.errors.marker")}
      tone="danger"
      actions={
        <>
          <Button type="button" variant="primary" onClick={reset}>
            {t("screens.errors.retry")}
          </Button>
          <ButtonLink href="/" variant="secondary">
            {t("screens.errors.backToDashboard")}
          </ButtonLink>
        </>
      }
    />
  );
}
