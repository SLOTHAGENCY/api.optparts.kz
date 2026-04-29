import { NestFactory, Reflector } from '@nestjs/core';
import { ClassSerializerInterceptor } from '@nestjs/common';
import { useContainer } from 'class-validator';
import * as dotenv from 'dotenv';
import { AppModule } from './app.module';

dotenv.config();

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log', 'debug', 'verbose'],
  });

  // Fix: allows class-validator to use NestJS DI (required for custom validators)
  useContainer(app.select(AppModule), { fallbackOnErrors: true });

  app.setGlobalPrefix('api');

  app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));

  app.enableCors({
    origin: process.env.CORS_ORIGIN || '*',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  const port = parseInt(process.env.PORT, 10) || 3000;
  await app.listen(port);

  console.log(`\n🚀 App running on: http://localhost:${port}/api`);
  console.log(`\n📋 Auth routes:`);
  console.log(`   POST   /api/auth/register`);
  console.log(`   POST   /api/auth/login`);
  console.log(`   POST   /api/auth/logout`);
  console.log(`   GET    /api/auth/me`);
  console.log(`   GET    /api/auth/profile`);
  console.log(`   PUT    /api/auth/profile`);
  console.log(`   POST   /api/auth/profile/image`);
  console.log(`\n🛍️  Product routes:`);
  console.log(`   GET    /api/products`);
  console.log(`   GET    /api/products/:id`);
  console.log(`   POST   /api/products              [admin, manager]`);
  console.log(`   PUT    /api/products/:id           [admin, manager]`);
  console.log(`   POST   /api/products/:id/images    [admin, manager]`);
  console.log(`   DELETE /api/products/:id/images/:filename  [admin, manager]`);
  console.log(`   DELETE /api/products/:id           [admin]`);
  console.log(`\n🛒 Cart routes (auth required):`);
  console.log(`   GET    /api/cart`);
  console.log(`   POST   /api/cart/items`);
  console.log(`   PUT    /api/cart/items/:itemId`);
  console.log(`   DELETE /api/cart/items/:itemId`);
  console.log(`   DELETE /api/cart\n`);
}

bootstrap();
