import { Translatable } from '../../../shared/kernel/translatable';

/**
 * Демо-меню AULA: казахская и европейская кухня. Цены — в тенге, ориентир для Астаны на 2026 год
 * (ресторан среднего+ сегмента); в Garden View часть позиций немного дороже. Названия kk + ru.
 * Реальное меню, фото и переводы предоставляет заказчик (открытый вопрос ТЗ про контент).
 */
export interface SeedCategory {
  slug: string;
  name: Translatable;
  description: Translatable;
  sortOrder: number;
}

export interface SeedOption {
  name: Translatable;
  priceTenge: number;
  isDefault?: boolean;
}

export interface SeedModifierGroup {
  code: string;
  name: Translatable;
  minSelect: number;
  maxSelect: number;
  sortOrder: number;
  options: SeedOption[];
}

export interface SeedDish {
  slug: string;
  category: string;
  name: Translatable;
  description: Translatable;
  composition: Translatable;
  weightGrams: number | null;
  calories: number | null;
  isVegetarian?: boolean;
  spicyLevel?: number;
  allergens?: string[];
  modifiers?: string[];
  sku: string;
  /** Цена, ₸: GreenLine Aqua / Garden View (null — блюда нет в меню филиала). */
  prices: { greenline: number | null; 'garden-view': number | null };
}

export const SEED_CATEGORIES: SeedCategory[] = [
  {
    slug: 'salaty',
    sortOrder: 10,
    name: { ru: 'Салаты', kk: 'Салаттар' },
    description: { ru: 'Свежие салаты и закуски', kk: 'Жаңа салаттар мен тіскебасарлар' },
  },
  {
    slug: 'supy',
    sortOrder: 20,
    name: { ru: 'Супы', kk: 'Сорпалар' },
    description: { ru: 'Наваристые супы на домашнем бульоне', kk: 'Үй сорпасындағы құнарлы көжелер' },
  },
  {
    slug: 'kazakhskaya-kukhnya',
    sortOrder: 30,
    name: { ru: 'Казахская кухня', kk: 'Қазақ асханасы' },
    description: { ru: 'Бешбармак, казы, куырдак и манты по семейным рецептам', kk: 'Отбасылық рецепт бойынша бешбармақ, қазы, қуырдақ және манты' },
  },
  {
    slug: 'goryachie-blyuda',
    sortOrder: 40,
    name: { ru: 'Горячие блюда', kk: 'Ыстық тағамдар' },
    description: { ru: 'Лагман, плов, стейки и паста', kk: 'Лағман, палау, стейктер және паста' },
  },
  {
    slug: 'shashlyk',
    sortOrder: 50,
    name: { ru: 'Шашлык и гриль', kk: 'Шашлық және гриль' },
    description: { ru: 'Мясо и овощи на мангале', kk: 'Мангалда пісірілген ет пен көкөністер' },
  },
  {
    slug: 'vypechka',
    sortOrder: 60,
    name: { ru: 'Выпечка', kk: 'Нан-тоқаш' },
    description: { ru: 'Баурсаки и лепёшки из тандыра', kk: 'Бауырсақ және тандыр нан' },
  },
  {
    slug: 'deserty',
    sortOrder: 70,
    name: { ru: 'Десерты', kk: 'Десерттер' },
    description: { ru: 'Восточные и европейские сладости', kk: 'Шығыс және еуропа тәттілері' },
  },
  {
    slug: 'napitki',
    sortOrder: 80,
    name: { ru: 'Напитки', kk: 'Сусындар' },
    description: { ru: 'Кумыс, шубат, чай и домашние лимонады', kk: 'Қымыз, шұбат, шай және үй лимонадтары' },
  },
];

