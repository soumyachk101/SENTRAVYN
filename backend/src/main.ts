import 'reflect-metadata';
import { ValidationPipe, Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const logger = new Logger('SENTRAVYN-API');
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn'] });

  // Security: strict DTO validation at the API boundary (SECURITY.md 3).
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );
  // Security: strict CORS allowlist (SECURITY.md 3).
  app.enableCors({
    origin: process.env.WEB_BASE_URL ? [process.env.WEB_BASE_URL] : false,
    credentials: false,
  });

  // Versioned routes under /api/v1 (ARCHITECTURE.md 8).
  app.setGlobalPrefix('api/v1');

  const config = app.get(ConfigService);
  const port = Number(config.get<string>('API_PORT') ?? 4000);

  // OpenAPI (ARCHITECTURE.md 8): versioned routes under /api/v1.
  const swaggerConfig = new DocumentBuilder()
    .setTitle('SENTRAVYN API')
    .setDescription(
      'Global Emergency Intelligence & Public Safety Platform. ' +
        'All emergency content is source-backed, timestamped and explicit about uncertainty.',
    )
    .setVersion('1.0')
    .setContact('SENTRAVYN Engineering', '', 'engineering@sentravyn.example')
    .setLicense('Proprietary', '')
    .addServer(`http://localhost:${port}/api/v1`)
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api-docs', app, document);

  await app.listen(port);
  logger.log(`SENTRAVYN API listening on port ${port} (OpenAPI at /api-docs)`);
}

void bootstrap();
