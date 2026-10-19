// What the starter reads of its pods and its reference tables, once, for every host: the Node server, try/ in a
// browser, the chat, the MCP server and `npm run ask`. A host gives the pods, the tables and what only it knows;
// every operation takes and gives plain JSON, and refuses bad input with a `Refusal`.
import {
  changesIn,
  changeTools,
  checkInput,
  compact,
  connect,
  ConnectionFailure,
  DEMO_PLAN,
  findChanges,
  labSeriesIn,
  pull,
  PullRefused,
  pullFiles,
  Refusal,
  searchDirectory,
  sixWords,
  timelineIn,
  typedWords,
  Unopened,
} from "cascade-runtime";
import {
  classedElsewhere,
  classesSaid,
  codesSaid,
  entryId,
  entryOf,
  HISTORY,
  joinedBy,
  LABS,
  MEDICATIONS,
  NOT_WORDS,
  pageNumber,
  panelSaid,
  panelsOf,
  patientName,
  patientNames,
  QUESTIONS,
  savedLoginChanged,
  slug,
  sourcesOf,
  tableId,
  testsIn,
  trendInput,
  utcInstant,
  variantsSaid,
  withMechanism,
  worldInstant,
  worthALook,
} from "./summary.mjs";

/** Why a host that opens no encrypted pod refuses the pod `name`, in one line. */
export function notOpenedHere(name) {
  return `${name} is encrypted: open it in the app (\`npm start\`) with its six words; this command does not open encrypted pods`;
}

/** What the app asks a hospital it signs in at to let it read. */
export const SCOPES = ["launch/patient", "patient/*.read", "patient/*.rs"];

/** How long a `connection` call with `wait` holds before it answers the connection as it is. */
const WAIT_MS = 25_000;

/** What a person is told when a bring-in or a pull's files fail for a reason that is the app's, not the record's. */
const NOT_BROUGHT_IN =
  "Not brought in: the app hit an error of its own. Try again, and if it happens again, restart the app.";
const PULL_BROKEN =
  "The pull could not be saved: the app hit an error of its own.";

/** The steps of a connection that are under way. */
const UNDER_WAY = ["signing in", "pulling", "bringing in"];

/** Names Windows keeps for devices, which no folder may have. */
const DEVICES = /^(con|prn|aux|nul|com\d|lpt\d)$/;

const NOT_WAITING =
  "These six words are not waiting any more. Make the pod again.";

/** The paths of an operation's output that hold a `Map` as `[key, value]` pairs. */
const MAPPED = ["about", "joined", "elsewhere", "classes", "panelAbout"];
const MAPPED_SAID = ["says", "labels", "names"];

/** An operation's `output` with each of its pairs a `Map` again, as the view takes them. */
export function maps(output) {
  const mapped = { ...output };
  for (const key of MAPPED)
    if (output[key] !== undefined) mapped[key] = new Map(output[key]);
  if (output.said !== undefined) {
    mapped.said = { ...output.said };
    for (const key of MAPPED_SAID)
      if (output.said[key] !== undefined)
        mapped.said[key] = new Map(output.said[key]);
  }
  return mapped;
}

const pairs = (map) => (map === undefined ? undefined : [...map]);

const WORTH_A_LOOK = {
  name: "worth_a_look",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
};

/** The names of the tools `tool` runs: the change tools, then `worth_a_look`. */
const TOOLS = [
  ...changeTools({ ask: async () => [] }).map(({ name }) => name),
  WORTH_A_LOOK.name,
];

/** The test and medication codes of the trend a finding is about, the medication's name where it has no code. */
export function trendOf({ test, medication }) {
  const drug = medication.notation ?? medication.name;
  return {
    test: test.notation ?? test.code,
    ...(drug === "" ? {} : { medication: drug }),
  };
}

/** What a field a client may send can be: how its refusal reads, and which values pass. */
const CHECKS = {
  string: ["a string", (value) => typeof value === "string"],
  boolean: ["true or false", (value) => typeof value === "boolean"],
  positiveInteger: [
    "a whole number from 1",
    (value) => Number.isSafeInteger(value) && value > 0,
  ],
  object: [
    "an object",
    (value) =>
      value !== null && typeof value === "object" && !Array.isArray(value),
  ],
  waitFor: [
    'true or "change"',
    (value) => value === true || value === "change",
  ],
};
const { string, boolean, positiveInteger, object, waitFor } = CHECKS;

