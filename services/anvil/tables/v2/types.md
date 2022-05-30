Types:
(a weird mixture of Python and TypeScript typing)
======
ViewKey: str
<!-- we need this to determine where to look in the TableData for linked rows -->

ViewDict: {id: int, perm?: str, cols?: list[str], restrict: object}
<!-- restriction api and formats to be determined -->
TableCapScope: ["*", "t", ViewDict] # res is for restrictions but i don't love that
TableCap: Capability(TableCapScope)

SerachCap: TBD
SearchCapNext: TBD

RowCapScope: [...TableCapScope, {r: int}]
RowCap: Capability(RowCapScope) 

ColSpec = {name: str, type: str, table_id?: int, view_key?: str}
<!-- # table_id and view_key are only relevant for linked rows -->
<!-- # the view_key is always required if the table_id is given -->
<!-- # NOTE - In the new table data structure we can change this to only have a view_key - a table_id isn't required anymore.
    It was previously only used to lookup a linked row in the datatable - but now the viewkey encompasses this.
    
    (But it might be useful for convenience 
    - if we implement the row.table_id api 
    - BUT we can always get the table_id from the cap if we need it so...
) -->

CacheSpec: (0 | 1)[]
<!-- 
# 1 represents the data is cached, 0 otherwise
# len(CacheSpec) must match len(ColSpec[])
# The order must be consistent 
-->
LinkedRow: int
LinedRows: int[]
RowData: (any | LinkedRow | LinkedRows)[]                           
CompactRowData: [...RowData, RowCap]     <!-- # RowData len should match the Number of 1s in the CacheSpec -->
NonCompactRowData: [...RowData, RowCap]  <!-- # RowData len should match the len of ColSpec[] -->

<!-- # Private server calls always return CompactData -->
<!-- # If the cols are restricted the ColSpec[] will be restricted to match -->

TableData: {
    [view_key: str]: {
        spec: {
            name: str,
            cols: ColSpec[],
            cache: CacheSpec,
        },
        rows: {
            [row_id: str]: CompactRowData | NonCompactRowData,
        }
    }
}

view_key is a JSON-serialised ViewKey:
ViewKey: {
    id: int,
    perm?: str, <!-- # Absence means default -->
    cols?: list[str], <!-- # Absence means "all columns" -->
    restrict: object, <!-- # Opaque query object -->
}


<!-- When Serializing -->
GlobalData: {
    _tbl: TableData
}

CapNext: Capability([...TableCapScope, TBD]) | None
KnownPerm: ["ro", "rw", "rwc"]

class RowRef:
    <!-- # sent to private server calls in place of a Row -->
    cap: RowCap


class SearchIteratorRef:
    <!-- # sent to private server calls in place of a Row -->
    cap: SearchCap


