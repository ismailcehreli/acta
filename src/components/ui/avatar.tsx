import { avatarToneIndex } from "@/shared/format/avatar-tone";
import { initials } from "@/shared/format/avatar-initials";
import { DEFAULT_LOCALE, type Locale } from "@/shared/i18n";


//



//


// The same initials tone is stable for a person and can be rendered in any
// supported locale.

const AVATAR_TONES = [
  "bg-avatar-0",
  "bg-avatar-1",
  "bg-avatar-2",
  "bg-avatar-3",
  "bg-avatar-4",
  "bg-avatar-5",
] as const;

export interface AvatarUser {
  id: string;
  fullName: string;

  avatarExtension?: string | null;
}

export function Avatar({
  user,
  size = 32,
  className = "",
  cacheKey,
  locale = DEFAULT_LOCALE,
}: {
  user: AvatarUser;

  size?: number;
  className?: string;

  cacheKey?: string;
  locale?: Locale;
}) {
  const dimensions = { width: size, height: size };
  const sharedClassName = `shrink-0 rounded-full object-cover ${className}`;

  if (user.avatarExtension) {
    return (
      // `next/image` is not used: the source is an authorization-controlled
      // endpoint. The endpoint and dimensions are fixed, and an image optimizer
      // would bypass its custom cache headers.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={`/api/users/${user.id}/avatar${cacheKey ? `?v=${cacheKey}` : ""}`}
        alt=""
        aria-hidden
        style={dimensions}
        className={`${sharedClassName} bg-inset`}
        loading="lazy"
        decoding="async"
      />
    );
  }

  const initialsText = initials(user.fullName, locale);
  const tone = AVATAR_TONES[avatarToneIndex(user.id)] ?? AVATAR_TONES[0];

  return (
    <span
      aria-hidden
      style={{ ...dimensions, fontSize: Math.max(10, Math.round(size * 0.38)) }}
      className={`grid place-items-center font-semibold text-white ${tone} ${sharedClassName}`}
    >
      {initialsText || "?"}
    </span>
  );
}
