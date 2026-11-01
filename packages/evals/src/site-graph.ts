// An evidence graph drawn from boxes in columns: laid out here, once, as an SVG (a box shows what it holds when
// clicked) and as an indented tree for a phone. The boxes are the agent's own output and mechanical lookups; the
// layout invents nothing.
import { cut, esc } from "./site-text.js";

export type Kind =
  | "item"
  | "fact"
  | "absence"
  | "knowledge"
  | "entry"
  | "resource"
  | "record"
  | "document"
  | "passage"
  | "query"
  | "sources"
  | "link";

export interface GNode {
  readonly id: string;
  readonly col: number;
  readonly kind: Kind;
  readonly label: string;
  readonly sub?: string;
  /** HTML shown when the box is opened. */
  readonly detail?: string;
  readonly check?: "ok" | "bad";
}

export interface Graph {
  readonly nodes: readonly GNode[];
  readonly edges: readonly {
    readonly from: string;
    readonly to: string;
    readonly dashed?: boolean;
  }[];
}

const KIND: Readonly<Record<Kind, string>> = {
  item: "What it raises",
  fact: "A fact it stated",
  absence: "An absence it stated",
  knowledge: "The model's own knowledge",
  entry: "Pod entry it cited",
  resource: "Record it cited",
  record: "Member record",
  document: "Source document",
  passage: "The passage",
  query: "The query that looked",
  sources: "Files it looked through",
  link: "Agent's link",
};

export const kv = (rows: readonly (readonly [string, string | undefined])[]) =>
  `<table class="kv">${rows
    .filter(([, value]) => value !== undefined && value !== "")
    .map(([key, value]) => `<tr><th>${esc(key)}</th><td>${value}</td></tr>`)
    .join("")}</table>`;

const BOX = { w: 200, h: 48, gx: 36, gy: 10 };

function svgOf(graph: Graph, id: string): string {
  const cols: GNode[][] = [];
  for (const node of graph.nodes) (cols[node.col] ??= []).push(node);
  const heightOf = (list: readonly GNode[] | undefined) =>
    (list?.length ?? 0) * (BOX.h + BOX.gy) - BOX.gy;
  const total = Math.max(...cols.map(heightOf)) + 8;
  const at = new Map<string, { x: number; y: number }>();
  cols.forEach((list, c) => {
    const meanOf = (node: GNode) => {
      const ys = graph.edges
        .filter((it) => it.to === node.id)
        .map((it) => at.get(it.from)?.y)
        .filter((y): y is number => y !== undefined);
      return ys.length === 0 ? 1e9 : ys.reduce((a, b) => a + b, 0) / ys.length;
    };
    if (c > 0) list.sort((a, b) => meanOf(a) - meanOf(b));
    const top = (total - heightOf(list)) / 2;
    list.forEach((node, i) =>
      at.set(node.id, {
        x: c * (BOX.w + BOX.gx) + 2,
        y: top + i * (BOX.h + BOX.gy),
      }),
    );
  });
  const width = cols.length * (BOX.w + BOX.gx) - BOX.gx + 4;
  const edges = graph.edges
    .map((edge) => {
      const a = at.get(edge.from);
      const b = at.get(edge.to);
      if (a === undefined || b === undefined) return "";
      const [x1, y1, x2, y2] = [
        a.x + BOX.w,
        a.y + BOX.h / 2,
        b.x,
        b.y + BOX.h / 2,
      ];
      const mid = (x1 + x2) / 2;
      return `<path class="edge${edge.dashed === true ? " dashed" : ""}" d="M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2},${y2}"/>`;
    })
    .join("");
  const nodes = graph.nodes
    .map((node) => {
      const p = at.get(node.id)!;
      const sub = node.sub ?? KIND[node.kind];
      return `<g class="node k-${node.kind}" tabindex="0" role="button" data-id="${esc(node.id)}" transform="translate(${p.x},${p.y})"><title>${esc(KIND[node.kind])}: ${esc(node.label)}${node.sub === undefined ? "" : ` · ${esc(node.sub)}`}</title><rect width="${BOX.w}" height="${BOX.h}" rx="9"/><text x="10" y="19" class="l">${esc(cut(node.label, node.check === undefined ? 30 : 24))}</text><text x="10" y="36" class="s">${esc(cut(sub, 34))}</text>${node.check === undefined ? "" : `<text x="${BOX.w - 10}" y="19" text-anchor="end" class="ck ${node.check}">${node.check === "ok" ? "✓" : "✗"}</text>`}</g>`;
    })
    .join("");
  return `<svg class="graph" data-graph="${esc(id)}" viewBox="0 0 ${width} ${total}" width="${width}" height="${total}" role="img" aria-label="Evidence graph">${edges}${nodes}</svg>`;
}

const checkMark = (node: GNode) =>
  node.check === undefined
    ? ""
    : `<span class="ck ${node.check}">${node.check === "ok" ? "✓" : "✗"}</span>`;

function treeOf(graph: Graph): string {
  const root = graph.nodes.find((it) => it.col === 0);
  if (root === undefined) return "";
  const seen = new Set<string>();
  const walk = (id: string): string => {
    const node = graph.nodes.find((it) => it.id === id)!;
    const again = seen.has(id);
    seen.add(id);
    const kids = again
      ? []
      : graph.edges.filter((it) => it.from === id).map((it) => it.to);
    return `<li class="k-${node.kind}"><details${node.col <= 1 ? " open" : ""}><summary><span class="kl">${esc(KIND[node.kind])}</span>${checkMark(node)}<b>${esc(node.label)}</b>${node.sub === undefined ? "" : `<span class="sub">${esc(node.sub)}</span>`}</summary><div class="nd">${node.detail ?? ""}</div>${kids.length === 0 ? "" : `<ul>${kids.map(walk).join("")}</ul>`}</details></li>`;
  };
  return `<ul class="tree">${walk(root.id)}</ul>`;
}

/** The graph with its boxes' details, a phone's tree and the note on what its columns are. */
export function graphBlock(graph: Graph, id: string, note: string): string {
  const details = graph.nodes
    .map(
      (node) =>
        `<div class="ndetail" data-id="${esc(node.id)}" hidden><span class="kl">${esc(KIND[node.kind])}${node.check === undefined ? "" : ` · <span class="${node.check}">${node.check === "ok" ? "checked by a program: the record says this" : "checked by a program: the record does not say this"}</span>`}</span><b>${esc(node.label)}</b>${node.sub === undefined ? "" : ` <span class="muted">· ${esc(node.sub)}</span>`}${node.detail ?? ""}</div>`,
    )
    .join("");
  return `<div class="gwrap"><div class="svgblock"><div class="svgwrap">${svgOf(graph, id)}</div><div class="gpanel"><span class="muted small">Click a box for what it holds.</span></div></div>${treeOf(graph)}<p class="tiny muted">${note}</p>${details}</div>`;
}
