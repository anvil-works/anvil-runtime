
CREATE TABLE anvil_config (
  key text primary key,
  value jsonb
);

--[GRANTS]--
GRANT ALL ON anvil_config TO $ANVIL_USER;
--[/GRANTS]--
