<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

[circleci-image]: https://img.shields.io/circleci/build/github/nestjs/nest/master?token=abc123def456
[circleci-url]: https://circleci.com/gh/nestjs/nest

  <p align="center">A progressive <a href="http://nodejs.org" target="_blank">Node.js</a> framework for building efficient and scalable server-side applications.</p>
    <p align="center">
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="Package License" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/dm/@nestjs/common.svg" alt="NPM Downloads" /></a>
<a href="https://circleci.com/gh/nestjs/nest" target="_blank"><img src="https://img.shields.io/circleci/build/github/nestjs/nest/master" alt="CircleCI" /></a>
<a href="https://discord.gg/G7Qnnhy" target="_blank"><img src="https://img.shields.io/badge/discord-online-brightgreen.svg" alt="Discord"/></a>
<a href="https://opencollective.com/nest#backer" target="_blank"><img src="https://opencollective.com/nest/backers/badge.svg" alt="Backers on Open Collective" /></a>
<a href="https://opencollective.com/nest#sponsor" target="_blank"><img src="https://opencollective.com/nest/sponsors/badge.svg" alt="Sponsors on Open Collective" /></a>
  <a href="https://paypal.me/kamilmysliwiec" target="_blank"><img src="https://img.shields.io/badge/Donate-PayPal-ff3f59.svg" alt="Donate us"/></a>
    <a href="https://opencollective.com/nest#sponsor"  target="_blank"><img src="https://img.shields.io/badge/Support%20us-Open%20Collective-41B883.svg" alt="Support us"></a>
  <a href="https://twitter.com/nestframework" target="_blank"><img src="https://img.shields.io/twitter/follow/nestframework.svg?style=social&label=Follow" alt="Follow us on Twitter"></a>
