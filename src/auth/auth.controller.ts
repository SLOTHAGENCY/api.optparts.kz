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
  @ApiOperation({ summary: 'Register a new user account' })
  @ApiResponse({ status: 201, description: 'Registration successful.' })
  @ApiResponse({ status: 400, description: 'Validation error or email already in use.' })
  async register(@Body() dto: RegisterDto) {
    const { accessToken, user } = await this.authService.register(dto);
    return { message: 'Registration successful.', accessToken, user };
  }

  /** POST /auth/login */
  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Log in and receive a JWT access token' })
  @ApiResponse({ status: 200, description: 'Login successful.' })
  @ApiResponse({ status: 401, description: 'Invalid credentials.' })
  async login(@Body() dto: LoginDto) {
    const user = await this.usersService.findByEmail(dto.email);
    const { accessToken } = await this.authService.login(user);
    return { message: 'Login successful.', accessToken, user };
  }

  /** POST /auth/logout */
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Log out (client should discard the JWT)' })
  logout() {
    return { message: 'Logged out successfully. Please discard your token.' };
  }

  /** GET /auth/profile */
  @Get('profile')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get the current user profile' })
  profile(@CurrentUser() user: User) {
    return { user };
  }

  /** PUT /auth/profile */
  @Put('profile')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update current user profile (email, name)' })
  async updateProfile(@CurrentUser() user: User, @Body() dto: UpdateProfileDto) {
    dto.currentUserId = user.id;  // ← validator reads this to allow same-user email

    const updated = await this.usersService.update(user.id, {
      ...(dto.email && { email: dto.email }),
      ...(dto.firstName && { firstName: dto.firstName }),
      ...(dto.lastName && { lastName: dto.lastName }),
    });
    return { message: 'Profile updated successfully.', user: updated };
  }

  /** POST /auth/profile/image */
  @Post('profile/image')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Upload a profile avatar image (multipart/form-data)' })
  @ApiConsumes('multipart/form-data')
  @ApiResponse({ status: 200, description: 'Profile image updated.' })
  @ApiResponse({ status: 400, description: 'Only image files are allowed (max 5 MB).' })
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
