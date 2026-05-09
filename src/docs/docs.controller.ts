import { Controller, Get, Res } from '@nestjs/common';
import { Response } from 'express';
import { join } from 'path';
import { createReadStream, existsSync } from 'fs';
import { Public } from '../auth/decorators/public.decorator';

@Controller()
export class DocsController {
  /** GET /api/docs — Stoplight Elements UI */
  @Public()
  @Get('docs')
  getDocs(@Res() res: Response) {
    res.setHeader('Content-Type', 'text/html');
    res.send(`<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />
    <title>optparts.kz — API Docs</title>
    <script src="https://unpkg.com/@stoplight/elements/web-components.min.js"></script>
    <link rel="stylesheet" href="https://unpkg.com/@stoplight/elements/styles.min.css" />
    <style>
      html, body { margin: 0; padding: 0; height: 100%; }
      elements-api { display: block; height: 100vh; }
    </style>
  </head>
  <body>
    <elements-api
      apiDescriptionUrl="/api/docs/openapi.yaml"
      router="hash"
      layout="sidebar"
      tryItCredentialsPolicy="same-origin"
    />
  </body>
</html>`);
  }

  /** GET /api/docs/openapi.yaml — serves the raw OpenAPI spec */
  @Public()
  @Get('docs/openapi.yaml')
  getSpec(@Res() res: Response) {
    const filePath = join(__dirname, '..', '..', 'src', 'docs', 'openapi.yaml');
    const distPath = join(__dirname, 'docs', 'openapi.yaml');

    const resolvedPath = existsSync(filePath) ? filePath : distPath;

    res.setHeader('Content-Type', 'application/yaml');
    createReadStream(resolvedPath).pipe(res);
  }
}
