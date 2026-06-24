# DNDSTARS

A browser-based tabletop combat client for a D&D-style game: one **DM (Dungeon Master)**
instance drives the encounter (maps, enemies, turn order, damage resolution) and up to
three **player** instances connect to the same shared game state. The DM end is the
combat-state authority; player ends send action requests and render local feedback,
rolling back if the DM rejects them. See [`docs/combat-flow.md`](docs/combat-flow.md)
for the authoritative combat resolution pipeline and phase model.

Built with React + TypeScript + Vite. Client state is a Zustand store; combat
resolution runs through `src/lib/combatResolutionPipeline.ts` and the live
`MapsPage.tsx` path.

## Architecture: multi-instance shared state

Each role runs as its **own process on its own port** (a Vite dev server in dev, a
static file server in serve). All instances read and write one shared state root and
stay in sync over Server-Sent Events (SSE):

- **Shared root**: `STARS_SHARED_ROOT` (defaults to `%LOCALAPPDATA%\StarsApp\shared`),
  holding `state/` (JSON game state, lock-guarded atomic writes) and `images/`.
- **Sync**: each server process keeps an SSE backlog; clients drop stale/duplicate
  messages by monotonic id. The DM process is the source of truth for combat outcomes.
- The server runtime is shared between dev and serve via
  `scripts/shared-server-core.mjs`.

This is a "two-to-four instance" model: one DM plus one to three players, each on a
distinct port, all backed by the same shared root.

## Port map

Derived from `package.json` scripts:

| Role     | Port | Dev script            | Serve script            |
|----------|------|-----------------------|-------------------------|
| DM       | 5173 | `npm run dev:dm`      | `npm run serve:dm`      |
| Player 1 | 5174 | `npm run dev:player1` | `npm run serve:player1` |
| Player 2 | 5175 | `npm run dev:player2` | `npm run serve:player2` |
| Player 3 | 5176 | `npm run dev:player3` | `npm run serve:player3` |

(`dev:player` / `serve:player` are aliases for the 5174 player-1 port.)

## Running

### Development (hot reload)

```bash
npm install
npm run dev:dm        # DM on http://127.0.0.1:5173
npm run dev:player1   # a player on http://127.0.0.1:5174
```

Start additional player ports (`dev:player2`, `dev:player3`) in separate terminals as
needed. On Windows, `scripts/start-local-servers.ps1` can launch a set at once.

### Production-style (static build)

```bash
npm run build         # tsc -b && vite build  -> dist/
npm run serve:dm      # serves dist/ on 5173
npm run serve:player1 # serves dist/ on 5174
```

`serve:*` serves the prebuilt `dist/`, so **rebuild before serving** to avoid shipping a
stale bundle.

## Dice

Dice rolls render through a sandboxed iframe overlay loading the repo-root
`dice-box-frame.html` (a Vite multi-page `rollupOptions.input` entry in `vite.config`).
The overlay components (`src/components/DiceBoxD20Overlay.tsx`,
`src/components/DiceBoxRollOverlay.tsx`) pass `sides` / `qty` query params to the frame;
the resolved roll value flows into the DM-side combat context before the final state is
broadcast.

## Checks

```bash
npm run lint   # eslint .
npm test       # vitest run
npm run e2e    # playwright (dice e2e is known-flaky under tight loops; run locally)
npm run build  # tsc -b && vite build
```
