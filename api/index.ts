import type { IncomingMessage, ServerResponse } from "node:http";
import { createApiApp } from "../lib/server/api-app.ts";

export const config = {
  api: {
    bodyParser: false,
  },
};

const apiApp = createApiApp();

export default function handler(req: IncomingMessage, res: ServerResponse) {
  return apiApp(req as never, res as never);
}
