"use client";

import Link from "next/link";
import { useActionState } from "react";

import { FormMessage } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Checkbox, Field, Input, Textarea } from "@/components/ui/form";
import { FormActions, FormGrid } from "@/components/ui/page";
import type { HelpArticleView } from "@/server/help/articles";

import {
  createHelpArticleAction,
  updateHelpArticleAction,
} from "./actions";
import { emptyHelpFormState } from "./form-state";

export function HelpArticleEditor({ article }: { article?: HelpArticleView }) {
  const [state, formAction, pending] = useActionState(
    article ? updateHelpArticleAction : createHelpArticleAction,
    emptyHelpFormState,
  );

  return (
    <Card>
      <CardHeader
        title={article ? "Yardım yazısını düzenle" : "Yeni yardım yazısı"}
        description="Kısa, günlük dilde ve adım adım anlatın. İçerik düz metin olarak gösterilir; HTML kullanılamaz."
      />
      <CardBody>
        <form action={formAction} className="flex flex-col gap-5">
          {article ? <input type="hidden" name="id" value={article.id} /> : null}

          <FormGrid columns={2}>
            <Field
              htmlFor="yardim-kategori"
              label="Bölüm"
              hint="Örn. Başlangıç, Faaliyetler, Yöneticiler"
              required
            >
              <Input
                id="yardim-kategori"
                name="category"
                defaultValue={article?.category}
                maxLength={60}
                required
              />
            </Field>

            <Field htmlFor="yardim-baslik" label="Başlık" required>
              <Input
                id="yardim-baslik"
                name="title"
                defaultValue={article?.title}
                maxLength={200}
                required
              />
            </Field>

            <Field
              htmlFor="yardim-aciklama"
              label="Açıklama"
              hint="Her adımı ayrı satıra yazabilirsiniz."
              required
              className="sm:col-span-2"
            >
              <Textarea
                id="yardim-aciklama"
                name="answer"
                defaultValue={article?.answer}
                maxLength={10000}
                rows={10}
                required
              />
            </Field>

            <Field
              htmlFor="yardim-sira"
              label="Sıra"
              hint="Küçük sayı, bölüm içinde daha üstte görünür."
            >
              <Input
                id="yardim-sira"
                name="sortOrder"
                type="number"
                defaultValue={article?.sortOrder ?? 0}
                min={0}
                max={10000}
                className="tabular"
              />
            </Field>

            <div className="flex items-end">
              <Checkbox
                name="isPublished"
                defaultChecked={article?.isPublished ?? true}
                label="Yayınla"
                description="İşaretli değilse yalnız yöneticiler görür."
              />
            </div>
          </FormGrid>

          <FormActions message={<FormMessage error={state.error} success={state.success} />}>
            <Button type="submit" variant="primary" disabled={pending}>
              {pending ? "Kaydediliyor…" : article ? "Değişiklikleri kaydet" : "Yardım yazısını ekle"}
            </Button>
            <Link href="/yardim" className="inline-flex h-(--spacing-control) items-center px-3 text-sm text-muted hover:text-ink">
              Vazgeç
            </Link>
          </FormActions>
        </form>
      </CardBody>
    </Card>
  );
}
