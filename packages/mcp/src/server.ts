// The MCP server over a folder of pods: the tools of `cascade-runtime/tools`. A tool that reads is offered to every client; a
// tool that proposes a write only to a client that declares it can show the person a question (MCP elicitation), and
// then asks the person with each call.
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  type ClientCapabilities,
  fromJsonSchema,
  McpServer,
  type RegisteredTool,
  SdkError,
  SdkErrorCode,
  type ServerContext,
  type ToolAnnotations,
} from "@modelcontextprotocol/server";
import { Refusal } from "cascade-runtime";
import {
  type Door,
  type PodReads,
  schemaOf,
  type ToolInput,
  type ToolTier,
} from "cascade-runtime/tools";
import { type Answer, toolsFor } from "cascade-runtime/tools/propose";

const WARNING =
  "A hosted client (Claude Desktop, VS Code with a hosted model, any chat service) sends what these tools return to its provider. The example and story pods are made up; a person's own pod is theirs to decide about before it is asked here.";

const INSTRUCTIONS = `${WARNING}

Every tool but list_pods takes the pod's name: list_pods gives the names. Every row a tool gives names the entry it is about, so an answer can cite it; entry/Where it came from gives an entry's sources. find_changes states what changed in a person's lab results after a medication started or stopped, with the numbers; never why. Use its numbers as they are, and say when it finds nothing. ask's entry/What needs review lists the entries the pod itself says need review, and why each does. reference_table_checks gives what only the reference tables can say: a variant report that differs from ClinVar today, and medications whose codes share an ingredient; a model cannot know ClinVar's current classification, so cite its rows rather than guess, and say so when it answers that the tables are off or that a check's series is not held (held false: not checked, which is not the same as nothing found).

propose_entry, propose_judgment and propose_retraction, where offered, propose a write the person has not made: each call asks the person, through the client, and writes only if they say yes to that call. Propose a write only for what the person told you or asked for; say what you proposed and what came of it (written, or the person said no, dismissed the question or left it unanswered); after a no, do not propose it again unless they ask. What you propose is recorded as proposed by a model and said yes to by the person, so give no author or time of your own.`;

/** How long a question waits for the person before the call says it went unanswered. */
const WAIT_MS = 300_000;

const { version } = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
) as { version: string };

/**
 * A tool's answer as MCP sends it: its result as JSON; or, for input the rules refuse, `isError` and the reason, and
 * for any other error a fixed message, logged to stderr.
 */
async function content(run: () => Promise<unknown>) {
  try {
    return {
      content: [{ type: "text" as const, text: JSON.stringify(await run()) }],
    };
  } catch (error) {
    const refused = error instanceof Refusal;
    if (!refused) console.error(error);
    return {
      content: [
        {
          type: "text" as const,
          text: refused ? error.message : "the server failed; its log says why",
        },
      ],
      isError: true,
    };
  }
}

/**
 * A tool's annotations from its tier, for a client that confirms with the person on its own too: a tool at `free` only
 * reads; one at `ask` writes, and is marked destructive so the client asks before it runs. The server's own question does
 * not depend on the client heeding them.
 */
function annotationsOf(tier: ToolTier): ToolAnnotations {
  return tier === "free"
    ? { readOnlyHint: true, openWorldHint: false }
    : {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      };
}

/** Whether a client that declared `capabilities` can show the person a form: a bare `elicitation` counts, a url-only one does not. */
function canAsk(capabilities: ClientCapabilities | undefined): boolean {
  const { elicitation } = capabilities ?? {};
  return (
    elicitation !== undefined &&
    (elicitation.form !== undefined || elicitation.url === undefined)
  );
}

/**
 * Asks the person through the client, with a form of one box to tick, and what they did as the answer: accepting with the
 * box ticked is a yes; declining, a no; cancelling, or accepting without the box ticked, a dismissed question; and no
 * answer within `waitMs`, or once the client has cancelled the call, an unanswered one. A failure to reach the client is thrown, so nothing is written on it.
 */
async function elicit(
  { mcpReq }: ServerContext,
  message: string,
  waitMs: number,
): Promise<Answer> {
  let result;
  try {
    result = await mcpReq.elicitInput(
      {
        mode: "form",
        message,
        requestedSchema: {
          type: "object",
          properties: {
            yes: {
              type: "boolean",
              title: "Yes, write this",
              description:
                "Tick this box, then accept, to have this one proposal written. To say no, decline. Accepting without the box ticked writes nothing and counts as no answer.",
              default: false,
            },
          },
        },
      },
      { timeout: waitMs, signal: mcpReq.signal },
    );
  } catch (error) {
    if (
      mcpReq.signal.aborted ||
      (error instanceof SdkError && error.code === SdkErrorCode.RequestTimeout)
    )
      return "unanswered";
    throw error;
  }
  if (mcpReq.signal.aborted) return "unanswered";
  if (result.action === "decline") return "no";
  return result.action === "accept" && result.content?.yes === true
    ? "yes"
    : "dismissed";
}

/** What a server is made with, beyond the pods it reaches. */
export interface PodServerOptions {
  /** How long to wait for the person to answer a question before it counts as unanswered; five minutes if left out. */
  readonly waitMs?: number;
}

/**
 * A server for one connection over the pods `reads` reaches. The tools that propose a write are listed, and run, only
 * once the client has declared at initialisation that it can show the person a question; until then, and for a client that
 * cannot, they are disabled. The model a write is proposed by is named by one IRI for the connection, and labelled with the
 * client's name and version.
 */
export function podServer(
  reads: PodReads,
  { waitMs = WAIT_MS }: PodServerOptions = {},
): McpServer {
  const server = new McpServer(
    {
      name: "cascade-mcp",
      version,
      description: `Questions over a folder of Cascade pods and, to a client that can ask the person, proposals to write to them, which are written only when the person says yes. ${WARNING}`,
    },
    { instructions: INSTRUCTIONS },
  );
  const model = `urn:uuid:${randomUUID()}`;
  const door = (context: ServerContext): Door => {
    const client = server.server.getClientVersion();
    return {
      model: {
        iri: model,
        label:
          client === undefined
            ? "an MCP client"
            : `${client.name} ${client.version}`,
      },
      ask: (question) => elicit(context, question, waitMs),
    };
  };
  const asking: RegisteredTool[] = [];
  for (const tool of toolsFor({ canAsk: true })) {
    const registered = server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: fromJsonSchema(schemaOf(tool)),
        annotations: annotationsOf(tool.tier),
      },
      (input, context) =>
        content(() => tool.run(reads, input as ToolInput, door(context))),
    );
    if (tool.tier === "ask") {
      registered.disable();
      asking.push(registered);
    }
  }
  server.server.oninitialized = () => {
    if (canAsk(server.server.getClientCapabilities()))
      for (const tool of asking) tool.enable();
  };
  return server;
}
