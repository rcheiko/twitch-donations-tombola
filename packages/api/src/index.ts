import { buildApp } from "./app.js"
import { config } from "./config.js"
import { StreamlabsCharityListener } from "./modules/streamlabs-charity-listener.js"
import { tombolaEngine } from "./modules/tombola-engine.js"
import { wsManager } from "./modules/ws.js"

async function main() {
  try {
    await tombolaEngine.init()

    let charityListener: StreamlabsCharityListener | null = null
    const server = await buildApp({
      logger: true,
      isStreamlabsConnected: () => charityListener?.connected ?? false,
    })

    await server.listen({ port: config.PORT, host: config.HOST })
    console.log(`🚀 Tombola Server listening on http://${config.HOST}:${config.PORT}`)
    console.log(`📡 WebSocket ready on ws://${config.HOST}:${config.PORT}/ws`)
    console.log(`💾 Backup persistence active at ${config.DATA_DIR}/backup.json`)

    charityListener = new StreamlabsCharityListener(
      config.STREAMLABS_SOCKET_TOKEN,
      tombolaEngine,
      server.log,
    )
    charityListener.start()

    const shutdown = async (signal: string) => {
      server.log.info(`Received ${signal}, shutting down gracefully...`)
      try {
        charityListener?.stop()
        tombolaEngine.dispose()
        wsManager.close()
        await server.close()
        process.exit(0)
      } catch (err) {
        server.log.error(err, "Error during shutdown")
        process.exit(1)
      }
    }

    process.on("SIGINT", () => shutdown("SIGINT"))
    process.on("SIGTERM", () => shutdown("SIGTERM"))
  } catch (err) {
    console.error("Error starting server:", err)
    process.exit(1)
  }
}

main()
