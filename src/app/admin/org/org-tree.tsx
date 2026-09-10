import { Badge } from "@/components/ui/badge";
import type { OrgUnitNode } from "@/server/org/tree";

import { OrgUnitReactivate } from "./org-unit-actions";
import { OrgUnitEdit } from "./org-unit-edit";
import type { UnitOption } from "./org-form";

// Ağacın okunur gösterimi. Kademe adları veriden gelir, koda gömülmez (İlke 1).
//
// Satır iki bloktan oluşur: solda kimlik (ad, kademe, rozetler), sağda
// işlemler. Girinti çizgisi hangi birimin hangisinin altında olduğunu gösterir;
// eskiden yalnız boşlukla veriliyordu ve derin ağaçta kayboluyordu.
//
// Düzenleme formu satırın altında, tam genişlikte açılır; bu yüzden satır kabı
// dikey bir yığın ve işlem kümesi ile form aynı istemci bileşeninden gelir.

function OrgUnitRow({
  node,
  options,
}: {
  node: OrgUnitNode;
  options: UnitOption[];
}) {
  return (
    // Satırın adı öznitelikte taşınır. Metinle satır seçmek yanıltıcı:
    // "Taşı…" açılır listesi **diğer** birimlerin adlarını da içeriyor, bu
    // yüzden metne göre süzen bir seçici yanlış satırı bulabiliyor.
    <li data-birim={node.name}>
      <div className="rounded-(--radius-sm) px-2 py-2 hover:bg-surface-hover">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="font-medium text-ink">{node.name}</span>
            <span className="text-[length:var(--text-xs)] text-muted">
              {node.type}
            </span>

            {node.isActive ? null : <Badge>pasif</Badge>}

            {node.activeUserCount > 0 ? (
              <span className="text-[length:var(--text-xs)] text-muted tabular">
                {node.activeUserCount} kullanıcı
              </span>
            ) : null}

            {node.requiresApproval ? (
              <Badge tone="waiting">onaya tabi</Badge>
            ) : null}

            {node.autoFlowsUp ? null : <Badge>yukarı akmaz</Badge>}

            {node.attentionGroupId ? (
              <Badge tone="primary">dikkat grubu: {node.attentionGroupId}</Badge>
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
            <OrgUnitRow key={child.id} node={child} options={options} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export function OrgTree({
  roots,
  options,
}: {
  roots: OrgUnitNode[];
  options: UnitOption[];
}) {
  if (roots.length === 0) {
    return (
      <p className="text-[length:var(--text-sm)] text-muted">
        Henüz birim yok. Aşağıdaki formla kök birimi oluşturun.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-0.5">
      {roots.map((root) => (
        <OrgUnitRow key={root.id} node={root} options={options} />
      ))}
    </ul>
  );
}
