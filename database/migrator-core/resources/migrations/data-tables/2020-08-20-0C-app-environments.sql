alter table app_storage_access add column table_mapping_id int;

create index app_storage_access_table_mapping_id_idx
    on app_storage_access (table_mapping_id,table_id)
        where table_mapping_id is not null;

create index app_storage_access_app_id_idx
    on app_storage_access (app_id,table_id)
        where app_id is not null;
