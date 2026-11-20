# What the performance numbers mean

Generated from the files of `packages/cascade-runtime/test/perf-glossary/`; edit them, then run
`node packages/cascade-runtime/dist/test/perf-glossary.js > docs/perf-glossary.md`. A test fails if this page is out of date or if the performance file names something the glossary lacks.

## Scenarios

| Term | Meaning |
|---|---|
| `fresh-first-screen` | A new, empty pod takes in a person's whole record and shows the first screen. |
| `reopen-first-answer` | A pod that already holds the record is opened again and answers its first question. |
| `question-page` | Fetching one page of 20 answers to each of the app's questions, from the saved database. |
| `close` | Closing a pod straight after it took in a record and drew the first screen. |
| `floor` | The same input as a fresh import, loaded plainly into one SQLite file, to read a fresh import against. It is not a lower bound. |
| `file-ops` | What one small file costs on the machine the run is on: asking whether it is there, creating it, creating and renaming it, and what the pod's folder does for a file; and writing the same bytes as one file. It is about the operating system and its disk, not about the runtime's code, so it is read from one system to another. |
| `stored` | What a pod holds once a fresh import and its close are done, counted exactly by the kinds of file the pod's layout names: files, statements and bytes, and the pod's database by table and index. |

## What a pod holds

The `stored` scenario counts the pod a fresh import and its close left, in rows named `stored-<dataset>[-encrypted]/files/<kind>`, `/statements/<kind>`, `/bytes/<kind>`, `/predicates/<vocabulary>`, `/database/<table or index>` and `/count/<count>`. The rule for what is the source's data, history, bookkeeping or derived: a kind of file counts as the source's data when it holds what the source said (a version's content, every statement of a version file but the one that links it to its record, and the source's own bytes); as history when it holds what the pod keeps about how it learnt that (the record each version belongs to, the link from each version to it, and a revision for each time an import saw a version); as derived when the pod can write it again from its other files (the views and labels); and as bookkeeping for everything else the pod keeps to run it. The kind of a file comes from where the pod's layout places it, and, inside a folder of records, from the statements it holds: a file that states a version's link to its record is a version, one that states a revision's link is a revision, any other is the record's own.

