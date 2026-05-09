import {
  Controller, Get, Post, Put, Patch,
  Delete, Body, Param, HttpCode, HttpStatus, ParseUUIDPipe,
} from '@nestjs/common';
import { AddressesService } from './addresses.service';
import { CreateAddressDto } from './dto/create-address.dto';
import { UpdateAddressDto } from './dto/update-address.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';

@Controller('addresses')
export class AddressesController {
  constructor(private readonly addressesService: AddressesService) {}

  /** GET /addresses — list all addresses for current user */
  @Get()
  findAll(@CurrentUser() user: User) {
    return this.addressesService.findAllByUser(user.id);
  }

  /** GET /addresses/:id */
  @Get(':id')
  findOne(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.addressesService.findOne(id, user.id);
  }

  /** POST /addresses */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@CurrentUser() user: User, @Body() dto: CreateAddressDto) {
    return this.addressesService.create(user.id, dto);
  }

  /** PUT /addresses/:id */
  @Put(':id')
  update(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAddressDto,
  ) {
    return this.addressesService.update(id, user.id, dto);
  }

  /** PATCH /addresses/:id/main — set as main address */
  @Patch(':id/main')
  setMain(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.addressesService.setMain(id, user.id);
  }

  /** DELETE /addresses/:id */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  delete(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.addressesService.delete(id, user.id);
  }
}