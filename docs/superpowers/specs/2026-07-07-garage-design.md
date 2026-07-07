# «Мой гараж» — VIN-based garage feature

**Date:** 2026-07-07
**Status:** Approved design, pending implementation plan

## Problem

The "Мой гараж" tab in the profile (`front/src/pages/Profile.tsx`) is a static mockup:
hardcoded fake cars ("2018 Honda Civic", "2015 Ford F-150"), buttons that do nothing,
and **no backend support at all** — no entity, no endpoints, no field on `User`.

Goal: make it a real feature — users add/edit/delete their cars (VIN-anchored) and jump
straight to the parts catalog for a given car.

## Scope decisions (from brainstorming)

- **Full feature**: backend entity + endpoints (NestJS) and frontend CRUD.
- **VIN-based storage**: the vehicle is anchored on its VIN. The "Каталог запчастей" button
  deep-links to the existing `/vin/:q` route, which already drives VIN search.
- **Only VIN is required.** Make / model / year / trim are optional display fields entered
  manually by the user. No VIN→make/model auto-decode (unreliable, and burns the metered
  PartsIndex / parts-catalogs quota — see project memory `catalog-provider-key-limits`).

## Architecture

The feature is a direct clone of the existing `addresses` module — the same
user-owned-collection pattern (`src/addresses/`). That module is the reference implementation;
read it fully before writing the garage module.

Shared platform facts this relies on:
- Global `JwtAuthGuard` (`APP_GUARD` in `app.module.ts`) protects all routes by default —
  the garage controller needs **no** explicit guard, same as `addresses`.
- Global prefix `api` (`main.ts` → `app.setGlobalPrefix('api')`), so `@Controller('garage')`
  serves under `/api/garage`.
- `@CurrentUser()` decorator supplies the authenticated `User`.

### Backend

New module `src/garage/`:

- `entities/vehicle.entity.ts` — `@Entity('vehicles')`:

  | column | type | notes |
  |---|---|---|
  | `id` | uuid PK | `uuid_generate_v4()` |
  | `vin` | varchar(32) NOT NULL | stored trimmed + uppercased |
  | `make` | varchar(100) nullable | e.g. "Honda" |
  | `model` | varchar(100) nullable | e.g. "Civic" |
  | `year` | int nullable | e.g. 2018 |
  | `trim` | varchar(120) nullable | e.g. "EX-L 1.5L Turbo" |
  | `main` | boolean NOT NULL default false | one main per user |
  | `userId` | uuid NOT NULL | FK → `users(id)` `ON DELETE CASCADE` |
  | `createdAt` / `updatedAt` | timestamp | |

- `dto/create-vehicle.dto.ts` — `vin` required (`@IsString @IsNotEmpty @MaxLength(32)`,
  and a loose format check: alphanumeric, length ≥ 5, matching how existing VIN search
  accepts `length >= 5`); `make`/`model`/`trim` optional strings with `@MaxLength`;
  `year` optional int (`@IsInt @Min(1900) @Max(2100)`); `main` optional boolean.
- `dto/update-vehicle.dto.ts` — all fields optional (same validators).
- `garage.service.ts` — mirrors `AddressesService`:
  - `findAllByUser(userId)` → `order: { main: 'DESC', createdAt: 'ASC' }`.
  - `findOne(id, userId)` → 404 if missing, 403 if not owner.
  - `create(userId, dto)` → normalize VIN (trim+upper); **dedupe**: if a vehicle with the
    same VIN already exists for this user, return/refuse (see Edge cases); if `dto.main`
    unset main on others first.
  - `update(id, userId, dto)` → owner-checked; if `main === true`, unset others; normalize
    VIN if provided.
  - `setMain(id, userId)` → unset others, set this main.
  - `delete(id, userId)` → owner-checked remove.
  - private `unsetMain(userId)`.
