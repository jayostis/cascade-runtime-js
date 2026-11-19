# What the performance numbers mean

Generated from `packages/cascade-runtime/test/perf-glossary.json`; edit that file, then run
`node packages/cascade-runtime/dist/test/perf-glossary.js > docs/perf-glossary.md`. A test fails if this page is out of date or if the performance file names something the glossary lacks.

## Scenarios

| Term | Meaning |
|---|---|
| `fresh-first-screen` | A new, empty pod takes in a person's whole record and shows the first screen. |
| `reopen-first-answer` | A pod that already holds the record is opened again and answers its first question. |
| `question-page` | Fetching one page of 20 answers to each of the app's questions, from the saved database. |
| `close` | Closing a pod straight after it took in a record and drew the first screen. |

## Datasets

| Term | Meaning |
|---|---|
| `synthea-10y` | Synthea's realistic synthetic patient, a 10-year record of 647 records. No real person's data. |
| `synthea-lifetime` | A synthetic patient's whole life, 16,833 records: the large size, run nightly. |

## Plain and encrypted

| Term | Meaning |
|---|---|
| `plain` | The pod's files are stored readable. |
| `encrypted` | The pod's files are stored scrambled with a secret, as a person's private pod would be. |

## Measurements of a scenario

Each is a row named `<scenario>-<dataset>[-encrypted]/<measurement>`. `total` is the scenario's own sentence above.

| Term | Meaning |
|---|---|
| `fresh-first-screen/total` | Opening a new pod, importing the whole record and asking the first screen's questions: what a person waits for the first time. |
| `reopen-first-answer/total` | Opening an existing pod and answering its first read: what a returning person waits for. |
| `question-page/total` | Fetching one page of answers for every question in turn. |
| `close/total` | Closing a pod straight after its import and first screen, which saves its database. |
| `total` | The headline: the whole scenario from start to finish, the middle of three runs. |
| `open` | Opening the pod. |
| `import` | Importing the whole record into the pod. |
| `first-screen` | Asking the questions the first screen shows. |
| `first-read` | The first question asked of the reopened pod ('My active conditions'). |
| `second-read` | A second question asked of the reopened pod ('My active medications'). |
| `close` | Closing the pod, saving its database. |
| `rss` | Memory the process was holding when the scenario's work was done, in bytes. |
| `peak-rss` | The most memory the process held at any moment, in bytes. |
| `probed-total` | The scenario's time in one run with the probe on, which slows some work; its stages are from this run and are for finding where time goes, never for adding up to the headline. |
| `phase-loading-the-adapter` | Import part: loading the adapter that knows this kind of record. |
| `phase-converting` | Import part: converting the source record into the pod's own format. |
| `phase-saving` | Import part: writing the converted records into the pod. |
| `phase-judging` | Import part: judging which records are the same thing recorded twice. |
| `phase-*` | Import part: {name}. |
| `question-*` | One page of 20 answers to: {name}. |

## Stages of the probed run

Rows named `<scenario>-<dataset>/stage/<stage>`: where time goes inside one run with the probe on. A stage's time includes the stages inside it, so stages overlap and do not add up to the total.

