"use client";

import { useActionState } from "react";

import { useTranslations } from "@/components/i18n";
import { FormMessage } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { FormActions, FormGrid } from "@/components/ui/page";

import { createFeedbackAction } from "./actions";
import { emptyFeedbackFormState } from "./form-state";

export function FeedbackForm() {
  const t = useTranslations();
  const [state, formAction, pending] = useActionState(
    createFeedbackAction,
    emptyFeedbackFormState,
  );

  return (
    <Card>
      <CardHeader
        title={t("screens.feedback.newTab")}
        description={t("screens.feedback.descriptionHint")}
      />
      <CardBody>
        <form action={formAction} className="flex flex-col gap-5">
          <FormGrid columns={2}>
            <Field htmlFor="feedback-category" label={t("screens.feedback.topic")} required>
              <Select id="feedback-category" name="category" defaultValue="BUG" required>
                <option value="BUG">{t("screens.feedback.bug")}</option>
                <option value="SUGGESTION">{t("screens.feedback.suggestion")}</option>
                <option value="CRITIQUE">{t("screens.feedback.criticism")}</option>
                <option value="QUESTION">{t("screens.feedback.question")}</option>
              </Select>
            </Field>

            <Field htmlFor="feedback-title" label={t("screens.feedback.title")} required>
              <Input
                id="feedback-title"
                name="title"
                maxLength={200}
                placeholder={t("screens.feedback.titlePlaceholder")}
                required
              />
            </Field>

            <Field
              htmlFor="feedback-description"
              label={t("screens.feedback.description")}
              hint={t("screens.feedback.descriptionHint")}
              required
              className="sm:col-span-2"
            >
              <Textarea
                id="feedback-description"
                name="description"
                maxLength={10000}
                rows={7}
                required
              />
            </Field>

            <Field
              htmlFor="feedback-source"
              label={t("screens.feedback.relatedSection")}
              hint={t("screens.feedback.relatedSectionHint")}
            >
              <Input
                id="feedback-source"
                name="sourcePath"
                maxLength={500}
                placeholder={t("screens.feedback.relatedSectionPlaceholder")}
              />
            </Field>

          </FormGrid>

          <FormActions message={<FormMessage error={state.error} success={state.success} />}>
            <Button type="submit" variant="primary" disabled={pending}>
              {pending ? t("screens.feedback.submitting") : t("screens.feedback.submit")}
            </Button>
          </FormActions>
        </form>
      </CardBody>
    </Card>
  );
}
