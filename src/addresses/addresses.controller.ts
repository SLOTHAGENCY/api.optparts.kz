import {
  Controller, Get, Post, Put, Patch,
  Delete, Body, Param, HttpCode, HttpStatus, ParseUUIDPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
} from '@nestjs/swagger';
import { AddressesService } from './addresses.service';
import { CreateAddressDto } from './dto/create-address.dto';
import { UpdateAddressDto } from './dto/update-address.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';

@ApiTags('addresses')
@ApiBearerAuth()
@Controller('addresses')
export class AddressesController {
  constructor(private readonly addressesService: AddressesService) {}

  /** GET /addresses — list all addresses for current user */
  @Get()
  @ApiOperation({
    summary: 'Список адресов доставки пользователя',
    description:
      'Возвращает все сохранённые адреса доставки текущего пользователя. Из этого списка клиент ' +
      'выбирает, куда доставить заказ. Каждый пользователь видит только свои адреса. Требует авторизации.',
  })
  findAll(@CurrentUser() user: User) {
    return this.addressesService.findAllByUser(user.id);
  }

  /** GET /addresses/:id */
  @Get(':id')
  @ApiOperation({
    summary: 'Получить один адрес доставки по id',
    description:
      'Возвращает данные одного конкретного адреса доставки пользователя по его id. Если адрес ' +
      'не найден (или принадлежит другому пользователю) — вернётся ошибка 404. Требует авторизации.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 404, description: 'Адрес не найден.' })
  findOne(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.addressesService.findOne(id, user.id);
  }

  /** POST /addresses */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Добавить новый адрес доставки',
    description:
      'Сохраняет новый адрес доставки для текущего пользователя (город, улица, дом и т.д.). ' +
      'Адрес добавляется в личный список и потом доступен для выбора при оформлении заказа. ' +
      'Требует авторизации.',
  })
  create(@CurrentUser() user: User, @Body() dto: CreateAddressDto) {
    return this.addressesService.create(user.id, dto);
  }

  /** PUT /addresses/:id */
  @Put(':id')
  @ApiOperation({
    summary: 'Изменить адрес доставки',
    description:
      'Обновляет данные существующего адреса доставки по его id. Используется, чтобы исправить ' +
      'или дополнить ранее сохранённый адрес. Менять можно только свои адреса. Требует авторизации.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  update(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAddressDto,
  ) {
    return this.addressesService.update(id, user.id, dto);
  }

  /** PATCH /addresses/:id/main — set as main address */
  @Patch(':id/main')
  @ApiOperation({
    summary: 'Сделать адрес основным (по умолчанию)',
    description:
      'Помечает выбранный адрес как основной. Основной адрес автоматически подставляется при ' +
      'оформлении заказа. Основным может быть только один адрес: предыдущий основной перестаёт ' +
      'быть таковым. Требует авторизации.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  setMain(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.addressesService.setMain(id, user.id);
  }

  /** DELETE /addresses/:id */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Удалить адрес доставки',
    description:
      'Удаляет сохранённый адрес доставки по его id. Удалить можно только свой адрес. Требует авторизации.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  delete(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.addressesService.delete(id, user.id);
  }
}