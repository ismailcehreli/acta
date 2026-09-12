import { Badge } from "@/components/ui/badge";
import type { OrgUnitNode } from "@/server/org/tree";
import { getTranslations } from "@/server/i18n/server";
import type { TranslateFunction } from "@/shared/i18n";

import { OrgUnitReactivate } from "./org-unit-actions";
import { OrgUnitEdit } from "./org-unit-edit";
import type { UnitOption } from "./org-form";
function OrgUnitRow({
  node,
  options,
  t,
}: {
  node: OrgUnitNode;
  options: UnitOption[];
  t: TranslateFunction;
}) {
  return (
    <li data-unit={node.name}>
      <div className="rounded-(--radius-sm) px-2 py-2 hover:bg-surface-hover">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="font-medium text-ink">{node.name}</span>
            <span className="text-[length:var(--text-xs)] text-muted">
              {node.type}
            </span>

            {node.isActive ? null : (
              <Badge>{t("screens.organization.inactive")}</Badge>
            )}

            {node.activeUserCount > 0 ? (
              <span className="text-[length:var(--text-xs)] text-muted tabular">
                {t("screens.organization.userCount", {
                  count: node.activeUserCount,
                })}
              </span>
            ) : null}

            {node.requiresApproval ? (
              <Badge data-test="approval-required" tone="waiting">
                {t("screens.organization.approvalRequired")}
              </Badge>
            ) : null}

            {node.autoFlowsUp ? null : (
              <Badge>{t("screens.organization.doesNotFlowUp")}</Badge>
            )}

            {node.attentionGroupId ? (
              <Badge tone="primary">
                {t("screens.organization.attentionGroupBadge", {
                  group: node.attentionGroupId,
                })}
              </Badge>
            ) : null}
          </div>

          {node.isActive ? (
            <OrgUnitEdit
              unit={{
                id: node.id,
                name: node.name,
                type: node.type,
                requiresApproval: node.requiresApproval,
                autoFlowsUp: node.autoFlowsUp,
                attentionGroupId: node.attentionGroupId,
              }}
              options={options.filter((option) => option.id !== node.id)}
            />
          ) : (
            <OrgUnitReactivate unitId={node.id} />
          )}
        </div>
      </div>

      {node.children.length > 0 ? (
        <ul className="ml-3 border-l border-line pl-4">
          {node.children.map((child) => (
            <OrgUnitRow key={child.id} node={child} options={options} t={t} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export async function OrgTree({
  roots,
  options,
}: {
  roots: OrgUnitNode[];
  options: UnitOption[];
}) {
  const t = await getTranslations();
  if (roots.length === 0) {
    return (
      <p className="text-[length:var(--text-sm)] text-muted">
        {t("screens.organization.noUnits")} {t("screens.organization.noUnitsDescription")}
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-0.5">
      {roots.map((root) => (
        <OrgUnitRow key={root.id} node={root} options={options} t={t} />
      ))}
    </ul>
  );
}
