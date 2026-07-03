import { BadRequestException, NotFoundException } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import { CatalogProvider } from './catalog-config.util';
import {
  CatalogConfigException,
  CatalogQuotaExceededException,
  CatalogUpstreamException,
} from './catalog-errors';

export interface CatalogRequest {
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  headers?: Record<string, string>;
}

export interface CatalogResponse<T> {
  data: T;
  headers: Record<string, string>;
}

export interface CatalogHttpConfig {
  provider: CatalogProvider;
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
  http?: AxiosInstance;
}

export class CatalogHttpClient {
  private readonly http: AxiosInstance;

  constructor(private readonly cfg: CatalogHttpConfig) {
    this.http = cfg.http ?? axios.create();
  }

  async request<T>(req: CatalogRequest): Promise<CatalogResponse<T>> {
    const params: Record<string, string | number | boolean> = {};
    for (const [k, v] of Object.entries(req.query ?? {})) {
      if (v !== undefined) params[k] = v;
    }
    try {
      const res = await this.http.request({
        method: 'GET',
        baseURL: this.cfg.baseUrl,
        url: req.path,
        params,
        // PartsIndex expects PHP-style bracket keys (params[120], car[generationId]);
        // keep the key unencoded, encode only the value.
        paramsSerializer: (p: Record<string, unknown>) =>
          Object.entries(p)
            .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
            .join('&'),
        timeout: this.cfg.timeoutMs,
        headers: {
          Authorization: this.cfg.apiKey,
          Accept: 'application/json',
          ...req.headers,
        },
      });
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(res.headers ?? {})) {
        headers[k.toLowerCase()] = String(v);
      }
      return { data: res.data as T, headers };
    } catch (err: any) {
      throw this.mapError(err);
    }
  }

  private mapError(err: any): Error {
    const status: number | undefined = err?.response?.status;
    const body = err?.response?.data;
    const code = body?.code;
    const detail = body?.message
      ? `${body.message}${code != null ? ` (code ${code})` : ''}`
      : undefined;
    if (status == null) return new CatalogUpstreamException();
    if (status === 403 && Number(code) === 1004) {
      return new CatalogQuotaExceededException(
        `Лимит запросов провайдера (${this.cfg.provider}) исчерпан${detail ? `: ${detail}` : ''}.`,
      );
    }
    if (status === 401 || status === 403) {
      // 1001 access, 1002 domain, 1003 ip, 1005 resource, 1006 no-auth deny.
      return new CatalogConfigException(
        `Доступ к провайдеру ${this.cfg.provider} отклонён${detail ? `: ${detail}` : ''}. ` +
          `Проверьте ключ и белый список IP (наш исходящий IP должен быть разрешён).`,
      );
    }
    if (status === 404) return new NotFoundException('Not found in catalog provider.');
    if (status === 400 || status === 422) {
      return new BadRequestException('Invalid catalog request.');
    }
    return new CatalogUpstreamException();
  }
}
