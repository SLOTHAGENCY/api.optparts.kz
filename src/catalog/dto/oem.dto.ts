import { ApiProperty } from '@nestjs/swagger';

export class OemCatalogDto {
  @ApiProperty({ description: 'Идентификатор каталога (марки)', example: 'bmw' })
  id: string;

  @ApiProperty({ description: 'Название каталога', example: 'BMW' })
  name: string;

  @ApiProperty({ description: 'Кол-во моделей', example: 20 })
  modelsCount: number;

  @ApiProperty({ description: 'Актуальность данных', example: '2025-3', nullable: true })
  actuality: string | null;

  @ApiProperty({ description: 'Поддерживается поиск по VIN', example: true })
  hasVinCheck: boolean;

  @ApiProperty({ description: 'Поддерживается поиск по номеру кузова (FRAME)', example: false })
  hasFrameCheck: boolean;
}

export class OemModelDto {
  @ApiProperty({ description: 'Идентификатор модели (нестабилен)', example: 'd3190764f126fabb' })
  id: string;

  @ApiProperty({ description: 'Название модели', example: '3 Series' })
  name: string;

  @ApiProperty({ description: 'URL изображения модели', nullable: true })
  img: string | null;
}

export class OemCarParameterValueDto {
  @ApiProperty({ description: 'Идентификатор значения (idx) для фильтра cars', example: '5651b9c4e2f5' })
  idx: string;

  @ApiProperty({ description: 'Отображаемое значение', example: '2015' })
  value: string;
}

export class OemCarParameterDto {
  @ApiProperty({ description: 'Ключ параметра', example: 'year' })
  key: string;

  @ApiProperty({ description: 'Название параметра', example: 'Год' })
  name: string;

  @ApiProperty({ description: 'Возможные значения', type: [OemCarParameterValueDto] })
  values: OemCarParameterValueDto[];
}

export class OemCarParamPairDto {
  @ApiProperty({ example: 'engine' })
  key: string;

  @ApiProperty({ example: 'Двигатель' })
  name: string;

  @ApiProperty({ example: 'N52B30' })
  value: string;
}

export class OemCarDto {
  @ApiProperty({ description: 'Идентификатор авто (нестабилен, меняется при обновлении каталога)', example: 'car123' })
  id: string;

  @ApiProperty({ description: 'Идентификатор каталога', example: 'bmw' })
  catalogId: string;

  @ApiProperty({ description: 'Название конфигурации авто', example: '320i Sedan' })
  name: string;

  @ApiProperty({ description: 'Идентификатор модели', nullable: true })
  modelId: string | null;

  @ApiProperty({ description: 'Название модели', nullable: true })
  modelName: string | null;

  @ApiProperty({ description: 'VIN', nullable: true })
  vin: string | null;

  @ApiProperty({ description: 'Номер кузова (FRAME)', nullable: true })
  frame: string | null;

  @ApiProperty({ description: 'Критерий фильтрации групп/деталей (из VIN)', nullable: true })
  criteria: string | null;

  @ApiProperty({ description: 'Марка', nullable: true })
  brand: string | null;

  @ApiProperty({ description: 'Доступно ли дерево групп', example: true })
  groupsTreeAvailable: boolean;

  @ApiProperty({ description: 'Параметры конфигурации', type: [OemCarParamPairDto] })
  parameters: OemCarParamPairDto[];
}

export class VinCarDto {
  @ApiProperty({ description: 'Идентификатор каталога', example: 'bmw' })
  catalogId: string;

  @ApiProperty({ description: 'Идентификатор авто (для дальнейшего дерева/деталей)', nullable: true })
  carId: string | null;

  @ApiProperty({ description: 'Заголовок авто', example: 'BMW 320i (F30)' })
  title: string;

  @ApiProperty({ description: 'Марка', nullable: true })
  brand: string | null;

  @ApiProperty({ description: 'Идентификатор модели', nullable: true })
  modelId: string | null;

  @ApiProperty({ description: 'Название модели', nullable: true })
  modelName: string | null;

