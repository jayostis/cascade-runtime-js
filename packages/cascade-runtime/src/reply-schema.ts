// The reply contracts: the JSON schemas a model's reply to a question about a person's records is held to. A reply about
// a pod (`replySchema`) points at entries and the program shows them; it keeps to what a provider's structured output
// accepts (no oneOf, pattern, length or number bounds; every object closed), and `replyErrors` checks the rest. A reply
// about downloads (`recordsReplySchema`, the eval's records arm) cites a file and line and copies what it says. What
// each asks of a model is `reply-prompt.ts`; whether what a reply cites holds is `reply.ts`.
import type { InputSchema } from "./check.js";
import { schemaOf, TOOLS } from "./pod-tools.js";

/** The field of an entry a fact of a reply about a pod rests on. */
export const FACT_FIELDS = [
  "value",
  "status",
  "code",
  "name",
  "id",
  "date",
  "start",
  "end",
  "recorded",
  "text",
] as const;

/** A tool's input property as structured output takes it: its type, its values and its items, with no bounds. */
function bare(schema: InputSchema): Record<string, unknown> {
  return {
    type: schema.type,
    ...(schema.enum === undefined ? {} : { enum: schema.enum }),
    ...(schema.items === undefined ? {} : { items: bare(schema.items) }),
    ...(schema.properties === undefined
      ? {}
      : {
          properties: Object.fromEntries(
            Object.entries(schema.properties).map(([name, it]) => [
              name,
              bare(it),
            ]),
          ),
          required: schema.required ?? [],
          additionalProperties: false,
        }),
  };
}

/** The input of any pod tool: every tool's properties, so an absence's query gives the input it ran with. */
function anyToolInput() {
  const variants = new Map<string, Map<string, Record<string, unknown>>>();
  for (const tool of TOOLS)
    for (const [name, property] of Object.entries(
      schemaOf(tool).properties ?? {},
    )) {
      const it = bare(property);
      const of = variants.get(name) ?? variants.set(name, new Map()).get(name)!;
      of.set(JSON.stringify(it), it);
    }
  return {
    type: "object",
    description: "Its input, exactly as it ran.",
    additionalProperties: false,
    properties: Object.fromEntries(
      [...variants].map(([name, of]) => [
        name,
        of.size === 1 ? [...of.values()][0]! : { anyOf: [...of.values()] },
      ]),
    ),
  };
}

