# pi-homescreen-block

A blocky-styled custom homescreen for pi.

This extension replaces the default startup header with a branded QUINUS splash screen that shows:
- a large π logo (identical to `pi-homescreen`)
- discovered skills
- discovered extensions
- scope badges for global, project, npm-installed and git-installed resources

The resource lists use a solid-block style inspired by tmux and nvim statuslines:
- section headers have a solid **blue** background
- list items have a solid **dim gray** background
- no borders

It also enables `quietStartup` in Pi's settings so the built-in startup resource list does not duplicate the custom header.

## Preview

Shown on session start, hidden when you send your first prompt.
On wide terminals, the ASCII logo sits on the left and the resource blocks render in a single stacked column to its right:

```text
                ████████████████████████
                ████████████████████████▒▒
                ████████████████████████▒▒
                ████████████████████████▒▒
                ████████▒▒▒▒▒▒▒▒████████▒▒
                ████████▒▒      ████████▒▒
                ████████▒▒      ████████▒▒
                ████████▒▒      ████████▒▒
                ████████████████  ▒▒▒▒████████
                ████████████████▒▒      ████████▒▒
                ████████████████▒▒      ████████▒▒
                ████████████████▒▒      ████████▒▒
                ████████▒▒▒▒▒▒▒▒▒▒      ████████▒▒
                ████████▒▒              ████████▒▒
                ████████▒▒              ████████▒▒
                ████████▒▒              ████████▒▒
                  ▒▒▒▒▒▒▒▒                ▒▒▒▒▒▒▒▒

                     my-project  using claude-sonnet-4

        Skills
          ■ kotlin-coroutines-flows        [gl]
          ■ kotlin-multiplatform           [gl]
          ■ kotlin-springboot              [gl]

        Extensions
          ■ pi-git-changes                 [gl]
          ■ pi-homescreen-block            [gl]
          ■ pi-instant-review              [gl]
          ■ pi-rounded-border-editor       [gl]
          ■ pi-statusbar                   [gl]
          ■ pi-tool-collapse               [gl]
          ■ pi-mcp-adapter                [npm]
────────────────────────────────────────────────────────────────────────────────
```

(In a color terminal the headers are rendered with a solid blue background and
the list items with a solid dim gray background.)

- `/logo` — show or hide the homescreen
- `/resources` — show the currently discovered skills and extensions

## Install

Put this folder in `~/.pi/agent/extensions/` or install from git:

```bash
pi install git:github.com/Quinus/pi-homescreen-block
```

## Notes

- The homescreen is shown on session start.
- It hides automatically when you send your first prompt.
- Resource discovery includes local extensions and npm-based pi packages.
