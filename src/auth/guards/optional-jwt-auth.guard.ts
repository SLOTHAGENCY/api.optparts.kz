import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Like JwtAuthGuard but never rejects. If a valid Bearer token is present it
 * populates request.user; if the token is missing or invalid the request still
 * proceeds with request.user === undefined. Used on @Public() routes that want to
 * attribute the caller when logged in (e.g. GET /api/search -> search_log.userId).
 */
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  handleRequest(_err: any, user: any): any {
    return user || undefined;
  }
}
