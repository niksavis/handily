handily-workitems reads a `.beads/issues.jsonl` over 4 MiB by streaming it through `/bin/cat`,
or `cmd.exe type` on Windows, with no approval and no `br` run. It keeps only the open items and
reads the file again only when its size or modification time changes.
