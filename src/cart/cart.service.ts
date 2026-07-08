import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Cart } from './entities/cart.entity';
import { CartItem } from './entities/cart-item.entity';
import { AddToCartDto } from './dto/add-to-cart.dto';
import { SuppliersRegistry } from '../suppliers/suppliers.registry';
import { PricingService } from '../pricing/pricing.service';
import { SupplierOffer } from '../suppliers/types';

/** One partner lookup shared by every cart line with the same (supplier, query). */
interface SharedSearch {
  supplierName: string | null;
  offers: SupplierOffer[];
}

/**
 * Cart line with a fresh re-check (same as GET /cart), including the
 * cost/sell/raw/warehouse data Orders (Spec C) needs to place the order.
 * Contract duplicated verbatim in Spec B and Spec C.
 */
export interface CheckoutItem {
  supplierCode: string;
  article: string;
  brand: string;
  productName: string;
  costPrice: number;
  sellPrice: number;
  currentPrice: number;
  priceAtAdd: number;
  warehouseId: string;
  raw: Record<string, unknown>;
  quantity: number;
  available: boolean;
  priceChanged: boolean;
  /** Live delivery estimate (days); null when the offer couldn't be re-checked. */
  deliveryDays: number | null;
}

interface RecheckResult {
  item: CartItem;
  supplierName: string;
  costPrice: number;
  currentPrice: number;
  available: boolean;
  priceChanged: boolean;
  /** true if the line quantity was auto-reduced to the supplier's remaining stock. */
  quantityAdjusted: boolean;
  raw: Record<string, unknown>;
  warehouseId: string;
  count: number;
  /** Live order multiplicity (pack size). Offers are ordered in whole multiples. */
  multiplicity: number;
  /** Live delivery estimate (days). null when the offer couldn't be re-checked. */
  deliveryDays: number | null;
}

const DEFAULT_RECHECK_TIMEOUT_MS = 10000;

@Injectable()
export class CartService {
  constructor(
    @InjectRepository(Cart)
    private readonly cartRepo: Repository<Cart>,
    @InjectRepository(CartItem)
    private readonly itemRepo: Repository<CartItem>,
    private readonly registry: SuppliersRegistry,
    private readonly pricing: PricingService,
  ) {}

  async getOrCreateCart(userId: string): Promise<Cart> {
    let cart = await this.cartRepo.findOne({
      where: { userId },
      relations: ['items'],
    });
    if (!cart) {
      cart = this.cartRepo.create({ userId, items: [] });
      await this.cartRepo.save(cart);
    }
    // Stable insertion order. Postgres returns relation rows in heap order,
    // which changes whenever a row is updated (a quantity change / recheck save)
    // — so without this the cart lines reshuffle on reload or +/-. Sort by
    // createdAt, with id as a tiebreaker for lines added in the same tick.
    cart.items?.sort(
      (a, b) =>
        (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0) ||
        a.id.localeCompare(b.id),
    );
    return cart;
  }

  async getCart(userId: string) {
    const cart = await this.getOrCreateCart(userId);
    const results = await this.recheckAll(cart.items ?? []);

    const items = results.map((r) => {
      const subtotal = r.currentPrice * r.item.quantity;
      return {
        id: r.item.id,
        supplierCode: r.item.supplierCode,
        supplierName: r.supplierName,
        article: r.item.article,
        brand: r.item.brand,
        productName: r.item.productName,
        priceAtAdd: Number(r.item.priceAtAdd),
        currentPrice: r.currentPrice,
        priceChanged: r.priceChanged,
        available: r.available,
        quantityAdjusted: r.quantityAdjusted,
        quantity: r.item.quantity,
        maxQuantity: r.available ? r.count : 0,
        multiplicity: r.multiplicity,
        deliveryDays: r.deliveryDays,
        subtotal,
      };
    });

    const totalAmount = items.reduce((sum, i) => sum + i.subtotal, 0);
    const hasChanges = items.some(
      (i) => i.priceChanged || !i.available || i.quantityAdjusted,
    );

    return { items, totalAmount, hasChanges };
  }

  /** Cart lines with a fresh re-check, for Orders (Spec C). */
  async getCheckoutItems(userId: string): Promise<CheckoutItem[]> {
    const cart = await this.getOrCreateCart(userId);
    const results = await this.recheckAll(cart.items ?? []);
    return results.map((r) => ({
      supplierCode: r.item.supplierCode,
      article: r.item.article,
      brand: r.item.brand,
      productName: r.item.productName,
      costPrice: r.costPrice,
      sellPrice: r.currentPrice,
      currentPrice: r.currentPrice,
      priceAtAdd: Number(r.item.priceAtAdd),
      warehouseId: r.warehouseId,
      raw: r.raw,
      quantity: r.item.quantity,
      available: r.available,
      priceChanged: r.priceChanged,
      deliveryDays: r.deliveryDays,
    }));
  }