</p>
  <!--[![Backers on Open Collective](https://opencollective.com/nest/backers/badge.svg)](https://opencollective.com/nest#backer)
  [![Sponsors on Open Collective](https://opencollective.com/nest/sponsors/badge.svg)](https://opencollective.com/nest#sponsor)-->

## Description

[Nest](https://github.com/nestjs/nest) framework TypeScript starter repository.

## Project setup

```bash
$ npm install
```

## Compile and run the project

```bash
# development
$ npm run start

# watch mode
$ npm run start:dev

# production mode
$ npm run start:prod
```

## Run tests

```bash
# unit tests
$ npm run test

# e2e tests
$ npm run test:e2e

# test coverage
$ npm run test:cov
```

## Deployment

When you're ready to deploy your NestJS application to production, there are some key steps you can take to ensure it runs as efficiently as possible. Check out the [deployment documentation](https://docs.nestjs.com/deployment) for more information.

If you are looking for a cloud-based platform to deploy your NestJS application, check out [Mau](https://mau.nestjs.com), our official platform for deploying NestJS applications on AWS. Mau makes deployment straightforward and fast, requiring just a few simple steps:

```bash
$ npm install -g @nestjs/mau
$ mau deploy
```

With Mau, you can deploy your application in just a few clicks, allowing you to focus on building features rather than managing infrastructure.

## Resources

Check out a few resources that may come in handy when working with NestJS:

- Visit the [NestJS Documentation](https://docs.nestjs.com) to learn more about the framework.
- For questions and support, please visit our [Discord channel](https://discord.gg/G7Qnnhy).
- To dive deeper and get more hands-on experience, check out our official video [courses](https://courses.nestjs.com/).
- Deploy your application to AWS with the help of [NestJS Mau](https://mau.nestjs.com) in just a few clicks.
- Visualize your application graph and interact with the NestJS application in real-time using [NestJS Devtools](https://devtools.nestjs.com).
- Need help with your project (part-time to full-time)? Check out our official [enterprise support](https://enterprise.nestjs.com).
- To stay in the loop and get updates, follow us on [X](https://x.com/nestframework) and [LinkedIn](https://linkedin.com/company/nestjs).
- Looking for a job, or have a job to offer? Check out our official [Jobs board](https://jobs.nestjs.com).

## Support

Nest is an MIT-licensed open source project. It can grow thanks to the sponsors and support by the amazing backers. If you'd like to join them, please [read more here](https://docs.nestjs.com/support).

## Stay in touch

- Author - [Kamil Myśliwiec](https://twitter.com/kammysliwiec)
- Website - [https://nestjs.com](https://nestjs.com/)
- Twitter - [@nestframework](https://twitter.com/nestframework)

## License

Nest is [MIT licensed](https://github.com/nestjs/nest/blob/master/LICENSE).

## Поставщики (агрегатор)

Бэкенд работает как агрегатор предложений партнёров-поставщиков. Каждый партнёр
подключается через **коннектор** — класс, реализующий контракт
`SupplierConnector` (`src/suppliers/supplier-connector.interface.ts`). Коннектор
инкапсулирует протокол партнёра (SOAP/REST/прайс) и наружу отдаёт только
нормализованные типы из `src/suppliers/types.ts` (`SupplierOffer` и др.).

### Как добавить нового партнёра

1. **Создать коннектор:** `src/suppliers/connectors/<partner>/<partner>.connector.ts`,
   класс с `@Injectable()`, реализующий `SupplierConnector`
   (`code`, `name`, `search`, `placeOrder`, `getOrderStatus`, `requestReturn`).
   Методы, недоступные у партнёра, бросают `NotImplementedException`.
2. **Зарегистрировать в провайдерах `SUPPLIERS`:** в `src/suppliers/suppliers.module.ts`
   добавить класс в `providers` и в фабрику токена `SUPPLIERS`
   (`useFactory: (rossko, partner) => [rossko, partner]`, `inject: [...]`).
3. **Завести запись в таблице `suppliers`:** строка с `code` партнёра, `name`,
   `isActive`, опциональным `markupPercent` (миграцией или через
   `PATCH /api/suppliers/:code`). Секреты (ключи API) — в `.env`, не в БД.

Ядро (`SuppliersRegistry`, `SearchService`, `PricingService`) трогать не нужно —
реестр сам подхватит активный коннектор.

### Наценка (pricing)

`PricingService.applyMarkup(costPrice, supplierCode)` превращает закупочную цену в
продажную: `sellPrice = round(costPrice * (1 + markup/100))`. `markup` берётся из
`suppliers.markupPercent` партнёра, иначе из `DEFAULT_MARKUP_PERCENT` (`.env`).
Закупочная цена клиенту никогда не отдаётся.

### API-документация

Swagger доступен по `/api/docs` (UI) и `/api/docs-json` (OpenAPI JSON),
генерируется из аннотаций контроллеров/DTO. Эталон — контроллер `/api/suppliers`.

## Заказы и возвраты (агрегатор)

### Жизненный цикл заказа

`POST /api/orders` оформляет заказ агрегатора:

1. **Финальная live-перепроверка корзины** через `CartService.getCheckoutItems(userId)`
   (свежие цена/наличие у партнёров).
2. Если хоть одна позиция `!available` или `priceChanged` — **`409 Conflict`** со
   списком изменений (`changes[]`); заказ не создаётся (клиент подтверждает новую цену
   или убирает недоступное).
3. Создаётся `Order` + снапшоты `order_item` (цены зафиксированы из `currentPrice`).
4. Позиции группируются по `supplierCode`; на каждую группу создаётся `supplier_order`
   и вызывается `connector.placeOrder()`.
5. Итог под-заказа: `PLACED` + `externalOrderId`, либо `FAILED` + `errorMessage`. Если
   у партнёра нет API заказа (`NotImplementedException`) — `FAILED` с пометкой о ручной
   обработке.
6. **Статус заказа агрегируется** из под-заказов: все `PLACED` → `Order.PLACED`; есть
   хотя бы один `FAILED` (частичный успех) → `Order.PARTIALLY_PLACED`.
7. Upsert в `partner_products` по каждой позиции; корзина очищается.

Один `Order` → N `supplier_order` (по числу задействованных партнёров). Выдача заказов
(`GET /api/orders`, `/api/orders/:id`, `/api/orders/all`) включает `supplierOrders[]`.

### Управление под-заказами (роль MANAGER/ADMIN)

- `POST /api/orders/:id/suppliers/:sid/refresh-status` — `connector.getOrderStatus()`,
  обновляет статус под-заказа («по кнопке»; cron — отдельный поздний этап).
- `POST /api/orders/:id/suppliers/:sid/retry` — повторяет `placeOrder` для `FAILED`
  под-заказа (позиции восстанавливаются из иммутабельного снапшота `order_item`).
- `POST /api/orders/:id/suppliers/:sid/return` — возврат (полуавтомат): где есть API —
  `connector.requestReturn()`, иначе фиксируется `returnStatus=REQUESTED` для ручной
  обработки. Тело — список позиций/количеств (`RequestReturnDto`).

### Иммутабельность истории

`order_item` и `supplier_order` после создания **не меняются** перепроверкой —
live-перепроверка применяется только к корзине. Деактивация партнёра не каскадит на
существующие заказы: имя/данные партнёра берутся из снапшота.

### `partner_products` (аналитика)

Справочник партнёрских товаров, **upsert при каждом оформлении заказа**
(`firstSeenAt`/`lastSeenAt`, `lastKnownCostPrice`/`lastKnownSellPrice`,
инкремент `timesOrdered`; уникальность по `supplierCode + article + brand`). Это
**не источник поиска и не источник цены** — только аналитика. Чтение:
`GET /api/partner-products` (MANAGER/ADMIN, фильтры `supplierCode`/`article`, пагинация).

### Шов с корзиной (Spec B)

`POST /api/orders` потребляет `CartService.getCheckoutItems()` через DI-токен
`CART_CHECKOUT` (`src/orders/cart-checkout.contract.ts`). Сейчас это локальный стаб
(`CartCheckoutStub`); при мёрже Spec B провайдер заменяется на реальный `CartService`
(см. комментарий `MERGE:` в `OrdersModule`).
