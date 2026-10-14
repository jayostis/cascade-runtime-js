// `npm run mcp`: an MCP server on stdio over this app's pods, for Claude Desktop, VS Code or any MCP client. A client
// starts it; nothing is printed here, as stdout is the protocol.
import { chdir, exit, stderr, stdin } from "node:process";
import { fileURLToPath, URL } from "node:url";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { openPod, tablesBeside } from "cascade-runtime";
import { podServer } from "./mcp-server.mjs";
import { worthLines } from "./pod-tools.mjs";
import { PODS, podFolder, podNames, trendUrl } from "./pods.mjs";
import { codesSaid, variantsSaid } from "./summary.mjs";

chdir(fileURLToPath(new URL(".", import.meta.url)));

/** What the tables kept in `pods/.tables/` say, as the app's pages read it; nothing when they cannot say, which stderr is told once. */
let unsaid = false;
async function said(read) {
  try {
    return await read(await tablesBeside(PODS));
  } catch (error) {
    if (!unsaid)
      stderr.write(`What the tables say is not used: ${error.message}\n`);
    unsaid = true;
    return undefined;
  }
}

const pods = podServer(
  { names: podNames, open: (name) => openPod(podFolder(name)) },
  {
    viewOf: trendUrl,
    worthOf: (pod) =>
      worthLines(pod, {
        aboutCodes: (answers) =>
          said((tables) => codesSaid(answers, { tables })),
        variantsOf: (answers, each) =>
          said((tables) => variantsSaid(answers, { tables, pod: each })),
      }),
  },
);
const serving = serveStdio(() => pods.build());

stdin.on("close", async () => {
  await serving.close();
  await pods.close();
  exit(0);
});