/** The check each input a client may send must pass when it is given, by operation. */
const INPUTS = {
  pods: {},
  held: {},
  pod: { pod: string },
  answers: { pod: string },
  said: { pod: string, entry: string },
  trend: { pod: string, test: string, medication: string, named: boolean },
  classes: { pod: string },
  panel: { pod: string, panel: string },
  table: { id: string, q: string, page: positiveInteger, code: string },
  ask: { pod: string, question: string, limit: positiveInteger },
  tool: { pod: string, tool: string, input: object },
  makePod: { person: string, encrypt: boolean },
  waitingWords: { pod: string },
  confirmWords: {
    pod: string,
    word2: string,
    word5: string,
    password: string,
    username: string,
  },
  unlock: { pod: string, secret: string },
  deleteAll: {},
  resetAll: {},
  checkTables: {},
  setWorldDate: { date: string },
  hospitals: { q: string },
  connect: { pod: string, fhirBase: string },
  connection: { pod: string, connection: positiveInteger, wait: waitFor },
  bring: { pod: string, connection: positiveInteger },
};

/** The operations a client may call, which is every member of `podApi(host)` but `close`. */
export const OPERATIONS = Object.keys(INPUTS);

/** `operation`, refusing an input that is no object or holds a field of the wrong type. */
function typed(name, operation) {
  return async (input = {}) => {
    if (!object[1](input)) throw new Refusal("the input must be an object");
    for (const [field, [what, is]] of Object.entries(INPUTS[name])) {
      if (input[field] !== undefined && !is(input[field]))
        throw new Refusal(`${field} must be ${what}`);
    }
    return operation(input);
  };
}

