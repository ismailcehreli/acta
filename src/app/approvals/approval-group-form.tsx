"use client";

import Link from "next/link";
import { useActionState } from "react";

import { FormMessage } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";

import { approveManyAction } from "./actions";
import { emptyBulkApprovalFormState } from "./form-state";

// Bir kişinin bir günü (Görev 10.6).
//
// Kayıtlar **açıklamalarıyla birlikte** listeleniyor: müdürün onaylamadan önce
// okuması gereken şey açıklamadır. Yalnız başlık gösterip "hepsini onayla"
// demek, okumadan onaylamayı kolaylaştırırdı.

export interface GroupItem {
  id: string;
  activityNo: number;
  title: string;
  description: string;
  targetDepartmentNames: string[];
}

export function ApprovalGroupForm({
  authorName,
  authorUnitName,
  dayLabel,
  items,
}: {
  authorName: string;
  authorUnitName: string;
  dayLabel: string;
  items: GroupItem[];
}) {
  const [state, formAction, pending] = useActionState(
    approveManyAction,
    emptyBulkApprovalFormState,
  );

  return (
    <Card data-test="onay-grubu" data-kisi={authorName}>
      <CardHeader
        title={`${authorName} · ${dayLabel}`}
        description={`${authorUnitName} · ${items.length} kayıt`}
      />

      <CardBody className="flex flex-col gap-3 py-2">
        {items.map((item) => (
          <div
            key={item.id}
            data-test="onay-kaydi"
            className="rounded-(--radius-sm) border border-line px-3 py-2.5"
          >
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="text-[length:var(--text-xs)] text-muted tabular">
                #{item.activityNo}
              </span>
              <Link
                href={`/activities/${item.id}`}
                className="min-w-0 flex-1 text-[length:var(--text-sm)] font-medium text-ink hover:underline"
              >
                {item.title}
              </Link>
              <ButtonLink href={`/activities/${item.id}`} size="sm">
                Ayrı ele al
              </ButtonLink>
            </div>

            <p className="mt-1 whitespace-pre-line text-[length:var(--text-sm)] text-muted">
              {item.description}
            </p>

            {item.targetDepartmentNames.length > 0 ? (
              <p className="mt-1.5 flex flex-wrap gap-1">
                {item.targetDepartmentNames.map((ad) => (
                  <Badge key={ad}>{ad}</Badge>
                ))}
              </p>
            ) : null}
          </div>
        ))}
      </CardBody>

      <CardBody className="border-t border-line pt-3">
        <form action={formAction} className="flex flex-col gap-3">
          {/* Kimlikler **ekrandan** gidiyor: müdür sayfayı açtıktan sonra yeni
              bir kayıt gelirse "hepsini onayla" onu kapsamaz — okumadığı bir
              kaydı onaylamış olurdu. */}
          {items.map((item) => (
            <input
              key={item.id}
              type="hidden"
              name="activityIds"
              value={item.id}
            />
          ))}

          <FormMessage error={state.error} success={state.success} />

          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" variant="primary" disabled={pending}>
              {pending
                ? "Onaylanıyor…"
                : `Görünen ${items.length} kaydı onayla`}
            </Button>
            <span className="text-[length:var(--text-xs)] text-muted">
              Düzeltme istemek ya da reddetmek için kaydı ayrı ele alın.
            </span>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}