export const replySchema = {
  $id: "https://github.com/jayostis/cascade-runtime-js/packages/cascade-runtime/src/reply-schema.ts",
  title: "A reply to one question about a person's pod",
  description:
    "The reply as the person reads it, a short answer for the doctor card, and its items: each a point of the reply, with the pod's entries it rests on (each named by its handle, with the field the point rests on, which a program reads from the pod and shows), what the pod lacks (each with what it looks for, what was looked through and the call that looked), the model's own medical knowledge if it used any, and the links it draws between its facts.",
  type: "object",
  required: ["answer", "short", "items"],
  additionalProperties: false,
  $defs: {
    fact: {
      type: "object",
      required: ["says", "cite", "field"],
      additionalProperties: false,
      properties: {
        says: {
          type: "string",
          description: "What the entry says, in the model's words.",
        },
        cite: {
          type: "object",
          required: ["entry"],
          additionalProperties: false,
          properties: {
            entry: {
              type: "string",
              description:
                "The entry's handle in a compact read (a capital letter and 8 to 64 lower-case hex digits), or its IRI (pod://…#…).",
            },
          },
        },
        field: {
          type: "string",
          enum: FACT_FIELDS,
          description:
            "The one field of the entry the point rests on: its value, status, code, name, id, a date (when it happened, start, end, recorded) or its text.",
        },
        source: {
          type: "string",
          description:
            "For an entry from more than one source, the one whose word the point rests on, by its short name in the read's legend (S3).",
        },
        quote: {
          type: "string",
          description:
            "With field text: the words the point rests on, copied exactly from the entry's text.",
        },
      },
    },
    absence: {
      type: "object",
      required: ["what", "match", "coverage"],
      additionalProperties: false,
      properties: {
        what: {
          type: "string",
        },
        match: {
          type: "object",
          additionalProperties: false,
          properties: {
            codes: {
              type: "array",
              items: {
                type: "string",
              },
            },
            terms: {
              type: "array",
              items: {
                type: "string",
              },
            },
            after: {
              type: "string",
              format: "date",
              description:
                "Only a record dated on or after this day would count against the absence.",
            },
          },
        },
        coverage: {
          type: "string",
        },
        query: {
          type: "object",
          required: ["tool", "input"],
          additionalProperties: false,
          properties: {
            tool: {
              type: "string",
            },
            input: anyToolInput(),
            call: {
              type: "integer",
              description:
                "The number the pod command printed with the call's answer.",
            },
          },
        },
      },
    },
    factAt: {
      type: "object",
      required: ["item", "fact"],
      additionalProperties: false,
      properties: {
        item: {
          type: "integer",
          description: "The item's n.",
        },
        fact: {
          type: "integer",
          description: "The fact's place in that item, from 0.",
        },
      },
    },
  },
  properties: {
    answer: {
      type: "string",
      description: "The reply, as the person reads it.",
    },
    short: {
      type: "string",
      description: "One or two sentences: the short answer on the doctor card.",
    },
    items: {
      type: "array",
      minItems: 1,
      description: "At most 10, the most important first.",
      items: {
        type: "object",
        required: ["says", "why", "confidence"],
        additionalProperties: false,
        properties: {
          n: {
            type: "integer",
            description: "The item's number, from 1.",
          },
          says: {
            type: "string",
          },
          why: {
            type: "string",
          },
          confidence: {
            type: "string",
            enum: ["high", "medium", "low"],
          },
          facts: {
            type: "array",
            items: {
              $ref: "#/$defs/fact",
            },
          },
          absences: {
            type: "array",
            items: {
              $ref: "#/$defs/absence",
            },
          },
          knowledge: {
            type: "object",
            required: ["says"],
            additionalProperties: false,
            properties: {
              says: {
                type: "string",
              },
              guideline: {
                type: "string",
              },
            },
          },
          links: {
            type: "array",
            description:
              "That one fact bears on another, in the agent's own words: by the facts' places in this item, from 0.",
            items: {
              type: "object",
              required: ["from", "to", "says"],
              additionalProperties: false,
              properties: {
                from: {
                  type: "integer",
                },
                to: {
                  type: "integer",
                },
                says: {
                  type: "string",
                },
              },
            },
          },
        },
      },
    },
    links: {
      type: "array",
      description:
        "That a fact of one item bears on a fact of another, in the agent's own words, when the two are not in one item: by each fact's item (its n) and place (from 0). Only what the agent states.",
      items: {
        type: "object",
        required: ["from", "to", "says"],
        additionalProperties: false,
        properties: {
          from: {
            $ref: "#/$defs/factAt",
          },
          to: {
            $ref: "#/$defs/factAt",
          },
          says: {
            type: "string",
          },
        },
      },
    },
  },
};

