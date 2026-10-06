# The proof: fresh agents build apps from the page

Whether an agent that has never seen these repositories, given the page's prompt
and an idea, builds an app that runs, shows Alex's records as the views state
them, and uses only the calls the guide teaches. A person runs it by hand; this
file is all a round needs. The issue is jayostis/cascade-runtime-js#33.

## A round

Eight runs: three of each idea with the agent the maintainer builds with, and
one of each with a second agent from another maker that reads `AGENTS.md`
unasked. Each run starts fresh and gets its own sheet, a comment on #33.

### Before each round: re-check the facts

The facts below were checked on vocabulary commit
`9990bdf299469d56686a40d14430042f590640fc`, FHIR R4 adapter
`212e7677fa3367634a8b793fa4a6302845a85407` and Bridge release
`build-e1bdff0a4cb325d75f618a95c050a47b9bbd0776`. The package follows each at
the head of its branch, so read what the round's package records, in a made app:

```sh
node -p "require('./node_modules/cascade-runtime/components/packed.json').components.map(c => c.repository + ' ' + c.commit).join('\n')"
```

If the vocabulary's commit differs, diff it
(`git diff <old>..<new> -- conformance/alex-rivera queries runtime ontologies`
in cascade-vocabulary), re-read each example and rule a fact cites, and correct
the fact here before the round runs. If the adapter or the Bridge differs, check
W1 and W2's counts again with `look` and `import` on a pod through M3. Record
the commits you checked against in the round's results.

### Starting state

An empty folder, inside no folder that holds an agent instructions file, under a
user with no user-level instructions, memory or extra tools configured for the
agent. The person runs the command in it, so the app is `my-app/`.

- **Round 1:** the command exactly as https://jayostis.github.io/cascade-runtime-js/
  gives it, of the form
  `npx --yes --package=<tarball address> create-cascade-app my-app`.
- **A later round** (after a change to the guide, the starter's files or the
  prompt): at the pull request's head, `npm run build:package`, which writes
  `build/cascade-runtime-0.0.0-commit-<sha>.tgz`. That commit has no release, so
  give its path twice:
  `npx --yes --package=<path to the .tgz> create-cascade-app my-app --tarball <path to the .tgz>`.

Then, per idea:

- **Reading:** nothing more. The person does **not** run `pod:load` or any
  other script: the app has no pod, and the agent must find
  `npm run pod:load alex-rivera` itself, from the no-pod line, `README.md` or
  `AGENTS.md`. A pod the person loaded is a protocol deviation, and the sheet's
  Pod line is then untested.
- **Writing:** in `my-app/`, run `npm run pod:load -- alex-rivera --through M3`
  (her pod after her son's download, E10, and before its mistaken claim, J22),
  then copy x-e12, as a person puts their phone's download there:

  ```sh
  cp -r node_modules/cascade-runtime/components/cascade-vocabulary/<commit>/conformance/alex-rivera/scripted-input/alex/downloads/x-e12/apple_health_export .
  ```

  `<commit>` is the vocabulary commit this app's `packed.json` records (the
  only folder under `cascade-vocabulary/`). x-e12 is the one thing left to bring
  in.

Start a new session of the agent **in the folder that holds `my-app/`**, not
inside it, as the page and the command say. Turn its web search and web fetch
off where it has a switch. Paste the prompt the command printed, the page's
too:

```text
Build me an app on a Cascade pod. Work inside my-app: read its AGENTS.md first and follow it, and use only what its guide teaches.
My idea: <describe your idea in a sentence>
```

with its last line replaced by "My idea: " and the idea. That is the first and
only instruction.

### The two ideas, verbatim

- **Reading:** "I want an app where I can search all my health records for a
  word, like penicillin, and see where my two hospitals disagree about me."
