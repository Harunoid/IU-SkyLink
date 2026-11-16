# Updating the site

How to change IU SkyLink and get the change onto the live page, without any tooling beyond Git and a text editor.

The live site is <https://harunoid.github.io/IU-SkyLink/>. GitHub Pages serves whatever is on the `main` branch, so **anything merged or pushed to `main` goes live** about a minute later. There is no build step.

## The short version

```bash
git pull                              # get the latest
git checkout -b my-change             # work on a branch
npm start                             # preview at http://localhost:8080
# ...edit files, refresh the browser...
git add -A
git commit -m "feat: describe the change"
git push -u origin my-change
```

Then open the pull request link Git prints, check the diff, and merge it. The site updates itself.

## One-time setup

1. Install [Git](https://git-scm.com/downloads) and [Node.js](https://nodejs.org/) (the LTS version). On a Mac, `xcode-select --install` provides Git.
2. Clone the repository:

   ```bash
   git clone https://github.com/Harunoid/IU-SkyLink.git
   cd IU-SkyLink
   ```

3. The first `git push` asks you to sign in to GitHub. Follow the browser prompt.

Nothing needs installing inside the project. Node is only used for the two helper scripts under `tools/`.

## Previewing changes

The page must be opened through a local web server, not by double-clicking `index.html`, because browsers block modules and data files loaded from `file://`.

```bash
npm start
```

Open <http://localhost:8080>. Leave that running, edit files, and refresh the browser. Use a hard refresh (Cmd+Shift+R on a Mac, Ctrl+Shift+R on Windows) if a change does not show up. Stop the server with Ctrl+C.

Keep the browser's developer console open while you work (Cmd+Option+J in Chrome on a Mac). Mistakes in the JavaScript or the data show up there in red.

## Publishing

### With a pull request (recommended)

Working on a branch means a broken change never reaches the live site.

```bash
git checkout -b short-description
git add -A
git commit -m "feat: what changed"
git push -u origin short-description
```

Open the repository on GitHub, click **Compare & pull request**, read the diff, then **Merge pull request**. Afterwards, tidy up locally:

```bash
git checkout main
git pull
```

### Straight to `main`

Fine for a typo or a one-line data fix:

```bash
git add -A
git commit -m "fix: correct Ballantine address"
git push
```

### In the browser, with no local setup

On GitHub, open a file, click the pencil icon, edit, and choose **Commit changes**. Good for text and data tweaks; you cannot preview first.

### Checking the deploy

The **Actions** tab on GitHub shows a "pages build and deployment" run for every push to `main`. A green tick means the site is live. If the page still looks old, hard-refresh it.

GitHub Pages settings live under **Settings → Pages**. They should read "Deploy from a branch", `main`, `/ (root)` and never need touching again.

## Trying a pull request on your Mac before merging

Every pull request lives on a branch. To run one locally, open Terminal in your copy of the repository and fetch that branch. The branch name is shown under the pull request's title on GitHub.

```bash
cd path/to/IU-SkyLink                 # your local folder
git status                            # should say "nothing to commit"
git fetch origin                      # download new branches and commits
git switch branch-name                # check out the pull request's branch
npm start                             # preview at http://localhost:8080
```

`git switch` creates a local copy of the branch the first time and reuses it afterwards. If the branch gets new commits later, `git pull` while you are on it brings them in. Stop the preview with Ctrl+C.

If `git status` lists changed files you want to keep, set them aside with `git stash` before switching and bring them back afterwards with `git stash pop`.

## Keeping your local copy in sync with `main`

After a pull request is merged on GitHub, bring your Mac up to date:

```bash
git switch main
git pull origin main                  # main now matches GitHub
git fetch --prune                     # forget branches deleted on GitHub
git branch -d branch-name             # optional: delete your local copy of the merged branch
```

To check that you are in sync at any time:

```bash
git fetch origin
git status                            # "Your branch is up to date with 'origin/main'"
```

If your local `main` has drifted and you only want what is on GitHub, this discards local commits and edits on `main`, so use it deliberately:

```bash
git switch main
git fetch origin
git reset --hard origin/main
```

## Commit messages

The history uses [Conventional Commits](https://www.conventionalcommits.org/): a type, an optional area in brackets, and a short description in the imperative.

| Type | Use for |
| --- | --- |
| `feat:` | A new feature or visible behaviour |
| `fix:` | A bug fix |
| `style:` | Visual changes only |
| `docs:` | README or other documentation |
| `chore:` | Housekeeping that does not change the site |

Examples: `feat(map): add station photo gallery`, `fix(data): move Optometry pin onto the building`.

## Where things live

| I want to change… | Edit |
| --- | --- |
| A station's name, address, position or elevation | `public/data/skylink-data.geojson` |
| A line's route or colour | `public/data/skylink-data.geojson` (the `alignment` features) |
| Speeds, headway, walking pace, transfer and access times | `OPERATIONS` at the top of `src/js/network.js` |
| What a station popup shows | `stationPopup()` in `src/js/map.js` |
| A station's survey photos, type and clearance notes | `public/data/stations.json` |
| The survey panel layout or the schematic section | `src/js/survey.js` |
| Campus bus assumptions (headway, speed, stops, delay) | `SERVICE` in `tools/build-transit-matrix.mjs`, then `npm run build:transit` |
| The clearance corridor width | `CORRIDOR_HALF_WIDTH_M` in `src/js/map.js` |
| Sandbox dragging behaviour | `setEditable()` and `syncNetwork()` in `src/js/map.js` |
| Map colours, roads, 3D buildings | `src/js/basemap.js` |
| The trip comparison panel | `src/js/planner.js` |
| The elevation profile or energy maths | `src/js/profile.js` |
| Wind limits | `GUST_LIMITS` in `src/js/weather.js` |
| Cabin hotspots and their text | `HOTSPOTS` in `src/js/viewer.js` |
| Page text, header figures, panel layout | `index.html` |
| Colours, fonts, spacing | `src/css/tokens.css` |
| Component styling | `src/css/main.css` |

### Common jobs

**Move a station.** Try the position first with **Edit network layout** on the page. To make it permanent, change the station's `coordinates` (longitude first, then latitude) and make the same change wherever that position appears in the alignment features, so the file stays correct for other GIS tools. Then run `npm run build:transit` so the bus times match. Right-click a spot in Google Maps to copy its coordinates, then swap the order.

**Add a station.** Add a `Point` feature with a new `id`, copying an existing station's properties. Add the `id` to the `stations` list of each line that serves it, and add its position to that line's `coordinates` in the same order. Add an entry for it in `public/data/stations.json` and run `npm run build:transit`. The planner, map and menus pick it up from the data.

**Add a line.** Add a `LineString` feature with `feature_type: "alignment"`, an `id`, a `color`, a `service` of `main` or `spur`, and an ordered `stations` list. Add the new `id` to each of those stations' `lines`. Then add a toggle for it in `index.html` next to the existing three, using the same `data-line` value.

**Replace the cabin model.** Export from Rhino as `.glb` in metres with +Y up, save it over `public/models/skylink-cabin.glb`, and adjust the hotspot `position` values in `src/js/viewer.js` to suit.

**Add station survey photos.** Save each photo in `public/images/stations/`, about 1600 px wide, named after the station id (`stadium-1.jpg`). Then list it under that station in `public/data/stations.json`:

```json
"photos": [
  { "url": "images/stations/stadium-1.jpg", "caption": "North Terminal site inspection", "credit": "Harun" }
]
```

The station ids are `stadium`, `wells`, `imu`, `ballantine`, `optometry`, `gisb` and `eigenmann`. Several photos per station become a gallery with Previous and Next buttons. File names are case-sensitive on the live site.

**Add other images.** Put them in `public/images/` and reference them with a relative path such as `public/images/wells-station.jpg`. Resize photos to about 1600 px wide first; phone originals are far larger than a web page needs.

**Refresh footprints and elevations.** Run `npm run fetch:data` and commit the changed files in `public/data/`.

## The map and API keys

The basemap uses [OpenFreeMap](https://openfreemap.org/) tiles drawn with [MapLibre GL JS](https://maplibre.org/), and the distance maths uses [Turf.js](https://turfjs.org/), which runs entirely in the browser. None of them needs an account or an API key, so there is nothing to configure or keep secret.

If you later add a service that does need a key, remember that everything in this repository is public and everything the page loads is visible to visitors. A key committed here is a key published. Either use it in a script you run on your own machine and commit only the results (as `tools/fetch-campus-data.mjs` does for open data), or use a key that the provider lets you restrict to the `harunoid.github.io` domain.

## When something goes wrong

- **The page is blank or half-drawn.** Open the console. A red error names the file and line.
- **"Failed to fetch" for the GeoJSON.** The data file has a syntax error, usually a missing or extra comma. Paste it into <https://geojson.io> to find it.
- **It works locally but not live.** Check the Actions tab for a failed deploy, then hard-refresh. Paths are case-sensitive on GitHub Pages even though they are not on a Mac: `Public/Data` will not find `public/data`.
- **I merged something that broke the site.** On the merged pull request, click **Revert**, then merge the revert. The site returns to the previous state.
- **Git refuses to push.** Someone (or you, on GitHub) changed `main` since your last pull. Run `git pull --rebase` and push again.