export const SEED_MODIFIER_GROUPS: SeedModifierGroup[] = [
  {
    code: 'razmer-porcii',
    sortOrder: 10,
    name: { ru: 'Размер порции', kk: 'Порция көлемі' },
    minSelect: 1,
    maxSelect: 1,
    options: [
      { name: { ru: 'Стандартная', kk: 'Стандартты' }, priceTenge: 0, isDefault: true },
      { name: { ru: 'Большая (+50%)', kk: 'Үлкен (+50%)' }, priceTenge: 1900 },
    ],
  },
  {
    code: 'sous',
    sortOrder: 20,
    name: { ru: 'Соус', kk: 'Тұздық' },
    minSelect: 0,
    maxSelect: 2,
    options: [
      { name: { ru: 'Томатный', kk: 'Қызанақ тұздығы' }, priceTenge: 300 },
      { name: { ru: 'Чесночный', kk: 'Сарымсақ тұздығы' }, priceTenge: 300 },
      { name: { ru: 'Острая аджика', kk: 'Ащы аджика' }, priceTenge: 350 },
      { name: { ru: 'Сметана', kk: 'Қаймақ' }, priceTenge: 300 },
    ],
  },
  {
    code: 'dop-baursaki',
    sortOrder: 30,
    name: { ru: 'Добавки', kk: 'Қосымшалар' },
    minSelect: 0,
    maxSelect: 3,
    options: [
      { name: { ru: 'Баурсаки, 5 шт.', kk: 'Бауырсақ, 5 дана' }, priceTenge: 700 },
      { name: { ru: 'Лепёшка из тандыра', kk: 'Тандыр нан' }, priceTenge: 500 },
      { name: { ru: 'Маринованный лук', kk: 'Маринадталған пияз' }, priceTenge: 200 },
    ],
  },
  {
    code: 'garnir-k-shashlyku',
    sortOrder: 40,
    name: { ru: 'Гарнир', kk: 'Гарнир' },
    minSelect: 1,
    maxSelect: 1,
    options: [
      { name: { ru: 'Лук и зелень', kk: 'Пияз бен көк' }, priceTenge: 0, isDefault: true },
      { name: { ru: 'Картофель фри', kk: 'Фри картобы' }, priceTenge: 900 },
      { name: { ru: 'Рис с овощами', kk: 'Көкөніс қосылған күріш' }, priceTenge: 800 },
    ],
  },
  {
    code: 'obem-chaynika',
    sortOrder: 50,
    name: { ru: 'Объём', kk: 'Көлемі' },
    minSelect: 1,
    maxSelect: 1,
    options: [
      { name: { ru: 'Чайник 0,6 л', kk: 'Шәйнек 0,6 л' }, priceTenge: 0, isDefault: true },
      { name: { ru: 'Чайник 1 л', kk: 'Шәйнек 1 л' }, priceTenge: 700 },
    ],
  },
  {
    code: 'obem-limonada',
    sortOrder: 60,
    name: { ru: 'Объём', kk: 'Көлемі' },
    minSelect: 1,
    maxSelect: 1,
    options: [
      { name: { ru: 'Стакан 0,4 л', kk: 'Стақан 0,4 л' }, priceTenge: 0, isDefault: true },
      { name: { ru: 'Кувшин 1 л', kk: 'Құмыра 1 л' }, priceTenge: 1900 },
    ],
  },
];

