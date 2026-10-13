// `npm run mcp`: an MCP server on stdio over this app's pods, for Claude Desktop, VS Code or any MCP client. A client
// starts it; nothing is printed here, as stdout is the protocol.
import { exit, stdin } from "node:process";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { openPod } from "cascade-runtime";
import { podServer } from "./mcp-server.mjs";
import { podFolder, podNames } from "./pods.mjs";

const pods = podServer({
  names: podNames,
  open: (name) => openPod(podFolder(name)),
});
const serving = serveStdio(() => pods.build());

stdin.on("close", async () => {
  await serving.close();
  await pods.close();
  exit(0);
});
