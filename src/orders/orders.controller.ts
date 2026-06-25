import {
  Controller, Get, Post, Patch, Body, Put, Delete,
  Param, HttpCode, HttpStatus, ParseUUIDPipe, UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
} from '@nestjs/swagger';
import { OrdersService } from './orders.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { RequestReturnDto } from './dto/request-return.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { User, UserRole } from '../users/entities/user.entity';
import { UpsertCommentDto } from './dto/upsert-comment.dto';

@ApiTags('orders')
@ApiBearerAuth()
@Controller('orders')
@UseGuards(RolesGuard)
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  /** GET /orders — current user's orders */
  @Get()
  @ApiOperation({
    summary: 'Мои заказы',
    description:
      'Возвращает список всех заказов текущего пользователя — историю его покупок со статусами, ' +
      'суммами и составом. Каждый пользователь видит только свои заказы. Требует авторизации.',
  })
  findMyOrders(@CurrentUser() user: User) {
    return this.ordersService.findAllByUser(user.id);
  }

  /** GET /orders/all — all orders (admin/manager) */
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Get('all')
  @ApiOperation({
    summary: 'Все заказы (менеджер/админ)',
    description:
      'Возвращает заказы всех пользователей системы — для обработки и контроля сотрудниками. ' +
      'Доступно только менеджеру или администратору; обычному пользователю вернётся ошибка 403.',
  })
  @ApiResponse({ status: 403, description: 'Только для менеджера/администратора.' })
  findAll() {
    return this.ordersService.findAll();
  }

  /** GET /orders/:id */
  @Get(':id')
  @ApiOperation({
    summary: 'Получить один заказ',
    description:
      'Возвращает подробности конкретного заказа по его id: состав, суммы, статусы, разбивку по ' +
      'поставщикам. Обычный пользователь может открыть только свой заказ; менеджер и ' +
      'администратор — любой. При попытке посмотреть чужой заказ вернётся ошибка 403, а если ' +
      'заказа нет — 404.',
  })
  @ApiParam({ name: 'id', description: 'ID заказа', format: 'uuid' })
  @ApiResponse({ status: 403, description: 'Нет доступа к этому заказу.' })
  @ApiResponse({ status: 404, description: 'Заказ не найден.' })
  findOne(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.ordersService.findOne(id, user.id);
  }

  /** POST /orders */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Оформить заказ',
    description:
      'Создаёт заказ из текущей корзины. Перед оформлением система ещё раз сверяет всю корзину с ' +
      'поставщиками: проверяет наличие и цены. Если всё совпадает — заказ создаётся и ' +
      'автоматически размещается у соответствующих поставщиков (один заказ может разбиться на ' +
      'несколько под-заказов по разным поставщикам). Если за время оформления что-то изменилось ' +
      '(товар закончился или цена выросла), заказ не создаётся и возвращается ошибка 409 — нужно ' +
      'пересмотреть корзину. Требует авторизации.',
  })
  @ApiResponse({ status: 201, description: 'Заказ создан и размещён у поставщиков.' })
  @ApiResponse({
    status: 409,
    description:
      'Корзина изменилась с момента последней проверки (нет в наличии / изменилась цена) — заказ не создан.',
  })
  create(@CurrentUser() user: User, @Body() dto: CreateOrderDto) {
    return this.ordersService.create(user.id, dto);
  }

  /** POST /orders/:id/suppliers/:sid/refresh-status — pull partner status (MANAGER/ADMIN) */
  @Roles(UserRole.MANAGER, UserRole.ADMIN)
  @Post(':id/suppliers/:sid/refresh-status')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Обновить статус под-заказа у поставщика (менеджер/админ)',
    description:
      'Запрашивает у поставщика актуальный статус его части заказа (под-заказа) и обновляет его ' +
      'в системе. Полезно, чтобы узнать, собран ли заказ, отгружен и т.д., не дожидаясь ' +
      'автоматического обновления. Доступно только менеджеру или администратору.',
  })
  @ApiParam({ name: 'id', description: 'ID заказа' })
  @ApiParam({ name: 'sid', description: 'ID под-заказа поставщика' })
  refreshSupplierStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('sid', ParseUUIDPipe) sid: string,
  ) {
    return this.ordersService.refreshSupplierStatus(id, sid);
  }

  /** POST /orders/:id/suppliers/:sid/retry — retry a FAILED sub-order (MANAGER/ADMIN) */
  @Roles(UserRole.MANAGER, UserRole.ADMIN)
  @Post(':id/suppliers/:sid/retry')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Повторить размещение под-заказа со статусом FAILED (менеджер/админ)',
    description:
      'Пытается заново разместить у поставщика под-заказ, который ранее не удалось оформить ' +
      '(статус FAILED) — например, из-за временной ошибки на стороне поставщика. Доступно ' +
      'только менеджеру или администратору.',
  })
  @ApiParam({ name: 'id', description: 'ID заказа' })
  @ApiParam({ name: 'sid', description: 'ID под-заказа поставщика' })
  retrySupplierOrder(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('sid', ParseUUIDPipe) sid: string,
  ) {
    return this.ordersService.retrySupplierOrder(id, sid);
  }

  /** POST /orders/:id/suppliers/:sid/return — request a return (MANAGER/ADMIN) */
  @Roles(UserRole.MANAGER, UserRole.ADMIN)
  @Post(':id/suppliers/:sid/return')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Оформить возврат по под-заказу (менеджер/админ)',
    description:
      'Создаёт запрос на возврат товара по конкретному под-заказу поставщика. Работает ' +
      'полуавтоматически: если у поставщика есть API для возвратов — запрос отправляется ' +
      'автоматически; если нет — возврат фиксируется для ручной обработки менеджером. Доступно ' +
      'только менеджеру или администратору.',
  })
  @ApiParam({ name: 'id', description: 'ID заказа' })
  @ApiParam({ name: 'sid', description: 'ID под-заказа поставщика' })
  requestSupplierReturn(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('sid', ParseUUIDPipe) sid: string,
    @Body() dto: RequestReturnDto,
  ) {
    return this.ordersService.requestSupplierReturn(id, sid, dto);
  }

  /** PATCH /orders/:id/status — admin/manager update status */
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Patch(':id/status')
  @ApiOperation({
    summary: 'Изменить статус заказа (менеджер/админ)',
    description:
      'Вручную меняет статус заказа (например, «в обработке», «отправлен», «доставлен»). ' +
      'Используется сотрудниками для ведения заказа по этапам. Доступно только менеджеру или ' +
      'администратору.',
  })
  @ApiParam({ name: 'id', description: 'ID заказа', format: 'uuid' })
  @ApiResponse({ status: 403, description: 'Только для менеджера/администратора.' })
  updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateOrderStatusDto,
  ) {
    return this.ordersService.updateStatus(id, dto.status);
  }

  /** PATCH /orders/:id/cancel — user cancels own order */
  @Patch(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Отменить заказ (свой, до начала выполнения)',
    description:
      'Позволяет пользователю отменить собственный заказ, пока он ещё не отправлен в работу к ' +
      'поставщикам. Если заказ уже выполняется или завершён, отменить его нельзя — вернётся ' +
      'ошибка 409. Требует авторизации.',
  })
  @ApiParam({ name: 'id', description: 'ID заказа', format: 'uuid' })
  @ApiResponse({ status: 409, description: 'Заказ нельзя отменить в его текущем статусе.' })
  cancel(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.ordersService.cancel(id, user.id);
  }

  /** PUT /orders/:id/comment — add or update manager comment */
  @Roles(UserRole.MANAGER, UserRole.ADMIN)
  @Put(':id/comment')
  @ApiOperation({
    summary: 'Добавить или изменить комментарий менеджера к заказу (менеджер/админ)',
    description:
      'Сохраняет внутренний комментарий к заказу — заметку сотрудника (например, о ' +
      'договорённостях с клиентом или особенностях доставки). Если комментарий уже есть, он ' +
      'будет перезаписан. Доступно только менеджеру или администратору.',
  })
  @ApiParam({ name: 'id', description: 'ID заказа', format: 'uuid' })
  @ApiResponse({ status: 403, description: 'Только для менеджера/администратора.' })
  upsertComment(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpsertCommentDto,
  ) {
    return this.ordersService.upsertComment(id, user.id, dto.comment);
  }

  /** DELETE /orders/:id/comment — remove manager's own comment */
  @Roles(UserRole.MANAGER, UserRole.ADMIN)
  @Delete(':id/comment')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Удалить комментарий менеджера из заказа (менеджер/админ)',
    description:
      'Удаляет ранее оставленный внутренний комментарий менеджера к заказу. Сам заказ не ' +
      'меняется. Доступно только менеджеру или администратору.',
  })
  @ApiParam({ name: 'id', description: 'ID заказа', format: 'uuid' })
  @ApiResponse({ status: 403, description: 'Только для менеджера/администратора.' })
  deleteComment(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.ordersService.deleteComment(id, user.id);
  }
}