  @ApiProperty({ description: 'Критерий фильтрации групп/деталей', nullable: true })
  criteria: string | null;

  @ApiProperty({ description: 'VIN', nullable: true })
  vin: string | null;

  @ApiProperty({ description: 'Номер кузова (FRAME)', nullable: true })
  frame: string | null;
}

export class VinValidationErrorDto {
  @ApiProperty({ example: 'VCx1700' })
  errorCode: string;

  @ApiProperty({ example: 'Число символов должно быть равно 17.' })
  errorTranslate: string;

  @ApiProperty({ type: [String], example: ['Заменены символы: Q -> 0'] })
  details: string[];
}

export class VinValidationDto {
  @ApiProperty({ description: 'Нормализованный VIN', example: 'WBAAV33403FD12345' })
  changed: string;

  @ApiProperty({ description: 'Исходный VIN', example: 'WBAAV33403FDI2345' })
  original: string;

  @ApiProperty({ description: 'Ошибки валидации', type: [VinValidationErrorDto] })
  errors: VinValidationErrorDto[];
}

export class OemGroupDto {
  @ApiProperty({ description: 'Идентификатор группы (узла)', example: 'MfCfmoAxMjI4fEE' })
  id: string;

  @ApiProperty({ description: 'Идентификатор родительской группы', nullable: true })
  parentId: string | null;

  @ApiProperty({ description: 'Название узла', example: 'Тормозная система' })
  name: string;

  @ApiProperty({ description: 'URL изображения узла', nullable: true })
  img: string | null;

  @ApiProperty({ description: 'Есть вложенные группы', example: true })
  hasSubgroups: boolean;

  @ApiProperty({ description: 'Есть детали (лист дерева)', example: false })
  hasParts: boolean;
}

export class OemPartPositionDto {
  @ApiProperty({ description: 'Номер позиции на схеме', example: '1' })
  number: string;

  @ApiProperty({ description: 'X, px от левого верхнего угла', example: 120 })
  x: number;

  @ApiProperty({ description: 'Y, px от левого верхнего угла', example: 240 })
  y: number;

  @ApiProperty({ description: 'Высота блока, px', example: 30 })
  h: number;

  @ApiProperty({ description: 'Ширина блока, px', example: 40 })
  w: number;
}

export class OemPartDto {
  @ApiProperty({ description: 'Идентификатор детали', example: 'p1' })
  id: string;

  @ApiProperty({ description: 'Название детали', example: 'Тормозной диск' })
  name: string;

  @ApiProperty({ description: 'OEM-номер детали (ключ связи с ценами поставщиков)', example: '34116792217' })
  number: string;

  @ApiProperty({ description: 'Номер позиции на схеме', nullable: true })
  positionNumber: string | null;

  @ApiProperty({ description: 'Короткая заметка', nullable: true })
  notice: string | null;

  @ApiProperty({ description: 'Описание/применяемость/замены', nullable: true })
  description: string | null;
}

export class OemPartGroupDto {
  @ApiProperty({ nullable: true })
  name: string | null;

  @ApiProperty({ nullable: true })
  number: string | null;

  @ApiProperty({ nullable: true })
  positionNumber: string | null;

  @ApiProperty({ nullable: true })
  description: string | null;

  @ApiProperty({ type: [OemPartDto] })
  parts: OemPartDto[];
}

export class OemPartsDto {
  @ApiProperty({ description: 'URL изображения узла (полноразмерное)', nullable: true })
  img: string | null;

  @ApiProperty({ description: 'Описание изображения', nullable: true })
  imgDescription: string | null;

  @ApiProperty({ description: 'Марка', nullable: true })
  brand: string | null;

  @ApiProperty({ description: 'Координаты хот-спотов на изображении', type: [OemPartPositionDto] })
  positions: OemPartPositionDto[];

  @ApiProperty({ description: 'Группы деталей узла', type: [OemPartGroupDto] })
  partGroups: OemPartGroupDto[];
}
