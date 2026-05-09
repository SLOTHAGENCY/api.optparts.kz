import {
  Controller, Get, Post, Patch, Body,
  Param, HttpCode, HttpStatus, ParseUUIDPipe, UseGuards,
} from '@nestjs/common';
import { OrdersService } from './orders.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { User, UserRole } from '../users/entities/user.entity';

@Controller('orders')
@UseGuards(RolesGuard)
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  /** GET /orders — current user's orders */
  @Get()
  findMyOrders(@CurrentUser() user: User) {
    return this.ordersService.findAllByUser(user.id);
  }

  /** GET /orders/all — all orders (admin/manager) */
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Get('all')
  findAll() {
    return this.ordersService.findAll();
  }

  /** GET /orders/:id */
  @Get(':id')
  findOne(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.ordersService.findOne(id, user.id);
  }

  /** POST /orders */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@CurrentUser() user: User, @Body() dto: CreateOrderDto) {
    return this.ordersService.create(user.id, dto);
  }

  /** PATCH /orders/:id/status — admin/manager update status */
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Patch(':id/status')
  updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateOrderStatusDto,
  ) {
    return this.ordersService.updateStatus(id, dto.status);
  }

  /** PATCH /orders/:id/cancel — user cancels own order */
  @Patch(':id/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.ordersService.cancel(id, user.id);
  }
}