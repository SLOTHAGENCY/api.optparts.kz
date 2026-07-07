import {
  Controller, Get, Post, Put, Patch,
  Delete, Body, Param, HttpCode, HttpStatus, ParseUUIDPipe,
} from '@nestjs/common';
import {
  ApiTags, ApiBearerAuth, ApiOperation, ApiParam, ApiResponse,
} from '@nestjs/swagger';
import { GarageService } from './garage.service';
import { CreateVehicleDto } from './dto/create-vehicle.dto';
import { UpdateVehicleDto } from './dto/update-vehicle.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';

@ApiTags('garage')
@ApiBearerAuth()
@Controller('garage')
export class GarageController {
  constructor(private readonly garageService: GarageService) {}

  @Get()
  @ApiOperation({
    summary: 'Список авто в гараже пользователя',
    description:
      'Возвращает все сохранённые автомобили текущего пользователя (его «гараж»). ' +
      'Каждый пользователь видит только свои авто. Требует авторизации.',
  })
  findAll(@CurrentUser() user: User) {
    return this.garageService.findAllByUser(user.id);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Получить одно авто по id',
    description:
      'Возвращает данные одного автомобиля из гаража по его id. Если авто не найдено ' +
      '(или принадлежит другому пользователю) — вернётся ошибка. Требует авторизации.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 404, description: 'Авто не найдено.' })
  findOne(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.garageService.findOne(id, user.id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Добавить авто в гараж',
    description:
      'Сохраняет новый автомобиль в гараж текущего пользователя. Обязателен только VIN; ' +
      'марка, модель, год и комплектация — по желанию. Требует авторизации.',
  })
  @ApiResponse({ status: 409, description: 'Это авто уже в гараже.' })
  create(@CurrentUser() user: User, @Body() dto: CreateVehicleDto) {
    return this.garageService.create(user.id, dto);
  }

  @Put(':id')
  @ApiOperation({
    summary: 'Изменить авто в гараже',
    description:
      'Обновляет данные автомобиля по его id. Менять можно только свои авто. Требует авторизации.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  update(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateVehicleDto,
  ) {
    return this.garageService.update(id, user.id, dto);
  }

  @Patch(':id/main')
  @ApiOperation({
    summary: 'Сделать авто основным',
    description:
      'Помечает выбранное авто как основное. Основным может быть только одно авто: ' +
      'предыдущее основное перестаёт быть таковым. Требует авторизации.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  setMain(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.garageService.setMain(id, user.id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Удалить авто из гаража',
    description: 'Удаляет автомобиль по его id. Удалить можно только своё авто. Требует авторизации.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  delete(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.garageService.delete(id, user.id);
  }
}
