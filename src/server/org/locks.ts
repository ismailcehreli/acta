/**
 * Advisory lock shared with the org-tree trigger functions in the applied
 * migrations. The value is a database protocol identifier; changing it would
 * require a forward migration that replaces every trigger function using it.
 */
export const ORG_TREE_LOCK_KEY = "activity:org_tree";
