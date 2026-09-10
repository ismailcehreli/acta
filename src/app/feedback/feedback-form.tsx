"use client";

import { useActionState } from "react";

import { FormMessage } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { FormActions, FormGrid } from "@/components/ui/page";

import { createFeedbackAction } from "./actions";
import { emptyFeedbackFormState } from "./form-state";

export function FeedbackForm() {
  const [state, formAction, pending] = useActionState(
    createFeedbackAction,
    emptyFeedbackFormState,
  );

  return (
    <Card>
      <CardHeader
        title="Yeni geri bildirim"
        description="Bir hata, öneri, eleştiri veya soruyu kısa ve anlaşılır şekilde yazın."
      />
      <CardBody>
        <form action={formAction} className="flex flex-col gap-5">
          <FormGrid columns={2}>
            <Field htmlFor="feedback-category" label="Konu" required>
              <Select id="feedback-category" name="category" defaultValue="BUG" required>
                <option value="BUG">Hata bildirimi</option>
                <option value="SUGGESTION">Öneri</option>
                <option value="CRITIQUE">Eleştiri</option>
                <option value="QUESTION">Soru</option>
              </Select>
            </Field>

            <Field htmlFor="feedback-title" label="Başlık" required>
              <Input
                id="feedback-title"
                name="title"
                maxLength={200}
                placeholder="Örn. İzin ekranında tarih seçemiyorum"
                required
              />
            </Field>

            <Field
              htmlFor="feedback-description"
              label="Açıklama"
              hint="Sorunu veya önerinizi mümkünse örnek vererek anlatın."
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
              label="İlgili bölüm (isteğe bağlı)"
              hint="Biliyorsanız sayfa adını veya adresini yazabilirsiniz."
            >
              <Input
                id="feedback-source"
                name="sourcePath"
                maxLength={500}
                placeholder="Örn. İzinlerim"
              />
            </Field>

          </FormGrid>

          <FormActions message={<FormMessage error={state.error} success={state.success} />}>
            <Button type="submit" variant="primary" disabled={pending}>
              {pending ? "Gönderiliyor…" : "Geri bildirimi gönder"}
            </Button>
          </FormActions>
        </form>
      </CardBody>
    </Card>
  );
}