- **Writing:** "I want an app where I can bring in the health download from my
  phone (it's in the folder apple_health_export), add an allergy my hospitals
  don't know about, and say yes or no to records it thinks are the same thing."

Between them they use every call: reading, `openPod`, `ask`, `close`; writing,
`openPod`, `look`, `import` with `aboutSubject: true` (only after a yes),
`enter`, `judge`, `ask`, `close`. `match` is covered by the default `import` and `enter` run; an explicit
`match` with matching on is a wrong turn.

### What the person may say

After the first prompt, only these, each counted on the sheet:

- "It does not start." and what the terminal printed, pasted unedited;
- "It shows an error." and the error, pasted unedited;
- "I can't find how to …" ending in words from the idea, such as "add an
  allergy";
- "Please decide for me." in answer to any question the agent asks.

Nothing else: no call, file, script, record, term or document named, no pointer
to the guide, no hand edit to the app. Approve every action the agent asks to
take; note any outside `my-app/`.

### Using the app

When the agent says it is done, start the app as the command's output said
(`npm start` in `my-app/`, then http://127.0.0.1:3000/, unless the app says
otherwise) and use its screens:

- **Reading:** search "penicillin", then "amoxicillin", then "codeine"; open
  whatever it shows of disagreements.
- **Writing:** bring in the download and answer yes when asked whether it is
  yours; add Shellfish, reaction hives, low if asked how severe; reject the join
  of the two asthma records; confirm the join of the hypertension records; stop
  the app and start it again.

### Stop

A run stops at 90 minutes of the agent's work or ten of the person's messages
after the first prompt, whichever comes first. A stopped run is not clean.

## The facts a correct app shows

By meaning, each from Alex's kit, `conformance/alex-rivera/` in the vocabulary
(`alex-rivera.feature`, `expected/`). An example is named by its words, under
its rule.

### Reading, on the pod after her whole story

- **R1.** A search for penicillin shows one allergy, Penicillin, active, high
  criticality, joining three records: Meridian's, and Larkspur's at each of its
  two servers. (`expected/allergies.ttl`; under `Rule: P1.`, "J21, Alex's Same,
  joins the three penicillin records, even under export".)
- **R2.** Searches for amoxicillin and for codeine show nothing of hers. The
  amoxicillin allergy is her son Sam's, whose profile no counting About claims
  (under `Rule: P24.`, "each of Sam's three records is left out because no
  About that counts claims his profile"); the codeine one Meridian entered in
  error (under `Rule: P6.`, "H1-ALG-CODEINE, entered in error at its source in
  x-e6, is in no view, for that reason"). An app that shows either, or Sam's
  eczema or otitis as hers, searched records rather than her views.
- **R3.** The hospitals disagree on Sulfamethoxazole: Meridian says low
  criticality, Larkspur high, and the allergy shows high. `entry/What needs
review` lists it as "members disagree on criticality". (Under `Rule: P4.`,
  "at E13, the entry holding H1-ALG-SULFA still shows the most severe
  criticality its members give".)

### Writing, on the pod through M3, with x-e12 brought in

The import, its claim and its matcher run are stamped with the moment the run
happens, earlier in the story than M3. An entry shows the name, code and status
of its last-arrived member (`rec:latestMember`, by its current revision's time),
so where an x-e12 record joins an entry, what the entry is called, and in W2 one
status, depend on the run's date. Judge a fact by meaning, not by the name.

- **W1.** Before bringing the download in, the app shows where it came from and
  asks whether it is hers: Meridian Health System at
  `https://fhir.meridian.example/api/FHIR/R4`, 5 allergies, 5 conditions, 2
  immunizations, 2 procedures, and Larkspur Valley Health at
  `https://ehr.larkspur.example/fhir/R4`, 2, 2, 1, 1, both already claimed (J1,
  J2); Larkspur Valley Health at `https://fhir.larkspur.example/r4`, 2, 2, 1, 1,
  received 2027-03-18, not claimed. (`export.xml` of x-e12; `look`'s `name`,
  `server`, `records`, `received`, `claimed`; the test "the look reads the
  export's index and writes nothing" in
  `packages/cascade-runtime/test/pod.test.ts`.) Meridian's counts include Sam's
  allergy and two conditions, which the look cannot tell apart. The app calls
  `import` only after her yes; on a no it writes nothing, and an `import`
  without the claim is a wrong turn.
- **W2.** With her yes, six records arrive, all from Larkspur's new server: two
  allergies, two conditions, an immunization, a procedure (E12 in "each import
  and entry writes the scenario's numbers of records, versions, revisions,
  documents and activities"). The app shows what was claimed: that server's one
  patient profile, as J12 claims it (`claimed` holds it, `unclaimed` is empty).
  Sam's three records are in x-e12 unchanged since x-e10: the import writes
  nothing of them and does not claim his profile, so they stay in no view
  (`rec:PatientNotClaimed` in `record/Why it is in no view`). The matcher joins
  what E13 joined ("E13 writes J13 to J18 as the scenario gives them, and the
  reference descriptions it was the first to use"): hypertension is one active
  condition of three records, where before it had two (named "Hypertension"
  before 2026-10-14 15:42 UTC, Larkspur's old record's arrival); Penicillin
  (Larkspur's, still apart from Meridian's Penicillin G until J21) and
  Sulfamethoxazole each gain Larkspur's new record; and Larkspur's new Asthma
  joins the entry that her own Same (J10) made of Meridian's resolved bronchitis
  and Larkspur's old asthma, three records in one condition. **Its status
  depends on the run's date:** before 2026-11-20 09:00:04 UTC (the bronchitis
  record's arrival, x-e6 at E6) the bronchitis record is still the last arrival,
  so the entry shows Acute bronchitis, resolved, and `pod/My active conditions`
  lists hypertension alone; after it, the entry shows Asthma, active, as at E13
  (under `Rule: P22.`, "J16 adds
  H2F-CON-ASTHMA, the latest arrival, whose active status the entry now
  shows"). An app that shows Sam's records as hers, or claims his profile, is
  wrong.
- **W3.** Shellfish then appears among her allergies, an entry of its own with
  one record and no status, and is not in `pod/My active allergies`, as Peanuts
  is not (under `Rule: P16.`, "APP-ALG-PEANUT is Alex's, and its entry shows
  its criticality and no status").
- **W4.** The app offers the import's join of Larkspur's two asthma records, old
  server and new. Because her Same of bronchitis with the old one (J10) still
  counts, that join pulls the resolved bronchitis in with them (under
  `Rule: P22.`). Once she says the two asthma records are not the same, Asthma
  is active with the new server's record alone, and the old one stays with
  bronchitis in a resolved Acute bronchitis entry, as J10 says (as under
  `Rule: P11.`, "J8, Alex's Different, keeps apart the colonoscopies the matcher
  joined", for the colonoscopies).
- **W5.** The app offers the joins of Meridian's "Essential hypertension" with
  Larkspur's "Hypertension" ("E5 writes J3 to J7 as the scenario gives them,
  …") and, from the import, with Larkspur's new "Essential hypertension" too
  ("E13 writes J13 to J18 …"); no person has judged either. Once she says they
  are the same, hypertension is still one condition of three records, and
  `judgment/Whether it counts` lists her Same as counting.
- **W6.** After the app is stopped and started again, W2 to W5 still show.

## The sheet

Copy into a comment on #33, one per run, every line filled.

```markdown
| Line                  | Written                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Run                   | idea: · round: · run: · agent: · version: · model: · tarball: · `cascadeRuntime.commit`: · `dirty`: · vocabulary commit: · adapter commit: · Bridge release:                                                                                                                                                                                                                                                                                                               |
| Command               | worked / failed (output):                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Pod                   | reading: loaded `pods/alex-rivera/` with `pod:load alex-rivera`? found it from: · writing: left the loaded pod as it was?                                                                                                                                                                                                                                                                                                                                                  |
| Started               | yes / no                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Facts                 | R1–R3 or W1–W6, each: shown right / shown wrong (what was shown) / not shown                                                                                                                                                                                                                                                                                                                                                                                               |
| Out of place          | rows of `npm run ask -- --pod alex-rivera "pod/Which files are out of place"`:                                                                                                                                                                                                                                                                                                                                                                                             |
| Outside the interface | each, with file and line: wrote, changed or deleted a file under `pods/`; read a pod file or parsed Turtle other than to fill a template; named a thing; imported, in code the app runs that the agent wrote or changed, anything but `cascade-runtime`'s root (`cascade-runtime/fixtures` included; a test, a file `npm start` never loads, may import `replayKit` from it); ran the conformance command or a script of this repository; read the repositories or the web |
| `enter` and `judge`   | each call: Turtle passed (attached); filed / refused / rejected and why; the template followed and what it changed                                                                                                                                                                                                                                                                                                                                                         |
| Wrong turns           | each: what the agent did, how it noticed or not, the line of the guide, starter or prompt that caused it or failed to prevent it (always one: an explicit `match` with matching on; writing: a `pod:reset` or `pod:load` of the person's pod)                                                                                                                                                                                                                              |
| Calls                 | which of the interface's calls the app makes                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Effort                | minutes of the agent's work; the person's messages, verbatim; finished in one session?                                                                                                                                                                                                                                                                                                                                                                                     |
| Clean                 | yes / no, and why                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
```

## The bar

- **A run is clean** when the command worked, the app started, every fact for
  its idea is shown right, nothing is out of place, nothing went outside the
  interface, it finished in one session, and the person sent at most three
  messages after the first prompt. Going outside the interface always makes a
  run unclean, even when every fact is right.
- **A round passes** when, for each idea, at least two of the first agent's
  three runs are clean and the second agent's one run is clean.
- **The step is proven** when a round passes with the guide, the starter's
  files, the prompt and the interface as they will merge, and every finding of
  every round has an outcome.
- **After three rounds without a pass,** stop and decide whether the interface
  must change; that is an interface issue, and #33 waits for it.

## Where findings go

A finding is anything a run got wrong or was slowed by: each wrong turn, each
line outside the interface, each message the person sent. A clean run can have
findings. Each gets an outcome:

- **The guide, the starter's `AGENTS.md` and `README.md`, or `agentPrompt()`:**
  a commit on #33's pull request naming the finding. The guide stays at most 400
  lines (`wc -l` after `npm run format`): cut a line for each line added; a
  finding that cannot be answered within 400 lines is decided by the maintainer
  in that round's pull request, naming it. `npm test` and `npm run lint` stay
  green. The next round runs all eight again on the head's tarball.
- **The interface:** a new issue, filed by the maintainer and linked from #20.
  A finding an open follow-up already holds goes on it, with its sheet: #41,
  #42, #43, #46, #48, #49, #51.
- **A friendlier `enter` and `judge`:** if two or more of a round's four writing
  runs went wrong because of the Turtle (a call rejected or refused for it, a
  template's statement dropped or changed so that W3, W4 or W5 is wrong, a
  prefix or term guessed), file an issue for a friendlier form with those
  sheets. Otherwise the pull request says Turtle held, with the counts.
- **The claim:** what the runs show of claiming and retracting feeds the
  safer-rule follow-up in #20's compromises table.
- **Anything left** goes in the pull request's description, for the follow-ups
  issue #20 collects when it closes.

Throw the built apps away once the round is written up; a finding quotes the
lines it is about.
