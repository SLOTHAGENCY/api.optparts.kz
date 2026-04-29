# NestJS JWT Auth App

JWT authentication + products + cart with PostgreSQL, TypeORM migrations, and custom class-validator validators.

## Stack

- **NestJS** — framework
- **TypeORM** — ORM + migrations
- **PostgreSQL** — database
- **Passport + JWT** — authentication
- **bcryptjs** — password hashing
- **Multer** — file uploads (local disk)
- **class-validator / class-transformer** — DTO validation & serialization

---

## Quick Start

```bash
# 1. Install
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env with your DB credentials and a strong JWT_SECRET

# 3. Create the database
createdb nestjs_auth
# or via psql: CREATE DATABASE nestjs_auth;

# 4. Run migrations
npm run migration:run

# 5. Start dev server
npm run start:dev
```

---

## Project Structure

```
src/
├── auth/
│   ├── decorators/        @CurrentUser, @Public, @Roles
│   ├── dto/               register, login, update-profile
│   ├── guards/            JwtAuthGuard (global), RolesGuard
│   ├── strategies/        jwt.strategy.ts
│   ├── validators/        is-already-registered, validate-credentials
│   ├── auth.controller.ts
│   ├── auth.module.ts
│   └── auth.service.ts
├── cart/
│   ├── dto/               add-to-cart, update-cart-item
│   ├── entities/          cart.entity, cart-item.entity
│   ├── cart.controller.ts
│   ├── cart.module.ts
│   └── cart.service.ts
├── config/
│   └── data-source.ts     TypeORM CLI DataSource
├── migrations/
│   ├── 1700000000000-CreateUsersTable.ts
│   └── 1700000000001-CreateProductsAndCart.ts
├── products/
│   ├── dto/               create-product, update-product
│   ├── entities/          product.entity
│   ├── products.controller.ts
│   ├── products.module.ts
│   └── products.service.ts
├── users/
│   ├── entities/          user.entity
│   ├── users.module.ts
│   └── users.service.ts
├── app.module.ts
└── main.ts
uploads/
├── avatars/               user profile images
└── products/              product images
```

---

## API Reference

### Auth

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| POST | `/api/auth/register` | ❌ | Register (email, password, firstName, lastName) |
| POST | `/api/auth/login` | ❌ | Login → returns JWT |
| POST | `/api/auth/logout` | ✅ | Client-side logout |
| GET | `/api/auth/me` | ✅ | Current user |
| GET | `/api/auth/profile` | ✅ | Current user profile |
| PUT | `/api/auth/profile` | ✅ | Update firstName / lastName |
| POST | `/api/auth/profile/image` | ✅ | Upload profile image (multipart `image`) |

### Products

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| GET | `/api/products` | ❌ | List all products |
| GET | `/api/products/:id` | ❌ | Get product by id |
| POST | `/api/products` | admin/manager | Create product |
| PUT | `/api/products/:id` | admin/manager | Update product |
| POST | `/api/products/:id/images` | admin/manager | Upload images (multipart `images[]`) |
| DELETE | `/api/products/:id/images/:filename` | admin/manager | Remove an image |
| DELETE | `/api/products/:id` | admin | Delete product |

### Cart (all require auth)

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/cart` | Get cart with items + `totalAmount` |
| POST | `/api/cart/items` | Add item `{ productId, quantity }` — increments if already in cart |
| PUT | `/api/cart/items/:itemId` | Update quantity `{ quantity }` |
| DELETE | `/api/cart/items/:itemId` | Remove item |
| DELETE | `/api/cart` | Clear entire cart |

### Static files

Uploaded images are served at:
- `http://localhost:3000/uploads/avatars/<filename>`
- `http://localhost:3000/uploads/products/<filename>`

---

## Roles

| Role | Value |
|------|-------|
| User | `user` |
| Manager | `manager` |
| Admin | `admin` |

Assign roles directly in the DB or via a seed script. Protect routes:

```ts
@UseGuards(RolesGuard)
@Roles(UserRole.ADMIN)
@Get('admin-only')
adminOnly() { ... }
```

---

## Custom Validators

- **`IsAlreadyRegistered`** — checks DB for duplicate email on register
- **`ValidateCredentials`** — bcrypt-checks password against stored hash on login

Both are `@Injectable()` and use `useContainer()` in `main.ts` to access NestJS DI.

---

## Migration Commands

```bash
npm run migration:run      # run pending migrations
npm run migration:revert   # revert last migration
npm run migration:generate -- src/migrations/MyMigration  # generate from entity diff
```
