import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Cart } from './entities/cart.entity';
import { CartItem } from './entities/cart-item.entity';
import { ProductsService } from '../products/products.service';
import { AddToCartDto } from './dto/add-to-cart.dto';

@Injectable()
export class CartService {
  constructor(
    @InjectRepository(Cart)
    private readonly cartRepo: Repository<Cart>,
    @InjectRepository(CartItem)
    private readonly itemRepo: Repository<CartItem>,
    private readonly productsService: ProductsService,
  ) {}

  async getOrCreateCart(userId: string): Promise<Cart> {
    let cart = await this.cartRepo.findOne({
      where: { userId },
      relations: ['items', 'items.product'],
    });
    if (!cart) {
      cart = this.cartRepo.create({ userId, items: [] });
      await this.cartRepo.save(cart);
    }
    return cart;
  }

  async getCart(userId: string) {
    const cart = await this.getOrCreateCart(userId);
    return this.buildResponse(cart);
  }

  async addItem(userId: string, dto: AddToCartDto) {
    await this.productsService.findById(dto.productId); // 404 if not found
    const cart = await this.getOrCreateCart(userId);

    const existing = cart.items?.find((i) => i.productId === dto.productId);
    if (existing) {
      existing.quantity += dto.quantity;
      await this.itemRepo.save(existing);
    } else {
      const item = this.itemRepo.create({
        cartId: cart.id,
        productId: dto.productId,
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

  private buildResponse(cart: Cart) {
    const items = (cart.items ?? []).map((item) => ({
      id: item.id,
      product: item.product,
      quantity: item.quantity,
      subtotal: Number(item.product?.price ?? 0) * item.quantity,
    }));

    const totalAmount = items.reduce((sum, i) => sum + i.subtotal, 0);

    return { id: cart.id, items, totalAmount };
  }
}