  async addItem(userId: string, dto: AddToCartDto) {
    const cart = await this.getOrCreateCart(userId);

    // A cart line is a specific offer at a specific price. Two "add" actions
    // merge into one line (summing quantity) only when they are literally the
    // same offer AND the same price:
    //  - offerKey is the connector's stable per-offer identity. A single
    //    warehouse can hold several distinct price lines of the same article
    //    (e.g. SHATE-M returns multiple price lines per locationCode, each with
    //    its own delivery term / price), so warehouseId is NOT a unique offer
    //    identity — deduping on it collapsed distinct offers into one line and
    //    wrongly summed their quantities. All partners emit offerKey.
    //  - price: adding the same article at a different price (a different
    //    delivery tier, or price drift between two adds) stays a separate line.
    const dtoKey = (dto.raw as Record<string, unknown> | null)?.offerKey ?? null;
    const existing = cart.items?.find(
      (i) =>
        i.supplierCode === dto.supplierCode &&
        i.article === dto.article &&
        i.brand === dto.brand &&
        ((i.raw as Record<string, unknown> | null)?.offerKey ?? null) ===
          dtoKey &&
        Number(i.priceAtAdd) === dto.sellPrice,
    );

    if (existing) {
      existing.quantity += dto.quantity;
      await this.itemRepo.save(existing);
    } else {
      const item = this.itemRepo.create({
        cartId: cart.id,
        productId: null,
        supplierCode: dto.supplierCode,
        article: dto.article,
        brand: dto.brand,
        productName: dto.productName,
        priceAtAdd: dto.sellPrice as unknown as string,
        // Client never sends costPrice (search hides it); re-check re-derives the
        // authoritative value. Store the optional fallback or 0.
        costPrice: (dto.costPrice ?? 0) as unknown as string,
        warehouseId: dto.warehouseId,
        raw: dto.raw,
        quantity: dto.quantity,
      });
      await this.itemRepo.save(item);
    }

    return this.getCart(userId);
  }

  async updateItem(userId: string, itemId: string, quantity: number) {
    const cart = await this.getOrCreateCart(userId);
    const item = cart.items?.find((i) => i.id === itemId);
    if (!item) throw new NotFoundException('Cart item not found.');

    const [recheck] = await this.recheckAll([item]);
    const max = recheck?.available ? recheck.count : 0;
    if (quantity > max) {
      throw new BadRequestException(`Доступно ${max} шт.`);
    }
    // Enforce the LIVE offer multiplicity, not item.raw — the stored snapshot's
    // raw is the supplier payload and never carries a `multiplicity` key, so
    // reading it here always yielded 1 and let the cart step by one for a
    // pack-of-N offer. The recheck above already resolved the current offer.
    const mult = recheck?.multiplicity || 1;
    if (mult > 1 && quantity % mult !== 0) {
      throw new BadRequestException(`Количество должно быть кратно ${mult}.`);
    }

    item.quantity = quantity;
    await this.itemRepo.save(item);
    return this.getCart(userId);
  }

  async removeItem(userId: string, itemId: string) {
    const cart = await this.getOrCreateCart(userId);
    const item = cart.items?.find((i) => i.id === itemId);
    if (!item) throw new NotFoundException('Cart item not found.');
    await this.itemRepo.remove(item);
    return this.getCart(userId);
  }

  async clearCart(userId: string) {
    const cart = await this.getOrCreateCart(userId);
    if (cart.items?.length) {
      await this.itemRepo.remove(cart.items);
    }
    return this.getCart(userId);
  }

  // --- live re-check ---

  private async recheckAll(items: CartItem[]): Promise<RecheckResult[]> {
    // Dedup partner lookups: many cart lines share the same (supplier, query) —
    // e.g. several distinct offers of one article from one supplier are now
    // separate lines. Run ONE search per distinct (supplier, queryArticle,
    // queryBrand) and share its offers across every matching line, instead of
    // re-searching the partner once per line (which was N× the requests, N× the
    // latency, and could trip the partner's rate limit).
    const searches = new Map<string, Promise<SharedSearch>>();
    const searchFor = (item: CartItem): Promise<SharedSearch> => {
      const raw = (item.raw ?? {}) as Record<string, unknown>;
      const queryArticle = (raw.queryArticle as string) ?? item.article;
      const queryBrand = (raw.queryBrand as string | null) ?? item.brand;
      const key = `${item.supplierCode} ${queryArticle} ${queryBrand ?? ''}`;
      let hit = searches.get(key);
      if (!hit) {
        hit = this.searchOnce(item.supplierCode, queryArticle, queryBrand);
        searches.set(key, hit);
      }
      return hit;
    };

    const settled = await Promise.allSettled(
      items.map((item) => this.recheckItem(item, searchFor(item))),
    );
    // recheckItem catches its own errors, but stay defensive.
    return settled.map((s, idx) =>
      s.status === 'fulfilled' ? s.value : this.unavailable(items[idx]),
    );
  }

