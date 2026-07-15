import {
  Body, Controller, Get, HttpCode, HttpStatus,
  Param, ParseUUIDPipe, Post, UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiParam, ApiResponse } from '@nestjs/swagger';
import { PaymentsService } from './payments.service';
import { RefundDto } from './dto/refund.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { User, UserRole } from '../users/entities/user.entity';

@ApiTags('payments')
@ApiBearerAuth()
@Controller('payments')
@UseGuards(RolesGuard)
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post('init')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Подготовить оплату заказа',
    description:
      'Возвращает параметры для платёжного виджета TipTopPay по заказу, ожидающему оплаты: ' +
      'идентификатор терминала, номер счёта и сумму. Сумма берётся из самого заказа — ' +
      'передать свою нельзя. Требует авторизации; заказ должен принадлежать пользователю.',
  })
  @ApiResponse({ status: 400, description: 'Заказ не ожидает оплаты.' })
  @ApiResponse({ status: 403, description: 'Это не ваш заказ.' })
  init(@CurrentUser() user: User, @Body('orderId', ParseUUIDPipe) orderId: string) {
    return this.payments.init(orderId, user.id);
  }

  @Get(':orderId')
  @ApiOperation({
    summary: 'Статус оплаты заказа',
    description:
      'Возвращает платёж по заказу: статус, сумму, сумму возврата, последние 4 цифры карты. ' +
      'Свой заказ видит владелец, любой — менеджер и администратор.',
  })
  @ApiParam({ name: 'orderId', format: 'uuid' })
  getByOrder(
    @CurrentUser() user: User,
    @Param('orderId', ParseUUIDPipe) orderId: string,
  ) {
    const isStaff = user.roles.some(
      (r) => r === UserRole.ADMIN || r === UserRole.MANAGER,
    );
    return this.payments.getByOrder(orderId, user.id, isStaff);
  }

  @Roles(UserRole.MANAGER, UserRole.ADMIN)
  @Post(':orderId/refund')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Вернуть деньги по заказу (менеджер/админ)',
    description:
      'Делает возврат на карту клиента через TipTopPay — полный или частичный. ' +
      'Используется, когда поставщик не смог выполнить заказ. Сумма не может превышать ' +
      'невозвращённый остаток платежа. Доступно только менеджеру или администратору.',
  })
  @ApiParam({ name: 'orderId', format: 'uuid' })
  @ApiResponse({ status: 400, description: 'Заказ не оплачен или сумма больше остатка.' })
  refund(@Param('orderId', ParseUUIDPipe) orderId: string, @Body() dto: RefundDto) {
    return this.payments.refund(orderId, dto.amount, dto.reason ?? null);
  }
}
