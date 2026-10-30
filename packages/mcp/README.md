# cascade-mcp

An [MCP](https://modelcontextprotocol.io) server on stdio over a folder of Cascade pods, for Claude Desktop, VS Code or
any MCP client to start. It offers the tools of `cascade-runtime/tools`, and every one of them reads: it never writes a
pod, and never opens an encrypted one.

```sh
npx cascade-mcp --pods <folder>
```

`<folder>` holds the pods, one folder each, as an app keeps them (`pods/` in a starter app). The reference tables the
folder holds (`.tables/`) are used as they are; `--check-tables` checks their feeds for newer tables, a network call,
when the first pod opens.

- `list_pods`: the pods' names.
- `ask`: a pod's records by the name of a question (allergies, conditions, medications, medication history, lab results,
  immunizations, procedures, genetic variants, the person, where an entry came from, what needs review), a few rows of
  the many; never a query of your own.
- `find_changes`: what changed in a pod's lab results after a medication started or stopped, strongest first, with the
  numbers; `finding_rows` gives the lab rows behind one, `lab_series` one test's results over time and `timeline` each
  medication's start and end. They state what changed, never why.

Every row names the entry it is about, so an answer can cite it.

**A hosted client sends what the tools return to its provider.** A pod made from a person's own records is theirs to
decide about: use a model that runs on their machine, or leave that pod out.

**Claude Desktop.** Open Settings, Developer, Edit Config, and add the server to `claude_desktop_config.json`, with the
absolute paths of the folder cascade-mcp is installed in and of the pods (forward slashes work on Windows too), then
quit Claude Desktop and start it again:

```json
{
  "mcpServers": {
    "cascade": {
      "command": "node",
      "args": [
        "C:/path/to/installed/node_modules/cascade-mcp/dist/src/cli.js",
        "--pods",
        "C:/path/to/pods"
      ]
    }
  }
}
```
