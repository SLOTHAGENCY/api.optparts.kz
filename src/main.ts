// Load .env BEFORE importing AppModule: app.module.ts reads process.env at module
// decoration time (e.g. the SERVE_TEST_FRONTEND ServeStatic toggle).
import 'dotenv/config';
import { NestFactory, Reflector } from '@nestjs/core';
import { ClassSerializerInterceptor, ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { useContainer } from 'class-validator';
import { AppModule } from './app.module';

async function bootstrap() {
  // TipTopPay signs webhooks with an HMAC over the RAW request body. `rawBody: true` makes
  // Nest's own global body parsers stash the untouched buffer on `req.rawBody` (read by the
  // webhook controller for signature verification) for every route.
  //
  // Do NOT reintroduce a path-scoped `app.use('/api/payments/webhook', express.json(...))`:
  // its middleware is named `jsonParser`/`urlencodedParser`, and Nest's ExpressAdapter skips
  // registering its GLOBAL parsers whenever a middleware with that name already exists —
  // matching on name only, ignoring the mounted path. That silently disables body parsing on
  // every OTHER route (login/register bodies arrive as `{}`).
  const app = await NestFactory.create(AppModule, { rawBody: true });

  // const app = await NestFactory.create(AppModule, {
  //   logger: ['error', 'warn', 'log', 'debug', 'verbose'],
  // });

  // Fix: allows class-validator to use NestJS DI (required for custom validators)
  useContainer(app.select(AppModule), { fallbackOnErrors: true });

  app.setGlobalPrefix('api');

  const swaggerConfig = new DocumentBuilder()
    .setTitle('OptParts Aggregator API')
    .setDescription('Multi-supplier auto-parts aggregator: search, cart, orders, admin.')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document);

  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
  app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));

  app.enableCors({
    origin: process.env.CORS_ORIGIN || '*',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  const port = parseInt(process.env.PORT, 10) || 3000;
  await app.listen(port);
}

bootstrap();
