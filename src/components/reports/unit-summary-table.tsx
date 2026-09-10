import type { ReactNode } from "react";

import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

export interface UnitSummaryRow {
  id: string;
  name: string;
  depth: number;
}

export interface UnitSummaryColumn<Row extends UnitSummaryRow> {
  key: string;
  header: ReactNode;
  align?: "left" | "right" | "center";
  className?: string;
  render: (row: Row) => ReactNode;
}

export function UnitSummaryTable<Row extends UnitSummaryRow>({
  label,
  rows,
  columns,
}: {
  label: string;
  rows: readonly Row[];
  columns: readonly UnitSummaryColumn<Row>[];
}) {
  return (
    <Table label={label}>
      <THead>
        <TR>
          {columns.map((column) => (
            <TH key={column.key} align={column.align}>
              {column.header}
            </TH>
          ))}
        </TR>
      </THead>
      <TBody>
        {rows.map((row) => (
          <TR key={row.id}>
            {columns.map((column) => (
              <TD key={column.key} align={column.align} className={column.className}>
                {column.render(row)}
              </TD>
            ))}
          </TR>
        ))}
      </TBody>
    </Table>
  );
}
