import type { TeamParticipation } from "@/server/dashboard/summary";
import { getTranslations } from "@/server/i18n/server";
import { Card, CardBody, CardHeader } from "@/components/ui/card";




//



export async function TeamBlock({ participation }: { participation: TeamParticipation }) {
  const t = await getTranslations();
  const { people, wrote } = participation;
  const percentage = people === 0 ? 0 : Math.round((wrote / people) * 100);

  return (
    <Card>
      <CardHeader
        title={t("dashboard.teamParticipation")}
        description={t("dashboard.teamParticipationDescription")}
      />
      <CardBody className="flex flex-col gap-2">
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-semibold tabular text-ink">
            {wrote}/{people}
          </span>
          <span className="text-sm text-muted">{t("dashboard.peopleEnteredRecordToday")}</span>
        </div>

        <div
          className="h-2 overflow-hidden rounded-full bg-inset"
          role="img"
          aria-label={t("dashboard.participation", { percentage })}
        >
          <div
            className={percentage >= 70 ? "h-full bg-success" : "h-full bg-waiting"}
            style={{ width: `${percentage}%` }}
          />
        </div>
      </CardBody>
    </Card>
  );
}
