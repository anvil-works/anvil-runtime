CREATE OR REPLACE FUNCTION get_lo_size(oid) RETURNS bigint
VOLATILE STRICT
LANGUAGE 'plpgsql'
AS $$
DECLARE
    fd integer;
    sz bigint;
BEGIN
    -- Open the LO; N.B. it needs to be in a transaction otherwise it will close immediately.
    -- Luckily a function invocation makes its own transaction if necessary.
    -- The mode x'40000'::int corresponds to the PostgreSQL LO mode INV_READ = 0x40000.
    fd := lo_open($1, x'40000'::int);
    -- Seek to the end.  2 = SEEK_END.
    PERFORM lo_lseek64(fd, 0, 2);
    -- Fetch the current file position; since we're at the end, this is the size.
    sz := lo_tell64(fd);
    -- Remember to close it, since the function may be called as part of a larger transaction.
    PERFORM lo_close(fd);
    -- Return the size.
    RETURN sz;
END;
$$; 

--[GRANTS]--
GRANT EXECUTE ON FUNCTION get_lo_size TO $ANVIL_USER;
--[/GRANTS]--