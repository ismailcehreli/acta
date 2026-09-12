"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useTranslations } from "@/components/i18n";

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
  const t = useTranslations();
  const [state, formAction, pending] = useActionState(
    article ? updateHelpArticleAction : createHelpArticleAction,
    emptyHelpFormState,
  );

  return (
    <Card>
      <CardHeader
        title={article ? t("screens.help.editTitle") : t("screens.help.newTitle")}
        description={article ? t("screens.help.editDescription") : t("screens.help.newDescription")}
      />
      <CardBody>
        <form action={formAction} className="flex flex-col gap-5">
          {article ? <input type="hidden" name="id" value={article.id} /> : null}

          <FormGrid columns={2}>
            <Field
              htmlFor="help-category"
              label={t("screens.help.categoryLabel")}
              hint={t("screens.help.categoryHint")}
              required
            >
              <Input
                id="help-category"
                name="category"
                defaultValue={article?.category}
                maxLength={60}
                required
              />
            </Field>

            <Field htmlFor="help-title" label={t("screens.help.titleLabel")} required>
              <Input
                id="help-title"
                name="title"
                defaultValue={article?.title}
                maxLength={200}
                required
              />
            </Field>

            <Field
              htmlFor="help-answer"
              label={t("screens.help.answerLabel")}
              hint={t("screens.help.answerHint")}
              required
              className="sm:col-span-2"
            >
              <Textarea
                id="help-answer"
                name="answer"
                defaultValue={article?.answer}
                maxLength={10000}
                rows={10}
                required
              />
            </Field>

            <Field
              htmlFor="help-order"
              label={t("screens.help.orderLabel")}
              hint={t("screens.help.orderHint")}
            >
              <Input
                id="help-order"
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
                label={t("screens.help.publishLabel")}
                description={t("screens.help.publishDescription")}
              />
            </div>
          </FormGrid>

          <FormActions message={<FormMessage error={state.error} success={state.success} />}>
            <Button type="submit" variant="primary" disabled={pending}>
              {pending ? t("screens.help.saving") : article ? t("screens.help.saveChanges") : t("screens.help.createArticle")}
            </Button>
            <Link href="/help" className="inline-flex h-(--spacing-control) items-center px-3 text-sm text-muted hover:text-ink">
              {t("screens.help.cancel")}
            </Link>
          </FormActions>
        </form>
      </CardBody>
    </Card>
  );
}
