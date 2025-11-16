# ChessNode Web UI Tests

This folder contains a minimal Node/Vitest setup for testing the static `index.html` UI.

## Setup

From this directory (`web/`):

```powershell
npm install
```

## Running tests

```powershell
npm test
```

This will run Vitest in jsdom mode and execute tests in `tests/` that exercise:

- Engine move behaviour
- Human (black) move behaviour
- PGN updates
- Log labelling and basic explanation text
