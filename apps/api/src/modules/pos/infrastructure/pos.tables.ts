import { Generated } from 'kysely';

/** Таблицы схемы pos. Модуль видит только их. */
export interface ProductMappingsTable {
  id: string;
  branch_id: string;
  dish_id: string;
  provider: string;
  external_product_id: string;
  external_name: string | null;
  modifier_mappings: unknown;
  created_at: Date;
  updated_at: Generated<Date>;
  deleted_at: Date | null;
}

export interface OrderExportsTable {
  id: string;
  order_id: string;
  order_number: string;
  branch_id: string;
  provider: string;
  status: string;
  pos_order_id: string | null;
  attempts: number;
  manual_retries: number;
  last_error: string | null;
  failure_reason: string | null;
  skip_reason: string | null;
  details: unknown;
  last_attempt_at: Date | null;
  sent_at: Date | null;
  failed_at: Date | null;
  created_at: Date;
  updated_at: Generated<Date>;
}

export interface StopListSnapshotsTable {
  branch_id: string;
  dish_id: string;
  provider: string;
  external_product_id: string;
  available: boolean;
  updated_at: Generated<Date>;
}

export interface ProductsTable {
  id: string;
  branch_id: string;
  provider: string;
  external_product_id: string;
  name: string;
  name_normalized: string;
  sku: string | null;
  kind: string;
  group_name: string | null;
  imported_at: Date;
  removed_at: Date | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface SyncStateTable {
  branch_id: string;
  stop_list_provider: string | null;
  stop_list_enqueued_at: Date | null;
  stop_list_attempted_at: Date | null;
  stop_list_synced_at: Date | null;
  stop_list_failures: Generated<number>;
  stop_list_error: string | null;
  stop_list_alerted_at: Date | null;
  stop_list_changes: Generated<number>;
  products_provider: string | null;
  products_requested_at: Date | null;
  products_imported_at: Date | null;
  products_count: number | null;
  products_error: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface PosTables {
  'pos.product_mappings': ProductMappingsTable;
  'pos.order_exports': OrderExportsTable;
  'pos.stop_list_snapshots': StopListSnapshotsTable;
  'pos.products': ProductsTable;
  'pos.sync_state': SyncStateTable;
}