export const SEED_DISHES: SeedDish[] = [
  // ---------------------------------------------------------------- Салаты
  {
    slug: 'achichuk',
    category: 'salaty',
    sku: 'AULA-101',
    name: { ru: 'Ачичук', kk: 'Ащы-шұқ' },
    description: { ru: 'Классический салат к плову и мясу', kk: 'Палау мен етке арналған классикалық салат' },
    composition: { ru: 'Помидоры, репчатый лук, острый перец, зелень', kk: 'Қызанақ, пияз, ащы бұрыш, көк' },
    weightGrams: 250,
    calories: 90,
    isVegetarian: true,
    spicyLevel: 1,
    prices: { greenline: 1900, 'garden-view': 1900 },
  },
  {
    slug: 'salat-s-kazy',
    category: 'salaty',
    sku: 'AULA-102',
    name: { ru: 'Салат с казы', kk: 'Қазы салаты' },
    description: { ru: 'Сытный салат с домашней конской колбасой', kk: 'Үйде жасалған жылқы шұжығымен тойымды салат' },
    composition: { ru: 'Казы, огурцы, яйцо, картофель, зелёный лук, домашний майонез', kk: 'Қазы, қияр, жұмыртқа, картоп, жуа, үй майонезі' },
    weightGrams: 250,
    calories: 420,
    allergens: ['eggs', 'mustard'],
    prices: { greenline: 3400, 'garden-view': 3600 },
  },
  {
    slug: 'cezar-s-kuricey',
    category: 'salaty',
    sku: 'AULA-103',
    name: { ru: 'Цезарь с курицей', kk: 'Тауық етімен Цезарь' },
    description: { ru: 'Романо, куриное филе гриль, пармезан и соус цезарь', kk: 'Романо, гриль тауық еті, пармезан және цезарь тұздығы' },
    composition: { ru: 'Салат романо, куриное филе, пармезан, гренки, соус цезарь', kk: 'Романо салаты, тауық еті, пармезан, кептірілген нан, цезарь тұздығы' },
    weightGrams: 280,
    calories: 450,
    allergens: ['gluten', 'eggs', 'milk', 'fish'],
    prices: { greenline: 3200, 'garden-view': 3400 },
  },
  {
    slug: 'grecheskiy',
    category: 'salaty',
    sku: 'AULA-104',
    name: { ru: 'Греческий', kk: 'Грек салаты' },
    description: { ru: 'Свежие овощи с фетой и оливками', kk: 'Фета мен зәйтүн қосылған жаңа көкөністер' },
    composition: { ru: 'Томаты, огурцы, болгарский перец, красный лук, фета, оливки, оливковое масло', kk: 'Қызанақ, қияр, тәтті бұрыш, қызыл пияз, фета, зәйтүн, зәйтүн майы' },
    weightGrams: 270,
    calories: 310,
    isVegetarian: true,
    allergens: ['milk'],
    prices: { greenline: 2600, 'garden-view': 2700 },
  },
  // ---------------------------------------------------------------- Супы
  {
    slug: 'sorpa',
    category: 'supy',
    sku: 'AULA-201',
    name: { ru: 'Сорпа', kk: 'Сорпа' },
    description: { ru: 'Крепкий бульон из баранины с зеленью', kk: 'Көк қосылған қою қой сорпасы' },
    composition: { ru: 'Бульон из баранины, лук, зелень, чёрный перец', kk: 'Қой етінің сорпасы, пияз, көк, қара бұрыш' },
    weightGrams: 400,
    calories: 180,
    prices: { greenline: 2400, 'garden-view': 2500 },
  },
  {
    slug: 'shurpa',
    category: 'supy',
    sku: 'AULA-202',
    name: { ru: 'Шурпа из баранины', kk: 'Қой етінен шорпа' },
    description: { ru: 'Густой суп с бараниной и овощами', kk: 'Қой еті мен көкөніс қосылған қою көже' },
    composition: { ru: 'Баранина, картофель, морковь, лук, томаты, болгарский перец, зелень', kk: 'Қой еті, картоп, сәбіз, пияз, қызанақ, тәтті бұрыш, көк' },
    weightGrams: 450,
    calories: 390,
    modifiers: ['dop-baursaki'],
    prices: { greenline: 3200, 'garden-view': 3300 },
  },
  {
    slug: 'kespe',
    category: 'supy',
    sku: 'AULA-203',
    name: { ru: 'Кеспе', kk: 'Кеспе' },
    description: { ru: 'Суп с домашней лапшой и говядиной', kk: 'Үй кеспесі мен сиыр еті қосылған көже' },
    composition: { ru: 'Говядина, домашняя лапша, морковь, лук, зелень', kk: 'Сиыр еті, үй кеспесі, сәбіз, пияз, көк' },
    weightGrams: 400,
    calories: 360,
    allergens: ['gluten', 'eggs'],
    prices: { greenline: 2900, 'garden-view': 3000 },
  },
  {
    slug: 'krem-sup-iz-tykvy',
    category: 'supy',
    sku: 'AULA-204',
    name: { ru: 'Крем-суп из тыквы', kk: 'Асқабақ крем-сорпасы' },
    description: { ru: 'Нежный суп-пюре со сливками и тыквенными семечками', kk: 'Кілегей мен асқабақ дәні қосылған нәзік пюре-көже' },
    composition: { ru: 'Тыква, сливки, лук, тыквенные семечки, специи', kk: 'Асқабақ, кілегей, пияз, асқабақ дәні, дәмдеуіштер' },
    weightGrams: 300,
    calories: 240,
    isVegetarian: true,
    allergens: ['milk'],
    prices: { greenline: 2400, 'garden-view': 2600 },
  },
  // ---------------------------------------------------------------- Казахская кухня
  {
    slug: 'beshbarmak',
    category: 'kazakhskaya-kukhnya',
    sku: 'AULA-301',
    name: { ru: 'Бешбармак', kk: 'Бешбармақ' },
    description: {
      ru: 'Главное блюдо казахского дастархана: отварная конина и баранина с тонким тестом и луком в сорпе',
      kk: 'Қазақ дастарханының басты тағамы: жұқа қамыр мен пияз қосылған пісірілген жылқы және қой еті, сорпамен',
    },
    composition: { ru: 'Конина, баранина, казы, тесто, лук, сорпа, чёрный перец', kk: 'Жылқы еті, қой еті, қазы, қамыр, пияз, сорпа, қара бұрыш' },
    weightGrams: 500,
    calories: 950,
    allergens: ['gluten', 'eggs'],
    modifiers: ['razmer-porcii', 'dop-baursaki'],
    prices: { greenline: 5900, 'garden-view': 6300 },
  },
  {
    slug: 'kazy',
    category: 'kazakhskaya-kukhnya',
    sku: 'AULA-302',
    name: { ru: 'Казы', kk: 'Қазы' },
    description: { ru: 'Домашняя колбаса из конины, нарезка', kk: 'Үйде жасалған жылқы шұжығы, туралған' },
    composition: { ru: 'Конина, конский жир, соль, чёрный перец, чеснок', kk: 'Жылқы еті, жылқы майы, тұз, қара бұрыш, сарымсақ' },
    weightGrams: 200,
    calories: 780,
    prices: { greenline: 4900, 'garden-view': 5200 },
  },
  {
    slug: 'kuyrdak',
    category: 'kazakhskaya-kukhnya',
    sku: 'AULA-303',
    name: { ru: 'Куырдак', kk: 'Қуырдақ' },
    description: { ru: 'Жаркое из баранины с субпродуктами и картофелем', kk: 'Қой еті мен ішек-қарын, картоп қосылған қуырдақ' },
    composition: { ru: 'Баранина, печень, сердце, картофель, лук, специи', kk: 'Қой еті, бауыр, жүрек, картоп, пияз, дәмдеуіштер' },
    weightGrams: 350,
    calories: 640,
    spicyLevel: 1,
    modifiers: ['dop-baursaki'],
    prices: { greenline: 4300, 'garden-view': 4500 },
  },
  {
    slug: 'manty',
    category: 'kazakhskaya-kukhnya',
    sku: 'AULA-304',
    name: { ru: 'Манты, 5 шт.', kk: 'Манты, 5 дана' },
    description: { ru: 'Сочные манты с говядиной и курдючным жиром на пару', kk: 'Сиыр еті мен құйрық май салынған, буға пісірілген шырынды манты' },
    composition: { ru: 'Тесто, говядина, курдючный жир, лук, специи', kk: 'Қамыр, сиыр еті, құйрық май, пияз, дәмдеуіштер' },
    weightGrams: 400,
    calories: 720,
    allergens: ['gluten', 'eggs'],
    modifiers: ['sous'],
    prices: { greenline: 3600, 'garden-view': 3800 },
  },
  // ---------------------------------------------------------------- Горячие блюда
  {
    slug: 'lagman',
    category: 'goryachie-blyuda',
    sku: 'AULA-401',
    name: { ru: 'Лагман гуйру', kk: 'Гуйру лағман' },
    description: { ru: 'Тянутая лапша с говядиной и овощами', kk: 'Сиыр еті мен көкөніс қосылған созба кеспе' },
    composition: { ru: 'Лапша ручной работы, говядина, болгарский перец, стручковая фасоль, томаты, чеснок', kk: 'Қолдан созылған кеспе, сиыр еті, тәтті бұрыш, бұршақ, қызанақ, сарымсақ' },
    weightGrams: 450,
    calories: 680,
    spicyLevel: 1,
    allergens: ['gluten', 'eggs'],
    modifiers: ['razmer-porcii'],
    prices: { greenline: 3400, 'garden-view': 3500 },
  },
  {
    slug: 'plov',
    category: 'goryachie-blyuda',
    sku: 'AULA-402',
    name: { ru: 'Плов с бараниной', kk: 'Қой етімен палау' },
    description: { ru: 'Плов в казане с бараниной, жёлтой морковью и нутом', kk: 'Қой еті, сары сәбіз және ноқат қосылған қазан палау' },
    composition: { ru: 'Рис девзира, баранина, жёлтая морковь, лук, нут, зира, барбарис', kk: 'Девзира күріші, қой еті, сары сәбіз, пияз, ноқат, зере, бөріқарақат' },
    weightGrams: 400,
    calories: 820,
    modifiers: ['razmer-porcii'],
    prices: { greenline: 3500, 'garden-view': 3600 },
  },
  {
    slug: 'steyk-ribay',
    category: 'goryachie-blyuda',
    sku: 'AULA-403',
    name: { ru: 'Стейк рибай', kk: 'Рибай стейк' },
    description: { ru: 'Мраморная говядина зернового откорма, прожарка на выбор', kk: 'Дәнмен бордақыланған мәрмәр сиыр еті, қуыру дәрежесі таңдауыңызша' },
    composition: { ru: 'Говядина рибай, соль, перец, розмарин, сливочное масло', kk: 'Рибай сиыр еті, тұз, бұрыш, розмарин, сары май' },
    weightGrams: 300,
    calories: 870,
    allergens: ['milk'],
    modifiers: ['sous'],
    prices: { greenline: 12900, 'garden-view': 13500 },
  },
  {
    slug: 'pasta-karbonara',
    category: 'goryachie-blyuda',
    sku: 'AULA-404',
    name: { ru: 'Паста карбонара с индейкой', kk: 'Күркетауық етімен карбонара пастасы' },
    description: { ru: 'Спагетти в сливочном соусе с копчёной индейкой (халал)', kk: 'Ысталған күркетауық еті қосылған кілегей тұздығындағы спагетти (халал)' },
    composition: { ru: 'Спагетти, копчёная индейка, сливки, желток, пармезан', kk: 'Спагетти, ысталған күркетауық еті, кілегей, сарысы, пармезан' },
    weightGrams: 320,
    calories: 740,
    allergens: ['gluten', 'eggs', 'milk'],
    prices: { greenline: 3600, 'garden-view': 3700 },
  },
  // ---------------------------------------------------------------- Шашлык
  {
    slug: 'shashlyk-iz-baraniny',
    category: 'shashlyk',
    sku: 'AULA-501',
    name: { ru: 'Шашлык из баранины', kk: 'Қой етінен шашлық' },
    description: { ru: 'Мякоть баранины на мангале, 1 шампур', kk: 'Мангалда пісірілген қой етінің жұмсағы, 1 шампур' },
    composition: { ru: 'Баранина, лук, зира, соль, перец', kk: 'Қой еті, пияз, зере, тұз, бұрыш' },
    weightGrams: 200,
    calories: 560,
    modifiers: ['garnir-k-shashlyku', 'sous'],
    prices: { greenline: 4200, 'garden-view': 4400 },
  },
  {
    slug: 'shashlyk-iz-govyadiny',
    category: 'shashlyk',
    sku: 'AULA-502',
    name: { ru: 'Шашлык из говядины', kk: 'Сиыр етінен шашлық' },
    description: { ru: 'Маринованная говяжья вырезка, 1 шампур', kk: 'Маринадталған сиыр жон еті, 1 шампур' },
    composition: { ru: 'Говядина, лук, специи', kk: 'Сиыр еті, пияз, дәмдеуіштер' },
    weightGrams: 180,
    calories: 420,
    modifiers: ['garnir-k-shashlyku', 'sous'],
    prices: { greenline: 3800, 'garden-view': 3900 },
  },
  {
    slug: 'shashlyk-iz-kuricy',
    category: 'shashlyk',
    sku: 'AULA-503',
    name: { ru: 'Шашлык из курицы', kk: 'Тауық етінен шашлық' },
    description: { ru: 'Куриное бедро в пряном маринаде, 1 шампур', kk: 'Хош иісті маринадтағы тауық жамбасы, 1 шампур' },
    composition: { ru: 'Куриное бедро, лук, паприка, специи', kk: 'Тауық жамбасы, пияз, паприка, дәмдеуіштер' },
    weightGrams: 200,
    calories: 390,
    spicyLevel: 1,
    modifiers: ['garnir-k-shashlyku', 'sous'],
    prices: { greenline: 2900, 'garden-view': 2900 },
  },
  {
    slug: 'ovoshchi-na-mangale',
    category: 'shashlyk',
    sku: 'AULA-504',
    name: { ru: 'Овощи на мангале', kk: 'Мангалдағы көкөністер' },
    description: { ru: 'Баклажаны, перец, томаты и шампиньоны на углях', kk: 'Шоққа пісірілген баклажан, бұрыш, қызанақ және саңырауқұлақ' },
    composition: { ru: 'Баклажан, болгарский перец, томаты, шампиньоны, зелень, чеснок', kk: 'Баклажан, тәтті бұрыш, қызанақ, саңырауқұлақ, көк, сарымсақ' },
    weightGrams: 250,
    calories: 140,
    isVegetarian: true,
    prices: { greenline: 2200, 'garden-view': null },
  },
  // ---------------------------------------------------------------- Выпечка
  {
    slug: 'baursaki',
    category: 'vypechka',
    sku: 'AULA-601',
    name: { ru: 'Баурсаки, 10 шт.', kk: 'Бауырсақ, 10 дана' },
    description: { ru: 'Пышные баурсаки к чаю и сорпе', kk: 'Шай мен сорпаға арналған үлпілдек бауырсақ' },
    composition: { ru: 'Мука, молоко, дрожжи, яйцо, сахар, масло', kk: 'Ұн, сүт, ашытқы, жұмыртқа, қант, май' },
    weightGrams: 250,
    calories: 820,
    isVegetarian: true,
    allergens: ['gluten', 'milk', 'eggs'],
    prices: { greenline: 1200, 'garden-view': 1300 },
  },
  {
    slug: 'tandyr-nan',
    category: 'vypechka',
    sku: 'AULA-602',
    name: { ru: 'Лепёшка из тандыра', kk: 'Тандыр нан' },
    description: { ru: 'Горячая лепёшка с кунжутом', kk: 'Күнжіт себілген ыстық нан' },
    composition: { ru: 'Мука, вода, дрожжи, соль, кунжут', kk: 'Ұн, су, ашытқы, тұз, күнжіт' },
    weightGrams: 200,
    calories: 520,
    isVegetarian: true,
    allergens: ['gluten', 'sesame'],
    prices: { greenline: 600, 'garden-view': 600 },
  },
  // ---------------------------------------------------------------- Десерты
  {
    slug: 'chak-chak',
    category: 'deserty',
    sku: 'AULA-701',
    name: { ru: 'Чак-чак', kk: 'Шақ-шақ' },
    description: { ru: 'Хрустящее тесто в медовом сиропе', kk: 'Бал шәрбатындағы қытырлақ қамыр' },
    composition: { ru: 'Мука, яйцо, мёд, сахар', kk: 'Ұн, жұмыртқа, бал, қант' },
    weightGrams: 150,
    calories: 560,
    isVegetarian: true,
    allergens: ['gluten', 'eggs'],
    prices: { greenline: 1800, 'garden-view': 1900 },
  },
  {
    slug: 'zhent',
    category: 'deserty',
    sku: 'AULA-702',
    name: { ru: 'Жент', kk: 'Жент' },
    description: { ru: 'Традиционная сладость из толокна, масла и изюма', kk: 'Талқан, май және мейіз қосылған дәстүрлі тәтті' },
    composition: { ru: 'Толокно из проса, сливочное масло, сахар, изюм, курт', kk: 'Тары талқаны, сары май, қант, мейіз, құрт' },
    weightGrams: 120,
    calories: 480,
    isVegetarian: true,
    allergens: ['milk'],
    prices: { greenline: 1800, 'garden-view': 1900 },
  },
  {
    slug: 'medovik',
    category: 'deserty',
    sku: 'AULA-703',
    name: { ru: 'Медовик', kk: 'Бал торты' },
    description: { ru: 'Медовые коржи со сметанным кремом', kk: 'Қаймақ кремі жағылған бал қабаттары' },
    composition: { ru: 'Мука, мёд, яйцо, сметана, сливочное масло, сахар', kk: 'Ұн, бал, жұмыртқа, қаймақ, сары май, қант' },
    weightGrams: 150,
    calories: 510,
    isVegetarian: true,
    allergens: ['gluten', 'eggs', 'milk'],
    prices: { greenline: 2100, 'garden-view': 2200 },
  },
  // ---------------------------------------------------------------- Напитки
  {
    slug: 'kumys',
    category: 'napitki',
    sku: 'AULA-801',
    name: { ru: 'Кумыс, 0,5 л', kk: 'Қымыз, 0,5 л' },
    description: { ru: 'Кобылье молоко естественного брожения', kk: 'Табиғи ашытылған бие сүті' },
    composition: { ru: 'Кобылье молоко', kk: 'Бие сүті' },
    weightGrams: null,
    calories: 250,
    isVegetarian: true,
    allergens: ['milk'],
    prices: { greenline: 1900, 'garden-view': 2100 },
  },
  {
    slug: 'shubat',
    category: 'napitki',
    sku: 'AULA-802',
    name: { ru: 'Шубат, 0,5 л', kk: 'Шұбат, 0,5 л' },
    description: { ru: 'Кисломолочный напиток из верблюжьего молока', kk: 'Түйе сүтінен жасалған ашыған сүт сусыны' },
    composition: { ru: 'Верблюжье молоко', kk: 'Түйе сүті' },
    weightGrams: null,
    calories: 300,
    isVegetarian: true,
    allergens: ['milk'],
    prices: { greenline: 2100, 'garden-view': 2300 },
  },
  {
    slug: 'chay-s-molokom',
    category: 'napitki',
    sku: 'AULA-803',
    name: { ru: 'Чай с молоком', kk: 'Сүт қосылған шай' },
    description: { ru: 'Чёрный чай по-казахски со сливками', kk: 'Кілегей қосылған қазақша қара шай' },
    composition: { ru: 'Чёрный чай, молоко или сливки', kk: 'Қара шай, сүт немесе кілегей' },
    weightGrams: null,
    calories: 60,
    isVegetarian: true,
    allergens: ['milk'],
    modifiers: ['obem-chaynika'],
    prices: { greenline: 1400, 'garden-view': 1500 },
  },
  {
    slug: 'limonad-oblepikha',
    category: 'napitki',
    sku: 'AULA-804',
    name: { ru: 'Лимонад облепиховый', kk: 'Шырғанақ лимонады' },
    description: { ru: 'Домашний лимонад с облепихой и мятой', kk: 'Шырғанақ пен жалбыз қосылған үй лимонады' },
    composition: { ru: 'Облепиха, лимон, мята, сахарный сироп, газированная вода', kk: 'Шырғанақ, лимон, жалбыз, қант шәрбаты, газдалған су' },
    weightGrams: null,
    calories: 120,
    isVegetarian: true,
    modifiers: ['obem-limonada'],
    prices: { greenline: 1500, 'garden-view': 1600 },
  },
  {
    slug: 'limonad-mango-marakuyya',
    category: 'napitki',
    sku: 'AULA-805',
    name: { ru: 'Лимонад манго-маракуйя', kk: 'Манго-маракуйя лимонады' },
    description: { ru: 'Тропический лимонад с пюре манго и маракуйи', kk: 'Манго мен маракуйя пюресі қосылған тропикалық лимонад' },
    composition: { ru: 'Пюре манго, пюре маракуйи, лайм, газированная вода', kk: 'Манго пюресі, маракуйя пюресі, лайм, газдалған су' },
    weightGrams: null,
    calories: 140,
    isVegetarian: true,
    modifiers: ['obem-limonada'],
    prices: { greenline: 1600, 'garden-view': 1700 },
  },
];

