import { cookies } from "next/headers";

import {
  DEFAULT_PAGE_SIZE,
  PAGE_SIZE_COOKIE,
  normalizePageSize,
  type PageSize,
} from "@/shared/page-size";


//




//



export { PAGE_SIZE_COOKIE };


export async function resolvePageSize(
  fromQuery: string | undefined,
): Promise<PageSize> {
  const queryValue = normalizePageSize(fromQuery);
  if (queryValue) return queryValue;

  const store = await cookies();
  return normalizePageSize(store.get(PAGE_SIZE_COOKIE)?.value) ?? DEFAULT_PAGE_SIZE;
}
