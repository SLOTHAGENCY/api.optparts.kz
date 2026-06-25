import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Cart } from './entities/cart.entity';
import { CartItem } from './entities/cart-item.entity';
import { AddToCartDto } from './dto/add-to-cart.dto';
import { SuppliersRegistry } from '../suppliers/suppliers.registry';
import { PricingService } from '../pricing/pricing.service';

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
}

interface RecheckResult {
  item: CartItem;
  supplierName: string;
  costPrice: number;
  currentPrice: number;
  available: boolean;
  priceChanged: boolean;
  raw: Record<string, unknown>;
  warehouseId: string;
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
        quantity: r.item.quantity,
        subtotal,
      };
    });

    const totalAmount = items.reduce((sum, i) => sum + i.subtotal, 0);
    const hasChanges = items.some((i) => i.priceChanged || !i.available);

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
    }));
  }

  async addItem(userId: string, dto: AddToCartDto) {
    const cart = await this.getOrCreateCart(userId);

    const existing = cart.items?.find(
      (i) =>
        i.supplierCode === dto.supplierCode &&
        i.article === dto.article &&
        i.brand === dto.brand &&
        i.warehouseId === dto.warehouseId,
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
    const settled = await Promise.allSettled(
      items.map((item) => this.recheckItem(item)),
    );
    // recheckItem catches its own errors, but stay defensive.
    return settled.map((s, idx) =>
      s.status === 'fulfilled' ? s.value : this.unavailable(items[idx]),
    );
  }

  private async recheckItem(item: CartItem): Promise<RecheckResult> {
    try {
      const connector = await this.registry.getByCode(item.supplierCode);
      // Re-check by the ORIGINAL search query (stored in raw), not the offer's own
      // article: some suppliers (Rossko) only return an offer as a cross under its
      // parent query, so re-searching the offer's own article wouldn't reproduce it.
      const raw = (item.raw ?? {}) as Record<string, unknown>;
      const queryArticle = (raw.queryArticle as string) ?? item.article;
      const queryBrand = (raw.queryBrand as string | null) ?? item.brand;
      const offers = await this.withTimeout(
        connector.search(queryArticle, queryBrand ?? undefined),
      );
      // Match the SAME offer by the connector's stable offerKey (e.g. Rossko
      // guid|stockId). warehouseId alone is a warehouse, shared by many products,
      // so matching on it can pull a different product's price. Fall back to
      // warehouseId only for legacy items stored without an offerKey.
      const itemKey = (item.raw as Record<string, unknown> | null)?.offerKey;
      const offer = itemKey
        ? offers.find((o) => o.raw?.offerKey === itemKey)
        : offers.find((o) => o.warehouseId === item.warehouseId);
      if (!offer) return this.unavailable(item);

      const currentPrice = await this.pricing.applyMarkup(
        offer.costPrice,
        item.supplierCode,
        offer.currency,
      );
      const priceAtAdd = Number(item.priceAtAdd);
      return {
        item,
        supplierName: connector.name,
        costPrice: offer.costPrice,
        currentPrice,
        available: offer.count >= item.quantity,
        priceChanged: currentPrice !== priceAtAdd,
        raw: offer.raw,
        warehouseId: offer.warehouseId,
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
      raw: item.raw ?? {},
      warehouseId: item.warehouseId,
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