| Term | Meaning |
|---|---|
| `scenario.open` | Opening the pod: finding its folder, its keys and its saved state. |
| `scenario.import` | Bringing the whole record into the pod: converting it, checking it, saving it and judging which records are the same. |
| `scenario.first-screen` | Asking the questions the app's first screen shows, so the first screen can be drawn. |
| `scenario.first-read` | The first question asked of a reopened pod. |
| `scenario.second-read` | A second, different question asked of the reopened pod. |
| `scenario.close` | Closing the pod, saving its database for the next time it opens. |
| `core-pod.step.perform` | Doing the work of one import step: taking in the new records. Sits inside `scenario.import`. |
| `core-pod.step.commit` | Writing the step's results to the pod's files and recording that it happened. Sits inside `scenario.import`. |
| `core-pod.step.finished` | The last bookkeeping of a step, once everything is written. Sits inside `scenario.import`. |
| `core-pod.step.keptafter` | Bringing the saved answers up to date after a step. Sits inside `scenario.import`. |
| `core-pod.step.rebuild-import` | Re-deriving what the imported records change. Sits inside `scenario.import`. |
| `core-pod.step.rebuild-match` | Re-deriving what the 'same record' matching changes. Sits inside `scenario.import`. |
| `core-pod.step.rebuild-other` | Re-deriving everything else a step changes. Sits inside `scenario.import`. |
| `core-pod.import.adapters` | Reading the adapter that knows how to convert this kind of record. Sits inside `scenario.import`. |
| `core-pod.import.documents` | Taking in the documents (notes, reports) that came with the record. Sits inside `scenario.import`. |
| `core-pod.inputshash` | Working out a fingerprint of everything a result depends on, to know when it can be reused. |
| `core-pod.matcherselect` | Asking the pod's facts which records might be the same as each other. |
| `core-pod.matcherview` | Preparing the pod's facts for the 'same record' matcher. |
| `core-pod.databaseanswers` | Answering a question from the pod's saved database instead of the files. |
| `core-pod.rebuild.writeall` | Writing every rebuilt file out to the pod. |
| `core-pod.rebuild.bytes` | Turning rebuilt facts into the bytes that are written. |
| `core-pod.keepdatabase` | Saving the pod's database so the next opening is fast. Sits inside `scenario.close`. |
| `core-pod.keepdatabase.whole` | Saving the database whole, from the pod's current facts. Sits inside `core-pod.keepdatabase`. |
| `core-pod.keepbuild` | Preparing the content of the saved database. Sits inside `core-pod.keepdatabase`. |
| `core-pod.keepbuild.dump` | Gathering the pod's facts to put in the saved database. Sits inside `core-pod.keepbuild`. |
| `core-pod.keepbuild.write` | Writing the gathered facts into the saved database. Sits inside `core-pod.keepbuild`. |
| `core-pod.compact` | Tidying the pod's files into fewer, larger ones. |
| `arrivals.fileexport` | Writing the pod's new files out of the import. Sits inside `core-pod.step.commit`. |
| `arrivals.convert` | Converting the source record into the pod's own format with the adapter. Sits inside `scenario.import`. |
| `arrivals.accepting` | Deciding which of the converted records the pod accepts. Sits inside `scenario.import`. |
| `arrivals.parsegraph` | Reading the converted records as facts. Sits inside `scenario.import`. |
| `arrivals.refuseunaccounted` | Checking that nothing in the converted records was left unexplained. Sits inside `scenario.import`. |
| `arrivals.arrivals` | Working out what each arriving record is and where it belongs. Sits inside `scenario.import`. |
| `arrivals.revisions` | Working out which records are new versions of ones the pod already holds. Sits inside `scenario.import`. |
| `arrivals.revisions.prepare` | Getting the existing records ready to compare with the arriving ones. Sits inside `arrivals.revisions`. |
| `arrivals.revisions.write` | Writing the new versions of records. Sits inside `arrivals.revisions`. |
| `arrivals.revisionsof` | Finding the earlier versions of one record. |
| `files.read.file` | Reading one file from the pod's folder. |
| `files.write.file` | Writing one file into the pod's folder. |
| `files.write.rename` | Moving a finished file into place, so a half-written file is never seen. |
| `files.hash.sha256` | Fingerprinting a file's content to tell whether it changed. |
| `files.encrypt` | Scrambling a file with the pod's secret before it is written (encrypted pods only). |
| `files.decrypt` | Unscrambling a file with the pod's secret as it is read (encrypted pods only). |
| `files.commit.index` | Writing the pod's list of its encrypted files (encrypted pods only). |
| `pod.match` | Judging which records in the pod are the same thing recorded twice. Sits inside `scenario.import`. |
| `pod.unclaimedprofiles` | Finding people in the records whom nobody has claimed as the pod's owner. |
| `pod.judge` | Applying a person's own decisions about which records are the same. |
| `pod.profilestied` | Working out which of the person's profiles are the same person. |
| `store.query` | One question put to the pod's fact store; the time of every such question added up. |
| `union.loadfiles` | Loading the pod's files into memory as facts. |
| `union.loadturtle` | Loading text-format facts into memory. |
| `union.add` | Adding facts to the pod's in-memory facts. |
| `union.drop` | Dropping facts from the pod's in-memory facts. |
| `union.removesubjects` | Removing everything known about some records from the in-memory facts. |
| `union.select` | Asking the in-memory facts a question that returns rows. |
| `union.construct` | Asking the in-memory facts a question that returns new facts. |
| `union.holds` | Checking whether the in-memory facts hold something. |
| `kept.step` | Keeping the saved answers current after one step. Sits inside `core-pod.step.keptafter`. |
| `kept.step.scoped` | Finding the part of the pod a step touched. Sits inside `kept.step`. |
| `kept.step.podfiles` | Reading the pod files that part holds. Sits inside `kept.step`. |
| `kept.step.namedbefore` | Finding what the touched records were called before the step. Sits inside `kept.step`. |
| `kept.step.reached` | Finding every record the step's changes reach. Sits inside `kept.step`. |
| `kept.step.closed` | Widening the touched part until nothing else depends on it. Sits inside `kept.step`. |
| `kept.step.rebuilt` | Re-deriving the answers for the touched part. Sits inside `kept.step`. |
| `kept.reached.judged` | Looking up the judgments that concern the reached records. |
| `kept.rebuilt.filesof` | Finding the files of the records being re-derived. |
| `kept.rebuilt.podfiles` | Reading the pod files of the records being re-derived. |
| `kept.rebuilt.derive` | Re-deriving the answers for the re-derived records. |
| `kept.rebuilt.held` | Setting aside the answers that stay as they were. |
| `kept.whole` | Keeping the saved answers current by re-deriving all of them. |
| `kept.whole.derive` | Deriving every answer from every record. Sits inside `kept.whole`. |
| `kept.whole.podfiles` | Reading every pod file. Sits inside `kept.whole`. |
| `kept.whole.recordsandtheirs` | Gathering every record with what belongs to it. Sits inside `kept.whole`. |
| `kept.scoped.podfiles` | Reading the pod files of just the part being kept current. |
| `build.queried` | Building the pod's answer files by running each of the pod's questions over its facts. |
| `build.queried.currentversions` | Picking the current version of each record. Sits inside `build.queried`. |
| `build.queried.viewsheld` | Setting aside answer files that did not need rebuilding. Sits inside `build.queried`. |
| `build.queried.written` | Writing the answer files that changed. Sits inside `build.queried`. |
| `incremental.boundvalues` | Narrowing a question to only the records that changed. |
| `matcher.of` | The whole 'same record' matching of one group of records. |
| `matcher.of.read` | Reading the records to be compared. Sits inside `matcher.of`. |
| `matcher.of.podcodes` | Looking up the medical codes of the records being compared. Sits inside `matcher.of`. |
| `matcher.of.withcurrentversions` | Adding each record's current version to the comparison. Sits inside `matcher.of`. |
| `matcher.of.over` | Running the matching rules over the records. Sits inside `matcher.of`. |
| `matcher.of.withpartners` | Adding the records that matched, so their partners are compared too. Sits inside `matcher.of`. |
| `matcher.of.releaseview` | Letting go of the matcher's working copy of the facts. Sits inside `matcher.of`. |
| `matcher.recordreads` | Reading the records the matcher compares. |
| `matcher.actstaken` | Reading what people have already decided about which records are the same. |
| `matcher.take` | Picking the records a rule will compare. |
| `matcher.filefindings` | Reading what the matcher noted last time about each file. |
| `matcher.view` | Building the matcher's working copy of the facts. |
| `pod-database.build.worker` | Starting the helper that builds the saved database. Sits inside `core-pod.keepdatabase`. |
| `pod-database.build.load` | Loading the pod's facts into the saved database. Sits inside `core-pod.keepdatabase`. |
| `pod-database.build.screens-fill` | Filling in the database's ready-made answer tables. Sits inside `core-pod.keepdatabase`. |
| `pod-database.build.screens-tables` | Creating the database's ready-made answer tables. Sits inside `core-pod.keepdatabase`. |
| `pod-database.build.screens-finish` | Finishing the database's ready-made answer tables. Sits inside `core-pod.keepdatabase`. |
| `pod-database.build.sync` | Making the saved database safely written to disk. Sits inside `core-pod.keepdatabase`. |
| `pod-database.build.close` | Closing the saved database. Sits inside `core-pod.keepdatabase`. |
| `pod-database.build.rename` | Moving the finished database into place. Sits inside `core-pod.keepdatabase`. |
| `bridge.stage-records` | The Bridge turns the source record's entries into the pod's records. Sits inside `arrivals.convert`. |
| `bridge.stage-mapping` | The Bridge looks up how each source field maps to the pod's terms. Sits inside `arrivals.convert`. |
| `bridge.stage-index` | The Bridge indexes the source record so entries can be found quickly. Sits inside `arrivals.convert`. |
| `bridge.stage-lift` | The Bridge lifts the source record into facts. Sits inside `arrivals.convert`. |
| `bridge.stage-documenttable` | The Bridge collects the documents the record refers to. Sits inside `arrivals.convert`. |
| `bridge.stage-serialising` | The Bridge writes its result out as text. Sits inside `arrivals.convert`. |
| `bridge.stage-summary` | The Bridge totals what it converted. Sits inside `arrivals.convert`. |
| `bridge.stage-dataset` | The Bridge assembles the converted facts. Sits inside `arrivals.convert`. |
| `bridge.stage-detect` | The Bridge recognises what kind of record this is. Sits inside `arrivals.convert`. |
| `bridge.query-detect.rq` | The query that recognises what kind of record this is. Sits inside `bridge.stage-detect`. |
| `core-pod.selectstated.podfiles` | Reading the pod files a question about stated facts needs. |
| `core-pod.filled.podfiles` | Reading the pod files that fill in a half-built answer. |
| `core-pod.step.readback` | Reading back what a step just wrote, to check it. Sits inside `scenario.import`. |
| `core-pod.step.database` | Updating the saved database after a step. Sits inside `scenario.import`. |
| `core-pod.builtdigests` | Fingerprinting the built answer files, to tell which changed. |
| `core-pod.besidedigest` | Fingerprinting the files kept beside the pod. |
| `arrivals.records.podfiles` | Reading the pod files that hold the records an import compares with. Sits inside `scenario.import`. |
| `arrivals.shared.podfiles` | Reading the pod files of facts shared between records. Sits inside `scenario.import`. |
| `arrivals.current.podfiles` | Reading the pod files of the current versions of records. Sits inside `scenario.import`. |
| `kept.reached.recordsofjudged` | Finding the records a person has already judged. |
| `kept.readback` | Reading the saved answers back in when the pod opens. |
| `kept.readback.restore` | Restoring the saved answers into memory. Sits inside `kept.readback`. |
| `kept.readback.index` | Rebuilding the lookup list of the saved answers. Sits inside `kept.readback`. |
| `kept.reached.written` | Writing the answers of the reached records. |
| `matcher.view.podfiles` | Reading the pod files the matcher compares. |
| `matcher.recheck` | Checking again a match that may have changed. |
| `matcher.filenolongerreached` | Noting a file the matcher no longer needs to look at. |
| `pod.ask` | One question asked of the pod. |
| `pod.askpage` | One page of the answer to a question asked of the pod. |
| `pod.connect` | Connecting the pod to a source of records. |
| `pod.enter` | A person entering something into the pod by hand. |
| `pod-database.keyed.graphs` | Writing the saved database's facts, in the encrypted form. |
| `pod-database.keyed.screens` | Writing the saved database's answer tables, in the encrypted form. |
| `pod-database.keyed.ledger` | Writing the saved database's list of what it holds, in the encrypted form. |
| `bridge.query-*.rq` | The Bridge's query for {name}, which pulls those out of the converted source. Sits inside `arrivals.convert`. |
| `build.query-*.ttl` | Building the {name} answer file by asking the pod's facts its question. Sits inside `build.queried`. |
| `view.build-*.ttl` | Writing the {name} answer file from the question's rows. Sits inside `build.queried`. |
| `derive.step-queries-*.rq` | Working out {name} from the pod's facts, one derivation step. Sits inside `kept.step.rebuilt`. |
| `matcher.rule-*` | One 'same record' rule, {name}: checking whether two records fit it. Sits inside `matcher.of.over`. |
| `question.page-*` | One page of the answer to: {name}. Sits inside `scenario.first-screen`. |
| `question-*` | The answer to: {name}. Sits inside `scenario.first-screen`. |
| `core-pod.step.rebuild-*` | Re-deriving what the step's {name} changes. Sits inside `scenario.import`. |

