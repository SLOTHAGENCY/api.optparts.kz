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
  @ApiOperation({
    summary: 'Получить корзину с актуальными ценами и наличием',
    description:
      'Возвращает текущую корзину пользователя. При запросе сервер заново сверяет каждую ' +
      'позицию с поставщиком: проверяет, есть ли товар в наличии и не изменилась ли цена. ' +
      'Поэтому в ответе видны актуальные данные, и можно сразу заметить, если что-то подорожало ' +
      'или закончилось. Требует авторизации.',
  })
  @ApiOkResponse({ type: CartResponseDto })
  getCart(@CurrentUser() user: User) {
    return this.cartService.getCart(user.id);
  }

  @Post('items')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Добавить выбранное предложение в корзину',
    description:
      'Добавляет в корзину конкретное предложение, выбранное из результатов поиска (определённый ' +
      'товар у определённого поставщика с его ценой и сроком). В корзине сохраняется «снимок» ' +
      'этого предложения на момент добавления. Если такая позиция уже есть, увеличится её ' +
      'количество. Требует авторизации.',
  })
  @ApiOkResponse({ type: CartResponseDto })
  addItem(@CurrentUser() user: User, @Body() dto: AddToCartDto) {
    return this.cartService.addItem(user.id, dto);
  }

  @Put('items/:itemId')
  @ApiOperation({
    summary: 'Изменить количество позиции в корзине',
    description:
      'Меняет количество выбранной позиции в корзине по её id. Например, увеличить число штук ' +
      'товара. В ответ возвращается обновлённая корзина. Требует авторизации.',
  })
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
  @ApiOperation({
    summary: 'Удалить позицию из корзины',
    description:
      'Убирает одну конкретную позицию из корзины по её id. Остальные позиции остаются на ' +
      'месте. В ответ возвращается обновлённая корзина. Требует авторизации.',
  })
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
  @ApiOperation({
    summary: 'Очистить корзину',
    description:
      'Полностью удаляет все позиции из корзины пользователя — корзина становится пустой. ' +
      'Требует авторизации.',
  })
  @ApiOkResponse({ type: CartResponseDto })
  clearCart(@CurrentUser() user: User) {
    return this.cartService.clearCart(user.id);
  }
}