export interface SeedBanner {
  placement: 'home_hero' | 'home_secondary' | 'menu_top';
  branch: 'greenline' | 'garden-view' | null;
  title: Translatable;
  subtitle: Translatable;
  ctaLabel: Translatable;
  linkUrl: string;
  sortOrder: number;
}

export const SEED_BANNERS: SeedBanner[] = [
  {
    placement: 'home_hero',
    branch: null,
    sortOrder: 10,
    title: { ru: 'Бешбармак с доставкой по Астане', kk: 'Астана бойынша жеткізумен бешбармақ' },
    subtitle: { ru: 'Заказывайте на сайте AULA — цены как в ресторане', kk: 'AULA сайтында тапсырыс беріңіз — бағалар мейрамханадағыдай' },
    ctaLabel: { ru: 'Открыть меню', kk: 'Мәзірді ашу' },
    linkUrl: '/menu',
  },
  {
    placement: 'home_secondary',
    branch: null,
    sortOrder: 20,
    title: { ru: 'Банкеты и тои в AULA', kk: 'AULA-да банкеттер мен тойлар' },
    subtitle: { ru: 'VIP-залы, меню под ваш бюджет, смета за один день', kk: 'VIP-залдар, бюджетіңізге сай мәзір, смета бір күнде' },
    ctaLabel: { ru: 'Оставить заявку', kk: 'Өтінім қалдыру' },
    linkUrl: '/banquets',
  },
  {
    placement: 'menu_top',
    branch: 'greenline',
    sortOrder: 30,
    title: { ru: 'Бизнес-ланч в GreenLine Aqua', kk: 'GreenLine Aqua-да бизнес-ланч' },
    subtitle: { ru: 'По будням с 12:00 до 16:00', kk: 'Жұмыс күндері 12:00-ден 16:00-ге дейін' },
    ctaLabel: { ru: 'Подробнее', kk: 'Толығырақ' },
    linkUrl: '/promotions/biznes-lanch',
  },
];

