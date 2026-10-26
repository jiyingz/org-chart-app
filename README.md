# OrgMap

Map the people, teams and organizations you know: a pan-and-zoom canvas of org trees, with the relationships between people kept one click away.

- **Orgs** (gold), **teams** (green, nestable as sub-teams) and **people** (blue) are laid out automatically as top-down trees.
- **Leaders** appear as a ★ "Led by" link on their org or team card. People can hold several roles: their main card sits under one team, and a dashed link chip appears under each other team.
- **Relationships** (free text, two-way or one-way →) are not drawn on the map. Open them from a card's pop-up ("See relationships"), or use **Relationships** in the top bar to look up how two entities are connected.
- **Notes** on every org, team and person: "Notable work" and "Other notes", one line at a time, each stamped with the date. Moves, renames and promotions add a dated history line automatically.
- **Reorganize freely:** drag a person or team onto another team (press and hold on iPhone), rename a placeholder team, add sub-teams (existing people wait in "Not yet placed"), merge two teams, insert a parent team, or mark anything as tentative. Everything is undoable until you save.

## Your data

Your map is stored **on your device** (in the app's local storage). This code repository never contains your data.

To see the same map on your Mac and iPhone, connect a **private** GitHub repo in **Settings & sync**:

1. Create a new **private** repository, e.g. `my-org-graph-data`. Tick "Add a README" so it isn't empty.
2. Create a [fine-grained personal access token](https://github.com/settings/personal-access-tokens/new):
   - Repository access: *Only select repositories* → that data repo
   - Permissions: *Contents → Read and write*
3. In OrgMap, open ⚙︎ → enter your GitHub username, the repo name and the token → **Connect**. Do this on each device.

After that:

- **Save** (or ⌘S) saves on the device *and* commits `org-graph.json` to the data repo.
- **Opening the app** (or coming back to it) pulls the latest version.
- If both devices changed things, the changes are combined automatically, item by item. If the same item was edited differently on both, the app asks which version to keep.
- If you save while offline, the change stays on the device and goes to GitHub the next time you save online.
- Unsaved edits are kept as a draft, so closing the app never loses them.
- Every save is a commit, so the data repo's history is a full version history of your map.

The token is stored only on your device and is sent only to GitHub.

## iPhone (free, via GitHub Pages)

The web version is published to GitHub Pages by `.github/workflows/pages.yml` whenever `main` changes.

1. One-time setup: in this repo go to **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. Once the workflow has run, open **https://jiyingz.github.io/org-chart-app/** in **Safari** on your iPhone.
3. Tap **Share → Add to Home Screen**. OrgMap now opens full-screen like a normal app.
4. Open ⚙︎ and connect your data repo (see above).

The same link also works in any desktop browser.

## Mac app

`.github/workflows/desktop.yml` builds a universal `.dmg` (Apple Silicon and Intel) on GitHub's Mac runners, so you don't need any developer tools installed:

1. Go to **Actions → Mac app → Run workflow**. Pushing a tag like `v0.1.0` also runs it, and attaches the `.dmg` to a Release.
2. When the run finishes, download **OrgMap-mac** from the run's *Artifacts*, unzip it, open the `.dmg` and drag OrgMap into Applications.
3. The app isn't signed with a paid Apple Developer certificate, so macOS will block the first launch. Fix it once in Terminal:

   ```sh
   xattr -cr /Applications/OrgMap.app
   ```

   Then open it normally.

## Using it

| Do this | How |
|---|---|
| Add an org, team, person or relationship | **＋** button, bottom right |
| Open a card | Click or tap it. The pop-up closes when you click outside it or press Esc. |
| Move a person or team | Drag the card onto a team or org card (on iPhone: press and hold, then drag). Dropping a person asks whether to **Move** them or **Add a second role**. |
| Move a whole org tree | Drag the org card |
| Select several cards | Shift + drag a box, or Shift/⌘ + click |
| Find anything | ⌘K, or **Find** |
| Undo / redo | ⌘Z / ⇧⌘Z, or the arrows in the top bar (also the **Undo** button on each change's toast) |
| Tidy the layout | The tree button next to the zoom controls |
| Backup / restore | ⚙︎ → Export as file / Import from file |

## Development

```sh
npm install
npm run dev          # web app at http://localhost:5173
npm test             # unit tests (data model, layout, sync merge)
npm run build        # PWA build into dist/
npm run tauri dev    # Mac app in development (needs Rust: https://rustup.rs)
npm run tauri build  # Mac app .dmg, built locally
```

Project layout:

```
src/
  model/      data types, editing operations, tree layout (pure TypeScript, unit-tested)
  sync/       GitHub Contents API client + three-way merge
  storage/    on-device storage (IndexedDB)
  canvas/     the pan/zoom map (React Flow), drag & drop incl. press-and-hold on touch
  ui/         pop-ups, forms, pickers, notes
  store.ts    app state, undo/redo, save/pull
src-tauri/    the native Mac wrapper (Tauri 2). It's a window around the same web app.
```

`app-icon.png` is the source for the icons. To regenerate the Mac icons from it, run `npx tauri icon app-icon.png`.
