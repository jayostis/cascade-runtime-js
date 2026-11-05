import { examplesSection } from "../../hub/examples.js";
import type { PagesContext } from "../../hub/context.js";
import { specSection } from "../../hub/spec.js";
import { startSection } from "../../hub/start.js";
import { testsSection } from "../../hub/tests.js";
import { termsSection } from "../../hub/terms.js";
import { trySection } from "../../hub/try.js";
import type { Finisher, Section } from "../../sections.js";
import { agentFiles } from "../../agents.js";
import { apiSection } from "./api.js";
import { evalsSection } from "./evals.js";

/** The hub's sections in the order their rows read on the front page. A new section is one module and one line here. */
export const SECTIONS: readonly Section<PagesContext>[] = [
  startSection,
  trySection,
  apiSection,
  termsSection,
  examplesSection,
  specSection,
  testsSection,
  evalsSection,
];

/** What reads the tree once it is written: `llms.txt` and `index.json`, which cover every page a section above writes. */
export const FINISHERS: readonly Finisher<PagesContext>[] = [agentFiles];