| Term | Meaning |
|---|---|
| `records` | Pod records: the name each thing is known by (history). A record's own file: the name the pod gives one thing the source described (a lab result, a medication, a condition), with its type and the source's own id for it. It holds no content; its versions and revisions point at it. |
| `versions` | Versions: what the source said (data). One file for each distinct thing the source said of a record: the content (codes, names, dates, values) and one statement naming the record it is a version of. A later pull that says something different adds a version; one that says the same adds none. |
| `revisions` | Revisions: each time it was seen (history). One file for each time an import saw a version: when, in which document and at which place in it, and which version. The pod's own history, not something the source said. |
| `servers` | Servers: where a pull came from (bookkeeping). The records, versions and revisions of the servers a pull came from (a hospital's address and name), kept as any other record is. |
| `findings` | Findings for review (bookkeeping). What the pod noticed and left for its owner to look at. |
| `judgments` | Judgments and their retractions (bookkeeping). What the owner decided, such as which records say the same thing, and the retractions of those decisions. |
| `matcher-output` | Matcher output (bookkeeping). The assertions the matcher made while it looked for records that say the same thing. |
| `references` | Reference series (bookkeeping). The versions of the reference tables (code lists and series) the pod kept for its answers. |
| `acts` | Acts: each import and activity (bookkeeping). What was done to the pod: each import (what it used and when), each other activity, each sync from another writer. |
| `documents` | Descriptions of the source documents (bookkeeping). One file of statements for each source document an import was given: its name by content and its kind. The document's bytes are the stored documents. |
| `stored-documents` | Stored documents: the source's own bytes (data). The source document's own bytes, kept as they came: no statements, the file is the document. |
| `views` | Views and labels: rebuilt copies (derived). The files the pod writes again after every import from its other files: a list of each kind of record and the names shown for things. Everything in them is rebuildable from the pod's other files: some of it is statements the versions, records and revisions hold, the rest is derived from them (labels, padded dates, workflow status). |
| `creation-settings` | Creation and settings (bookkeeping). What makes the pod a pod: the person it is about, its manifest, its profile card, its preferences and its type index. |
| `other` | Other files (bookkeeping). Any file the layout places nowhere, such as an encrypted pod's header. |

| Term | Meaning |
|---|---|
| `data` | What the person's source said: the content of every version (its codes, names, dates and values), and the source's own bytes. The one statement of each version file that says which record it is a version of is not counted here: it is history. |
| `history` | What the pod keeps about how it learnt it: the record each version belongs to, the link from each version to it, and a revision for each time an import saw a version. |
| `bookkeeping` | What the pod keeps to run: acts, descriptions of documents, judgments, the matcher's output, findings, reference series, servers, the pod's creation and settings, and anything else. |
| `derived` | Copies the pod writes again from its other files after every import, which hold nothing new and can be rebuilt: the views and the labels. |

## Datasets

| Term | Meaning |
|---|---|
| `synthea-10y` | Synthea's realistic synthetic patient, a 10-year record of 647 source entries. No real person's data. |
| `synthea-lifetime` | A synthetic patient's whole life, 16,833 source entries: the large size, run nightly. |
| `3000-files` | 3,000 small files of 280 bytes each, made in a temporary folder on the machine's own disk, the machine as it is. |
| `3000-files-scanner-off` | The same 3,000 small files, made while the system's virus scanner (Windows Defender) has its live checking of files switched off, to see what that checking costs. |
| `3000-files-scanner-on` | The same 3,000 small files, made while the system's virus scanner (Windows Defender) has its live, file-opening and script checking switched on and the folders the runner leaves out of it taken off its list for the run, to see what the checking costs; the runner is put back as it was afterwards. |
| `3000-files-scanner-excluded` | The same 3,000 small files, made while the scanner's live checking is on but the folder the files are made in is excluded from it, to see what an exclusion saves. |
| `3000-files-scanner-in-excluded-folder` | The same 3,000 small files, made on a machine whose virus scanner (Windows Defender) is NOT changed in any way, in a folder inside one the scanner leaves alone. Read it beside the next one: it is a natural experiment on one machine, the same code and disk, with only the folder differing. |
| `3000-files-scanner-in-scanned-folder` | The same 3,000 small files, made on the same machine, with its scanner not changed, in a folder outside every folder the scanner leaves alone (the system's temporary folder unless one was named). Read it beside the one made in an excluded folder: where the two differ by more than their ranges, the scanner's checking is the likely difference, and this page does not say it is the only one. |

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
| `floor/total` | The same input a fresh import takes in, loaded plainly into SQLite: read and decompress the Bundle, parse it, flatten each resource to one row of a table named for its resource type (a plain value is a column, anything nested is kept as its JSON text) and insert every row into a SQLite file in one transaction, with the SQLite the runtime uses and none of its settings changed. Only the insert is SQL; reading, parsing and flattening are JavaScript. Nested values are kept as JSON text with no further tables, and SQLite's default journal and synchronous settings are kept. It does no mapping to the Cascade vocabulary, keeps no provenance, does no matching of records that are the same, builds no derived views and writes no files, and a faster load of the same input could exist, so it is not a lower bound. The encrypted import is compared with this same unencrypted load. It says what loading costs, not what the import's other work adds up to; the pages do not split the difference beyond the stages the flame graphs measure. |
| `file-ops/total` | The file micro-bench has no total: it is a set of per-file times, one for each operation and each number of files in flight at once. |
| `total` | The headline: the whole scenario from start to finish, the median of the runs. |
| `open` | Opening the pod. |
| `import` | Importing the whole record into the pod. |
| `first-screen` | Asking the questions the first screen shows. |
| `first-read` | The first question asked of the reopened pod ('My active conditions'). |
| `second-read` | A second question asked of the reopened pod ('My active medications'). |
| `close` | Closing the pod, saving its database. |
| `parse` | Floor stage: reading the compressed Bundle, decompressing it and parsing the JSON. A fresh import parses the Bundle too: the harness reads, decompresses and parses it once before the import's clock starts, but the import is handed the Bundle's bytes and, from reading its code, parses them again inside its own time (not traced). So this stage and the import's own parsing are about the same work, with this stage also counting reading and decompressing, which the import's clock does not. |
| `flatten` | Floor stage: turning each parsed resource into one row of the table for its resource type, plain values as columns and anything nested as its JSON text. |
| `insert` | Floor stage: creating a table for each resource type and inserting every row in one transaction into a SQLite file on disk, then closing the file. |
| `one-file/whole` | The time to write the bytes of all 3,000 files as ONE file and rename it over its name: what a pod would pay if it kept its new files together in one file. In seconds for the whole, not per file. |
| `one-file/whole-flushed` | The same one file, flushed to the drive before it is renamed, so the figure includes the time the system takes to make the bytes safe against a power cut. In seconds for the whole, not per file. |
| `rss` | Memory the process was holding when the scenario's work was done, in bytes: after the first screen and before closing for a new pod, after the second read for a reopened one, after a first read and before the pages for the question pages. |
| `peak-rss` | The most memory the process held at any moment, in bytes. |
| `probed-total` | The scenario's time in one run with the probe on, which slows some work; its stages are from this run and are for finding where time goes, never for adding up to the headline. |
| `phase-loading-the-adapter` | Import part: loading the adapter that knows this kind of record. |
| `phase-converting` | Import part: converting the source record into the pod's own format. |
| `phase-saving` | Import part: writing the converted records into the pod. |
| `phase-judging` | Import part: claiming, as the pod's owner, the profiles the person confirmed are theirs. |
| `files/all` | Every file the pod holds, counted by the pod's layout: the kinds' counts add up to it. |
| `files/on-disk` | Every file in the pod's folder as the disk has it. For a plain pod it equals the count above; for an encrypted pod it also counts the sealed index. |
| `files/beside` | The files kept beside the pod: its database, its kept build and its kept answers. |
| `statements/all` | Every statement in the pod's files, one for each line: a statement a view holds again is counted in each file that holds it, and the kinds' counts add up to it. A statement is one fact the pod keeps, a thing, one of its properties and the value. The lines are counted as N-Triples, one statement to a line, which is how this runtime writes them: a pod written by another writer in Turtle would be miscounted. |
| `bytes/all` | What the pod's files hold, in bytes, read back (an encrypted pod's once opened): the bytes of their content, not the space they take on a disk. The kinds' counts add up to it. |
| `bytes/on-disk` | What the files of the pod's folder add up to as the disk holds them: sealed files are larger than what they hold, and the sealed index is a file of its own. |
| `bytes/in-4k-blocks` | What the files of the pod's folder take when each is rounded up to whole 4 KiB blocks, as NTFS and most other file systems allocate: the cost of many small files, which the bytes they hold do not show. |
| `bytes/beside` | The bytes of the files kept beside the pod: its database, its kept build and its kept answers. |
| `database/file` | The size of the database the pod keeps beside it, in bytes. |
| `database/statements` | How many statements the database holds, in its table of statements: those of the pod's files, each loaded once (the count of lines of a file equals the database's count for the graph that file is), and the graphs derived from them, which no file holds. So it is more than the statements of the files. |
| `database/terms` | How many distinct terms the database holds, each kept once. |
| `database/tables` | Bytes the database's tables take, from SQLite's dbstat table; not given where the SQLite build has none. |
| `database/indexes` | Bytes the database's indexes take, from SQLite's dbstat table; not given where the SQLite build has none. |
| `absent-check/in-flight-*` | The time to ask whether a file is there, when it is not, for one file; `<name>` such questions in flight at once. The runtime asks this before it writes a file. |
| `create/in-flight-*` | The time to create one new small file and write its bytes; `<name>` files in flight at once. |
| `create-rename/in-flight-*` | The time to create one small file under a temporary name and rename it over its real name, as a pod's folder does so that no reader sees half a file; `<name>` files in flight at once. |
| `full-path/in-flight-*` | The time for what the pod's folder does for one file: look at the path, resolve the folder, create the file under a temporary name and rename it; `<name>` files in flight at once. |
| `phase-*` | Import part: `<name>`. |
| `question-*` | One page of 20 answers to: `<name>`. |
| `predicates/*` | How many statements in the pod's files have a property from the `<name>` vocabulary (cascade is Cascade's own, prov is PROV-O, pav is PAV, dct is Dublin Core terms, rdf is RDF itself, other is any other: mainly rdfs for labels, oa for where in a document a revision's source sits, solid and obo). |
| `database/table-*` | Bytes the database's table `<name>` takes, one of the largest. |
| `database/index-*` | Bytes the database's index `<name>` takes, one of the largest. |

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
| `core-pod.step.finished` | Working out what an act's file holds beside its description: the runtime that did the work and a snapshot of the pod's files. Sits inside `scenario.import`. |
| `core-pod.step.keptafter` | Bringing the saved answers up to date after a step. Sits inside `scenario.import`. |
| `core-pod.step.rebuild-import` | Re-deriving what the imported records change. Sits inside `scenario.import`. |
| `core-pod.step.rebuild-match` | Re-deriving what the 'same record' matching changes. Sits inside `scenario.import`. |
| `core-pod.step.rebuild-other` | Re-deriving everything else a step changes. Sits inside `scenario.import`. |
| `core-pod.import.adapters` | Reading the adapter that knows how to convert this kind of record. Sits inside `scenario.import`. |
| `core-pod.import.documents` | Taking in the documents (notes, reports) that came with the record. Sits inside `scenario.import`. |
| `core-pod.inputshash` | Working out a fingerprint of everything a result depends on, to know when it can be reused. |
| `core-pod.matcherselect` | A question the 'same record' matcher puts to the pod's facts, as the matcher reads them. |
| `core-pod.matcherview` | Preparing the pod's facts for the 'same record' matcher. |
| `core-pod.databaseanswers` | Checking whether the saved database holds the pod as it stands now, so it can answer in place of a rebuild. |
| `core-pod.rebuild.writeall` | Writing every rebuilt file out to the pod. |
| `core-pod.rebuild.bytes` | Turning rebuilt facts into the bytes that are written. |
| `core-pod.keepdatabase` | Saving the pod's database so the next opening is fast. Sits inside `scenario.close`. |
| `core-pod.keepdatabase.whole` | Saving the database whole, from the pod's current facts. Sits inside `core-pod.keepdatabase`. |
| `core-pod.keepbuild` | Preparing the content of the saved database. Sits inside `core-pod.keepdatabase`. |
| `core-pod.keepbuild.dump` | Gathering the pod's facts to put in the saved database. Sits inside `core-pod.keepbuild`. |
| `core-pod.keepbuild.write` | Writing the gathered facts into the saved database. Sits inside `core-pod.keepbuild`. |
| `core-pod.compact` | Tidying the pod's files into fewer, larger ones. |
| `arrivals.fileexport` | Taking in every document of the record: converting each, working out its records and writing them to the pod. Sits inside `core-pod.step.perform`. |
| `arrivals.convert` | Converting the source record into the pod's own format with the adapter. Sits inside `scenario.import`. |
| `arrivals.accepting` | Finding which adapter accepts this document. Sits inside `scenario.import`. |
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
| `pod.unclaimedprofiles` | Finding the people named in an import's records whom the person has not yet said are, or are not, themselves. |
| `pod.judge` | Claiming one confirmed profile as the pod's owner, by filing the judgment that says so. |
| `pod.profilestied` | Looking up which profiles the person has already said are, or are not, themselves. |
| `store.query` | Questions put to the pod's fact store, many of them: the time one or more of them was in progress. |
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
| `kept.reached.judged` | Finding what the judgment files a step wrote refer to. |
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
| `build.queried.viewsheld` | Working out which answer files the pod's records call for. Sits inside `build.queried`. |
| `build.queried.written` | Writing the answer files that changed. Sits inside `build.queried`. |
| `incremental.boundvalues` | Narrowing a question to only the records that changed. |
| `matcher.of` | Setting up the 'same record' matcher for one run: reading the records it compares and running its rules over them. |
| `matcher.of.read` | Reading the records to be compared. Sits inside `matcher.of`. |
| `matcher.of.podcodes` | Looking up the medical codes of the records being compared. Sits inside `matcher.of`. |
| `matcher.of.withcurrentversions` | Adding each record's current version to the comparison. Sits inside `matcher.of`. |
| `matcher.of.over` | Running the matching rules over the records. Sits inside `matcher.of`. |
| `matcher.of.withpartners` | Adding the records that matched, so their partners are compared too. Sits inside `matcher.of`. |
| `matcher.of.releaseview` | Letting go of the matcher's working copy of the facts. Sits inside `matcher.of`. |
| `matcher.recordreads` | Reading the records the matcher compares. |
| `matcher.actstaken` | Working out which acts (an import, an entry session, a connect or a sync) this run takes records from. |
| `matcher.take` | Judging which records this import, entry, connect or sync brought are the same as records the pod holds, and recording each match. |
| `matcher.filefindings` | Writing a finding for review for each pair of records one of the finding rules gives. |
| `matcher.view` | Building the matcher's working copy of the facts. |
| `pod-database.build.worker` | Starting the helper that builds the saved database. Sits inside `core-pod.keepdatabase`. |
| `pod-database.build.load` | Loading the pod's facts into the saved database. Sits inside `core-pod.keepdatabase`. |
| `pod-database.build.screens-fill` | Filling in the database's ready-made answer tables. Sits inside `core-pod.keepdatabase`. |
| `pod-database.build.screens-tables` | Creating the database's ready-made answer tables. Sits inside `core-pod.keepdatabase`. |
| `pod-database.build.screens-finish` | Finishing the database's ready-made answer tables. Sits inside `core-pod.keepdatabase`. |
| `pod-database.build.sync` | Making the saved database safely written to disk. Sits inside `core-pod.keepdatabase`. |
| `pod-database.build.close` | Closing the saved database. Sits inside `core-pod.keepdatabase`. |
| `pod-database.build.rename` | Moving the finished database into place. Sits inside `core-pod.keepdatabase`. |
| `bridge.stage-records` | The Bridge makes the pod's records, with their versions, from what its mappings produced. Sits inside `arrivals.convert`. |
| `bridge.stage-mapping` | The Bridge runs the adapter's mappings over the source record's facts to produce the pod's facts. Sits inside `arrivals.convert`. |
| `bridge.stage-index` | The Bridge builds a lookup index of the source facts for its compiled queries. Sits inside `arrivals.convert`. |
| `bridge.stage-lift` | The Bridge lifts the source record into facts. Sits inside `arrivals.convert`. |
| `bridge.stage-documenttable` | The Bridge builds the table of documents that the source record contains. Sits inside `arrivals.convert`. |
| `bridge.stage-serialising` | The Bridge writes its result out as text. Sits inside `arrivals.convert`. |
| `bridge.stage-summary` | The Bridge totals what it converted. Sits inside `arrivals.convert`. |
| `bridge.stage-dataset` | The Bridge sets up the facts its queries will read. Sits inside `arrivals.convert`. |
| `bridge.stage-detect` | The Bridge recognises what kind of record this is. Sits inside `arrivals.convert`. |
| `bridge.query-detect.rq` | The query that recognises what kind of record this is. Sits inside `bridge.stage-detect`. |
| `core-pod.selectstated.podfiles` | Reading the pod files a question about stated facts needs. |
| `core-pod.filled.podfiles` | Reading the pod files that fill in a half-built answer. |
| `core-pod.step.readback` | Reading the pod's saved answers back in before a step, so the step can carry on from them. Sits inside `scenario.import`. |
| `core-pod.step.database` | Updating the saved database after a step. Sits inside `scenario.import`. |
| `core-pod.builtdigests` | Checking that each saved answer file is still the one the saved state was made with. |
| `core-pod.besidedigest` | Fingerprinting the saved state kept beside the pod, to check it is intact when the pod opens. |
| `arrivals.records.podfiles` | Reading the pod files that hold the records an import compares with. Sits inside `scenario.import`. |
| `arrivals.shared.podfiles` | Reading the pod files of facts shared between records. Sits inside `scenario.import`. |
| `arrivals.current.podfiles` | Reading the pod files of the current versions of records. Sits inside `scenario.import`. |
| `kept.reached.recordsofjudged` | Finding the records those judgments are about. |
| `kept.readback` | Reading the saved answers back in when the pod opens. |
| `kept.readback.restore` | Restoring the saved answers into memory. Sits inside `kept.readback`. |
| `kept.readback.index` | Rebuilding the lookup list of the saved answers. Sits inside `kept.readback`. |
| `kept.reached.written` | Finding the records whose files the step wrote. |
| `matcher.view.podfiles` | Reading the pod files the matcher compares. |
| `matcher.recheck` | Checking again each earlier 'same record' judgment made with a table or rule that has since changed. |
| `matcher.filenolongerreached` | Writing a finding for review that names the earlier 'same record' judgments the newer rule list no longer reaches. |
| `pod-database.keyed.graphs` | Updating the saved database's facts, one group of facts at a time. |
| `pod-database.keyed.screens` | Updating the saved database's ready-made answer tables. |
| `pod-database.keyed.ledger` | Recording what the saved database now holds. |
| `files.absent.check` | Checking that none of the files a step is about to write is in the pod already: a file whose name fixes its bytes that the pod's listing lacks is new, and any other file, and one the listing has, is read and compared. |
| `files.absent.recheck` | Looking again, before each batch of files is written (a step's files, and those it rebuilds), for any file that is not known to be new. |
| `bridge.query-*.rq` | The Bridge's query for `<name>`, which pulls those out of the converted source. Sits inside `arrivals.convert`. |
| `build.query-*.ttl` | Building the `<name>` answer file by asking the pod's facts its question. Sits inside `build.queried`. |
| `view.build-*.ttl` | Writing the `<name>` answer file from the question's rows. Sits inside `build.queried`. |
| `derive.step-queries-*.rq` | Working out `<name>` from the pod's facts, one derivation step. Sits inside `kept.step.rebuilt`. |
| `matcher.rule-*` | One 'same record' rule, `<name>`: checking whether two records fit it. Sits inside `matcher.of.over`. |
| `question.page-*` | One page of the answer to: `<name>`. |
| `question-*` | The answer to: `<name>`. Where it sits depends on the scenario: in `fresh-first-screen` inside `scenario.first-screen`; in `reopen-first-answer` inside `scenario.first-read` or `scenario.second-read`. |
| `core-pod.step.rebuild-*` | Re-deriving the pod's answers after a step of this kind: `<name>`. Sits inside `scenario.import`. |

## Own time of the probed run

Rows named `<scenario>-<dataset>/self/<stage>`, for the same stages: Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first.

## Flame graphs of every build

Each build also keeps a trace of its probed run ("Where the time went": every call with its start, end and the call it ran inside, drawn as a flame graph) and a CPU profile of an unprobed run ("Which code took it": every function the processor was sampled in), both opened in speedscope. The builds are listed at https://jayostis.github.io/cascade-runtime-js/perf/runs/, newest first, with the files each still has: traces for the newest 30 builds, CPU profiles for the newest 5, and the large size's files for the newest 7 builds that ran it. A trace draws each call under the call that ran it, side by side where calls ran at the same time; where more than 32 calls of one step ran at once, they are drawn as one merged bar for each stretch of time some of them were running, labelled with how many (for example "files.encrypt × 40 at once"), so no time is left out of the picture. The Bridge says how long each of its queries took in all and not when it ran, so a trace does not draw them: the index lists, for each build, the time per Bridge query, positions unknown, and a Bridge stage's own time includes the queries it ran.

## Counts of the probed run

Rows named `<scenario>-<dataset>/count/<count>`.

| Term | Meaning |
|---|---|
| `records` | How many entries the person's source file holds (its Bundle's entries). It is not the number of records the pod keeps: that is the stored scenario's pod-records. |
| `files-written` | How many files the import wrote to the pod. It is a few fewer than the files the pod holds (13 fewer at 647 source entries, 15 at the large size); not chased, the pod's creation and settings files may be the reason (unverified). |
| `rows` | How many rows the floor inserted, one for each resource that has a type: a fresh import's count of source entries is every entry of the Bundle. |
| `files` | How many small files each of the per-file times is the mean over, and the number of files whose bytes make the one file. |
| `scanner-realtime-on` | Whether the system's virus scanner had its live checking of files on while the files were made: 1 for yes, 0 for no. Read back from Windows Defender itself, not assumed; the row's note lists every setting it was read with, the folders it leaves alone among them. |
| `scanner-switch-off-allowed` | Whether the runner let the run switch the virus scanner's live checking off and the scanner confirmed it: 1 for yes, 0 for no; the row's note says why not. |
| `scanner-switch-on-allowed` | Whether the runner let the run switch the virus scanner's live, file-opening and script checking on and take the runner's excluded folders off its list, and the scanner confirmed it: 1 for yes, 0 for no; the row's note says why not. |
| `scanner-exclusion-allowed` | Whether the runner let the run exclude the folder from the virus scanner and the scanner listed it: 1 for yes, 0 for no; the row's note says why not. |
| `scanner-restored` | Whether the virus scanner was read back as it was before the run changed it, every setting and every excluded folder: 1 for yes, 0 for no; the row's note says what it read. |
| `work-folder` | Where the files were made: the folder's own path and the drive it is on, in the row's note. 1 when recorded. |
| `scanner-folder-excluded` | Whether the folder the files were made in was on the scanner's list of excluded folders, or inside one, while they were made: 1 for yes, 0 for no. In the comparison that changes nothing it is checked by the folder's real path against the list read from Windows Defender, and the row's note names the folder and the list entry it is inside. |
| `graph.scans` | How many times the in-memory facts were searched from end to end. |
| `graph.quadsvisited` | How many individual facts those searches looked at. |
| `store.queries` | How many questions were put to the pod's fact store. |
| `bridge.query.rows` | How many rows the Bridge's queries returned in all. |
| `bridge.workers` | How many helper processes the Bridge used. |
| `bridge.package.found` | Whether the Bridge's package was found, 1 if so. |
| `built.lines.total` | How many lines the import built for the pod's files, counted each time a file is built. It is more than the statements the pod's files hold (the stored scenario's statements/all) because some files are built more than once: measured at 647 source entries, it is 21,631 lines against 19,636 statements, of which 1,775 are each record's file being built twice (once to write it and once as the copy held for its revision) and 220 are files a later build replaced. That the large size has the same cause is likely and not measured. |
| `built.lines.written` | How many answer-file lines were written. |
| `built.lines.sorted` | How many answer-file lines had to be sorted. |
| `view.quadsmoved` | How many facts were set aside and put back while answer files were rebuilt. |
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
| `shapes.machine-basis-check` | How many times a judgment's stated basis was checked against its shape (a repeat check over the same statements is not counted). |
| `files.absent.check` | How many files were checked, before a step wrote them, for being in the pod already. |
| `files.absent.check.read` | How many of those checks had to read the file from the pod, the rest being files whose name fixes their bytes, answered by the pod's listing. |
| `files.absent.recheck` | How many files were looked at again before a batch was written. |
| `files.absent.recheck.read` | How many of those looks had to read the file from the pod. |
| `entries` | How many entries the source's Bundle holds, the same as the fresh import's count of records: the source's own count, which is not the number of records the pod keeps (see pod-records). |
| `version-links` | How many of the statements in version files link a version to its record, one for each version: the pod's own statement, which counts as history, not as what the source said. |
| `pod-records` | How many records the pod holds: a file for each thing the source described, the servers' included, each with versions and revisions beside it. Not the source's entries. |
| `*.graph.quadsvisited` | How many individual facts the searches inside '`<name>`' looked at. |
| `*.graph.scans` | How many times the in-memory facts were searched end to end inside '`<name>`'. |
| `*.store.queries` | How many fact-store questions '`<name>`' put. |
| `*.rows` | How many rows '`<name>`' returned. |
| `core-pod.matcherselect.query-*` | How many times the matcher put this question to the pod's facts. |
