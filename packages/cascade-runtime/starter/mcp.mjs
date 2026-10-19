// `npm run mcp`: an MCP server on stdio over this app's pods, for Claude Desktop, VS Code or any MCP client. A client
// starts it; nothing is printed here, as stdout is the protocol.
import { chdir, exit, stderr, stdin } from "node:process";
import { fileURLToPath, URL } from "node:url";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { podServer } from "./mcp-server.mjs";
import { nodeHost } from "./node-host.mjs";
import { podApi } from "./pod-api.mjs";
import { PODS, trendUrl } from "./pods.mjs";

chdir(fileURLToPath(new URL(".", import.meta.url)));

/** Tells stderr once that what the tables kept in `pods/.tables/` say is not used, as they cannot say it. */
let told = false;
function unsaid(_kind, error) {
  if (!told)
    stderr.write(`What the tables say is not used: ${error.message}\n`);
  told = true;
}

const api = podApi(nodeHost({ folder: PODS, opensEncrypted: false, unsaid }));
const serving = serveStdio(() => podServer(api, { viewOf: trendUrl }).build());

stdin.on("close", async () => {
  await serving.close();
  await api.close();
  exit(0);
});