export interface SeedPromotion {
  slug: string;
  branches: Array<'greenline' | 'garden-view'>;
  title: Translatable;
  description: Translatable;
  terms: Translatable;
  sortOrder: number;
}

export const SEED_PROMOTIONS: SeedPromotion[] = [
  {
    slug: 'biznes-lanch',
    branches: ['greenline'],
    sortOrder: 10,
    title: { ru: 'Бизнес-ланч', kk: 'Бизнес-ланч' },
    description: {
      ru: 'Салат, суп, горячее и напиток по специальной цене. Меню обновляется каждую неделю.',
      kk: 'Салат, көже, ыстық тағам және сусын арнайы бағамен. Мәзір апта сайын жаңартылады.',
    },
    terms: {
      ru: 'Действует по будням с 12:00 до 16:00 в зале ресторана GreenLine Aqua. Не суммируется с другими акциями.',
      kk: 'Жұмыс күндері 12:00-ден 16:00-ге дейін GreenLine Aqua мейрамханасының залында жарамды. Басқа акциялармен қосылмайды.',
    },
  },
  {
    slug: 'sezon-kumysa',
    branches: [],
    sortOrder: 20,
    title: { ru: 'Сезон кумыса', kk: 'Қымыз маусымы' },
    description: {
      ru: 'Свежий кумыс от проверенных хозяйств Акмолинской области — в ресторанах и с доставкой.',
      kk: 'Ақмола облысының сенімді шаруашылықтарынан жаңа қымыз — мейрамханаларда және жеткізумен.',
    },
    terms: {
      ru: 'Кумыс доступен, пока идёт сезон и есть поставки. Наличие уточняйте в меню ресторана.',
      kk: 'Қымыз маусым жалғасып, жеткізілім болғанша қолжетімді. Бар-жоғын мейрамхана мәзірінен нақтылаңыз.',
    },
  },
];
