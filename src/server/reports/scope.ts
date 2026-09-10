import type {
  ReportScope,
  ReportScopeUnit,
} from "@/server/authz/visibility";

/** Seçilen birim rapor kapsamını kendi alt ağacına daraltır. */
export function narrowReportScope(
  scope: ReportScope,
  selectedUnitId?: string,
): ReportScope | null {
  if (!selectedUnitId) return scope;
  if (!scope.unitIds.includes(selectedUnitId)) return null;

  const children = new Map<string | null, ReportScopeUnit[]>();
  for (const unit of scope.units) {
    const list = children.get(unit.parentId) ?? [];
    list.push(unit);
    children.set(unit.parentId, list);
  }

  const selected = scope.units.find((unit) => unit.id === selectedUnitId);
  if (!selected) return null;

  const ids = new Set<string>();
  const visit = (unitId: string): void => {
    if (ids.has(unitId)) return;
    ids.add(unitId);
    for (const child of children.get(unitId) ?? []) visit(child.id);
  };
  visit(selectedUnitId);

  const units = scope.units
    .filter((unit) => ids.has(unit.id))
    .map((unit) => ({ ...unit, depth: unit.depth - selected.depth }));
  const people = scope.people.filter((person) => ids.has(person.orgUnitId));

  return {
    ...scope,
    rootOrgUnitId: selected.id,
    rootOrgUnitName: selected.name,
    unitIds: units.map((unit) => unit.id),
    userIds: people.map((person) => person.id),
    people,
    units,
  };
}
