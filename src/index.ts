import { Elysia } from 'elysia'
import { openapi } from '@elysiajs/openapi'
import { cors } from '@elysiajs/cors'

import { env } from '#/env'
import { auth, OpenAPI } from '#/lib/auth'
import { createServiceLogger } from '#/lib/logger'
import { createOpenApiConfig } from '#/lib/openapi'
import { apiErrorPlugin } from '#/plugins/api-error.plugin'
import { requestLoggerPlugin } from '#/plugins/request-logger.plugin'
import { engagementRoutes } from '#/routes/engagement.route'
import { postRoutes } from '#/routes/post.route'

const logger = createServiceLogger('server')

const app = new Elysia()
  .use(
    cors({
      origin: 'http://localhost:3001',
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      credentials: true,
      allowedHeaders: ['Content-Type', 'Authorization'],
    })
  )
  .use(
    openapi(
      createOpenApiConfig({
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        components: await OpenAPI.components,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        paths: await OpenAPI.getPaths(),
      })
    )
  )
  .use(apiErrorPlugin)
  .use(requestLoggerPlugin)
  .mount('/auth', auth.handler)
  .use(postRoutes)
  .use(engagementRoutes)
  .get('/', () => 'Hello Elysia')
  .listen(env.PORT)

logger.info({
  message: 'HTTP server started',
  metadata: {
    hostname: app.server?.hostname,
    port: app.server?.port,
  },
})
