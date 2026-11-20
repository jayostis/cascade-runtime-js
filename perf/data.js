window.BENCHMARK_DATA = {
  "lastUpdate": 1795140332748,
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
      }
    ]
  }
}