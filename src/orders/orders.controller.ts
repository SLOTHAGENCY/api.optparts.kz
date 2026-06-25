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
  @ApiOperation({ summary: 'List the current user\'s orders' })
  findMyOrders(@CurrentUser() user: User) {
    return this.ordersService.findAllByUser(user.id);
  }

  /** GET /orders/all — all orders (admin/manager) */
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Get('all')
  @ApiOperation({ summary: 'List all orders across all users (MANAGER/ADMIN)' })
  @ApiResponse({ status: 403, description: 'Manager/Admin only.' })
  findAll() {
    return this.ordersService.findAll();
  }

  /** GET /orders/:id */
  @Get(':id')
  @ApiOperation({ summary: 'Get a single order (own order or admin/manager)' })
  @ApiParam({ name: 'id', description: 'Order id', format: 'uuid' })
  @ApiResponse({ status: 403, description: 'Not allowed to view this order.' })
  @ApiResponse({ status: 404, description: 'Order not found.' })
  findOne(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.ordersService.findOne(id, user.id);
  }

  /** POST /orders */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      'Place an aggregator order: final live re-check of the cart, then place with partners.',
  })
  @ApiResponse({ status: 201, description: 'Order created and placed with partners.' })
  @ApiResponse({
    status: 409,
    description:
      'Cart changed since last review (unavailable items / price changes) — order not created.',
  })
  create(@CurrentUser() user: User, @Body() dto: CreateOrderDto) {
    return this.ordersService.create(user.id, dto);
  }

  /** POST /orders/:id/suppliers/:sid/refresh-status — pull partner status (MANAGER/ADMIN) */
  @Roles(UserRole.MANAGER, UserRole.ADMIN)
  @Post(':id/suppliers/:sid/refresh-status')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refresh a sub-order status from the partner (MANAGER/ADMIN).' })
  @ApiParam({ name: 'id', description: 'Order id' })
  @ApiParam({ name: 'sid', description: 'Supplier sub-order id' })
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
  @ApiOperation({ summary: 'Retry placing a FAILED sub-order (MANAGER/ADMIN).' })
  @ApiParam({ name: 'id', description: 'Order id' })
  @ApiParam({ name: 'sid', description: 'Supplier sub-order id' })
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
    summary:
      'Request a return for a sub-order (semi-automatic: API where available, else manual) (MANAGER/ADMIN).',
  })
  @ApiParam({ name: 'id', description: 'Order id' })
  @ApiParam({ name: 'sid', description: 'Supplier sub-order id' })
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
  @ApiOperation({ summary: 'Update order status (MANAGER/ADMIN)' })
  @ApiParam({ name: 'id', description: 'Order id', format: 'uuid' })
  @ApiResponse({ status: 403, description: 'Manager/Admin only.' })
  updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateOrderStatusDto,
  ) {
    return this.ordersService.updateStatus(id, dto.status);
  }

  /** PATCH /orders/:id/cancel — user cancels own order */
  @Patch(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel an order (own order only, before fulfilment)' })
  @ApiParam({ name: 'id', description: 'Order id', format: 'uuid' })
  @ApiResponse({ status: 409, description: 'Order cannot be cancelled in its current state.' })
  cancel(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.ordersService.cancel(id, user.id);
  }

  /** PUT /orders/:id/comment — add or update manager comment */
  @Roles(UserRole.MANAGER, UserRole.ADMIN)
  @Put(':id/comment')
  @ApiOperation({ summary: 'Add or update a manager comment on an order (MANAGER/ADMIN)' })
  @ApiParam({ name: 'id', description: 'Order id', format: 'uuid' })
  @ApiResponse({ status: 403, description: 'Manager/Admin only.' })
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
  @ApiOperation({ summary: 'Delete a manager comment from an order (MANAGER/ADMIN)' })
  @ApiParam({ name: 'id', description: 'Order id', format: 'uuid' })
  @ApiResponse({ status: 403, description: 'Manager/Admin only.' })
  deleteComment(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.ordersService.deleteComment(id, user.id);
  }
}