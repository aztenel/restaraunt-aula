import { PlaceholderPage } from '../common/PlaceholderPage';

// TODO(catalog): категории, блюда (TranslatableInput), цены по филиалам (MoneyInput), стоп-лист, модификаторы,
//   контент витрины (баннеры, тексты, страницы).
export function MenuPage() {
  return (
    <PlaceholderPage
      section="menu"
      endpoints={[
        { method: 'GET', path: '/api/v1/admin/catalog/categories' },
        { method: 'GET', path: '/api/v1/admin/catalog/dishes?categoryId=&q=' },
        { method: 'PUT', path: '/api/v1/admin/catalog/dishes/{id}' },
        { method: 'PUT', path: '/api/v1/admin/catalog/branches/{branchId}/prices', note: 'цены филиала в тиынах' },
        { method: 'PUT', path: '/api/v1/admin/catalog/branches/{branchId}/stop-list/{dishId}' },
        { method: 'GET', path: '/api/v1/admin/content/pages', note: 'тексты витрины' },
      ]}
    />
  );
}
