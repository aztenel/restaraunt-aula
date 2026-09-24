import { Generated, GeneratedAlways } from 'kysely';

/** Таблицы схемы catalog. Модуль видит только их. jsonb пишется строкой JSON, читается объектом. */
export interface CategoriesTable {
  id: string;
  slug: string;
  name: unknown;
  description: unknown;
  seo_title: unknown;
  seo_description: unknown;
  image: unknown | null;
  sort_order: number;
  is_active: boolean;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  deleted_at: Date | null;
}

export interface DishesTable {
  id: string;
  slug: string;
  category_id: string;
  name: unknown;
  description: unknown;
  composition: unknown;
  seo_title: unknown;
  seo_description: unknown;
  weight_grams: number | null;
  calories: number | null;
  is_vegetarian: boolean;
  spicy_level: number;
  is_halal: boolean;
  allergens: string[];
  sku: string | null;
  sort_order: number;
  is_active: boolean;
  search_vector: GeneratedAlways<string>;
  search_text: GeneratedAlways<string>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  deleted_at: Date | null;
}

export interface DishPhotosTable {
  id: string;
  dish_id: string;
  sort_order: number;
  variants: unknown;
  alt: unknown;
  created_at: Generated<Date>;
  deleted_at: Date | null;
}

export interface ModifierGroupsTable {
  id: string;
  code: string;
  name: unknown;
  description: unknown;
  min_select: number;
  max_select: number;
  sort_order: number;
  is_active: boolean;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  deleted_at: Date | null;
}

export interface ModifierOptionsTable {
  id: string;
  group_id: string;
  name: unknown;
  price_amount: number;
  price_currency: string;
  is_default: boolean;
  sort_order: number;
  is_active: boolean;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  deleted_at: Date | null;
}

export interface DishModifierGroupsTable {
  dish_id: string;
  group_id: string;
  sort_order: number;
}

export interface BranchMenuItemsTable {
  id: string;
  branch_id: string;
  dish_id: string;
  price_amount: number;
  price_currency: string;
  availability: string;
  stopped_until: Date | null;
  stop_reason: string | null;
  stop_source: string | null;
  stopped_at: Date | null;
  sku: string | null;
  updated_by: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  deleted_at: Date | null;
}

export interface BannersTable {
  id: string;
  placement: string;
  branch_id: string | null;
  title: unknown;
  subtitle: unknown;
  cta_label: unknown;
  link_url: string | null;
  image: unknown | null;
  active_from: Date | null;
  active_to: Date | null;
  sort_order: number;
  is_active: boolean;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  deleted_at: Date | null;
}

export interface PromotionsTable {
  id: string;
  slug: string;
  title: unknown;
  description: unknown;
  terms: unknown;
  seo_title: unknown;
  seo_description: unknown;
  image: unknown | null;
  valid_from: Date | null;
  valid_to: Date | null;
  branch_ids: string[];
  sort_order: number;
  is_active: boolean;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  deleted_at: Date | null;
}

export interface PagesTable {
  id: string;
  slug: string;
  title: unknown;
  body: unknown;
  seo_title: unknown;
  seo_description: unknown;
  is_published: boolean;
  sort_order: number;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  deleted_at: Date | null;
}

export interface CatalogTables {
  'catalog.categories': CategoriesTable;
  'catalog.dishes': DishesTable;
  'catalog.dish_photos': DishPhotosTable;
  'catalog.modifier_groups': ModifierGroupsTable;
  'catalog.modifier_options': ModifierOptionsTable;
  'catalog.dish_modifier_groups': DishModifierGroupsTable;
  'catalog.branch_menu_items': BranchMenuItemsTable;
  'catalog.banners': BannersTable;
  'catalog.promotions': PromotionsTable;
  'catalog.pages': PagesTable;
}
