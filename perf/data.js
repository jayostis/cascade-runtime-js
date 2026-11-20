window.BENCHMARK_DATA = {
  "lastUpdate": 1795168692686,
  "repoUrl": "https://github.com/jayostis/cascade-runtime-js",
  "entries": {
    "Runtime performance": [
      {
        "commit": {
          "author": {
            "email": "jayostis@gmail.com",
            "name": "jayostis",
            "username": "jayostis"
          },
          "committer": {
            "email": "noreply@github.com",
            "name": "GitHub",
            "username": "web-flow"
          },
          "distinct": true,
          "id": "1d2b5ce2806a3df935626ec28c5ee686ad6868b6",
          "message": "Merge pull request #923 from jayostis/fix/perf-history-checkout\n\nfix(ci): leave the data branch detached so the history action can fetch it",
          "timestamp": "2026-11-19T18:03:13-08:00",
          "tree_id": "e85c78ecde698941ca43d2ae9137356c36150dd8",
          "url": "https://github.com/jayostis/cascade-runtime-js/commit/1d2b5ce2806a3df935626ec28c5ee686ad6868b6"
        },
        "date": 1795140332277,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "fresh-first-screen-synthea-10y/total",
            "value": 5.251975,
            "range": "5.242680-5.295694",
            "unit": "s",
            "extra": "Opening a new pod, importing the whole record and asking the first screen's questions: what a person waits for the first time. | open + import + first screen; unprobed, median of 3 runs, each in a process of its own; dataset=synthea-10y sha256=2703dc1e7e920fa1e45d16c58f8338ef13b3cc1916ee40ffa461112d54dce5de records=647"
          },
          {
            "name": "fresh-first-screen-synthea-10y/open",
            "value": 0.310308,
            "range": "0.308580-0.323326",
            "unit": "s",
            "extra": "Opening the pod. | unprobed, median of 3 runs, each in a process of its own; dataset=synthea-10y sha256=2703dc1e7e920fa1e45d16c58f8338ef13b3cc1916ee40ffa461112d54dce5de records=647"
          },
          {
            "name": "fresh-first-screen-synthea-10y/import",
            "value": 4.823584,
            "range": "4.814720-4.853261",
            "unit": "s",
            "extra": "Importing the whole record into the pod. | unprobed, median of 3 runs, each in a process of its own; dataset=synthea-10y sha256=2703dc1e7e920fa1e45d16c58f8338ef13b3cc1916ee40ffa461112d54dce5de records=647"
          },
          {
            "name": "fresh-first-screen-synthea-10y/first-screen",
            "value": 0.119107,
            "range": "0.118083-0.119379",
            "unit": "s",
            "extra": "Asking the questions the first screen shows. | unprobed, median of 3 runs, each in a process of its own; dataset=synthea-10y sha256=2703dc1e7e920fa1e45d16c58f8338ef13b3cc1916ee40ffa461112d54dce5de records=647"
          },
          {
            "name": "fresh-first-screen-synthea-10y/peak-rss",
            "value": 531529728,
            "range": "500707328-552857600",
            "unit": "By",
            "extra": "The most memory the process held at any moment, in bytes. | the most the process reached, as the operating system keeps it; unprobed, median of 3 runs, each in a process of its own; dataset=synthea-10y sha256=2703dc1e7e920fa1e45d16c58f8338ef13b3cc1916ee40ffa461112d54dce5de records=647"
          },
          {
            "name": "close-synthea-10y/total",
            "value": 0.616121,
            "range": "0.604128-0.617953",
            "unit": "s",
            "extra": "Closing a pod straight after its import and first screen, which saves its database. | closing a pod right after its import and first screen; unprobed, median of 3 runs, each in a process of its own; dataset=synthea-10y sha256=2703dc1e7e920fa1e45d16c58f8338ef13b3cc1916ee40ffa461112d54dce5de records=647"
          },
          {
            "name": "reopen-first-answer-synthea-10y/total",
            "value": 0.250881,
            "range": "0.246864-0.261853",
            "unit": "s",
            "extra": "Opening an existing pod and answering its first read: what a returning person waits for. | open + first read; unprobed, median of 3 runs, each in a process of its own; dataset=synthea-10y sha256=2703dc1e7e920fa1e45d16c58f8338ef13b3cc1916ee40ffa461112d54dce5de records=647"
          },
          {
            "name": "reopen-first-answer-synthea-10y/open",
            "value": 0.195072,
            "range": "0.192888-0.205436",
            "unit": "s",
            "extra": "Opening the pod. | unprobed, median of 3 runs, each in a process of its own; dataset=synthea-10y sha256=2703dc1e7e920fa1e45d16c58f8338ef13b3cc1916ee40ffa461112d54dce5de records=647"
          },
          {
            "name": "reopen-first-answer-synthea-10y/first-read",
            "value": 0.055809,
            "range": "0.053977-0.056417",
            "unit": "s",
            "extra": "The first question asked of the reopened pod ('My active conditions'). | pod/My active conditions; unprobed, median of 3 runs, each in a process of its own; dataset=synthea-10y sha256=2703dc1e7e920fa1e45d16c58f8338ef13b3cc1916ee40ffa461112d54dce5de records=647"
          },
          {
            "name": "reopen-first-answer-synthea-10y/second-read",
            "value": 0.00093,
            "range": "0.000921-0.000941",
            "unit": "s",
            "extra": "A second question asked of the reopened pod ('My active medications'). | pod/My active medications; unprobed, median of 3 runs, each in a process of its own; dataset=synthea-10y sha256=2703dc1e7e920fa1e45d16c58f8338ef13b3cc1916ee40ffa461112d54dce5de records=647"
          },
          {
            "name": "reopen-first-answer-synthea-10y/close",
            "value": 0.000583,
            "range": "0.000581-0.000620",
            "unit": "s",
            "extra": "Closing the pod, saving its database. | unprobed, median of 3 runs, each in a process of its own; dataset=synthea-10y sha256=2703dc1e7e920fa1e45d16c58f8338ef13b3cc1916ee40ffa461112d54dce5de records=647"
          },
          {
            "name": "reopen-first-answer-synthea-10y/peak-rss",
            "value": 205230080,
            "range": "205205504-205254656",
            "unit": "By",
            "extra": "The most memory the process held at any moment, in bytes. | unprobed, median of 3 runs, each in a process of its own; dataset=synthea-10y sha256=2703dc1e7e920fa1e45d16c58f8338ef13b3cc1916ee40ffa461112d54dce5de records=647"
          },
          {
            "name": "question-page-synthea-10y/total",
            "value": 0.033072,
            "range": "0.033060-0.033422",
            "unit": "s",
            "extra": "Fetching one page of answers for every question in turn. | 16 questions, a page of 20 each, from pod.db; unprobed, median of 3 runs, each in a process of its own; dataset=synthea-10y sha256=2703dc1e7e920fa1e45d16c58f8338ef13b3cc1916ee40ffa461112d54dce5de records=647"
          },
          {
            "name": "question-page-synthea-10y/peak-rss",
            "value": 205287424,
            "range": "205275136-205299712",
            "unit": "By",
            "extra": "The most memory the process held at any moment, in bytes. | unprobed, median of 3 runs, each in a process of its own; dataset=synthea-10y sha256=2703dc1e7e920fa1e45d16c58f8338ef13b3cc1916ee40ffa461112d54dce5de records=647"
          },
          {
            "name": "fresh-first-screen-synthea-10y/stage/core-pod.step.perform",
            "value": 3.156626,
            "range": "3.156626-3.156626",
            "unit": "s",
            "extra": "Doing the work of one import step: taking in the new records. Sits inside scenario.import. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 3 calls whose own times sum to 3.156626 s (more than the time in progress where calls overlap); core-pod.step.perform"
          },
          {
            "name": "fresh-first-screen-synthea-10y/stage/arrivals.fileexport",
            "value": 2.52709,
            "range": "2.527090-2.527090",
            "unit": "s",
            "extra": "Taking in every document of the record: converting each, working out its records and writing them to the pod. Sits inside core-pod.step.perform. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 2.527090 s (more than the time in progress where calls overlap); arrivals.fileExport"
          },
          {
            "name": "fresh-first-screen-synthea-10y/stage/arrivals.convert",
            "value": 1.116313,
            "range": "1.116313-1.116313",
            "unit": "s",
            "extra": "Converting the source record into the pod's own format with the adapter. Sits inside scenario.import. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 1.116313 s (more than the time in progress where calls overlap); arrivals.convert"
          },
          {
            "name": "fresh-first-screen-synthea-10y/stage/core-pod.step.commit",
            "value": 1.036379,
            "range": "1.036379-1.036379",
            "unit": "s",
            "extra": "Writing the step's results to the pod's files and recording that it happened. Sits inside scenario.import. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 3 calls whose own times sum to 1.036379 s (more than the time in progress where calls overlap); core-pod.step.commit"
          },
          {
            "name": "fresh-first-screen-synthea-10y/stage/arrivals.accepting",
            "value": 0.995221,
            "range": "0.995221-0.995221",
            "unit": "s",
            "extra": "Finding which adapter accepts this document. Sits inside scenario.import. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 0.995221 s (more than the time in progress where calls overlap); arrivals.accepting"
          },
          {
            "name": "fresh-first-screen-synthea-10y/stage/pod.match",
            "value": 0.807539,
            "range": "0.807539-0.807539",
            "unit": "s",
            "extra": "Judging which records in the pod are the same thing recorded twice. Sits inside scenario.import. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 0.807539 s (more than the time in progress where calls overlap); pod.match"
          },
          {
            "name": "close-synthea-10y/stage/core-pod.keepdatabase",
            "value": 0.497907,
            "range": "0.497907-0.497907",
            "unit": "s",
            "extra": "Saving the pod's database so the next opening is fast. Sits inside scenario.close. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 0.497907 s (more than the time in progress where calls overlap); core-pod.keepDatabase"
          },
          {
            "name": "close-synthea-10y/stage/core-pod.keepdatabase.whole",
            "value": 0.483297,
            "range": "0.483297-0.483297",
            "unit": "s",
            "extra": "Saving the database whole, from the pod's current facts. Sits inside core-pod.keepdatabase. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 0.483297 s (more than the time in progress where calls overlap); core-pod.keepDatabase.whole"
          },
          {
            "name": "close-synthea-10y/stage/pod-database.build.worker",
            "value": 0.47584,
            "range": "0.475840-0.475840",
            "unit": "s",
            "extra": "Starting the helper that builds the saved database. Sits inside core-pod.keepdatabase. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 0.475840 s (more than the time in progress where calls overlap); pod-database.build.worker"
          },
          {
            "name": "close-synthea-10y/stage/pod-database.build.load",
            "value": 0.212863,
            "range": "0.212863-0.212863",
            "unit": "s",
            "extra": "Loading the pod's facts into the saved database. Sits inside core-pod.keepdatabase. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 0.212863 s (more than the time in progress where calls overlap); pod-database.build.load"
          },
          {
            "name": "close-synthea-10y/stage/core-pod.keepbuild",
            "value": 0.101434,
            "range": "0.101434-0.101434",
            "unit": "s",
            "extra": "Preparing the content of the saved database. Sits inside core-pod.keepdatabase. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 0.101434 s (more than the time in progress where calls overlap); core-pod.keepBuild"
          },
          {
            "name": "close-synthea-10y/stage/core-pod.keepbuild.dump",
            "value": 0.072785,
            "range": "0.072785-0.072785",
            "unit": "s",
            "extra": "Gathering the pod's facts to put in the saved database. Sits inside core-pod.keepbuild. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 0.072785 s (more than the time in progress where calls overlap); core-pod.keepBuild.dump"
          },
          {
            "name": "reopen-first-answer-synthea-10y/stage/files.read.file",
            "value": 0.113892,
            "range": "0.113892-0.113892",
            "unit": "s",
            "extra": "Reading one file from the pod's folder. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 160 calls whose own times sum to 0.634419 s (more than the time in progress where calls overlap); files.read.file"
          },
          {
            "name": "reopen-first-answer-synthea-10y/stage/question-pod-my-active-conditions",
            "value": 0.055018,
            "range": "0.055018-0.055018",
            "unit": "s",
            "extra": "The answer to: pod my active conditions. Sits inside scenario.first-screen. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 0.055018 s (more than the time in progress where calls overlap); question:pod/My active conditions"
          },
          {
            "name": "reopen-first-answer-synthea-10y/stage/core-pod.databaseanswers",
            "value": 0.041152,
            "range": "0.041152-0.041152",
            "unit": "s",
            "extra": "Checking whether the saved database holds the pod as it stands now, so it can answer in place of a rebuild. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 0.041152 s (more than the time in progress where calls overlap); core-pod.databaseAnswers"
          },
          {
            "name": "reopen-first-answer-synthea-10y/stage/core-pod.inputshash",
            "value": 0.029527,
            "range": "0.029527-0.029527",
            "unit": "s",
            "extra": "Working out a fingerprint of everything a result depends on, to know when it can be reused. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 0.029527 s (more than the time in progress where calls overlap); core-pod.inputsHash"
          },
          {
            "name": "reopen-first-answer-synthea-10y/stage/union.select",
            "value": 0.02664,
            "range": "0.026640-0.026640",
            "unit": "s",
            "extra": "Asking the in-memory facts a question that returns rows. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 0.026640 s (more than the time in progress where calls overlap); union.select"
          },
          {
            "name": "reopen-first-answer-synthea-10y/stage/store.query",
            "value": 0.025584,
            "range": "0.025584-0.025584",
            "unit": "s",
            "extra": "Questions put to the pod's fact store, many of them: the time one or more of them was in progress. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 0.025584 s (more than the time in progress where calls overlap); store.query"
          },
          {
            "name": "question-page-synthea-10y/stage/question.page-pod-what-each-import-brought-in",
            "value": 0.012541,
            "range": "0.012541-0.012541",
            "unit": "s",
            "extra": "One page of the answer to: pod what each import brought in. Sits inside scenario.first-screen. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 0.012541 s (more than the time in progress where calls overlap); question.page:pod/What each import brought in"
          },
          {
            "name": "question-page-synthea-10y/stage/question.page-pod-what-everything-is-called",
            "value": 0.007951,
            "range": "0.007951-0.007951",
            "unit": "s",
            "extra": "One page of the answer to: pod what everything is called. Sits inside scenario.first-screen. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 0.007951 s (more than the time in progress where calls overlap); question.page:pod/What everything is called"
          },
          {
            "name": "question-page-synthea-10y/stage/question.page-profile-what-needs-review",
            "value": 0.004195,
            "range": "0.004195-0.004195",
            "unit": "s",
            "extra": "One page of the answer to: profile what needs review. Sits inside scenario.first-screen. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 0.004195 s (more than the time in progress where calls overlap); question.page:profile/What needs review"
          },
          {
            "name": "question-page-synthea-10y/stage/question.page-pod-how-many-of-each-kind",
            "value": 0.001532,
            "range": "0.001532-0.001532",
            "unit": "s",
            "extra": "One page of the answer to: pod how many of each kind. Sits inside scenario.first-screen. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 0.001532 s (more than the time in progress where calls overlap); question.page:pod/How many of each kind"
          },
          {
            "name": "question-page-synthea-10y/stage/question.page-pod-the-person-this-pod-is-about",
            "value": 0.001088,
            "range": "0.001088-0.001088",
            "unit": "s",
            "extra": "One page of the answer to: pod the person this pod is about. Sits inside scenario.first-screen. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 0.001088 s (more than the time in progress where calls overlap); question.page:pod/The person this pod is about"
          },
          {
            "name": "question-page-synthea-10y/stage/question.page-pod-my-reports-notes-and-documents",
            "value": 0.000966,
            "range": "0.000966-0.000966",
            "unit": "s",
            "extra": "One page of the answer to: pod my reports notes and documents. Sits inside scenario.first-screen. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 0.000966 s (more than the time in progress where calls overlap); question.page:pod/My reports, notes and documents"
          }
        ]
      },
      {
        "commit": {
          "author": {
            "email": "jayostis@gmail.com",
            "name": "jayostis",
            "username": "jayostis"
          },
          "committer": {
            "email": "noreply@github.com",
            "name": "GitHub",
            "username": "web-flow"
          },
          "distinct": true,
          "id": "37f915677cd6eb42a607132a6a3216626a23cf59",
          "message": "Merge pull request #924 from jayostis/feat/perf-flame-graphs\n\nfeat(perf): per-build flame graphs, where the time went and which code took it",
          "timestamp": "2026-11-19T20:56:18-08:00",
          "tree_id": "37cf1ffda37d423adffe14bd7e805fcf21ab19f6",
          "url": "https://github.com/jayostis/cascade-runtime-js/commit/37f915677cd6eb42a607132a6a3216626a23cf59"
        },
        "date": 1795150703602,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "fresh-first-screen-synthea-10y/total",
            "value": 3.999969,
            "range": "3.998206-4.022227",
            "unit": "s",
            "extra": "Opening a new pod, importing the whole record and asking the first screen's questions: what a person waits for the first time. | open + import + first screen; unprobed, median of 3 runs, each in a process of its own; dataset=synthea-10y sha256=2703dc1e7e920fa1e45d16c58f8338ef13b3cc1916ee40ffa461112d54dce5de records=647"
          },
          {
            "name": "fresh-first-screen-synthea-10y/open",
            "value": 0.241582,
            "range": "0.235555-0.242273",
            "unit": "s",
            "extra": "Opening the pod. | unprobed, median of 3 runs, each in a process of its own; dataset=synthea-10y sha256=2703dc1e7e920fa1e45d16c58f8338ef13b3cc1916ee40ffa461112d54dce5de records=647"
          },
          {
            "name": "fresh-first-screen-synthea-10y/import",
            "value": 3.658721,
            "range": "3.657086-3.686608",
            "unit": "s",
            "extra": "Importing the whole record into the pod. | unprobed, median of 3 runs, each in a process of its own; dataset=synthea-10y sha256=2703dc1e7e920fa1e45d16c58f8338ef13b3cc1916ee40ffa461112d54dce5de records=647"
          },
          {
            "name": "fresh-first-screen-synthea-10y/first-screen",
            "value": 0.100065,
            "range": "0.097213-0.101301",
            "unit": "s",
            "extra": "Asking the questions the first screen shows. | unprobed, median of 3 runs, each in a process of its own; dataset=synthea-10y sha256=2703dc1e7e920fa1e45d16c58f8338ef13b3cc1916ee40ffa461112d54dce5de records=647"
          },
          {
            "name": "fresh-first-screen-synthea-10y/peak-rss",
            "value": 506408960,
            "range": "506212352-515833856",
            "unit": "By",
            "extra": "The most memory the process held at any moment, in bytes. | the most the process reached, as the operating system keeps it; unprobed, median of 3 runs, each in a process of its own; dataset=synthea-10y sha256=2703dc1e7e920fa1e45d16c58f8338ef13b3cc1916ee40ffa461112d54dce5de records=647"
          },
          {
            "name": "close-synthea-10y/total",
            "value": 0.500683,
            "range": "0.496998-0.586152",
            "unit": "s",
            "extra": "Closing a pod straight after its import and first screen, which saves its database. | closing a pod right after its import and first screen; unprobed, median of 3 runs, each in a process of its own; dataset=synthea-10y sha256=2703dc1e7e920fa1e45d16c58f8338ef13b3cc1916ee40ffa461112d54dce5de records=647"
          },
          {
            "name": "reopen-first-answer-synthea-10y/total",
            "value": 0.196682,
            "range": "0.195028-0.199366",
            "unit": "s",
            "extra": "Opening an existing pod and answering its first read: what a returning person waits for. | open + first read; unprobed, median of 3 runs, each in a process of its own; dataset=synthea-10y sha256=2703dc1e7e920fa1e45d16c58f8338ef13b3cc1916ee40ffa461112d54dce5de records=647"
          },
          {
            "name": "reopen-first-answer-synthea-10y/open",
            "value": 0.154257,
            "range": "0.153998-0.157091",
            "unit": "s",
            "extra": "Opening the pod. | unprobed, median of 3 runs, each in a process of its own; dataset=synthea-10y sha256=2703dc1e7e920fa1e45d16c58f8338ef13b3cc1916ee40ffa461112d54dce5de records=647"
          },
          {
            "name": "reopen-first-answer-synthea-10y/first-read",
            "value": 0.042274,
            "range": "0.041030-0.042425",
            "unit": "s",
            "extra": "The first question asked of the reopened pod ('My active conditions'). | pod/My active conditions; unprobed, median of 3 runs, each in a process of its own; dataset=synthea-10y sha256=2703dc1e7e920fa1e45d16c58f8338ef13b3cc1916ee40ffa461112d54dce5de records=647"
          },
          {
            "name": "reopen-first-answer-synthea-10y/second-read",
            "value": 0.000763,
            "range": "0.000754-0.000806",
            "unit": "s",
            "extra": "A second question asked of the reopened pod ('My active medications'). | pod/My active medications; unprobed, median of 3 runs, each in a process of its own; dataset=synthea-10y sha256=2703dc1e7e920fa1e45d16c58f8338ef13b3cc1916ee40ffa461112d54dce5de records=647"
          },
          {
            "name": "reopen-first-answer-synthea-10y/close",
            "value": 0.000513,
            "range": "0.000501-0.000527",
            "unit": "s",
            "extra": "Closing the pod, saving its database. | unprobed, median of 3 runs, each in a process of its own; dataset=synthea-10y sha256=2703dc1e7e920fa1e45d16c58f8338ef13b3cc1916ee40ffa461112d54dce5de records=647"
          },
          {
            "name": "reopen-first-answer-synthea-10y/peak-rss",
            "value": 205258752,
            "range": "205242368-205279232",
            "unit": "By",
            "extra": "The most memory the process held at any moment, in bytes. | unprobed, median of 3 runs, each in a process of its own; dataset=synthea-10y sha256=2703dc1e7e920fa1e45d16c58f8338ef13b3cc1916ee40ffa461112d54dce5de records=647"
          },
          {
            "name": "question-page-synthea-10y/total",
            "value": 0.027688,
            "range": "0.027155-0.029460",
            "unit": "s",
            "extra": "Fetching one page of answers for every question in turn. | 16 questions, a page of 20 each, from pod.db; unprobed, median of 3 runs, each in a process of its own; dataset=synthea-10y sha256=2703dc1e7e920fa1e45d16c58f8338ef13b3cc1916ee40ffa461112d54dce5de records=647"
          },
          {
            "name": "question-page-synthea-10y/peak-rss",
            "value": 205340672,
            "range": "205332480-205344768",
            "unit": "By",
            "extra": "The most memory the process held at any moment, in bytes. | unprobed, median of 3 runs, each in a process of its own; dataset=synthea-10y sha256=2703dc1e7e920fa1e45d16c58f8338ef13b3cc1916ee40ffa461112d54dce5de records=647"
          },
          {
            "name": "fresh-first-screen-synthea-10y/stage/core-pod.step.perform",
            "value": 2.493607,
            "range": "2.493607-2.493607",
            "unit": "s",
            "extra": "Doing the work of one import step: taking in the new records. Sits inside scenario.import. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 3 calls whose own times sum to 2.493607 s (more than the time in progress where calls overlap); core-pod.step.perform"
          },
          {
            "name": "fresh-first-screen-synthea-10y/stage/arrivals.fileexport",
            "value": 1.997808,
            "range": "1.997808-1.997808",
            "unit": "s",
            "extra": "Taking in every document of the record: converting each, working out its records and writing them to the pod. Sits inside core-pod.step.perform. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 1.997808 s (more than the time in progress where calls overlap); arrivals.fileExport"
          },
          {
            "name": "fresh-first-screen-synthea-10y/stage/arrivals.convert",
            "value": 0.888393,
            "range": "0.888393-0.888393",
            "unit": "s",
            "extra": "Converting the source record into the pod's own format with the adapter. Sits inside scenario.import. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 0.888393 s (more than the time in progress where calls overlap); arrivals.convert"
          },
          {
            "name": "fresh-first-screen-synthea-10y/stage/arrivals.accepting",
            "value": 0.78805,
            "range": "0.788050-0.788050",
            "unit": "s",
            "extra": "Finding which adapter accepts this document. Sits inside scenario.import. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 0.788050 s (more than the time in progress where calls overlap); arrivals.accepting"
          },
          {
            "name": "fresh-first-screen-synthea-10y/stage/core-pod.step.commit",
            "value": 0.693849,
            "range": "0.693849-0.693849",
            "unit": "s",
            "extra": "Writing the step's results to the pod's files and recording that it happened. Sits inside scenario.import. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 3 calls whose own times sum to 0.693849 s (more than the time in progress where calls overlap); core-pod.step.commit"
          },
          {
            "name": "fresh-first-screen-synthea-10y/stage/pod.match",
            "value": 0.651478,
            "range": "0.651478-0.651478",
            "unit": "s",
            "extra": "Judging which records in the pod are the same thing recorded twice. Sits inside scenario.import. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 0.651478 s (more than the time in progress where calls overlap); pod.match"
          },
          {
            "name": "close-synthea-10y/stage/core-pod.keepdatabase",
            "value": 0.411414,
            "range": "0.411414-0.411414",
            "unit": "s",
            "extra": "Saving the pod's database so the next opening is fast. Sits inside scenario.close. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 0.411414 s (more than the time in progress where calls overlap); core-pod.keepDatabase"
          },
          {
            "name": "close-synthea-10y/stage/core-pod.keepdatabase.whole",
            "value": 0.384027,
            "range": "0.384027-0.384027",
            "unit": "s",
            "extra": "Saving the database whole, from the pod's current facts. Sits inside core-pod.keepdatabase. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 0.384027 s (more than the time in progress where calls overlap); core-pod.keepDatabase.whole"
          },
          {
            "name": "close-synthea-10y/stage/pod-database.build.worker",
            "value": 0.358228,
            "range": "0.358228-0.358228",
            "unit": "s",
            "extra": "Starting the helper that builds the saved database. Sits inside core-pod.keepdatabase. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 0.358228 s (more than the time in progress where calls overlap); pod-database.build.worker"
          },
          {
            "name": "close-synthea-10y/stage/pod-database.build.load",
            "value": 0.15587,
            "range": "0.155870-0.155870",
            "unit": "s",
            "extra": "Loading the pod's facts into the saved database. Sits inside core-pod.keepdatabase. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 0.155870 s (more than the time in progress where calls overlap); pod-database.build.load"
          },
          {
            "name": "close-synthea-10y/stage/core-pod.keepbuild",
            "value": 0.084651,
            "range": "0.084651-0.084651",
            "unit": "s",
            "extra": "Preparing the content of the saved database. Sits inside core-pod.keepdatabase. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 0.084651 s (more than the time in progress where calls overlap); core-pod.keepBuild"
          },
          {
            "name": "close-synthea-10y/stage/core-pod.keepbuild.dump",
            "value": 0.063863,
            "range": "0.063863-0.063863",
            "unit": "s",
            "extra": "Gathering the pod's facts to put in the saved database. Sits inside core-pod.keepbuild. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 0.063863 s (more than the time in progress where calls overlap); core-pod.keepBuild.dump"
          },
          {
            "name": "reopen-first-answer-synthea-10y/stage/files.read.file",
            "value": 0.08254,
            "range": "0.082540-0.082540",
            "unit": "s",
            "extra": "Reading one file from the pod's folder. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 160 calls whose own times sum to 0.420149 s (more than the time in progress where calls overlap); files.read.file"
          },
          {
            "name": "reopen-first-answer-synthea-10y/stage/question-pod-my-active-conditions",
            "value": 0.040677,
            "range": "0.040677-0.040677",
            "unit": "s",
            "extra": "The answer to: pod my active conditions. Sits inside scenario.first-screen. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 0.040677 s (more than the time in progress where calls overlap); question:pod/My active conditions"
          },
          {
            "name": "reopen-first-answer-synthea-10y/stage/core-pod.databaseanswers",
            "value": 0.03059,
            "range": "0.030590-0.030590",
            "unit": "s",
            "extra": "Checking whether the saved database holds the pod as it stands now, so it can answer in place of a rebuild. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 0.030590 s (more than the time in progress where calls overlap); core-pod.databaseAnswers"
          },
          {
            "name": "reopen-first-answer-synthea-10y/stage/core-pod.inputshash",
            "value": 0.022139,
            "range": "0.022139-0.022139",
            "unit": "s",
            "extra": "Working out a fingerprint of everything a result depends on, to know when it can be reused. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 0.022139 s (more than the time in progress where calls overlap); core-pod.inputsHash"
          },
          {
            "name": "reopen-first-answer-synthea-10y/stage/union.select",
            "value": 0.017148,
            "range": "0.017148-0.017148",
            "unit": "s",
            "extra": "Asking the in-memory facts a question that returns rows. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 0.017148 s (more than the time in progress where calls overlap); union.select"
          },
          {
            "name": "reopen-first-answer-synthea-10y/stage/store.query",
            "value": 0.016377,
            "range": "0.016377-0.016377",
            "unit": "s",
            "extra": "Questions put to the pod's fact store, many of them: the time one or more of them was in progress. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 0.016377 s (more than the time in progress where calls overlap); store.query"
          },
          {
            "name": "question-page-synthea-10y/stage/question.page-pod-what-each-import-brought-in",
            "value": 0.010474,
            "range": "0.010474-0.010474",
            "unit": "s",
            "extra": "One page of the answer to: pod what each import brought in. Sits inside scenario.first-screen. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 0.010474 s (more than the time in progress where calls overlap); question.page:pod/What each import brought in"
          },
          {
            "name": "question-page-synthea-10y/stage/question.page-pod-what-everything-is-called",
            "value": 0.006693,
            "range": "0.006693-0.006693",
            "unit": "s",
            "extra": "One page of the answer to: pod what everything is called. Sits inside scenario.first-screen. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 0.006693 s (more than the time in progress where calls overlap); question.page:pod/What everything is called"
          },
          {
            "name": "question-page-synthea-10y/stage/question.page-profile-what-needs-review",
            "value": 0.00352,
            "range": "0.003520-0.003520",
            "unit": "s",
            "extra": "One page of the answer to: profile what needs review. Sits inside scenario.first-screen. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 0.003520 s (more than the time in progress where calls overlap); question.page:profile/What needs review"
          },
          {
            "name": "question-page-synthea-10y/stage/question.page-pod-how-many-of-each-kind",
            "value": 0.001332,
            "range": "0.001332-0.001332",
            "unit": "s",
            "extra": "One page of the answer to: pod how many of each kind. Sits inside scenario.first-screen. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 0.001332 s (more than the time in progress where calls overlap); question.page:pod/How many of each kind"
          },
          {
            "name": "question-page-synthea-10y/stage/question.page-pod-the-person-this-pod-is-about",
            "value": 0.000886,
            "range": "0.000886-0.000886",
            "unit": "s",
            "extra": "One page of the answer to: pod the person this pod is about. Sits inside scenario.first-screen. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 0.000886 s (more than the time in progress where calls overlap); question.page:pod/The person this pod is about"
          },
          {
            "name": "question-page-synthea-10y/stage/question.page-pod-my-reports-notes-and-documents",
            "value": 0.000825,
            "range": "0.000825-0.000825",
            "unit": "s",
            "extra": "One page of the answer to: pod my reports notes and documents. Sits inside scenario.first-screen. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 0.000825 s (more than the time in progress where calls overlap); question.page:pod/My reports, notes and documents"
          },
          {
            "name": "fresh-first-screen-synthea-10y/self/arrivals.accepting",
            "value": 0.782885,
            "range": "0.782885-0.782885",
            "unit": "s",
            "extra": "Finding which adapter accepts this document. Sits inside scenario.import. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 1 calls; arrivals.accepting"
          },
          {
            "name": "fresh-first-screen-synthea-10y/self/bridge.stage-records",
            "value": 0.45798,
            "range": "0.457980-0.457980",
            "unit": "s",
            "extra": "The Bridge makes the pod's records, with their versions, from what its mappings produced. Sits inside arrivals.convert. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 1 calls; bridge.stage:records"
          },
          {
            "name": "fresh-first-screen-synthea-10y/self/core-pod.import.adapters",
            "value": 0.453295,
            "range": "0.453295-0.453295",
            "unit": "s",
            "extra": "Reading the adapter that knows how to convert this kind of record. Sits inside scenario.import. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 1 calls; core-pod.import.adapters"
          },
          {
            "name": "fresh-first-screen-synthea-10y/self/core-pod.step.commit",
            "value": 0.415414,
            "range": "0.415414-0.415414",
            "unit": "s",
            "extra": "Writing the step's results to the pod's files and recording that it happened. Sits inside scenario.import. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 3 calls; core-pod.step.commit"
          },
          {
            "name": "fresh-first-screen-synthea-10y/self/store.query",
            "value": 0.399941,
            "range": "0.399941-0.399941",
            "unit": "s",
            "extra": "Questions put to the pod's fact store, many of them: the time one or more of them was in progress. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 154 calls; store.query"
          },
          {
            "name": "fresh-first-screen-synthea-10y/self/bridge.stage-mapping",
            "value": 0.193662,
            "range": "0.193662-0.193662",
            "unit": "s",
            "extra": "The Bridge runs the adapter's mappings over the source record's facts to produce the pod's facts. Sits inside arrivals.convert. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 1 calls; bridge.stage:mapping"
          },
          {
            "name": "close-synthea-10y/self/pod-database.build.load",
            "value": 0.15587,
            "range": "0.155870-0.155870",
            "unit": "s",
            "extra": "Loading the pod's facts into the saved database. Sits inside core-pod.keepdatabase. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 1 calls; pod-database.build.load"
          },
          {
            "name": "close-synthea-10y/self/pod-database.build.worker",
            "value": 0.147131,
            "range": "0.147131-0.147131",
            "unit": "s",
            "extra": "Starting the helper that builds the saved database. Sits inside core-pod.keepdatabase. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 1 calls; pod-database.build.worker"
          },
          {
            "name": "close-synthea-10y/self/core-pod.keepbuild.dump",
            "value": 0.063863,
            "range": "0.063863-0.063863",
            "unit": "s",
            "extra": "Gathering the pod's facts to put in the saved database. Sits inside core-pod.keepbuild. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 1 calls; core-pod.keepBuild.dump"
          },
          {
            "name": "close-synthea-10y/self/pod-database.build.screens-fill",
            "value": 0.030733,
            "range": "0.030733-0.030733",
            "unit": "s",
            "extra": "Filling in the database's ready-made answer tables. Sits inside core-pod.keepdatabase. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 1 calls; pod-database.build.screens:fill"
          },
          {
            "name": "close-synthea-10y/self/core-pod.keepdatabase",
            "value": 0.025623,
            "range": "0.025623-0.025623",
            "unit": "s",
            "extra": "Saving the pod's database so the next opening is fast. Sits inside scenario.close. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 1 calls; core-pod.keepDatabase"
          },
          {
            "name": "close-synthea-10y/self/pod-database.build.sync",
            "value": 0.021919,
            "range": "0.021919-0.021919",
            "unit": "s",
            "extra": "Making the saved database safely written to disk. Sits inside core-pod.keepdatabase. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 1 calls; pod-database.build.sync"
          },
          {
            "name": "reopen-first-answer-synthea-10y/self/files.read.file",
            "value": 0.08254,
            "range": "0.082540-0.082540",
            "unit": "s",
            "extra": "Reading one file from the pod's folder. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 160 calls; files.read.file"
          },
          {
            "name": "reopen-first-answer-synthea-10y/self/store.query",
            "value": 0.016377,
            "range": "0.016377-0.016377",
            "unit": "s",
            "extra": "Questions put to the pod's fact store, many of them: the time one or more of them was in progress. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 1 calls; store.query"
          },
          {
            "name": "reopen-first-answer-synthea-10y/self/union.loadturtle",
            "value": 0.012651,
            "range": "0.012651-0.012651",
            "unit": "s",
            "extra": "Loading text-format facts into memory. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 1 calls; union.loadTurtle"
          },
          {
            "name": "reopen-first-answer-synthea-10y/self/files.hash.sha256",
            "value": 0.011485,
            "range": "0.011485-0.011485",
            "unit": "s",
            "extra": "Fingerprinting a file's content to tell whether it changed. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 20 calls; files.hash.sha256"
          },
          {
            "name": "reopen-first-answer-synthea-10y/self/question-pod-my-active-conditions",
            "value": 0.004925,
            "range": "0.004925-0.004925",
            "unit": "s",
            "extra": "The answer to: pod my active conditions. Sits inside scenario.first-screen. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 1 calls; question:pod/My active conditions"
          },
          {
            "name": "reopen-first-answer-synthea-10y/self/core-pod.inputshash",
            "value": 0.001462,
            "range": "0.001462-0.001462",
            "unit": "s",
            "extra": "Working out a fingerprint of everything a result depends on, to know when it can be reused. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 1 calls; core-pod.inputsHash"
          },
          {
            "name": "question-page-synthea-10y/self/question.page-pod-what-each-import-brought-in",
            "value": 0.010474,
            "range": "0.010474-0.010474",
            "unit": "s",
            "extra": "One page of the answer to: pod what each import brought in. Sits inside scenario.first-screen. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 1 calls; question.page:pod/What each import brought in"
          },
          {
            "name": "question-page-synthea-10y/self/question.page-pod-what-everything-is-called",
            "value": 0.006693,
            "range": "0.006693-0.006693",
            "unit": "s",
            "extra": "One page of the answer to: pod what everything is called. Sits inside scenario.first-screen. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 1 calls; question.page:pod/What everything is called"
          },
          {
            "name": "question-page-synthea-10y/self/question.page-profile-what-needs-review",
            "value": 0.00352,
            "range": "0.003520-0.003520",
            "unit": "s",
            "extra": "One page of the answer to: profile what needs review. Sits inside scenario.first-screen. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 1 calls; question.page:profile/What needs review"
          },
          {
            "name": "question-page-synthea-10y/self/question.page-pod-how-many-of-each-kind",
            "value": 0.001332,
            "range": "0.001332-0.001332",
            "unit": "s",
            "extra": "One page of the answer to: pod how many of each kind. Sits inside scenario.first-screen. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 1 calls; question.page:pod/How many of each kind"
          },
          {
            "name": "question-page-synthea-10y/self/question.page-pod-the-person-this-pod-is-about",
            "value": 0.000886,
            "range": "0.000886-0.000886",
            "unit": "s",
            "extra": "One page of the answer to: pod the person this pod is about. Sits inside scenario.first-screen. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 1 calls; question.page:pod/The person this pod is about"
          },
          {
            "name": "question-page-synthea-10y/self/question.page-pod-my-reports-notes-and-documents",
            "value": 0.000825,
            "range": "0.000825-0.000825",
            "unit": "s",
            "extra": "One page of the answer to: pod my reports notes and documents. Sits inside scenario.first-screen. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 1 calls; question.page:pod/My reports, notes and documents"
          }
        ]
      },
      {
        "commit": {
          "author": {
            "email": "jayostis@gmail.com",
            "name": "jayostis",
            "username": "jayostis"
          },
          "committer": {
            "email": "noreply@github.com",
            "name": "GitHub",
            "username": "web-flow"
          },
          "distinct": true,
          "id": "c36e0b9db4deea84e89a544be071269d57b5644b",
          "message": "Merge pull request #925 from jayostis/feat/perf-stacked-chart\n\nfeat(perf): stacked charts of where the time goes; a readable index of flame graphs",
          "timestamp": "2026-11-19T21:35:11-08:00",
          "tree_id": "fbfc5b8d6c4012401c92d063f5d9b26edbe47858",
          "url": "https://github.com/jayostis/cascade-runtime-js/commit/c36e0b9db4deea84e89a544be071269d57b5644b"
        },
        "date": 1795153028397,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "fresh-first-screen-synthea-10y/total",
            "value": 5.295247,
            "range": "5.285330-5.336921",
            "unit": "s",
            "extra": "Opening a new pod, importing the whole record and asking the first screen's questions: what a person waits for the first time. | open + import + first screen; unprobed, median of 3 runs, each in a process of its own; dataset=synthea-10y sha256=2703dc1e7e920fa1e45d16c58f8338ef13b3cc1916ee40ffa461112d54dce5de records=647"
          },
          {
            "name": "fresh-first-screen-synthea-10y/open",
            "value": 0.307026,
            "range": "0.306840-0.307523",
            "unit": "s",
            "extra": "Opening the pod. | unprobed, median of 3 runs, each in a process of its own; dataset=synthea-10y sha256=2703dc1e7e920fa1e45d16c58f8338ef13b3cc1916ee40ffa461112d54dce5de records=647"
          },
          {
            "name": "fresh-first-screen-synthea-10y/import",
            "value": 4.871671,
            "range": "4.862849-4.914479",
            "unit": "s",
            "extra": "Importing the whole record into the pod. | unprobed, median of 3 runs, each in a process of its own; dataset=synthea-10y sha256=2703dc1e7e920fa1e45d16c58f8338ef13b3cc1916ee40ffa461112d54dce5de records=647"
          },
          {
            "name": "fresh-first-screen-synthea-10y/first-screen",
            "value": 0.115416,
            "range": "0.114958-0.116736",
            "unit": "s",
            "extra": "Asking the questions the first screen shows. | unprobed, median of 3 runs, each in a process of its own; dataset=synthea-10y sha256=2703dc1e7e920fa1e45d16c58f8338ef13b3cc1916ee40ffa461112d54dce5de records=647"
          },
          {
            "name": "fresh-first-screen-synthea-10y/peak-rss",
            "value": 499998720,
            "range": "495083520-543916032",
            "unit": "By",
            "extra": "The most memory the process held at any moment, in bytes. | the most the process reached, as the operating system keeps it; unprobed, median of 3 runs, each in a process of its own; dataset=synthea-10y sha256=2703dc1e7e920fa1e45d16c58f8338ef13b3cc1916ee40ffa461112d54dce5de records=647"
          },
          {
            "name": "close-synthea-10y/total",
            "value": 0.62364,
            "range": "0.601590-0.626943",
            "unit": "s",
            "extra": "Closing a pod straight after its import and first screen, which saves its database. | closing a pod right after its import and first screen; unprobed, median of 3 runs, each in a process of its own; dataset=synthea-10y sha256=2703dc1e7e920fa1e45d16c58f8338ef13b3cc1916ee40ffa461112d54dce5de records=647"
          },
          {
            "name": "reopen-first-answer-synthea-10y/total",
            "value": 0.248904,
            "range": "0.248844-0.253923",
            "unit": "s",
            "extra": "Opening an existing pod and answering its first read: what a returning person waits for. | open + first read; unprobed, median of 3 runs, each in a process of its own; dataset=synthea-10y sha256=2703dc1e7e920fa1e45d16c58f8338ef13b3cc1916ee40ffa461112d54dce5de records=647"
          },
          {
            "name": "reopen-first-answer-synthea-10y/open",
            "value": 0.193879,
            "range": "0.192703-0.199350",
            "unit": "s",
            "extra": "Opening the pod. | unprobed, median of 3 runs, each in a process of its own; dataset=synthea-10y sha256=2703dc1e7e920fa1e45d16c58f8338ef13b3cc1916ee40ffa461112d54dce5de records=647"
          },
          {
            "name": "reopen-first-answer-synthea-10y/first-read",
            "value": 0.054965,
            "range": "0.054573-0.056201",
            "unit": "s",
            "extra": "The first question asked of the reopened pod ('My active conditions'). | pod/My active conditions; unprobed, median of 3 runs, each in a process of its own; dataset=synthea-10y sha256=2703dc1e7e920fa1e45d16c58f8338ef13b3cc1916ee40ffa461112d54dce5de records=647"
          },
          {
            "name": "reopen-first-answer-synthea-10y/second-read",
            "value": 0.000948,
            "range": "0.000912-0.000983",
            "unit": "s",
            "extra": "A second question asked of the reopened pod ('My active medications'). | pod/My active medications; unprobed, median of 3 runs, each in a process of its own; dataset=synthea-10y sha256=2703dc1e7e920fa1e45d16c58f8338ef13b3cc1916ee40ffa461112d54dce5de records=647"
          },
          {
            "name": "reopen-first-answer-synthea-10y/close",
            "value": 0.00061,
            "range": "0.000572-0.000693",
            "unit": "s",
            "extra": "Closing the pod, saving its database. | unprobed, median of 3 runs, each in a process of its own; dataset=synthea-10y sha256=2703dc1e7e920fa1e45d16c58f8338ef13b3cc1916ee40ffa461112d54dce5de records=647"
          },
          {
            "name": "reopen-first-answer-synthea-10y/peak-rss",
            "value": 170967040,
            "range": "170946560-170983424",
            "unit": "By",
            "extra": "The most memory the process held at any moment, in bytes. | unprobed, median of 3 runs, each in a process of its own; dataset=synthea-10y sha256=2703dc1e7e920fa1e45d16c58f8338ef13b3cc1916ee40ffa461112d54dce5de records=647"
          },
          {
            "name": "question-page-synthea-10y/total",
            "value": 0.033448,
            "range": "0.033127-0.033727",
            "unit": "s",
            "extra": "Fetching one page of answers for every question in turn. | 16 questions, a page of 20 each, from pod.db; unprobed, median of 3 runs, each in a process of its own; dataset=synthea-10y sha256=2703dc1e7e920fa1e45d16c58f8338ef13b3cc1916ee40ffa461112d54dce5de records=647"
          },
          {
            "name": "question-page-synthea-10y/peak-rss",
            "value": 171057152,
            "range": "171057152-171085824",
            "unit": "By",
            "extra": "The most memory the process held at any moment, in bytes. | unprobed, median of 3 runs, each in a process of its own; dataset=synthea-10y sha256=2703dc1e7e920fa1e45d16c58f8338ef13b3cc1916ee40ffa461112d54dce5de records=647"
          },
          {
            "name": "fresh-first-screen-synthea-10y/stage/core-pod.step.perform",
            "value": 3.171629,
            "range": "3.171629-3.171629",
            "unit": "s",
            "extra": "Doing the work of one import step: taking in the new records. Sits inside scenario.import. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 3 calls whose own times sum to 3.171629 s (more than the time in progress where calls overlap); core-pod.step.perform"
          },
          {
            "name": "fresh-first-screen-synthea-10y/stage/arrivals.fileexport",
            "value": 2.534261,
            "range": "2.534261-2.534261",
            "unit": "s",
            "extra": "Taking in every document of the record: converting each, working out its records and writing them to the pod. Sits inside core-pod.step.perform. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 2.534261 s (more than the time in progress where calls overlap); arrivals.fileExport"
          },
          {
            "name": "fresh-first-screen-synthea-10y/stage/arrivals.convert",
            "value": 1.118886,
            "range": "1.118886-1.118886",
            "unit": "s",
            "extra": "Converting the source record into the pod's own format with the adapter. Sits inside scenario.import. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 1.118886 s (more than the time in progress where calls overlap); arrivals.convert"
          },
          {
            "name": "fresh-first-screen-synthea-10y/stage/core-pod.step.commit",
            "value": 1.047094,
            "range": "1.047094-1.047094",
            "unit": "s",
            "extra": "Writing the step's results to the pod's files and recording that it happened. Sits inside scenario.import. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 3 calls whose own times sum to 1.047094 s (more than the time in progress where calls overlap); core-pod.step.commit"
          },
          {
            "name": "fresh-first-screen-synthea-10y/stage/arrivals.accepting",
            "value": 0.999684,
            "range": "0.999684-0.999684",
            "unit": "s",
            "extra": "Finding which adapter accepts this document. Sits inside scenario.import. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 0.999684 s (more than the time in progress where calls overlap); arrivals.accepting"
          },
          {
            "name": "fresh-first-screen-synthea-10y/stage/pod.match",
            "value": 0.815481,
            "range": "0.815481-0.815481",
            "unit": "s",
            "extra": "Judging which records in the pod are the same thing recorded twice. Sits inside scenario.import. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 0.815481 s (more than the time in progress where calls overlap); pod.match"
          },
          {
            "name": "close-synthea-10y/stage/core-pod.keepdatabase",
            "value": 0.505438,
            "range": "0.505438-0.505438",
            "unit": "s",
            "extra": "Saving the pod's database so the next opening is fast. Sits inside scenario.close. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 0.505438 s (more than the time in progress where calls overlap); core-pod.keepDatabase"
          },
          {
            "name": "close-synthea-10y/stage/core-pod.keepdatabase.whole",
            "value": 0.490689,
            "range": "0.490689-0.490689",
            "unit": "s",
            "extra": "Saving the database whole, from the pod's current facts. Sits inside core-pod.keepdatabase. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 0.490689 s (more than the time in progress where calls overlap); core-pod.keepDatabase.whole"
          },
          {
            "name": "close-synthea-10y/stage/pod-database.build.worker",
            "value": 0.481954,
            "range": "0.481954-0.481954",
            "unit": "s",
            "extra": "Starting the helper that builds the saved database. Sits inside core-pod.keepdatabase. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 0.481954 s (more than the time in progress where calls overlap); pod-database.build.worker"
          },
          {
            "name": "close-synthea-10y/stage/pod-database.build.load",
            "value": 0.214423,
            "range": "0.214423-0.214423",
            "unit": "s",
            "extra": "Loading the pod's facts into the saved database. Sits inside core-pod.keepdatabase. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 0.214423 s (more than the time in progress where calls overlap); pod-database.build.load"
          },
          {
            "name": "close-synthea-10y/stage/core-pod.keepbuild",
            "value": 0.096604,
            "range": "0.096604-0.096604",
            "unit": "s",
            "extra": "Preparing the content of the saved database. Sits inside core-pod.keepdatabase. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 0.096604 s (more than the time in progress where calls overlap); core-pod.keepBuild"
          },
          {
            "name": "close-synthea-10y/stage/core-pod.keepbuild.dump",
            "value": 0.070471,
            "range": "0.070471-0.070471",
            "unit": "s",
            "extra": "Gathering the pod's facts to put in the saved database. Sits inside core-pod.keepbuild. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 0.070471 s (more than the time in progress where calls overlap); core-pod.keepBuild.dump"
          },
          {
            "name": "reopen-first-answer-synthea-10y/stage/files.read.file",
            "value": 0.10283,
            "range": "0.102830-0.102830",
            "unit": "s",
            "extra": "Reading one file from the pod's folder. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 160 calls whose own times sum to 0.543589 s (more than the time in progress where calls overlap); files.read.file"
          },
          {
            "name": "reopen-first-answer-synthea-10y/stage/question-pod-my-active-conditions",
            "value": 0.054526,
            "range": "0.054526-0.054526",
            "unit": "s",
            "extra": "The answer to: pod my active conditions. Sits inside scenario.first-read or scenario.second-read. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 0.054526 s (more than the time in progress where calls overlap); question:pod/My active conditions"
          },
          {
            "name": "reopen-first-answer-synthea-10y/stage/core-pod.databaseanswers",
            "value": 0.040264,
            "range": "0.040264-0.040264",
            "unit": "s",
            "extra": "Checking whether the saved database holds the pod as it stands now, so it can answer in place of a rebuild. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 0.040264 s (more than the time in progress where calls overlap); core-pod.databaseAnswers"
          },
          {
            "name": "reopen-first-answer-synthea-10y/stage/core-pod.inputshash",
            "value": 0.029196,
            "range": "0.029196-0.029196",
            "unit": "s",
            "extra": "Working out a fingerprint of everything a result depends on, to know when it can be reused. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 0.029196 s (more than the time in progress where calls overlap); core-pod.inputsHash"
          },
          {
            "name": "reopen-first-answer-synthea-10y/stage/union.select",
            "value": 0.023959,
            "range": "0.023959-0.023959",
            "unit": "s",
            "extra": "Asking the in-memory facts a question that returns rows. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 0.023959 s (more than the time in progress where calls overlap); union.select"
          },
          {
            "name": "reopen-first-answer-synthea-10y/stage/store.query",
            "value": 0.022871,
            "range": "0.022871-0.022871",
            "unit": "s",
            "extra": "Questions put to the pod's fact store, many of them: the time one or more of them was in progress. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 0.022871 s (more than the time in progress where calls overlap); store.query"
          },
          {
            "name": "question-page-synthea-10y/stage/question.page-pod-what-each-import-brought-in",
            "value": 0.012402,
            "range": "0.012402-0.012402",
            "unit": "s",
            "extra": "One page of the answer to: pod what each import brought in. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 0.012402 s (more than the time in progress where calls overlap); question.page:pod/What each import brought in"
          },
          {
            "name": "question-page-synthea-10y/stage/question.page-pod-what-everything-is-called",
            "value": 0.00774,
            "range": "0.007740-0.007740",
            "unit": "s",
            "extra": "One page of the answer to: pod what everything is called. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 0.007740 s (more than the time in progress where calls overlap); question.page:pod/What everything is called"
          },
          {
            "name": "question-page-synthea-10y/stage/question.page-profile-what-needs-review",
            "value": 0.00419,
            "range": "0.004190-0.004190",
            "unit": "s",
            "extra": "One page of the answer to: profile what needs review. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 0.004190 s (more than the time in progress where calls overlap); question.page:profile/What needs review"
          },
          {
            "name": "question-page-synthea-10y/stage/question.page-pod-how-many-of-each-kind",
            "value": 0.001556,
            "range": "0.001556-0.001556",
            "unit": "s",
            "extra": "One page of the answer to: pod how many of each kind. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 0.001556 s (more than the time in progress where calls overlap); question.page:pod/How many of each kind"
          },
          {
            "name": "question-page-synthea-10y/stage/question.page-pod-the-person-this-pod-is-about",
            "value": 0.001059,
            "range": "0.001059-0.001059",
            "unit": "s",
            "extra": "One page of the answer to: pod the person this pod is about. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 0.001059 s (more than the time in progress where calls overlap); question.page:pod/The person this pod is about"
          },
          {
            "name": "question-page-synthea-10y/stage/question.page-pod-my-active-medications",
            "value": 0.000985,
            "range": "0.000985-0.000985",
            "unit": "s",
            "extra": "One page of the answer to: pod my active medications. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 0.000985 s (more than the time in progress where calls overlap); question.page:pod/My active medications"
          },
          {
            "name": "fresh-first-screen-synthea-10y/self/arrivals.accepting",
            "value": 0.992178,
            "range": "0.992178-0.992178",
            "unit": "s",
            "extra": "Finding which adapter accepts this document. Sits inside scenario.import. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 1 calls; arrivals.accepting"
          },
          {
            "name": "fresh-first-screen-synthea-10y/self/core-pod.step.commit",
            "value": 0.630515,
            "range": "0.630515-0.630515",
            "unit": "s",
            "extra": "Writing the step's results to the pod's files and recording that it happened. Sits inside scenario.import. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 3 calls; core-pod.step.commit"
          },
          {
            "name": "fresh-first-screen-synthea-10y/self/core-pod.import.adapters",
            "value": 0.583692,
            "range": "0.583692-0.583692",
            "unit": "s",
            "extra": "Reading the adapter that knows how to convert this kind of record. Sits inside scenario.import. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 1 calls; core-pod.import.adapters"
          },
          {
            "name": "fresh-first-screen-synthea-10y/self/bridge.stage-records",
            "value": 0.577675,
            "range": "0.577675-0.577675",
            "unit": "s",
            "extra": "The Bridge makes the pod's records, with their versions, from what its mappings produced. Sits inside arrivals.convert. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 1 calls; bridge.stage:records"
          },
          {
            "name": "fresh-first-screen-synthea-10y/self/store.query",
            "value": 0.515015,
            "range": "0.515015-0.515015",
            "unit": "s",
            "extra": "Questions put to the pod's fact store, many of them: the time one or more of them was in progress. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 154 calls; store.query"
          },
          {
            "name": "fresh-first-screen-synthea-10y/self/files.write.file",
            "value": 0.259741,
            "range": "0.259741-0.259741",
            "unit": "s",
            "extra": "Writing one file into the pod's folder. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 1752 calls; files.write.file"
          },
          {
            "name": "close-synthea-10y/self/pod-database.build.load",
            "value": 0.214423,
            "range": "0.214423-0.214423",
            "unit": "s",
            "extra": "Loading the pod's facts into the saved database. Sits inside core-pod.keepdatabase. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 1 calls; pod-database.build.load"
          },
          {
            "name": "close-synthea-10y/self/pod-database.build.worker",
            "value": 0.195343,
            "range": "0.195343-0.195343",
            "unit": "s",
            "extra": "Starting the helper that builds the saved database. Sits inside core-pod.keepdatabase. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 1 calls; pod-database.build.worker"
          },
          {
            "name": "close-synthea-10y/self/core-pod.keepbuild.dump",
            "value": 0.070471,
            "range": "0.070471-0.070471",
            "unit": "s",
            "extra": "Gathering the pod's facts to put in the saved database. Sits inside core-pod.keepbuild. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 1 calls; core-pod.keepBuild.dump"
          },
          {
            "name": "close-synthea-10y/self/pod-database.build.screens-fill",
            "value": 0.041303,
            "range": "0.041303-0.041303",
            "unit": "s",
            "extra": "Filling in the database's ready-made answer tables. Sits inside core-pod.keepdatabase. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 1 calls; pod-database.build.screens:fill"
          },
          {
            "name": "close-synthea-10y/self/core-pod.keepbuild",
            "value": 0.023744,
            "range": "0.023744-0.023744",
            "unit": "s",
            "extra": "Preparing the content of the saved database. Sits inside core-pod.keepdatabase. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 1 calls; core-pod.keepBuild"
          },
          {
            "name": "close-synthea-10y/self/pod-database.build.screens-finish",
            "value": 0.014778,
            "range": "0.014778-0.014778",
            "unit": "s",
            "extra": "Finishing the database's ready-made answer tables. Sits inside core-pod.keepdatabase. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 1 calls; pod-database.build.screens:finish"
          },
          {
            "name": "reopen-first-answer-synthea-10y/self/files.read.file",
            "value": 0.10283,
            "range": "0.102830-0.102830",
            "unit": "s",
            "extra": "Reading one file from the pod's folder. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 160 calls; files.read.file"
          },
          {
            "name": "reopen-first-answer-synthea-10y/self/store.query",
            "value": 0.022871,
            "range": "0.022871-0.022871",
            "unit": "s",
            "extra": "Questions put to the pod's fact store, many of them: the time one or more of them was in progress. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 1 calls; store.query"
          },
          {
            "name": "reopen-first-answer-synthea-10y/self/union.loadturtle",
            "value": 0.016304,
            "range": "0.016304-0.016304",
            "unit": "s",
            "extra": "Loading text-format facts into memory. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 1 calls; union.loadTurtle"
          },
          {
            "name": "reopen-first-answer-synthea-10y/self/files.hash.sha256",
            "value": 0.015537,
            "range": "0.015537-0.015537",
            "unit": "s",
            "extra": "Fingerprinting a file's content to tell whether it changed. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 20 calls; files.hash.sha256"
          },
          {
            "name": "reopen-first-answer-synthea-10y/self/question-pod-my-active-conditions",
            "value": 0.006466,
            "range": "0.006466-0.006466",
            "unit": "s",
            "extra": "The answer to: pod my active conditions. Sits inside scenario.first-read or scenario.second-read. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 1 calls; question:pod/My active conditions"
          },
          {
            "name": "reopen-first-answer-synthea-10y/self/core-pod.inputshash",
            "value": 0.002084,
            "range": "0.002084-0.002084",
            "unit": "s",
            "extra": "Working out a fingerprint of everything a result depends on, to know when it can be reused. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 1 calls; core-pod.inputsHash"
          },
          {
            "name": "question-page-synthea-10y/self/question.page-pod-what-each-import-brought-in",
            "value": 0.012402,
            "range": "0.012402-0.012402",
            "unit": "s",
            "extra": "One page of the answer to: pod what each import brought in. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 1 calls; question.page:pod/What each import brought in"
          },
          {
            "name": "question-page-synthea-10y/self/question.page-pod-what-everything-is-called",
            "value": 0.00774,
            "range": "0.007740-0.007740",
            "unit": "s",
            "extra": "One page of the answer to: pod what everything is called. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 1 calls; question.page:pod/What everything is called"
          },
          {
            "name": "question-page-synthea-10y/self/question.page-profile-what-needs-review",
            "value": 0.00419,
            "range": "0.004190-0.004190",
            "unit": "s",
            "extra": "One page of the answer to: profile what needs review. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 1 calls; question.page:profile/What needs review"
          },
          {
            "name": "question-page-synthea-10y/self/question.page-pod-how-many-of-each-kind",
            "value": 0.001556,
            "range": "0.001556-0.001556",
            "unit": "s",
            "extra": "One page of the answer to: pod how many of each kind. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 1 calls; question.page:pod/How many of each kind"
          },
          {
            "name": "question-page-synthea-10y/self/question.page-pod-the-person-this-pod-is-about",
            "value": 0.001059,
            "range": "0.001059-0.001059",
            "unit": "s",
            "extra": "One page of the answer to: pod the person this pod is about. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 1 calls; question.page:pod/The person this pod is about"
          },
          {
            "name": "question-page-synthea-10y/self/question.page-pod-my-active-medications",
            "value": 0.000985,
            "range": "0.000985-0.000985",
            "unit": "s",
            "extra": "One page of the answer to: pod my active medications. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 1 calls; question.page:pod/My active medications"
          }
        ]
      },
      {
        "commit": {
          "author": {
            "email": "jayostis@gmail.com",
            "name": "jayostis",
            "username": "jayostis"
          },
          "committer": {
            "email": "noreply@github.com",
            "name": "GitHub",
            "username": "web-flow"
          },
          "distinct": true,
          "id": "1e5a8d16b0b4894f3ff9faf11f0f28cbf7b4d29b",
          "message": "Merge pull request #926 from jayostis/ci/run-suite-once\n\nci(tests): run the suite once, and the native suite on its own conformance report",
          "timestamp": "2026-11-19T23:03:24-08:00",
          "tree_id": "c966d61d549d3ac77f6ab18683892765a47455be",
          "url": "https://github.com/jayostis/cascade-runtime-js/commit/1e5a8d16b0b4894f3ff9faf11f0f28cbf7b4d29b"
        },
        "date": 1795158306212,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "fresh-first-screen-synthea-10y/total",
            "value": 3.528591,
            "range": "3.465393-3.580125",
            "unit": "s",
            "extra": "Opening a new pod, importing the whole record and asking the first screen's questions: what a person waits for the first time. | open + import + first screen; unprobed, median of 3 runs, each in a process of its own; dataset=synthea-10y sha256=2703dc1e7e920fa1e45d16c58f8338ef13b3cc1916ee40ffa461112d54dce5de records=647"
          },
          {
            "name": "fresh-first-screen-synthea-10y/open",
            "value": 0.20488,
            "range": "0.204037-0.208278",
            "unit": "s",
            "extra": "Opening the pod. | unprobed, median of 3 runs, each in a process of its own; dataset=synthea-10y sha256=2703dc1e7e920fa1e45d16c58f8338ef13b3cc1916ee40ffa461112d54dce5de records=647"
          },
          {
            "name": "fresh-first-screen-synthea-10y/import",
            "value": 3.240479,
            "range": "3.182937-3.291802",
            "unit": "s",
            "extra": "Importing the whole record into the pod. | unprobed, median of 3 runs, each in a process of its own; dataset=synthea-10y sha256=2703dc1e7e920fa1e45d16c58f8338ef13b3cc1916ee40ffa461112d54dce5de records=647"
          },
          {
            "name": "fresh-first-screen-synthea-10y/first-screen",
            "value": 0.079834,
            "range": "0.078419-0.083443",
            "unit": "s",
            "extra": "Asking the questions the first screen shows. | unprobed, median of 3 runs, each in a process of its own; dataset=synthea-10y sha256=2703dc1e7e920fa1e45d16c58f8338ef13b3cc1916ee40ffa461112d54dce5de records=647"
          },
          {
            "name": "fresh-first-screen-synthea-10y/peak-rss",
            "value": 516210688,
            "range": "511778816-555462656",
            "unit": "By",
            "extra": "The most memory the process held at any moment, in bytes. | the most the process reached, as the operating system keeps it; unprobed, median of 3 runs, each in a process of its own; dataset=synthea-10y sha256=2703dc1e7e920fa1e45d16c58f8338ef13b3cc1916ee40ffa461112d54dce5de records=647"
          },
          {
            "name": "close-synthea-10y/total",
            "value": 0.42003,
            "range": "0.414603-0.423275",
            "unit": "s",
            "extra": "Closing a pod straight after its import and first screen, which saves its database. | closing a pod right after its import and first screen; unprobed, median of 3 runs, each in a process of its own; dataset=synthea-10y sha256=2703dc1e7e920fa1e45d16c58f8338ef13b3cc1916ee40ffa461112d54dce5de records=647"
          },
          {
            "name": "reopen-first-answer-synthea-10y/total",
            "value": 0.163498,
            "range": "0.161965-0.166559",
            "unit": "s",
            "extra": "Opening an existing pod and answering its first read: what a returning person waits for. | open + first read; unprobed, median of 3 runs, each in a process of its own; dataset=synthea-10y sha256=2703dc1e7e920fa1e45d16c58f8338ef13b3cc1916ee40ffa461112d54dce5de records=647"
          },
          {
            "name": "reopen-first-answer-synthea-10y/open",
            "value": 0.128958,
            "range": "0.127357-0.130820",
            "unit": "s",
            "extra": "Opening the pod. | unprobed, median of 3 runs, each in a process of its own; dataset=synthea-10y sha256=2703dc1e7e920fa1e45d16c58f8338ef13b3cc1916ee40ffa461112d54dce5de records=647"
          },
          {
            "name": "reopen-first-answer-synthea-10y/first-read",
            "value": 0.034608,
            "range": "0.034540-0.035738",
            "unit": "s",
            "extra": "The first question asked of the reopened pod ('My active conditions'). | pod/My active conditions; unprobed, median of 3 runs, each in a process of its own; dataset=synthea-10y sha256=2703dc1e7e920fa1e45d16c58f8338ef13b3cc1916ee40ffa461112d54dce5de records=647"
          },
          {
            "name": "reopen-first-answer-synthea-10y/second-read",
            "value": 0.000797,
            "range": "0.000756-0.000803",
            "unit": "s",
            "extra": "A second question asked of the reopened pod ('My active medications'). | pod/My active medications; unprobed, median of 3 runs, each in a process of its own; dataset=synthea-10y sha256=2703dc1e7e920fa1e45d16c58f8338ef13b3cc1916ee40ffa461112d54dce5de records=647"
          },
          {
            "name": "reopen-first-answer-synthea-10y/close",
            "value": 0.000491,
            "range": "0.000481-0.000504",
            "unit": "s",
            "extra": "Closing the pod, saving its database. | unprobed, median of 3 runs, each in a process of its own; dataset=synthea-10y sha256=2703dc1e7e920fa1e45d16c58f8338ef13b3cc1916ee40ffa461112d54dce5de records=647"
          },
          {
            "name": "reopen-first-answer-synthea-10y/peak-rss",
            "value": 179761152,
            "range": "179744768-179781632",
            "unit": "By",
            "extra": "The most memory the process held at any moment, in bytes. | unprobed, median of 3 runs, each in a process of its own; dataset=synthea-10y sha256=2703dc1e7e920fa1e45d16c58f8338ef13b3cc1916ee40ffa461112d54dce5de records=647"
          },
          {
            "name": "question-page-synthea-10y/total",
            "value": 0.025017,
            "range": "0.024790-0.025139",
            "unit": "s",
            "extra": "Fetching one page of answers for every question in turn. | 16 questions, a page of 20 each, from pod.db; unprobed, median of 3 runs, each in a process of its own; dataset=synthea-10y sha256=2703dc1e7e920fa1e45d16c58f8338ef13b3cc1916ee40ffa461112d54dce5de records=647"
          },
          {
            "name": "question-page-synthea-10y/peak-rss",
            "value": 179884032,
            "range": "179884032-179900416",
            "unit": "By",
            "extra": "The most memory the process held at any moment, in bytes. | unprobed, median of 3 runs, each in a process of its own; dataset=synthea-10y sha256=2703dc1e7e920fa1e45d16c58f8338ef13b3cc1916ee40ffa461112d54dce5de records=647"
          },
          {
            "name": "fresh-first-screen-synthea-10y/stage/core-pod.step.perform",
            "value": 2.24706,
            "range": "2.247060-2.247060",
            "unit": "s",
            "extra": "Doing the work of one import step: taking in the new records. Sits inside scenario.import. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 3 calls whose own times sum to 2.247060 s (more than the time in progress where calls overlap); core-pod.step.perform"
          },
          {
            "name": "fresh-first-screen-synthea-10y/stage/arrivals.fileexport",
            "value": 1.789483,
            "range": "1.789483-1.789483",
            "unit": "s",
            "extra": "Taking in every document of the record: converting each, working out its records and writing them to the pod. Sits inside core-pod.step.perform. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 1.789483 s (more than the time in progress where calls overlap); arrivals.fileExport"
          },
          {
            "name": "fresh-first-screen-synthea-10y/stage/arrivals.convert",
            "value": 0.809999,
            "range": "0.809999-0.809999",
            "unit": "s",
            "extra": "Converting the source record into the pod's own format with the adapter. Sits inside scenario.import. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 0.809999 s (more than the time in progress where calls overlap); arrivals.convert"
          },
          {
            "name": "fresh-first-screen-synthea-10y/stage/arrivals.accepting",
            "value": 0.702283,
            "range": "0.702283-0.702283",
            "unit": "s",
            "extra": "Finding which adapter accepts this document. Sits inside scenario.import. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 0.702283 s (more than the time in progress where calls overlap); arrivals.accepting"
          },
          {
            "name": "fresh-first-screen-synthea-10y/stage/pod.match",
            "value": 0.564012,
            "range": "0.564012-0.564012",
            "unit": "s",
            "extra": "Judging which records in the pod are the same thing recorded twice. Sits inside scenario.import. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 0.564012 s (more than the time in progress where calls overlap); pod.match"
          },
          {
            "name": "fresh-first-screen-synthea-10y/stage/core-pod.step.rebuild-import",
            "value": 0.519132,
            "range": "0.519132-0.519132",
            "unit": "s",
            "extra": "Re-deriving what the imported records change. Sits inside scenario.import. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 0.519132 s (more than the time in progress where calls overlap); core-pod.step.rebuild:import"
          },
          {
            "name": "close-synthea-10y/stage/core-pod.keepdatabase",
            "value": 0.340965,
            "range": "0.340965-0.340965",
            "unit": "s",
            "extra": "Saving the pod's database so the next opening is fast. Sits inside scenario.close. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 0.340965 s (more than the time in progress where calls overlap); core-pod.keepDatabase"
          },
          {
            "name": "close-synthea-10y/stage/core-pod.keepdatabase.whole",
            "value": 0.327794,
            "range": "0.327794-0.327794",
            "unit": "s",
            "extra": "Saving the database whole, from the pod's current facts. Sits inside core-pod.keepdatabase. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 0.327794 s (more than the time in progress where calls overlap); core-pod.keepDatabase.whole"
          },
          {
            "name": "close-synthea-10y/stage/pod-database.build.worker",
            "value": 0.321136,
            "range": "0.321136-0.321136",
            "unit": "s",
            "extra": "Starting the helper that builds the saved database. Sits inside core-pod.keepdatabase. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 0.321136 s (more than the time in progress where calls overlap); pod-database.build.worker"
          },
          {
            "name": "close-synthea-10y/stage/pod-database.build.load",
            "value": 0.136444,
            "range": "0.136444-0.136444",
            "unit": "s",
            "extra": "Loading the pod's facts into the saved database. Sits inside core-pod.keepdatabase. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 0.136444 s (more than the time in progress where calls overlap); pod-database.build.load"
          },
          {
            "name": "close-synthea-10y/stage/core-pod.keepbuild",
            "value": 0.075589,
            "range": "0.075589-0.075589",
            "unit": "s",
            "extra": "Preparing the content of the saved database. Sits inside core-pod.keepdatabase. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 0.075589 s (more than the time in progress where calls overlap); core-pod.keepBuild"
          },
          {
            "name": "close-synthea-10y/stage/core-pod.keepbuild.dump",
            "value": 0.054368,
            "range": "0.054368-0.054368",
            "unit": "s",
            "extra": "Gathering the pod's facts to put in the saved database. Sits inside core-pod.keepbuild. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 0.054368 s (more than the time in progress where calls overlap); core-pod.keepBuild.dump"
          },
          {
            "name": "reopen-first-answer-synthea-10y/stage/files.read.file",
            "value": 0.069392,
            "range": "0.069392-0.069392",
            "unit": "s",
            "extra": "Reading one file from the pod's folder. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 160 calls whose own times sum to 0.321624 s (more than the time in progress where calls overlap); files.read.file"
          },
          {
            "name": "reopen-first-answer-synthea-10y/stage/question-pod-my-active-conditions",
            "value": 0.036391,
            "range": "0.036391-0.036391",
            "unit": "s",
            "extra": "The answer to: pod my active conditions. Sits inside scenario.first-read or scenario.second-read. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 0.036391 s (more than the time in progress where calls overlap); question:pod/My active conditions"
          },
          {
            "name": "reopen-first-answer-synthea-10y/stage/core-pod.databaseanswers",
            "value": 0.027886,
            "range": "0.027886-0.027886",
            "unit": "s",
            "extra": "Checking whether the saved database holds the pod as it stands now, so it can answer in place of a rebuild. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 0.027886 s (more than the time in progress where calls overlap); core-pod.databaseAnswers"
          },
          {
            "name": "reopen-first-answer-synthea-10y/stage/core-pod.inputshash",
            "value": 0.020734,
            "range": "0.020734-0.020734",
            "unit": "s",
            "extra": "Working out a fingerprint of everything a result depends on, to know when it can be reused. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 0.020734 s (more than the time in progress where calls overlap); core-pod.inputsHash"
          },
          {
            "name": "reopen-first-answer-synthea-10y/stage/union.select",
            "value": 0.015374,
            "range": "0.015374-0.015374",
            "unit": "s",
            "extra": "Asking the in-memory facts a question that returns rows. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 0.015374 s (more than the time in progress where calls overlap); union.select"
          },
          {
            "name": "reopen-first-answer-synthea-10y/stage/store.query",
            "value": 0.014809,
            "range": "0.014809-0.014809",
            "unit": "s",
            "extra": "Questions put to the pod's fact store, many of them: the time one or more of them was in progress. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 0.014809 s (more than the time in progress where calls overlap); store.query"
          },
          {
            "name": "question-page-synthea-10y/stage/question.page-pod-what-each-import-brought-in",
            "value": 0.008626,
            "range": "0.008626-0.008626",
            "unit": "s",
            "extra": "One page of the answer to: pod what each import brought in. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 0.008626 s (more than the time in progress where calls overlap); question.page:pod/What each import brought in"
          },
          {
            "name": "question-page-synthea-10y/stage/question.page-pod-what-everything-is-called",
            "value": 0.005936,
            "range": "0.005936-0.005936",
            "unit": "s",
            "extra": "One page of the answer to: pod what everything is called. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 0.005936 s (more than the time in progress where calls overlap); question.page:pod/What everything is called"
          },
          {
            "name": "question-page-synthea-10y/stage/question.page-profile-what-needs-review",
            "value": 0.00338,
            "range": "0.003380-0.003380",
            "unit": "s",
            "extra": "One page of the answer to: profile what needs review. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 0.003380 s (more than the time in progress where calls overlap); question.page:profile/What needs review"
          },
          {
            "name": "question-page-synthea-10y/stage/question.page-pod-how-many-of-each-kind",
            "value": 0.00134,
            "range": "0.001340-0.001340",
            "unit": "s",
            "extra": "One page of the answer to: pod how many of each kind. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 0.001340 s (more than the time in progress where calls overlap); question.page:pod/How many of each kind"
          },
          {
            "name": "question-page-synthea-10y/stage/question.page-pod-the-person-this-pod-is-about",
            "value": 0.000901,
            "range": "0.000901-0.000901",
            "unit": "s",
            "extra": "One page of the answer to: pod the person this pod is about. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 0.000901 s (more than the time in progress where calls overlap); question.page:pod/The person this pod is about"
          },
          {
            "name": "question-page-synthea-10y/stage/question.page-pod-my-active-medications",
            "value": 0.000796,
            "range": "0.000796-0.000796",
            "unit": "s",
            "extra": "One page of the answer to: pod my active medications. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 0.000796 s (more than the time in progress where calls overlap); question.page:pod/My active medications"
          },
          {
            "name": "fresh-first-screen-synthea-10y/self/arrivals.accepting",
            "value": 0.697811,
            "range": "0.697811-0.697811",
            "unit": "s",
            "extra": "Finding which adapter accepts this document. Sits inside scenario.import. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 1 calls; arrivals.accepting"
          },
          {
            "name": "fresh-first-screen-synthea-10y/self/core-pod.import.adapters",
            "value": 0.416569,
            "range": "0.416569-0.416569",
            "unit": "s",
            "extra": "Reading the adapter that knows how to convert this kind of record. Sits inside scenario.import. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 1 calls; core-pod.import.adapters"
          },
          {
            "name": "fresh-first-screen-synthea-10y/self/bridge.stage-records",
            "value": 0.39564,
            "range": "0.395640-0.395640",
            "unit": "s",
            "extra": "The Bridge makes the pod's records, with their versions, from what its mappings produced. Sits inside arrivals.convert. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 1 calls; bridge.stage:records"
          },
          {
            "name": "fresh-first-screen-synthea-10y/self/store.query",
            "value": 0.353818,
            "range": "0.353818-0.353818",
            "unit": "s",
            "extra": "Questions put to the pod's fact store, many of them: the time one or more of them was in progress. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 154 calls; store.query"
          },
          {
            "name": "fresh-first-screen-synthea-10y/self/core-pod.step.commit",
            "value": 0.285332,
            "range": "0.285332-0.285332",
            "unit": "s",
            "extra": "Writing the step's results to the pod's files and recording that it happened. Sits inside scenario.import. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 3 calls; core-pod.step.commit"
          },
          {
            "name": "fresh-first-screen-synthea-10y/self/bridge.stage-mapping",
            "value": 0.204073,
            "range": "0.204073-0.204073",
            "unit": "s",
            "extra": "The Bridge runs the adapter's mappings over the source record's facts to produce the pod's facts. Sits inside arrivals.convert. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 1 calls; bridge.stage:mapping"
          },
          {
            "name": "close-synthea-10y/self/pod-database.build.load",
            "value": 0.136444,
            "range": "0.136444-0.136444",
            "unit": "s",
            "extra": "Loading the pod's facts into the saved database. Sits inside core-pod.keepdatabase. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 1 calls; pod-database.build.load"
          },
          {
            "name": "close-synthea-10y/self/pod-database.build.worker",
            "value": 0.134517,
            "range": "0.134517-0.134517",
            "unit": "s",
            "extra": "Starting the helper that builds the saved database. Sits inside core-pod.keepdatabase. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 1 calls; pod-database.build.worker"
          },
          {
            "name": "close-synthea-10y/self/core-pod.keepbuild.dump",
            "value": 0.054368,
            "range": "0.054368-0.054368",
            "unit": "s",
            "extra": "Gathering the pod's facts to put in the saved database. Sits inside core-pod.keepbuild. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 1 calls; core-pod.keepBuild.dump"
          },
          {
            "name": "close-synthea-10y/self/pod-database.build.screens-fill",
            "value": 0.029135,
            "range": "0.029135-0.029135",
            "unit": "s",
            "extra": "Filling in the database's ready-made answer tables. Sits inside core-pod.keepdatabase. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 1 calls; pod-database.build.screens:fill"
          },
          {
            "name": "close-synthea-10y/self/core-pod.keepbuild",
            "value": 0.018955,
            "range": "0.018955-0.018955",
            "unit": "s",
            "extra": "Preparing the content of the saved database. Sits inside core-pod.keepdatabase. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 1 calls; core-pod.keepBuild"
          },
          {
            "name": "close-synthea-10y/self/core-pod.keepdatabase",
            "value": 0.011537,
            "range": "0.011537-0.011537",
            "unit": "s",
            "extra": "Saving the pod's database so the next opening is fast. Sits inside scenario.close. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 1 calls; core-pod.keepDatabase"
          },
          {
            "name": "reopen-first-answer-synthea-10y/self/files.read.file",
            "value": 0.069392,
            "range": "0.069392-0.069392",
            "unit": "s",
            "extra": "Reading one file from the pod's folder. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 160 calls; files.read.file"
          },
          {
            "name": "reopen-first-answer-synthea-10y/self/store.query",
            "value": 0.014809,
            "range": "0.014809-0.014809",
            "unit": "s",
            "extra": "Questions put to the pod's fact store, many of them: the time one or more of them was in progress. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 1 calls; store.query"
          },
          {
            "name": "reopen-first-answer-synthea-10y/self/files.hash.sha256",
            "value": 0.011555,
            "range": "0.011555-0.011555",
            "unit": "s",
            "extra": "Fingerprinting a file's content to tell whether it changed. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 20 calls; files.hash.sha256"
          },
          {
            "name": "reopen-first-answer-synthea-10y/self/union.loadturtle",
            "value": 0.011367,
            "range": "0.011367-0.011367",
            "unit": "s",
            "extra": "Loading text-format facts into memory. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 1 calls; union.loadTurtle"
          },
          {
            "name": "reopen-first-answer-synthea-10y/self/question-pod-my-active-conditions",
            "value": 0.004496,
            "range": "0.004496-0.004496",
            "unit": "s",
            "extra": "The answer to: pod my active conditions. Sits inside scenario.first-read or scenario.second-read. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 1 calls; question:pod/My active conditions"
          },
          {
            "name": "reopen-first-answer-synthea-10y/self/core-pod.inputshash",
            "value": 0.001466,
            "range": "0.001466-0.001466",
            "unit": "s",
            "extra": "Working out a fingerprint of everything a result depends on, to know when it can be reused. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 1 calls; core-pod.inputsHash"
          },
          {
            "name": "question-page-synthea-10y/self/question.page-pod-what-each-import-brought-in",
            "value": 0.008626,
            "range": "0.008626-0.008626",
            "unit": "s",
            "extra": "One page of the answer to: pod what each import brought in. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 1 calls; question.page:pod/What each import brought in"
          },
          {
            "name": "question-page-synthea-10y/self/question.page-pod-what-everything-is-called",
            "value": 0.005936,
            "range": "0.005936-0.005936",
            "unit": "s",
            "extra": "One page of the answer to: pod what everything is called. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 1 calls; question.page:pod/What everything is called"
          },
          {
            "name": "question-page-synthea-10y/self/question.page-profile-what-needs-review",
            "value": 0.00338,
            "range": "0.003380-0.003380",
            "unit": "s",
            "extra": "One page of the answer to: profile what needs review. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 1 calls; question.page:profile/What needs review"
          },
          {
            "name": "question-page-synthea-10y/self/question.page-pod-how-many-of-each-kind",
            "value": 0.00134,
            "range": "0.001340-0.001340",
            "unit": "s",
            "extra": "One page of the answer to: pod how many of each kind. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 1 calls; question.page:pod/How many of each kind"
          },
          {
            "name": "question-page-synthea-10y/self/question.page-pod-the-person-this-pod-is-about",
            "value": 0.000901,
            "range": "0.000901-0.000901",
            "unit": "s",
            "extra": "One page of the answer to: pod the person this pod is about. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 1 calls; question.page:pod/The person this pod is about"
          },
          {
            "name": "question-page-synthea-10y/self/question.page-pod-my-active-medications",
            "value": 0.000796,
            "range": "0.000796-0.000796",
            "unit": "s",
            "extra": "One page of the answer to: pod my active medications. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 1 calls; question.page:pod/My active medications"
          }
        ]
      },
      {
        "commit": {
          "author": {
            "name": "jayostis",
            "username": "jayostis",
            "email": "jayostis@gmail.com"
          },
          "committer": {
            "name": "GitHub",
            "username": "web-flow",
            "email": "noreply@github.com"
          },
          "id": "1e5a8d16b0b4894f3ff9faf11f0f28cbf7b4d29b",
          "message": "Merge pull request #926 from jayostis/ci/run-suite-once\n\nci(tests): run the suite once, and the native suite on its own conformance report",
          "timestamp": "2026-11-20T07:03:24Z",
          "url": "https://github.com/jayostis/cascade-runtime-js/commit/1e5a8d16b0b4894f3ff9faf11f0f28cbf7b4d29b"
        },
        "date": 1795166250617,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "fresh-first-screen-synthea-lifetime/total",
            "value": 43.589971,
            "range": "43.551500-43.827717",
            "unit": "s",
            "extra": "Opening a new pod, importing the whole record and asking the first screen's questions: what a person waits for the first time. | open + import + first screen; unprobed, median of 3 runs, each in a process of its own; dataset=synthea-lifetime sha256=f20b86408066ece2d25a7b02d380b7652f22d16df9dab613a0c73c9969b17da8 records=16833"
          },
          {
            "name": "fresh-first-screen-synthea-lifetime/open",
            "value": 0.307438,
            "range": "0.294747-0.307631",
            "unit": "s",
            "extra": "Opening the pod. | unprobed, median of 3 runs, each in a process of its own; dataset=synthea-lifetime sha256=f20b86408066ece2d25a7b02d380b7652f22d16df9dab613a0c73c9969b17da8 records=16833"
          },
          {
            "name": "fresh-first-screen-synthea-lifetime/import",
            "value": 41.557227,
            "range": "41.536589-41.894253",
            "unit": "s",
            "extra": "Importing the whole record into the pod. | unprobed, median of 3 runs, each in a process of its own; dataset=synthea-lifetime sha256=f20b86408066ece2d25a7b02d380b7652f22d16df9dab613a0c73c9969b17da8 records=16833"
          },
          {
            "name": "fresh-first-screen-synthea-lifetime/first-screen",
            "value": 1.720164,
            "range": "1.625833-1.725306",
            "unit": "s",
            "extra": "Asking the questions the first screen shows. | unprobed, median of 3 runs, each in a process of its own; dataset=synthea-lifetime sha256=f20b86408066ece2d25a7b02d380b7652f22d16df9dab613a0c73c9969b17da8 records=16833"
          },
          {
            "name": "fresh-first-screen-synthea-lifetime/peak-rss",
            "value": 2022817792,
            "range": "1997561856-2027511808",
            "unit": "By",
            "extra": "The most memory the process held at any moment, in bytes. | the most the process reached, as the operating system keeps it; unprobed, median of 3 runs, each in a process of its own; dataset=synthea-lifetime sha256=f20b86408066ece2d25a7b02d380b7652f22d16df9dab613a0c73c9969b17da8 records=16833"
          },
          {
            "name": "fresh-first-screen-synthea-lifetime-encrypted/total",
            "value": 44.860097,
            "range": "44.260062-45.245836",
            "unit": "s",
            "extra": "Opening a new pod, importing the whole record and asking the first screen's questions: what a person waits for the first time. | open + import + first screen; unprobed, median of 3 runs, each in a process of its own; dataset=synthea-lifetime sha256=f20b86408066ece2d25a7b02d380b7652f22d16df9dab613a0c73c9969b17da8 records=16833 encrypted"
          },
          {
            "name": "fresh-first-screen-synthea-lifetime-encrypted/open",
            "value": 0.68663,
            "range": "0.667625-0.688491",
            "unit": "s",
            "extra": "Opening the pod. | unprobed, median of 3 runs, each in a process of its own; dataset=synthea-lifetime sha256=f20b86408066ece2d25a7b02d380b7652f22d16df9dab613a0c73c9969b17da8 records=16833 encrypted"
          },
          {
            "name": "fresh-first-screen-synthea-lifetime-encrypted/import",
            "value": 42.497567,
            "range": "41.964652-42.900932",
            "unit": "s",
            "extra": "Importing the whole record into the pod. | unprobed, median of 3 runs, each in a process of its own; dataset=synthea-lifetime sha256=f20b86408066ece2d25a7b02d380b7652f22d16df9dab613a0c73c9969b17da8 records=16833 encrypted"
          },
          {
            "name": "fresh-first-screen-synthea-lifetime-encrypted/first-screen",
            "value": 1.658273,
            "range": "1.627785-1.674039",
            "unit": "s",
            "extra": "Asking the questions the first screen shows. | unprobed, median of 3 runs, each in a process of its own; dataset=synthea-lifetime sha256=f20b86408066ece2d25a7b02d380b7652f22d16df9dab613a0c73c9969b17da8 records=16833 encrypted"
          },
          {
            "name": "fresh-first-screen-synthea-lifetime-encrypted/peak-rss",
            "value": 2427166720,
            "range": "2426474496-2464292864",
            "unit": "By",
            "extra": "The most memory the process held at any moment, in bytes. | the most the process reached, as the operating system keeps it; unprobed, median of 3 runs, each in a process of its own; dataset=synthea-lifetime sha256=f20b86408066ece2d25a7b02d380b7652f22d16df9dab613a0c73c9969b17da8 records=16833 encrypted"
          },
          {
            "name": "fresh-first-screen-synthea-lifetime/stage/core-pod.step.perform",
            "value": 21.166156,
            "range": "21.166156-21.166156",
            "unit": "s",
            "extra": "Doing the work of one import step: taking in the new records. Sits inside scenario.import. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 3 calls whose own times sum to 21.166156 s (more than the time in progress where calls overlap); core-pod.step.perform"
          },
          {
            "name": "fresh-first-screen-synthea-lifetime/stage/arrivals.fileexport",
            "value": 19.28712,
            "range": "19.287120-19.287120",
            "unit": "s",
            "extra": "Taking in every document of the record: converting each, working out its records and writing them to the pod. Sits inside core-pod.step.perform. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 19.287120 s (more than the time in progress where calls overlap); arrivals.fileExport"
          },
          {
            "name": "fresh-first-screen-synthea-lifetime/stage/pod.match",
            "value": 13.40839,
            "range": "13.408390-13.408390",
            "unit": "s",
            "extra": "Judging which records in the pod are the same thing recorded twice. Sits inside scenario.import. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 13.408390 s (more than the time in progress where calls overlap); pod.match"
          },
          {
            "name": "fresh-first-screen-synthea-lifetime/stage/arrivals.convert",
            "value": 12.992105,
            "range": "12.992105-12.992105",
            "unit": "s",
            "extra": "Converting the source record into the pod's own format with the adapter. Sits inside scenario.import. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 12.992105 s (more than the time in progress where calls overlap); arrivals.convert"
          },
          {
            "name": "fresh-first-screen-synthea-lifetime/stage/core-pod.step.rebuild-import",
            "value": 11.937537,
            "range": "11.937537-11.937537",
            "unit": "s",
            "extra": "Re-deriving what the imported records change. Sits inside scenario.import. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 11.937537 s (more than the time in progress where calls overlap); core-pod.step.rebuild:import"
          },
          {
            "name": "fresh-first-screen-synthea-lifetime/stage/kept.step",
            "value": 9.369215,
            "range": "9.369215-9.369215",
            "unit": "s",
            "extra": "Keeping the saved answers current after one step. Sits inside core-pod.step.keptafter. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 2 calls whose own times sum to 9.369215 s (more than the time in progress where calls overlap); kept.step"
          },
          {
            "name": "fresh-first-screen-synthea-lifetime-encrypted/stage/core-pod.step.perform",
            "value": 21.123434,
            "range": "21.123434-21.123434",
            "unit": "s",
            "extra": "Doing the work of one import step: taking in the new records. Sits inside scenario.import. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 3 calls whose own times sum to 21.123434 s (more than the time in progress where calls overlap); core-pod.step.perform"
          },
          {
            "name": "fresh-first-screen-synthea-lifetime-encrypted/stage/arrivals.fileexport",
            "value": 19.244718,
            "range": "19.244718-19.244718",
            "unit": "s",
            "extra": "Taking in every document of the record: converting each, working out its records and writing them to the pod. Sits inside core-pod.step.perform. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 19.244718 s (more than the time in progress where calls overlap); arrivals.fileExport"
          },
          {
            "name": "fresh-first-screen-synthea-lifetime-encrypted/stage/pod.match",
            "value": 14.068111,
            "range": "14.068111-14.068111",
            "unit": "s",
            "extra": "Judging which records in the pod are the same thing recorded twice. Sits inside scenario.import. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 14.068111 s (more than the time in progress where calls overlap); pod.match"
          },
          {
            "name": "fresh-first-screen-synthea-lifetime-encrypted/stage/arrivals.convert",
            "value": 12.953947,
            "range": "12.953947-12.953947",
            "unit": "s",
            "extra": "Converting the source record into the pod's own format with the adapter. Sits inside scenario.import. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 12.953947 s (more than the time in progress where calls overlap); arrivals.convert"
          },
          {
            "name": "fresh-first-screen-synthea-lifetime-encrypted/stage/core-pod.step.rebuild-import",
            "value": 12.449739,
            "range": "12.449739-12.449739",
            "unit": "s",
            "extra": "Re-deriving what the imported records change. Sits inside scenario.import. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 12.449739 s (more than the time in progress where calls overlap); core-pod.step.rebuild:import"
          },
          {
            "name": "fresh-first-screen-synthea-lifetime-encrypted/stage/kept.step",
            "value": 9.67742,
            "range": "9.677420-9.677420",
            "unit": "s",
            "extra": "Keeping the saved answers current after one step. Sits inside core-pod.step.keptafter. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 2 calls whose own times sum to 9.677420 s (more than the time in progress where calls overlap); kept.step"
          },
          {
            "name": "fresh-first-screen-synthea-lifetime/self/store.query",
            "value": 5.478095,
            "range": "5.478095-5.478095",
            "unit": "s",
            "extra": "Questions put to the pod's fact store, many of them: the time one or more of them was in progress. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 465 calls; store.query"
          },
          {
            "name": "fresh-first-screen-synthea-lifetime/self/core-pod.step.commit",
            "value": 4.595055,
            "range": "4.595055-4.595055",
            "unit": "s",
            "extra": "Writing the step's results to the pod's files and recording that it happened. Sits inside scenario.import. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 3 calls; core-pod.step.commit"
          },
          {
            "name": "fresh-first-screen-synthea-lifetime/self/bridge.stage-mapping",
            "value": 3.591007,
            "range": "3.591007-3.591007",
            "unit": "s",
            "extra": "The Bridge runs the adapter's mappings over the source record's facts to produce the pod's facts. Sits inside arrivals.convert. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 1 calls; bridge.stage:mapping"
          },
          {
            "name": "fresh-first-screen-synthea-lifetime/self/bridge.stage-lift",
            "value": 3.107522,
            "range": "3.107522-3.107522",
            "unit": "s",
            "extra": "The Bridge lifts the source record into facts. Sits inside arrivals.convert. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 1 calls; bridge.stage:lift"
          },
          {
            "name": "fresh-first-screen-synthea-lifetime/self/files.write.file",
            "value": 2.558232,
            "range": "2.558232-2.558232",
            "unit": "s",
            "extra": "Writing one file into the pod's folder. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 27248 calls; files.write.file"
          },
          {
            "name": "fresh-first-screen-synthea-lifetime/self/arrivals.accepting",
            "value": 2.388722,
            "range": "2.388722-2.388722",
            "unit": "s",
            "extra": "Finding which adapter accepts this document. Sits inside scenario.import. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 1 calls; arrivals.accepting"
          },
          {
            "name": "fresh-first-screen-synthea-lifetime-encrypted/self/store.query",
            "value": 5.407785,
            "range": "5.407785-5.407785",
            "unit": "s",
            "extra": "Questions put to the pod's fact store, many of them: the time one or more of them was in progress. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 465 calls; store.query"
          },
          {
            "name": "fresh-first-screen-synthea-lifetime-encrypted/self/bridge.stage-mapping",
            "value": 3.560454,
            "range": "3.560454-3.560454",
            "unit": "s",
            "extra": "The Bridge runs the adapter's mappings over the source record's facts to produce the pod's facts. Sits inside arrivals.convert. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 1 calls; bridge.stage:mapping"
          },
          {
            "name": "fresh-first-screen-synthea-lifetime-encrypted/self/bridge.stage-lift",
            "value": 3.116407,
            "range": "3.116407-3.116407",
            "unit": "s",
            "extra": "The Bridge lifts the source record into facts. Sits inside arrivals.convert. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 1 calls; bridge.stage:lift"
          },
          {
            "name": "fresh-first-screen-synthea-lifetime-encrypted/self/core-pod.step.commit",
            "value": 2.838799,
            "range": "2.838799-2.838799",
            "unit": "s",
            "extra": "Writing the step's results to the pod's files and recording that it happened. Sits inside scenario.import. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 3 calls; core-pod.step.commit"
          },
          {
            "name": "fresh-first-screen-synthea-lifetime-encrypted/self/files.write.file",
            "value": 2.621549,
            "range": "2.621549-2.621549",
            "unit": "s",
            "extra": "Writing one file into the pod's folder. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 27257 calls; files.write.file"
          },
          {
            "name": "fresh-first-screen-synthea-lifetime-encrypted/self/arrivals.accepting",
            "value": 2.486349,
            "range": "2.486349-2.486349",
            "unit": "s",
            "extra": "Finding which adapter accepts this document. Sits inside scenario.import. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 1 calls; arrivals.accepting"
          }
        ]
      },
      {
        "commit": {
          "author": {
            "email": "jayostis@gmail.com",
            "name": "jayostis",
            "username": "jayostis"
          },
          "committer": {
            "email": "noreply@github.com",
            "name": "GitHub",
            "username": "web-flow"
          },
          "distinct": true,
          "id": "47ec89a05b53f3e7cc5d968d22763a3374f6db69",
          "message": "Merge pull request #928 from jayostis/feat/concurrent-file-writes\n\nperf(files): write the files of a wave of a step several at once, waves still in W1 order",
          "timestamp": "2026-11-20T01:28:34-08:00",
          "tree_id": "34a1d64709a14c4c330760506e5aa6c9772f3aca",
          "url": "https://github.com/jayostis/cascade-runtime-js/commit/47ec89a05b53f3e7cc5d968d22763a3374f6db69"
        },
        "date": 1795166992831,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "fresh-first-screen-synthea-10y/total",
            "value": 3.097725,
            "range": "3.021659-3.124836",
            "unit": "s",
            "extra": "Opening a new pod, importing the whole record and asking the first screen's questions: what a person waits for the first time. | open + import + first screen; unprobed, median of 3 runs, each in a process of its own; dataset=synthea-10y sha256=2703dc1e7e920fa1e45d16c58f8338ef13b3cc1916ee40ffa461112d54dce5de records=647"
          },
          {
            "name": "fresh-first-screen-synthea-10y/open",
            "value": 0.221397,
            "range": "0.215703-0.224000",
            "unit": "s",
            "extra": "Opening the pod. | unprobed, median of 3 runs, each in a process of its own; dataset=synthea-10y sha256=2703dc1e7e920fa1e45d16c58f8338ef13b3cc1916ee40ffa461112d54dce5de records=647"
          },
          {
            "name": "fresh-first-screen-synthea-10y/import",
            "value": 2.791212,
            "range": "2.725619-2.816853",
            "unit": "s",
            "extra": "Importing the whole record into the pod. | unprobed, median of 3 runs, each in a process of its own; dataset=synthea-10y sha256=2703dc1e7e920fa1e45d16c58f8338ef13b3cc1916ee40ffa461112d54dce5de records=647"
          },
          {
            "name": "fresh-first-screen-synthea-10y/first-screen",
            "value": 0.083983,
            "range": "0.080337-0.085116",
            "unit": "s",
            "extra": "Asking the questions the first screen shows. | unprobed, median of 3 runs, each in a process of its own; dataset=synthea-10y sha256=2703dc1e7e920fa1e45d16c58f8338ef13b3cc1916ee40ffa461112d54dce5de records=647"
          },
          {
            "name": "fresh-first-screen-synthea-10y/peak-rss",
            "value": 536879104,
            "range": "522100736-566374400",
            "unit": "By",
            "extra": "The most memory the process held at any moment, in bytes. | the most the process reached, as the operating system keeps it; unprobed, median of 3 runs, each in a process of its own; dataset=synthea-10y sha256=2703dc1e7e920fa1e45d16c58f8338ef13b3cc1916ee40ffa461112d54dce5de records=647"
          },
          {
            "name": "close-synthea-10y/total",
            "value": 0.436705,
            "range": "0.418250-0.833404",
            "unit": "s",
            "extra": "Closing a pod straight after its import and first screen, which saves its database. | closing a pod right after its import and first screen; unprobed, median of 3 runs, each in a process of its own; dataset=synthea-10y sha256=2703dc1e7e920fa1e45d16c58f8338ef13b3cc1916ee40ffa461112d54dce5de records=647"
          },
          {
            "name": "reopen-first-answer-synthea-10y/total",
            "value": 0.170226,
            "range": "0.169237-0.171732",
            "unit": "s",
            "extra": "Opening an existing pod and answering its first read: what a returning person waits for. | open + first read; unprobed, median of 3 runs, each in a process of its own; dataset=synthea-10y sha256=2703dc1e7e920fa1e45d16c58f8338ef13b3cc1916ee40ffa461112d54dce5de records=647"
          },
          {
            "name": "reopen-first-answer-synthea-10y/open",
            "value": 0.136131,
            "range": "0.134912-0.138039",
            "unit": "s",
            "extra": "Opening the pod. | unprobed, median of 3 runs, each in a process of its own; dataset=synthea-10y sha256=2703dc1e7e920fa1e45d16c58f8338ef13b3cc1916ee40ffa461112d54dce5de records=647"
          },
          {
            "name": "reopen-first-answer-synthea-10y/first-read",
            "value": 0.034096,
            "range": "0.033693-0.034325",
            "unit": "s",
            "extra": "The first question asked of the reopened pod ('My active conditions'). | pod/My active conditions; unprobed, median of 3 runs, each in a process of its own; dataset=synthea-10y sha256=2703dc1e7e920fa1e45d16c58f8338ef13b3cc1916ee40ffa461112d54dce5de records=647"
          },
          {
            "name": "reopen-first-answer-synthea-10y/second-read",
            "value": 0.000699,
            "range": "0.000697-0.000702",
            "unit": "s",
            "extra": "A second question asked of the reopened pod ('My active medications'). | pod/My active medications; unprobed, median of 3 runs, each in a process of its own; dataset=synthea-10y sha256=2703dc1e7e920fa1e45d16c58f8338ef13b3cc1916ee40ffa461112d54dce5de records=647"
          },
          {
            "name": "reopen-first-answer-synthea-10y/close",
            "value": 0.000508,
            "range": "0.000507-0.000571",
            "unit": "s",
            "extra": "Closing the pod, saving its database. | unprobed, median of 3 runs, each in a process of its own; dataset=synthea-10y sha256=2703dc1e7e920fa1e45d16c58f8338ef13b3cc1916ee40ffa461112d54dce5de records=647"
          },
          {
            "name": "reopen-first-answer-synthea-10y/peak-rss",
            "value": 155947008,
            "range": "155934720-155975680",
            "unit": "By",
            "extra": "The most memory the process held at any moment, in bytes. | unprobed, median of 3 runs, each in a process of its own; dataset=synthea-10y sha256=2703dc1e7e920fa1e45d16c58f8338ef13b3cc1916ee40ffa461112d54dce5de records=647"
          },
          {
            "name": "question-page-synthea-10y/total",
            "value": 0.023387,
            "range": "0.022718-0.024195",
            "unit": "s",
            "extra": "Fetching one page of answers for every question in turn. | 16 questions, a page of 20 each, from pod.db; unprobed, median of 3 runs, each in a process of its own; dataset=synthea-10y sha256=2703dc1e7e920fa1e45d16c58f8338ef13b3cc1916ee40ffa461112d54dce5de records=647"
          },
          {
            "name": "question-page-synthea-10y/peak-rss",
            "value": 156020736,
            "range": "156000256-156033024",
            "unit": "By",
            "extra": "The most memory the process held at any moment, in bytes. | unprobed, median of 3 runs, each in a process of its own; dataset=synthea-10y sha256=2703dc1e7e920fa1e45d16c58f8338ef13b3cc1916ee40ffa461112d54dce5de records=647"
          },
          {
            "name": "fresh-first-screen-synthea-10y/stage/core-pod.step.perform",
            "value": 2.024949,
            "range": "2.024949-2.024949",
            "unit": "s",
            "extra": "Doing the work of one import step: taking in the new records. Sits inside scenario.import. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 3 calls whose own times sum to 2.024949 s (more than the time in progress where calls overlap); core-pod.step.perform"
          },
          {
            "name": "fresh-first-screen-synthea-10y/stage/arrivals.fileexport",
            "value": 1.591205,
            "range": "1.591205-1.591205",
            "unit": "s",
            "extra": "Taking in every document of the record: converting each, working out its records and writing them to the pod. Sits inside core-pod.step.perform. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 1.591205 s (more than the time in progress where calls overlap); arrivals.fileExport"
          },
          {
            "name": "fresh-first-screen-synthea-10y/stage/arrivals.convert",
            "value": 0.641041,
            "range": "0.641041-0.641041",
            "unit": "s",
            "extra": "Converting the source record into the pod's own format with the adapter. Sits inside scenario.import. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 0.641041 s (more than the time in progress where calls overlap); arrivals.convert"
          },
          {
            "name": "fresh-first-screen-synthea-10y/stage/arrivals.accepting",
            "value": 0.63393,
            "range": "0.633930-0.633930",
            "unit": "s",
            "extra": "Finding which adapter accepts this document. Sits inside scenario.import. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 0.633930 s (more than the time in progress where calls overlap); arrivals.accepting"
          },
          {
            "name": "fresh-first-screen-synthea-10y/stage/pod.match",
            "value": 0.509783,
            "range": "0.509783-0.509783",
            "unit": "s",
            "extra": "Judging which records in the pod are the same thing recorded twice. Sits inside scenario.import. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 0.509783 s (more than the time in progress where calls overlap); pod.match"
          },
          {
            "name": "fresh-first-screen-synthea-10y/stage/core-pod.step.rebuild-import",
            "value": 0.467656,
            "range": "0.467656-0.467656",
            "unit": "s",
            "extra": "Re-deriving what the imported records change. Sits inside scenario.import. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 0.467656 s (more than the time in progress where calls overlap); core-pod.step.rebuild:import"
          },
          {
            "name": "close-synthea-10y/stage/core-pod.keepdatabase",
            "value": 0.337913,
            "range": "0.337913-0.337913",
            "unit": "s",
            "extra": "Saving the pod's database so the next opening is fast. Sits inside scenario.close. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 0.337913 s (more than the time in progress where calls overlap); core-pod.keepDatabase"
          },
          {
            "name": "close-synthea-10y/stage/core-pod.keepdatabase.whole",
            "value": 0.310692,
            "range": "0.310692-0.310692",
            "unit": "s",
            "extra": "Saving the database whole, from the pod's current facts. Sits inside core-pod.keepdatabase. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 0.310692 s (more than the time in progress where calls overlap); core-pod.keepDatabase.whole"
          },
          {
            "name": "close-synthea-10y/stage/pod-database.build.worker",
            "value": 0.279033,
            "range": "0.279033-0.279033",
            "unit": "s",
            "extra": "Starting the helper that builds the saved database. Sits inside core-pod.keepdatabase. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 0.279033 s (more than the time in progress where calls overlap); pod-database.build.worker"
          },
          {
            "name": "close-synthea-10y/stage/pod-database.build.load",
            "value": 0.116993,
            "range": "0.116993-0.116993",
            "unit": "s",
            "extra": "Loading the pod's facts into the saved database. Sits inside core-pod.keepdatabase. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 0.116993 s (more than the time in progress where calls overlap); pod-database.build.load"
          },
          {
            "name": "close-synthea-10y/stage/core-pod.keepbuild",
            "value": 0.062031,
            "range": "0.062031-0.062031",
            "unit": "s",
            "extra": "Preparing the content of the saved database. Sits inside core-pod.keepdatabase. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 0.062031 s (more than the time in progress where calls overlap); core-pod.keepBuild"
          },
          {
            "name": "close-synthea-10y/stage/core-pod.keepbuild.dump",
            "value": 0.045482,
            "range": "0.045482-0.045482",
            "unit": "s",
            "extra": "Gathering the pod's facts to put in the saved database. Sits inside core-pod.keepbuild. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 0.045482 s (more than the time in progress where calls overlap); core-pod.keepBuild.dump"
          },
          {
            "name": "reopen-first-answer-synthea-10y/stage/files.read.file",
            "value": 0.073578,
            "range": "0.073578-0.073578",
            "unit": "s",
            "extra": "Reading one file from the pod's folder. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 160 calls whose own times sum to 0.373895 s (more than the time in progress where calls overlap); files.read.file"
          },
          {
            "name": "reopen-first-answer-synthea-10y/stage/question-pod-my-active-conditions",
            "value": 0.036182,
            "range": "0.036182-0.036182",
            "unit": "s",
            "extra": "The answer to: pod my active conditions. Sits inside scenario.first-read or scenario.second-read. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 0.036182 s (more than the time in progress where calls overlap); question:pod/My active conditions"
          },
          {
            "name": "reopen-first-answer-synthea-10y/stage/core-pod.databaseanswers",
            "value": 0.027356,
            "range": "0.027356-0.027356",
            "unit": "s",
            "extra": "Checking whether the saved database holds the pod as it stands now, so it can answer in place of a rebuild. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 0.027356 s (more than the time in progress where calls overlap); core-pod.databaseAnswers"
          },
          {
            "name": "reopen-first-answer-synthea-10y/stage/core-pod.inputshash",
            "value": 0.019614,
            "range": "0.019614-0.019614",
            "unit": "s",
            "extra": "Working out a fingerprint of everything a result depends on, to know when it can be reused. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 0.019614 s (more than the time in progress where calls overlap); core-pod.inputsHash"
          },
          {
            "name": "reopen-first-answer-synthea-10y/stage/union.select",
            "value": 0.014974,
            "range": "0.014974-0.014974",
            "unit": "s",
            "extra": "Asking the in-memory facts a question that returns rows. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 0.014974 s (more than the time in progress where calls overlap); union.select"
          },
          {
            "name": "reopen-first-answer-synthea-10y/stage/store.query",
            "value": 0.014278,
            "range": "0.014278-0.014278",
            "unit": "s",
            "extra": "Questions put to the pod's fact store, many of them: the time one or more of them was in progress. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 0.014278 s (more than the time in progress where calls overlap); store.query"
          },
          {
            "name": "question-page-synthea-10y/stage/question.page-pod-what-each-import-brought-in",
            "value": 0.008556,
            "range": "0.008556-0.008556",
            "unit": "s",
            "extra": "One page of the answer to: pod what each import brought in. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 0.008556 s (more than the time in progress where calls overlap); question.page:pod/What each import brought in"
          },
          {
            "name": "question-page-synthea-10y/stage/question.page-pod-what-everything-is-called",
            "value": 0.006124,
            "range": "0.006124-0.006124",
            "unit": "s",
            "extra": "One page of the answer to: pod what everything is called. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 0.006124 s (more than the time in progress where calls overlap); question.page:pod/What everything is called"
          },
          {
            "name": "question-page-synthea-10y/stage/question.page-profile-what-needs-review",
            "value": 0.002915,
            "range": "0.002915-0.002915",
            "unit": "s",
            "extra": "One page of the answer to: profile what needs review. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 0.002915 s (more than the time in progress where calls overlap); question.page:profile/What needs review"
          },
          {
            "name": "question-page-synthea-10y/stage/question.page-pod-how-many-of-each-kind",
            "value": 0.001417,
            "range": "0.001417-0.001417",
            "unit": "s",
            "extra": "One page of the answer to: pod how many of each kind. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 0.001417 s (more than the time in progress where calls overlap); question.page:pod/How many of each kind"
          },
          {
            "name": "question-page-synthea-10y/stage/question.page-pod-the-person-this-pod-is-about",
            "value": 0.000844,
            "range": "0.000844-0.000844",
            "unit": "s",
            "extra": "One page of the answer to: pod the person this pod is about. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 0.000844 s (more than the time in progress where calls overlap); question.page:pod/The person this pod is about"
          },
          {
            "name": "question-page-synthea-10y/stage/question.page-pod-my-reports-notes-and-documents",
            "value": 0.000743,
            "range": "0.000743-0.000743",
            "unit": "s",
            "extra": "One page of the answer to: pod my reports notes and documents. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 0.000743 s (more than the time in progress where calls overlap); question.page:pod/My reports, notes and documents"
          },
          {
            "name": "fresh-first-screen-synthea-10y/self/arrivals.accepting",
            "value": 0.629586,
            "range": "0.629586-0.629586",
            "unit": "s",
            "extra": "Finding which adapter accepts this document. Sits inside scenario.import. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 1 calls; arrivals.accepting"
          },
          {
            "name": "fresh-first-screen-synthea-10y/self/core-pod.import.adapters",
            "value": 0.398609,
            "range": "0.398609-0.398609",
            "unit": "s",
            "extra": "Reading the adapter that knows how to convert this kind of record. Sits inside scenario.import. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 1 calls; core-pod.import.adapters"
          },
          {
            "name": "fresh-first-screen-synthea-10y/self/bridge.stage-records",
            "value": 0.32125,
            "range": "0.321250-0.321250",
            "unit": "s",
            "extra": "The Bridge makes the pod's records, with their versions, from what its mappings produced. Sits inside arrivals.convert. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 1 calls; bridge.stage:records"
          },
          {
            "name": "fresh-first-screen-synthea-10y/self/store.query",
            "value": 0.319811,
            "range": "0.319811-0.319811",
            "unit": "s",
            "extra": "Questions put to the pod's fact store, many of them: the time one or more of them was in progress. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 154 calls; store.query"
          },
          {
            "name": "fresh-first-screen-synthea-10y/self/bridge.stage-mapping",
            "value": 0.144709,
            "range": "0.144709-0.144709",
            "unit": "s",
            "extra": "The Bridge runs the adapter's mappings over the source record's facts to produce the pod's facts. Sits inside arrivals.convert. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 1 calls; bridge.stage:mapping"
          },
          {
            "name": "fresh-first-screen-synthea-10y/self/files.write.file",
            "value": 0.128981,
            "range": "0.128981-0.128981",
            "unit": "s",
            "extra": "Writing one file into the pod's folder. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 1752 calls; files.write.file"
          },
          {
            "name": "close-synthea-10y/self/pod-database.build.worker",
            "value": 0.123012,
            "range": "0.123012-0.123012",
            "unit": "s",
            "extra": "Starting the helper that builds the saved database. Sits inside core-pod.keepdatabase. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 1 calls; pod-database.build.worker"
          },
          {
            "name": "close-synthea-10y/self/pod-database.build.load",
            "value": 0.116993,
            "range": "0.116993-0.116993",
            "unit": "s",
            "extra": "Loading the pod's facts into the saved database. Sits inside core-pod.keepdatabase. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 1 calls; pod-database.build.load"
          },
          {
            "name": "close-synthea-10y/self/core-pod.keepbuild.dump",
            "value": 0.045482,
            "range": "0.045482-0.045482",
            "unit": "s",
            "extra": "Gathering the pod's facts to put in the saved database. Sits inside core-pod.keepbuild. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 1 calls; core-pod.keepBuild.dump"
          },
          {
            "name": "close-synthea-10y/self/core-pod.keepdatabase",
            "value": 0.025877,
            "range": "0.025877-0.025877",
            "unit": "s",
            "extra": "Saving the pod's database so the next opening is fast. Sits inside scenario.close. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 1 calls; core-pod.keepDatabase"
          },
          {
            "name": "close-synthea-10y/self/pod-database.build.screens-fill",
            "value": 0.022813,
            "range": "0.022813-0.022813",
            "unit": "s",
            "extra": "Filling in the database's ready-made answer tables. Sits inside core-pod.keepdatabase. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 1 calls; pod-database.build.screens:fill"
          },
          {
            "name": "close-synthea-10y/self/pod-database.build.sync",
            "value": 0.0161,
            "range": "0.016100-0.016100",
            "unit": "s",
            "extra": "Making the saved database safely written to disk. Sits inside core-pod.keepdatabase. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 1 calls; pod-database.build.sync"
          },
          {
            "name": "reopen-first-answer-synthea-10y/self/files.read.file",
            "value": 0.073578,
            "range": "0.073578-0.073578",
            "unit": "s",
            "extra": "Reading one file from the pod's folder. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 160 calls; files.read.file"
          },
          {
            "name": "reopen-first-answer-synthea-10y/self/store.query",
            "value": 0.014278,
            "range": "0.014278-0.014278",
            "unit": "s",
            "extra": "Questions put to the pod's fact store, many of them: the time one or more of them was in progress. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 1 calls; store.query"
          },
          {
            "name": "reopen-first-answer-synthea-10y/self/union.loadturtle",
            "value": 0.013529,
            "range": "0.013529-0.013529",
            "unit": "s",
            "extra": "Loading text-format facts into memory. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 1 calls; union.loadTurtle"
          },
          {
            "name": "reopen-first-answer-synthea-10y/self/files.hash.sha256",
            "value": 0.010717,
            "range": "0.010717-0.010717",
            "unit": "s",
            "extra": "Fingerprinting a file's content to tell whether it changed. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 20 calls; files.hash.sha256"
          },
          {
            "name": "reopen-first-answer-synthea-10y/self/question-pod-my-active-conditions",
            "value": 0.004192,
            "range": "0.004192-0.004192",
            "unit": "s",
            "extra": "The answer to: pod my active conditions. Sits inside scenario.first-read or scenario.second-read. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 1 calls; question:pod/My active conditions"
          },
          {
            "name": "reopen-first-answer-synthea-10y/self/core-pod.inputshash",
            "value": 0.001382,
            "range": "0.001382-0.001382",
            "unit": "s",
            "extra": "Working out a fingerprint of everything a result depends on, to know when it can be reused. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 1 calls; core-pod.inputsHash"
          },
          {
            "name": "question-page-synthea-10y/self/question.page-pod-what-each-import-brought-in",
            "value": 0.008556,
            "range": "0.008556-0.008556",
            "unit": "s",
            "extra": "One page of the answer to: pod what each import brought in. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 1 calls; question.page:pod/What each import brought in"
          },
          {
            "name": "question-page-synthea-10y/self/question.page-pod-what-everything-is-called",
            "value": 0.006124,
            "range": "0.006124-0.006124",
            "unit": "s",
            "extra": "One page of the answer to: pod what everything is called. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 1 calls; question.page:pod/What everything is called"
          },
          {
            "name": "question-page-synthea-10y/self/question.page-profile-what-needs-review",
            "value": 0.002915,
            "range": "0.002915-0.002915",
            "unit": "s",
            "extra": "One page of the answer to: profile what needs review. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 1 calls; question.page:profile/What needs review"
          },
          {
            "name": "question-page-synthea-10y/self/question.page-pod-how-many-of-each-kind",
            "value": 0.001417,
            "range": "0.001417-0.001417",
            "unit": "s",
            "extra": "One page of the answer to: pod how many of each kind. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 1 calls; question.page:pod/How many of each kind"
          },
          {
            "name": "question-page-synthea-10y/self/question.page-pod-the-person-this-pod-is-about",
            "value": 0.000844,
            "range": "0.000844-0.000844",
            "unit": "s",
            "extra": "One page of the answer to: pod the person this pod is about. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 1 calls; question.page:pod/The person this pod is about"
          },
          {
            "name": "question-page-synthea-10y/self/question.page-pod-my-reports-notes-and-documents",
            "value": 0.000743,
            "range": "0.000743-0.000743",
            "unit": "s",
            "extra": "One page of the answer to: pod my reports notes and documents. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 1 calls; question.page:pod/My reports, notes and documents"
          }
        ]
      },
      {
        "commit": {
          "author": {
            "name": "jayostis",
            "username": "jayostis",
            "email": "jayostis@gmail.com"
          },
          "committer": {
            "name": "GitHub",
            "username": "web-flow",
            "email": "noreply@github.com"
          },
          "id": "47ec89a05b53f3e7cc5d968d22763a3374f6db69",
          "message": "Merge pull request #928 from jayostis/feat/concurrent-file-writes\n\nperf(files): write the files of a wave of a step several at once, waves still in W1 order",
          "timestamp": "2026-11-20T09:28:34Z",
          "url": "https://github.com/jayostis/cascade-runtime-js/commit/47ec89a05b53f3e7cc5d968d22763a3374f6db69"
        },
        "date": 1795167975390,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "fresh-first-screen-synthea-lifetime/total",
            "value": 46.733375,
            "range": "46.631222-46.790929",
            "unit": "s",
            "extra": "Opening a new pod, importing the whole record and asking the first screen's questions: what a person waits for the first time. | open + import + first screen; unprobed, median of 3 runs, each in a process of its own; dataset=synthea-lifetime sha256=f20b86408066ece2d25a7b02d380b7652f22d16df9dab613a0c73c9969b17da8 records=16833"
          },
          {
            "name": "fresh-first-screen-synthea-lifetime/open",
            "value": 0.350802,
            "range": "0.342545-0.385676",
            "unit": "s",
            "extra": "Opening the pod. | unprobed, median of 3 runs, each in a process of its own; dataset=synthea-lifetime sha256=f20b86408066ece2d25a7b02d380b7652f22d16df9dab613a0c73c9969b17da8 records=16833"
          },
          {
            "name": "fresh-first-screen-synthea-lifetime/import",
            "value": 44.459382,
            "range": "44.318991-44.588844",
            "unit": "s",
            "extra": "Importing the whole record into the pod. | unprobed, median of 3 runs, each in a process of its own; dataset=synthea-lifetime sha256=f20b86408066ece2d25a7b02d380b7652f22d16df9dab613a0c73c9969b17da8 records=16833"
          },
          {
            "name": "fresh-first-screen-synthea-lifetime/first-screen",
            "value": 1.926556,
            "range": "1.793729-1.989002",
            "unit": "s",
            "extra": "Asking the questions the first screen shows. | unprobed, median of 3 runs, each in a process of its own; dataset=synthea-lifetime sha256=f20b86408066ece2d25a7b02d380b7652f22d16df9dab613a0c73c9969b17da8 records=16833"
          },
          {
            "name": "fresh-first-screen-synthea-lifetime/peak-rss",
            "value": 2023952384,
            "range": "1994862592-2033381376",
            "unit": "By",
            "extra": "The most memory the process held at any moment, in bytes. | the most the process reached, as the operating system keeps it; unprobed, median of 3 runs, each in a process of its own; dataset=synthea-lifetime sha256=f20b86408066ece2d25a7b02d380b7652f22d16df9dab613a0c73c9969b17da8 records=16833"
          },
          {
            "name": "fresh-first-screen-synthea-lifetime-encrypted/total",
            "value": 47.8207,
            "range": "47.703035-47.881140",
            "unit": "s",
            "extra": "Opening a new pod, importing the whole record and asking the first screen's questions: what a person waits for the first time. | open + import + first screen; unprobed, median of 3 runs, each in a process of its own; dataset=synthea-lifetime sha256=f20b86408066ece2d25a7b02d380b7652f22d16df9dab613a0c73c9969b17da8 records=16833 encrypted"
          },
          {
            "name": "fresh-first-screen-synthea-lifetime-encrypted/open",
            "value": 0.824685,
            "range": "0.778135-0.824794",
            "unit": "s",
            "extra": "Opening the pod. | unprobed, median of 3 runs, each in a process of its own; dataset=synthea-lifetime sha256=f20b86408066ece2d25a7b02d380b7652f22d16df9dab613a0c73c9969b17da8 records=16833 encrypted"
          },
          {
            "name": "fresh-first-screen-synthea-lifetime-encrypted/import",
            "value": 45.198161,
            "range": "45.068371-45.206365",
            "unit": "s",
            "extra": "Importing the whole record into the pod. | unprobed, median of 3 runs, each in a process of its own; dataset=synthea-lifetime sha256=f20b86408066ece2d25a7b02d380b7652f22d16df9dab613a0c73c9969b17da8 records=16833 encrypted"
          },
          {
            "name": "fresh-first-screen-synthea-lifetime-encrypted/first-screen",
            "value": 1.856528,
            "range": "1.789542-1.858294",
            "unit": "s",
            "extra": "Asking the questions the first screen shows. | unprobed, median of 3 runs, each in a process of its own; dataset=synthea-lifetime sha256=f20b86408066ece2d25a7b02d380b7652f22d16df9dab613a0c73c9969b17da8 records=16833 encrypted"
          },
          {
            "name": "fresh-first-screen-synthea-lifetime-encrypted/peak-rss",
            "value": 2421030912,
            "range": "2396762112-2468356096",
            "unit": "By",
            "extra": "The most memory the process held at any moment, in bytes. | the most the process reached, as the operating system keeps it; unprobed, median of 3 runs, each in a process of its own; dataset=synthea-lifetime sha256=f20b86408066ece2d25a7b02d380b7652f22d16df9dab613a0c73c9969b17da8 records=16833 encrypted"
          },
          {
            "name": "fresh-first-screen-synthea-lifetime/stage/core-pod.step.perform",
            "value": 24.91831,
            "range": "24.918310-24.918310",
            "unit": "s",
            "extra": "Doing the work of one import step: taking in the new records. Sits inside scenario.import. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 3 calls whose own times sum to 24.918310 s (more than the time in progress where calls overlap); core-pod.step.perform"
          },
          {
            "name": "fresh-first-screen-synthea-lifetime/stage/arrivals.fileexport",
            "value": 22.878698,
            "range": "22.878698-22.878698",
            "unit": "s",
            "extra": "Taking in every document of the record: converting each, working out its records and writing them to the pod. Sits inside core-pod.step.perform. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 22.878698 s (more than the time in progress where calls overlap); arrivals.fileExport"
          },
          {
            "name": "fresh-first-screen-synthea-lifetime/stage/arrivals.convert",
            "value": 15.562815,
            "range": "15.562815-15.562815",
            "unit": "s",
            "extra": "Converting the source record into the pod's own format with the adapter. Sits inside scenario.import. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 15.562815 s (more than the time in progress where calls overlap); arrivals.convert"
          },
          {
            "name": "fresh-first-screen-synthea-lifetime/stage/pod.match",
            "value": 14.593021,
            "range": "14.593021-14.593021",
            "unit": "s",
            "extra": "Judging which records in the pod are the same thing recorded twice. Sits inside scenario.import. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 14.593021 s (more than the time in progress where calls overlap); pod.match"
          },
          {
            "name": "fresh-first-screen-synthea-lifetime/stage/core-pod.step.rebuild-import",
            "value": 13.064156,
            "range": "13.064156-13.064156",
            "unit": "s",
            "extra": "Re-deriving what the imported records change. Sits inside scenario.import. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 13.064156 s (more than the time in progress where calls overlap); core-pod.step.rebuild:import"
          },
          {
            "name": "fresh-first-screen-synthea-lifetime/stage/kept.step",
            "value": 10.270592,
            "range": "10.270592-10.270592",
            "unit": "s",
            "extra": "Keeping the saved answers current after one step. Sits inside core-pod.step.keptafter. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 2 calls whose own times sum to 10.270592 s (more than the time in progress where calls overlap); kept.step"
          },
          {
            "name": "fresh-first-screen-synthea-lifetime-encrypted/stage/core-pod.step.perform",
            "value": 24.919425,
            "range": "24.919425-24.919425",
            "unit": "s",
            "extra": "Doing the work of one import step: taking in the new records. Sits inside scenario.import. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 3 calls whose own times sum to 24.919425 s (more than the time in progress where calls overlap); core-pod.step.perform"
          },
          {
            "name": "fresh-first-screen-synthea-lifetime-encrypted/stage/arrivals.fileexport",
            "value": 22.851657,
            "range": "22.851657-22.851657",
            "unit": "s",
            "extra": "Taking in every document of the record: converting each, working out its records and writing them to the pod. Sits inside core-pod.step.perform. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 22.851657 s (more than the time in progress where calls overlap); arrivals.fileExport"
          },
          {
            "name": "fresh-first-screen-synthea-lifetime-encrypted/stage/arrivals.convert",
            "value": 15.504632,
            "range": "15.504632-15.504632",
            "unit": "s",
            "extra": "Converting the source record into the pod's own format with the adapter. Sits inside scenario.import. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 15.504632 s (more than the time in progress where calls overlap); arrivals.convert"
          },
          {
            "name": "fresh-first-screen-synthea-lifetime-encrypted/stage/pod.match",
            "value": 15.093063,
            "range": "15.093063-15.093063",
            "unit": "s",
            "extra": "Judging which records in the pod are the same thing recorded twice. Sits inside scenario.import. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 15.093063 s (more than the time in progress where calls overlap); pod.match"
          },
          {
            "name": "fresh-first-screen-synthea-lifetime-encrypted/stage/core-pod.step.rebuild-import",
            "value": 13.376098,
            "range": "13.376098-13.376098",
            "unit": "s",
            "extra": "Re-deriving what the imported records change. Sits inside scenario.import. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 13.376098 s (more than the time in progress where calls overlap); core-pod.step.rebuild:import"
          },
          {
            "name": "fresh-first-screen-synthea-lifetime-encrypted/stage/kept.step",
            "value": 10.245253,
            "range": "10.245253-10.245253",
            "unit": "s",
            "extra": "Keeping the saved answers current after one step. Sits inside core-pod.step.keptafter. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 2 calls whose own times sum to 10.245253 s (more than the time in progress where calls overlap); kept.step"
          },
          {
            "name": "fresh-first-screen-synthea-lifetime/self/store.query",
            "value": 5.652683,
            "range": "5.652683-5.652683",
            "unit": "s",
            "extra": "Questions put to the pod's fact store, many of them: the time one or more of them was in progress. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 465 calls; store.query"
          },
          {
            "name": "fresh-first-screen-synthea-lifetime/self/bridge.stage-mapping",
            "value": 4.328609,
            "range": "4.328609-4.328609",
            "unit": "s",
            "extra": "The Bridge runs the adapter's mappings over the source record's facts to produce the pod's facts. Sits inside arrivals.convert. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 1 calls; bridge.stage:mapping"
          },
          {
            "name": "fresh-first-screen-synthea-lifetime/self/bridge.stage-lift",
            "value": 3.904075,
            "range": "3.904075-3.904075",
            "unit": "s",
            "extra": "The Bridge lifts the source record into facts. Sits inside arrivals.convert. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 1 calls; bridge.stage:lift"
          },
          {
            "name": "fresh-first-screen-synthea-lifetime/self/files.write.file",
            "value": 3.559132,
            "range": "3.559132-3.559132",
            "unit": "s",
            "extra": "Writing one file into the pod's folder. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 27248 calls; files.write.file"
          },
          {
            "name": "fresh-first-screen-synthea-lifetime/self/arrivals.accepting",
            "value": 2.987369,
            "range": "2.987369-2.987369",
            "unit": "s",
            "extra": "Finding which adapter accepts this document. Sits inside scenario.import. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 1 calls; arrivals.accepting"
          },
          {
            "name": "fresh-first-screen-synthea-lifetime/self/files.write.rename",
            "value": 2.725446,
            "range": "2.725446-2.725446",
            "unit": "s",
            "extra": "Moving a finished file into place, so a half-written file is never seen. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 27248 calls; files.write.rename"
          },
          {
            "name": "fresh-first-screen-synthea-lifetime-encrypted/self/store.query",
            "value": 5.682902,
            "range": "5.682902-5.682902",
            "unit": "s",
            "extra": "Questions put to the pod's fact store, many of them: the time one or more of them was in progress. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 465 calls; store.query"
          },
          {
            "name": "fresh-first-screen-synthea-lifetime-encrypted/self/bridge.stage-mapping",
            "value": 4.323688,
            "range": "4.323688-4.323688",
            "unit": "s",
            "extra": "The Bridge runs the adapter's mappings over the source record's facts to produce the pod's facts. Sits inside arrivals.convert. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 1 calls; bridge.stage:mapping"
          },
          {
            "name": "fresh-first-screen-synthea-lifetime-encrypted/self/bridge.stage-lift",
            "value": 3.875878,
            "range": "3.875878-3.875878",
            "unit": "s",
            "extra": "The Bridge lifts the source record into facts. Sits inside arrivals.convert. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 1 calls; bridge.stage:lift"
          },
          {
            "name": "fresh-first-screen-synthea-lifetime-encrypted/self/files.write.file",
            "value": 3.512432,
            "range": "3.512432-3.512432",
            "unit": "s",
            "extra": "Writing one file into the pod's folder. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 27257 calls; files.write.file"
          },
          {
            "name": "fresh-first-screen-synthea-lifetime-encrypted/self/arrivals.accepting",
            "value": 3.028074,
            "range": "3.028074-3.028074",
            "unit": "s",
            "extra": "Finding which adapter accepts this document. Sits inside scenario.import. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 1 calls; arrivals.accepting"
          },
          {
            "name": "fresh-first-screen-synthea-lifetime-encrypted/self/files.write.rename",
            "value": 2.814145,
            "range": "2.814145-2.814145",
            "unit": "s",
            "extra": "Moving a finished file into place, so a half-written file is never seen. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 27249 calls; files.write.rename"
          }
        ]
      },
      {
        "commit": {
          "author": {
            "email": "jayostis@gmail.com",
            "name": "jayostis",
            "username": "jayostis"
          },
          "committer": {
            "email": "noreply@github.com",
            "name": "GitHub",
            "username": "web-flow"
          },
          "distinct": true,
          "id": "d2afe9b9f888f123010bc3fd3db009fa2c312a25",
          "message": "Merge pull request #927 from jayostis/perf/item3-fixed-costs\n\nperf(runtime): item 3 fixed costs: no needless compaction, one ask before empty bound batches, adapters load together",
          "timestamp": "2026-11-20T01:48:10-08:00",
          "tree_id": "846a150ddc18e1d37b4f81aa3f6e4f52d01d8c45",
          "url": "https://github.com/jayostis/cascade-runtime-js/commit/d2afe9b9f888f123010bc3fd3db009fa2c312a25"
        },
        "date": 1795168176790,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "fresh-first-screen-synthea-10y/total",
            "value": 3.26418,
            "range": "3.256977-3.275760",
            "unit": "s",
            "extra": "Opening a new pod, importing the whole record and asking the first screen's questions: what a person waits for the first time. | open + import + first screen; unprobed, median of 3 runs, each in a process of its own; dataset=synthea-10y sha256=2703dc1e7e920fa1e45d16c58f8338ef13b3cc1916ee40ffa461112d54dce5de records=647"
          },
          {
            "name": "fresh-first-screen-synthea-10y/open",
            "value": 0.212844,
            "range": "0.212812-0.219605",
            "unit": "s",
            "extra": "Opening the pod. | unprobed, median of 3 runs, each in a process of its own; dataset=synthea-10y sha256=2703dc1e7e920fa1e45d16c58f8338ef13b3cc1916ee40ffa461112d54dce5de records=647"
          },
          {
            "name": "fresh-first-screen-synthea-10y/import",
            "value": 2.968102,
            "range": "2.956649-2.971797",
            "unit": "s",
            "extra": "Importing the whole record into the pod. | unprobed, median of 3 runs, each in a process of its own; dataset=synthea-10y sha256=2703dc1e7e920fa1e45d16c58f8338ef13b3cc1916ee40ffa461112d54dce5de records=647"
          },
          {
            "name": "fresh-first-screen-synthea-10y/first-screen",
            "value": 0.084359,
            "range": "0.083267-0.087484",
            "unit": "s",
            "extra": "Asking the questions the first screen shows. | unprobed, median of 3 runs, each in a process of its own; dataset=synthea-10y sha256=2703dc1e7e920fa1e45d16c58f8338ef13b3cc1916ee40ffa461112d54dce5de records=647"
          },
          {
            "name": "fresh-first-screen-synthea-10y/peak-rss",
            "value": 520241152,
            "range": "498106368-524754944",
            "unit": "By",
            "extra": "The most memory the process held at any moment, in bytes. | the most the process reached, as the operating system keeps it; unprobed, median of 3 runs, each in a process of its own; dataset=synthea-10y sha256=2703dc1e7e920fa1e45d16c58f8338ef13b3cc1916ee40ffa461112d54dce5de records=647"
          },
          {
            "name": "close-synthea-10y/total",
            "value": 0.441937,
            "range": "0.432678-0.442811",
            "unit": "s",
            "extra": "Closing a pod straight after its import and first screen, which saves its database. | closing a pod right after its import and first screen; unprobed, median of 3 runs, each in a process of its own; dataset=synthea-10y sha256=2703dc1e7e920fa1e45d16c58f8338ef13b3cc1916ee40ffa461112d54dce5de records=647"
          },
          {
            "name": "reopen-first-answer-synthea-10y/total",
            "value": 0.170856,
            "range": "0.166968-0.172996",
            "unit": "s",
            "extra": "Opening an existing pod and answering its first read: what a returning person waits for. | open + first read; unprobed, median of 3 runs, each in a process of its own; dataset=synthea-10y sha256=2703dc1e7e920fa1e45d16c58f8338ef13b3cc1916ee40ffa461112d54dce5de records=647"
          },
          {
            "name": "reopen-first-answer-synthea-10y/open",
            "value": 0.135335,
            "range": "0.131558-0.136926",
            "unit": "s",
            "extra": "Opening the pod. | unprobed, median of 3 runs, each in a process of its own; dataset=synthea-10y sha256=2703dc1e7e920fa1e45d16c58f8338ef13b3cc1916ee40ffa461112d54dce5de records=647"
          },
          {
            "name": "reopen-first-answer-synthea-10y/first-read",
            "value": 0.035521,
            "range": "0.035410-0.036070",
            "unit": "s",
            "extra": "The first question asked of the reopened pod ('My active conditions'). | pod/My active conditions; unprobed, median of 3 runs, each in a process of its own; dataset=synthea-10y sha256=2703dc1e7e920fa1e45d16c58f8338ef13b3cc1916ee40ffa461112d54dce5de records=647"
          },
          {
            "name": "reopen-first-answer-synthea-10y/second-read",
            "value": 0.000817,
            "range": "0.000814-0.000829",
            "unit": "s",
            "extra": "A second question asked of the reopened pod ('My active medications'). | pod/My active medications; unprobed, median of 3 runs, each in a process of its own; dataset=synthea-10y sha256=2703dc1e7e920fa1e45d16c58f8338ef13b3cc1916ee40ffa461112d54dce5de records=647"
          },
          {
            "name": "reopen-first-answer-synthea-10y/close",
            "value": 0.000545,
            "range": "0.000508-0.000557",
            "unit": "s",
            "extra": "Closing the pod, saving its database. | unprobed, median of 3 runs, each in a process of its own; dataset=synthea-10y sha256=2703dc1e7e920fa1e45d16c58f8338ef13b3cc1916ee40ffa461112d54dce5de records=647"
          },
          {
            "name": "reopen-first-answer-synthea-10y/peak-rss",
            "value": 148013056,
            "range": "148004864-148021248",
            "unit": "By",
            "extra": "The most memory the process held at any moment, in bytes. | unprobed, median of 3 runs, each in a process of its own; dataset=synthea-10y sha256=2703dc1e7e920fa1e45d16c58f8338ef13b3cc1916ee40ffa461112d54dce5de records=647"
          },
          {
            "name": "question-page-synthea-10y/total",
            "value": 0.025654,
            "range": "0.025568-0.025795",
            "unit": "s",
            "extra": "Fetching one page of answers for every question in turn. | 16 questions, a page of 20 each, from pod.db; unprobed, median of 3 runs, each in a process of its own; dataset=synthea-10y sha256=2703dc1e7e920fa1e45d16c58f8338ef13b3cc1916ee40ffa461112d54dce5de records=647"
          },
          {
            "name": "question-page-synthea-10y/peak-rss",
            "value": 148099072,
            "range": "148074496-148111360",
            "unit": "By",
            "extra": "The most memory the process held at any moment, in bytes. | unprobed, median of 3 runs, each in a process of its own; dataset=synthea-10y sha256=2703dc1e7e920fa1e45d16c58f8338ef13b3cc1916ee40ffa461112d54dce5de records=647"
          },
          {
            "name": "fresh-first-screen-synthea-10y/stage/core-pod.step.perform",
            "value": 2.203585,
            "range": "2.203585-2.203585",
            "unit": "s",
            "extra": "Doing the work of one import step: taking in the new records. Sits inside scenario.import. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 3 calls whose own times sum to 2.203585 s (more than the time in progress where calls overlap); core-pod.step.perform"
          },
          {
            "name": "fresh-first-screen-synthea-10y/stage/arrivals.fileexport",
            "value": 1.855399,
            "range": "1.855399-1.855399",
            "unit": "s",
            "extra": "Taking in every document of the record: converting each, working out its records and writing them to the pod. Sits inside core-pod.step.perform. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 1.855399 s (more than the time in progress where calls overlap); arrivals.fileExport"
          },
          {
            "name": "fresh-first-screen-synthea-10y/stage/arrivals.convert",
            "value": 0.832176,
            "range": "0.832176-0.832176",
            "unit": "s",
            "extra": "Converting the source record into the pod's own format with the adapter. Sits inside scenario.import. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 0.832176 s (more than the time in progress where calls overlap); arrivals.convert"
          },
          {
            "name": "fresh-first-screen-synthea-10y/stage/arrivals.accepting",
            "value": 0.733092,
            "range": "0.733092-0.733092",
            "unit": "s",
            "extra": "Finding which adapter accepts this document. Sits inside scenario.import. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 0.733092 s (more than the time in progress where calls overlap); arrivals.accepting"
          },
          {
            "name": "fresh-first-screen-synthea-10y/stage/pod.match",
            "value": 0.567215,
            "range": "0.567215-0.567215",
            "unit": "s",
            "extra": "Judging which records in the pod are the same thing recorded twice. Sits inside scenario.import. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 0.567215 s (more than the time in progress where calls overlap); pod.match"
          },
          {
            "name": "fresh-first-screen-synthea-10y/stage/core-pod.step.rebuild-import",
            "value": 0.521197,
            "range": "0.521197-0.521197",
            "unit": "s",
            "extra": "Re-deriving what the imported records change. Sits inside scenario.import. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 0.521197 s (more than the time in progress where calls overlap); core-pod.step.rebuild:import"
          },
          {
            "name": "close-synthea-10y/stage/core-pod.keepdatabase",
            "value": 0.344165,
            "range": "0.344165-0.344165",
            "unit": "s",
            "extra": "Saving the pod's database so the next opening is fast. Sits inside scenario.close. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 0.344165 s (more than the time in progress where calls overlap); core-pod.keepDatabase"
          },
          {
            "name": "close-synthea-10y/stage/core-pod.keepdatabase.whole",
            "value": 0.332699,
            "range": "0.332699-0.332699",
            "unit": "s",
            "extra": "Saving the database whole, from the pod's current facts. Sits inside core-pod.keepdatabase. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 0.332699 s (more than the time in progress where calls overlap); core-pod.keepDatabase.whole"
          },
          {
            "name": "close-synthea-10y/stage/pod-database.build.worker",
            "value": 0.326953,
            "range": "0.326953-0.326953",
            "unit": "s",
            "extra": "Starting the helper that builds the saved database. Sits inside core-pod.keepdatabase. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 0.326953 s (more than the time in progress where calls overlap); pod-database.build.worker"
          },
          {
            "name": "close-synthea-10y/stage/pod-database.build.load",
            "value": 0.139465,
            "range": "0.139465-0.139465",
            "unit": "s",
            "extra": "Loading the pod's facts into the saved database. Sits inside core-pod.keepdatabase. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 0.139465 s (more than the time in progress where calls overlap); pod-database.build.load"
          },
          {
            "name": "close-synthea-10y/stage/core-pod.keepbuild",
            "value": 0.074165,
            "range": "0.074165-0.074165",
            "unit": "s",
            "extra": "Preparing the content of the saved database. Sits inside core-pod.keepdatabase. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 0.074165 s (more than the time in progress where calls overlap); core-pod.keepBuild"
          },
          {
            "name": "close-synthea-10y/stage/core-pod.keepbuild.dump",
            "value": 0.052009,
            "range": "0.052009-0.052009",
            "unit": "s",
            "extra": "Gathering the pod's facts to put in the saved database. Sits inside core-pod.keepbuild. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 0.052009 s (more than the time in progress where calls overlap); core-pod.keepBuild.dump"
          },
          {
            "name": "reopen-first-answer-synthea-10y/stage/files.read.file",
            "value": 0.075562,
            "range": "0.075562-0.075562",
            "unit": "s",
            "extra": "Reading one file from the pod's folder. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 160 calls whose own times sum to 0.314874 s (more than the time in progress where calls overlap); files.read.file"
          },
          {
            "name": "reopen-first-answer-synthea-10y/stage/question-pod-my-active-conditions",
            "value": 0.035556,
            "range": "0.035556-0.035556",
            "unit": "s",
            "extra": "The answer to: pod my active conditions. Sits inside scenario.first-read or scenario.second-read. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 0.035556 s (more than the time in progress where calls overlap); question:pod/My active conditions"
          },
          {
            "name": "reopen-first-answer-synthea-10y/stage/core-pod.databaseanswers",
            "value": 0.027096,
            "range": "0.027096-0.027096",
            "unit": "s",
            "extra": "Checking whether the saved database holds the pod as it stands now, so it can answer in place of a rebuild. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 0.027096 s (more than the time in progress where calls overlap); core-pod.databaseAnswers"
          },
          {
            "name": "reopen-first-answer-synthea-10y/stage/core-pod.inputshash",
            "value": 0.019727,
            "range": "0.019727-0.019727",
            "unit": "s",
            "extra": "Working out a fingerprint of everything a result depends on, to know when it can be reused. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 0.019727 s (more than the time in progress where calls overlap); core-pod.inputsHash"
          },
          {
            "name": "reopen-first-answer-synthea-10y/stage/union.select",
            "value": 0.014698,
            "range": "0.014698-0.014698",
            "unit": "s",
            "extra": "Asking the in-memory facts a question that returns rows. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 0.014698 s (more than the time in progress where calls overlap); union.select"
          },
          {
            "name": "reopen-first-answer-synthea-10y/stage/store.query",
            "value": 0.014067,
            "range": "0.014067-0.014067",
            "unit": "s",
            "extra": "Questions put to the pod's fact store, many of them: the time one or more of them was in progress. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 0.014067 s (more than the time in progress where calls overlap); store.query"
          },
          {
            "name": "question-page-synthea-10y/stage/question.page-pod-what-each-import-brought-in",
            "value": 0.008881,
            "range": "0.008881-0.008881",
            "unit": "s",
            "extra": "One page of the answer to: pod what each import brought in. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 0.008881 s (more than the time in progress where calls overlap); question.page:pod/What each import brought in"
          },
          {
            "name": "question-page-synthea-10y/stage/question.page-pod-what-everything-is-called",
            "value": 0.006449,
            "range": "0.006449-0.006449",
            "unit": "s",
            "extra": "One page of the answer to: pod what everything is called. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 0.006449 s (more than the time in progress where calls overlap); question.page:pod/What everything is called"
          },
          {
            "name": "question-page-synthea-10y/stage/question.page-profile-what-needs-review",
            "value": 0.003449,
            "range": "0.003449-0.003449",
            "unit": "s",
            "extra": "One page of the answer to: profile what needs review. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 0.003449 s (more than the time in progress where calls overlap); question.page:profile/What needs review"
          },
          {
            "name": "question-page-synthea-10y/stage/question.page-pod-how-many-of-each-kind",
            "value": 0.001424,
            "range": "0.001424-0.001424",
            "unit": "s",
            "extra": "One page of the answer to: pod how many of each kind. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 0.001424 s (more than the time in progress where calls overlap); question.page:pod/How many of each kind"
          },
          {
            "name": "question-page-synthea-10y/stage/question.page-pod-the-person-this-pod-is-about",
            "value": 0.000962,
            "range": "0.000962-0.000962",
            "unit": "s",
            "extra": "One page of the answer to: pod the person this pod is about. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 0.000962 s (more than the time in progress where calls overlap); question.page:pod/The person this pod is about"
          },
          {
            "name": "question-page-synthea-10y/stage/question.page-pod-my-reports-notes-and-documents",
            "value": 0.000785,
            "range": "0.000785-0.000785",
            "unit": "s",
            "extra": "One page of the answer to: pod my reports notes and documents. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 0.000785 s (more than the time in progress where calls overlap); question.page:pod/My reports, notes and documents"
          },
          {
            "name": "fresh-first-screen-synthea-10y/self/arrivals.accepting",
            "value": 0.728811,
            "range": "0.728811-0.728811",
            "unit": "s",
            "extra": "Finding which adapter accepts this document. Sits inside scenario.import. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 1 calls; arrivals.accepting"
          },
          {
            "name": "fresh-first-screen-synthea-10y/self/bridge.stage-records",
            "value": 0.408684,
            "range": "0.408684-0.408684",
            "unit": "s",
            "extra": "The Bridge makes the pod's records, with their versions, from what its mappings produced. Sits inside arrivals.convert. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 1 calls; bridge.stage:records"
          },
          {
            "name": "fresh-first-screen-synthea-10y/self/store.query",
            "value": 0.352155,
            "range": "0.352155-0.352155",
            "unit": "s",
            "extra": "Questions put to the pod's fact store, many of them: the time one or more of them was in progress. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 152 calls; store.query"
          },
          {
            "name": "fresh-first-screen-synthea-10y/self/core-pod.import.adapters",
            "value": 0.306534,
            "range": "0.306534-0.306534",
            "unit": "s",
            "extra": "Reading the adapter that knows how to convert this kind of record. Sits inside scenario.import. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 1 calls; core-pod.import.adapters"
          },
          {
            "name": "fresh-first-screen-synthea-10y/self/bridge.stage-mapping",
            "value": 0.212228,
            "range": "0.212228-0.212228",
            "unit": "s",
            "extra": "The Bridge runs the adapter's mappings over the source record's facts to produce the pod's facts. Sits inside arrivals.convert. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 1 calls; bridge.stage:mapping"
          },
          {
            "name": "fresh-first-screen-synthea-10y/self/core-pod.step.commit",
            "value": 0.13372,
            "range": "0.133720-0.133720",
            "unit": "s",
            "extra": "Writing the step's results to the pod's files and recording that it happened. Sits inside scenario.import. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 3 calls; core-pod.step.commit"
          },
          {
            "name": "close-synthea-10y/self/pod-database.build.load",
            "value": 0.139465,
            "range": "0.139465-0.139465",
            "unit": "s",
            "extra": "Loading the pod's facts into the saved database. Sits inside core-pod.keepdatabase. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 1 calls; pod-database.build.load"
          },
          {
            "name": "close-synthea-10y/self/pod-database.build.worker",
            "value": 0.136313,
            "range": "0.136313-0.136313",
            "unit": "s",
            "extra": "Starting the helper that builds the saved database. Sits inside core-pod.keepdatabase. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 1 calls; pod-database.build.worker"
          },
          {
            "name": "close-synthea-10y/self/core-pod.keepbuild.dump",
            "value": 0.052009,
            "range": "0.052009-0.052009",
            "unit": "s",
            "extra": "Gathering the pod's facts to put in the saved database. Sits inside core-pod.keepbuild. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 1 calls; core-pod.keepBuild.dump"
          },
          {
            "name": "close-synthea-10y/self/pod-database.build.screens-fill",
            "value": 0.028336,
            "range": "0.028336-0.028336",
            "unit": "s",
            "extra": "Filling in the database's ready-made answer tables. Sits inside core-pod.keepdatabase. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 1 calls; pod-database.build.screens:fill"
          },
          {
            "name": "close-synthea-10y/self/core-pod.keepbuild",
            "value": 0.018911,
            "range": "0.018911-0.018911",
            "unit": "s",
            "extra": "Preparing the content of the saved database. Sits inside core-pod.keepdatabase. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 1 calls; core-pod.keepBuild"
          },
          {
            "name": "close-synthea-10y/self/pod-database.build.screens-finish",
            "value": 0.010943,
            "range": "0.010943-0.010943",
            "unit": "s",
            "extra": "Finishing the database's ready-made answer tables. Sits inside core-pod.keepdatabase. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 1 calls; pod-database.build.screens:finish"
          },
          {
            "name": "reopen-first-answer-synthea-10y/self/files.read.file",
            "value": 0.075562,
            "range": "0.075562-0.075562",
            "unit": "s",
            "extra": "Reading one file from the pod's folder. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 160 calls; files.read.file"
          },
          {
            "name": "reopen-first-answer-synthea-10y/self/store.query",
            "value": 0.014067,
            "range": "0.014067-0.014067",
            "unit": "s",
            "extra": "Questions put to the pod's fact store, many of them: the time one or more of them was in progress. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 1 calls; store.query"
          },
          {
            "name": "reopen-first-answer-synthea-10y/self/union.loadturtle",
            "value": 0.011342,
            "range": "0.011342-0.011342",
            "unit": "s",
            "extra": "Loading text-format facts into memory. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 1 calls; union.loadTurtle"
          },
          {
            "name": "reopen-first-answer-synthea-10y/self/files.hash.sha256",
            "value": 0.010729,
            "range": "0.010729-0.010729",
            "unit": "s",
            "extra": "Fingerprinting a file's content to tell whether it changed. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 20 calls; files.hash.sha256"
          },
          {
            "name": "reopen-first-answer-synthea-10y/self/question-pod-my-active-conditions",
            "value": 0.004486,
            "range": "0.004486-0.004486",
            "unit": "s",
            "extra": "The answer to: pod my active conditions. Sits inside scenario.first-read or scenario.second-read. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 1 calls; question:pod/My active conditions"
          },
          {
            "name": "reopen-first-answer-synthea-10y/self/core-pod.inputshash",
            "value": 0.001429,
            "range": "0.001429-0.001429",
            "unit": "s",
            "extra": "Working out a fingerprint of everything a result depends on, to know when it can be reused. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 1 calls; core-pod.inputsHash"
          },
          {
            "name": "question-page-synthea-10y/self/question.page-pod-what-each-import-brought-in",
            "value": 0.008881,
            "range": "0.008881-0.008881",
            "unit": "s",
            "extra": "One page of the answer to: pod what each import brought in. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 1 calls; question.page:pod/What each import brought in"
          },
          {
            "name": "question-page-synthea-10y/self/question.page-pod-what-everything-is-called",
            "value": 0.006449,
            "range": "0.006449-0.006449",
            "unit": "s",
            "extra": "One page of the answer to: pod what everything is called. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 1 calls; question.page:pod/What everything is called"
          },
          {
            "name": "question-page-synthea-10y/self/question.page-profile-what-needs-review",
            "value": 0.003449,
            "range": "0.003449-0.003449",
            "unit": "s",
            "extra": "One page of the answer to: profile what needs review. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 1 calls; question.page:profile/What needs review"
          },
          {
            "name": "question-page-synthea-10y/self/question.page-pod-how-many-of-each-kind",
            "value": 0.001424,
            "range": "0.001424-0.001424",
            "unit": "s",
            "extra": "One page of the answer to: pod how many of each kind. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 1 calls; question.page:pod/How many of each kind"
          },
          {
            "name": "question-page-synthea-10y/self/question.page-pod-the-person-this-pod-is-about",
            "value": 0.000962,
            "range": "0.000962-0.000962",
            "unit": "s",
            "extra": "One page of the answer to: pod the person this pod is about. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 1 calls; question.page:pod/The person this pod is about"
          },
          {
            "name": "question-page-synthea-10y/self/question.page-pod-my-reports-notes-and-documents",
            "value": 0.000785,
            "range": "0.000785-0.000785",
            "unit": "s",
            "extra": "One page of the answer to: pod my reports notes and documents. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 1 calls; question.page:pod/My reports, notes and documents"
          }
        ]
      },
      {
        "commit": {
          "author": {
            "name": "jayostis",
            "username": "jayostis",
            "email": "jayostis@gmail.com"
          },
          "committer": {
            "name": "GitHub",
            "username": "web-flow",
            "email": "noreply@github.com"
          },
          "id": "d2afe9b9f888f123010bc3fd3db009fa2c312a25",
          "message": "Merge pull request #927 from jayostis/perf/item3-fixed-costs\n\nperf(runtime): item 3 fixed costs: no needless compaction, one ask before empty bound batches, adapters load together",
          "timestamp": "2026-11-20T09:48:10Z",
          "url": "https://github.com/jayostis/cascade-runtime-js/commit/d2afe9b9f888f123010bc3fd3db009fa2c312a25"
        },
        "date": 1795168692428,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "fresh-first-screen-synthea-lifetime/total",
            "value": 43.464374,
            "range": "43.451715-43.506336",
            "unit": "s",
            "extra": "Opening a new pod, importing the whole record and asking the first screen's questions: what a person waits for the first time. | open + import + first screen; unprobed, median of 3 runs, each in a process of its own; dataset=synthea-lifetime sha256=f20b86408066ece2d25a7b02d380b7652f22d16df9dab613a0c73c9969b17da8 records=16833"
          },
          {
            "name": "fresh-first-screen-synthea-lifetime/open",
            "value": 0.344164,
            "range": "0.331025-0.355174",
            "unit": "s",
            "extra": "Opening the pod. | unprobed, median of 3 runs, each in a process of its own; dataset=synthea-lifetime sha256=f20b86408066ece2d25a7b02d380b7652f22d16df9dab613a0c73c9969b17da8 records=16833"
          },
          {
            "name": "fresh-first-screen-synthea-lifetime/import",
            "value": 41.200268,
            "range": "41.110356-41.214297",
            "unit": "s",
            "extra": "Importing the whole record into the pod. | unprobed, median of 3 runs, each in a process of its own; dataset=synthea-lifetime sha256=f20b86408066ece2d25a7b02d380b7652f22d16df9dab613a0c73c9969b17da8 records=16833"
          },
          {
            "name": "fresh-first-screen-synthea-lifetime/first-screen",
            "value": 1.947876,
            "range": "1.896273-2.022993",
            "unit": "s",
            "extra": "Asking the questions the first screen shows. | unprobed, median of 3 runs, each in a process of its own; dataset=synthea-lifetime sha256=f20b86408066ece2d25a7b02d380b7652f22d16df9dab613a0c73c9969b17da8 records=16833"
          },
          {
            "name": "fresh-first-screen-synthea-lifetime/peak-rss",
            "value": 2005229568,
            "range": "1995386880-2048634880",
            "unit": "By",
            "extra": "The most memory the process held at any moment, in bytes. | the most the process reached, as the operating system keeps it; unprobed, median of 3 runs, each in a process of its own; dataset=synthea-lifetime sha256=f20b86408066ece2d25a7b02d380b7652f22d16df9dab613a0c73c9969b17da8 records=16833"
          },
          {
            "name": "fresh-first-screen-synthea-lifetime-encrypted/total",
            "value": 44.939696,
            "range": "44.912617-44.985627",
            "unit": "s",
            "extra": "Opening a new pod, importing the whole record and asking the first screen's questions: what a person waits for the first time. | open + import + first screen; unprobed, median of 3 runs, each in a process of its own; dataset=synthea-lifetime sha256=f20b86408066ece2d25a7b02d380b7652f22d16df9dab613a0c73c9969b17da8 records=16833 encrypted"
          },
          {
            "name": "fresh-first-screen-synthea-lifetime-encrypted/open",
            "value": 0.780508,
            "range": "0.774206-0.830496",
            "unit": "s",
            "extra": "Opening the pod. | unprobed, median of 3 runs, each in a process of its own; dataset=synthea-lifetime sha256=f20b86408066ece2d25a7b02d380b7652f22d16df9dab613a0c73c9969b17da8 records=16833 encrypted"
          },
          {
            "name": "fresh-first-screen-synthea-lifetime-encrypted/import",
            "value": 42.212448,
            "range": "42.172873-42.249099",
            "unit": "s",
            "extra": "Importing the whole record into the pod. | unprobed, median of 3 runs, each in a process of its own; dataset=synthea-lifetime sha256=f20b86408066ece2d25a7b02d380b7652f22d16df9dab613a0c73c9969b17da8 records=16833 encrypted"
          },
          {
            "name": "fresh-first-screen-synthea-lifetime-encrypted/first-screen",
            "value": 1.936327,
            "range": "1.925963-1.956020",
            "unit": "s",
            "extra": "Asking the questions the first screen shows. | unprobed, median of 3 runs, each in a process of its own; dataset=synthea-lifetime sha256=f20b86408066ece2d25a7b02d380b7652f22d16df9dab613a0c73c9969b17da8 records=16833 encrypted"
          },
          {
            "name": "fresh-first-screen-synthea-lifetime-encrypted/peak-rss",
            "value": 2446827520,
            "range": "2421383168-2449657856",
            "unit": "By",
            "extra": "The most memory the process held at any moment, in bytes. | the most the process reached, as the operating system keeps it; unprobed, median of 3 runs, each in a process of its own; dataset=synthea-lifetime sha256=f20b86408066ece2d25a7b02d380b7652f22d16df9dab613a0c73c9969b17da8 records=16833 encrypted"
          },
          {
            "name": "fresh-first-screen-synthea-lifetime/stage/core-pod.step.perform",
            "value": 24.951081,
            "range": "24.951081-24.951081",
            "unit": "s",
            "extra": "Doing the work of one import step: taking in the new records. Sits inside scenario.import. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 3 calls whose own times sum to 24.951081 s (more than the time in progress where calls overlap); core-pod.step.perform"
          },
          {
            "name": "fresh-first-screen-synthea-lifetime/stage/arrivals.fileexport",
            "value": 23.065501,
            "range": "23.065501-23.065501",
            "unit": "s",
            "extra": "Taking in every document of the record: converting each, working out its records and writing them to the pod. Sits inside core-pod.step.perform. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 23.065501 s (more than the time in progress where calls overlap); arrivals.fileExport"
          },
          {
            "name": "fresh-first-screen-synthea-lifetime/stage/arrivals.convert",
            "value": 15.650512,
            "range": "15.650512-15.650512",
            "unit": "s",
            "extra": "Converting the source record into the pod's own format with the adapter. Sits inside scenario.import. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 15.650512 s (more than the time in progress where calls overlap); arrivals.convert"
          },
          {
            "name": "fresh-first-screen-synthea-lifetime/stage/pod.match",
            "value": 11.604097,
            "range": "11.604097-11.604097",
            "unit": "s",
            "extra": "Judging which records in the pod are the same thing recorded twice. Sits inside scenario.import. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 11.604097 s (more than the time in progress where calls overlap); pod.match"
          },
          {
            "name": "fresh-first-screen-synthea-lifetime/stage/core-pod.step.rebuild-import",
            "value": 10.088015,
            "range": "10.088015-10.088015",
            "unit": "s",
            "extra": "Re-deriving what the imported records change. Sits inside scenario.import. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 10.088015 s (more than the time in progress where calls overlap); core-pod.step.rebuild:import"
          },
          {
            "name": "fresh-first-screen-synthea-lifetime/stage/kept.step",
            "value": 9.858973,
            "range": "9.858973-9.858973",
            "unit": "s",
            "extra": "Keeping the saved answers current after one step. Sits inside core-pod.step.keptafter. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 2 calls whose own times sum to 9.858973 s (more than the time in progress where calls overlap); kept.step"
          },
          {
            "name": "fresh-first-screen-synthea-lifetime-encrypted/stage/core-pod.step.perform",
            "value": 24.95892,
            "range": "24.958920-24.958920",
            "unit": "s",
            "extra": "Doing the work of one import step: taking in the new records. Sits inside scenario.import. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 3 calls whose own times sum to 24.958920 s (more than the time in progress where calls overlap); core-pod.step.perform"
          },
          {
            "name": "fresh-first-screen-synthea-lifetime-encrypted/stage/arrivals.fileexport",
            "value": 23.065342,
            "range": "23.065342-23.065342",
            "unit": "s",
            "extra": "Taking in every document of the record: converting each, working out its records and writing them to the pod. Sits inside core-pod.step.perform. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 23.065342 s (more than the time in progress where calls overlap); arrivals.fileExport"
          },
          {
            "name": "fresh-first-screen-synthea-lifetime-encrypted/stage/arrivals.convert",
            "value": 15.63147,
            "range": "15.631470-15.631470",
            "unit": "s",
            "extra": "Converting the source record into the pod's own format with the adapter. Sits inside scenario.import. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 15.631470 s (more than the time in progress where calls overlap); arrivals.convert"
          },
          {
            "name": "fresh-first-screen-synthea-lifetime-encrypted/stage/pod.match",
            "value": 12.027866,
            "range": "12.027866-12.027866",
            "unit": "s",
            "extra": "Judging which records in the pod are the same thing recorded twice. Sits inside scenario.import. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 12.027866 s (more than the time in progress where calls overlap); pod.match"
          },
          {
            "name": "fresh-first-screen-synthea-lifetime-encrypted/stage/core-pod.step.rebuild-import",
            "value": 10.336381,
            "range": "10.336381-10.336381",
            "unit": "s",
            "extra": "Re-deriving what the imported records change. Sits inside scenario.import. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 1 calls whose own times sum to 10.336381 s (more than the time in progress where calls overlap); core-pod.step.rebuild:import"
          },
          {
            "name": "fresh-first-screen-synthea-lifetime-encrypted/stage/kept.step",
            "value": 9.871554,
            "range": "9.871554-9.871554",
            "unit": "s",
            "extra": "Keeping the saved answers current after one step. Sits inside core-pod.step.keptafter. | probed run; the time some call of it was in progress, inclusive of the spans inside it; 2 calls whose own times sum to 9.871554 s (more than the time in progress where calls overlap); kept.step"
          },
          {
            "name": "fresh-first-screen-synthea-lifetime/self/store.query",
            "value": 5.503929,
            "range": "5.503929-5.503929",
            "unit": "s",
            "extra": "Questions put to the pod's fact store, many of them: the time one or more of them was in progress. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 365 calls; store.query"
          },
          {
            "name": "fresh-first-screen-synthea-lifetime/self/bridge.stage-mapping",
            "value": 4.345364,
            "range": "4.345364-4.345364",
            "unit": "s",
            "extra": "The Bridge runs the adapter's mappings over the source record's facts to produce the pod's facts. Sits inside arrivals.convert. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 1 calls; bridge.stage:mapping"
          },
          {
            "name": "fresh-first-screen-synthea-lifetime/self/bridge.stage-lift",
            "value": 3.917825,
            "range": "3.917825-3.917825",
            "unit": "s",
            "extra": "The Bridge lifts the source record into facts. Sits inside arrivals.convert. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 1 calls; bridge.stage:lift"
          },
          {
            "name": "fresh-first-screen-synthea-lifetime/self/files.write.file",
            "value": 3.568627,
            "range": "3.568627-3.568627",
            "unit": "s",
            "extra": "Writing one file into the pod's folder. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 27248 calls; files.write.file"
          },
          {
            "name": "fresh-first-screen-synthea-lifetime/self/arrivals.accepting",
            "value": 2.969848,
            "range": "2.969848-2.969848",
            "unit": "s",
            "extra": "Finding which adapter accepts this document. Sits inside scenario.import. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 1 calls; arrivals.accepting"
          },
          {
            "name": "fresh-first-screen-synthea-lifetime/self/files.write.rename",
            "value": 2.727103,
            "range": "2.727103-2.727103",
            "unit": "s",
            "extra": "Moving a finished file into place, so a half-written file is never seen. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 27248 calls; files.write.rename"
          },
          {
            "name": "fresh-first-screen-synthea-lifetime-encrypted/self/store.query",
            "value": 5.491786,
            "range": "5.491786-5.491786",
            "unit": "s",
            "extra": "Questions put to the pod's fact store, many of them: the time one or more of them was in progress. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 365 calls; store.query"
          },
          {
            "name": "fresh-first-screen-synthea-lifetime-encrypted/self/bridge.stage-mapping",
            "value": 4.323449,
            "range": "4.323449-4.323449",
            "unit": "s",
            "extra": "The Bridge runs the adapter's mappings over the source record's facts to produce the pod's facts. Sits inside arrivals.convert. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 1 calls; bridge.stage:mapping"
          },
          {
            "name": "fresh-first-screen-synthea-lifetime-encrypted/self/bridge.stage-lift",
            "value": 3.945286,
            "range": "3.945286-3.945286",
            "unit": "s",
            "extra": "The Bridge lifts the source record into facts. Sits inside arrivals.convert. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 1 calls; bridge.stage:lift"
          },
          {
            "name": "fresh-first-screen-synthea-lifetime-encrypted/self/files.write.file",
            "value": 3.629885,
            "range": "3.629885-3.629885",
            "unit": "s",
            "extra": "Writing one file into the pod's folder. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 27257 calls; files.write.file"
          },
          {
            "name": "fresh-first-screen-synthea-lifetime-encrypted/self/files.write.rename",
            "value": 3.061226,
            "range": "3.061226-3.061226",
            "unit": "s",
            "extra": "Moving a finished file into place, so a half-written file is never seen. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 27249 calls; files.write.rename"
          },
          {
            "name": "fresh-first-screen-synthea-lifetime-encrypted/self/arrivals.accepting",
            "value": 3.007828,
            "range": "3.007828-3.007828",
            "unit": "s",
            "extra": "Finding which adapter accepts this document. Sits inside scenario.import. | Own time: the time some call of it was in progress with none of the spans inside it in progress, that is the time spent in its own code, or waiting. Unlike its stage time it leaves out what the spans inside it took, so the largest own times are the places to look first. | probed run; the time some call of it was in progress with none of the spans inside it in progress; 1 calls; arrivals.accepting"
          }
        ]
      }
    ]
  }
}