export const recordsReplySchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://github.com/jayostis/cascade-runtime-js/packages/cascade-runtime/src/reply-schema.ts/records",
  title: "A subject's answer to one question",
  description:
    "The reply as the person reads it, a short answer for the doctor card, and its items: each a point of the reply, with the facts the records state (each cited, with the fields a program checks against the cited record), what the records lack (each with what it looks for and what was looked through, and for the pod the query that looked), the model's own medical knowledge if it used any, and the links it draws between its facts.",
  type: "object",
  required: ["answer", "short", "items"],
  additionalProperties: false,
  $defs: {
    cite: {
      oneOf: [
        {
          type: "object",
          required: ["file", "line"],
          additionalProperties: false,
          properties: {
            file: {
              type: "string",
              minLength: 1,
            },
            line: {
              type: "integer",
              minimum: 1,
            },
          },
        },
        {
          type: "object",
          required: ["file", "resource"],
          additionalProperties: false,
          properties: {
            file: {
              type: "string",
              minLength: 1,
            },
            resource: {
              type: "string",
              minLength: 1,
            },
          },
        },
        {
          type: "object",
          required: ["entry"],
          additionalProperties: false,
          properties: {
            entry: {
              description:
                "The entry's IRI, which has a scheme (pod://…#…), or its handle in a compact read, which has none: a capital letter and 8 to 64 lower-case hex digits.",
              type: "string",
              minLength: 1,
            },
          },
        },
      ],
    },
    fact: {
      type: "object",
      required: ["says", "provider", "cite"],
      additionalProperties: false,
      anyOf: [
        {
          required: ["value"],
        },
        {
          required: ["status"],
        },
        {
          required: ["code"],
        },
        {
          required: ["name"],
        },
        {
          required: ["id"],
        },
        {
          required: ["date"],
        },
        {
          required: ["quote"],
        },
      ],
      dependentRequired: {
        unit: ["value"],
        dateKind: ["date"],
      },
      properties: {
        says: {
          type: "string",
        },
        provider: {
          type: "string",
        },
        cite: {
          $ref: "#/$defs/cite",
        },
        value: {
          type: ["string", "number"],
          minLength: 1,
        },
        unit: {
          type: "string",
          minLength: 1,
        },
        status: {
          type: "string",
          minLength: 1,
        },
        code: {
          type: ["string", "number"],
          minLength: 1,
        },
        name: {
          type: "string",
          minLength: 3,
        },
        id: {
          type: ["string", "number"],
          minLength: 1,
        },
        date: {
          type: "string",
          pattern: "^\\d{4}-\\d{2}-\\d{2}$",
        },
        dateKind: {
          enum: ["when", "start", "end", "recorded"],
        },
        quote: {
          type: "string",
          pattern: "\\S+\\s+\\S+",
        },
      },
    },
    absence: {
      type: "object",
      required: ["what", "match", "coverage"],
      additionalProperties: false,
      properties: {
        what: {
          type: "string",
        },
        match: {
          type: "object",
          additionalProperties: false,
          minProperties: 1,
          properties: {
            codes: {
              type: "array",
              items: {
                type: "string",
              },
            },
            terms: {
              type: "array",
              items: {
                type: "string",
              },
            },
            after: {
              type: "string",
              pattern: "^\\d{4}-\\d{2}-\\d{2}$",
              description:
                "Only a record dated on or after this day would count against the absence.",
            },
          },
        },
        coverage: {
          type: "string",
        },
        query: {
          type: "object",
          required: ["tool", "input"],
          additionalProperties: false,
          properties: {
            tool: {
              type: "string",
            },
            input: {
              type: "object",
            },
            call: {
              type: "integer",
              minimum: 1,
              description:
                "The number the pod command printed with the call's answer.",
            },
          },
        },
        sources: {
          type: "array",
          items: {
            type: "string",
          },
        },
      },
    },
  },
  properties: {
    answer: {
      type: "string",
      minLength: 1,
      description: "The reply, as the person reads it.",
    },
    short: {
      type: "string",
      minLength: 1,
      description: "One or two sentences: the short answer on the doctor card.",
    },
    items: {
      type: "array",
      minItems: 1,
      maxItems: 10,
      items: {
        type: "object",
        required: ["says", "why", "confidence"],
        additionalProperties: false,
        properties: {
          n: {
            type: "integer",
            minimum: 1,
          },
          says: {
            type: "string",
            minLength: 1,
          },
          why: {
            type: "string",
          },
          confidence: {
            enum: ["high", "medium", "low"],
          },
          facts: {
            type: "array",
            items: {
              $ref: "#/$defs/fact",
            },
          },
          absences: {
            type: "array",
            items: {
              $ref: "#/$defs/absence",
            },
          },
          knowledge: {
            type: "object",
            required: ["says"],
            additionalProperties: false,
            properties: {
              says: {
                type: "string",
              },
              guideline: {
                type: "string",
              },
            },
          },
          links: {
            type: "array",
            description:
              "That one fact bears on another, in the agent's own words: by the facts' places in this item.",
            items: {
              type: "object",
              required: ["from", "to", "says"],
              additionalProperties: false,
              properties: {
                from: {
                  type: "integer",
                  minimum: 0,
                },
                to: {
                  type: "integer",
                  minimum: 0,
                },
                says: {
                  type: "string",
                },
              },
            },
          },
        },
      },
    },
    links: {
      type: "array",
      description:
        "That a fact of one item bears on a fact of another, in the agent's own words, when the two are not in one item: by each fact's item and place. Only what the agent states.",
      items: {
        type: "object",
        required: ["from", "to", "says"],
        additionalProperties: false,
        properties: {
          from: {
            type: "object",
            required: ["item", "fact"],
            additionalProperties: false,
            properties: {
              item: {
                type: "integer",
                minimum: 1,
                description: "The item's n.",
              },
              fact: {
                type: "integer",
                minimum: 0,
                description: "The fact's place in that item, from 0.",
              },
            },
          },
          to: {
            type: "object",
            required: ["item", "fact"],
            additionalProperties: false,
            properties: {
              item: {
                type: "integer",
                minimum: 1,
                description: "The item's n.",
              },
              fact: {
                type: "integer",
                minimum: 0,
                description: "The fact's place in that item, from 0.",
              },
            },
          },
          says: {
            type: "string",
          },
        },
      },
    },
  },
};
