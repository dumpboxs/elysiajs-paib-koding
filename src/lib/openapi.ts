import type { ElysiaOpenAPIConfig } from '@elysiajs/openapi'
import { z } from 'zod'

type OpenApiDocumentation = NonNullable<ElysiaOpenAPIConfig['documentation']>

export const OPENAPI_DOCS_PATH = '/docs'

export const OPENAPI_INFO = {
  title: 'Marvticle API',
  version: '1.0.0',
  description:
    'REST API untuk aplikasi blog dengan autentikasi Better Auth dan manajemen posts.',
} satisfies NonNullable<OpenApiDocumentation['info']>

export const createOpenApiConfig = (
  documentation: Partial<OpenApiDocumentation> = {}
): ElysiaOpenAPIConfig<true, typeof OPENAPI_DOCS_PATH> => ({
  path: OPENAPI_DOCS_PATH,
  documentation: {
    info: OPENAPI_INFO,
    ...documentation,
  },
  mapJsonSchema: {
    zod: z.toJSONSchema,
  },
})
