# Changelog fragments

A change that a user sees adds one file here. It does not edit `CHANGELOG.md`. The changelog
gate refuses an edit of `CHANGELOG.md` in a commit whose subject does not start with
`chore(release)`.

```text
changelog.d/<record-id>.<category>.md
```

The category is one of `added`, `changed`, `deprecated`, `removed`, `fixed` or `security`.
These are the [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) sections. The file holds
the entry body only, with no `###` heading.

```markdown
- **One-line claim in bold.** Then the detail that a user needs, and the record id of the
  change.
```

The file name carries the record id, so two lanes never write the same file.

## The name

`d` means directory, as in `init.d`, `cron.d` and `conf.d`. A `<name>.d` folder holds fragments
that make up `<name>`. `CHANGELOG.md` is the result, and you add a file here.

## At a release

The maintainer folds the fragments into `CHANGELOG.md` by hand and deletes them in the release
commit. [docs/maintaining.md](../docs/maintaining.md) gives the steps.
