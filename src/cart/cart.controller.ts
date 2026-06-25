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
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiOkResponse,
  ApiParam,
} from '@nestjs/swagger';
import { CartService } from './cart.service';
import { AddToCartDto } from './dto/add-to-cart.dto';
import { UpdateCartItemDto } from './dto/update-cart-item.dto';
import { CartResponseDto } from './dto/cart-response.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';

@ApiTags('cart')
@ApiBearerAuth()
@Controller('cart')
export class CartController {
  constructor(private readonly cartService: CartService) {}

  @Get()
  @ApiOperation({ summary: 'Get the cart with a live price/availability re-check' })
  @ApiOkResponse({ type: CartResponseDto })
  getCart(@CurrentUser() user: User) {
    return this.cartService.getCart(user.id);
  }

  @Post('items')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Add a selected search offer (snapshot) to the cart' })
  @ApiOkResponse({ type: CartResponseDto })
  addItem(@CurrentUser() user: User, @Body() dto: AddToCartDto) {
    return this.cartService.addItem(user.id, dto);
  }

  @Put('items/:itemId')
  @ApiOperation({ summary: 'Change a cart item quantity' })
  @ApiParam({ name: 'itemId', format: 'uuid' })
  @ApiOkResponse({ type: CartResponseDto })
  updateItem(
    @CurrentUser() user: User,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() dto: UpdateCartItemDto,
  ) {
    return this.cartService.updateItem(user.id, itemId, dto.quantity);
  }

  @Delete('items/:itemId')
  @ApiOperation({ summary: 'Remove a cart item' })
  @ApiParam({ name: 'itemId', format: 'uuid' })
  @ApiOkResponse({ type: CartResponseDto })
  removeItem(
    @CurrentUser() user: User,
    @Param('itemId', ParseUUIDPipe) itemId: string,
  ) {
    return this.cartService.removeItem(user.id, itemId);
  }

  @Delete()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Clear the cart' })
  @ApiOkResponse({ type: CartResponseDto })
  clearCart(@CurrentUser() user: User) {
    return this.cartService.clearCart(user.id);
  }
}