- `garage.controller.ts` — `@Controller('garage')`, endpoints mirroring addresses:
  `GET /`, `GET /:id`, `POST /`, `PUT /:id`, `PATCH /:id/main`, `DELETE /:id`
  (with the same `@ApiTags`/`@ApiOperation`/`@ApiBearerAuth` Swagger annotations, Russian
  descriptions consistent with the rest of the codebase).
- `garage.module.ts` — `TypeOrmModule.forFeature([Vehicle])`, provider + controller, export service.
- `migrations/1700000000024-CreateVehicles.ts` — `CREATE TABLE "vehicles"` with the columns
  above and the `FK_vehicles_users` foreign key, `down` drops the table. Follows the exact
  style of `1700000000002-CreateAddresses.ts`.
- Register `GarageModule` + `Vehicle` entity in `app.module.ts` (alongside `AddressesModule`).

### Frontend (`front/`)

- `src/types/catalog.ts` — add `Vehicle` interface (`id, vin, make, model, year, trim,
  main, createdAt, updatedAt`).
- `src/api.ts` — add `garageApi` next to `addressesApi`:
  `list(token)`, `create(token, body)`, `update(token, id, body)`, `setMain(token, id)`,
  `delete(token, id)` — all against `/api/garage`.
- `src/pages/Profile.tsx` — replace the hardcoded `activeTab === 'garage'` block with real UI:
  - fetch vehicles on mount (when the garage tab is active / on load), local component state;
  - render one card per vehicle reusing existing card styling: title = `year make model`
    (fallback to VIN when all display fields empty), subtitle = `trim` and/or VIN, "Основной"
    badge on the main one;
  - add/edit form: VIN input (required), optional make/model/year/trim;
  - actions per card: **Каталог запчастей** → `navigate('/vin/{vin}')`; **Изменить** (opens
    edit form); **Удалить**; **Сделать основным** (setMain);
  - empty state ("Гараж пуст — добавьте авто") and error/success messaging consistent with
    the rest of `Profile.tsx`.

## Data flow

1. Profile garage tab mounts → `garageApi.list(token)` → render cards.
2. Add: form → `garageApi.create` → refresh list.
3. Edit: form → `garageApi.update` → refresh.
4. Set main: `garageApi.setMain` → refresh (server guarantees single main).
5. Delete: `garageApi.delete` → refresh.
6. "Каталог запчастей": client-side `navigate('/vin/{vin}')` → existing VIN search page.

## Error handling

- Backend: `NotFoundException` (404) for missing vehicle, `ForbiddenException` (403) for
  wrong owner, `class-validator` 400 for bad DTO — inherited from the addresses pattern.
- Frontend: reuse `getApiErrorMessage` / `isUnauthorizedError`; a 401 redirects to `/auth`
  (already wired in `Profile.tsx`).

## Edge cases

- **Duplicate VIN for the same user**: on create, if the normalized VIN already exists for
  the user, reject with `ConflictException` (409) and the message "Это авто уже в гараже."
  Duplicate VINs across *different* users are allowed (two people can own the same car
  history record independently).
- **VIN normalization**: trim + uppercase on both create and update before persisting/comparing.
- **Main bookkeeping**: creating/updating/deleting keeps at most one `main` per user; deleting
  the main leaves no main (matches addresses behavior — no auto-promote).

## Testing

- `src/garage/garage.service.spec.ts` — unit tests mirroring the addresses service tests:
  create sets/unsets main and dedupes VIN, ownership 404/403, `setMain` unsets others,
  `delete` owner-checked, VIN normalization.
- Run the existing jest suite (`npm test`) to confirm no regressions.
- Manual: build backend, restart per CLAUDE.md, exercise CRUD against `/api/garage`.

## Out of scope (YAGNI)

- VIN → make/model/year auto-decode.
- Linking vehicles to orders or catalog car-tree IDs.
- Sharing/transferring vehicles between users.
- Reworking the still-mock "Адреса" tab (separate task; `addresses` backend already exists).