  /**
   * A single partner search, resolved to its offers. Never throws — a down /
   * inactive / timed-out partner yields no offers (every line keyed to it then
   * falls back to `unavailable`), matching the previous per-line behaviour.
   * Re-checks by the ORIGINAL search query (stored in raw), not the offer's own
   * article: some suppliers (Rossko) only return an offer as a cross under its
   * parent query, so re-searching the offer's own article wouldn't reproduce it.
   */
  private async searchOnce(
    supplierCode: string,
    queryArticle: string,
    queryBrand: string | null,
  ): Promise<SharedSearch> {
    try {
      const connector = await this.registry.getByCode(supplierCode);
      const offers = await this.withTimeout(
        connector.search(queryArticle, queryBrand ?? undefined),
      );
      return { supplierName: connector.name, offers };
    } catch {
      return { supplierName: null, offers: [] };
    }
  }

  private async recheckItem(
    item: CartItem,
    search: Promise<SharedSearch>,
  ): Promise<RecheckResult> {
    try {
      const { supplierName, offers } = await search;
      // Match the SAME offer by the connector's stable offerKey (e.g. Rossko
      // guid|stockId). warehouseId alone is a warehouse, shared by many products,
      // so matching on it can pull a different product's price. Fall back to
      // warehouseId only for legacy items stored without an offerKey.
      const itemKey = (item.raw as Record<string, unknown> | null)?.offerKey;
      const offer = itemKey
        ? offers.find((o) => o.raw?.offerKey === itemKey)
        : offers.find((o) => o.warehouseId === item.warehouseId);
      // Offer disappeared or is fully out of stock => can't be ordered.
      if (!offer || offer.count <= 0) return this.unavailable(item);

      const currentPrice = await this.pricing.applyMarkup(
        offer.costPrice,
        item.supplierCode,
        offer.currency,
        offer.brand,
      );
      const priceAtAdd = Number(item.priceAtAdd);

      // Supplier has fewer than requested => don't block the line, just reduce the
      // quantity to what's in stock (rounded down to the offer's multiplicity).
      let quantityAdjusted = false;
      if (offer.count < item.quantity) {
        const mult = Number(offer.multiplicity) || 1;
        const clamped =
          mult > 1 ? Math.floor(offer.count / mult) * mult : offer.count;
        // Can't even make one whole multiple => treat as unavailable.
        if (clamped <= 0) return this.unavailable(item);
        item.quantity = clamped;
        await this.itemRepo.save(item);
        quantityAdjusted = true;
      }

      return {
        item,
        supplierName: supplierName ?? item.supplierCode,
        costPrice: offer.costPrice,
        currentPrice,
        available: true,
        priceChanged: currentPrice !== priceAtAdd,
        quantityAdjusted,
        raw: offer.raw,
        warehouseId: offer.warehouseId,
        count: offer.count,
        multiplicity: Number(offer.multiplicity) || 1,
        deliveryDays: offer.deliveryDays,
      };
    } catch {
      // Couldn't verify (partner down / timeout / inactive) => not available.
      return this.unavailable(item);
    }
  }

  /** Couldn't verify / offer gone: fall back to the snapshot, mark unavailable. */
  private unavailable(item: CartItem): RecheckResult {
    return {
      item,
      supplierName: item.supplierCode,
      costPrice: Number(item.costPrice),
      currentPrice: Number(item.priceAtAdd),
      available: false,
      priceChanged: false,
      quantityAdjusted: false,
      raw: item.raw ?? {},
      warehouseId: item.warehouseId,
      count: 0,
      multiplicity: Number((item.raw as Record<string, unknown>)?.multiplicity) || 1,
      deliveryDays: null,
    };
  }

  private withTimeout<T>(p: Promise<T>): Promise<T> {
    const ms =
      Number(process.env.CART_RECHECK_TIMEOUT_MS) || DEFAULT_RECHECK_TIMEOUT_MS;
    let timer: NodeJS.Timeout;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('recheck timeout')), ms);
    });
    return Promise.race([p, timeout]).finally(() =>
      clearTimeout(timer),
    ) as Promise<T>;
  }
}
