"use client";

import { useActionState, useRef, useState } from "react";

import { useLocale, useTranslations } from "@/components/i18n/provider";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";

import { removeAvatarAction, uploadAvatarAction } from "./avatar-actions";
import { emptyAvatarState } from "./form-state";


//



//




const AVATAR_SIZE = 256;


async function resizeAvatar(file: File): Promise<File> {
  try {
    const bitmap = await createImageBitmap(file);


    const side = Math.min(bitmap.width, bitmap.height);
    const sx = (bitmap.width - side) / 2;
    const sy = (bitmap.height - side) / 2;

    const canvas = document.createElement("canvas");
    canvas.width = AVATAR_SIZE;
    canvas.height = AVATAR_SIZE;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;

    ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
    bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/webp", 0.85),
    );
    if (!blob) return file;

    return new File([blob], "avatar.webp", { type: "image/webp" });
  } catch {


    return file;
  }
}

export function AvatarForm({
  user,
  canEdit,
}: {
  user: { id: string; fullName: string; avatarExtension: string | null };

  canEdit: boolean;
}) {
  const locale = useLocale();
  const t = useTranslations();
  const [uploadState, upload, uploading] = useActionState(
    uploadAvatarAction,
    emptyAvatarState,
  );
  const [removal, remove, removing] = useActionState(
    removeAvatarAction,
    emptyAvatarState,
  );
  const [preview, setPreview] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);





  const lastOperation =
    (removal.stamp ?? 0) > (uploadState.stamp ?? 0) ? removal : uploadState;



  //



  const extension =
    lastOperation.extension !== undefined ? lastOperation.extension : user.avatarExtension;

  const stamp = lastOperation.stamp;
  const displayed = { ...user, avatarExtension: extension };

  const status = uploadState.error ?? removal.error ?? null;
  const success = lastOperation.success;

  if (!canEdit) {
    return <Avatar user={user} size={96} locale={locale} />;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-4">

        {preview && !stamp ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={preview}
            alt=""
            aria-hidden
            width={96}
            height={96}
            className="size-24 shrink-0 rounded-full object-cover"
          />
        ) : (
          <Avatar
            user={displayed}
            size={96}
            locale={locale}
            cacheKey={stamp ? String(stamp) : undefined}
          />
        )}

        <div className="flex flex-col gap-2">
          <form
            action={async (formData) => {
              const selected = fileRef.current?.files?.[0];
              if (selected) formData.set("avatar", await resizeAvatar(selected));
              upload(formData);
            }}
            className="flex flex-wrap items-center gap-2"
          >
            <input type="hidden" name="userId" value={user.id} />
            <input
              ref={fileRef}
              type="file"
              name="avatar"
              accept="image/png,image/jpeg,image/webp"
              aria-label={t("screens.profile.pictureFile")}
              className="text-[length:var(--text-sm)] text-muted file:me-3 file:rounded-(--radius-sm) file:border file:border-line-strong file:bg-surface file:px-3 file:py-1.5 file:text-[length:var(--text-sm)] file:text-ink"
              onChange={(event) => {
                const selected = event.target.files?.[0];
                setPreview(selected ? URL.createObjectURL(selected) : null);
              }}
            />
            <Button type="submit" size="sm" disabled={uploading}>
              {uploading ? t("screens.profile.uploading") : t("screens.profile.uploadPicture")}
            </Button>
          </form>

          {extension ? (
            <form action={remove}>
              <input type="hidden" name="userId" value={user.id} />
              <Button
                type="submit"
                variant="ghost"
                size="sm"
                disabled={removing}
              >
                {removing ? t("screens.profile.removing") : t("screens.profile.removePicture")}
              </Button>
            </form>
          ) : null}

          <p className="text-[length:var(--text-2xs)] text-faint">
            {t("screens.profile.pictureHint")}
          </p>
        </div>
      </div>

      {status ? <Alert tone="danger">{status}</Alert> : null}
      {success ? <Alert tone="success">{success}</Alert> : null}
    </div>
  );
}
