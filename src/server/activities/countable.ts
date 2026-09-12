import type { Prisma } from "@prisma/client";


//


//




//

//





//     getirirdi.



export const UNCOUNTABLE_APPROVAL_STATUSES = ["CANCELLED", "REJECTED"] as const;


export function countableActivityWhere(): Prisma.ActivityWhereInput {
  return { approvalStatus: { notIn: [...UNCOUNTABLE_APPROVAL_STATUSES] } };
}
