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
  @ApiOperation({ summary: 'List all delivery addresses for the current user' })
  findAll(@CurrentUser() user: User) {
    return this.addressesService.findAllByUser(user.id);
  }

  /** GET /addresses/:id */
  @Get(':id')
  @ApiOperation({ summary: 'Get a single delivery address by id' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 404, description: 'Address not found.' })
  findOne(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.addressesService.findOne(id, user.id);
  }

  /** POST /addresses */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new delivery address' })
  create(@CurrentUser() user: User, @Body() dto: CreateAddressDto) {
    return this.addressesService.create(user.id, dto);
  }

  /** PUT /addresses/:id */
  @Put(':id')
  @ApiOperation({ summary: 'Replace a delivery address' })
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
  @ApiOperation({ summary: 'Set an address as the default delivery address' })
  @ApiParam({ name: 'id', format: 'uuid' })
  setMain(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.addressesService.setMain(id, user.id);
  }

  /** DELETE /addresses/:id */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a delivery address' })
  @ApiParam({ name: 'id', format: 'uuid' })
  delete(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.addressesService.delete(id, user.id);
  }
}