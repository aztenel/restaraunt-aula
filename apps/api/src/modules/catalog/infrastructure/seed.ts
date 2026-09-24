import { RequestContext } from '../../../shared/infrastructure/context/request-context';
import { ModuleSeeder, SeedContext } from '../../../shared/infrastructure/seed/seed.types';
import { Actor } from '../../../shared/kernel/actor';
import { Money } from '../../../shared/kernel/money';
import { BranchDirectory } from '../../identity/public';
import { AddDishToBranchMenu } from '../application/branch-menu.actions';
import { CreateCategory } from '../application/category.actions';
import { CreateBanner, CreatePage, CreatePromotion } from '../application/content.actions';
import { CreateDish } from '../application/dish.actions';
import { CreateModifierGroup } from '../application/modifier.actions';
import { SetDishAvailability } from '../application/stop-list.actions';
import { BranchMenuRepository } from './branch-menu.repository';
import { CategoryRepository } from './category.repository';
import { BannerRepository, PageRepository, PromotionRepository } from './content.repository';
import { DishRepository } from './dish.repository';
import { ModifierRepository } from './modifier.repository';
import { SEED_BANNERS, SEED_CATEGORIES, SEED_DISHES, SEED_MODIFIER_GROUPS, SEED_PROMOTIONS } from './seed-menu';
import { contactsPage, SeedBranchContact, SeedPage, STATIC_PAGES } from './seed-pages';

/**
 * Сид Catalog. Идемпотентен: поиск по естественным ключам (slug страниц, категорий, блюд, акций;
 * code групп модификаторов; пара филиал+блюдо в меню). Существующие записи не перезаписываются —
 * правки контент-менеджера сохраняются.
 * Всегда: статические страницы (о нас, доставка, оплата, оферта, политика конфиденциальности, контакты).
 * Демо: меню AULA (казахская и европейская кухня) с ценами по филиалам, модификаторы, баннеры, акции.
 */
export const seedCatalog: ModuleSeeder = async (ctx) => {
  await RequestContext.runAsSystem('seed:catalog', async () => {
    const actor = Actor.system('seed');
    await seedPages(ctx, actor);
    if (ctx.demo) await seedDemoMenu(ctx, actor);
  });
};

async function seedPages(ctx: SeedContext, actor: Actor): Promise<void> {
  const pages = ctx.app.get(PageRepository);
  const createPage = ctx.app.get(CreatePage);
  const branchDirectory = ctx.app.get(BranchDirectory);
  const contacts: SeedBranchContact[] = [];
  for (const branchId of Object.values(ctx.branches)) {
    const branch = await branchDirectory.find(branchId);
    if (branch) contacts.push({ name: branch.name, address: branch.address, phone: branch.phone, whatsapp: branch.whatsapp });
  }
  const all: SeedPage[] = [...STATIC_PAGES, contactsPage(contacts)];
  for (const page of all) {
    if (await pages.findBySlug(page.slug)) continue;
    await createPage.execute(actor, {
      slug: page.slug,
      title: page.title,
      body: page.body,
      seoDescription: page.seoDescription,
      isPublished: true,
      sortOrder: page.sortOrder,
    });
    ctx.log(`Страница /${page.slug} создана`);
  }
}

async function seedDemoMenu(ctx: SeedContext, actor: Actor): Promise<void> {
  const categoriesRepo = ctx.app.get(CategoryRepository);
  const dishesRepo = ctx.app.get(DishRepository);
  const modifiersRepo = ctx.app.get(ModifierRepository);
  const branchMenu = ctx.app.get(BranchMenuRepository);

  const categoryIds = new Map<string, string>();
  for (const c of SEED_CATEGORIES) {
    const existing = await categoriesRepo.findBySlug(c.slug);
    const id =
      existing?.id ??
      (await ctx.app.get(CreateCategory).execute(actor, { slug: c.slug, name: c.name, description: c.description, sortOrder: c.sortOrder }));
    categoryIds.set(c.slug, id);
  }

  const groupIds = new Map<string, string>();
  for (const g of SEED_MODIFIER_GROUPS) {
    const existing = await modifiersRepo.findByCode(g.code);
    const id =
      existing?.id ??
      (await ctx.app.get(CreateModifierGroup).execute(actor, {
        code: g.code,
        name: g.name,
        minSelect: g.minSelect,
        maxSelect: g.maxSelect,
        sortOrder: g.sortOrder,
        options: g.options.map((o, i) => ({ name: o.name, price: Money.tenge(o.priceTenge), isDefault: o.isDefault ?? false, sortOrder: (i + 1) * 10 })),
      }));
    groupIds.set(g.code, id);
  }

  let created = 0;
  let added = 0;
  for (const [index, d] of SEED_DISHES.entries()) {
    let dishId = (await dishesRepo.findBySlug(d.slug))?.id;
    if (!dishId) {
      dishId = await ctx.app.get(CreateDish).execute(actor, {
        slug: d.slug,
        categoryId: categoryIds.get(d.category)!,
        name: d.name,
        description: d.description,
        composition: d.composition,
        weightGrams: d.weightGrams,
        calories: d.calories,
        isVegetarian: d.isVegetarian ?? false,
        spicyLevel: d.spicyLevel ?? 0,
        isHalal: true,
        allergens: d.allergens ?? [],
        sku: d.sku,
        sortOrder: (index + 1) * 10,
        modifierGroupIds: (d.modifiers ?? []).map((code) => groupIds.get(code)!),
      });
      created++;
    }
    for (const [branchSlug, priceTenge] of Object.entries(d.prices)) {
      const branchId = ctx.branches[branchSlug];
      if (!branchId || priceTenge === null) continue;
      if (await branchMenu.find(branchId, dishId)) continue;
      await ctx.app.get(AddDishToBranchMenu).execute(actor, branchId, { dishId, price: Money.tenge(priceTenge) });
      added++;
      // Пример стоп-листа: шубат в Garden View временно без поставки.
      if (d.slug === 'shubat' && branchSlug === 'garden-view') {
        await ctx.app.get(SetDishAvailability).execute(actor, {
          branchId,
          dishId,
          available: false,
          reason: 'Нет поставки шубата',
          source: 'manual',
        });
      }
    }
  }
  ctx.log(`Демо-меню: блюд создано ${created}, позиций в меню филиалов добавлено ${added}`);

  const banners = ctx.app.get(BannerRepository);
  if ((await banners.count()) === 0) {
    for (const b of SEED_BANNERS) {
      const branchId = b.branch ? ctx.branches[b.branch] : null;
      if (b.branch && !branchId) continue;
      await ctx.app.get(CreateBanner).execute(actor, {
        placement: b.placement,
        branchId: branchId ?? null,
        title: b.title,
        subtitle: b.subtitle,
        ctaLabel: b.ctaLabel,
        linkUrl: b.linkUrl,
        sortOrder: b.sortOrder,
      });
    }
    ctx.log(`Демо-баннеры созданы: ${SEED_BANNERS.length}`);
  }

  const promotions = ctx.app.get(PromotionRepository);
  for (const p of SEED_PROMOTIONS) {
    if (await promotions.findBySlug(p.slug)) continue;
    await ctx.app.get(CreatePromotion).execute(actor, {
      slug: p.slug,
      title: p.title,
      description: p.description,
      terms: p.terms,
      branchIds: p.branches.map((slug) => ctx.branches[slug]).filter((id): id is string => !!id),
      sortOrder: p.sortOrder,
    });
    ctx.log(`Акция ${p.slug} создана`);
  }
}
