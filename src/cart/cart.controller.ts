import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
} from '@nestjs/common';
import { CartService } from './cart.service';
import { AddToCartDto } from './dto/add-to-cart.dto';
import { UpdateCartItemDto } from './dto/update-cart-item.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';

@Controller('cart')
export class CartController {
  constructor(private readonly cartService: CartService) {}

  /** GET /cart */
  @Get()
  getCart(@CurrentUser() user: User) {
    return this.cartService.getCart(user.id);
  }

  /** POST /cart/items */
  @Post('items')
  @HttpCode(HttpStatus.OK)
  addItem(@CurrentUser() user: User, @Body() dto: AddToCartDto) {
    return this.cartService.addItem(user.id, dto);
  }

  /** PUT /cart/items/:itemId */
  @Put('items/:itemId')
  updateItem(
    @CurrentUser() user: User,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() dto: UpdateCartItemDto,
  ) {
    return this.cartService.updateItem(user.id, itemId, dto.quantity);
  }

  /** DELETE /cart/items/:itemId */
  @Delete('items/:itemId')
  removeItem(
    @CurrentUser() user: User,
    @Param('itemId', ParseUUIDPipe) itemId: string,
  ) {
    return this.cartService.removeItem(user.id, itemId);
  }

  /** DELETE /cart */
  @Delete()
  @HttpCode(HttpStatus.OK)
  clearCart(@CurrentUser() user: User) {
    return this.cartService.clearCart(user.id);
  }
}
