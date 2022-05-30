Server Calls
============
get_app_tables:
    returns:
        {[name: str]: TableCap}

get_table_by_id:
    description:
        Typically used for functions that are generic for Row updating.
        Clean up of table_id and typeerrors. canalso be thrown on the client instead.
    args:
        table_id: int | str
    returns:
        TableCap, ViewKey
    throws:
        if invalid table_id




Table Server Calls
==================
table.get_view:
    args:
        cap: TableCap
        view_type: ViewType
        kws: dict[str, ANY]
    returns:
        TableCap, ViewKey
    considerations:
        the view in the TableCap can be arbirtrary
        but ideally the view should propogate to linked rows
        current implementation expects that the {view: view_key} (part of the TableCap)
        will match for this row and all linked rows
        The view doesn't have to be the thing that matches - but something has to match.
        
        
table.delete_all_rows:   
    args:
        cap: TableCap
    returns:
        None
    throws:
        If cap is not valid
    considerations:
        If a row exists in python it will still use it's cached values despite being deleted from this call.
        Not much we can do about it.

table.add_row:
    args:
        cap: TableCap
        kws: dict[str, ANY]
    returns:
        [row_id: int, table_data: TableData]

table.get_row:
    args:
        cap: TableCap
        args: list[ANY]
        kws: dict[str, ANY]
    returns:
        None | [row_id: int, table_data: TableData]
    throws:
        Retain current behavior: Throw if multiple rows found

table.get_row_by_id:
    args:
        cap: TableCap
        row_id: int | str
    returns:
        [row_id: int, table_data: TableData]
        or None if row_id does not exist
    considerations:
        Old and new formats supported.
        TypeErrors could be thrown if the id format is not valid
        TypeErrors could be thrown in python

table.has_row:
    args:
        cap: TableCap
        row: row_id
    return:
        bool
    considerations:
        should support a row_id or a row. If python is given a row it will get the row_id.
        Old and new formats supported

table.list_columns:
    args:
        cap: TableCap
    returns:
        ColSpec 
        # should include table_id of linked rows or the table name - currently not available
        # https://anvil.works/forum/t/get-app-table-table-object-by-table-id/3947
        # https://anvil.works/forum/t/dynamic-serialisation-of-data-table-rows/4105

table.search:
    args:
        cap: TableCap
        args: tuple[any]
        kws: dict[str, Any]
    returns:
        [row_ids: list[int], cap: SearchCap, cap_next: SearchCapNext, table_data: TableData]
    considerations:
        at this point the implementation expects to have RowCaps in the view_data
        The discussion in the doc about optimizing this call and creating narrowed caps in python as needed as not been implemented.
        I've kept the optimization in my head so that it's relatively straight forward to implement.

table.to_csv:
    args:
        cap: TableCap
    returns:
        MediaObject


Search Server Calls
===================
search.next_page:
    args:
        cap_next: SearchCapNext
    returns:
        [row_ids: list[int], cap_next: SearchCapNext, table_data: TableData]
    considerations:
        None for cap_next signals no next page

search.slice:
    args:
        search_cap: SearchCap
        start: None | int
        stop: None | int
        step: None | int
    returns:
        [row_ids: list[int], cap: SearchCap, cap_next: SearchCapNext, table_data: TableData]
    considerations:
        The fast case search_iter[:] is taken care of in python.
        Type checking the slice values types can be done on the client

        We might be able to do the case where our cap_next is None on the client,
        however I think we'd need a new cap if we want to_csv to work on a sliced SearchIterator.

search.index:
    <!-- used for __getitem__ e.g. foo.search()[100] -->
    args:
        search_cap: SearchCap
        index: int
    returns:
        [row_id: int, table_data: TableData]
    considerations:
        the fast case can be done in python - i.e. the index is on the first page
        Or our cap_next is None

search.to_csv:
    args:
        search_cap: SearchCap
    returns:
        MediaObject

search.get_length:
    args:
        search_cap: SearchCap
    return:
        int




Row Server Calls
================
row.fetch:
    args:
        cap: RowCap
    returns:
        [server_updates: {[col_name: str], val: any}, TableData | None]
    considerations:
        usual case is that simple objects are the only uncached value
        but anything could be uncached
        for LinkedRows the val should be the row_id. The returned TableData will allow us to build the LinkedRow 
        If TableData is None there are no linked rows to build.
        
row.update:
    args:
        cap: RowCap
        new_items: dict[str, val]
    returns:
        [server_updates: {[col_name: str], val: any}, TableData | None]
    consideration:
        The return value is the same as fetch.

        The returned server_updates will be merged with the local new_items.
        If the local new_items is accurate then server_items can be an empty dict.

        Any LinkedRows/LinkedRow[] from new_items will be converted to RowRefs/RowRef[].
        TableData should only be returned if the RowRef caps do not match the expected caps of the linked Rows.
        e.g. an EnumTable LinkedRow with "rw" capability being assigned to the column of a Row with "ro" capabilities.
        It's important to have correct caps on our LinkedRows so that we can create accurate table data for serialize/deserialize methods.

        In this case the server_update dict might look like:
        {'enum_col', row_id}
        The TableData returned will then be used to construct the LinkedRow.

        Another situation might be datetime objects - given the difference in the tz_info?

row.delete:
    args:
        cap: RowCap
    returns:
        RowDeletedCap # maybe
    considerations:
        changing the cap to signal this has been deleted might be a useful flag when a server call is made on a deleted row.
        however - since a table could delete all it's rows and there could still be live rows in python we can't rely on flags.        

