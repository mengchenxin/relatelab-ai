import { createApplication } from "./app.ts";
import { loadConfig } from "./config.ts";

const config = loadConfig();
const { app } = await createApplication(config);

try {
  await app.listen({
    port: config.port,
    host: config.host
  });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
