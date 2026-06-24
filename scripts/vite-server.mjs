import { createServer } from 'vite'
import os from 'node:os'
import path from 'node:path'
import { handleSharedApi } from './shared-server-core.mjs'

const args = new Map()
for (let i = 2; i < process.argv.length; i += 1) {
  const key = process.argv[i]
  const next = process.argv[i + 1]
  if (key.startsWith('--')) {
    args.set(key.slice(2), next && !next.startsWith('--') ? next : true)
    if (next && !next.startsWith('--')) i += 1
  }
}

const host = String(args.get('host') ?? '127.0.0.1')
const port = Number(args.get('port') ?? 5173)
const strictPort = args.has('strictPort') || args.get('strict-port') === true
const sharedRoot = process.env.STARS_SHARED_ROOT
  ? path.resolve(process.env.STARS_SHARED_ROOT)
  : path.resolve(
      process.env.LOCALAPPDATA ?? process.env.APPDATA ?? os.tmpdir(),
      'StarsApp',
      'shared',
    )
// [T-P1-419/AC5] /api 分发统一在 shared-server-core 的 handleSharedApi；本文件只挂中间件。
const apiCtx = {
  stateRoot: path.join(sharedRoot, 'state'),
  imageRoot: path.join(sharedRoot, 'images'),
  legacyStateRoot: path.join(path.resolve(process.cwd(), '.stars-shared'), 'state'),
  legacyImageRoot: path.join(path.resolve(process.cwd(), '.stars-shared'), 'images'),
  eventClients: new Map(),
  eventBacklog: new Map(),
}

const server = await createServer({
  clearScreen: false,
  server: {
    host,
    port,
    strictPort,
  },
})

const sharedApiMiddleware = (req, res, next) => {
  const parsed = new URL(req.url ?? '/', `http://${host}:${port}`)
  // handleSharedApi 返回 false 表示非 /api（走 vite 静态）；true 表示已处理（含错误响应）。
  void handleSharedApi(req, res, parsed, apiCtx).then((handled) => {
    if (!handled) next()
  })
}

if (Array.isArray(server.middlewares.stack)) {
  server.middlewares.stack.unshift({ route: '', handle: sharedApiMiddleware })
} else {
  server.middlewares.use(sharedApiMiddleware)
}

await server.listen()
server.printUrls()

const close = async () => {
  await server.close()
  process.exit(0)
}

process.on('SIGINT', close)
process.on('SIGTERM', close)

setInterval(() => {}, 1 << 30)