/** The operations over the pods and tables `host` gives; `host.hospitals` and `host.world` are read at each call. */
export function podApi(host) {
  /** Each pod this instance opened, by name, as the promise of its opening. */
  const opened = new Map();
  /** The title each pod keeps, by name, once read. */
  const titles = new Map();
  /** The last answers given for each pod, by name, as `answers` gave them. */
  const last = new Map();
  /** The pods the folder was last seen to hold, so one page scans it once: a pod seen needs no second scan. */
  const seen = new Set();
  /** The six words of each encrypted pod being made, and the person's name as typed, by the pod's name, until checked. */
  const waiting = new Map();
  /** Each connection to a hospital, by its number; `count` numbers the next. */
  const connections = new Map();
  let count = 0;

  /** Whether a record is being brought into the pod: its answers are then the ones last given, until it is in. */
  const bringingInto = (name) =>
    [...connections.values()].some(
      (each) => each.pod === name && each.bringing !== undefined,
    );

  /** The pod named, opened once with `options` and kept; a failed opening is forgotten. */
  function openOnce(name, options) {
    if (!opened.has(name)) {
      const opening = host.pods.open(name, options);
      opening.catch(() => opened.delete(name));
      opened.set(name, opening);
    }
    return opened.get(name);
  }

  function sampleFor(name) {
    if (!opened.has(name)) {
      const copying = (async () => host.copySample(name))();
      copying.catch(() => opened.delete(name));
      opened.set(name, copying);
    }
    return opened.get(name);
  }

  /** Closes the pods this instance opened, the encrypted ones too unless `plaintextOnly`, and forgets the last answers. */
  async function closeOpened({ plaintextOnly = false } = {}) {
    const closing = [];
    for (const [name, opening] of [...opened]) {
      const pod = await opening.catch(() => undefined);
      if (plaintextOnly && pod?.encrypted) continue;
      opened.delete(name);
      if (pod !== undefined) closing.push(pod.close());
    }
    last.clear();
    seen.clear();
    if (!plaintextOnly) titles.clear();
    await Promise.allSettled(closing);
  }

  /** The title the pod keeps, read once, else its name. */
  async function titleOf(name) {
    if (!titles.has(name)) {
      const title = await host.pods.title(name);
      if (title !== undefined) titles.set(name, title);
    }
    return titles.get(name) ?? name;
  }

  async function held(tables = host.tables()) {
    return (await tables).held();
  }

  /** The pod named, which must be one there is. */
  async function known(name) {
    if (seen.has(name) || opened.has(name)) return;
    const names = await host.pods.names();
    seen.clear();
    for (const each of names) seen.add(each);
    if (!names.includes(name))
      throw new Refusal(
        names.length === 0
          ? `there is no pod ${name}, and no pod at all`
          : `there is no pod ${name}; the pods are ${names.join(", ")}`,
      );
  }

  /** The pod named, opened; a host that opens no encrypted pod refuses one. */
  async function podNamed(name) {
    await known(name);
    try {
      return await openOnce(name);
    } catch (error) {
      if (error instanceof Unopened && !host.opensEncrypted)
        throw new Refusal(notOpenedHere(name));
      throw error;
    }
  }

  async function asked(pod) {
    const answers = Object.fromEntries(
      await Promise.all(
        QUESTIONS.map(async (question) => [question, await pod.ask(question)]),
      ),
    );
    const changes = changesIn(answers[HISTORY], answers[LABS], { limit: 20 });
    return {
      answers: await withMechanism(answers, changes, (question) =>
        pod.ask(question),
      ),
      changes,
      unheld: pod.opened?.unheld,
    };
  }

  async function answers({ pod: name }) {
    const pod = await podNamed(name);
    if (bringingInto(name) && last.has(name)) return last.get(name);
    const given = await asked(pod);
    last.set(name, given);
    return given;
  }

  /** What the tables say of the codes `answered` holds; nothing when they cannot say, which the host is told. */
  function aboutCodes(answered, pod) {
    return host
      .tables(pod)
      .then((tables) => codesSaid(answered, { tables }))
      .catch((error) => {
        host.unsaid?.("names", error);
        return undefined;
      });
  }

  async function variantsOf(answered, pod) {
    try {
      return await variantsSaid(answered, {
        tables: await host.tables(pod),
        pod,
      });
    } catch (error) {
      host.unsaid?.("variants", error);
      return undefined;
    }
  }

  async function said({ pod: name, entry: id }) {
    const pod = await podNamed(name);
    let given = last.get(name) ?? (await answers({ pod: name }));
    if (id !== undefined && entryOf(given.answers, id) === undefined) {
      given = await answers({ pod: name });
      if (entryOf(given.answers, id) === undefined)
        throw new Refusal(`the pod ${name} holds no entry ${id}`);
    }
    const [about, variants, heldNow] = await Promise.all([
      aboutCodes(given.answers, pod),
      variantsOf(given.answers, pod),
      held().catch(() => []),
    ]);
    const output = {
      ...(about !== undefined && { about: pairs(about) }),
      ...(variants !== undefined && {
        said: {
          ...variants,
          says: pairs(variants.says),
          labels: pairs(variants.labels),
          names: pairs(variants.names),
        },
      }),
      held: heldNow,
    };
    if (id === undefined) return output;
    const [panels, joined] = await Promise.all([
      host
        .tables()
        .then(async (tables) =>
          panelsOf(entryOf(given.answers, id), {
            tables,
            held: await tables.held(),
          }),
        )
        .catch(() => []),
      joinedBy(pod).catch(() => new Map()),
    ]);
    return {
      ...output,
      entry: entryOf(given.answers, id, {
        about,
        said: variants,
        held: heldNow,
        joined,
      }),
      panels,
      joined: pairs(joined),
    };
  }

  async function trend({ pod: name, test, medication, named = true }) {
    const pod = await podNamed(name);
    const [medications, labs] = await Promise.all([
      pod.ask(HISTORY),
      pod.ask(LABS),
    ]);
    const input = trendInput(
      { changes: changesIn(medications, labs, { limit: 20 }), labs },
      { test, medication },
    );
    if (input === undefined)
      throw new Refusal(`the pod ${name} holds no test results`);
    let series;
    try {
      series = labSeriesIn(labs, input.test);
    } catch (error) {
      if (!(error instanceof Refusal)) throw error;
      const tests = testsIn(labs).map(
        ({ code, notation, name: label }) =>
          `${notation ?? code}${label === undefined ? "" : ` (${label})`}`,
      );
      throw new Refusal(
        `${error.message}; ${tests.length === 0 ? "it holds no test results" : `the tests it holds are ${tests.join(", ")}`}`,
      );
    }
    const timeline = timelineIn(medications);
    if (input.medication !== undefined) {
      const wanted = input.medication.toLowerCase();
      const found = timeline.find(
        (each) =>
          each.notation === input.medication ||
          each.code === input.medication ||
          each.name.toLowerCase() === wanted,
      );
      if (found === undefined) {
        const drugs = [
          ...new Set(timeline.map((each) => each.notation ?? each.name)),
        ];
        throw new Refusal(
          `no medication ${input.medication} in the pod; ${drugs.length === 0 ? "it holds no medications" : `the medications it holds are ${drugs.join(", ")}`}`,
        );
      }
    }
    const about = named
      ? await aboutCodes({ [HISTORY]: medications, [LABS]: labs }, pod)
      : undefined;
    return {
      labs,
      timeline,
      series,
      test: input.test,
      ...(input.medication !== undefined && { medication: input.medication }),
      ...(about !== undefined && { about: pairs(about) }),
    };
  }

  async function classes({ pod: name }) {
    const pod = await podNamed(name);
    const [rows, medications] = await Promise.all([
      pod.medicationClasses(),
      pod.ask(MEDICATIONS),
    ]);
    const tables = await host.tables();
    const [about, elsewhere, heldNow] = await Promise.all([
      (async () => classesSaid(rows, { tables }))().catch(noop),
      (async () => classedElsewhere(rows, medications, { tables }))().catch(
        noop,
      ),
      held(tables).catch(() => []),
    ]);
    return {
      rows,
      medications,
      ...(about !== undefined && { classes: pairs(about) }),
      ...(elsewhere !== undefined && { elsewhere: pairs(elsewhere) }),
      held: heldNow,
    };
  }

  async function panel({ pod: name, panel: code }) {
    const pod = await podNamed(name);
    if (typeof code !== "string" || code === "")
      throw new Refusal("a panel is a LOINC code: name one");
    const [rows, labs] = await Promise.all([
      pod.panelResults(code),
      pod.ask(LABS),
    ]);
    const tables = await host.tables();
    const [about, heldNow] = await Promise.all([
      (async () => panelSaid(code, rows, { tables }))().catch(noop),
      held(tables).catch(() => []),
    ]);
    return {
      panel: code,
      rows,
      labs,
      ...(about !== undefined && { panelAbout: pairs(about) }),
      held: heldNow,
    };
  }

  async function table({ id, q = "", page, code }) {
    const tables = await host.tables();
    const heldNow = await tables.held();
    const sources = sourcesOf(heldNow);
    const series =
      id === undefined || code !== undefined
        ? undefined
        : heldNow.find((each) => tableId(each.iri) === id);
    const source =
      series !== undefined
        ? sources.find((each) => each.series.includes(series))
        : id === undefined
          ? sources[0]
          : sources.find((each) => tableId(each.iri) === id);
    if (source === undefined) {
      if (id === undefined) return { held: heldNow };
      throw new Refusal(`no reference table ${id} is held`);
    }
    const shown = pageNumber(page === undefined ? null : String(page));
    if (series !== undefined)
      return {
        held: heldNow,
        source,
        series,
        searched: await tables.search(series.iri, q, shown),
        uses: await tables.uses(),
      };
    const all = source.series.map(({ iri }) => iri);
    if (code !== undefined) {
      const found = await tables.codeNamed(
        [...new Set([...all, ...heldNow.map(({ iri }) => iri)])],
        code,
      );
      if (found === undefined)
        throw new Refusal(`${source.label} holds no code ${code}`);
      return {
        held: heldNow,
        source,
        facts: await tables.facts(found, all),
      };
    }
    return {
      held: heldNow,
      source,
      searched: await tables.search(all, q, shown),
    };
  }

  async function ask({ pod: name, question, limit }) {
    const pod = await podNamed(name);
    const rows = await pod.ask(question);
    return {
      question,
      total: rows.length,
      rows: limit === undefined ? rows : rows.slice(0, limit),
    };
  }

  async function tool({ pod: name, tool: called, input = {} }) {
    if (!TOOLS.includes(called))
      throw new Refusal(`no tool ${called}; the tools are ${TOOLS.join(", ")}`);
    const pod = await podNamed(name);
    if (called === WORTH_A_LOOK.name) {
      checkInput(WORTH_A_LOOK.inputSchema, input);
      const given = last.get(name) ?? (await answers({ pod: name }));
      const { about, said: variants } = maps(await said({ pod: name }));
      return {
        value: worthALook(given.answers, about, variants).map(
          ({ sentence, entry, tag }) => ({
            sentence,
            entry: entryId(entry),
            ...(tag === undefined ? {} : { tag }),
          }),
        ),
      };
    }
    const run = changeTools(pod).find((each) => each.name === called);
    if (called !== "find_changes") return { value: await run.execute(input) };
    checkInput(run.inputSchema, input);
    const found = await findChanges(pod, input);
    return { value: found.map(compact), found };
  }

  async function makePod({ person = "", encrypt = false }) {
    const name = slug(person);
    if (name === "")
      throw new Refusal(
        "Give a name with at least one letter from a to z, or a digit.",
      );
    if (DEVICES.test(name))
      throw new Refusal(
        "That name is one Windows keeps for itself: add another word.",
      );
    if ((await host.pods.names()).includes(name))
      return { pod: name, made: false };
    if (host.samples?.includes(name)) {
      await sampleFor(name);
      return { pod: name, loaded: true };
    }
    if (encrypt) {
      waiting.set(name, { words: sixWords(), person: person.trim() });
      return { pod: name, waiting: true };
    }
    await openOnce(name, { title: person.trim() });
    return { pod: name, made: true };
  }

  function waitingFor(name) {
    const words = waiting.get(name);
    if (words === undefined) throw new Refusal(NOT_WAITING);
    return words;
  }

  async function confirmWords(input) {
    const { pod: name, word2 = "", word5 = "" } = input;
    const { words, person } = waitingFor(name);
    const changed = savedLoginChanged(
      new Map(Object.entries(input)),
      name,
      words,
    );
    if (changed !== undefined) throw new Refusal(changed);
    const asked = words.split(" ");
    if (typedWords(word2) !== asked[1] || typedWords(word5) !== asked[4])
      throw new Refusal(NOT_WORDS);
    waiting.delete(name);
    if ((await host.pods.names()).includes(name))
      throw new Refusal(
        `A pod named ${name} exists already. Make the pod again under another name.`,
      );
    if (!(await openOnce(name, { secret: words, title: person })).encrypted)
      throw new Error(`The pod ${name} was made without its words.`);
    return { pod: name, made: true };
  }

  async function unlock({ pod: name, secret = "" }) {
    await known(name);
    try {
      await openOnce(name);
    } catch (error) {
      if (!(error instanceof Unopened)) throw error;
      if (secret.trim() === "")
        throw new Unopened("incorrect secret", "no secret was given");
      await openOnce(name, { secret });
    }
    return { pod: name, opened: true };
  }

  async function deleteAll() {
    const names = await host.pods.names();
    waiting.clear();
    forgetConnections();
    await closeOpened();
    await host.pods.remove(names, { all: true });
    return { deleted: names };
  }

  async function resetAll() {
    await deleteAll();
    if (!(host.samples?.length > 0)) return { pods: await host.restore() };
    for (const name of host.samples) await sampleFor(name);
    return { pods: [...host.samples] };
  }

  async function checkTables() {
    const checked = await host.checkTables();
    if (checked.some(({ kept }) => kept.length > 0))
      await closeOpened({ plaintextOnly: true });
    last.clear();
    return { checked, held: await held() };
  }

  async function setWorldDate({ date = "" }) {
    const asOf = worldInstant(date);
    if (date.trim() !== "" && asOf === undefined)
      throw new Refusal(
        `"${date}" is not a date: give a day as YYYY-MM-DD, or an instant with its timezone.`,
      );
    await host.world.set(asOf);
    return asOf === undefined ? {} : { asOf };
  }

  /** The step a connection is at; `bringing in` while its record is brought in. */
  const stepOf = (connection) =>
    connection.bringing === undefined ? connection.step : "bringing in";
  const settled = (connection) => !UNDER_WAY.includes(stepOf(connection));
  const stateOf = (connection) =>
    JSON.stringify([
      stepOf(connection),
      connection.requests,
      connection.bringing,
    ]);

  /** Stops every connection's sign-in and pull, and forgets them. */
  function forgetConnections() {
    for (const each of connections.values()) each.stop.abort();
    connections.clear();
  }

  /** Wakes whoever waits for the connection to change. */
  function changed(connection) {
    for (const wake of connection.waiting.splice(0)) wake();
  }

  const nextChange = (connection) =>
    new Promise((wake) => connection.waiting.push(wake));

  /** Holds until the connection settles, or for `wait: "change"` changes, or `WAIT_MS` have passed. */
  async function holdFor(connection, wait) {
    const was = stateOf(connection);
    const over = () =>
      settled(connection) || (wait === "change" && stateOf(connection) !== was);
    let timer;
    const late = new Promise((done) => {
      timer = globalThis.setTimeout(done, WAIT_MS, LATE);
      timer.unref?.();
    });
    try {
      while (
        !over() &&
        (await Promise.race([nextChange(connection), late])) !== LATE
      );
    } finally {
      globalThis.clearTimeout(timer);
    }
  }

  async function connectTo({ pod: name, fhirBase }) {
    await podNamed(name);
    const { hospitals } = host;
    const row = (await hospitals.directory()).find(
      (each) => each.fhirBase === fhirBase,
    );
    if (row === undefined)
      throw new Refusal("That hospital is not in the directory.");
    const n = ++count;
    const connection = {
      pod: name,
      row,
      n,
      name: `${hospitals.pullName(row)}-${n}`,
      step: "signing in",
      requests: 0,
      asOf: row.vendor === "demo" ? await host.world?.get() : undefined,
      waiting: [],
      stop: new globalThis.AbortController(),
    };
    connections.set(n, connection);
    let report;
    const reported = new Promise((resolve) => (report = resolve));
    const signedIn = (async () => {
      await hospitals.ready(row);
      return connect(
        row,
        { ...hospitals.registration, scopes: SCOPES },
        {
          signIn: hospitals.signIn(row, { pod: name, connection: n }, report),
          fetch: async (url, init) => {
            const answer = await hospitals.fetch(url, init);
            connection.requests += 1;
            changed(connection);
            return answer;
          },
          signal: connection.stop.signal,
        },
      );
    })();
    connection.pulled = signedIn.then((signed) => {
      connection.step = "pulling";
      changed(connection);
      return pull(signed, DEMO_PLAN, { signal: connection.stop.signal });
    });
    connection.pulled.then(
      () => {
        connection.step = "pulled";
        changed(connection);
      },
      () => {
        connection.step = "failed";
        changed(connection);
      },
    );
    const authorize = await Promise.race([reported, signedIn.then(noop, noop)]);
    return authorize === undefined
      ? { connection: n }
      : { connection: n, authorize };
  }

  function connectionOf(name, n) {
    const found = connections.get(n);
    if (found?.pod !== name)
      throw new Refusal(`no connection ${n} for the pod ${name}`);
    return found;
  }

  /** The files a connection's pull is saved as, read once, or why there are none: it failed, or was refused. */
  function filesOf(connection) {
    connection.files ??= (async () => {
      let pulled;
      try {
        pulled = await connection.pulled;
      } catch (error) {
        if (!(error instanceof ConnectionFailure)) throw error;
        const said = error.message;
        return {
          failed: said.endsWith(".") ? said : `${said}.`,
          failure: error.kind,
        };
      }
      try {
        return {
          pulled,
          files: pullFiles(
            { ...pulled, asOf: utcInstant(connection.asOf) },
            connection.name,
          ),
        };
      } catch (error) {
        if (error instanceof PullRefused)
          return { failed: `Refused: ${error.message}` };
        globalThis.console.error(error);
        return { failed: PULL_BROKEN };
      }
    })();
    return connection.files;
  }

  async function connectionNow({ pod: name, connection: n, wait }) {
    await known(name);
    const connection = connectionOf(name, n);
    if (wait !== undefined) await holdFor(connection, wait);
    const shown = {
      n,
      row: connection.row,
      step: stepOf(connection),
      settled: settled(connection),
      requests: connection.requests,
      ...(connection.asOf !== undefined && { asOf: connection.asOf }),
      ...(connection.bringing !== undefined && {
        bringing: connection.bringing,
      }),
    };
    if (!settled(connection)) return shown;
    const { failed, failure, pulled, files } = await filesOf(connection);
    if (failed !== undefined)
      return { ...shown, failed, ...(failure !== undefined && { failure }) };
    if (connection.failed !== undefined)
      return {
        ...shown,
        failed: connection.failed,
        ...(connection.retry && { retry: true }),
      };
    const patient = patientName(pulled.bundle);
    return {
      ...shown,
      sources: await (await podNamed(name)).look(files),
      pulled: { denied: pulled.denied, missing: pulled.missing },
      ...(patient !== undefined && { patient }),
      patientNames: patientNames(pulled.bundle),
      ...(connection.broughtIn && { broughtIn: true }),
    };
  }

  async function bring({ pod: name, connection: n }) {
    await known(name);
    const connection = connectionOf(name, n);
    if (connection.bringing !== undefined) return { step: "bringing in" };
    const { files } =
      connection.step === "pulled" ? await filesOf(connection) : {};
    if (files === undefined) throw new Refusal("nothing pulled to bring in");
    const pod = await podNamed(name);
    if (connection.bringing !== undefined || connection.imported)
      return { step: stepOf(connection) };
    connection.failed = undefined;
    connection.retry = undefined;
    connection.bringing = { part: "loading the adapter" };
    changed(connection);
    pod
      .import(files, {
        aboutSubject: true,
        onProgress: (part) => {
          connection.bringing = part;
          changed(connection);
        },
      })
      .then(
        (done) => {
          connection.imported = true;
          if (done.refused === undefined) connection.broughtIn = true;
          else connection.failed = `Refused: ${done.refused}`;
          last.delete(name);
        },
        (error) => {
          globalThis.console.error(error);
          connection.failed = NOT_BROUGHT_IN;
          connection.retry = true;
        },
      )
      .finally(() => {
        connection.bringing = undefined;
        changed(connection);
      });
    return { step: "bringing in" };
  }

  const operations = {
    async pods() {
      const names = await host.pods.names();
      seen.clear();
      for (const each of names) seen.add(each);
      return {
        pods: await Promise.all(
          names.map(async (name) => ({ name, title: await titleOf(name) })),
        ),
      };
    },
    async held() {
      try {
        return { held: await held() };
      } catch {
        return { held: [], failed: true };
      }
    },
    async pod({ pod: name }) {
      await known(name);
      const title = await titleOf(name);
      try {
        const pod = await openOnce(name);
        return { name, title, encrypted: pod.encrypted === true };
      } catch (error) {
        if (!(error instanceof Unopened)) throw error;
        return { name, title, encrypted: true, locked: error.outcome };
      }
    },
    answers,
    said,
    trend,
    classes,
    panel,
    table,
    ask,
    tool,
    makePod,
    waitingWords: async ({ pod: name }) => ({
      pod: name,
      ...waitingFor(name),
    }),
    confirmWords,
    unlock,
    deleteAll,
    resetAll,
    checkTables,
    setWorldDate,
    async hospitals({ q = "" }) {
      const asOf = await host.world?.get();
      return {
        rows: searchDirectory(await host.hospitals.directory(), q),
        ...(asOf !== undefined && { asOf }),
      };
    },
    connect: connectTo,
    connection: connectionNow,
    bring,
  };
  return {
    ...Object.fromEntries(
      OPERATIONS.map((name) => [name, typed(name, operations[name])]),
    ),
    close: async () => {
      forgetConnections();
      await closeOpened();
    },
  };
}

const noop = () => undefined;
const LATE = Symbol("late");