## Counts of the probed run

Rows named `<scenario>-<dataset>/count/<count>`.

| Term | Meaning |
|---|---|
| `records` | How many records the person's source file holds. |
| `files-written` | How many files the import wrote to the pod. |
| `graph.scans` | How many times the in-memory facts were searched from end to end. |
| `graph.quadsvisited` | How many individual facts those searches looked at. |
| `store.queries` | How many questions were put to the pod's fact store. |
| `bridge.query.rows` | How many rows the Bridge's queries returned in all. |
| `bridge.workers` | How many helper processes the Bridge used. |
| `bridge.package.found` | Whether the Bridge's package was found, 1 if so. |
| `built.lines.total` | How many lines the answer files hold in all. |
| `built.lines.written` | How many answer-file lines were written. |
| `built.lines.sorted` | How many answer-file lines had to be sorted. |
| `view.quadsmoved` | How many facts were moved into answer files. |
| `podfiles.files` | How many pod files were read. |
| `podfiles.calls` | How many times pod files were read. |
| `adapter.files.read` | How many adapter files were read. |
| `components.resolved` | How many of the runtime's parts were found on disk. |
| `core-pod.compactions` | How many times the pod's files were tidied together. |
| `incremental.boundvalues.iris` | How many record names a narrowed question was given. |
| `incremental.boundvalues.batches` | How many batches those names were given in. |
| `incremental.boundvalues.calls` | How many narrowed questions were asked. |
| `matcher.valuesblocks` | How many groups of records the matcher compared at a time. |
| `matcher.valuesblockrecords` | How many records those groups held in all. |
| `matcher.valueslistssplit` | How many times a long list of records was split to fit. |
| `matcher.queriesrun` | How many questions the matcher asked. |
| `matcher.takenrecords` | How many records the matcher picked to compare. |
| `matcher.boundrecords` | How many records the matcher's questions were limited to. |
| `shapes.machine-basis-check` | How many times the pod checked that its machine-made facts have a basis. |
| `*.graph.quadsvisited` | How many individual facts the searches inside '{name}' looked at. |
| `*.graph.scans` | How many times the in-memory facts were searched end to end inside '{name}'. |
| `*.store.queries` | How many fact-store questions '{name}' put. |
| `*.rows` | How many rows '{name}' returned. |
| `core-pod.matcherselect.query-*` | How many times the matcher put this question to the pod's facts. |
