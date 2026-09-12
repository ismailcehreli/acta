import type { Prisma } from "@prisma/client";


//


//




//

//





//     would count the activity.



export const UNCOUNTABLE_APPROVAL_STATUSES = ["CANCELLED", "REJECTED"] as const;


export function countableActivityWhere(): Prisma.ActivityWhereInput {
  return { approvalStatus: { notIn: [...UNCOUNTABLE_APPROVAL_STATUSES] } };
}
