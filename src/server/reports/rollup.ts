export interface OrgUnitTreeNode {
  id: string;
  parentId: string | null;
}

export interface RollupOptions<T> {
  createEmpty: () => T;
  clone: (value: T) => T;
  merge: (target: T, source: T) => void;
}

/** Organizasyon ağacını kökten aşağı yürüyüp sayaçları üst birimlere taşır. */
export function rollupByOrgUnit<T>(
  units: readonly OrgUnitTreeNode[],
  rootId: string,
  direct: ReadonlyMap<string, T>,
  options: RollupOptions<T>,
): Map<string, T> {
  const children = new Map<string | null, OrgUnitTreeNode[]>();
  for (const unit of units) {
    const siblings = children.get(unit.parentId) ?? [];
    siblings.push(unit);
    children.set(unit.parentId, siblings);
  }

  const totals = new Map<string, T>();
  const visit = (unitId: string): T => {
    const own = direct.get(unitId) ?? options.createEmpty();
    const total = options.clone(own);
    for (const child of children.get(unitId) ?? []) {
      options.merge(total, visit(child.id));
    }
    totals.set(unitId, total);
    return total;
  };

  if (units.some((unit) => unit.id === rootId)) visit(rootId);
  return totals;
}
