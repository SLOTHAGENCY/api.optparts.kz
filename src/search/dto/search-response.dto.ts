import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class OfferDto {
  @ApiProperty({ description: 'Уникальный идентификатор предложения (служебный код, base64url)' })
  offerId: string;

  @ApiProperty({ description: 'Код поставщика', example: 'rossko' })
  supplierCode: string;

  @ApiProperty({ description: 'Название поставщика', example: 'Rossko' })
  supplierName: string;

  @ApiProperty({ description: 'Цена продажи (уже с наценкой). Закупочная цена клиенту никогда не показывается.', example: 6240 })
  sellPrice: number;

  @ApiProperty({ description: 'Срок поставки в днях', example: 3 })
  deliveryDays: number;

  @ApiProperty({ description: 'Количество в наличии', example: 10 })
  count: number;

  @ApiProperty({ description: 'Кратность заказа (товар заказывается партиями по N штук)', example: 1 })
  multiplicity: number;

  @ApiProperty({ description: 'Идентификатор склада поставщика', example: 's1' })
  warehouseId: string;

  @ApiProperty({
    description:
      'Служебные данные предложения от поставщика. Фронтенд ОБЯЗАН вернуть это предложение ' +
      '(вместе с offerId и raw) без изменений при добавлении товара в корзину.',
    type: 'object',
    additionalProperties: true,
  })
  raw: Record<string, unknown>;
}

export class SearchGroupDto {
  @ApiProperty({ description: 'Артикул детали', example: '0451103316' })
  article: string;

  @ApiProperty({ description: 'Бренд (производитель)', example: 'BOSCH' })
  brand: string;

  @ApiProperty({ description: 'Название товара', example: 'Oil Filter' })
  name: string;

  @ApiProperty({ description: 'Предложения от поставщиков по этому товару', type: [OfferDto] })
  offers: OfferDto[];

  @ApiPropertyOptional({
    description:
      'Картинка детали (только у exact-групп, best-effort из PartsIndex). ' +
      'Отсутствует/null, если картинки нет или обогащение не удалось.',
    nullable: true,
    example: 'https://img.parts-index.com/parts/0451103316.jpg',
  })
  image?: string | null;
}

export class ActiveSupplierDto {
  @ApiProperty({ description: 'Код поставщика', example: 'shatem' })
  code: string;

  @ApiProperty({ description: 'Название поставщика', example: 'SHATE-M' })
  name: string;
}

export class SupplierOfferItemDto {
  @ApiProperty({ description: 'Артикул детали', example: '0451103316' })
  article: string;

  @ApiProperty({ description: 'Бренд (производитель)', example: 'BOSCH' })
  brand: string;

  @ApiProperty({ description: 'Название товара', example: 'Oil Filter' })
  name: string;

  @ApiProperty({ description: 'true, если это аналог (заменитель), а не точное совпадение', example: false })
  isAnalog: boolean;

  @ApiProperty({ description: 'Предложение поставщика', type: OfferDto })
  offer: OfferDto;
}

export class SupplierSearchResponseDto {
  @ApiProperty({ description: 'Код поставщика', example: 'shatem' })
  supplierCode: string;

  @ApiProperty({
    description: 'false, если поставщик не ответил / упал / вышел за таймаут (offers будет пустым)',
    example: true,
  })
  ok: boolean;

  @ApiProperty({
    description: 'Плоский (несгруппированный) список предложений этого поставщика',
    type: [SupplierOfferItemDto],
  })
  offers: SupplierOfferItemDto[];
}

export class SearchQueryEchoDto {
  @ApiProperty({ description: 'Артикул, по которому искали', example: '0451103316' })
  article: string;

  @ApiProperty({ description: 'Бренд, по которому искали (если был указан)', example: 'BOSCH', nullable: true })
  brand: string | null;
}

export class SearchResponseDto {
  @ApiProperty({ description: 'Повтор поискового запроса (что именно искали)', type: SearchQueryEchoDto })
  query: SearchQueryEchoDto;

  @ApiProperty({ description: 'Точные совпадения по артикулу', type: [SearchGroupDto] })
  exact: SearchGroupDto[];

  @ApiProperty({ description: 'Аналоги (заменители, подходящие вместо искомой детали)', type: [SearchGroupDto] })
  analogs: SearchGroupDto[];
}
