import {
  Controller,
  Post,
  Get,
  Put,
  Body,
  HttpCode,
  HttpStatus,
  UseInterceptors,
  ClassSerializerInterceptor,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiConsumes,
} from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { Public } from './decorators/public.decorator';
import { CurrentUser } from './decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';

@ApiTags('auth')
@Controller('auth')
@UseInterceptors(ClassSerializerInterceptor)
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly usersService: UsersService,
  ) {}

  /** POST /auth/register */
  @Public()
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Регистрация нового пользователя',
    description:
      'Создаёт новый аккаунт по email, паролю и имени. При успешной регистрации сразу ' +
      'возвращает токен доступа (accessToken) — его нужно сохранить и подставлять во все ' +
      'последующие запросы, требующие авторизации. Email должен быть уникальным: если такой ' +
      'адрес уже занят, вернётся ошибка. Регистрироваться может любой, авторизация не требуется.',
  })
  @ApiResponse({ status: 201, description: 'Регистрация прошла успешно — возвращены токен и данные пользователя.' })
  @ApiResponse({ status: 400, description: 'Ошибка в данных или email уже используется.' })
  async register(@Body() dto: RegisterDto) {
    const { accessToken, user } = await this.authService.register(dto);
    return { message: 'Registration successful.', accessToken, user };
  }

  /** POST /auth/login */
  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Вход в систему и получение токена',
    description:
      'Проверяет email и пароль. Если данные верны, возвращает токен доступа (accessToken) и ' +
      'информацию о пользователе. Токен нужно прикладывать к защищённым запросам в заголовке ' +
      'Authorization: Bearer <токен>. Если email или пароль неверные — вернётся ошибка 401.',
  })
  @ApiResponse({ status: 200, description: 'Вход выполнен — возвращены токен и данные пользователя.' })
  @ApiResponse({ status: 401, description: 'Неверный email или пароль.' })
  async login(@Body() dto: LoginDto) {
    const user = await this.usersService.findByEmail(dto.email);
    const { accessToken } = await this.authService.login(user);
    return { message: 'Login successful.', accessToken, user };
  }

  /** POST /auth/logout */
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Выход из системы',
    description:
      'Завершает сессию. Сервер не хранит токены, поэтому фактический выход — это удаление ' +
      'токена на стороне клиента (из памяти приложения, localStorage и т.п.). Метод просто ' +
      'подтверждает, что токен больше можно не использовать.',
  })
  logout() {
    return { message: 'Logged out successfully. Please discard your token.' };
  }

  /** GET /auth/profile */
  @Get('profile')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Получить профиль текущего пользователя',
    description:
      'Возвращает данные пользователя, которому принадлежит переданный токен: email, имя, ' +
      'роль, аватар и прочие поля профиля. Используется, чтобы показать в интерфейсе, кто ' +
      'сейчас в системе. Требует авторизации.',
  })
  profile(@CurrentUser() user: User) {
    return { user };
  }

  /** PUT /auth/profile */
  @Put('profile')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Изменить профиль (email, имя, фамилия)',
    description:
      'Обновляет данные текущего пользователя. Можно прислать только те поля, которые нужно ' +
      'поменять — остальные останутся прежними. При смене email он проверяется на уникальность, ' +
      'но оставить свой текущий email разрешено. Требует авторизации.',
  })
  async updateProfile(@CurrentUser() user: User, @Body() dto: UpdateProfileDto) {
    dto.currentUserId = user.id;  // ← validator reads this to allow same-user email

    const updated = await this.usersService.update(user.id, {
      ...(dto.email && { email: dto.email }),
      ...(dto.firstName && { firstName: dto.firstName }),
      ...(dto.lastName && { lastName: dto.lastName }),
      ...(dto.phones && { phones: dto.phones }),
    });
    return { message: 'Profile updated successfully.', user: updated };
  }

  /** POST /auth/profile/image */
  @Post('profile/image')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Загрузить аватар (фото профиля)',
    description:
      'Загружает изображение профиля через форму multipart/form-data (поле "image"). ' +
      'Принимаются только файлы-картинки размером до 5 МБ. После загрузки путь к файлу ' +
      'сохраняется в профиле, и аватар становится доступен по ссылке из ответа. Требует авторизации.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiResponse({ status: 200, description: 'Аватар обновлён.' })
  @ApiResponse({ status: 400, description: 'Разрешены только изображения (максимум 5 МБ).' })
  @UseInterceptors(
    FileInterceptor('image', {
      storage: diskStorage({
        destination: './uploads/avatars',
        filename: (_req, file, cb) => {
          const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
          cb(null, `${unique}${extname(file.originalname)}`);
        },
      }),
      fileFilter: (_req, file, cb) => {
        if (!file.mimetype.match(/^image\//)) {
          return cb(new Error('Only image files are allowed.'), false);
        }
        cb(null, true);
      },
      limits: { fileSize: 5 * 1024 * 1024 },
    }),
  )
  async uploadProfileImage(
    @CurrentUser() user: User,
    @UploadedFile() file: Express.Multer.File,
  ) {
    const filepath = `/uploads/avatars/${file.filename}`;  // ← full accessible path
    const updated = await this.usersService.update(user.id, { profileImage: filepath });
    return { message: 'Profile image updated.', user: updated };
  }
}
